import type { AgentTool } from "../tool.js";
import type { DietRepository } from "../../store/repositories/diet.js";
import type { ExerciseRepository } from "../../store/repositories/exercise.js";
import type { GoalRepository } from "../../store/repositories/goals.js";
import type { UserProfileRepository } from "../../store/repositories/profiles.js";
import type { KnowledgeService } from "../../health/knowledge.js";
import type { ReportGenerator } from "../../health/report-generator.js";
import { computeHealthMetrics } from "../../health/calculator.js";
import type {
  ActivityLevel,
  Confidence,
  DietInput,
  DietRecord,
  ExerciseInput,
  ExerciseRecord,
  Gender,
  GoalType,
  Intensity,
  Meal,
  ReportPeriod,
} from "../../health/types.js";

export type WebSearch = (query: string) => Promise<{ answer?: string; items: Array<{ title: string; snippet: string }> }>;

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

export type HealthToolsDeps = {
  dietRepo: DietRepository;
  exerciseRepo: ExerciseRepository;
  goalRepo: GoalRepository;
  profileRepo: UserProfileRepository;
  reportGenerator?: ReportGenerator;
  knowledgeService?: KnowledgeService;
  webSearch?: WebSearch;
  logger?: Logger;
};

// ─── helpers ───

const VALID_MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return undefined;
}

function parseMeal(v: unknown): Meal | undefined {
  if (typeof v === "string" && VALID_MEALS.includes(v as Meal)) return v as Meal;
  return undefined;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentTimeStr(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function inferMeal(): Meal {
  const hour = new Date().getHours();
  if (hour >= 6 && hour < 10) return "breakfast";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "snack";
}

// Regex patterns for extracting calorie values from text
const CALORIE_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*kcal/i,
  /(\d+(?:\.\d+)?)\s*大卡/i,
  /(\d+(?:\.\d+)?)\s*千卡/i,
  /(\d+(?:\.\d+)?)\s*卡路里/i,
  /热量[：:为是]?\s*(\d+(?:\.\d+)?)/i,
  /每100[g克][：:.\s]*(\d+(?:\.\d+)?)/i,
];

function extractCaloriesFromText(text: string): number | undefined {
  for (const pattern of CALORIE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseFloat(match[1]);
      if (!Number.isNaN(value) && value > 0 && value < 10000) {
        return Math.round(value);
      }
    }
  }
  return undefined;
}

function findMatchingDietRecord(records: DietRecord[], foodName: string): DietRecord | undefined {
  const exact = records.filter((r) => r.foodName === foodName);
  if (exact.length > 0) return exact[exact.length - 1];
  const fuzzy = records.filter((r) => r.foodName.includes(foodName) || foodName.includes(r.foodName));
  if (fuzzy.length > 0) return fuzzy[fuzzy.length - 1];
  return undefined;
}

function findMatchingExerciseRecord(records: ExerciseRecord[], exerciseName: string): ExerciseRecord | undefined {
  const exact = records.filter((r) => r.exerciseName === exerciseName);
  if (exact.length > 0) return exact[exact.length - 1];
  const fuzzy = records.filter((r) => r.exerciseName.includes(exerciseName) || exerciseName.includes(r.exerciseName));
  if (fuzzy.length > 0) return fuzzy[fuzzy.length - 1];
  return undefined;
}

function params(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

// ─── tool factory ───

export function createHealthTools(deps: HealthToolsDeps): AgentTool[] {
  const log = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };

  async function resolveFoodCalories(
    foodName: string,
    quantity?: number,
    unit?: string,
    llmCalories?: number,
  ): Promise<{ calories: number; confidence: Confidence; matchedName: string; kbSource?: string } | undefined> {
    // Priority: 知识库 > 网页搜索 > LLM 估算
    if (deps.knowledgeService) {
      try {
        const kr = await deps.knowledgeService.lookupFood(foodName, quantity, unit);
        if (kr.confidence !== "low" && kr.calories !== undefined) {
          return { calories: kr.calories, confidence: kr.confidence, matchedName: kr.matchedName ?? foodName, kbSource: "lightrag" };
        }
      } catch (err) {
        log.warn({ foodName, err: String(err) }, "knowledge food lookup failed");
      }
    }
    if (deps.webSearch) {
      try {
        const web = await deps.webSearch(`${foodName} 热量 营养成分 每100g`);
        if (web.answer) {
          const c = extractCaloriesFromText(web.answer);
          if (c !== undefined) {
            return { calories: c, confidence: "medium", matchedName: foodName };
          }
        }
      } catch (err) {
        log.warn({ foodName, err: String(err) }, "web food lookup failed");
      }
    }
    if (llmCalories !== undefined) {
      return { calories: llmCalories, confidence: "low", matchedName: foodName };
    }
    return undefined;
  }

  return [
    {
      name: "health.set_profile",
      description: "设置或更新用户的基础身体信息（性别、年龄、体重、身高、运动量、目标体重）。记录饮食/运动前需先设置档案。",
      parameters: params({
        gender: { type: "string", enum: ["male", "female"], description: "性别" },
        age: { type: "number", description: "年龄" },
        weightKg: { type: "number", description: "体重 kg" },
        heightCm: { type: "number", description: "身高 cm" },
        activityLevel: { type: "string", enum: ["sedentary", "light", "moderate", "active", "very_active"], description: "运动量" },
        targetWeightKg: { type: "number", description: "目标体重 kg" },
      }),
      handler: async (input, ctx) => {
        const profile = await deps.profileRepo.upsert({
          userId: ctx.userId,
          gender: input.gender as Gender,
          age: num(input.age),
          weightKg: num(input.weightKg),
          heightCm: num(input.heightCm),
          activityLevel: input.activityLevel as ActivityLevel,
          targetWeightKg: num(input.targetWeightKg),
        });
        return { ok: true, profile, metrics: computeHealthMetrics(profile) };
      },
    },

    {
      name: "health.get_profile",
      description: "查看用户的健康档案和各项指标（BMR、TDEE、BMI、蛋白质/碳水/脂肪推荐量）。未设置时返回 profile=null。",
      parameters: params({}),
      handler: async (_input, ctx) => {
        const profile = await deps.profileRepo.get(ctx.userId);
        if (!profile) {
          return { ok: false, profile: null, message: "用户尚未设置身体信息，请先调用 health.set_profile 引导用户设置" };
        }
        return { ok: true, profile, metrics: computeHealthMetrics(profile) };
      },
    },

    {
      name: "health.record_diet",
      description: "记录一条饮食摄入。若未提供 calories，会自动查询知识库/网页估算热量。前提：用户已设置身体信息。",
      parameters: params({
        foodName: { type: "string", description: "食物名称" },
        quantity: { type: "number", description: "数量" },
        unit: { type: "string", description: "单位，如 个/份/克" },
        meal: { type: "string", enum: VALID_MEALS, description: "餐次 breakfast/lunch/dinner/snack" },
        calories: { type: "number", description: "热量 kcal（可选，缺省时自动查询）" },
        recordDate: { type: "string", description: "记录日期 YYYY-MM-DD，缺省今天" },
        recordedAt: { type: "string", description: "记录时间 HH:MM（可选）" },
      }, ["foodName"]),
      handler: async (input, ctx) => {
        const foodName = str(input.foodName);
        if (!foodName) return { ok: false, error: "missing_foodName", message: "缺少食物名称" };
        const profile = await deps.profileRepo.get(ctx.userId).catch(() => undefined);
        if (!profile) {
          return { ok: false, error: "profile_required", message: "请先设置身体信息（health.set_profile），含性别/年龄/体重/身高/运动量" };
        }
        const quantity = num(input.quantity);
        const unit = str(input.unit) ?? "份";
        const meal = parseMeal(input.meal) ?? inferMeal();
        const recordDate = str(input.recordDate) ?? todayStr();
        const resolved = await resolveFoodCalories(foodName, quantity, unit, num(input.calories));
        if (!resolved) {
          return { ok: false, error: "calories_unknown", message: `无法确定「${foodName}」的热量，让用户补充数量或更具体的食物信息` };
        }
        const record = await deps.dietRepo.create({
          userId: ctx.userId,
          foodName,
          quantity,
          unit,
          meal,
          calories: resolved.calories,
          confidence: resolved.confidence,
          kbSource: resolved.kbSource,
          kbMatchedName: resolved.matchedName,
          rawText: ctx.text,
          recordDate,
        });
        const todaySummary = await deps.dietRepo.getDailySummary(ctx.userId, recordDate);
        return { ok: true, record, todaySummary, recordedAt: str(input.recordedAt) ?? currentTimeStr() };
      },
    },

    {
      name: "health.record_exercise",
      description: "记录一条运动消耗。若未提供 calories，会自动查询知识库（MET）计算消耗热量（需档案体重）。前提：用户已设置身体信息。",
      parameters: params({
        exerciseName: { type: "string", description: "运动名称" },
        durationMin: { type: "number", description: "时长（分钟）" },
        distanceKm: { type: "number", description: "距离 km（可选）" },
        intensity: { type: "string", enum: ["low", "medium", "high"], description: "强度" },
        weightKg: { type: "number", description: "锻炼负荷重量 kg，如深蹲 80kg（可选）" },
        calories: { type: "number", description: "消耗热量 kcal（可选，缺省时自动计算）" },
        recordDate: { type: "string", description: "记录日期 YYYY-MM-DD，缺省今天" },
        recordedAt: { type: "string", description: "记录时间 HH:MM（可选）" },
      }, ["exerciseName"]),
      handler: async (input, ctx) => {
        const exerciseName = str(input.exerciseName);
        if (!exerciseName) return { ok: false, error: "missing_exerciseName", message: "缺少运动名称" };
        const profile = await deps.profileRepo.get(ctx.userId).catch(() => undefined);
        if (!profile) {
          return { ok: false, error: "profile_required", message: "请先设置身体信息（health.set_profile），含性别/年龄/体重/身高/运动量" };
        }
        const durationMin = num(input.durationMin);
        const weightKg = profile.weightKg ?? 70;

        let calories = num(input.calories);
        let confidence: Confidence = "low";
        let matchedName: string | undefined;
        let kbSource: string | undefined;
        if (calories === undefined && deps.knowledgeService) {
          try {
            const kr = await deps.knowledgeService.lookupExercise(exerciseName, durationMin, str(input.intensity));
            if (kr.confidence !== "low") {
              confidence = kr.confidence;
              matchedName = kr.matchedName ?? exerciseName;
              if (kr.calories !== undefined) {
                calories = kr.calories;
              } else if (kr.met !== undefined && durationMin !== undefined) {
                calories = Math.round(kr.met * weightKg * (durationMin / 60));
              }
              if (calories !== undefined) kbSource = "lightrag";
            }
          } catch (err) {
            log.warn({ exerciseName, err: String(err) }, "knowledge exercise lookup failed");
          }
        }
        if (calories === undefined) {
          return { ok: false, error: "calories_unknown", message: `无法确定「${exerciseName}」的消耗热量，让用户提供时长等信息` };
        }

        const record = await deps.exerciseRepo.create({
          userId: ctx.userId,
          exerciseName,
          durationMin,
          distanceKm: num(input.distanceKm),
          intensity: (str(input.intensity) as Intensity) ?? undefined,
          calories,
          confidence,
          kbSource,
          kbMatchedName: matchedName,
          rawText: ctx.text,
          recordDate: str(input.recordDate) ?? todayStr(),
        });
        const todaySummary = await deps.exerciseRepo.getDailySummary(ctx.userId, record.recordDate);
        return { ok: true, record, todaySummary, recordedAt: str(input.recordedAt) ?? currentTimeStr() };
      },
    },

    {
      name: "health.query_history",
      description: "查询某天的饮食和运动记录（含各条热量）。",
      parameters: params({ date: { type: "string", description: "日期 YYYY-MM-DD，缺省今天" } }),
      handler: async (input, ctx) => {
        const date = str(input.date) ?? todayStr();
        const [dietRecords, exerciseRecords] = await Promise.all([
          deps.dietRepo.getByDate(ctx.userId, date),
          deps.exerciseRepo.getByDate(ctx.userId, date),
        ]);
        return { ok: true, date, dietRecords, exerciseRecords };
      },
    },

    {
      name: "health.calculate_intake",
      description: "确定性计算某日已记录饮食的总摄入热量。只汇总数据库中的饮食记录，不使用 LLM 估算。",
      parameters: params({ date: { type: "string", description: "日期 YYYY-MM-DD，缺省今天" } }),
      handler: async (input, ctx) => {
        const date = str(input.date) ?? todayStr();
        const summary = await deps.dietRepo.getDailySummary(ctx.userId, date);
        return {
          ok: true,
          date,
          intakeCalories: summary.totalCalories,
          byMeal: summary.byMeal,
          items: summary.items,
        };
      },
    },

    {
      name: "health.calculate_expenditure",
      description: "确定性计算某日已记录运动的总消耗热量。只汇总数据库中的运动记录，不使用 LLM 估算。",
      parameters: params({ date: { type: "string", description: "日期 YYYY-MM-DD，缺省今天" } }),
      handler: async (input, ctx) => {
        const date = str(input.date) ?? todayStr();
        const [summary, profile] = await Promise.all([
          deps.exerciseRepo.getDailySummary(ctx.userId, date),
          deps.profileRepo.get(ctx.userId),
        ]);
        const basalCalories = profile ? computeHealthMetrics(profile).bmr ?? 0 : 0;
        const exerciseCalories = summary.totalCalories;
        return {
          ok: true,
          date,
          exerciseCalories,
          basalCalories,
          expenditureCalories: exerciseCalories + basalCalories,
          items: summary.items,
        };
      },
    },

    {
      name: "health.correct_record",
      description: "修正一条已有的饮食或运动记录（按名称匹配当天记录，可改数量/时长/单位/餐次/强度/热量）。",
      parameters: params({
        foodName: { type: "string", description: "要修正的饮食名称" },
        exerciseName: { type: "string", description: "要修正的运动名称" },
        quantity: { type: "number", description: "饮食新的数量" },
        durationMin: { type: "number", description: "运动新的时长（分钟）" },
        unit: { type: "string", description: "饮食新的单位" },
        meal: { type: "string", enum: VALID_MEALS, description: "饮食新的餐次" },
        intensity: { type: "string", enum: ["low", "medium", "high"], description: "运动新的强度" },
        calories: { type: "number", description: "新的热量 kcal（可选，按比例重算）" },
        date: { type: "string", description: "日期 YYYY-MM-DD，缺省今天" },
      }),
      handler: async (input, ctx) => {
        const date = str(input.date) ?? todayStr();
        const foodName = str(input.foodName);
        if (foodName) {
          const todayDiet = await deps.dietRepo.getByDate(ctx.userId, date);
          const match = findMatchingDietRecord(todayDiet, foodName);
          if (match) {
            const updates: Partial<DietInput> = {};
            const quantity = num(input.quantity);
            if (quantity !== undefined) {
              updates.quantity = quantity;
              if (match.quantity > 0 && num(input.calories) === undefined) {
                updates.calories = Math.round((match.calories / match.quantity) * quantity);
              }
            }
            const calories = num(input.calories);
            if (calories !== undefined) updates.calories = calories;
            const unit = str(input.unit);
            if (unit) updates.unit = unit;
            const meal = parseMeal(input.meal);
            if (meal) updates.meal = meal;
            const updated = await deps.dietRepo.update(match.id, updates);
            if (updated) {
              const todaySummary = await deps.dietRepo.getDailySummary(ctx.userId, date);
              return { ok: true, target: "diet", updated, todaySummary };
            }
          }
        }
        const exerciseName = str(input.exerciseName);
        if (exerciseName) {
          const todayExercise = await deps.exerciseRepo.getByDate(ctx.userId, date);
          const match = findMatchingExerciseRecord(todayExercise, exerciseName);
          if (match) {
            const updates: Partial<ExerciseInput> = {};
            const durationMin = num(input.durationMin);
            if (durationMin !== undefined) {
              updates.durationMin = durationMin;
              if (match.durationMin && match.durationMin > 0 && num(input.calories) === undefined) {
                updates.calories = Math.round((match.calories / match.durationMin) * durationMin);
              }
            }
            const calories = num(input.calories);
            if (calories !== undefined) updates.calories = calories;
            const intensity = str(input.intensity);
            if (intensity && ["low", "medium", "high"].includes(intensity)) updates.intensity = intensity as Intensity;
            const updated = await deps.exerciseRepo.update(match.id, updates);
            if (updated) {
              const todaySummary = await deps.exerciseRepo.getDailySummary(ctx.userId, date);
              return { ok: true, target: "exercise", updated, todaySummary };
            }
          }
        }
        return { ok: false, error: "not_found", message: "未找到匹配的记录，请确认名称或日期" };
      },
    },

    {
      name: "health.delete_record",
      description: "删除一条饮食或运动记录。可按食物名/运动名/餐次删除，或删除当天最新一条。",
      parameters: params({
        target: { type: "string", enum: ["diet", "exercise"], description: "删除类型" },
        foodName: { type: "string", description: "要删除的饮食食物名" },
        exerciseName: { type: "string", description: "要删除的运动名" },
        meal: { type: "string", enum: VALID_MEALS, description: "按餐次删除饮食" },
        date: { type: "string", description: "日期 YYYY-MM-DD，缺省今天" },
      }),
      handler: async (input, ctx) => {
        const date = str(input.date) ?? todayStr();
        const target = str(input.target);
        const foodName = str(input.foodName);
        const exerciseName = str(input.exerciseName);
        const meal = parseMeal(input.meal);
        let deleted = false;

        if (target === "diet" || (!target && (foodName || meal))) {
          let deletedCount = 0;
          let deletedName = "";
          if (foodName) {
            deletedCount = await deps.dietRepo.deleteByFoodName(ctx.userId, date, foodName);
            deletedName = foodName;
          }
          if (deletedCount === 0 && meal) {
            deletedCount = await deps.dietRepo.deleteByMeal(ctx.userId, date, meal);
            deletedName = `${meal}餐`;
          }
          if (deletedCount === 0) {
            const latest = await deps.dietRepo.deleteLatest(ctx.userId, date);
            if (latest) { deletedCount = 1; deletedName = latest.foodName; }
          }
          if (deletedCount > 0) {
            const todaySummary = await deps.dietRepo.getDailySummary(ctx.userId, date);
            return { ok: true, target: "diet", deletedCount, deletedName, todaySummary };
          }
        }

        if (!deleted && (target === "exercise" || (!target && exerciseName))) {
          let deletedCount = 0;
          let deletedName = "";
          if (exerciseName) {
            deletedCount = await deps.exerciseRepo.deleteByExerciseName(ctx.userId, date, exerciseName);
            deletedName = exerciseName;
          }
          if (deletedCount === 0) {
            const latest = await deps.exerciseRepo.deleteLatest(ctx.userId, date);
            if (latest) { deletedCount = 1; deletedName = latest.exerciseName; }
          }
          if (deletedCount > 0) {
            const todaySummary = await deps.exerciseRepo.getDailySummary(ctx.userId, date);
            return { ok: true, target: "exercise", deletedCount, deletedName, todaySummary };
          }
        }

        return { ok: false, error: "not_found", message: "未找到要删除的记录，请让用户确认具体记录" };
      },
    },

    {
      name: "health.set_goal",
      description: "设置用户的健康目标（每日摄入热量/消耗热量/目标体重）。",
      parameters: params({
        goalType: { type: "string", enum: ["calorie_intake", "calorie_burn", "weight"], description: "目标类型" },
        targetValue: { type: "number", description: "目标值" },
      }, ["goalType", "targetValue"]),
      handler: async (input, ctx) => {
        const goalType = str(input.goalType) as GoalType | undefined;
        const targetValue = num(input.targetValue);
        if (!goalType || targetValue === undefined) {
          return { ok: false, error: "missing_fields", message: "请提供 goalType（calorie_intake/calorie_burn/weight）和 targetValue" };
        }
        const goal = await deps.goalRepo.set({
          userId: ctx.userId,
          goalType,
          targetValue,
          unit: goalType === "weight" ? "kg" : "kcal",
          period: "daily",
        });
        return { ok: true, goal };
      },
    },

    {
      name: "health.generate_report",
      description: "生成热量报告（日/周/月/季/年），含总摄入/总消耗/净热量/平均值/趋势/建议。",
      parameters: params({
        period: { type: "string", enum: ["daily", "weekly", "monthly", "quarterly", "yearly"], description: "报告周期，缺省 daily" },
        date: { type: "string", description: "参考日期 YYYY-MM-DD，缺省今天" },
      }),
      handler: async (input, ctx) => {
        if (!deps.reportGenerator) return { ok: false, error: "unavailable", message: "报告功能未配置" };
        const period = (str(input.period) as ReportPeriod) ?? "daily";
        const report = await deps.reportGenerator.generate(ctx.userId, period, str(input.date));
        return { ok: true, report };
      },
    },

    {
      name: "health.lookup_food",
      description: "查询食物的热量和营养信息（知识库优先，网页兜底）。用于用户问'XX热量多少'或记录前查热量。",
      parameters: params({
        foodName: { type: "string", description: "食物名称" },
        quantity: { type: "number", description: "数量（可选）" },
        unit: { type: "string", description: "单位（可选）" },
      }, ["foodName"]),
      handler: async (input) => {
        const foodName = str(input.foodName);
        if (!foodName) return { ok: false, error: "missing_foodName", message: "缺少食物名称" };
        const resolved = await resolveFoodCalories(foodName, num(input.quantity), str(input.unit));
        return resolved
          ? { ok: true, foodName, calories: resolved.calories, confidence: resolved.confidence, matchedName: resolved.matchedName }
          : { ok: false, foodName, calories: undefined, confidence: "low", message: "未能确定该食物的热量" };
      },
    },

    {
      name: "health.lookup_exercise",
      description: "查询运动消耗（MET/热量）。用于用户问'跑步消耗多少'时。",
      parameters: params({
        exerciseName: { type: "string", description: "运动名称" },
        durationMin: { type: "number", description: "时长分钟（可选）" },
        intensity: { type: "string", enum: ["low", "medium", "high"], description: "强度（可选）" },
      }, ["exerciseName"]),
      handler: async (input) => {
        const exerciseName = str(input.exerciseName);
        if (!exerciseName) return { ok: false, error: "missing_exerciseName", message: "缺少运动名称" };
        if (!deps.knowledgeService) return { ok: false, error: "knowledge_unavailable", message: "知识库不可用" };
        const kr = await deps.knowledgeService.lookupExercise(exerciseName, num(input.durationMin), str(input.intensity));
        return { ok: true, exerciseName, met: kr.met, calories: kr.calories, confidence: kr.confidence, matchedName: kr.matchedName };
      },
    },

    {
      name: "health.get_advice",
      description: "针对某个主题获取健康/饮食/减脂建议（知识库优先，网页兜底）。用于用户求建议时。",
      parameters: params({ topic: { type: "string", description: "建议主题" } }, ["topic"]),
      handler: async (input, ctx) => {
        const topic = str(input.topic) ?? "general";
        let advice: string[] = [];
        let source = "";
        if (deps.knowledgeService) {
          const today = todayStr();
          const [diet, exercise] = await Promise.all([
            deps.dietRepo.getByDate(ctx.userId, today),
            deps.exerciseRepo.getByDate(ctx.userId, today),
          ]);
          const todayIntake = diet.reduce((s, r) => s + r.calories, 0);
          const todayBurn = exercise.reduce((s, r) => s + r.calories, 0);
          const kr = await deps.knowledgeService.getAdvice(topic, { todayIntake, todayBurn });
          if (kr.advice && kr.advice.length > 0) {
            advice = kr.advice;
            source = "knowledge-base";
          }
        }
        if (advice.length === 0 && deps.webSearch) {
          try {
            const web = await deps.webSearch(`${topic} 健康建议`);
            const snippets = [web.answer, ...web.items.map((i) => i.snippet)]
              .filter((s): s is string => typeof s === "string" && s.trim().length >= 10);
            if (snippets.length > 0) {
              advice = snippets;
              source = "web";
            }
          } catch (err) {
            log.warn({ topic, err: String(err) }, "web advice search failed");
          }
        }
        return { ok: true, topic, source, advice: advice.slice(0, 5) };
      },
    },
  ];
}

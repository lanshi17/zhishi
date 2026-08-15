import type {
  Report,
  ReportPeriod,
  UserGoal,
} from "./types.js";
import type { DietRepository } from "../store/repositories/diet.js";
import type { ExerciseRepository } from "../store/repositories/exercise.js";
import type { GoalRepository } from "../store/repositories/goals.js";
import type { ReportRepository } from "../store/repositories/reports.js";
import type { KnowledgeService } from "./knowledge.js";
import type { UserProfileRepository } from "../store/repositories/profiles.js";
import { calculateBMR } from "./calculator.js";

type Logger = {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
};

export type ReportGeneratorDeps = {
  dietRepo: DietRepository;
  exerciseRepo: ExerciseRepository;
  goalRepo: GoalRepository;
  reportRepo: ReportRepository;
  profileRepo?: UserProfileRepository;
  knowledgeService?: KnowledgeService;
  logger?: Logger;
};

export type ReportGenerator = ReturnType<typeof createReportGenerator>;

function hasBurnBreakdown(value: unknown): value is Report {
  return typeof value === "object"
    && value !== null
    && "exerciseBurn" in value
    && "basalBurn" in value;
}

// ─── Date helpers ───

function todayStr(): string {
  const d = new Date();
  return formatLocalDate(d);
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getPeriodRange(period: ReportPeriod, refDate?: string): { start: string; end: string } {
  const ref = refDate ? new Date(refDate) : new Date();
  const y = ref.getFullYear();
  const m = ref.getMonth();

  switch (period) {
    case "daily":
      return { start: formatLocalDate(ref), end: formatLocalDate(ref) };

    case "weekly": {
      // Monday = start of week
      const day = ref.getDay(); // 0=Sun, 1=Mon, ...
      const offset = day === 0 ? -6 : 1 - day;
      const monday = new Date(ref);
      monday.setDate(ref.getDate() + offset);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start: formatLocalDate(monday), end: formatLocalDate(sunday) };
    }

    case "monthly": {
      const first = new Date(y, m, 1);
      const last = new Date(y, m + 1, 0); // day 0 of next month = last day of current
      return { start: formatLocalDate(first), end: formatLocalDate(last) };
    }

    case "quarterly": {
      const qStartMonth = Math.floor(m / 3) * 3;
      const first = new Date(y, qStartMonth, 1);
      const last = new Date(y, qStartMonth + 3, 0);
      return { start: formatLocalDate(first), end: formatLocalDate(last) };
    }

    case "yearly": {
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
  }
}

function countDays(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const diffMs = e.getTime() - s.getTime();
  return Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1);
}

// ─── Trend calculation ───

function calculateTrend(
  dailyIntakes: number[],
): "increasing" | "decreasing" | "stable" | undefined {
  if (dailyIntakes.length < 3) return undefined;

  const half = Math.floor(dailyIntakes.length / 2);
  const firstHalfAvg = avg(dailyIntakes.slice(0, half));
  const secondHalfAvg = avg(dailyIntakes.slice(half));

  if (firstHalfAvg === 0) return undefined;
  const changePct = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100;

  if (changePct > 8) return "increasing";
  if (changePct < -8) return "decreasing";
  return "stable";
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ─── Report generator ───

export function createReportGenerator(deps: ReportGeneratorDeps) {
  const log = deps.logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  async function generate(
    userId: string,
    period: ReportPeriod,
    refDate?: string,
  ): Promise<Report> {
    const { start, end } = getPeriodRange(period, refDate);

    // Check for cached snapshot (skip for daily — always fresh)
    if (period !== "daily") {
      const cached = await deps.reportRepo.get(userId, period, start).catch(() => undefined);
      if (cached && hasBurnBreakdown(cached.summaryJson)) {
        log.info("report cache hit", { userId, period, start });
        return cached.summaryJson;
      }
    }

    // Query data
    const [dietSummary, exerciseSummary, activeGoals, profile] = await Promise.all([
      deps.dietRepo.getRangeSummary(userId, start, end),
      deps.exerciseRepo.getRangeSummary(userId, start, end),
      deps.goalRepo.getActive(userId).catch(() => [] as UserGoal[]),
      deps.profileRepo?.get(userId).catch(() => undefined),
    ]);

    const totalIntake = Math.round(dietSummary.totalCalories);
    const days = countDays(start, end);
    const exerciseBurn = Math.round(exerciseSummary.totalCalories);
    const basalBurn = (calculateBMR(profile ?? { userId, updatedAt: "" }) ?? 0) * days;
    const totalBurn = exerciseBurn + basalBurn;
    const netCalories = totalIntake - totalBurn;
    const avgDailyIntake = Math.round(totalIntake / days);
    const avgDailyBurn = Math.round(totalBurn / days);
    const recordCount = dietSummary.recordCount + exerciseSummary.recordCount;

    // Diet breakdown by meal
    const dietBreakdown = Object.entries(dietSummary.byMeal)
      .map(([meal, calories]) => ({
        meal,
        calories: Math.round(calories),
        percentage: totalIntake > 0 ? Math.round((calories / totalIntake) * 100) : 0,
      }))
      .sort((a, b) => b.calories - a.calories);

    // Exercise breakdown by name
    const exerciseBreakdown = Object.entries(exerciseSummary.byExercise)
      .map(([name, calories]) => ({
        name,
        calories: Math.round(calories),
        percentage: exerciseBurn > 0 ? Math.round((calories / exerciseBurn) * 100) : 0,
      }))
      .sort((a, b) => b.calories - a.calories);

    // Calculate trend (requires daily data — only for periods > daily)
    let trend: Report["trend"];
    if (period !== "daily") {
      const dailyIntakes = await collectDailyIntakes(userId, start, end);
      trend = calculateTrend(dailyIntakes);
    }

    // Insights
    const insights = generateInsights({
      totalIntake,
      totalBurn,
      netCalories,
      avgDailyIntake,
      avgDailyBurn,
      days,
      recordCount,
      activeGoals,
      period,
    });

    // Knowledge base advice
    const advice: string[] = [];
    if (deps.knowledgeService) {
      try {
        const adviceResult = await deps.knowledgeService.getAdvice(
          `${period}热量报告分析`,
          {
            avgDailyIntake,
            avgDailyBurn,
            netCalories,
            days,
            recordCount,
          },
        );
        if (adviceResult.advice && adviceResult.advice.length > 0) {
          advice.push(...adviceResult.advice.slice(0, 3));
        }
      } catch (err) {
        log.warn("knowledge service advice failed", { err: String(err) });
      }
    }

    const report: Report = {
      periodType: period,
      periodStart: start,
      periodEnd: end,
      totalIntake,
      exerciseBurn,
      basalBurn,
      totalBurn,
      netCalories,
      avgDailyIntake,
      avgDailyBurn,
      recordCount,
      dietBreakdown,
      exerciseBreakdown,
      trend,
      insights,
      advice,
    };

    // Save snapshot (skip for daily)
    if (period !== "daily") {
      try {
        await deps.reportRepo.save({
          userId,
          periodType: period,
          periodStart: start,
          periodEnd: end,
          summaryJson: report,
        });
      } catch (err) {
        log.warn("failed to save report snapshot", { err: String(err) });
      }
    }

    return report;
  }

  async function invalidate(
    userId: string,
    period: ReportPeriod,
    refDate?: string,
  ): Promise<void> {
    const { start } = getPeriodRange(period, refDate);
    await deps.reportRepo.invalidate(userId, period, start).catch(() => {});
    log.info("report cache invalidated", { userId, period, start });
  }

  async function collectDailyIntakes(
    userId: string,
    start: string,
    end: string,
  ): Promise<number[]> {
    const days = countDays(start, end);
    const result: number[] = [];
    const startDate = new Date(start);

    for (let i = 0; i < days && i < 366; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = formatLocalDate(d);
      const summary = await deps.dietRepo.getDailySummary(userId, dateStr);
      result.push(summary.totalCalories);
    }

    return result;
  }

  return { generate, invalidate, collectDailyIntakes };
}

// ─── Insight generation ───

function generateInsights(params: {
  totalIntake: number;
  totalBurn: number;
  netCalories: number;
  avgDailyIntake: number;
  avgDailyBurn: number;
  days: number;
  recordCount: number;
  activeGoals: UserGoal[];
  period: ReportPeriod;
}): string[] {
  const insights: string[] = [];
  const {
    totalIntake,
    totalBurn,
    netCalories,
    avgDailyIntake,
    avgDailyBurn,
    days,
    recordCount,
    activeGoals,
  } = params;

  // Goal progress
  const intakeGoal = activeGoals.find(
    (g) => g.goalType === "calorie_intake" && g.active,
  );
  if (intakeGoal) {
    const pct = intakeGoal.targetValue > 0
      ? Math.round((avgDailyIntake / intakeGoal.targetValue) * 100)
      : 0;
    insights.push(`日均摄入 ${avgDailyIntake} kcal，目标 ${intakeGoal.targetValue} ${intakeGoal.unit}，达成 ${pct}%`);
  }

  const burnGoal = activeGoals.find(
    (g) => g.goalType === "calorie_burn" && g.active,
  );
  if (burnGoal) {
    const pct = burnGoal.targetValue > 0
      ? Math.round((avgDailyBurn / burnGoal.targetValue) * 100)
      : 0;
    insights.push(`日均消耗 ${avgDailyBurn} kcal，目标 ${burnGoal.targetValue} ${burnGoal.unit}，达成 ${pct}%`);
  }

  // Balance insight
  if (netCalories > 500 * days) {
    insights.push(`净摄入偏高（+${netCalories} kcal），建议增加运动或减少摄入`);
  } else if (netCalories < -200 * days) {
    insights.push(`净摄入为负（${netCalories} kcal），注意补充能量`);
  } else {
    insights.push(`热量收支平衡，净摄入 ${netCalories > 0 ? "+" : ""}${netCalories} kcal`);
  }

  // Record density
  const recordsPerDay = days > 0 ? recordCount / days : 0;
  if (recordsPerDay < 2) {
    insights.push(`记录频率偏低（日均 ${recordsPerDay.toFixed(1)} 条），建议养成随时记录的习惯`);
  }

  return insights;
}

// ─── Report formatting removed ───
// 格式化逻辑已由 LLM 取代：report 数据结构在工具调用循环中作为
// health.generate_report 的返回结果交给 LLM 生成回复。

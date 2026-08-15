import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHealthPipeline } from "../../src/agent/pipeline.js";
import type { AgentProvider, ChatResult } from "../../src/agent/provider/base.js";
import type { ChatInput } from "../../src/agent/provider/base.js";
import type { KnowledgeService } from "../../src/health/knowledge.js";
import type { AgentContext, KnowledgeResult } from "../../src/health/types.js";
import type { DietRepository } from "../../src/store/repositories/diet.js";
import type { ExerciseRepository } from "../../src/store/repositories/exercise.js";
import type { GoalRepository } from "../../src/store/repositories/goals.js";
import type { UserProfileRepository } from "../../src/store/repositories/profiles.js";
import type { ReportGenerator } from "../../src/health/report-generator.js";

/**
 * Mock provider. Under the tool-calling loop, `chat()` is called repeatedly:
 * tests pass a sequence of ChatResults — typically a tool_calls result first
 * (so the loop runs the real health handler), then a final content result
 * (the reply). The last entry repeats if the loop needs more turns.
 */
function makeProvider(...results: ChatResult[]): AgentProvider {
  let i = 0;
  return {
    plan: async () => ({ reply: "", actions: [] }),
    chat: async () => {
      const r = results[Math.min(i, results.length - 1)];
      i++;
      return r;
    },
  };
}

function toolCall(name: string, args: Record<string, unknown>, id = "c1"): ChatResult {
  return { kind: "tool_calls", toolCalls: [{ id, name, arguments: args }] };
}

function finalReply(content: string): ChatResult {
  return { kind: "final", content };
}

function makeMockKnowledgeService(
  foodResult?: KnowledgeResult,
  exerciseResult?: KnowledgeResult,
  adviceResult?: KnowledgeResult,
): KnowledgeService {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    lookupFood: vi.fn().mockResolvedValue(foodResult ?? { confidence: "low" }),
    lookupExercise: vi.fn().mockResolvedValue(exerciseResult ?? { confidence: "low" }),
    getAdvice: vi.fn().mockResolvedValue(adviceResult ?? { confidence: "low" }),
  } as unknown as KnowledgeService;
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    todayDietRecords: [],
    todayExerciseRecords: [],
    activeGoals: [],
    recentEvents: [],
    knowledgeAvailable: false,
    userProfile: {
      userId: "wxid_user1",
      gender: "male",
      age: 25,
      weightKg: 70,
      heightCm: 175,
      activityLevel: "moderate",
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

function makeDietRepo() {
  const records: Record<string, unknown>[] = [];
  return {
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      const record = {
        id: "d-" + (records.length + 1),
        userId: input.userId,
        foodName: input.foodName,
        quantity: input.quantity ?? 1,
        unit: input.unit ?? "份",
        meal: input.meal,
        calories: input.calories,
        confidence: input.confidence ?? "medium",
        kbSource: input.kbSource,
        kbMatchedName: input.kbMatchedName,
        rawText: input.rawText,
        recordDate: input.recordDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      records.push(record);
      return record;
    }),
    getByDate: vi.fn().mockResolvedValue([]),
    getDailySummary: vi.fn().mockResolvedValue({
      totalCalories: 0,
      byMeal: {},
      items: [],
    }),
    getRangeSummary: vi.fn().mockResolvedValue({
      totalCalories: 0,
      avgDaily: 0,
      recordCount: 0,
      byMeal: {},
    }),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByFoodName: vi.fn().mockResolvedValue(0),
    deleteByMeal: vi.fn().mockResolvedValue(0),
    deleteLatest: vi.fn().mockResolvedValue(undefined),
    _records: records,
  } as unknown as DietRepository & { _records: Record<string, unknown>[] };
}

function makeExerciseRepo() {
  return {
    create: vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      return {
        id: "e-1",
        userId: input.userId,
        exerciseName: input.exerciseName,
        durationMin: input.durationMin,
        distanceKm: input.distanceKm,
        intensity: input.intensity,
        calories: input.calories,
        confidence: input.confidence ?? "medium",
        kbSource: input.kbSource,
        kbMatchedName: input.kbMatchedName,
        rawText: input.rawText,
        recordDate: input.recordDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),
    getByDate: vi.fn().mockResolvedValue([]),
    getDailySummary: vi.fn().mockResolvedValue({
      totalCalories: 0,
      items: [],
    }),
    getRangeSummary: vi.fn().mockResolvedValue({
      totalCalories: 0,
      avgDaily: 0,
      recordCount: 0,
      byExercise: {},
    }),
    update: vi.fn(),
    delete: vi.fn(),
    deleteByExerciseName: vi.fn().mockResolvedValue(0),
    deleteLatest: vi.fn().mockResolvedValue(undefined),
  } as unknown as ExerciseRepository;
}

function makeGoalRepo() {
  return {
    set: vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
      return {
        id: "g-1",
        userId: input.userId,
        goalType: input.goalType,
        targetValue: input.targetValue,
        unit: input.unit,
        period: input.period ?? "daily",
        active: true,
        createdAt: new Date().toISOString(),
      };
    }),
    getActive: vi.fn().mockResolvedValue([]),
    getActiveByType: vi.fn(),
    deactivate: vi.fn(),
  } as unknown as GoalRepository;
}

function makeProfileRepo() {
  return {
    get: vi.fn().mockResolvedValue({
      userId: "wxid_user1",
      gender: "male",
      age: 25,
      weightKg: 70,
      heightCm: 175,
      activityLevel: "moderate",
      updatedAt: new Date().toISOString(),
    }),
    upsert: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      userId: input.userId,
      gender: input.gender,
      age: input.age,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      activityLevel: input.activityLevel,
      targetWeightKg: input.targetWeightKg,
      updatedAt: new Date().toISOString(),
    })),
  } as unknown as UserProfileRepository;
}

function makeReportGenerator() {
  return {
    generate: vi.fn().mockResolvedValue({
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      totalIntake: 500,
      totalBurn: 300,
      netCalories: 200,
      avgDailyIntake: 500,
      avgDailyBurn: 300,
      recordCount: 2,
      dietBreakdown: [],
      exerciseBreakdown: [],
      insights: [],
      advice: [],
    }),
    invalidate: vi.fn(),
  } as unknown as ReportGenerator;
}

describe("createHealthPipeline", () => {
  let dietRepo: ReturnType<typeof makeDietRepo>;
  let exerciseRepo: ReturnType<typeof makeExerciseRepo>;
  let goalRepo: ReturnType<typeof makeGoalRepo>;
  let profileRepo: ReturnType<typeof makeProfileRepo>;

  beforeEach(() => {
    dietRepo = makeDietRepo();
    exerciseRepo = makeExerciseRepo();
    goalRepo = makeGoalRepo();
    profileRepo = makeProfileRepo();
  });

  it("records diet, resolving calories from the knowledge base", async () => {
    const knowledgeResult: KnowledgeResult = { confidence: "high", calories: 95, matchedName: "苹果" };
    const provider = makeProvider(
      toolCall("health.record_diet", { foodName: "苹果", quantity: 1, unit: "个", meal: "breakfast" }),
      finalReply("✅ 已记录饮食：苹果，95 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(knowledgeResult),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "吃了一个苹果", makeContext());

    expect(dietRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ foodName: "苹果", calories: 95, confidence: "high", meal: "breakfast" }),
    );
    expect(reply).toContain("✅ 已记录饮食");
    expect(reply).toContain("苹果");
    expect(reply).toContain("95 kcal");
  });

  it("calculates recorded calorie intake deterministically", async () => {
    (dietRepo.getDailySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCalories: 680,
      byMeal: { breakfast: 280, lunch: 400 },
      items: [],
    });
    const provider = makeProvider(
      toolCall("health.calculate_intake", { date: "2026-08-14" }),
      finalReply("今日摄入 680 kcal。"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    await expect(pipeline.handleMessage("wxid_user1", "今天摄入多少", makeContext())).resolves.toContain("680 kcal");
    expect(dietRepo.getDailySummary).toHaveBeenCalledWith("wxid_user1", "2026-08-14");
  });

  it("calculates recorded calorie expenditure deterministically", async () => {
    (exerciseRepo.getDailySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCalories: 350,
      items: [],
    });
    const requests: ChatInput[] = [];
    let requestIndex = 0;
    const provider: AgentProvider = {
      plan: async () => ({ reply: "", actions: [] }),
      chat: async (input) => {
        requests.push(structuredClone(input));
        return requestIndex++ === 0
          ? toolCall("health.calculate_expenditure", { date: "2026-08-14" })
          : finalReply("今日消耗 2024 kcal。");
      },
    };

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    await expect(pipeline.handleMessage("wxid_user1", "今天消耗多少", makeContext())).resolves.toContain("2024 kcal");
    expect(exerciseRepo.getDailySummary).toHaveBeenCalledWith("wxid_user1", "2026-08-14");
    const toolOutput = requests[1]?.messages.find((message) => message.role === "tool")?.content;
    expect(JSON.parse(toolOutput ?? "{}")).toMatchObject({
      exerciseCalories: 350,
      basalCalories: 1674,
      expenditureCalories: 2024,
    });
  });

  it("passes a food image to the model and records its estimated calories", async () => {
    const imageUrl = "data:image/jpeg;base64,aW1hZ2U=";
    const requests: ChatInput[] = [];
    let requestIndex = 0;
    const provider: AgentProvider = {
      plan: async () => ({ reply: "", actions: [] }),
      chat: async (input) => {
        requests.push(structuredClone(input));
        return requestIndex++ === 0
          ? toolCall("health.record_diet", {
            foodName: "牛肉面",
            quantity: 1,
            unit: "碗",
            meal: "lunch",
            calories: 620,
          })
          : finalReply("已按图片估算并记录牛肉面 620 kcal。");
      },
    };
    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    await expect(
      pipeline.handleMessage("wxid_user1", "", makeContext(), [imageUrl]),
    ).resolves.toContain("620 kcal");

    expect(requests[0]?.messages[0]).toEqual({ role: "user", content: "", imageUrls: [imageUrl] });
    expect(dietRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      foodName: "牛肉面",
      calories: 620,
      confidence: "low",
    }));
  });

  it("sends persisted history and saves the final reply after a tool call", async () => {
    const requests: ChatInput[] = [];
    const provider: AgentProvider = {
      plan: async () => ({ reply: "", actions: [] }),
      chat: async (input) => {
        requests.push(structuredClone(input));
        return requests.length === 1
          ? toolCall("health.get_profile", {})
          : finalReply("当然，刚才我们在讨论早餐。");
      },
    };
    const conversationRepository = {
      append: vi.fn(),
      listRecentByUserId: vi.fn().mockResolvedValue([
        { role: "user", content: "我早餐吃了一个苹果" },
        { role: "assistant", content: "已记录一个苹果。" },
      ]),
    };

    const pipeline = createHealthPipeline({
      provider,
      dietRepo, exerciseRepo, goalRepo, profileRepo,
      conversationRepository,
      contextWindowTokens: 256000,
    } as unknown as Parameters<typeof createHealthPipeline>[0]);

    await pipeline.handleMessage("wxid_user1", "刚才说的是什么？", makeContext());

    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages).toEqual([
      { role: "user", content: "我早餐吃了一个苹果" },
      { role: "assistant", content: "已记录一个苹果。" },
      { role: "user", content: "刚才说的是什么？", imageUrls: undefined },
    ]);
    expect(conversationRepository.append).toHaveBeenCalledWith({
      userId: "wxid_user1",
      role: "user",
      content: "刚才说的是什么？",
    });
    expect(conversationRepository.append).toHaveBeenCalledWith({
      userId: "wxid_user1",
      role: "assistant",
      content: "当然，刚才我们在讨论早餐。",
    });
  });

  it("records exercise, calculating calories from MET", async () => {
    const knowledgeResult: KnowledgeResult = { confidence: "medium", met: 7.0, matchedName: "游泳-自由泳" };
    const provider = makeProvider(
      toolCall("health.record_exercise", { exerciseName: "游泳", durationMin: 30, intensity: "medium" }),
      finalReply("✅ 已记录运动：游泳，245 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(undefined, knowledgeResult),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "游了30分钟泳", makeContext());

    // MET 7.0 × 70kg × 0.5h = 245 kcal
    expect(exerciseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseName: "游泳", calories: 245, confidence: "medium" }),
    );
    expect(reply).toContain("245 kcal");
  });

  it("blocks recording when the user profile is not set", async () => {
    (profileRepo.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const provider = makeProvider(
      toolCall("health.record_diet", { foodName: "苹果" }),
      finalReply("请先设置身体信息，我才能为你计算热量。"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "吃了一个苹果", makeContext());

    expect(dietRepo.create).not.toHaveBeenCalled();
    expect(reply).toContain("请先设置");
  });

  it("sets a goal", async () => {
    const provider = makeProvider(
      toolCall("health.set_goal", { goalType: "calorie_intake", targetValue: 2000 }),
      finalReply("✅ 已设置目标：每天摄入 2000 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "设置每天摄入2000千卡", makeContext());

    expect(goalRepo.set).toHaveBeenCalledWith(
      expect.objectContaining({ goalType: "calorie_intake", targetValue: 2000, unit: "kcal" }),
    );
    expect(reply).toContain("2000 kcal");
  });

  it("queries history with records", async () => {
    (dietRepo.getByDate as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "d1",
        userId: "wxid_user1",
        foodName: "面包",
        quantity: 1,
        unit: "个",
        meal: "breakfast",
        calories: 200,
        confidence: "medium",
        rawText: "面包",
        recordDate: "2026-08-08",
        createdAt: "2026-08-08T00:00:00Z",
        updatedAt: "2026-08-08T00:00:00Z",
      },
    ]);
    (exerciseRepo.getByDate as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const provider = makeProvider(
      toolCall("health.query_history", { date: "2026-08-08" }),
      finalReply("📅 2026-08-08 记录：面包（早餐），200 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "昨天吃了什么", makeContext());

    expect(dietRepo.getByDate).toHaveBeenCalledWith("wxid_user1", "2026-08-08");
    expect(reply).toContain("面包");
    expect(reply).toContain("早餐");
  });

  it("queries history with no records", async () => {
    const provider = makeProvider(
      toolCall("health.query_history", { date: "2026-08-08" }),
      finalReply("2026-08-08 没有记录"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "昨天吃了什么", makeContext());

    expect(reply).toContain("没有记录");
  });

  it("corrects a diet record quantity and recalculates calories", async () => {
    const existingRecord = {
      id: "d-existing",
      userId: "wxid_user1",
      foodName: "包子",
      quantity: 2,
      unit: "个",
      meal: "breakfast",
      calories: 220,
      confidence: "high",
      kbMatchedName: "猪肉包子",
      rawText: "吃了两个包子",
      recordDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (dietRepo.getByDate as ReturnType<typeof vi.fn>).mockResolvedValue([existingRecord]);
    (dietRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRecord, quantity: 1, calories: 110 });
    (dietRepo.getDailySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCalories: 110,
      byMeal: { breakfast: 110 },
      items: [],
    });

    const provider = makeProvider(
      toolCall("health.correct_record", { foodName: "包子", quantity: 1 }),
      finalReply("✅ 已修正：包子 × 1，110 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "刚才那个包子其实只吃了一个", makeContext());

    expect(dietRepo.update).toHaveBeenCalledWith("d-existing", expect.objectContaining({ quantity: 1, calories: 110 }));
    expect(reply).toContain("110 kcal");
  });

  it("corrects an exercise record duration and recalculates calories", async () => {
    const existingRecord = {
      id: "e-existing",
      userId: "wxid_user1",
      exerciseName: "跑步",
      durationMin: 40,
      calories: 400,
      confidence: "medium",
      rawText: "跑了40分钟",
      recordDate: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    (exerciseRepo.getByDate as ReturnType<typeof vi.fn>).mockResolvedValue([existingRecord]);
    (exerciseRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRecord, durationMin: 20, calories: 200 });
    (exerciseRepo.getDailySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCalories: 200,
      items: [],
    });

    const provider = makeProvider(
      toolCall("health.correct_record", { exerciseName: "跑步", durationMin: 20 }),
      finalReply("✅ 已修正：跑步 × 20 min，200 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "刚才跑步只跑了20分钟", makeContext());

    expect(exerciseRepo.update).toHaveBeenCalledWith("e-existing", expect.objectContaining({ durationMin: 20, calories: 200 }));
    expect(reply).toContain("200 kcal");
  });

  it("reports when no matching record is found for correction", async () => {
    const provider = makeProvider(
      toolCall("health.correct_record", { foodName: "不存在的食物", quantity: 1 }),
      finalReply("未找到匹配的记录"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "修正一下", makeContext());

    expect(reply).toContain("未找到");
  });

  it("deletes a diet record by food name", async () => {
    (dietRepo.deleteByFoodName as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (dietRepo.getDailySummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCalories: 0,
      byMeal: {},
      items: [],
    });

    const provider = makeProvider(
      toolCall("health.delete_record", { target: "diet", foodName: "包子" }),
      finalReply("✅ 已删除饮食记录：包子"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "把包子删了", makeContext());

    expect(dietRepo.deleteByFoodName).toHaveBeenCalledWith("wxid_user1", expect.any(String), "包子");
    expect(reply).toContain("已删除");
  });

  it("generates a report", async () => {
    const reportGenerator = makeReportGenerator();
    const provider = makeProvider(
      toolCall("health.generate_report", { period: "daily" }),
      finalReply("今日摄入 500 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo, reportGenerator,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "看看今天的报告", makeContext());

    expect(reportGenerator.generate).toHaveBeenCalledWith("wxid_user1", "daily", undefined);
    expect(reply).toContain("500");
  });

  it("returns advice from the knowledge base", async () => {
    const adviceResult: KnowledgeResult = { confidence: "medium", advice: ["多吃蔬菜", "减少糖分摄入"] };
    const knowledgeService = makeMockKnowledgeService(undefined, undefined, adviceResult);
    const provider = makeProvider(
      toolCall("health.get_advice", { topic: "减肥饮食" }),
      finalReply("💡 建议：多吃蔬菜，减少糖分摄入"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService,
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "减肥建议", makeContext());

    expect(knowledgeService.getAdvice).toHaveBeenCalled();
    expect(reply).toContain("建议");
  });

  it("sets the user profile", async () => {
    const provider = makeProvider(
      toolCall("health.set_profile", { gender: "male", age: 25, weightKg: 75, heightCm: 180 }),
      finalReply("已记录你的身体信息：男，25岁，75kg，180cm"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "男，25岁，75公斤，180cm", makeContext());

    expect(profileRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ gender: "male", age: 25, weightKg: 75, heightCm: 180 }),
    );
    expect(reply).toContain("身体信息");
  });

  it("looks up a food's calories via the knowledge base", async () => {
    const knowledgeResult: KnowledgeResult = { confidence: "medium", calories: 250, matchedName: "汉堡" };
    const knowledgeService = makeMockKnowledgeService(knowledgeResult);
    const provider = makeProvider(
      toolCall("health.lookup_food", { foodName: "汉堡" }),
      finalReply("汉堡大约 250 kcal"),
    );

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService,
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    const reply = await pipeline.handleMessage("wxid_user1", "汉堡热量多少", makeContext());

    expect(knowledgeService.lookupFood).toHaveBeenCalledWith("汉堡", undefined, undefined);
    expect(reply).toContain("250");
  });

  it("rejects a direct reply that does not call a tool", async () => {
    const provider = makeProvider(finalReply("你好！我是健康助手。"));

    const pipeline = createHealthPipeline({
      provider,
      knowledgeService: makeMockKnowledgeService(),
      dietRepo, exerciseRepo, goalRepo, profileRepo,
    });

    await expect(pipeline.handleMessage("wxid_user1", "你好", makeContext())).rejects.toThrow(
      "LLM must call at least one tool before sending a final reply",
    );
  });
});

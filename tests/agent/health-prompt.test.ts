import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/health-prompt.js";
import type { AgentContext, DietRecord, ExerciseRecord, UserGoal } from "../../src/health/types.js";

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    todayDietRecords: [],
    todayExerciseRecords: [],
    activeGoals: [],
    recentEvents: [],
    knowledgeAvailable: false,
    ...overrides,
  };
}

describe("buildSystemPrompt", () => {
  it("includes the base health tracking instructions", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("健康追踪助手");
    expect(prompt).toContain("health.record_diet");
    expect(prompt).toContain("health.record_exercise");
    expect(prompt).toContain("health.generate_report");
    expect(prompt).toContain("调用工具");
  });

  it("includes today's diet records in context", () => {
    const dietRecord: DietRecord = {
      id: "d1",
      userId: "wxid_user1",
      foodName: "面包",
      quantity: 1,
      unit: "个",
      meal: "breakfast",
      calories: 200,
      confidence: "high",
      rawText: "面包",
      recordDate: "2026-08-09",
      createdAt: "2026-08-09T00:00:00Z",
      updatedAt: "2026-08-09T00:00:00Z",
    };

    const prompt = buildSystemPrompt(makeContext({ todayDietRecords: [dietRecord] }));
    expect(prompt).toContain("今日已记录饮食");
    expect(prompt).toContain("面包");
    expect(prompt).toContain("200 kcal");
  });

  it("shows no records message when diet is empty", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("今日尚未记录饮食");
  });

  it("includes today's exercise records in context", () => {
    const exerciseRecord: ExerciseRecord = {
      id: "e1",
      userId: "wxid_user1",
      exerciseName: "跑步",
      durationMin: 30,
      calories: 300,
      confidence: "high",
      rawText: "跑步",
      recordDate: "2026-08-09",
      createdAt: "2026-08-09T00:00:00Z",
      updatedAt: "2026-08-09T00:00:00Z",
    };

    const prompt = buildSystemPrompt(makeContext({ todayExerciseRecords: [exerciseRecord] }));
    expect(prompt).toContain("今日已记录运动");
    expect(prompt).toContain("跑步");
    expect(prompt).toContain("300 kcal");
  });

  it("includes active goals in context", () => {
    const goal: UserGoal = {
      id: "g1",
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
      period: "daily",
      active: true,
      createdAt: "2026-08-09T00:00:00Z",
    };

    const prompt = buildSystemPrompt(makeContext({ activeGoals: [goal] }));
    expect(prompt).toContain("当前目标");
    expect(prompt).toContain("calorie_intake");
    expect(prompt).toContain("2000 kcal");
  });

  it("shows knowledge base availability", () => {
    const available = buildSystemPrompt(makeContext({ knowledgeAvailable: true }));
    expect(available).toContain("知识库状态：可用");

    const unavailable = buildSystemPrompt(makeContext({ knowledgeAvailable: false }));
    expect(unavailable).toContain("不可用");
  });

  it("requires recording a recognized food image through the diet tool", () => {
    const prompt = buildSystemPrompt(makeContext(), ["data:image/jpeg;base64,aW1hZ2U="]);

    expect(prompt).toContain("必须调用 health.record_diet");
  });

  it("includes recent events", () => {
    const prompt = buildSystemPrompt({
      todayDietRecords: [],
      todayExerciseRecords: [],
      activeGoals: [],
      recentEvents: [
        { kind: "message.received", summary: "用户问好" },
        { kind: "message.replied", summary: "回复了健康建议" },
      ],
      knowledgeAvailable: false,
    });

    expect(prompt).toContain("最近对话");
    expect(prompt).toContain("用户问好");
    expect(prompt).toContain("回复了健康建议");
  });
});

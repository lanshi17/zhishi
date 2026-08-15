import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { ExerciseRepository } from "../../src/store/repositories/exercise.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("ExerciseRepository", () => {
  let pool: DbPool;
  let repo: ExerciseRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repo = new ExerciseRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an exercise record and retrieves it by date", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      durationMin: 30,
      intensity: "high",
      calories: 300,
      confidence: "high",
      rawText: "跑了30分钟步",
      recordDate: "2026-08-09",
    });

    expect(record.id).toBeTruthy();
    expect(record.exerciseName).toBe("跑步");
    expect(record.calories).toBe(300);
    expect(record.durationMin).toBe(30);

    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(record.id);
  });

  it("returns records in insertion order", async () => {
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "游泳",
      calories: 500,
      rawText: "游泳",
      recordDate: "2026-08-09",
    });

    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(2);
    expect(items[0].exerciseName).toBe("跑步");
    expect(items[1].exerciseName).toBe("游泳");
  });

  it("computes daily summary", async () => {
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "俯卧撑",
      calories: 100,
      rawText: "俯卧撑",
      recordDate: "2026-08-09",
    });

    const summary = await repo.getDailySummary("wxid_user1", "2026-08-09");
    expect(summary.totalCalories).toBe(400);
    expect(summary.items).toHaveLength(2);
  });

  it("computes range summary with average and breakdown", async () => {
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-08",
    });
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 400,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      exerciseName: "游泳",
      calories: 500,
      rawText: "游泳",
      recordDate: "2026-08-09",
    });

    const summary = await repo.getRangeSummary("wxid_user1", "2026-08-08", "2026-08-09");
    expect(summary.totalCalories).toBe(1200);
    expect(summary.avgDaily).toBe(600);
    expect(summary.recordCount).toBe(3);
    expect(summary.byExercise["跑步"]).toBe(700);
    expect(summary.byExercise["游泳"]).toBe(500);
  });

  it("updates an exercise record", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });

    const updated = await repo.update(record.id, { calories: 350, durationMin: 35 });
    expect(updated?.calories).toBe(350);
    expect(updated?.durationMin).toBe(35);
  });

  it("deletes an exercise record", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });

    await repo.delete(record.id);
    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(0);
  });

  it("handles optional fields being null", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      exerciseName: "散步",
      calories: 80,
      rawText: "散步",
      recordDate: "2026-08-09",
    });

    expect(record.durationMin).toBeUndefined();
    expect(record.distanceKm).toBeUndefined();
    expect(record.intensity).toBeUndefined();
    expect(record.confidence).toBe("medium");
  });
});

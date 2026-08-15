import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { DietRepository } from "../../src/store/repositories/diet.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("DietRepository", () => {
  let pool: DbPool;
  let repo: DietRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repo = new DietRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a diet record and retrieves it by date", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      foodName: "苹果",
      quantity: 1,
      unit: "个",
      meal: "breakfast",
      calories: 95,
      confidence: "high",
      rawText: "吃了一个苹果",
      recordDate: "2026-08-09",
    });

    expect(record.id).toBeTruthy();
    expect(record.foodName).toBe("苹果");
    expect(record.calories).toBe(95);
    expect(record.createdAt).toBeTruthy();

    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(record.id);
  });

  it("returns records in insertion order", async () => {
    await repo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "吃了面包",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      foodName: "牛奶",
      meal: "breakfast",
      calories: 150,
      rawText: "喝了牛奶",
      recordDate: "2026-08-09",
    });

    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(2);
    expect(items[0].foodName).toBe("面包");
    expect(items[1].foodName).toBe("牛奶");
  });

  it("computes daily summary grouped by meal", async () => {
    await repo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      foodName: "牛奶",
      meal: "breakfast",
      calories: 150,
      rawText: "牛奶",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 300,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });

    const summary = await repo.getDailySummary("wxid_user1", "2026-08-09");
    expect(summary.totalCalories).toBe(650);
    expect(summary.byMeal.breakfast).toBe(350);
    expect(summary.byMeal.lunch).toBe(300);
    expect(summary.items).toHaveLength(3);
  });

  it("computes range summary with average", async () => {
    await repo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 500,
      rawText: "面包",
      recordDate: "2026-08-08",
    });
    await repo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 700,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });

    const summary = await repo.getRangeSummary("wxid_user1", "2026-08-08", "2026-08-09");
    expect(summary.totalCalories).toBe(1200);
    expect(summary.avgDaily).toBe(600);
    expect(summary.recordCount).toBe(2);
  });

  it("updates a diet record", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      foodName: "苹果",
      meal: "snack",
      calories: 95,
      rawText: "苹果",
      recordDate: "2026-08-09",
    });

    const updated = await repo.update(record.id, { calories: 100, foodName: "大苹果" });
    expect(updated?.calories).toBe(100);
    expect(updated?.foodName).toBe("大苹果");
  });

  it("deletes a diet record", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      foodName: "苹果",
      meal: "snack",
      calories: 95,
      rawText: "苹果",
      recordDate: "2026-08-09",
    });

    await repo.delete(record.id);
    const items = await repo.getByDate("wxid_user1", "2026-08-09");
    expect(items).toHaveLength(0);
  });

  it("isolates data between users", async () => {
    await repo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-09",
    });
    await repo.create({
      userId: "wxid_user2",
      foodName: "米饭",
      meal: "lunch",
      calories: 300,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });

    const user1Items = await repo.getByDate("wxid_user1", "2026-08-09");
    const user2Items = await repo.getByDate("wxid_user2", "2026-08-09");
    expect(user1Items).toHaveLength(1);
    expect(user2Items).toHaveLength(1);
    expect(user1Items[0].foodName).toBe("面包");
    expect(user2Items[0].foodName).toBe("米饭");
  });

  it("applies default values for optional fields", async () => {
    const record = await repo.create({
      userId: "wxid_user1",
      foodName: "苹果",
      meal: "snack",
      calories: 95,
      rawText: "苹果",
      recordDate: "2026-08-09",
    });

    expect(record.quantity).toBe(1);
    expect(record.unit).toBe("份");
    expect(record.confidence).toBe("medium");
  });
});

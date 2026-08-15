import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { GoalRepository } from "../../src/store/repositories/goals.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("GoalRepository", () => {
  let pool: DbPool;
  let repo: GoalRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repo = new GoalRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("sets a goal and retrieves active goals", async () => {
    const goal = await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });

    expect(goal.id).toBeTruthy();
    expect(goal.goalType).toBe("calorie_intake");
    expect(goal.targetValue).toBe(2000);
    expect(goal.unit).toBe("kcal");
    expect(goal.period).toBe("daily");
    expect(goal.active).toBe(true);

    const active = await repo.getActive("wxid_user1");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(goal.id);
  });

  it("deactivates previous goal of same type and period when setting new one", async () => {
    const first = await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });
    const second = await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 1800,
      unit: "kcal",
    });

    const active = await repo.getActive("wxid_user1");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.id);
    expect(active[0].targetValue).toBe(1800);
  });

  it("allows different goal types to coexist", async () => {
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_burn",
      targetValue: 500,
      unit: "kcal",
    });

    const active = await repo.getActive("wxid_user1");
    expect(active).toHaveLength(2);
  });

  it("allows same goal type with different periods", async () => {
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
      period: "daily",
    });
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 14000,
      unit: "kcal",
      period: "weekly",
    });

    const active = await repo.getActive("wxid_user1");
    expect(active).toHaveLength(2);
  });

  it("gets active goal by type", async () => {
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_burn",
      targetValue: 500,
      unit: "kcal",
    });

    const intake = await repo.getActiveByType("wxid_user1", "calorie_intake");
    expect(intake?.targetValue).toBe(2000);

    const burn = await repo.getActiveByType("wxid_user1", "calorie_burn");
    expect(burn?.targetValue).toBe(500);
  });

  it("deactivates a goal by id", async () => {
    const goal = await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });

    await repo.deactivate(goal.id);

    const active = await repo.getActive("wxid_user1");
    expect(active).toHaveLength(0);
  });

  it("isolates goals between users", async () => {
    await repo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });
    await repo.set({
      userId: "wxid_user2",
      goalType: "calorie_intake",
      targetValue: 1500,
      unit: "kcal",
    });

    const user1 = await repo.getActive("wxid_user1");
    const user2 = await repo.getActive("wxid_user2");
    expect(user1).toHaveLength(1);
    expect(user2).toHaveLength(1);
    expect(user1[0].targetValue).toBe(2000);
    expect(user2[0].targetValue).toBe(1500);
  });
});

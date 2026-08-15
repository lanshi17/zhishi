import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { ReportRepository } from "../../src/store/repositories/reports.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("ReportRepository", () => {
  let pool: DbPool;
  let repo: ReportRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repo = new ReportRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("saves a report snapshot and retrieves it", async () => {
    const summary = { totalIntake: 2000, totalBurn: 500, netCalories: 1500 };
    const snapshot = await repo.save({
      userId: "wxid_user1",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: summary,
    });

    expect(snapshot.id).toBeTruthy();
    expect(snapshot.periodType).toBe("daily");
    expect(snapshot.periodStart).toBe("2026-08-09");
    expect(snapshot.createdAt).toBeTruthy();

    const retrieved = await repo.get("wxid_user1", "daily", "2026-08-09");
    expect(retrieved?.id).toBe(snapshot.id);
    expect(retrieved?.summaryJson).toEqual(summary);
  });

  it("returns undefined for non-existent snapshot", async () => {
    const result = await repo.get("wxid_user1", "daily", "2026-08-09");
    expect(result).toBeUndefined();
  });

  it("invalidates a report snapshot", async () => {
    await repo.save({
      userId: "wxid_user1",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: { total: 2000 },
    });

    await repo.invalidate("wxid_user1", "daily", "2026-08-09");

    const result = await repo.get("wxid_user1", "daily", "2026-08-09");
    expect(result).toBeUndefined();
  });

  it("handles different period types", async () => {
    await repo.save({
      userId: "wxid_user1",
      periodType: "weekly",
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      summaryJson: { weekly: true },
    });

    const weekly = await repo.get("wxid_user1", "weekly", "2026-08-03");
    expect(weekly?.summaryJson).toEqual({ weekly: true });

    const daily = await repo.get("wxid_user1", "daily", "2026-08-09");
    expect(daily).toBeUndefined();
  });

  it("returns the latest snapshot when multiple exist for the same period", async () => {
    await repo.save({
      userId: "wxid_user1",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: { version: 1 },
    });
    // Small delay to ensure different created_at timestamps
    await new Promise((r) => setTimeout(r, 50));
    await repo.save({
      userId: "wxid_user1",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: { version: 2 },
    });

    const result = await repo.get("wxid_user1", "daily", "2026-08-09");
    expect(result?.summaryJson).toEqual({ version: 2 });
  });

  it("isolates snapshots between users", async () => {
    await repo.save({
      userId: "wxid_user1",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: { user: 1 },
    });
    await repo.save({
      userId: "wxid_user2",
      periodType: "daily",
      periodStart: "2026-08-09",
      periodEnd: "2026-08-09",
      summaryJson: { user: 2 },
    });

    const user1 = await repo.get("wxid_user1", "daily", "2026-08-09");
    const user2 = await repo.get("wxid_user2", "daily", "2026-08-09");
    expect(user1?.summaryJson).toEqual({ user: 1 });
    expect(user2?.summaryJson).toEqual({ user: 2 });
  });
});

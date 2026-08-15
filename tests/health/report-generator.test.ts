import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { DietRepository } from "../../src/store/repositories/diet.js";
import { ExerciseRepository } from "../../src/store/repositories/exercise.js";
import { GoalRepository } from "../../src/store/repositories/goals.js";
import { ReportRepository } from "../../src/store/repositories/reports.js";
import { UserProfileRepository } from "../../src/store/repositories/profiles.js";
import { createReportGenerator, getPeriodRange } from "../../src/health/report-generator.js";
import { TEST_DATABASE_URL, cleanTables } from "../helpers/pg.js";

describe("getPeriodRange", () => {
  it("returns today for daily period", () => {
    const range = getPeriodRange("daily", "2026-08-09");
    expect(range.start).toBe("2026-08-09");
    expect(range.end).toBe("2026-08-09");
  });

  it("returns Monday to Sunday for weekly period", () => {
    // 2026-08-09 is a Sunday
    const range = getPeriodRange("weekly", "2026-08-09");
    expect(range.start).toBe("2026-08-03"); // Monday
    expect(range.end).toBe("2026-08-09"); // Sunday
  });

  it("returns first to last day for monthly period", () => {
    const range = getPeriodRange("monthly", "2026-08-15");
    expect(range.start).toBe("2026-08-01");
    expect(range.end).toBe("2026-08-31");
  });

  it("returns quarter range for quarterly period", () => {
    const range = getPeriodRange("quarterly", "2026-08-15");
    // Aug is in Q3 (Jul-Sep)
    expect(range.start).toBe("2026-07-01");
    expect(range.end).toBe("2026-09-30");
  });

  it("returns full year for yearly period", () => {
    const range = getPeriodRange("yearly", "2026-08-15");
    expect(range.start).toBe("2026-01-01");
    expect(range.end).toBe("2026-12-31");
  });

  it("handles February in non-leap year", () => {
    const range = getPeriodRange("monthly", "2025-02-15");
    expect(range.start).toBe("2025-02-01");
    expect(range.end).toBe("2025-02-28");
  });
});

describe("createReportGenerator (DB integration)", () => {
  let pool: DbPool;
  let dietRepo: DietRepository;
  let exerciseRepo: ExerciseRepository;
  let goalRepo: GoalRepository;
  let reportRepo: ReportRepository;
  let profileRepo: UserProfileRepository;
  let generator: ReturnType<typeof createReportGenerator>;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    dietRepo = new DietRepository(pool);
    exerciseRepo = new ExerciseRepository(pool);
    goalRepo = new GoalRepository(pool);
    reportRepo = new ReportRepository(pool);
    profileRepo = new UserProfileRepository(pool);
    generator = createReportGenerator({
      dietRepo,
      exerciseRepo,
      goalRepo,
      reportRepo,
      profileRepo,
    } as Parameters<typeof createReportGenerator>[0]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("generates a daily report with diet and exercise data", async () => {
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-09",
    });
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 300,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });
    await exerciseRepo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      durationMin: 30,
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });

    const report = await generator.generate("wxid_user1", "daily", "2026-08-09");

    expect(report.periodType).toBe("daily");
    expect(report.totalIntake).toBe(500);
    expect(report.totalBurn).toBe(300);
    expect(report.netCalories).toBe(200);
    expect(report.recordCount).toBe(3);
    expect(report.dietBreakdown).toHaveLength(2);
    expect(report.exerciseBreakdown).toHaveLength(1);
    expect(report.exerciseBreakdown[0].name).toBe("跑步");
  });

  it("includes basal metabolism in total expenditure when the profile is complete", async () => {
    await profileRepo.upsert({
      userId: "wxid_user1",
      gender: "male",
      age: 25,
      weightKg: 70,
      heightCm: 175,
    });
    await exerciseRepo.create({
      userId: "wxid_user1",
      exerciseName: "跑步",
      durationMin: 30,
      calories: 300,
      rawText: "跑步",
      recordDate: "2026-08-09",
    });

    const report = await generator.generate("wxid_user1", "daily", "2026-08-09");
    const expenditure = report as typeof report & {
      basalBurn?: number;
      exerciseBurn?: number;
    };

    expect(expenditure.basalBurn).toBe(1674);
    expect(expenditure.exerciseBurn).toBe(300);
    expect(report.totalBurn).toBe(1974);
    expect(report.netCalories).toBe(-1974);
  });

  it("generates a weekly report with averages and trend", async () => {
    // Create data for multiple days
    for (let i = 3; i <= 7; i++) {
      const date = `2026-08-0${i}`;
      await dietRepo.create({
        userId: "wxid_user1",
        foodName: "米饭",
        meal: "lunch",
        calories: 500 + i * 10,
        rawText: "米饭",
        recordDate: date,
      });
    }

    const report = await generator.generate("wxid_user1", "weekly", "2026-08-05");

    expect(report.periodType).toBe("weekly");
    expect(report.periodStart).toBe("2026-08-03");
    expect(report.periodEnd).toBe("2026-08-09");
    expect(report.totalIntake).toBeGreaterThan(0);
    expect(report.avgDailyIntake).toBeGreaterThan(0);
    expect(report.trend).toBeDefined();
  });

  it("saves and retrieves report snapshot for non-daily periods", async () => {
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-05",
    });

    // First call generates and saves snapshot
    const report1 = await generator.generate("wxid_user1", "weekly", "2026-08-05");
    expect(report1.totalIntake).toBe(200);

    // Add more data after snapshot was saved
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 500,
      rawText: "米饭",
      recordDate: "2026-08-06",
    });

    // Second call should return cached snapshot (not include new data)
    const report2 = await generator.generate("wxid_user1", "weekly", "2026-08-05");
    expect(report2.totalIntake).toBe(200); // Cached, not 700
  });

  it("always generates fresh daily reports (no caching)", async () => {
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-09",
    });

    const report1 = await generator.generate("wxid_user1", "daily", "2026-08-09");
    expect(report1.totalIntake).toBe(200);

    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 300,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });

    const report2 = await generator.generate("wxid_user1", "daily", "2026-08-09");
    expect(report2.totalIntake).toBe(500); // Fresh, not cached
  });

  it("includes goal progress in insights", async () => {
    await goalRepo.set({
      userId: "wxid_user1",
      goalType: "calorie_intake",
      targetValue: 2000,
      unit: "kcal",
    });

    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 1500,
      rawText: "米饭",
      recordDate: "2026-08-09",
    });

    const report = await generator.generate("wxid_user1", "daily", "2026-08-09");
    expect(report.insights.some((s) => s.includes("2000"))).toBe(true);
    expect(report.insights.some((s) => s.includes("75%"))).toBe(true);
  });

  it("handles empty data gracefully", async () => {
    const report = await generator.generate("wxid_user1", "daily", "2026-08-09");
    expect(report.totalIntake).toBe(0);
    expect(report.totalBurn).toBe(0);
    expect(report.netCalories).toBe(0);
    expect(report.dietBreakdown).toHaveLength(0);
    expect(report.exerciseBreakdown).toHaveLength(0);
  });

  it("invalidates cached snapshots", async () => {
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "面包",
      meal: "breakfast",
      calories: 200,
      rawText: "面包",
      recordDate: "2026-08-05",
    });

    // Generate and cache
    await generator.generate("wxid_user1", "weekly", "2026-08-05");

    // Invalidate
    await generator.invalidate("wxid_user1", "weekly", "2026-08-05");

    // Add more data
    await dietRepo.create({
      userId: "wxid_user1",
      foodName: "米饭",
      meal: "lunch",
      calories: 500,
      rawText: "米饭",
      recordDate: "2026-08-06",
    });

    // Should regenerate with fresh data
    const report = await generator.generate("wxid_user1", "weekly", "2026-08-05");
    expect(report.totalIntake).toBe(700);
  });
});

import { createTestPgPool, type DbPool } from "../../src/store/db.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wechat_claw_test";

export async function createHelperPool(): Promise<DbPool> {
  return createTestPgPool(TEST_DATABASE_URL);
}

export async function cleanTables(pool: DbPool): Promise<void> {
  await pool.query(
    "TRUNCATE conversation_messages, report_snapshots, user_goals, user_profiles, exercise_records, diet_records, task_events, approval_requests, threads RESTART IDENTITY CASCADE",
  );
}

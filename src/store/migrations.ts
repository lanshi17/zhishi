import type { DbPool } from "./db.js";

export type ThreadRecord = {
  id: string;
  sourceUserId: string;
  title: string;
};

export type ThreadEventRecord = {
  id: string;
  threadId: string;
  kind: string;
  summary: string;
};

const MIGRATION_LOCK_KEY = 20260809;

export async function applyMigrations(pool: DbPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        source_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);
    await client.query(
      `ALTER TABLE threads ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY`,
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);
    await client.query(
      `ALTER TABLE task_events ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY`,
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        status TEXT NOT NULL DEFAULT 'pending',
        action TEXT NOT NULL,
        reply TEXT NOT NULL,
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);
    await client.query(
      `ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY`,
    );

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_events_thread ON task_events(thread_id)`,
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conversation_messages_user_seq
        ON conversation_messages(user_id, seq)`,
    );

    // Health tracking tables (M2)

    await client.query(`
      CREATE TABLE IF NOT EXISTS diet_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        food_name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT '份',
        meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
        calories REAL NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
        kb_source TEXT,
        kb_matched_name TEXT,
        raw_text TEXT NOT NULL,
        record_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS exercise_records (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        exercise_name TEXT NOT NULL,
        duration_min REAL,
        distance_km REAL,
        intensity TEXT CHECK (intensity IN ('low', 'medium', 'high')),
        calories REAL NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
        kb_source TEXT,
        kb_matched_name TEXT,
        raw_text TEXT NOT NULL,
        record_date DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        seq BIGINT GENERATED ALWAYS AS IDENTITY
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_goals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        goal_type TEXT NOT NULL CHECK (goal_type IN ('calorie_intake', 'calorie_burn', 'weight')),
        target_value REAL NOT NULL,
        unit TEXT NOT NULL,
        period TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('daily', 'weekly', 'monthly')),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS report_snapshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        summary_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_diet_user_date ON diet_records(user_id, record_date)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_diet_user_meal ON diet_records(user_id, record_date, meal)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_exercise_user_date ON exercise_records(user_id, record_date)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_report_user_period ON report_snapshots(user_id, period_type, period_start)`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_goals_user_active ON user_goals(user_id) WHERE active = TRUE`,
    );

    // User profile table (personalized health metrics)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        gender TEXT CHECK (gender IN ('male', 'female')),
        age INTEGER,
        weight_kg REAL,
        height_cm REAL,
        activity_level TEXT CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
        target_weight_kg REAL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

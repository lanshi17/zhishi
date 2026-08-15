/**
 * Database initialization script.
 *
 * Creates the business database (if needed) and runs migrations
 * to set up all tables. Optionally seeds a default calorie goal.
 *
 * Usage:
 *   npx tsx scripts/init-db.ts
 *
 * Required env:
 *   DATABASE_URL - PostgreSQL connection string (e.g. postgresql://user:pass@localhost:5432/wechat_claw)
 *
 * Optional env:
 *   HEALTH_DEFAULT_CALORIE_GOAL - default daily intake goal (default: 2000)
 *   HEALTH_DEFAULT_BURN_GOAL    - default daily burn goal (default: 500)
 */
import { Pool } from "pg";
import { applyMigrations } from "../src/store/migrations.js";
import { GoalRepository } from "../src/store/repositories/goals.js";

function parseDatabaseUrl(url: string): { baseUrl: string; dbName: string } {
  // Split off the database name from the URL
  const match = url.match(/^(postgres(?:ql)?:\/\/.+\/)([^/]+)$/);
  if (!match) {
    throw new Error(`Cannot parse DATABASE_URL: ${url}`);
  }
  return { baseUrl: match[1], dbName: match[2] };
}

async function ensureDatabaseExists(adminUrl: string, dbName: string): Promise<void> {
  const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (result.rows.length > 0) {
      console.log(`Database "${dbName}" already exists.`);
      return;
    }

    console.log(`Creating database "${dbName}"...`);
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Database "${dbName}" created.`);
  } finally {
    await adminPool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const { baseUrl, dbName } = parseDatabaseUrl(databaseUrl);

  // Step 1: Ensure the database exists (connect to 'postgres' maintenance DB)
  const adminUrl = `${baseUrl}postgres`;
  await ensureDatabaseExists(adminUrl, dbName);

  // Step 2: Run migrations
  console.log("Connecting to business database...");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
  });

  try {
    console.log("Running migrations...");
    await applyMigrations(pool);
    console.log("Migrations complete.");

    // Step 3: Seed default goals if none exist
    const goalRepo = new GoalRepository(pool);
    const defaultUserId = process.env.ADMIN_USER_ID ?? "default";
    const existingGoals = await goalRepo.getActive(defaultUserId);

    if (existingGoals.length === 0) {
      const calorieGoal = Number(process.env.HEALTH_DEFAULT_CALORIE_GOAL ?? 2000);
      const burnGoal = Number(process.env.HEALTH_DEFAULT_BURN_GOAL ?? 500);

      console.log(`Seeding default goals: intake=${calorieGoal} kcal, burn=${burnGoal} kcal`);
      await goalRepo.set({
        userId: defaultUserId,
        goalType: "calorie_intake",
        targetValue: calorieGoal,
        unit: "kcal",
        period: "daily",
      });
      await goalRepo.set({
        userId: defaultUserId,
        goalType: "calorie_burn",
        targetValue: burnGoal,
        unit: "kcal",
        period: "daily",
      });
      console.log("Default goals seeded.");
    } else {
      console.log(`Found ${existingGoals.length} existing goals, skipping seed.`);
    }

    // Step 4: Verify tables
    const tableResult = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    console.log("\nTables in database:");
    for (const row of tableResult.rows) {
      console.log(`  - ${row.tablename}`);
    }

    console.log("\nDatabase initialization complete.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Database initialization failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

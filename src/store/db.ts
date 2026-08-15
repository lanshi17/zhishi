import { Pool } from "pg";
import { applyMigrations } from "./migrations.js";

export type DbPool = Pool;

export async function createPgPool(config: {
  databaseUrl: string;
  max?: number;
  idleTimeoutMs?: number;
}): Promise<DbPool> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
  });
  await applyMigrations(pool);
  return pool;
}

export async function createTestPgPool(databaseUrl: string): Promise<DbPool> {
  return createPgPool({ databaseUrl, max: 5 });
}

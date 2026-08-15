/**
 * Real E2E test: uses the real LLM (SiliconFlow Qwen) to process natural
 * language messages through the health pipeline against a real PG database.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/wechat_claw_test \
 *     npx tsx scripts/e2e-real-llm.ts
 *
 * Reads LLM config from .env automatically.
 */
import { createPgPool } from "../src/store/db.js";
import { DietRepository } from "../src/store/repositories/diet.js";
import { ExerciseRepository } from "../src/store/repositories/exercise.js";
import { GoalRepository } from "../src/store/repositories/goals.js";
import { ReportRepository } from "../src/store/repositories/reports.js";
import { createHealthPipeline } from "../src/agent/pipeline.js";
import { createReportGenerator } from "../src/health/report-generator.js";
import { createKnowledgeService } from "../src/health/knowledge.js";
import { createLightRagClient } from "../src/health/lightrag.js";
import { createOpenAiProvider } from "../src/agent/provider/openai.js";
import type { AgentContext } from "../src/health/types.js";

const USER_ID = "wxid_e2e_user";

const MESSAGES = [
  "今天早餐吃了两个包子加一碗豆浆",
  "中午吃了一碗牛肉面和一杯可乐",
  "下午去健身房练了1小时力量训练",
  "刚才那个包子其实只吃了一个",
  "设置每天摄入2000千卡的目标",
  "看看今天的报告",
  "我上周三吃了什么",
  "最近碳水吃太多了有什么建议",
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const content = fs.readFileSync(".env", "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!key) continue;
      env[key] = val;
    }
  } catch {
    // .env optional
  }
  return env;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Set TEST_DATABASE_URL or DATABASE_URL");
    process.exit(1);
  }

  const llmBaseUrl = env.LLM_BASE_URL;
  const llmModel = env.LLM_MODEL;
  const llmApiKey = env.LLM_API_KEY;
  if (!llmBaseUrl || !llmModel) {
    console.error("LLM_BASE_URL and LLM_MODEL are required in .env");
    process.exit(1);
  }

  console.log("=== Real LLM E2E Test ===");
  console.log(`LLM: ${llmModel} @ ${llmBaseUrl}`);
  console.log(`DB:  ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.log(`Date: ${todayStr()}\n`);

  const pool = await createPgPool({ databaseUrl, max: 5 });
  const dietRepo = new DietRepository(pool);
  const exerciseRepo = new ExerciseRepository(pool);
  const goalRepo = new GoalRepository(pool);
  const reportRepo = new ReportRepository(pool);

  const today = todayStr();
  await pool.query("DELETE FROM diet_records WHERE user_id = $1 AND record_date = $2", [USER_ID, today]);
  await pool.query("DELETE FROM exercise_records WHERE user_id = $1 AND record_date = $2", [USER_ID, today]);
  await pool.query("DELETE FROM user_goals WHERE user_id = $1", [USER_ID]);
  console.log("Cleared existing data\n");

  const lightragClient = createLightRagClient({
    apiUrl: env.LIGHTRAG_API_URL ?? "http://localhost:9621",
    timeoutMs: 1000,
  });
  const knowledgeService = createKnowledgeService(lightragClient);
  const reportGenerator = createReportGenerator({
    dietRepo, exerciseRepo, goalRepo, reportRepo, knowledgeService,
  });

  const provider = createOpenAiProvider({
    apiStyle: "openai-compatible",
    baseUrl: llmBaseUrl,
    model: llmModel,
    apiKey: llmApiKey,
    supportsImageInput: false,
  });

  const pipeline = createHealthPipeline({
    provider,
    knowledgeService,
    dietRepo,
    exerciseRepo,
    goalRepo,
    reportGenerator,
  });

  async function buildContext(): Promise<AgentContext> {
    const [todayDietRecords, todayExerciseRecords, activeGoals] = await Promise.all([
      dietRepo.getByDate(USER_ID, today),
      exerciseRepo.getByDate(USER_ID, today),
      goalRepo.getActive(USER_ID),
    ]);
    return {
      todayDietRecords,
      todayExerciseRecords,
      activeGoals,
      recentEvents: [],
      knowledgeAvailable: false,
    };
  }

  let passed = 0;
  let failed = 0;

  for (const msg of MESSAGES) {
    console.log("━".repeat(60));
    console.log(`📨 用户: ${msg}`);
    try {
      const context = await buildContext();
      const reply = await pipeline.handleMessage(USER_ID, msg, context);
      console.log(`\n   Agent:`);
      console.log(reply.split("\n").map((l) => `   ${l}`).join("\n"));
      passed++;
    } catch (err) {
      console.error(`   ❌ Error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
    console.log("");
  }

  // Final state
  console.log("━".repeat(60));
  console.log("📊 DB final state:");
  const dietRows = await pool.query(
    "SELECT food_name, quantity, unit, meal, calories, confidence FROM diet_records WHERE user_id = $1 AND record_date = $2 ORDER BY seq",
    [USER_ID, today],
  );
  console.log(`  Diet records: ${dietRows.rows.length}`);
  for (const r of dietRows.rows) {
    console.log(`    - ${r.food_name} × ${r.quantity}${r.unit} (${r.meal}) = ${r.calories} kcal [${r.confidence}]`);
  }
  const exRows = await pool.query(
    "SELECT exercise_name, duration_min, calories FROM exercise_records WHERE user_id = $1 AND record_date = $2 ORDER BY seq",
    [USER_ID, today],
  );
  console.log(`  Exercise records: ${exRows.rows.length}`);
  for (const r of exRows.rows) {
    console.log(`    - ${r.exercise_name} ${r.duration_min}min = ${r.calories} kcal`);
  }
  const goalRows = await pool.query(
    "SELECT goal_type, target_value, unit FROM user_goals WHERE user_id = $1 AND active = TRUE",
    [USER_ID],
  );
  console.log(`  Active goals: ${goalRows.rows.length}`);
  for (const r of goalRows.rows) {
    console.log(`    - ${r.goal_type}: ${r.target_value} ${r.unit}`);
  }

  await pool.end();

  console.log("\n" + "━".repeat(60));
  console.log(`\n🏁 Results: ${passed} passed, ${failed} failed out of ${MESSAGES.length}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});

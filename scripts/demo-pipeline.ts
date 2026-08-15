/**
 * Standalone demo of the health pipeline (no LLM, no LightRAG needed).
 *
 * Wires up the real PG repositories against the running test container,
 * plus a fake AgentProvider that returns canned responses, then walks
 * through 6 PRD scenarios end-to-end.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/wechat_claw_test \
 *     npx tsx scripts/demo-pipeline.ts
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
import type { AgentProvider, AgentPlan } from "../src/agent/provider/base.js";
import type { AgentPlanOutput, AgentContext } from "../src/health/types.js";

const USER_ID = "wxid_demo_user";

type Scenario = { label: string; canned: AgentPlanOutput };

const SCENARIOS: Scenario[] = [
  {
    label: "PRD 2.1 记录饮食（早餐）",
    canned: { intent: "record_diet", entities: { foodName: "包子", quantity: 2, unit: "个", meal: "breakfast", calories: 220 }, reply: "已记录" },
  },
  {
    label: "PRD 2.1 记录饮食（午餐）",
    canned: { intent: "record_diet", entities: { foodName: "牛肉面", quantity: 1, unit: "碗", meal: "lunch", calories: 280 }, reply: "已记录" },
  },
  {
    label: "PRD 2.2 记录运动",
    canned: { intent: "record_exercise", entities: { exerciseName: "力量训练", durationMin: 60, intensity: "medium", calories: 360 }, reply: "已记录" },
  },
  {
    label: "PRD 2.5 自然语言纠正（包子只吃了一个）",
    canned: { intent: "correct_record", entities: { foodName: "包子", quantity: 1 }, reply: "已修正" },
  },
  {
    label: "PRD 2.8 设置目标",
    canned: { intent: "set_goal", entities: { goalType: "calorie_intake", targetValue: 2000 }, reply: "已设置" },
  },
  {
    label: "PRD 2.3 查询今日报告",
    canned: { intent: "query_report", entities: { period: "daily" }, reply: "" },
  },
];

function makeCannedProvider(script: Scenario[]): AgentProvider {
  let i = 0;
  return {
    async plan(): Promise<AgentPlan> {
      const current = script[Math.min(i, script.length - 1)];
      i++;
      const raw = JSON.stringify(current.canned);
      return { reply: current.canned.reply, actions: [], rawContent: raw };
    },
  };
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Set TEST_DATABASE_URL or DATABASE_URL");
    process.exit(1);
  }

  console.log("Connecting to:", databaseUrl.replace(/:[^:@]+@/, ":***@"));
  const pool = await createPgPool({ databaseUrl, max: 5 });
  const dietRepo = new DietRepository(pool);
  const exerciseRepo = new ExerciseRepository(pool);
  const goalRepo = new GoalRepository(pool);
  const reportRepo = new ReportRepository(pool);

  const today = todayStr();
  await pool.query("DELETE FROM diet_records WHERE user_id = $1 AND record_date = $2", [USER_ID, today]);
  await pool.query("DELETE FROM exercise_records WHERE user_id = $1 AND record_date = $2", [USER_ID, today]);
  await pool.query("DELETE FROM user_goals WHERE user_id = $1", [USER_ID]);
  console.log(`Cleared existing data for ${USER_ID} on ${today}\n`);

  const lightragClient = createLightRagClient({
    apiUrl: process.env.LIGHTRAG_API_URL ?? "http://localhost:9621",
    timeoutMs: 1000,
  });
  const knowledgeService = createKnowledgeService(lightragClient);
  const reportGenerator = createReportGenerator({
    dietRepo, exerciseRepo, goalRepo, reportRepo, knowledgeService,
  });
  const pipeline = createHealthPipeline({
    provider: makeCannedProvider(SCENARIOS),
    knowledgeService, dietRepo, exerciseRepo, goalRepo, reportGenerator,
  });

  async function buildContext(): Promise<AgentContext> {
    const [todayDietRecords, todayExerciseRecords, activeGoals] = await Promise.all([
      dietRepo.getByDate(USER_ID, today),
      exerciseRepo.getByDate(USER_ID, today),
      goalRepo.getActive(USER_ID),
    ]);
    return { todayDietRecords, todayExerciseRecords, activeGoals, recentEvents: [], knowledgeAvailable: false };
  }

  const messages = [
    "今天早餐吃了两个包子加一碗豆浆",
    "今天中午吃了一碗牛肉面和一杯可乐",
    "下午去健身房练了1小时力量训练",
    "刚才那个包子其实只吃了一个",
    "把我的每日摄入目标设为2000",
    "看看今天的报告",
  ];

  for (let idx = 0; idx < messages.length; idx++) {
    const scenario = SCENARIOS[idx];
    const msg = messages[idx];
    console.log("━".repeat(60));
    console.log(`📨 [${scenario.label}]`);
    console.log(`   用户: ${msg}`);
    const context = await buildContext();
    const reply = await pipeline.handleMessage(USER_ID, msg, context);
    console.log("   Agent:");
    console.log(reply.split("\n").map((l) => `   ${l}`).join("\n"));
    console.log("");
  }

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
  console.log("\n✅ Demo complete");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});

import { createLightRagClient } from "../src/health/lightrag.js";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data", "knowledge-base");

const LIGHTRAG_URL = process.env.LIGHTRAG_API_URL ?? "http://localhost:9621";
const LIGHTRAG_KEY = process.env.LIGHTRAG_API_KEY;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;

function loadJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

function formatCalzenFoods(): string[] {
  type CalzenFood = {
    name: string;
    calories_per_100g: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };

  const data = loadJson<CalzenFood[]>(join(DATA_DIR, "food", "calzen-chinese-foods.json"));
  return data.map((f) => {
    return `【${f.name}】每100g热量: ${f.calories_per_100g} kcal。蛋白质${f.protein_g}g，碳水${f.carbs_g}g，脂肪${f.fat_g}g`;
  });
}

function formatCaltrackFoods(): string[] {
  type CaltrackFood = {
    name: string;
    category: string;
    base: { unit: string; qty: number };
    nutrition: { calories: number; protein: number; carbs: number; fat: number };
    micros?: Record<string, number>;
  };

  type CaltrackData = { foods: CaltrackFood[] };

  const data = loadJson<CaltrackData>(join(DATA_DIR, "food", "caltrack-foods.json"));
  return data.foods.map((f) => {
    const parts = [
      `【${f.name}】类别: ${f.category}`,
      `每${f.base.qty}${f.base.unit}热量: ${f.nutrition.calories} kcal`,
      `蛋白质${f.nutrition.protein}g，碳水${f.nutrition.carbs}g，脂肪${f.nutrition.fat}g`,
    ];
    if (f.micros) {
      const microStr = Object.entries(f.micros)
        .map(([k, v]) => `${k}${v}mg`)
        .join(", ");
      if (microStr) parts.push(`微量营养素: ${microStr}`);
    }
    return parts.join("。");
  });
}

function formatOpenFoodCalories(): string[] {
  type OpenFood = {
    name: string;
    english_name?: string;
    kcal_per_100g: number;
    type?: string;
  };

  const data = loadJson<OpenFood[]>(join(DATA_DIR, "food", "open-food-calories-5000.json"));
  return data.map((f) => {
    const parts = [`【${f.name}】`];
    if (f.english_name) parts.push(`英文名: ${f.english_name}`);
    parts.push(`每100g热量: ${f.kcal_per_100g} kcal`);
    if (f.type) parts.push(`类型: ${f.type}`);
    return parts.join("。");
  });
}

function formatNoizwavesFoods(): string[] {
  type NoizFood = {
    name: string;
    "nutrition-per-100g": {
      energy: number;
      protein: number;
      fat: number;
      carbohydrate: number;
      "dietary-fibre"?: number;
      sodium?: number;
    };
  };

  const data = loadJson<NoizFood[]>(join(DATA_DIR, "food", "noizwaves-nutrition-food.json"));
  return data.filter((f) => f["nutrition-per-100g"]).map((f) => {
    const n = f["nutrition-per-100g"];
    const kcal = Math.round(n.energy / 4.184);
    return `【${f.name}】每100g热量: ${kcal} kcal (${n.energy} kJ)。蛋白质${n.protein}g，碳水${n.carbohydrate}g，脂肪${n.fat}g`;
  });
}

function formatOpenFoodFacts(): string[] {
  type OffItem = {
    name: string;
    categories?: string;
    per100g: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      fiber?: number;
      sugar?: number;
      sodium?: number;
    };
  };

  const data = loadJson<OffItem[]>(join(DATA_DIR, "food", "openfoodfacts-raw.json"));
  return data.map((f) => {
    const parts = [
      `【${f.name}】`,
      `每100g热量: ${f.per100g.calories} kcal`,
      `蛋白质${f.per100g.protein}g，碳水${f.per100g.carbs}g，脂肪${f.per100g.fat}g`,
    ];
    if (f.categories) parts.push(`类别: ${f.categories}`);
    return parts.join("。");
  });
}

function formatCaltrackActivities(): string[] {
  type Activity = {
    name: string;
    slug: string;
    unit: string;
    met: number;
    category: string;
  };

  type ActivityData = { activities: Activity[] };

  const data = loadJson<ActivityData>(join(DATA_DIR, "exercise", "caltrack-activities.json"));
  return data.activities.map((a) => {
    return `【${a.name}】类别: ${a.category}。MET值: ${a.met}。单位: 每${a.unit}。热量消耗计算: MET × 体重(kg) × 时间(小时)`;
  });
}

function formatGuidelines(): string[] {
  const guidelinesDir = join(DATA_DIR, "health-guidelines");
  const files = readdirSync(guidelinesDir).filter((f) => f.endsWith(".md"));
  return files.map((file) => {
    const content = readFileSync(join(guidelinesDir, file), "utf-8");
    return `【健康指南: ${file}】\n${content}`;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function batchInsert(
  client: ReturnType<typeof createLightRagClient>,
  documents: string[],
  label: string,
): Promise<void> {
  let inserted = 0;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    for (const doc of batch) {
      try {
        await client.insert(doc, label);
        inserted++;
      } catch (err) {
        console.error(`[${label}] Failed to insert document ${inserted + 1}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const progress = Math.min(i + BATCH_SIZE, documents.length);
    console.log(`[${label}] Inserted ${progress}/${documents.length}`);
    if (i + BATCH_SIZE < documents.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }
  console.log(`[${label}] Complete: ${inserted}/${documents.length} documents inserted`);
}

async function main() {
  console.log(`LightRAG URL: ${LIGHTRAG_URL}`);
  const client = createLightRagClient({
    apiUrl: LIGHTRAG_URL,
    apiKey: LIGHTRAG_KEY,
    timeoutMs: 30000,
  });

  console.log("Checking LightRAG health...");
  const healthy = await client.healthCheck();
  if (!healthy) {
    console.error("LightRAG is not available. Please start it first.");
    process.exit(1);
  }
  console.log("LightRAG is healthy.");

  const sources: Array<{ label: string; docs: string[] }> = [
    { label: "calzen-chinese-foods", docs: formatCalzenFoods() },
    { label: "caltrack-foods", docs: formatCaltrackFoods() },
    { label: "open-food-calories-5000", docs: formatOpenFoodCalories() },
    { label: "noizwaves-nutrition-food", docs: formatNoizwavesFoods() },
    { label: "openfoodfacts-raw", docs: formatOpenFoodFacts() },
    { label: "caltrack-activities", docs: formatCaltrackActivities() },
    { label: "health-guidelines", docs: formatGuidelines() },
  ];

  const totalDocs = sources.reduce((sum, s) => sum + s.docs.length, 0);
  console.log(`\nTotal documents to insert: ${totalDocs}`);

  for (const source of sources) {
    console.log(`\n--- ${source.label} (${source.docs.length} docs) ---`);
    await batchInsert(client, source.docs, source.label);
  }

  console.log("\n--- Verifying with test queries ---");
  const testQueries = [
    "鸡胸肉 热量",
    "白米饭 热量",
    "跑步 MET",
  ];

  for (const q of testQueries) {
    try {
      const result = await client.query(q, "hybrid");
      const preview = result.response.substring(0, 200);
      console.log(`\nQuery: "${q}"\nResponse: ${preview}...`);
    } catch (err) {
      console.error(`Query "${q}" failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\nKnowledge base initialization complete.");
}

main().catch((err) => {
  console.error("Initialization failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});

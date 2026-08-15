import type { LightRagClient } from "./lightrag.js";
import type { KnowledgeResult } from "./types.js";

export type { KnowledgeResult };

export type KnowledgeService = ReturnType<typeof createKnowledgeService>;

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

const HEALTH_CACHE_TTL_MS = 30_000;

// Regex patterns for extracting calorie values from natural language text
const CALORIE_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*kcal/i,
  /(\d+(?:\.\d+)?)\s*大卡/i,
  /(\d+(?:\.\d+)?)\s*卡路里/i,
  /热量[：:]\s*(\d+(?:\.\d+)?)/i,
  /每100g[：:.\s]*(\d+(?:\.\d+)?)/i,
  /每100克[：:.\s]*(\d+(?:\.\d+)?)/i,
];

const MET_PATTERNS = [
  /MET[值:：\s]*(\d+(?:\.\d+)?)/i,
  /MET\s*(\d+(?:\.\d+)?)/i,
];

const PROTEIN_PATTERN = /蛋白质[：:.\s]*(\d+(?:\.\d+)?)\s*g?/i;
const CARBS_PATTERN = /碳水[化合物：:.\s]*(\d+(?:\.\d+)?)\s*g?/i;
const FAT_PATTERN = /脂肪[：:.\s]*(\d+(?:\.\d+)?)\s*g?/i;

function extractFirstMatch(text: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = parseFloat(match[1]);
      if (!Number.isNaN(value) && value > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function extractCalories(text: string): number | undefined {
  return extractFirstMatch(text, CALORIE_PATTERNS);
}

function extractMet(text: string): number | undefined {
  return extractFirstMatch(text, MET_PATTERNS);
}

function extractMacro(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  if (match?.[1]) {
    const value = parseFloat(match[1]);
    if (!Number.isNaN(value)) {
      return value;
    }
  }
  return undefined;
}

export function createKnowledgeService(
  client: LightRagClient,
  logger?: Logger,
) {
  let healthCached: boolean | undefined;
  let healthCheckedAt = 0;

  const log = logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  async function isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (healthCached !== undefined && now - healthCheckedAt < HEALTH_CACHE_TTL_MS) {
      return healthCached;
    }

    try {
      healthCached = await client.healthCheck();
      healthCheckedAt = now;
      log.info({ available: healthCached }, "lightrag health check");
    } catch {
      healthCached = false;
      healthCheckedAt = now;
      log.warn({}, "lightrag health check failed");
    }
    return healthCached;
  }

  async function lookupFood(
    foodName: string,
    quantity?: number,
    unit?: string,
  ): Promise<KnowledgeResult> {
    const available = await isAvailable();
    if (!available) {
      log.warn({ foodName }, "lightrag unavailable, returning low confidence for food lookup");
      return { confidence: "low" };
    }

    const queryParts = [`${foodName} 热量 营养素`];
    if (quantity && unit) {
      queryParts.push(`${quantity}${unit}`);
    }

    try {
      const result = await client.query(queryParts.join(" "), "hybrid");
      const text = result.response;
      const calories = extractCalories(text);

      if (calories === undefined) {
        return {
          confidence: "low",
          rawResponse: text,
        };
      }

      return {
        confidence: "medium",
        calories,
        protein: extractMacro(text, PROTEIN_PATTERN),
        carbs: extractMacro(text, CARBS_PATTERN),
        fat: extractMacro(text, FAT_PATTERN),
        matchedName: foodName,
        rawResponse: text,
      };
    } catch (err) {
      log.error({ foodName, err: String(err) }, "lightrag food lookup failed");
      return { confidence: "low" };
    }
  }

  async function lookupExercise(
    exerciseName: string,
    durationMin?: number,
    intensity?: string,
  ): Promise<KnowledgeResult> {
    const available = await isAvailable();
    if (!available) {
      log.warn({ exerciseName }, "lightrag unavailable, returning low confidence for exercise lookup");
      return { confidence: "low" };
    }

    const queryParts = [`${exerciseName} MET 热量消耗`];
    if (durationMin) {
      queryParts.push(`${durationMin}分钟`);
    }
    if (intensity) {
      queryParts.push(intensity);
    }

    try {
      const result = await client.query(queryParts.join(" "), "hybrid");
      const text = result.response;
      const met = extractMet(text);
      const calories = extractCalories(text);

      if (met === undefined && calories === undefined) {
        return {
          confidence: "low",
          rawResponse: text,
        };
      }

      return {
        confidence: "medium",
        met,
        calories,
        matchedName: exerciseName,
        rawResponse: text,
      };
    } catch (err) {
      log.error({ exerciseName, err: String(err) }, "lightrag exercise lookup failed");
      return { confidence: "low" };
    }
  }

  async function getAdvice(
    topic: string,
    userContext?: Record<string, unknown>,
  ): Promise<KnowledgeResult> {
    const available = await isAvailable();
    if (!available) {
      log.warn({ topic }, "lightrag unavailable, returning low confidence for advice");
      return { confidence: "low" };
    }

    const queryParts = [topic];
    if (userContext) {
      const contextStr = Object.entries(userContext)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      queryParts.push(contextStr);
    }

    try {
      const result = await client.query(`健康建议 ${queryParts.join(" ")}`, "hybrid");
      const text = result.response;

      if (!text || text.trim().length < 10) {
        return { confidence: "low" };
      }

      const adviceLines = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 5);

      return {
        confidence: "medium",
        advice: adviceLines,
        rawResponse: text,
      };
    } catch (err) {
      log.error({ topic, err: String(err) }, "lightrag advice lookup failed");
      return { confidence: "low" };
    }
  }

  return {
    isAvailable,
    lookupFood,
    lookupExercise,
    getAdvice,
  };
}

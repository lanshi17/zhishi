import { ZodError } from "zod";
import { envSchema } from "./schema.js";

type ConfigIssueLike = {
  code?: string;
  received?: unknown;
  message?: string;
  path?: Array<string | number>;
};

function getConfigIssues(error: unknown): ConfigIssueLike[] {
  if (error instanceof ZodError) {
    return error.issues;
  }

  if (
    typeof error === "object"
    && error !== null
    && "issues" in error
    && Array.isArray(error.issues)
  ) {
    return error.issues as ConfigIssueLike[];
  }

  return [];
}

export function describeConfigError(error: unknown) {
  const issues = getConfigIssues(error);
  if (issues.length === 0) {
    return "Invalid configuration.";
  }

  const missingFields = issues
    .filter((issue) => issue.code === undefined || issue.code === "invalid_type")
    .filter((issue) => issue.received === undefined || issue.received === "undefined")
    .map((issue) => issue.path?.at(0))
    .filter((field): field is string => typeof field === "string");

  if (missingFields.length > 0) {
    return `Missing required config: ${missingFields.join(", ")}`;
  }

  return issues
    .map((issue) => `${issue.path?.join(".") || "config"}: ${issue.message ?? "Invalid value"}`)
    .join("; ");
}

export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = envSchema.parse(env);

  return {
    adminUserId: parsed.ADMIN_USER_ID,
    workspaceRoot: parsed.WORKSPACE_ROOT,

    databaseUrl: parsed.DATABASE_URL,
    pgPoolMax: parsed.PG_POOL_MAX,
    pgPoolIdleTimeoutMs: parsed.PG_POOL_IDLE_TIMEOUT_MS,

    llm: {
      apiStyle: "openai-compatible" as const,
      baseUrl: parsed.LLM_BASE_URL,
      model: parsed.LLM_MODEL,
      apiKey: parsed.LLM_API_KEY,
      supportsImageInput: parsed.LLM_SUPPORTS_IMAGE_INPUT === "true",
      visionModel: parsed.LLM_VISION_MODEL,
    },

    lightrag: {
      apiUrl: parsed.LIGHTRAG_API_URL,
      apiKey: parsed.LIGHTRAG_API_KEY,
      timeoutMs: parsed.LIGHTRAG_TIMEOUT_MS,
      enabled: parsed.LIGHTRAG_ENABLED !== "false",
    },

    tavily: {
      apiKey: parsed.TAVILY_API_KEY,
    },

    health: {
      defaultCalorieGoal: parsed.HEALTH_DEFAULT_CALORIE_GOAL ?? 2000,
      defaultBurnGoal: parsed.HEALTH_DEFAULT_BURN_GOAL ?? 500,
      contextWindow: parsed.LLM_CONTEXT_WINDOW ?? 256000,
    },

    ilinkBotToken: parsed.ILINK_BOT_TOKEN,
    ilinkBotId: parsed.ILINK_BOT_ID,
    ilinkUserId: parsed.ILINK_USER_ID,
  };
}

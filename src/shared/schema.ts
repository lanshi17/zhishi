import { z } from "zod";

export const envSchema = z.object({
  ADMIN_USER_ID: z.string().min(1),
  WORKSPACE_ROOT: z.string().min(1),
  LLM_BASE_URL: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().optional(),
  LLM_SUPPORTS_IMAGE_INPUT: z.enum(["true", "false"]).optional(),
  LLM_VISION_MODEL: z.string().optional(),

  // PostgreSQL
  DATABASE_URL: z.string().min(1),
  PG_POOL_MAX: z.coerce.number().optional(),
  PG_POOL_IDLE_TIMEOUT_MS: z.coerce.number().optional(),

  // LightRAG
  LIGHTRAG_API_URL: z.string().optional(),
  LIGHTRAG_API_KEY: z.string().optional(),
  LIGHTRAG_TIMEOUT_MS: z.coerce.number().optional(),
  LIGHTRAG_ENABLED: z.enum(["true", "false"]).optional(),

  // Tavily Web Search
  TAVILY_API_KEY: z.string().optional(),

  // Health tracking
  HEALTH_DEFAULT_CALORIE_GOAL: z.coerce.number().optional(),
  HEALTH_DEFAULT_BURN_GOAL: z.coerce.number().optional(),
  LLM_CONTEXT_WINDOW: z.coerce.number().int().positive().optional(),

  // iLink
  ILINK_BOT_TOKEN: z.string().optional(),
  ILINK_BOT_ID: z.string().optional(),
  ILINK_USER_ID: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

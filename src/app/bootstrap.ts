import { ZodError } from "zod";
import { createDefaultEntrypoint } from "./entrypoint.js";
import { describeConfigError } from "../shared/config.js";

export type StartupFailureCategory = "config" | "provider" | "database" | "gateway" | "startup";

export type StartupFailure = {
  category: StartupFailureCategory;
  message: string;
  cause?: unknown;
};

export function createBootstrapConfig(input: { workspaceRoot: string }) {
  return {
    platform: "linux" as const,
    approvalMode: "mixed" as const,
    workspaceRoot: input.workspaceRoot,
  };
}

function isStartupFailure(error: unknown): error is StartupFailure {
  return typeof error === "object"
    && error !== null
    && "category" in error
    && "message" in error;
}

function classifyStartupFailure(error: unknown): StartupFailureCategory {
  if (error instanceof ZodError) {
    return "config";
  }

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("provider")) {
    return "provider";
  }

  if (message.includes("database") || message.includes("postgres") || message.includes("PG") || message.includes("ECONNREFUSED")) {
    return "database";
  }

  if (message.includes("gateway")) {
    return "gateway";
  }

  return "startup";
}

function toStartupFailure(error: unknown): StartupFailure {
  if (isStartupFailure(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return {
      category: "config",
      message: describeConfigError(error),
      cause: error,
    };
  }

  return {
    category: classifyStartupFailure(error),
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  };
}

export async function bootstrapApplication(input: {
  env: Record<string, string | undefined>;
  createDefaultEntrypoint?: typeof createDefaultEntrypoint;
}) {
  try {
    const config = createBootstrapConfig({ workspaceRoot: input.env.WORKSPACE_ROOT ?? "/" });
    const createEntrypoint = input.createDefaultEntrypoint ?? createDefaultEntrypoint;
    const entrypoint = await createEntrypoint({ env: input.env });

    return {
      app: entrypoint.app,
      gateway: entrypoint.gateway,
      config,
      taskService: entrypoint.taskService,
      setCurrentMessage: entrypoint.setCurrentMessage,
      db: entrypoint.db,
      async start() {
        const gw = entrypoint.gateway as { start?: () => void };
        gw.start?.();
        return {
          app: entrypoint.app,
          gateway: entrypoint.gateway,
        };
      },
    };
  } catch (error) {
    throw toStartupFailure(error);
  }
}

import { describe, expect, it } from "vitest";
import { createBootstrapConfig, bootstrapApplication } from "../../src/app/bootstrap.js";
import { TEST_DATABASE_URL } from "../helpers/pg.js";

const validEnv = {
  ADMIN_USER_ID: "wxid_admin",
  WORKSPACE_ROOT: "/workspace",
  LLM_BASE_URL: "http://localhost:11434/v1",
  LLM_MODEL: "qwen2.5-coder",
  LLM_API_KEY: "",
  LLM_SUPPORTS_IMAGE_INPUT: "false",
  DATABASE_URL: TEST_DATABASE_URL,
};


describe("createBootstrapConfig", () => {
  it("normalizes the MVP defaults", () => {
    const cfg = createBootstrapConfig({ workspaceRoot: "/tmp/demo" });

    expect(cfg.platform).toBe("linux");
    expect(cfg.workspaceRoot).toBe("/tmp/demo");
    expect(cfg.approvalMode).toBe("mixed");
  });
});

describe("bootstrapApplication", () => {
  it("classifies missing config as a startup config error", async () => {
    await expect(bootstrapApplication({ env: {} })).rejects.toMatchObject({
      category: "config",
      message: expect.stringContaining("Missing required config:"),
    });
  });

  it("classifies provider startup failures", async () => {
    await expect(bootstrapApplication({
      env: validEnv,
      createDefaultEntrypoint: () => {
        throw new Error("openai provider request failed: ECONNREFUSED");
      },
    })).rejects.toMatchObject({
      category: "provider",
      message: "openai provider request failed: ECONNREFUSED",
    });
  });

  it("composes entrypoint with bootstrap config to create startable runtime", async () => {
    const result = await bootstrapApplication({
      env: validEnv,
    });

    expect(result).toHaveProperty("app");
    expect(result).toHaveProperty("gateway");
    expect(result).toHaveProperty("config");
    expect(result.config.workspaceRoot).toBe("/workspace");

    await result.db.end();
  });

  it("exposes taskService for approval-resume smoke flows", async () => {
    const result = await bootstrapApplication({
      env: validEnv,
    });

    expect(result).toHaveProperty("taskService");
    expect(result.taskService).toHaveProperty("receiveMessage");
    expect(result.taskService).toHaveProperty("getPendingApproval");

    await result.db.end();
  });
});

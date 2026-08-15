import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createDefaultEntrypoint } from "../../src/app/entrypoint.js";
import { bootstrapApplication } from "../../src/app/bootstrap.js";
import { createTuiRuntime } from "../../src/tui/runtime.js";
import { runMainEntrypoint } from "../../src/main-entrypoint.js";
import type { DbPool } from "../../src/store/db.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

const baseEnv = {
  ADMIN_USER_ID: "wxid_admin",
  WORKSPACE_ROOT: "/workspace",
  LLM_BASE_URL: "http://localhost:11434/v1",
  LLM_MODEL: "qwen2.5-coder",
  LLM_API_KEY: "",
  LLM_SUPPORTS_IMAGE_INPUT: "false",
  DATABASE_URL: TEST_DATABASE_URL,
};

let helperPool: DbPool;
const pools: DbPool[] = [];

beforeAll(async () => {
  helperPool = await createHelperPool();
});

beforeEach(async () => {
  await cleanTables(helperPool);
});

afterEach(async () => {
  await Promise.all(pools.map((p) => p.end()));
  pools.length = 0;
});

afterAll(async () => {
  await helperPool.end();
});

describe("runMainEntrypoint", () => {
  it("prints classified startup failures to stderr", async () => {
    const stderr = { write: vi.fn() };

    const exitCode = await runMainEntrypoint({
      stderr,
      bootstrapApplication: vi.fn().mockRejectedValue({
        category: "config",
        message: "Missing required config: ADMIN_USER_ID",
      }),
    });

    expect(exitCode).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(
      "Startup failed [config]: Missing required config: ADMIN_USER_ID\n",
    );
  });

  it("starts the real runtime and launches the TUI", async () => {
    const start = vi.fn().mockResolvedValue({});
    const startTuiRuntime = vi.fn();

    const exitCode = await runMainEntrypoint({
      env: { ...baseEnv },
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      bootstrapApplication: vi.fn().mockResolvedValue({
        app: { resumeApproval: vi.fn(), rejectApproval: vi.fn() },
        gateway: {},
        taskService: { listThreads: vi.fn(), listApprovals: vi.fn(), listEvents: vi.fn() },
        start,
      }),
      startTuiRuntime,
    });

    expect(exitCode).toBe(0);
    expect(start).toHaveBeenCalledTimes(1);
    expect(startTuiRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ app: expect.any(Object), taskService: expect.any(Object) }),
      expect.any(Object),
    );
  });

  it("surfaces persisted pending approvals to the TUI after restart through the main runtime path", async () => {
    const startTuiRuntime = vi.fn();

    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const { threadId } = await writer.taskService.receiveMessage({
      fromUserId: "wxid_admin",
      text: "write config",
    });
    const { approvalId } = await writer.taskService.createApprovalRequest(
      threadId,
      { tool: "fs.write", input: { path: "/workspace/app.json", contents: "{}" } },
      "write config",
    );
    await writer.taskService.markWaitingApproval(threadId, {
      tool: "fs.write",
      summary: "write config",
    });

    const exitCode = await runMainEntrypoint({
      env: baseEnv,
      stdout: { write: vi.fn() },
      stderr: { write: vi.fn() },
      startTuiRuntime,
      bootstrapApplication: async (input) => {
        const runtime = await bootstrapApplication(input);
        pools.push(runtime.db);
        return runtime;
      },
    });

    expect(exitCode).toBe(0);
    expect(startTuiRuntime).toHaveBeenCalledTimes(1);
    const tuiApprovals = await startTuiRuntime.mock.calls[0]?.[0].taskService.listApprovals();
    expect(tuiApprovals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approvalId,
          threadId,
          status: "pending",
          reply: "write config",
        }),
      ]),
    );
  });
});

describe("createDefaultEntrypoint", () => {

  it("builds a runnable app and gateway from env", async () => {
    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    expect(entry.app).toBeDefined();
    expect(entry.gateway).toBeDefined();
  });

  it("wires the gateway with the trusted admin boundary", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "ok",
                actions: [],
              }),
            },
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    try {
      await entry.gateway.handleInbound({
        fromUserId: "wxid_guest",
        text: "run tests",
        contextToken: "ctx-guest",
      });

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("builds an app and gateway that can support approval-required smoke flows", async () => {
    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    expect(entry.app).toBeDefined();
    expect(entry.gateway).toBeDefined();
    expect(entry.taskService).toBeDefined();
  });

  it("wires smoke composition to database-backed repositories", async () => {
    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    entry.setCurrentMessage({
      fromUserId: "wxid_user",
      text: "test message",
    });

    const result = await entry.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "test message",
    });

    expect(result.threadId).toBeDefined();

    const thread = await entry.taskService.getThread(result.threadId);
    expect(thread).toBeDefined();
    expect(thread?.fromUserId).toBe("wxid_user");
    expect(thread?.status).toBe("queued");
  });

  it("persists approval requests to database", async () => {
    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    entry.setCurrentMessage({
      fromUserId: "wxid_user",
      text: "test message",
    });

    const { threadId } = await entry.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "test message",
    });

    const { approvalId } = await entry.taskService.createApprovalRequest(threadId, {
      tool: "shell.exec",
      input: { command: "echo test" },
    }, "Execute shell command?");

    expect(approvalId).toBeDefined();

    const approval = await entry.taskService.getPendingApproval(approvalId);
    expect(approval).toBeDefined();
    expect(approval?.status).toBe("pending");
    expect(approval?.action.tool).toBe("shell.exec");

    await entry.taskService.markApproved(approvalId);
    const approvedApproval = await entry.taskService.getPendingApproval(approvalId);
    expect(approvedApproval?.status).toBe("approved");
  });

  it("builds smoke composition around the real http provider", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "Needs approval.",
                actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
              }),
            },
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const entry = await createDefaultEntrypoint({ env: baseEnv });
      pools.push(entry.db);

      entry.setCurrentMessage({
        fromUserId: "wxid_admin",
        text: "run pwd",
      });

      await entry.app.handleAdminMessage({
        fromUserId: "wxid_admin",
        text: "run pwd",
        contextToken: "ctx-real-provider",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:11434/v1/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses configured DATABASE_URL for persistent state", async () => {
    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const { threadId } = await writer.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "persist this",
    });

    await writer.taskService.markWaitingApproval(threadId);

    const reader = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(reader.db);

    const persisted = await reader.taskService.getThread(threadId);
    expect(persisted).toBeDefined();
    expect(persisted?.status).toBe("waiting_approval");
  });

  it("reuses the same thread for a second message after waiting approval", async () => {
    const entry = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(entry.db);

    const first = await entry.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "first message",
    });

    await entry.taskService.markWaitingApproval(first.threadId);

    const second = await entry.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "follow up message",
    });

    expect(second.threadId).toBe(first.threadId);
    expect((await entry.taskService.getThread(first.threadId))?.status).toBe("waiting_approval");
  });

  it("reuses a persisted waiting_approval thread after recreating the entrypoint", async () => {
    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const first = await writer.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "persist this",
    });
    await writer.taskService.markWaitingApproval(first.threadId);

    const reader = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(reader.db);

    const second = await reader.taskService.receiveMessage({
      fromUserId: "wxid_user",
      text: "follow up",
    });

    expect(second.threadId).toBe(first.threadId);
  });

  it("resumes a persisted approval after recreating the entrypoint", async () => {
    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const { threadId } = await writer.taskService.receiveMessage({
      fromUserId: "wxid_admin",
      text: "run pwd",
    });
    const { approvalId } = await writer.taskService.createApprovalRequest(
      threadId,
      { tool: "shell.exec", input: { command: "pwd" } },
      "Need approval.",
    );
    await writer.taskService.markWaitingApproval(threadId, { tool: "shell.exec", summary: "Need approval." });

    const reader = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(reader.db);

    await reader.app.resumeApproval(approvalId);

    expect((await reader.taskService.getPendingApproval(approvalId))?.status).toBe("approved");
    expect((await reader.taskService.getThread(threadId))?.status).toBe("done");
  });

  it("rejects a persisted approval after recreating the entrypoint", async () => {
    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const { threadId } = await writer.taskService.receiveMessage({
      fromUserId: "wxid_admin",
      text: "run dangerous command",
    });
    const { approvalId } = await writer.taskService.createApprovalRequest(
      threadId,
      { tool: "shell.exec", input: { command: "rm -rf /tmp/demo" } },
      "Need approval.",
    );
    await writer.taskService.markWaitingApproval(threadId, { tool: "shell.exec", summary: "Need approval." });

    const reader = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(reader.db);

    await reader.app.rejectApproval(approvalId, "too risky");

    expect((await reader.taskService.getPendingApproval(approvalId))?.status).toBe("rejected");
    expect((await reader.taskService.getThread(threadId))?.status).toBe("failed");
    expect(await reader.taskService.listEvents(threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "approval.rejected", summary: "too risky" }),
        expect.objectContaining({ kind: "thread.failed", summary: "too risky" }),
      ]),
    );
  });

  it("rebuilds the same cold-start recovery view after recreating the entrypoint", async () => {
    const writer = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(writer.db);

    const { threadId } = await writer.taskService.receiveMessage({
      fromUserId: "wxid_admin",
      text: "write config",
    });
    await writer.taskService.createApprovalRequest(
      threadId,
      { tool: "fs.write", input: { path: "/workspace/app.json", contents: "{}" } },
      "write config",
    );
    await writer.taskService.markWaitingApproval(threadId, {
      tool: "fs.write",
      summary: "write config",
    });

    const reader = await createDefaultEntrypoint({ env: baseEnv });
    pools.push(reader.db);
    const runtime = createTuiRuntime({
      app: reader.app,
      taskService: reader.taskService,
    });

    const state = await runtime.buildScreenState();

    expect(state.recoveryBannerText).toBe("Recovered pending approvals from the previous run.");
    expect(state.recoveryHintText).toBe("Approve or reject a recovered approval to continue.");
    expect(state.threadItems.find((thread) => thread.id === threadId)?.isSelected).toBe(true);
    expect(state.eventItems).toEqual([
      { id: `${threadId}:approval.requested:0`, summary: "write config" },
    ]);
  });
});

describe("bootstrapApplication", () => {
  it("returns a startable runtime with gateway and app", async () => {
    const runtime = await bootstrapApplication({ env: baseEnv });
    pools.push(runtime.db);

    expect(runtime.start).toBeTypeOf("function");
    expect(runtime.app).toBeDefined();
    expect(runtime.gateway).toBeDefined();
  });

  it("classifies missing config as a startup config error", async () => {
    await expect(bootstrapApplication({ env: {} })).rejects.toMatchObject({
      category: "config",
      message: expect.stringContaining("Missing required config:"),
    });
  });

  it("classifies provider startup failures", async () => {
    await expect(bootstrapApplication({
      env: baseEnv,
      createDefaultEntrypoint: () => {
        throw new Error("openai provider request failed: ECONNREFUSED");
      },
    })).rejects.toMatchObject({
      category: "provider",
      message: "openai provider request failed: ECONNREFUSED",
    });
  });

  it("composes entrypoint with bootstrap config to create startable runtime", async () => {
    const result = await bootstrapApplication({ env: baseEnv });
    pools.push(result.db);

    expect(result).toHaveProperty("app");
    expect(result).toHaveProperty("gateway");
    expect(result).toHaveProperty("config");
    expect(result.config.workspaceRoot).toBe("/workspace");
  });

  it("exposes taskService for approval-resume smoke flows", async () => {
    const result = await bootstrapApplication({ env: baseEnv });
    pools.push(result.db);

    expect(result).toHaveProperty("taskService");
    expect(result.taskService).toHaveProperty("receiveMessage");
    expect(result.taskService).toHaveProperty("getPendingApproval");
  });
});

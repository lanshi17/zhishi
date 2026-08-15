import { describe, expect, it, vi } from "vitest";
import { createApplication } from "../../src/app/main.js";
import type { AgentContext } from "../../src/health/types.js";

describe("createApplication", () => {
  it("runs one auto-approved tool action and sends a final reply", async () => {
    const sendReply = vi.fn();
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const markDone = vi.fn().mockResolvedValue(undefined);

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: {
        async planNext() {
          return {
            reply: "Searching the web first.",
            actions: [{ tool: "web.search", input: { query: "rustls" } }],
          };
        },
      },
      approvals: {
        classifyAction(action: { tool: string }) {
          return { decision: action.tool === "web.search" ? "auto_approve" : ("approval_required" as const) };
        },
      },
      tools: {
        async run(action: { tool: string; input: unknown }) {
          return { ok: true, output: { items: [{ title: "rustls" }], action } };
        },
      },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent,
        markDone,
      },
      sendReply,
    });

    await app.handleAdminMessage({ fromUserId: "wxid_admin", text: "search rustls", contextToken: "ctx" });

    expect(appendEvent).toHaveBeenCalledWith("t1", expect.objectContaining({ kind: "tool.completed" }));
    expect(markDone).toHaveBeenCalledWith("t1");
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", expect.stringContaining("Searching"));
  });

  it("pauses when an action requires approval and returns an approval id", async () => {
    const sendReply = vi.fn();
    const createApprovalRequest = vi.fn().mockResolvedValue({ approvalId: "ap1" });
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const markWaitingApproval = vi.fn().mockResolvedValue(undefined);
    const markDone = vi.fn().mockResolvedValue(undefined);
    const toolsRun = vi.fn();

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: {
        async planNext() {
          return {
            reply: "This needs approval.",
            actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
          };
        },
      },
      approvals: {
        classifyAction() {
          return { decision: "approval_required" as const };
        },
      },
      tools: { run: toolsRun },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent,
        createApprovalRequest,
        markWaitingApproval,
        markDone,
      },
      sendReply,
    });

    await app.handleAdminMessage({ fromUserId: "wxid_admin", text: "run pwd", contextToken: "ctx" });

    expect(createApprovalRequest).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ tool: "shell.exec" }),
      "This needs approval.",
    );
    expect(markWaitingApproval).toHaveBeenCalledWith("t1", {
      tool: "shell.exec",
      summary: "This needs approval.",
    });
    expect(toolsRun).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", expect.stringContaining("ap1"));
  });

  it("handles auto-approved and approval-required actions across threads", async () => {
    const sendReply = vi.fn();
    const threads = new Map<string, { status: string }>();
    const events = new Map<string, Array<{ kind: string; summary?: string; result?: unknown }>>();
    const approvals = new Map<string, { id: string; threadId: string; action: { tool: string; input: unknown }; reply: string; status: string }>();
    let threadCount = 0;
    let approvalCount = 0;

    const taskService = {
      async receiveMessage() {
        threadCount += 1;
        const threadId = `t${threadCount}`;
        threads.set(threadId, { status: "queued" });
        return { threadId };
      },
      async appendEvent(threadId: string, event: { kind: string; summary?: string; result?: unknown }) {
        const threadEvents = events.get(threadId) ?? [];
        threadEvents.push(event);
        events.set(threadId, threadEvents);
      },
      async createApprovalRequest(threadId: string, action: { tool: string; input: unknown }, reply: string) {
        approvalCount += 1;
        const approval = {
          id: `ap${approvalCount}`,
          threadId,
          action,
          reply,
          status: "pending",
        };
        approvals.set(approval.id, approval);
        return { approvalId: approval.id };
      },
      async markWaitingApproval(threadId: string) {
        threads.set(threadId, { status: "waiting_approval" });
      },
      async markDone(threadId: string) {
        threads.set(threadId, { status: "done" });
      },
      async getPendingApproval(approvalId: string) {
        return approvals.get(approvalId);
      },
      async markApproved(approvalId: string) {
        const approval = approvals.get(approvalId);
        if (approval) {
          approval.status = "approved";
        }
      },
    };

    const toolsRun = vi.fn().mockImplementation(async (action: { tool: string; input: unknown }) => {
      if (action.tool === "web.search") {
        return { ok: true, tool: action.tool, output: { items: [{ title: "rustls" }] } };
      }

      return { ok: true, tool: action.tool, output: { exitCode: 0, stdout: "/workspace", stderr: "" } };
    });

    const plans = [
      {
        reply: "Searching the web first.",
        actions: [{ tool: "web.search", input: { query: "rustls" } }],
      },
      {
        reply: "Need approval.",
        actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
      },
    ];

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: {
        async planNext() {
          const next = plans.shift();
          if (!next) {
            throw new Error("no plan available");
          }
          return next;
        },
      },
      approvals: {
        classifyAction(action: { tool: string }) {
          return { decision: action.tool === "shell.exec" ? ("approval_required" as const) : ("auto_approve" as const) };
        },
      },
      tools: { run: toolsRun },
      taskService,
      sendReply,
    });

    await app.handleAdminMessage({ fromUserId: "wxid_admin", text: "search rustls", contextToken: "ctx-1" });
    await app.handleAdminMessage({ fromUserId: "wxid_admin", text: "pwd", contextToken: "ctx-2" });

    expect(events.get("t1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "tool.completed" })]),
    );
    expect(threads.get("t1")?.status).toBe("done");
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", "Searching the web first.");

    expect(threads.get("t2")?.status).toBe("waiting_approval");
    expect(approvals.get("ap1")?.action.tool).toBe("shell.exec");
    expect(toolsRun).toHaveBeenCalledTimes(1);
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", expect.stringContaining("ap1"));
  });

  it("rejects a stored approval without running the tool and marks the thread failed", async () => {
    const sendReply = vi.fn();
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const markRejected = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const toolsRun = vi.fn();

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: {
        async planNext() {
          return {
            reply: "Need approval.",
            actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
          };
        },
      },
      approvals: {
        classifyAction() {
          return { decision: "approval_required" as const };
        },
      },
      tools: { run: toolsRun },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent,
        markDone: vi.fn().mockResolvedValue(undefined),
        createApprovalRequest: vi.fn().mockResolvedValue({ approvalId: "ap1" }),
        markWaitingApproval: vi.fn().mockResolvedValue(undefined),
        async getPendingApproval() {
          return {
            id: "ap1",
            threadId: "t1",
            action: { tool: "shell.exec", input: { command: "pwd" } },
            reply: "Need approval.",
            status: "pending",
          };
        },
        markApproved: vi.fn().mockResolvedValue(undefined),
        markRejected,
        markFailed,
      },
      sendReply,
    });

    await app.rejectApproval("ap1", "too risky");

    expect(markRejected).toHaveBeenCalledWith("ap1");
    expect(appendEvent).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ kind: "approval.rejected", summary: "too risky" }),
    );
    expect(markFailed).toHaveBeenCalledWith("t1", expect.stringContaining("too risky"));
    expect(toolsRun).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", expect.stringContaining("too risky"));
  });

  it("uses health pipeline flow when healthPipeline is provided", async () => {
    const sendReply = vi.fn();
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const markDone = vi.fn().mockResolvedValue(undefined);
    const toolsRun = vi.fn();
    const planNext = vi.fn();

    const pipelineReply = "✅ 已记录饮食：\n  - 苹果 × 1 个 ≈ 95 kcal";

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: { planNext },
      approvals: { classifyAction: () => ({ decision: "auto_approve" as const }) },
      tools: { run: toolsRun },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent,
        markDone,
      },
      sendReply,
      healthPipeline: {
        async handleMessage(userId: string, text: string, _context: AgentContext) {
          return pipelineReply;
        },
      },
      buildContext: async () => ({
        todayDietRecords: [],
        todayExerciseRecords: [],
        activeGoals: [],
        recentEvents: [],
        knowledgeAvailable: false,
      }),
    });

    await app.handleAdminMessage({
      fromUserId: "wxid_admin",
      text: "吃了一个苹果",
      contextToken: "ctx",
    });

    expect(planNext).not.toHaveBeenCalled();
    expect(toolsRun).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledWith("t1", expect.objectContaining({ kind: "health.replied" }));
    expect(markDone).toHaveBeenCalledWith("t1");
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", pipelineReply);
  });

  it("handles health pipeline errors gracefully", async () => {
    const sendReply = vi.fn();
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const markDone = vi.fn().mockResolvedValue(undefined);
    const markFailed = vi.fn().mockResolvedValue(undefined);

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: { planNext: vi.fn() },
      approvals: { classifyAction: () => ({ decision: "auto_approve" as const }) },
      tools: { run: vi.fn() },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent,
        markDone,
        markFailed,
      },
      sendReply,
      healthPipeline: {
        async handleMessage() {
          throw new Error("LLM timeout");
        },
      },
      buildContext: async () => ({
        todayDietRecords: [],
        todayExerciseRecords: [],
        activeGoals: [],
        recentEvents: [],
        knowledgeAvailable: false,
      }),
    });

    await app.handleAdminMessage({
      fromUserId: "wxid_admin",
      text: "hello",
      contextToken: "ctx",
    });

    expect(markFailed).toHaveBeenCalledWith("t1", "LLM timeout");
    expect(sendReply).toHaveBeenCalledWith("wxid_admin", expect.stringContaining("处理失败"));
  });

  it("ignores non-admin messages in health pipeline flow", async () => {
    const sendReply = vi.fn();
    const healthHandleMessage = vi.fn();

    const app = createApplication({
      adminUserId: "wxid_admin",
      runtime: { planNext: vi.fn() },
      approvals: { classifyAction: () => ({ decision: "auto_approve" as const }) },
      tools: { run: vi.fn() },
      taskService: {
        async receiveMessage() {
          return { threadId: "t1" };
        },
        appendEvent: vi.fn().mockResolvedValue(undefined),
        markDone: vi.fn().mockResolvedValue(undefined),
      },
      sendReply,
      healthPipeline: { handleMessage: healthHandleMessage },
      buildContext: async () => ({
        todayDietRecords: [],
        todayExerciseRecords: [],
        activeGoals: [],
        recentEvents: [],
        knowledgeAvailable: false,
      }),
    });

    await app.handleAdminMessage({
      fromUserId: "wxid_other",
      text: "hello",
      contextToken: "ctx",
    });

    expect(healthHandleMessage).not.toHaveBeenCalled();
    expect(sendReply).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createTuiController, createTuiRuntime, decodeTerminalInput } from "../../src/tui/runtime.js";
import type { ApprovalQueueItem } from "../../src/tui/widgets/approval-queue.js";

function approvalItem(overrides: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem {
  return {
    id: "approval-1",
    threadId: "thread-1",
    tool: "shell.exec",
    status: "pending",
    summary: "run pwd",
    ...overrides,
  };
}

describe("createTuiController", () => {
  it("moves selection down and up within bounds", async () => {
    const controller = createTuiController({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval: vi.fn(),
      },
    });
    const approvals = [
      approvalItem({ id: "approval-1" }),
      approvalItem({ id: "approval-2" }),
      approvalItem({ id: "approval-3" }),
    ];

    controller.setApprovalItems(approvals);

    await controller.handleInput({ kind: "down" }, approvals);
    await controller.handleInput({ kind: "down" }, approvals);
    await controller.handleInput({ kind: "down" }, approvals);

    expect(controller.getState().selectedApprovalIndex).toBe(2);

    await controller.handleInput({ kind: "up" }, approvals);
    await controller.handleInput({ kind: "up" }, approvals);
    await controller.handleInput({ kind: "up" }, approvals);

    expect(controller.getState().selectedApprovalIndex).toBe(0);
  });

  it("approves the selected approval", async () => {
    const resumeApproval = vi.fn();
    const controller = createTuiController({
      app: {
        resumeApproval,
        rejectApproval: vi.fn(),
      },
    });
    const approvals = [
      approvalItem({ id: "approval-1" }),
      approvalItem({ id: "approval-2" }),
    ];

    controller.setApprovalItems(approvals);
    await controller.handleInput({ kind: "down" }, approvals);
    await controller.handleInput({ kind: "approve" }, approvals);

    expect(resumeApproval).toHaveBeenCalledWith("approval-2");
  });

  it("rejects the selected approval with the typed reason", async () => {
    const rejectApproval = vi.fn();
    const controller = createTuiController({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval,
      },
    });
    const approvals = [approvalItem({ id: "approval-1" })];

    controller.setApprovalItems(approvals);
    await controller.handleInput({ kind: "reject" }, approvals);
    await controller.handleInput({ kind: "char", value: "n" }, approvals);
    await controller.handleInput({ kind: "char", value: "o" }, approvals);

    expect(controller.getState()).toMatchObject({
      mode: "reject_input",
      selectedApprovalIndex: 0,
      rejectReason: "no",
    });

    await controller.handleInput({ kind: "submit" }, approvals);

    expect(rejectApproval).toHaveBeenCalledWith("approval-1", "no");
    expect(controller.getState()).toMatchObject({
      mode: "browse",
      selectedApprovalIndex: 0,
      rejectReason: "",
    });
  });

  it("cancels reject-input mode on escape without dispatching", async () => {
    const rejectApproval = vi.fn();
    const controller = createTuiController({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval,
      },
    });
    const approvals = [approvalItem({ id: "approval-1" })];

    controller.setApprovalItems(approvals);
    await controller.handleInput({ kind: "reject" }, approvals);
    await controller.handleInput({ kind: "char", value: "x" }, approvals);
    await controller.handleInput({ kind: "escape" }, approvals);

    expect(rejectApproval).not.toHaveBeenCalled();
    expect(controller.getState()).toMatchObject({
      mode: "browse",
      selectedApprovalIndex: 0,
      rejectReason: "",
    });
  });

  it("decodes terminal key input for navigation and reject entry", () => {
    expect(decodeTerminalInput("j")).toEqual([{ kind: "down" }]);
    expect(decodeTerminalInput("k")).toEqual([{ kind: "up" }]);
    expect(decodeTerminalInput("[B")).toEqual([{ kind: "down" }]);
    expect(decodeTerminalInput("[A")).toEqual([{ kind: "up" }]);
    expect(decodeTerminalInput("a")).toEqual([{ kind: "approve" }]);
    expect(decodeTerminalInput("r")).toEqual([{ kind: "reject" }]);
    expect(decodeTerminalInput("q")).toEqual([{ kind: "quit" }]);
    expect(decodeTerminalInput("\r")).toEqual([{ kind: "submit" }]);
    expect(decodeTerminalInput("")).toEqual([{ kind: "backspace" }]);
    expect(decodeTerminalInput("")).toEqual([{ kind: "escape" }]);
    expect(decodeTerminalInput("no")).toEqual([
      { kind: "char", value: "n" },
      { kind: "char", value: "o" },
    ]);
  });

  it("treats printable keys as text while reject input is active", () => {
    expect(decodeTerminalInput("r", "reject_input")).toEqual([{ kind: "char", value: "r" }]);
    expect(decodeTerminalInput("q", "reject_input")).toEqual([{ kind: "char", value: "q" }]);
    expect(decodeTerminalInput("\r", "reject_input")).toEqual([{ kind: "submit" }]);
    expect(decodeTerminalInput("", "reject_input")).toEqual([{ kind: "escape" }]);
  });
});

describe("createTuiRuntime", () => {
  it("uses the selected approval thread for the initial screen state when pending approvals exist", async () => {
    const runtime = createTuiRuntime({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval: vi.fn(),
      },
      taskService: {
        async listThreads() {
          return [
            { id: "thread-1", fromUserId: "wxid_admin", title: "Failed thread", status: "failed" },
            { id: "thread-2", fromUserId: "wxid_admin", title: "Waiting thread", status: "waiting_approval" },
          ];
        },
        async listApprovals() {
          return [
            {
              id: "approval-1",
              threadId: "thread-2",
              status: "pending",
              action: { tool: "fs.write", input: {} },
              reply: "write config",
            },
          ];
        },
        async listEvents(threadId: string) {
          return threadId === "thread-2"
            ? [{ kind: "approval.requested", summary: "approval.requested: write config" }]
            : [{ kind: "thread.failed", summary: "thread.failed: too risky" }];
        },
      },
    });

    const state = await runtime.buildScreenState();

    expect(state.threadItems.find((thread) => thread.id === "thread-2")?.isSelected).toBe(true);
    expect(state.eventItems).toEqual([
      { id: "thread-2:approval.requested:0", summary: "approval.requested: write config" },
    ]);
  });

  it("keeps a recovered approval actionable after a restart-shaped snapshot", async () => {
    const resumeApproval = vi.fn();
    const runtime = createTuiRuntime({
      app: {
        resumeApproval,
        rejectApproval: vi.fn(),
      },
      taskService: {
        async listThreads() {
          return [
            { id: "thread-2", fromUserId: "wxid_admin", title: "Waiting thread", status: "waiting_approval" },
          ];
        },
        async listApprovals() {
          return [
            {
              id: "approval-1",
              threadId: "thread-2",
              status: "pending",
              action: { tool: "fs.write", input: {} },
              reply: "write config",
            },
          ];
        },
        async listEvents() {
          return [{ kind: "approval.requested", summary: "approval.requested: write config" }];
        },
      },
    });

    await runtime.applyInput({ kind: "approve" });

    expect(resumeApproval).toHaveBeenCalledWith("approval-1");
  });

  it("falls back to the latest waiting_approval thread when no approval is selected", async () => {
    const runtime = createTuiRuntime({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval: vi.fn(),
      },
      taskService: {
        async listThreads() {
          return [
            { id: "thread-1", fromUserId: "wxid_admin", title: "Older waiting thread", status: "waiting_approval" },
            { id: "thread-2", fromUserId: "wxid_admin", title: "Latest waiting thread", status: "waiting_approval" },
          ];
        },
        async listApprovals() {
          return [];
        },
        async listEvents(threadId: string) {
          return [{ kind: "approval.requested", summary: `approval.requested: ${threadId}` }];
        },
      },
    });

    const state = await runtime.buildScreenState();

    expect(state.threadItems.find((thread) => thread.id === "thread-2")?.isSelected).toBe(true);
    expect(state.eventItems).toEqual([
      { id: "thread-2:approval.requested:0", summary: "approval.requested: thread-2" },
    ]);
  });

  it("falls back to the latest failed thread when neither approvals nor waiting threads exist", async () => {
    const runtime = createTuiRuntime({
      app: {
        resumeApproval: vi.fn(),
        rejectApproval: vi.fn(),
      },
      taskService: {
        async listThreads() {
          return [
            { id: "thread-1", fromUserId: "wxid_admin", title: "Older failed thread", status: "failed" },
            { id: "thread-2", fromUserId: "wxid_admin", title: "Latest failed thread", status: "failed" },
          ];
        },
        async listApprovals() {
          return [];
        },
        async listEvents(threadId: string) {
          return [{ kind: "thread.failed", summary: `thread.failed: ${threadId}` }];
        },
      },
    });

    const state = await runtime.buildScreenState();

    expect(state.threadItems.find((thread) => thread.id === "thread-2")?.isSelected).toBe(true);
    expect(state.eventItems).toEqual([
      { id: "thread-2:thread.failed:0", summary: "thread.failed: thread-2" },
    ]);
  });
});

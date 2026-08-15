import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createTaskService } from "../../src/tasks/service.js";
import { ThreadRepository } from "../../src/store/repositories/threads.js";
import { ApprovalRepository } from "../../src/store/repositories/approvals.js";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { TEST_DATABASE_URL, cleanTables } from "../helpers/pg.js";

describe("TaskService", () => {
  it("reuses the latest unfinished thread for the same admin", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    const second = await service.receiveMessage({ fromUserId: "wxid_admin", text: "now summarize it" });

    expect(second.threadId).toBe(first.threadId);
    expect((await service.getThread(first.threadId))?.status).toBe("queued");
  });

  it("records lifecycle and approval state for a thread", async () => {
    const service = createTaskService();

    const received = await service.receiveMessage({ fromUserId: "wxid_admin", text: "run pwd" });
    await service.appendEvent(received.threadId, { kind: "plan.created", summary: "plan created" });
    await service.markWaitingApproval(received.threadId, { tool: "shell.exec", summary: "waiting for shell approval" });

    expect(await service.getThread(received.threadId)).toEqual(
      expect.objectContaining({
        id: received.threadId,
        title: "run pwd",
        status: "waiting_approval",
      }),
    );
    expect(await service.listEvents(received.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "plan.created", summary: "plan created" }),
        expect.objectContaining({ kind: "approval.requested", summary: "waiting for shell approval" }),
      ]),
    );
  });

  it("marks a thread failed with a failure event", async () => {
    const service = createTaskService();

    const received = await service.receiveMessage({ fromUserId: "wxid_admin", text: "run pwd" });
    await service.markFailed(received.threadId, "shell failed");

    expect((await service.getThread(received.threadId))?.status).toBe("failed");
    expect(await service.listEvents(received.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "thread.failed", summary: "shell failed" }),
      ]),
    );
  });

  it("reuses a waiting_approval thread for a second message from the same admin", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    await service.markWaitingApproval(first.threadId);

    const second = await service.receiveMessage({ fromUserId: "wxid_admin", text: "now summarize it" });

    expect((await service.getThread(first.threadId))?.status).toBe("waiting_approval");
    expect(second.threadId).toBe(first.threadId);
  });

  it("creates a new thread after the previous one is marked done", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    await service.markDone(first.threadId);

    const second = await service.receiveMessage({ fromUserId: "wxid_admin", text: "now summarize it" });

    expect((await service.getThread(first.threadId))?.status).toBe("done");
    expect(second.threadId).not.toBe(first.threadId);
    expect((await service.getThread(second.threadId))?.status).toBe("queued");
  });

  it("supports approval lifecycle: create, mark waiting, get pending, and mark approved", async () => {
    const service = createTaskService();

    const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    const threadId = result.threadId;

    const approval = await service.createApprovalRequest(threadId, { tool: "shell.exec", input: { command: "pwd" } }, "rm -rf /");
    expect(approval.approvalId).toBeTruthy();
    const approvalId = approval.approvalId;

    await service.markWaitingApproval(threadId, { tool: "shell.exec", summary: "rm -rf /" });
    expect((await service.getThread(threadId))?.status).toBe("waiting_approval");

    const pending = await service.getPendingApproval(approvalId);
    expect(pending).toBeTruthy();
    expect(pending?.id).toBe(approvalId);
    expect(pending?.action).toEqual({ tool: "shell.exec", input: { command: "pwd" } });
    expect(pending?.reply).toBe("rm -rf /");
    expect(pending?.status).toBe("pending");

    await service.markApproved(approvalId);
    const approved = await service.getPendingApproval(approvalId);
    expect(approved?.status).toBe("approved");
  });

  it("supports rejecting an approval in memory", async () => {
    const service = createTaskService();

    const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "run dangerous command" });
    const { approvalId } = await service.createApprovalRequest(
      result.threadId,
      { tool: "shell.exec", input: { command: "rm -rf /tmp/demo" } },
      "Reject this command?",
    );

    await service.markRejected(approvalId);

    const rejected = await service.getPendingApproval(approvalId);
    expect(rejected?.status).toBe("rejected");
  });

  it("lists threads and approvals in stable order with current statuses", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_alpha", text: "first task" });
    const second = await service.receiveMessage({ fromUserId: "wxid_beta", text: "second task" });

    await service.markDone(first.threadId);
    await service.markWaitingApproval(second.threadId, { tool: "shell.exec", summary: "needs approval" });

    const firstApproval = await service.createApprovalRequest(
      first.threadId,
      { tool: "shell.exec", input: { command: "pwd" } },
      "approve pwd",
    );
    const secondApproval = await service.createApprovalRequest(
      second.threadId,
      { tool: "fs.write", input: { path: "/tmp/demo" } },
      "write file",
    );

    await service.markApproved(firstApproval.approvalId);
    await service.markRejected(secondApproval.approvalId);

    expect(await service.listThreads()).toEqual([
      {
        id: first.threadId,
        fromUserId: "wxid_alpha",
        title: "first task",
        status: "done",
      },
      {
        id: second.threadId,
        fromUserId: "wxid_beta",
        title: "second task",
        status: "waiting_approval",
      },
    ]);
    expect(await service.listApprovals()).toEqual([
      {
        id: firstApproval.approvalId,
        threadId: first.threadId,
        status: "approved",
        action: { tool: "shell.exec", input: { command: "pwd" } },
        reply: "approve pwd",
      },
      {
        id: secondApproval.approvalId,
        threadId: second.threadId,
        status: "rejected",
        action: { tool: "fs.write", input: { path: "/tmp/demo" } },
        reply: "write file",
      },
    ]);
  });

  it("reuses a waiting approval thread for a second admin message", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    await service.markWaitingApproval(first.threadId);

    const second = await service.receiveMessage({ fromUserId: "wxid_admin", text: "now summarize it" });

    expect(second.threadId).toBe(first.threadId);
    expect((await service.getThread(first.threadId))?.status).toBe("waiting_approval");
  });

  it("creates a new thread after the previous thread is done", async () => {
    const service = createTaskService();

    const first = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
    await service.markDone(first.threadId);

    const second = await service.receiveMessage({ fromUserId: "wxid_admin", text: "start a new task" });

    expect(second.threadId).not.toBe(first.threadId);
    expect((await service.getThread(first.threadId))?.status).toBe("done");
    expect((await service.getThread(second.threadId))?.status).toBe("queued");
  });

  describe("with DB-backed repositories", () => {
    let pool: DbPool;
    let threadRepo: ThreadRepository;
    let approvalRepo: ApprovalRepository;

    beforeAll(async () => {
      pool = await createTestPgPool(TEST_DATABASE_URL);
    });

    beforeEach(async () => {
      await cleanTables(pool);
      threadRepo = new ThreadRepository(pool);
      approvalRepo = new ApprovalRepository(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    it("persists thread state changes to database", async () => {
      const service = createTaskService({ threadRepository: threadRepo, approvalRepository: approvalRepo });

      const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
      const threadId = result.threadId;

      await service.markWaitingApproval(threadId);

      const fetched = await threadRepo.get(threadId);
      expect(fetched).toBeTruthy();
      expect(fetched?.status).toBe("waiting_approval");

      await service.markDone(threadId);
      const updated = await threadRepo.get(threadId);
      expect(updated?.status).toBe("done");
    });

    it("persists events to database", async () => {
      const service = createTaskService({ threadRepository: threadRepo, approvalRepository: approvalRepo });

      const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
      const threadId = result.threadId;

      await service.appendEvent(threadId, { kind: "tool.completed", summary: "web search done" });
      await service.appendEvent(threadId, { kind: "tool.failed", summary: "network error" });

      const events = await threadRepo.listEvents(threadId);
      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe("tool.completed");
      expect(events[0].summary).toBe("web search done");
      expect(events[1].kind).toBe("tool.failed");
      expect(events[1].summary).toBe("network error");
    });

    it("persists approval requests to database", async () => {
      const service = createTaskService({ threadRepository: threadRepo, approvalRepository: approvalRepo });

      const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
      const threadId = result.threadId;

      const approval = await service.createApprovalRequest(
        threadId,
        { tool: "shell.exec", input: { command: "rm -rf /" } },
        "destructive command"
      );
      const approvalId = approval.approvalId;

      await service.markWaitingApproval(threadId);

      const fetched = await service.getPendingApproval(approvalId);
      expect(fetched).toBeTruthy();
      expect(fetched?.status).toBe("pending");
      expect(fetched?.action.tool).toBe("shell.exec");
      expect(fetched?.reply).toBe("destructive command");

      await service.markApproved(approvalId);
      const updated = await service.getPendingApproval(approvalId);
      expect(updated?.status).toBe("approved");
      expect((await approvalRepo.get(approvalId))?.status).toBe("approved");
    });

    it("persists rejected approvals to database", async () => {
      const service = createTaskService({ threadRepository: threadRepo, approvalRepository: approvalRepo });

      const result = await service.receiveMessage({ fromUserId: "wxid_admin", text: "search rustls" });
      const threadId = result.threadId;

      const approval = await service.createApprovalRequest(
        threadId,
        { tool: "shell.exec", input: { command: "rm -rf /tmp/demo" } },
        "reject this command",
      );

      await service.markRejected(approval.approvalId);

      const updated = await service.getPendingApproval(approval.approvalId);
      expect(updated?.status).toBe("rejected");
      expect((await approvalRepo.get(approval.approvalId))?.status).toBe("rejected");
    });

    it("lists repository-backed threads and approvals in stable order with current statuses", async () => {
      const service = createTaskService({ threadRepository: threadRepo, approvalRepository: approvalRepo });

      const first = await service.receiveMessage({ fromUserId: "wxid_alpha", text: "first persisted task" });
      const second = await service.receiveMessage({ fromUserId: "wxid_beta", text: "second persisted task" });

      await service.markDone(first.threadId);
      await service.markWaitingApproval(second.threadId, { tool: "shell.exec", summary: "needs approval" });

      const firstApproval = await service.createApprovalRequest(
        first.threadId,
        { tool: "shell.exec", input: { command: "pwd" } },
        "approve persisted pwd",
      );
      const secondApproval = await service.createApprovalRequest(
        second.threadId,
        { tool: "fs.write", input: { path: "/tmp/persisted-demo" } },
        "write persisted file",
      );

      await service.markApproved(firstApproval.approvalId);
      await service.markRejected(secondApproval.approvalId);

      expect(await service.listThreads()).toEqual([
        {
          id: first.threadId,
          fromUserId: "wxid_alpha",
          title: "first persisted task",
          status: "done",
        },
        {
          id: second.threadId,
          fromUserId: "wxid_beta",
          title: "second persisted task",
          status: "waiting_approval",
        },
      ]);
      expect(await service.listApprovals()).toEqual([
        {
          id: firstApproval.approvalId,
          threadId: first.threadId,
          status: "approved",
          action: { tool: "shell.exec", input: { command: "pwd" } },
          reply: "approve persisted pwd",
        },
        {
          id: secondApproval.approvalId,
          threadId: second.threadId,
          status: "rejected",
          action: { tool: "fs.write", input: { path: "/tmp/persisted-demo" } },
          reply: "write persisted file",
        },
      ]);
    });
  });
});

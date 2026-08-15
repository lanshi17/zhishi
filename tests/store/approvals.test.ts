import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { ApprovalRepository } from "../../src/store/repositories/approvals.js";
import { ThreadRepository } from "../../src/store/repositories/threads.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("ApprovalRepository", () => {
  let pool: DbPool;
  let threadRepo: ThreadRepository;
  let approvalRepo: ApprovalRepository;
  let threadId: string;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    threadRepo = new ThreadRepository(pool);
    approvalRepo = new ApprovalRepository(pool);
    const thread = await threadRepo.create({ sourceUserId: "wxid_admin", title: "Test thread" });
    threadId = thread.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates an approval request with action and reply", async () => {
    const approval = await approvalRepo.create({
      threadId,
      action: { tool: "shell.exec", input: { command: "rm -rf /" } },
      reply: "Execute dangerous command?",
    });

    expect(approval).toMatchObject({
      id: expect.any(String),
      threadId,
      status: "pending",
      action: { tool: "shell.exec", input: { command: "rm -rf /" } },
      reply: "Execute dangerous command?",
    });
  });

  it("retrieves approval request by id", async () => {
    const approval = await approvalRepo.create({
      threadId,
      action: { tool: "web.fetch", input: { url: "https://example.com" } },
      reply: "Fetch URL?",
    });

    const retrieved = await approvalRepo.get(approval.id);
    expect(retrieved).toEqual(approval);
  });

  it("marks approval as approved", async () => {
    const approval = await approvalRepo.create({
      threadId,
      action: { tool: "shell.exec", input: { command: "ls" } },
      reply: "List directory?",
    });

    await approvalRepo.markApproved(approval.id);

    const updated = await approvalRepo.get(approval.id);
    expect(updated?.status).toBe("approved");
  });

  it("marks approval as rejected", async () => {
    const approval = await approvalRepo.create({
      threadId,
      action: { tool: "shell.exec", input: { command: "pwd" } },
      reply: "Reject this command?",
    });

    await approvalRepo.markRejected(approval.id);

    const updated = await approvalRepo.get(approval.id);
    expect(updated?.status).toBe("rejected");
  });

  it("persists action as JSON in database", async () => {
    const complexAction = {
      tool: "shell.exec",
      input: {
        command: "npm run test",
        cwd: "/workspace",
        timeout: 30000,
      },
    };

    const approval = await approvalRepo.create({
      threadId,
      action: complexAction,
      reply: "Run tests?",
    });

    const retrieved = await approvalRepo.get(approval.id);
    expect(retrieved?.action).toEqual(complexAction);
  });
});

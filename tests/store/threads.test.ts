import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { ThreadRepository } from "../../src/store/repositories/threads.js";
import { TEST_DATABASE_URL, cleanTables, createHelperPool } from "../helpers/pg.js";

describe("ThreadRepository", () => {
  let pool: DbPool;
  let repo: ThreadRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repo = new ThreadRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates a thread and appends an event", async () => {
    const thread = await repo.create({ sourceUserId: "wxid_admin", title: "Fix tests" });
    await repo.appendEvent(thread.id, { kind: "message.received", summary: "please fix tests" });

    expect((await repo.get(thread.id))?.title).toBe("Fix tests");
    expect(await repo.listEvents(thread.id)).toHaveLength(1);
  });

  it("persists thread status and events", async () => {
    const thread = await repo.create({ sourceUserId: "wxid_admin", title: "Run smoke flow" });
    await repo.updateStatus(thread.id, "waiting_approval");
    await repo.appendEvent(thread.id, { kind: "approval.requested", summary: "shell.exec approval required" });

    expect(await repo.get(thread.id)).toEqual(
      expect.objectContaining({ id: thread.id, status: "waiting_approval" }),
    );
    expect(await repo.listEvents(thread.id)).toEqual([
      expect.objectContaining({ kind: "approval.requested", summary: "shell.exec approval required" }),
    ]);
  });
});

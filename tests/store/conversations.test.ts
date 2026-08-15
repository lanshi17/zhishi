import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPgPool, type DbPool } from "../../src/store/db.js";
import { ConversationRepository } from "../../src/store/repositories/conversations.js";
import { TEST_DATABASE_URL, cleanTables } from "../helpers/pg.js";

describe("ConversationRepository", () => {
  let pool: DbPool;
  let repository: ConversationRepository;

  beforeAll(async () => {
    pool = await createTestPgPool(TEST_DATABASE_URL);
  });

  beforeEach(async () => {
    await cleanTables(pool);
    repository = new ConversationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns the newest history that fits the token budget in chronological order", async () => {
    await repository.append({ userId: "wxid_user", role: "user", content: "first" });
    await repository.append({ userId: "wxid_user", role: "assistant", content: "second" });
    await repository.append({ userId: "wxid_user", role: "user", content: "third" });

    await expect(repository.listRecentByUserId("wxid_user", 19)).resolves.toEqual([
      expect.objectContaining({ role: "assistant", content: "second" }),
      expect.objectContaining({ role: "user", content: "third" }),
    ]);
  });
});

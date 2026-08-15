import type { DbPool } from "../db.js";
import type { EventInput } from "./events.js";
import type { TaskStatus } from "../../tasks/state-machine.js";

export type ThreadInput = {
  sourceUserId: string;
  title: string;
};

export type ThreadRecord = {
  id: string;
  sourceUserId: string;
  title: string;
  status: TaskStatus;
};

export type ThreadEventRecord = {
  id: string;
  threadId: string;
  kind: string;
  summary: string;
};

export class ThreadRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: ThreadInput): Promise<ThreadRecord> {
    const thread: ThreadRecord = {
      id: crypto.randomUUID(),
      sourceUserId: input.sourceUserId,
      title: input.title,
      status: "queued",
    };

    await this.pool.query(
      "INSERT INTO threads (id, source_user_id, title, status) VALUES ($1, $2, $3, $4)",
      [thread.id, thread.sourceUserId, thread.title, thread.status],
    );

    return thread;
  }

  async appendEvent(threadId: string, event: EventInput): Promise<ThreadEventRecord> {
    const record: ThreadEventRecord = {
      id: crypto.randomUUID(),
      threadId,
      kind: event.kind,
      summary: event.summary,
    };

    await this.pool.query(
      "INSERT INTO task_events (id, thread_id, kind, summary) VALUES ($1, $2, $3, $4)",
      [record.id, record.threadId, record.kind, record.summary],
    );

    return record;
  }

  async get(threadId: string): Promise<ThreadRecord | undefined> {
    const result = await this.pool.query(
      "SELECT id, source_user_id, title, status FROM threads WHERE id = $1",
      [threadId],
    );

    const row = result.rows[0] as
      | { id: string; source_user_id: string; title: string; status: TaskStatus }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      sourceUserId: row.source_user_id,
      title: row.title,
      status: row.status,
    };
  }

  async listAll(): Promise<ThreadRecord[]> {
    const result = await this.pool.query(
      "SELECT id, source_user_id, title, status FROM threads ORDER BY seq ASC",
    );

    return result.rows.map((row: { id: string; source_user_id: string; title: string; status: TaskStatus }) => ({
      id: row.id,
      sourceUserId: row.source_user_id,
      title: row.title,
      status: row.status,
    }));
  }

  async listBySourceUserId(sourceUserId: string): Promise<ThreadRecord[]> {
    const result = await this.pool.query(
      "SELECT id, source_user_id, title, status FROM threads WHERE source_user_id = $1 ORDER BY seq ASC",
      [sourceUserId],
    );

    return result.rows.map((row: { id: string; source_user_id: string; title: string; status: TaskStatus }) => ({
      id: row.id,
      sourceUserId: row.source_user_id,
      title: row.title,
      status: row.status,
    }));
  }

  async listEvents(threadId: string): Promise<ThreadEventRecord[]> {
    const result = await this.pool.query(
      "SELECT id, thread_id, kind, summary FROM task_events WHERE thread_id = $1 ORDER BY seq ASC",
      [threadId],
    );

    return result.rows.map((row: { id: string; thread_id: string; kind: string; summary: string }) => ({
      id: row.id,
      threadId: row.thread_id,
      kind: row.kind,
      summary: row.summary,
    }));
  }

  async updateStatus(threadId: string, status: string): Promise<void> {
    await this.pool.query(
      "UPDATE threads SET status = $1 WHERE id = $2",
      [status, threadId],
    );
  }
}

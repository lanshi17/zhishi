import type { DbPool } from "../db.js";
import type { ApprovalStatus } from "../../tasks/state-machine.js";

export type ApprovalAction = {
  tool: string;
  input: unknown;
};

export type ApprovalInput = {
  threadId: string;
  action: ApprovalAction;
  reply: string;
};

export type ApprovalRecord = {
  id: string;
  threadId: string;
  status: ApprovalStatus;
  action: ApprovalAction;
  reply: string;
};

export class ApprovalRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: ApprovalInput): Promise<ApprovalRecord> {
    const approval: ApprovalRecord = {
      id: crypto.randomUUID(),
      threadId: input.threadId,
      status: "pending",
      action: input.action,
      reply: input.reply,
    };

    await this.pool.query(
      "INSERT INTO approval_requests (id, thread_id, status, action, reply) VALUES ($1, $2, $3, $4, $5)",
      [
        approval.id,
        approval.threadId,
        approval.status,
        JSON.stringify(approval.action),
        approval.reply,
      ],
    );

    return approval;
  }

  async get(approvalId: string): Promise<ApprovalRecord | undefined> {
    const result = await this.pool.query(
      "SELECT id, thread_id, status, action, reply FROM approval_requests WHERE id = $1",
      [approvalId],
    );

    const row = result.rows[0] as
      | { id: string; thread_id: string; status: string; action: string; reply: string }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      threadId: row.thread_id,
      status: row.status as ApprovalStatus,
      action: JSON.parse(row.action) as ApprovalAction,
      reply: row.reply,
    };
  }

  async listAll(): Promise<ApprovalRecord[]> {
    const result = await this.pool.query(
      "SELECT id, thread_id, status, action, reply FROM approval_requests ORDER BY seq ASC",
    );

    return result.rows.map((row: { id: string; thread_id: string; status: string; action: string; reply: string }) => ({
      id: row.id,
      threadId: row.thread_id,
      status: row.status as ApprovalStatus,
      action: JSON.parse(row.action) as ApprovalAction,
      reply: row.reply,
    }));
  }

  async markApproved(approvalId: string): Promise<void> {
    await this.pool.query(
      "UPDATE approval_requests SET status = $1 WHERE id = $2",
      ["approved", approvalId],
    );
  }

  async markRejected(approvalId: string): Promise<void> {
    await this.pool.query(
      "UPDATE approval_requests SET status = $1 WHERE id = $2",
      ["rejected", approvalId],
    );
  }
}

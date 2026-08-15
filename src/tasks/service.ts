import { routeThread, type ThreadRecord } from "./thread-router.js";
import type { TaskEvent, ApprovalRecord } from "./state-machine.js";
import type { ThreadRepository } from "../store/repositories/threads.js";
import type { ApprovalRepository } from "../store/repositories/approvals.js";

export type MessageInput = {
  fromUserId: string;
  text: string;
};

export type TaskThread = ThreadRecord;

export type TaskServiceDeps = {
  threadRepository?: ThreadRepository;
  approvalRepository?: ApprovalRepository;
};

export function createTaskService({
  threadRepository,
  approvalRepository,
}: TaskServiceDeps = {}) {
  const threads: TaskThread[] = [];
  const events: Map<string, TaskEvent[]> = new Map();
  const approvals: Map<string, ApprovalRecord> = new Map();

  return {
    async receiveMessage(input: MessageInput): Promise<{ threadId: string }> {
      const existing = routeThread(threads, input.fromUserId);

      if (existing) {
        return { threadId: existing.id };
      }

      if (threadRepository) {
        const dbThreads = await threadRepository.listBySourceUserId(input.fromUserId);
        const persisted = routeThread(
          dbThreads.map((thread) => ({
            id: thread.id,
            fromUserId: thread.sourceUserId,
            status: thread.status,
          })),
          input.fromUserId,
        );

        if (persisted) {
          return { threadId: persisted.id };
        }
      }

      let threadId: string;

      if (threadRepository) {
        const created = await threadRepository.create({
          sourceUserId: input.fromUserId,
          title: input.text,
        });
        threadId = created.id;
      } else {
        threadId = crypto.randomUUID();
      }

      const thread: TaskThread = {
        id: threadId,
        fromUserId: input.fromUserId,
        title: input.text,
        status: "queued",
      };

      threads.push(thread);
      return { threadId };
    },

    async getThread(threadId: string): Promise<TaskThread | undefined> {
      const local = threads.find((thread) => thread.id === threadId);
      if (local) {
        return local;
      }

      if (!threadRepository) {
        return undefined;
      }

      const persisted = await threadRepository.get(threadId);
      if (!persisted) {
        return undefined;
      }

      return {
        id: persisted.id,
        fromUserId: persisted.sourceUserId,
        title: persisted.title,
        status: persisted.status,
      };
    },

    async listThreads(): Promise<TaskThread[]> {
      if (threadRepository) {
        const all = await threadRepository.listAll();
        return all.map((thread) => ({
          id: thread.id,
          fromUserId: thread.sourceUserId,
          title: thread.title,
          status: thread.status,
        }));
      }

      return [...threads];
    },

    async appendEvent(threadId: string, event: TaskEvent): Promise<void> {
      if (!events.has(threadId)) {
        events.set(threadId, []);
      }
      events.get(threadId)!.push(event);

      if (threadRepository) {
        await threadRepository.appendEvent(threadId, event);
      }
    },

    async listEvents(threadId: string): Promise<TaskEvent[]> {
      if (threadRepository) {
        const dbEvents = await threadRepository.listEvents(threadId);
        return dbEvents.map((event) => ({
          kind: event.kind,
          summary: event.summary,
        }));
      }

      return events.get(threadId) ?? [];
    },

    async markDone(threadId: string): Promise<void> {
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        thread.status = "done";
      }

      if (threadRepository) {
        await threadRepository.updateStatus(threadId, "done");
      }
    },

    async markFailed(threadId: string, reason: string): Promise<void> {
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        thread.status = "failed";
      }

      await this.appendEvent(threadId, { kind: "thread.failed", summary: reason });

      if (threadRepository) {
        await threadRepository.updateStatus(threadId, "failed");
      }
    },

    async createApprovalRequest(
      threadId: string,
      action: { tool: string; input: unknown },
      reply: string,
    ): Promise<{ approvalId: string }> {
      let approvalId: string;

      if (approvalRepository) {
        const created = await approvalRepository.create({
          threadId,
          action,
          reply,
        });
        approvalId = created.id;
        approvals.set(created.id, created);
      } else {
        approvalId = crypto.randomUUID();
        approvals.set(approvalId, {
          id: approvalId,
          threadId,
          action,
          reply,
          status: "pending",
        });
      }

      return { approvalId };
    },

    async markWaitingApproval(
      threadId: string,
      approval?: { tool: string; summary: string },
    ): Promise<void> {
      const thread = threads.find((t) => t.id === threadId);
      if (thread) {
        thread.status = "waiting_approval";
      }

      if (approval) {
        await this.appendEvent(threadId, {
          kind: "approval.requested",
          summary: approval.summary,
        });
      }

      if (threadRepository) {
        await threadRepository.updateStatus(threadId, "waiting_approval");
      }
    },

    async getPendingApproval(approvalId: string): Promise<ApprovalRecord | undefined> {
      if (approvalRepository) {
        const approval = await approvalRepository.get(approvalId);
        if (approval) {
          approvals.set(approvalId, approval);
        }
        return approval;
      }

      return approvals.get(approvalId);
    },

    async listApprovals(): Promise<ApprovalRecord[]> {
      if (approvalRepository) {
        const all = await approvalRepository.listAll();
        return all.map((approval) => ({
          id: approval.id,
          threadId: approval.threadId,
          action: approval.action,
          reply: approval.reply,
          status: approval.status,
        }));
      }

      return Array.from(approvals.values()).map((approval) => ({
        id: approval.id,
        threadId: approval.threadId,
        action: approval.action,
        reply: approval.reply,
        status: approval.status,
      }));
    },

    async markApproved(approvalId: string): Promise<void> {
      const approval = approvals.get(approvalId);
      if (approval) {
        approval.status = "approved";
      }

      if (approvalRepository) {
        await approvalRepository.markApproved(approvalId);
      }
    },

    async markRejected(approvalId: string): Promise<void> {
      const approval = approvals.get(approvalId);
      if (approval) {
        approval.status = "rejected";
      }

      if (approvalRepository) {
        await approvalRepository.markRejected(approvalId);
      }
    },
  };
}

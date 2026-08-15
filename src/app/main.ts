import type { HealthPipelineDeps } from "../agent/pipeline.js";
import type { AgentContext } from "../health/types.js";

type HealthPipeline = {
  handleMessage(userId: string, text: string, context: AgentContext, imageUrls?: string[]): Promise<string>;
};

type ContextBuilder = (userId: string) => Promise<AgentContext>;

export function createApplication(deps: {
  adminUserId: string;
  runtime: { planNext(): Promise<{ reply: string; actions: Array<{ tool: string; input: unknown }> }> };
  approvals: { classifyAction(action: { tool: string }): { decision: "auto_approve" | "approval_required" } };
  tools: { run(action: { tool: string; input: unknown }): Promise<{ ok: boolean; output: unknown }> };
  taskService: {
    receiveMessage(): Promise<{ threadId: string }>;
    appendEvent(threadId: string, event: { kind: string; [key: string]: unknown }): Promise<void>;
    markDone(threadId: string): Promise<void>;
    markFailed?(threadId: string, reason: string): Promise<void>;
    createApprovalRequest?(threadId: string, action: { tool: string; input: unknown }, reply: string): Promise<{ approvalId: string }>;
    markWaitingApproval?(threadId: string, approval: { tool: string; summary: string }): Promise<void>;
    getPendingApproval?(approvalId: string): Promise<
      | { id: string; threadId: string; action: { tool: string; input: unknown }; reply: string; status: string }
      | undefined
    >;
    markApproved?(approvalId: string): Promise<void>;
    markRejected?(approvalId: string): Promise<void>;
  };
  sendReply: (userId: string, text: string) => Promise<void> | void;
  healthPipeline?: HealthPipeline;
  buildContext?: ContextBuilder;
}) {
  return {
    async handleAdminMessage(message: { fromUserId: string; text: string; contextToken: string; imageUrls?: string[] }) {
      if (message.fromUserId !== deps.adminUserId) {
        return;
      }

      const { threadId } = await deps.taskService.receiveMessage();

      // Health pipeline flow: bypass tool execution, use pipeline directly
      process.stderr.write(`[main] handleAdminMessage: healthPipeline=${!!deps.healthPipeline}, buildContext=${!!deps.buildContext}, text="${message.text.slice(0, 30)}"\n`);
      if (deps.healthPipeline && deps.buildContext) {
        process.stderr.write(`[main] Using health pipeline flow\n`);
        try {
          const context = await deps.buildContext(message.fromUserId);
          const reply = await deps.healthPipeline.handleMessage(
            message.fromUserId,
            message.text,
            context,
            message.imageUrls,
          );
          await deps.taskService.appendEvent(threadId, {
            kind: "health.replied",
            summary: reply.slice(0, 200),
          });
          await deps.taskService.markDone(threadId);
          await deps.sendReply(message.fromUserId, reply);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await deps.taskService.markFailed?.(threadId, errMsg);
          await deps.sendReply(message.fromUserId, `处理失败：${errMsg}`);
        }
        return;
      }

      // Generic runtime flow (legacy)
      const plan = await deps.runtime.planNext();

      for (const action of plan.actions) {
        const classification = deps.approvals.classifyAction(action);
        if (classification.decision === "auto_approve") {
          const result = await deps.tools.run(action);
          await deps.taskService.appendEvent(threadId, {
            kind: "tool.completed",
            tool: action.tool,
            result,
          });
        } else if (classification.decision === "approval_required") {
          if (deps.taskService.createApprovalRequest && deps.taskService.markWaitingApproval) {
            const approval = await deps.taskService.createApprovalRequest(threadId, action, plan.reply);
            await deps.taskService.markWaitingApproval(threadId, {
              tool: action.tool,
              summary: plan.reply,
            });
            await deps.sendReply(message.fromUserId, `Action requires approval. Approval ID: ${approval.approvalId}`);
            return;
          }
        }
      }

      await deps.taskService.markDone(threadId);

      await deps.sendReply(message.fromUserId, plan.reply);
    },

    async resumeApproval(approvalId: string) {
      if (!deps.taskService.getPendingApproval || !deps.taskService.markApproved) {
        return;
      }

      const approval = await deps.taskService.getPendingApproval(approvalId);
      if (!approval) return;

      const { threadId, action, reply } = approval;
      await deps.taskService.markApproved(approvalId);

      const result = await deps.tools.run(action);
      await deps.taskService.appendEvent(threadId, {
        kind: "tool.completed",
        tool: action.tool,
        result,
      });

      await deps.taskService.markDone(threadId);
      await deps.sendReply(deps.adminUserId, reply);
    },

    async rejectApproval(approvalId: string, reason?: string) {
      if (!deps.taskService.getPendingApproval || !deps.taskService.markRejected) {
        return;
      }

      const approval = await deps.taskService.getPendingApproval(approvalId);
      if (!approval) return;

      const { threadId } = approval;
      const summary = reason ?? `Approval ${approvalId} was rejected.`;
      await deps.taskService.markRejected(approvalId);
      await deps.taskService.appendEvent(threadId, {
        kind: "approval.rejected",
        summary,
      });
      await deps.taskService.markFailed?.(threadId, summary);
      await deps.sendReply(deps.adminUserId, `Rejected approval ${approvalId}: ${summary}`);
    },
  };
}

import type { AgentProvider } from "./provider/base.js";
import type { AgentContext } from "../health/types.js";
import { buildSystemPrompt } from "./health-prompt.js";
import { createAgentLoop } from "./loop.js";
import { createHealthTools, type HealthToolsDeps } from "./tools/health-tools.js";
import type { ConversationRepository } from "../store/repositories/conversations.js";

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

export { type WebSearch } from "./tools/health-tools.js";

export type HealthPipelineDeps = HealthToolsDeps & {
  provider: AgentProvider;
  logger?: Logger;
  conversationRepository?: ConversationRepository;
  contextWindowTokens?: number;
};

type HealthPipeline = {
  handleMessage(userId: string, text: string, context: AgentContext, imageUrls?: string[]): Promise<string>;
};

/**
 * Health assistant agent. Instead of a hardcoded intent switch, the LLM is given
 * the health tool set and drives the conversation: it decides which tools to call
 * (record/query/correct/delete/report/advice/profile...) and when to stop, through
 * the generic function-calling loop in `src/agent/loop.ts`. The final model content
 * is the single user-facing reply.
 */
export function createHealthPipeline(deps: HealthPipelineDeps): HealthPipeline {
  const log = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const tools = createHealthTools(deps);
  const runLoop = createAgentLoop({
    provider: deps.provider,
    logger: deps.logger,
    requireToolCall: true,
  });

  async function handleMessage(
    userId: string,
    text: string,
    context: AgentContext,
    imageUrls?: string[],
  ): Promise<string> {
    log.info({ userId, text: text.slice(0, 50), images: imageUrls?.length ?? 0 }, "health pipeline handleMessage called");
    const system = buildSystemPrompt(context, imageUrls);
    const history = deps.conversationRepository
      ? await deps.conversationRepository.listRecentByUserId(userId, deps.contextWindowTokens ?? 256000)
      : [];

    await deps.conversationRepository?.append({
      userId,
      role: "user",
      content: text,
    });

    const reply = await runLoop({
      system,
      tools,
      messages: [
        ...history.map((message) => ({ role: message.role, content: message.content })),
        { role: "user" as const, content: text, imageUrls },
      ],
      ctx: { userId, text, imageUrls },
    });

    await deps.conversationRepository?.append({
      userId,
      role: "assistant",
      content: reply,
    });

    log.info({ userId, reply: reply.slice(0, 200) }, "health pipeline produced reply");
    return reply;
  }

  return { handleMessage };
}

import type { AgentProvider, ChatMessage } from "./provider/base.js";
import { toToolDefinition, type AgentTool, type ToolContext } from "./tool.js";

type Logger = {
  info(data: unknown, msg?: string): void;
  warn(data: unknown, msg?: string): void;
  error(data: unknown, msg?: string): void;
};

export type AgentLoopDeps = {
  provider: AgentProvider;
  maxIterations?: number;
  logger?: Logger;
  requireToolCall?: boolean;
};

/**
 * Generic function-calling agent loop. The model sees the tool definitions and
 * decides which tools to call; each result is fed back as a `tool` message and
 * the loop repeats until the model returns a final answer (or the iteration cap
 * is hit). Domain-agnostic — reuse for any agent by passing tools + system prompt.
 */
export function createAgentLoop(deps: AgentLoopDeps) {
  const maxIterations = deps.maxIterations ?? 8;
  const log = deps.logger ?? { info: () => {}, warn: () => {}, error: () => {} };

  return async function run(input: {
    system: string;
    tools: AgentTool[];
    messages: ChatMessage[];
    ctx: ToolContext;
  }): Promise<string> {
    const msgs: ChatMessage[] = [...input.messages];
    const tools = toToolDefinitions(input.tools);
    let hasCalledTool = false;

    for (let i = 0; i < maxIterations; i++) {
      log.info({ iteration: i + 1, messageCount: msgs.length }, "agent loop calling LLM");
      const result = await deps.provider.chat({ system: input.system, messages: msgs, tools });

      if (result.kind === "final") {
        if (deps.requireToolCall && !hasCalledTool) {
          throw new Error("LLM must call at least one tool before sending a final reply");
        }
        return result.content;
      }

      log.info({ toolCalls: result.toolCalls.map((t) => t.name) }, "agent loop executing tool calls");
      // Append the assistant's tool_calls message before the tool results (OpenAI protocol).
      msgs.push({ role: "assistant", content: undefined, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        const tool = input.tools.find((t) => t.name === call.name);
        let output: unknown;
        try {
          if (tool) {
            hasCalledTool = true;
            output = await tool.handler(call.arguments, input.ctx);
          } else {
            output = { error: `未知工具 ${call.name}` };
          }
        } catch (err) {
          output = { error: String(err) };
        }
        msgs.push({
          role: "tool",
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify(output),
        });
      }
    }

    log.warn({ iterations: maxIterations }, "agent loop hit iteration cap");
    return "抱歉，我这次没处理完，请再试一次或换个说法。";
  };
}

function toToolDefinitions(tools: AgentTool[]) {
  return tools.map((t) => toToolDefinition(t));
}

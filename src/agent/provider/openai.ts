import type {
  AgentAction,
  AgentPlan,
  AgentPlanInput,
  AgentProvider,
  ChatInput,
  ChatMessage,
  ChatResult,
  OpenAiCompatibleProviderConfig,
  ToolCall,
  ToolDefinition,
} from "./base.js";

export type OpenAiCompatibleTransport = {
  fetch: typeof fetch;
};

const SYSTEM_PROMPT = [
  "You are a planning assistant for a local automation workflow.",
  "Return plain text for direct replies.",
  "If tool execution is needed, return strict JSON: {\"reply\": string, \"actions\": [{\"tool\": string, \"input\": object}] }.",
].join(" ");

function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentAction(value: unknown): value is AgentAction {
  if (!isObject(value)) {
    return false;
  }

  return typeof value.tool === "string" && Object.prototype.hasOwnProperty.call(value, "input");
}

function parseStructuredPlan(content: string): AgentPlan {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse provider json plan: ${message}`);
  }

  if (!isObject(parsed)) {
    throw new Error("failed to parse provider json plan: expected object payload");
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply : "";

  // actions is required for legacy tool-execution format;
  // the health pipeline returns { intent, entities, reply } without actions,
  // so we default to empty when absent.
  let actions: AgentAction[] = [];
  if (Array.isArray(parsed.actions)) {
    if (!parsed.actions.every(isAgentAction)) {
      throw new Error("failed to parse provider json plan: actions entries must be { tool, input }");
    }
    actions = parsed.actions;
  }

  return {
    reply,
    actions,
    rawContent: content,
  };
}

function mapCompletionContent(content: string): AgentPlan {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error("openai provider returned empty message content");
  }

  // Strip markdown code block wrappers (```json ... ``` or ``` ... ```)
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  if (stripped.startsWith("{") || stripped.startsWith("[")) {
    return parseStructuredPlan(stripped);
  }

  return {
    reply: content,
    actions: [],
    rawContent: content,
  };
}

export function createOpenAiProvider(
  config: OpenAiCompatibleProviderConfig,
  transport: OpenAiCompatibleTransport = { fetch },
): AgentProvider {
  function parseToolArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw !== "string" || raw.trim().length === 0) return {};
    try {
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function toOpenAiMessages(messages: ChatMessage[]): unknown[] {
    return messages.map((m) => {
      if (m.role === "system") return { role: "system", content: m.content };
      if (m.role === "user") {
        if (m.imageUrls && m.imageUrls.length > 0 && config.supportsImageInput) {
          return {
            role: "user",
            content: [
              { type: "text", text: m.content },
              ...m.imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
            ],
          };
        }
        return { role: "user", content: m.content };
      }
      if (m.role === "assistant") {
        const msg: Record<string, unknown> = { role: "assistant", content: m.content ?? null };
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return msg;
      }
      return { role: "tool", tool_call_id: m.toolCallId, name: m.name, content: m.content };
    });
  }

  async function complete(params: {
    systemContent: string;
    openAiMessages: unknown[];
    tools?: ToolDefinition[];
    hasImages: boolean;
    imageCount: number;
  }): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.apiKey && config.apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const url = `${trimTrailingSlash(config.baseUrl)}/chat/completions`;
    const useVisionModel = params.hasImages && config.visionModel;
    const selectedModel = useVisionModel ? config.visionModel : config.model;

    const requestBody: Record<string, unknown> = {
      model: selectedModel,
      messages: [
        { role: "system", content: params.systemContent },
        ...params.openAiMessages,
      ],
      temperature: 0.1,
    };
    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools;
    }

    process.stderr.write(`[openai] model: ${selectedModel}, messages: ${params.openAiMessages.length}, tools: ${params.tools?.length ?? 0}, images: ${params.imageCount}\n`);

    let response: Response;
    try {
      response = await transport.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`openai provider request failed: ${message}`);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      const details = errorBody ? `: ${errorBody}` : "";
      throw new Error(`openai provider request failed with status ${response.status}${details}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`openai provider returned invalid json: ${message}`);
    }

    if (!isObject(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
      throw new Error("openai provider returned no completion choices");
    }

    const firstChoice = payload.choices[0];
    if (!isObject(firstChoice) || !isObject(firstChoice.message)) {
      throw new Error("openai provider returned empty message");
    }

    const message = firstChoice.message;
    const content = typeof message.content === "string" ? message.content : undefined;

    let toolCalls: ToolCall[] | undefined;
    if (Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls
        .filter((tc): tc is Record<string, unknown> => isObject(tc) && isObject(tc.function))
        .map((tc) => {
          const fn = tc.function as Record<string, unknown>;
          return {
            id: typeof tc.id === "string" ? tc.id : `call_${Math.random().toString(36).slice(2, 8)}`,
            name: typeof fn.name === "string" ? fn.name : "",
            arguments: parseToolArguments(fn.arguments),
          };
        })
        .filter((tc): tc is ToolCall => tc.name.length > 0);
    }

    process.stderr.write(`[openai] response: ${(content ?? toolCalls?.map((t) => `${t.name}(${JSON.stringify(t.arguments)})`).join(",") ?? "").slice(0, 300)}\n`);

    return { content, toolCalls };
  }

  return {
    config,
    async plan(input: AgentPlanInput): Promise<AgentPlan> {
      const hasImages = (input.imageUrls?.length ?? 0) > 0;
      const userMessages: unknown[] = hasImages && config.supportsImageInput
        ? [
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                ...input.imageUrls!.map((url) => ({ type: "image_url", image_url: { url } })),
              ],
            },
          ]
        : [{ role: "user", content: input.prompt }];

      const { content } = await complete({
        systemContent: input.systemPrompt ?? SYSTEM_PROMPT,
        openAiMessages: userMessages,
        hasImages,
        imageCount: input.imageUrls?.length ?? 0,
      });

      if (content === undefined || content.trim().length === 0) {
        throw new Error("openai provider returned empty message content");
      }

      return mapCompletionContent(content);
    },

    async chat(input: ChatInput): Promise<ChatResult> {
      const imageUrls = input.messages.flatMap((m) => (m.role === "user" ? (m.imageUrls ?? []) : []));
      const { content, toolCalls } = await complete({
        systemContent: input.system,
        openAiMessages: toOpenAiMessages(input.messages),
        tools: input.tools,
        hasImages: imageUrls.length > 0,
        imageCount: imageUrls.length,
      });

      if (toolCalls && toolCalls.length > 0) {
        return { kind: "tool_calls", toolCalls };
      }

      if (content === undefined || content.trim().length === 0) {
        throw new Error("openai provider returned empty message content");
      }

      return { kind: "final", content };
    },
  };
}

export type AgentAction = {
  tool: string;
  input: unknown;
};

export type AgentPlan = {
  reply: string;
  actions: AgentAction[];
  rawContent?: string;
};

export type AgentPlanInput = {
  threadId: string;
  prompt: string;
  systemPrompt?: string;
  imageUrls?: string[];
};

export type OpenAiCompatibleProviderConfig = {
  apiStyle: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKey?: string;
  supportsImageInput: boolean;
  visionModel?: string;
};

// ─── Native tool-calling (function calling) types ───

/** A tool call requested by the model. */
export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

/** OpenAI-style tool definition sent to the model. */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  imageUrls?: string[]; // user 带图
  toolCalls?: ToolCall[]; // assistant 发起的调用
  toolCallId?: string; // tool 回填时对应
  name?: string; // tool 回填时
};

export type ChatResult =
  | { kind: "final"; content: string }
  | { kind: "tool_calls"; toolCalls: ToolCall[] };

export type ChatInput = {
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
};

export type AgentProvider = {
  config?: OpenAiCompatibleProviderConfig;
  plan(input: AgentPlanInput): Promise<AgentPlan>;
  chat(input: ChatInput): Promise<ChatResult>;
};

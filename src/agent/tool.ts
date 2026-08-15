import type { ToolDefinition } from "./provider/base.js";

/**
 * A tool the agent can invoke. The model sees `name`/`description`/`parameters`
 * (via `toToolDefinition`), and the loop executes `handler` with the model's
 * arguments plus a per-turn context.
 */
export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export type ToolContext = {
  userId: string;
  text: string;
  imageUrls?: string[];
};

export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}
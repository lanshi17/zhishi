import { describe, expect, it, vi } from "vitest";
import { createAgentLoop, type AgentLoopDeps } from "../../src/agent/loop.js";
import type { AgentProvider, ChatResult } from "../../src/agent/provider/base.js";
import type { AgentTool } from "../../src/agent/tool.js";

function makeProvider(results: ChatResult[]): AgentProvider {
  let i = 0;
  return {
    plan: async () => ({ reply: "", actions: [] }),
    chat: async () => {
      const r = results[Math.min(i, results.length - 1)];
      i++;
      return r;
    },
  };
}

const echoTool: AgentTool = {
  name: "echo",
  description: "echo the input",
  parameters: { type: "object", properties: { value: { type: "string" } } },
  handler: async (input) => ({ echoed: input.value }),
};

const ctx = { userId: "u1", text: "hi" };

describe("createAgentLoop", () => {
  it("returns the final content when the model does not call tools", async () => {
    const loop = createAgentLoop({ provider: makeProvider([{ kind: "final", content: "hi there" }]) });
    const reply = await loop({ system: "sys", tools: [echoTool], messages: [{ role: "user", content: "hi" }], ctx });
    expect(reply).toBe("hi there");
  });

  it("rejects a direct final response when a tool call is required", async () => {
    const loop = createAgentLoop({
      provider: makeProvider([{ kind: "final", content: "hi there" }]),
      requireToolCall: true,
    } as AgentLoopDeps);

    await expect(
      loop({ system: "sys", tools: [echoTool], messages: [{ role: "user", content: "hi" }], ctx }),
    ).rejects.toThrow("LLM must call at least one tool before sending a final reply");
  });

  it("executes tool calls and appends assistant tool_calls + tool messages before the final reply", async () => {
    const handler = vi.fn().mockResolvedValue({ echoed: "hello" });
    const results: ChatResult[] = [
      { kind: "tool_calls", toolCalls: [{ id: "c1", name: "echo", arguments: { value: "hello" } }] },
      { kind: "final", content: "got: hello" },
    ];
    let i = 0;
    const capturedMessages: unknown[] = [];
    const provider: AgentProvider = {
      plan: async () => ({ reply: "", actions: [] }),
      chat: async ({ messages }) => {
        capturedMessages.push(messages);
        const r = results[Math.min(i, results.length - 1)];
        i++;
        return r;
      },
    };
    const loop = createAgentLoop({ provider });
    const tools = [{ ...echoTool, handler }];

    const reply = await loop({ system: "sys", tools, messages: [{ role: "user", content: "echo hello" }], ctx });

    expect(handler).toHaveBeenCalledWith({ value: "hello" }, ctx);
    expect(reply).toBe("got: hello");

    // Second chat call must carry assistant tool_calls THEN tool result.
    const secondCall = capturedMessages[1] as Array<{ role: string; toolCalls?: unknown[]; content?: unknown }>;
    expect(secondCall.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(secondCall[1]?.toolCalls).toEqual([{ id: "c1", name: "echo", arguments: { value: "hello" } }]);
    expect(secondCall[2]?.content).toBe(JSON.stringify({ echoed: "hello" }));
  });

  it("feeds an error message back for an unknown tool", async () => {
    const results: ChatResult[] = [
      { kind: "tool_calls", toolCalls: [{ id: "c1", name: "nope", arguments: {} }] },
      { kind: "final", content: "done" },
    ];
    const loop = createAgentLoop({ provider: makeProvider(results) });

    const reply = await loop({ system: "sys", tools: [echoTool], messages: [{ role: "user", content: "x" }], ctx });

    expect(reply).toBe("done");
  });

  it("feeds an error message back when a handler throws", async () => {
    const results: ChatResult[] = [
      { kind: "tool_calls", toolCalls: [{ id: "c1", name: "echo", arguments: {} }] },
      { kind: "final", content: "recovered" },
    ];
    const loop = createAgentLoop({ provider: makeProvider(results) });
    const tools = [{ ...echoTool, handler: async () => { throw new Error("boom"); } }];

    const reply = await loop({ system: "sys", tools, messages: [{ role: "user", content: "x" }], ctx });

    expect(reply).toBe("recovered");
  });

  it("returns a fallback message when the iteration cap is hit", async () => {
    const loop = createAgentLoop({ provider: makeProvider([toolCallsAlways()]), maxIterations: 3 });
    const reply = await loop({ system: "sys", tools: [echoTool], messages: [{ role: "user", content: "x" }], ctx });
    expect(reply).toContain("没处理完");
  });
});

function toolCallsAlways(): ChatResult {
  return { kind: "tool_calls", toolCalls: [{ id: "c", name: "echo", arguments: {} }] };
}

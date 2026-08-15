import { describe, expect, it, vi } from "vitest";
import { createAgentRuntime } from "../../src/agent/runtime.js";
import { createOpenAiProvider } from "../../src/agent/provider/openai.js";

describe("AgentRuntime", () => {
  it("turns a provider tool plan into executable actions", async () => {
    const runtime = createAgentRuntime({
      provider: {
        async plan() {
          return {
            reply: "Searching the web first.",
            actions: [{ tool: "web.search", input: { query: "rustls" } }],
          };
        },
        async chat() {
          return { kind: "final", content: "" };
        },
      },
    });

    const result = await runtime.planNext({ threadId: "t1", prompt: "search rustls" });

    expect(result.reply).toContain("Searching");
    expect(result.actions[0]?.tool).toBe("web.search");
  });

  it("consumes a real-provider plan without runtime changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "runtime hello" } }],
      }),
    });

    const provider = createOpenAiProvider(
      {
        apiStyle: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "qwen2.5-coder",
        apiKey: "",
        supportsImageInput: false,
      },
      { fetch: fetchMock as typeof fetch },
    );

    const runtime = createAgentRuntime({ provider });
    const result = await runtime.planNext({ threadId: "t-http", prompt: "say hello" });

    expect(result).toEqual({ reply: "runtime hello", actions: [], rawContent: "runtime hello" });
  });
});

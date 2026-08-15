import { describe, expect, it, vi } from "vitest";
import { createOpenAiProvider } from "../../../src/agent/provider/openai.js";

const baseConfig = {
  apiStyle: "openai-compatible" as const,
  baseUrl: "http://localhost:11434/v1",
  model: "qwen2.5-coder",
  apiKey: "secret",
  supportsImageInput: false,
};

describe("createOpenAiProvider", () => {
  it("calls the configured /chat/completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "hello from provider",
            },
          },
        ],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    await provider.plan({ threadId: "t-1", prompt: "say hello" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("includes Authorization header only when api key is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    const withKey = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
    await withKey.plan({ threadId: "t-1", prompt: "with key" });

    const withKeyOptions = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(withKeyOptions?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer secret",
      }),
    );

    const withoutKey = createOpenAiProvider({ ...baseConfig, apiKey: "" }, { fetch: fetchMock as typeof fetch });
    await withoutKey.plan({ threadId: "t-2", prompt: "without key" });

    const withoutKeyOptions = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(withoutKeyOptions?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
      }),
    );
    expect(withoutKeyOptions?.headers).not.toEqual(
      expect.objectContaining({
        Authorization: expect.any(String),
      }),
    );
  });

  it("maps plain text content to a reply-only plan", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "plain reply" } }],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    await expect(provider.plan({ threadId: "t-1", prompt: "hello" })).resolves.toEqual({
      reply: "plain reply",
      actions: [],
      rawContent: "plain reply",
    });
  });

  it("maps strict JSON content to an AgentPlan", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "Need approval",
                actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
              }),
            },
          },
        ],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    const jsonPayload = JSON.stringify({
      reply: "Need approval",
      actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
    });

    await expect(provider.plan({ threadId: "t-1", prompt: "run pwd" })).resolves.toEqual({
      reply: "Need approval",
      actions: [{ tool: "shell.exec", input: { command: "pwd" } }],
      rawContent: jsonPayload,
    });
  });

  it("throws on non-2xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    await expect(provider.plan({ threadId: "t-1", prompt: "hello" })).rejects.toThrow(/401/);
  });

  it("throws on malformed JSON planning payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"intent":"chat","reply":"test"' } }],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    await expect(provider.plan({ threadId: "t-1", prompt: "hello" })).rejects.toThrow(/parse/i);
  });

  it("leniently handles non-standard JSON shapes (health pipeline format)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"intent":"record_diet","entities":{},"reply":"hi"}' } }],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
    const result = await provider.plan({ threadId: "t-1", prompt: "hello" });
    expect(result.reply).toBe("hi");
    expect(result.actions).toEqual([]);
    expect(result.rawContent).toContain("record_diet");
  });

  it("throws when fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });

    await expect(provider.plan({ threadId: "t-1", prompt: "hello" })).rejects.toThrow(/network|request/i);
  });

  it("uses custom system prompt when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
    await provider.plan({
      threadId: "t-1",
      prompt: "hello",
      systemPrompt: "You are a health tracking assistant.",
    });

    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages[0]).toEqual({
      role: "system",
      content: "You are a health tracking assistant.",
    });
  });

  describe("chat (tool calling)", () => {
    it("sends tool definitions and returns a final reply when no tool is called", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "final answer" } }] }),
      });

      const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
      const result = await provider.chat({
        system: "sys",
        messages: [{ role: "user", content: "hello" }],
        tools: [{ type: "function", function: { name: "health.set_profile", description: "x", parameters: {} } }],
      });

      expect(result).toEqual({ kind: "final", content: "final answer" });

      const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.tools).toEqual([
        expect.objectContaining({ type: "function", function: expect.objectContaining({ name: "health.set_profile" }) }),
      ]);
    });

    it("maps message.tool_calls to a tool_calls result", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "health.record_diet", arguments: '{"foodName":"苹果","calories":95}' },
                  },
                ],
              },
            },
          ],
        }),
      });

      const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
      const result = await provider.chat({
        system: "sys",
        messages: [{ role: "user", content: "吃了一个苹果" }],
        tools: [],
      });

      expect(result).toEqual({
        kind: "tool_calls",
        toolCalls: [{ id: "call_1", name: "health.record_diet", arguments: { foodName: "苹果", calories: 95 } }],
      });
    });

    it("serializes assistant tool_calls and tool results back into the request messages", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "done" } }] }),
      });

      const provider = createOpenAiProvider(baseConfig, { fetch: fetchMock as typeof fetch });
      await provider.chat({
        system: "sys",
        tools: [],
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", toolCalls: [{ id: "c1", name: "echo", arguments: { value: "x" } }], content: undefined },
          { role: "tool", toolCallId: "c1", name: "echo", content: '{"echoed":"x"}' },
        ],
      });

      const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
      // body.messages = [system, user, assistant, tool]
      expect(body.messages[2]).toEqual({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "echo", arguments: '{"value":"x"}' } }],
      });
      expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", name: "echo", content: '{"echoed":"x"}' });
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createLightRagClient } from "../../src/health/lightrag.js";

function mockFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("createLightRagClient", () => {
  const config = {
    apiUrl: "http://localhost:9621",
    apiKey: "test-key",
    timeoutMs: 1000,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a query with correct payload and returns the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({ response: "鸡胸肉每100g约165kcal" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient(config);
    const result = await client.query("鸡胸肉 热量", "hybrid");

    expect(result.response).toBe("鸡胸肉每100g约165kcal");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9621/query",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
        body: JSON.stringify({ query: "鸡胸肉 热量", mode: "hybrid", stream: false }),
      }),
    );
  });

  it("defaults to hybrid mode when no mode is specified", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({ response: "result" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    await client.query("test query");

    const callBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(callBody.mode).toBe("hybrid");
  });

  it("falls back to result field when response field is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse({ result: "fallback result" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    const result = await client.query("test");

    expect(result.response).toBe("fallback result");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse("Internal Server Error", false, 500),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });

    await expect(client.query("test")).rejects.toThrow("LightRAG query failed: 500");
  });

  it("inserts documents with correct payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({}));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    await client.insert("some knowledge text");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9621/documents/text",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "some knowledge text", file_source: "api-insert" }),
      }),
    );
  });

  it("throws on insert failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchResponse("Bad Request", false, 400),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });

    await expect(client.insert("text")).rejects.toThrow("LightRAG insert failed: 400");
  });

  it("returns true on successful health check", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ status: "ok" }, true, 200));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    const healthy = await client.healthCheck();

    expect(healthy).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:9621/health",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns false on failed health check", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse("", false, 503));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    const healthy = await client.healthCheck();

    expect(healthy).toBe(false);
  });

  it("returns false on network error during health check", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    const healthy = await client.healthCheck();

    expect(healthy).toBe(false);
  });

  it("does not set Authorization header when no API key is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse({ response: "ok" }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createLightRagClient({ apiUrl: "http://localhost:9621" });
    await client.query("test");

    const callHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(callHeaders.Authorization).toBeUndefined();
  });
});

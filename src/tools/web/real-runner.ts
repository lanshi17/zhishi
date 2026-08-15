export function createRealWebFetch(timeoutMs = 10_000, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {
  return async function webFetch(input: { url: string }): Promise<{ url: string; text: string }> {
    let response: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      response = await fetchFn(input.url, { signal: controller.signal });
      clearTimeout(timer);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw new Error(`web.fetch: request timed out after ${timeoutMs}ms: ${input.url}`);
      }
      throw new Error(`web.fetch: network error: ${(cause as Error).message}`);
    }

    if (!response.ok) {
      throw new Error(`web.fetch: HTTP ${response.status} for ${input.url}`);
    }

    const text = await response.text();
    return { url: input.url, text };
  };
}

export type TavilySearchInput = {
  query: string;
  maxResults?: number;
};

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilySearchResponse = {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
};

export type TavilyClient = ReturnType<typeof createTavilyClient>;

export function createTavilyClient(config: { apiKey: string; timeoutMs?: number }) {
  const timeout = config.timeoutMs ?? 10000;
  const baseUrl = "https://api.tavily.com";

  return {
    async search(input: TavilySearchInput): Promise<TavilySearchResponse> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(`${baseUrl}/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            query: input.query,
            search_depth: "basic",
            max_results: input.maxResults ?? 5,
            include_answer: true,
            include_raw_content: false,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);
        }

        const data = await res.json();
        return {
          query: data.query ?? input.query,
          answer: data.answer,
          results: (data.results ?? []).map((r: Record<string, unknown>) => ({
            title: typeof r.title === "string" ? r.title : "",
            url: typeof r.url === "string" ? r.url : "",
            content: typeof r.content === "string" ? r.content : "",
            score: typeof r.score === "number" ? r.score : 0,
          })),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchOutput = {
  items: WebSearchResult[];
  answer?: string;
};

export function createTavilyWebSearch(tavily: TavilyClient) {
  return async function webSearch(input: { query: string }): Promise<WebSearchOutput> {
    const result = await tavily.search({ query: input.query, maxResults: 5 });
    return {
      items: result.results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.slice(0, 200),
      })),
      answer: result.answer,
    };
  };
}

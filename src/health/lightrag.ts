export type LightRagConfig = {
  apiUrl: string;
  apiKey?: string;
  timeoutMs?: number;
};

export type LightRagQueryMode = "naive" | "local" | "global" | "hybrid";

export type LightRagQueryResult = {
  response: string;
};

export function createLightRagClient(config: LightRagConfig) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const timeout = config.timeoutMs ?? 30000;

  return {
    async query(query: string, mode: LightRagQueryMode = "hybrid"): Promise<LightRagQueryResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(`${config.apiUrl}/query`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query, mode, stream: false }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`LightRAG query failed: ${res.status} ${await res.text()}`);
        }

        const data = await res.json();
        return { response: data.response ?? data.result ?? "" };
      } finally {
        clearTimeout(timer);
      }
    },

    async insert(text: string, fileSource?: string): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(`${config.apiUrl}/documents/text`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text, file_source: fileSource ?? "api-insert" }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`LightRAG insert failed: ${res.status} ${await res.text()}`);
        }
      } finally {
        clearTimeout(timer);
      }
    },

    async healthCheck(): Promise<boolean> {
      try {
        const res = await fetch(`${config.apiUrl}/health`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(2000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export type LightRagClient = ReturnType<typeof createLightRagClient>;

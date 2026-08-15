import { describe, expect, it, vi, beforeEach } from "vitest";
import { createKnowledgeService } from "../../src/health/knowledge.js";
import type { LightRagClient } from "../../src/health/lightrag.js";

function createMockClient(overrides: Partial<LightRagClient> = {}): LightRagClient {
  return {
    query: vi.fn().mockResolvedValue({ response: "" }),
    insert: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("createKnowledgeService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true when LightRAG health check succeeds", async () => {
      const client = createMockClient({ healthCheck: vi.fn().mockResolvedValue(true) });
      const service = createKnowledgeService(client);

      expect(await service.isAvailable()).toBe(true);
    });

    it("returns false when LightRAG health check fails", async () => {
      const client = createMockClient({ healthCheck: vi.fn().mockResolvedValue(false) });
      const service = createKnowledgeService(client);

      expect(await service.isAvailable()).toBe(false);
    });

    it("caches health check result for 30 seconds", async () => {
      const healthCheck = vi.fn().mockResolvedValue(true);
      const client = createMockClient({ healthCheck });
      const service = createKnowledgeService(client);

      await service.isAvailable();
      await service.isAvailable();

      expect(healthCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("lookupFood", () => {
    it("extracts calories from LightRAG response", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "鸡胸肉每100g约165kcal。蛋白质31g，脂肪3.6g，碳水0g",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupFood("鸡胸肉", 200, "g");

      expect(result.confidence).toBe("medium");
      expect(result.calories).toBe(165);
      expect(result.protein).toBe(31);
      expect(result.fat).toBe(3.6);
      expect(result.matchedName).toBe("鸡胸肉");
    });

    it("extracts calories from Chinese unit text", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "白米饭每100克热量：130大卡",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupFood("白米饭");

      expect(result.confidence).toBe("medium");
      expect(result.calories).toBe(130);
    });

    it("returns low confidence when no calories found in response", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "鸡胸肉是一种高蛋白低脂肪的食物",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupFood("鸡胸肉");

      expect(result.confidence).toBe("low");
      expect(result.calories).toBeUndefined();
    });

    it("returns low confidence when LightRAG is unavailable", async () => {
      const client = createMockClient({
        healthCheck: vi.fn().mockResolvedValue(false),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupFood("鸡胸肉");

      expect(result.confidence).toBe("low");
      expect(result.calories).toBeUndefined();
    });

    it("returns low confidence on query error", async () => {
      const client = createMockClient({
        query: vi.fn().mockRejectedValue(new Error("timeout")),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupFood("鸡胸肉");

      expect(result.confidence).toBe("low");
    });

    it("includes quantity and unit in the query when provided", async () => {
      const queryMock = vi.fn().mockResolvedValue({
        response: "每100g约130kcal",
      });
      const client = createMockClient({ query: queryMock });
      const service = createKnowledgeService(client);

      await service.lookupFood("米饭", 200, "g");

      expect(queryMock).toHaveBeenCalledWith("米饭 热量 营养素 200g", "hybrid");
    });
  });

  describe("lookupExercise", () => {
    it("extracts MET value from LightRAG response", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "跑步 MET值: 9.8，每小时消耗约700kcal",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupExercise("跑步", 30, "medium");

      expect(result.confidence).toBe("medium");
      expect(result.met).toBe(9.8);
      expect(result.calories).toBe(700);
    });

    it("returns low confidence when no MET or calories found", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "跑步是一项很好的有氧运动",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupExercise("跑步");

      expect(result.confidence).toBe("low");
      expect(result.met).toBeUndefined();
    });

    it("returns low confidence when LightRAG is unavailable", async () => {
      const client = createMockClient({
        healthCheck: vi.fn().mockResolvedValue(false),
      });
      const service = createKnowledgeService(client);

      const result = await service.lookupExercise("跑步");

      expect(result.confidence).toBe("low");
    });
  });

  describe("getAdvice", () => {
    it("returns advice lines from LightRAG response", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({
          response: "建议每日摄入2000kcal\n多吃蔬菜水果\n保持适量运动",
        }),
      });
      const service = createKnowledgeService(client);

      const result = await service.getAdvice("减脂饮食建议");

      expect(result.confidence).toBe("medium");
      expect(result.advice).toEqual([
        "建议每日摄入2000kcal",
        "多吃蔬菜水果",
        "保持适量运动",
      ]);
    });

    it("includes user context in the query when provided", async () => {
      const queryMock = vi.fn().mockResolvedValue({
        response: "建议多运动\n控制饮食",
      });
      const client = createMockClient({ query: queryMock });
      const service = createKnowledgeService(client);

      await service.getAdvice("减脂建议", { dailyIntake: 1800, weight: 70 });

      expect(queryMock).toHaveBeenCalledWith(
        "健康建议 减脂建议 dailyIntake: 1800, weight: 70",
        "hybrid",
      );
    });

    it("returns low confidence for empty response", async () => {
      const client = createMockClient({
        query: vi.fn().mockResolvedValue({ response: "" }),
      });
      const service = createKnowledgeService(client);

      const result = await service.getAdvice("test");

      expect(result.confidence).toBe("low");
    });

    it("returns low confidence when LightRAG is unavailable", async () => {
      const client = createMockClient({
        healthCheck: vi.fn().mockResolvedValue(false),
      });
      const service = createKnowledgeService(client);

      const result = await service.getAdvice("test");

      expect(result.confidence).toBe("low");
    });
  });
});

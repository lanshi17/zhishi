import { createOpenAiProvider } from "../src/agent/provider/openai.js";
import { buildSystemPrompt } from "../src/agent/health-prompt.js";

async function main() {
  const provider = createOpenAiProvider({
    apiStyle: "openai-compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "nex-agi/Nex-N2-Pro",
    apiKey: "sk-qmayqhrdwcueptprmytmjlqjpmbzfkfukzpvxukoxmyehfqu",
    supportsImageInput: true,
  });

  const context = {
    todayDietRecords: [],
    todayExerciseRecords: [],
    activeGoals: [],
    recentEvents: [],
    knowledgeAvailable: false,
  };

  const systemPrompt = buildSystemPrompt(context);

  async function test(msg: string) {
    console.log(`\n用户: ${msg}`);
    const result = await provider.plan({
      threadId: "test",
      prompt: msg,
      systemPrompt,
    });
    console.log("Raw content:", result.rawContent?.substring(0, 500));
  }

  await test("今天早餐吃了两个包子");
  await test("中午吃了一碗牛肉面和一杯可乐");
  await test("下午去健身房练了1小时力量训练");
  await test("设置每天摄入2000千卡的目标");
  await test("看看今天的报告");
}

main().catch(console.error);

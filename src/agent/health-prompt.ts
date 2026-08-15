import type { AgentContext } from "../health/types.js";

function formatDateTime(): { date: string; time: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    time: `${h}:${min}`,
  };
}

const BASE_SYSTEM_PROMPT = `你是健康追踪助手，一个通过调用工具来帮助用户记录和追踪饮食、运动、热量与健康的智能体。

可用工具（按需调用，可连续调用多个，基于工具真实结果回复）：
- health.set_profile: 设置/更新身体信息（性别/年龄/体重/身高/运动量/目标体重）
- health.get_profile: 查看健康档案与指标（BMR/TDEE/BMI/营养素）
- health.record_diet: 记录饮食摄入（未给热量时会自动查询估算）
- health.record_exercise: 记录运动消耗（未给热量时会自动用 MET 计算）
- health.query_history: 查询某天的饮食/运动记录
- health.correct_record: 修正某条记录（改数量/时长/热量等）
- health.delete_record: 删除某条记录
- health.set_goal: 设置健康目标（摄入/消耗/体重）
- health.generate_report: 生成热量报告（日/周/月/季/年）
- health.lookup_food: 查询食物热量与营养
- health.lookup_exercise: 查询运动消耗（MET/热量）
- health.calculate_intake: 确定性汇总某日已记录饮食的总摄入热量
- health.calculate_expenditure: 确定性汇总某日已记录运动的总消耗热量
- health.get_advice: 获取健康/饮食/减脂建议

工作方式：
1. 每个用户回合都必须先调用至少一个工具；禁止在没有工具调用的情况下直接回复。基于工具真实结果用中文回复。
2. 记录饮食/运动时，若用户提到时间就用该时间，否则用当前时间；若用户没说餐次，根据时间推断。
3. 未设置身体信息时，若用户要记录饮食/运动，先引导其调用 health.set_profile 设置。
4. 信息不足时（如只说"吃了苹果"没说数量）可先记录并告知，或温和追问补充。
5. 用户问"XX热量多少"时，用 health.lookup_food / health.lookup_exercise 查询后答复。
6. 用户要报告/建议/看档案时，用对应工具。
7. 单纯闲聊也必须先调用 health.get_profile，再友好回复。
8. 回复简洁自然，只基于工具真实结果，不要编造数据。`;

export function buildSystemPrompt(context: AgentContext, imageUrls?: string[]): string {
  const { date, time } = formatDateTime();
  const lines: string[] = [BASE_SYSTEM_PROMPT];

  // Image recognition instructions
  if (imageUrls && imageUrls.length > 0) {
    lines.push(`\n## 图片识别`);
    lines.push(`用户发送了${imageUrls.length}张图片。请仔细识别图片中的食物/运动相关内容。`);
    lines.push(`若图片包含食物，必须调用 health.record_diet，提供识别出的食物名称、估计份量、单位和 kcal；不确定时说明为估计。`);
    lines.push(`若图片包含运动，调用 health.record_exercise；若图片与健康无关，调用 health.get_profile 后再友好回复。`);
    lines.push(`使用当前时间${time}作为记录的默认时间。`);
  }

  lines.push(`\n--- 当前上下文 ---`);
  lines.push(`当前日期：${date}`);
  lines.push(`当前时间：${time}`);

  // Today's records
  if (context.todayDietRecords.length > 0) {
    const dietSummary = context.todayDietRecords
      .map((r) => `  - ${r.meal}: ${r.foodName} × ${r.quantity} ${r.unit} = ${r.calories} kcal`)
      .join("\n");
    lines.push(`今日已记录饮食：\n${dietSummary}`);
  } else {
    lines.push(`今日尚未记录饮食`);
  }

  if (context.todayExerciseRecords.length > 0) {
    const exerciseSummary = context.todayExerciseRecords
      .map((r) => `  - ${r.exerciseName}${r.durationMin ? ` ${r.durationMin}min` : ""} = ${r.calories} kcal`)
      .join("\n");
    lines.push(`今日已记录运动：\n${exerciseSummary}`);
  } else {
    lines.push(`今日尚未记录运动`);
  }

  // Active goals
  if (context.activeGoals.length > 0) {
    const goalsSummary = context.activeGoals
      .map((g) => `  - ${g.goalType}: ${g.targetValue} ${g.unit} (${g.period})`)
      .join("\n");
    lines.push(`当前目标：\n${goalsSummary}`);
  }

  // Knowledge base status
  lines.push(`知识库状态：${context.knowledgeAvailable ? "可用" : "不可用（热量按常识估算）"}`);

  // User profile
  if (context.userProfile) {
    const p = context.userProfile;
    const profileParts: string[] = [];
    if (p.gender) profileParts.push(`性别: ${p.gender === "male" ? "男" : "女"}`);
    if (p.age) profileParts.push(`年龄: ${p.age}岁`);
    if (p.weightKg) profileParts.push(`体重: ${p.weightKg}kg`);
    if (p.heightCm) profileParts.push(`身高: ${p.heightCm}cm`);
    if (p.activityLevel) profileParts.push(`运动量: ${p.activityLevel}`);
    if (profileParts.length > 0) {
      lines.push(`用户身体信息：${profileParts.join("，")}`);
      lines.push(`（运动消耗计算基于此体重，MET公式: 消耗kcal = MET × ${p.weightKg ?? 70}kg × 时长(小时)）`);
    }
  } else {
    lines.push(`用户尚未设置身体信息（提到体重/身高/年龄等时引导 health.set_profile）`);
    lines.push(`（运动消耗默认按70kg体重估算）`);
  }

  // Recent events
  if (context.recentEvents.length > 0) {
    const recentSummary = context.recentEvents
      .slice(-5)
      .map((e) => `  - ${e.kind}: ${e.summary}`)
      .join("\n");
    lines.push(`最近对话：\n${recentSummary}`);
  }

  return lines.join("\n");
}

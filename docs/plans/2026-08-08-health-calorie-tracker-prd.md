# PRD: 知食 (ZhīShí) 饮食运动热量追踪 Agent

> **项目代号**: 知食 (ZhīShí)（原 wechat_claw）
> **文档日期**: 2026-08-08
> **状态**: 活跃

---

## 1. 概述

将知食（原代号 wechat_claw）从通用 WeChat 自动化 Agent 转型为**个人健康热量追踪助手**。用户通过微信发送自然语言消息记录每日饮食摄入与运动消耗，程序使用 Agent 多流程解析自然语言、结构化存储记录，并按日/周/月/季/年生成热量报告。

存储层从 SQLite 迁移到 **PostgreSQL**，并外挂 **LightRAG 向量知识库**，用于准确查询食物热量、运动消耗数据及生成个性化健康建议。

### 1.1 核心价值

- **零摩擦记录**: 用户在微信中用自然语言说"今天中午吃了一碗牛肉面和一杯可乐"，程序自动解析食物名称、查询知识库获取准确热量并存储。
- **知识库驱动估算**: 不再依赖 LLM 的模糊常识，而是通过 LightRAG 图谱+向量检索从食物/运动知识库中获取准确热量数据。
- **智能消耗追踪**: 用户说"下午跑了5公里"，程序查询运动知识库估算消耗热量。
- **个性化建议**: 基于用户历史记录和知识库中的健康知识，生成有针对性的饮食运动建议。
- **周期性报告**: 自动生成每日/每周/每月/每季度/每年的热量收支报告。
- **持久化与恢复**: 所有记录持久化到 PostgreSQL，进程重启后历史数据完整保留。

### 1.2 非目标

- 不做医疗建议或健康诊断。
- 不做主动推送通知（MVP 阶段）。
- 不做多用户隔离（MVP 面向单管理员使用）。
- 不做食物图片识别（MVP 阶段）。

---

## 2. 用户场景

### 2.1 记录饮食

```
用户: 今天早餐吃了两个包子加一碗豆浆
Agent: ✅ 已记录早餐：
  - 包子 × 2 ≈ 220 kcal（知识库匹配：猪肉包子，每个约110kcal）
  - 豆浆 × 1 碗 ≈ 80 kcal（知识库匹配：无糖豆浆，每碗约80kcal）
  小计摄入：300 kcal
  今日已记录：早餐 300 kcal
```

### 2.2 记录运动

```
用户: 下午去健身房练了1小时力量训练
Agent: ✅ 已记录运动：
  - 力量训练 × 60 min ≈ 360 kcal（知识库匹配：中等强度力量训练，6 kcal/min）
  小计消耗：360 kcal
  今日已消耗：360 kcal
```

### 2.3 查询报告

```
用户: 看看今天的报告
Agent: 📊 今日热量报告（2026-08-08）
  摄入：1,850 kcal
  消耗：520 kcal
  净摄入：+1,330 kcal
  目标：2,000 kcal -> 已达 92.5%

  💡 知识库建议：今日蛋白质摄入偏低，建议晚餐补充鸡胸肉或鱼类。
```

### 2.4 查询周期报告

```
用户: 给我这周的报告
Agent: 📊 本周热量报告（08-04 ~ 08-08）
  平均日摄入：1,920 kcal
  平均日消耗：480 kcal
  平均日净摄入：+1,440 kcal
  本周趋势：摄入稳定，运动量偏低

  💡 知识库建议：本周运动消耗低于推荐值（日均500kcal），
  建议增加有氧运动，如慢跑30分钟可多消耗约200kcal。
```

### 2.5 自然语言纠正

```
用户: 刚才那个包子其实只吃了一个
Agent: ✅ 已修正：包子 × 1 ≈ 110 kcal
  早餐小计更新为：190 kcal
```

### 2.6 查询历史

```
用户: 我上周三吃了什么
Agent: 📅 2026-08-05 记录：
  早餐：油条 × 1 + 豆浆 × 1 ≈ 320 kcal
  午餐：米饭 × 1 + 宫保鸡丁 × 1 ≈ 680 kcal
  晚餐：面条 × 1 碗 ≈ 420 kcal
  运动：快走 30 min ≈ 150 kcal
  当日净摄入：+1,270 kcal
```

### 2.7 获取知识库建议

```
用户: 我最近总是吃的太多碳水，有什么建议
Agent: 💡 根据你的近30天记录分析：
  - 日均碳水摄入占比约 65%（推荐 50-60%）
  - 知识库建议：可尝试将部分主食替换为糙米或全麦面包，
    每100g糙米比白米少约20kcal，且饱腹感更强。
  - 适合你的低碳晚餐示例：鸡胸肉沙拉（约350kcal）+ 紫菜蛋花汤（约80kcal）
```

---

## 3. 系统架构

### 3.1 总体架构

```
WeChat 用户
    │
    ▼ 自然语言消息
iLink Gateway (长轮询)
    │
    ▼ InboundMessage
Application Handler
    │
    ▼ 消息文本 + 用户上下文
Agent Runtime (LLM 多流程编排)
    │
    ├──► 流程1: 意图识别 (intent classification)
    │       判断用户意图：记录饮食 / 记录运动 / 查询报告 / 修正记录 / 查询历史 / 获取建议 / 闲聊
    │
    ├──► 流程2: 实体抽取 (entity extraction)
    │       饮食：食物名称、数量、单位、餐次
    │       运动：运动类型、时长、距离、强度
    │
    ├──► 流程3: 知识库检索 (knowledge retrieval)  ← LightRAG
    │       查询食物热量、运动消耗、健康建议
    │       返回精确数值 + 参考来源 + 置信度
    │
    ├──► 流程4: 动作执行 (action execution)
    │       写入 PostgreSQL / 查询记录 / 生成报告
    │
    └──► 流程5: 回复生成 (reply generation)
            汇总结果 + 知识库建议，生成自然语言回复
    │
    ▼ 回复文本
iLink Gateway -> WeChat 用户
```

### 3.2 存储架构

```
┌─────────────────────────────────────────────────────┐
│                    应用层                            │
│                                                      │
│  ┌─────────────┐    ┌──────────────────────────┐    │
│  │  PostgreSQL  │    │     LightRAG             │    │
│  │  (结构化存储) │    │   (向量+图谱知识库)        │    │
│  │              │    │                          │    │
│  │ • diet_records│   │ • 食物热量知识            │    │
│  │ • exercise_  │    │ • 运动消耗知识            │    │
│  │   records    │    │ • 营养学知识              │    │
│  │ • user_goals │    │ • 健康建议模板            │    │
│  │ • report_    │    │ • 食物-营养关系图谱       │    │
│  │   snapshots  │    │ • 运动-消耗关系图谱       │    │
│  │ • threads    │    │                          │    │
│  │ • task_events│    │  检索方式:               │    │
│  │ • approvals  │    │  • 向量相似度检索         │    │
│  │              │    │  • 图谱关系遍历           │    │
│  │  事务性读写   │    │  • 混合检索 (hybrid)     │    │
│  └─────────────┘    └──────────────────────────┘    │
│         │                      │                     │
│         └──────────┬───────────┘                     │
│                    ▼                                 │
│           Agent Pipeline 编排                        │
└─────────────────────────────────────────────────────┘
```

### 3.3 Agent 多流程设计

Agent 不再是单次 `plan -> execute` 循环，而是引入**多步推理管道**。每条用户消息经过以下阶段处理：

| 阶段 | 输入 | 输出 | 说明 |
|------|------|------|------|
| **1. 意图识别** | 用户原始消息 + 对话上下文 | `Intent` 枚举 | 判断这是记录、查询、修正、建议还是普通对话 |
| **2. 实体抽取** | 用户消息 + 意图 | 结构化 `Record` 或 `Query` | 从自然语言中提取食物/运动/时间/数量等结构化数据 |
| **3. 知识库检索** | 结构化 `Record` | 带 kcal + 来源 + 建议的 `Record` | 查询 LightRAG 获取精确热量数据和健康建议 |
| **4. 动作执行** | 带估算的 `Record` 或 `Query` | 执行结果 | 持久化写入 PostgreSQL 或查询数据库 |
| **5. 回复生成** | 执行结果 + 知识库建议 + 原始意图 | 自然语言回复文本 | 生成用户友好的中文回复 |

每个阶段的输出作为下一阶段的输入，形成管道式处理。若某阶段失败（如知识库无法匹配食物），降级为 LLM 内置估算并标注低置信度。

### 3.4 意图分类

```typescript
type Intent =
  | { kind: "record_diet"; meal?: "breakfast" | "lunch" | "dinner" | "snack" }
  | { kind: "record_exercise"; exerciseType?: string }
  | { kind: "query_report"; period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly"; date?: string }
  | { kind: "query_history"; date: string }
  | { kind: "correct_record"; targetDescription: string }
  | { kind: "set_goal"; goalType: "calorie_intake" | "calorie_burn" | "weight"; value: number }
  | { kind: "get_advice"; topic?: string }  // 获取知识库建议
  | { kind: "chat" };  // 兜底闲聊
```

---

## 4. 数据模型

### 4.1 PostgreSQL Schema

使用 PostgreSQL 替代现有 SQLite。以下为完整 schema（包含迁移后的现有表 + 新增表）：

```sql
-- ============================================================
-- 迁移表：从 SQLite 迁移过来的现有表（DDL 适配 PostgreSQL）
-- ============================================================

-- 线程表（保留，用于对话上下文管理）
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  source_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
);

-- 任务事件表（保留，用于对话历史记录）
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  kind TEXT NOT NULL,
  summary TEXT NOT NULL
);

-- 审批表（保留，MVP 阶段全部自动审批，但保留表结构）
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  status TEXT NOT NULL DEFAULT 'pending',
  action TEXT NOT NULL,        -- JSON string
  reply TEXT NOT NULL
);

-- ============================================================
-- 新增表：健康追踪领域
-- ============================================================

-- 饮食记录表
CREATE TABLE IF NOT EXISTS diet_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  food_name TEXT NOT NULL,                    -- 食物名称，如 "牛肉面"
  quantity REAL NOT NULL DEFAULT 1,            -- 数量
  unit TEXT NOT NULL DEFAULT '份',             -- 单位：碗/个/杯/克/ml
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
  calories REAL NOT NULL,                     -- 估算热量 kcal
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  kb_source TEXT,                              -- 知识库匹配来源（LightRAG 返回的 reference）
  kb_matched_name TEXT,                        -- 知识库匹配到的标准食物名
  raw_text TEXT NOT NULL,                      -- 用户原始输入文本
  record_date DATE NOT NULL,                   -- 记录日期
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 运动记录表
CREATE TABLE IF NOT EXISTS exercise_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_name TEXT NOT NULL,                 -- 运动名称，如 "跑步"
  duration_min REAL,                           -- 时长（分钟）
  distance_km REAL,                            -- 距离（公里），可选
  intensity TEXT CHECK (intensity IN ('low', 'medium', 'high')),
  calories REAL NOT NULL,                      -- 估算消耗 kcal
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  kb_source TEXT,                              -- 知识库匹配来源
  kb_matched_name TEXT,                        -- 知识库匹配到的标准运动名
  raw_text TEXT NOT NULL,
  record_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 用户目标表
CREATE TABLE IF NOT EXISTS user_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('calorie_intake', 'calorie_burn', 'weight')),
  target_value REAL NOT NULL,
  unit TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT 'daily' CHECK (period IN ('daily', 'weekly', 'monthly')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 报告快照表（缓存已生成的报告）
CREATE TABLE IF NOT EXISTS report_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  summary_json JSONB NOT NULL,                 -- 完整报告 JSON
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_diet_user_date ON diet_records(user_id, record_date);
CREATE INDEX IF NOT EXISTS idx_diet_user_meal ON diet_records(user_id, record_date, meal);
CREATE INDEX IF NOT EXISTS idx_exercise_user_date ON exercise_records(user_id, record_date);
CREATE INDEX IF NOT EXISTS idx_report_user_period ON report_snapshots(user_id, period_type, period_start);
CREATE INDEX IF NOT EXISTS idx_goals_user_active ON user_goals(user_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_events_thread ON task_events(thread_id);
```

### 4.2 领域类型

```typescript
// 饮食记录
type DietRecord = {
  id: string;
  userId: string;
  foodName: string;
  quantity: number;
  unit: string;
  meal: "breakfast" | "lunch" | "dinner" | "snack";
  calories: number;
  confidence: "low" | "medium" | "high";
  kbSource?: string;        // LightRAG 返回的知识来源
  kbMatchedName?: string;   // 知识库匹配到的标准名
  rawText: string;
  recordDate: string;       // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
};

// 运动记录
type ExerciseRecord = {
  id: string;
  userId: string;
  exerciseName: string;
  durationMin?: number;
  distanceKm?: number;
  intensity?: "low" | "medium" | "high";
  calories: number;
  confidence: "low" | "medium" | "high";
  kbSource?: string;
  kbMatchedName?: string;
  rawText: string;
  recordDate: string;
  createdAt: string;
  updatedAt: string;
};

// 知识库查询结果
type KnowledgeResult = {
  matched: boolean;
  standardName?: string;      // 知识库中的标准名称
  calories?: number;          // 查到的热量值
  unit?: string;              // 热量对应的单位
  confidence: "low" | "medium" | "high";
  reference?: string;         // 来源引用
  relatedAdvice?: string[];   // 关联建议
  nutritionBreakdown?: {      // 营养素分解（食物）
    protein?: number;         // 蛋白质 g
    carbs?: number;           // 碳水 g
    fat?: number;             // 脂肪 g
    fiber?: number;           // 纤维 g
  };
};

// 报告
type Report = {
  periodType: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  periodStart: string;
  periodEnd: string;
  totalIntake: number;
  totalBurn: number;
  netCalories: number;
  avgDailyIntake: number;
  avgDailyBurn: number;
  recordCount: number;
  dietBreakdown: Array<{ meal: string; calories: number; percentage: number }>;
  exerciseBreakdown: Array<{ name: string; calories: number; percentage: number }>;
  trend?: "increasing" | "decreasing" | "stable";
  insights: string[];        // LLM + 知识库生成的洞察
  advice: string[];          // 知识库生成的建议
};
```

---

## 5. LightRAG 知识库

### 5.1 概述

[LightRAG](https://github.com/HKUDS/LightRAG) 是一个结合知识图谱与向量检索的 RAG 框架。本项目将其作为外挂知识库，为 Agent 提供准确的食物热量、运动消耗数据和健康建议。

### 5.2 知识库内容

知识库需要预先导入以下领域的结构化 + 半结构化知识：

#### 5.2.1 食物热量知识

```
# 格式示例（导入 LightRAG 的原始文本）

【包子-猪肉馅】
类别：主食/面点
单位：每个（约80g）
热量：约 110 kcal
蛋白质：7g | 碳水：15g | 脂肪：3g
关联：早餐常见主食，可与豆浆搭配。碳水含量较高，
减脂期建议替换为全麦馒头（每个约90kcal，碳水12g）。

【牛肉面】
类别：主食/面条
单位：每碗（约500g含汤）
热量：约 280 kcal（面+汤，不含额外配料）
蛋白质：12g | 碳水：35g | 脂肪：8g
关联：午餐主食。若加辣油每勺+45kcal。
高钠食品，高血压人群注意摄入量。
```

#### 5.2.2 运动消耗知识

```
【跑步-中等配速】
类别：有氧运动
单位：每公里
热量消耗：约 60 kcal（70kg体重参考）
影响因素：体重每+10kg 消耗+15%，配速越快消耗越高
关联：适合减脂，建议配合力量训练。
30分钟中等配速跑步约消耗300kcal。

【力量训练-中等强度】
类别：无氧运动
单位：每分钟
热量消耗：约 6 kcal
影响因素：复合动作（深蹲/硬拉）消耗高于孤立动作
关联：增肌减脂均推荐。运动后过量氧耗(EPOC)可持续燃脂数小时。
建议每周至少2次，每次45-60分钟。
```

#### 5.2.3 健康建议知识

```
【膳食指南-碳水比例】
成人每日碳水摄入建议占总热量的50-65%。
减脂期可降至40-50%，但不宜长期低于30%。
优质碳水来源：糙米、全麦面包、燕麦、红薯。

【运动建议-周运动量】
WHO建议成人每周至少150分钟中等强度有氧运动
或75分钟高强度有氧运动，外加2次力量训练。
对应热量消耗约：每周 500-800 kcal。
```

### 5.3 LightRAG 集成架构

```
┌─────────────────────────────────────────┐
│            Agent Pipeline               │
│                                         │
│  Stage 3: 知识库检索                     │
│       │                                 │
│       ▼                                 │
│  ┌─────────────────────────────────┐    │
│  │      KnowledgeService           │    │
│  │  (src/health/knowledge.ts)      │    │
│  │                                 │    │
│  │  lookupFood(name, quantity)     │    │
│  │  lookupExercise(name, duration) │    │
│  │  getAdvice(topic, userContext)  │    │
│  │       │                         │    │
│  │       ▼                         │    │
│  │  ┌───────────────────────────┐  │    │
│  │  │   LightRAG Client         │  │    │
│  │  │  (src/health/lightrag.ts)  │  │    │
│  │  │                           │  │    │
│  │  │  • HTTP API 调用 LightRAG │  │    │
│  │  │    服务实例               │  │    │
│  │  │  • query(mode=hybrid)     │  │    │
│  │  │  • insert(食物/运动文档)   │  │    │
│  │  └───────────────────────────┘  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│     LightRAG Server (独立进程)           │
│                                         │
│  • 向量存储: PostgreSQL + pgvector      │
│  • 知识图谱: 图谱实体+关系存储           │
│  • 嵌入模型: 配置的 embedding LLM       │
│  • 检索模式: naive / local / global /   │
│              hybrid                     │
│                                         │
│  预导入知识:                             │
│  • 常见食物热量数据（约2000条）           │
│  • 常见运动消耗数据（约500条）            │
│  • 膳食指南 & 健康建议（约300条）         │
│  • 食物-营养素关系图谱                    │
│  • 运动-肌群-消耗关系图谱                 │
└─────────────────────────────────────────┘
```

### 5.4 LightRAG 检索流程

```typescript
// src/health/knowledge.ts

type KnowledgeQuery = {
  foodName?: string;
  exerciseName?: string;
  topic?: string;        // 建议主题，如 "低碳饮食" "增肌"
  userContext?: {        // 用户上下文，用于个性化建议
    recentIntake?: number;
    recentBurn?: number;
    goalType?: string;
    targetCalorie?: number;
  };
};

type KnowledgeResponse = {
  calories?: number;
  confidence: "low" | "medium" | "high";
  matchedName?: string;
  reference?: string;
  nutritionBreakdown?: { protein?: number; carbs?: number; fat?: number; fiber?: number };
  advice?: string[];
};

async function lookupFood(foodName: string, quantity: number, unit: string): Promise<KnowledgeResponse> {
  // 1. 构造检索 query
  const query = `食物 "${foodName}" 的热量、营养成分，每${unit}多少千卡`;

  // 2. 调用 LightRAG hybrid 检索
  const result = await lightragClient.query(query, { mode: "hybrid" });

  // 3. 解析返回结果，提取热量数值和营养素
  //    若未匹配到精确食物，降级为模糊匹配
  //    若仍无结果，返回 confidence: "low"，由 Agent 降级到 LLM 估算
  return parseFoodKnowledge(result, foodName, quantity, unit);
}

async function lookupExercise(
  exerciseName: string,
  durationMin?: number,
  intensity?: string
): Promise<KnowledgeResponse> {
  const query = `运动 "${exerciseName}" ${intensity ?? "中等"}强度 的热量消耗，每分钟多少千卡`;
  const result = await lightragClient.query(query, { mode: "hybrid" });
  return parseExerciseKnowledge(result, exerciseName, durationMin, intensity);
}

async function getAdvice(topic: string, userContext?: KnowledgeQuery["userContext"]): Promise<string[]> {
  const contextStr = userContext
    ? `用户近7天日均摄入${userContext.recentIntake}kcal，消耗${userContext.recentBurn}kcal，目标${userContext.targetCalorie}kcal。`
    : "";
  const query = `${contextStr}关于"${topic}"的饮食运动建议`;
  const result = await lightragClient.query(query, { mode: "hybrid" });
  return parseAdvice(result);
}
```

### 5.5 降级策略

当 LightRAG 知识库不可用时（服务宕机、网络故障、无匹配结果）：

1. **食物热量**: 降级为 LLM 内置常识估算，`confidence` 标记为 `low`，`kbSource` 为空。
2. **运动消耗**: 同上降级。
3. **健康建议**: 降级为 LLM 基于用户历史数据生成的通用建议，不引用知识库。
4. **健康检查**: 启动时检测 LightRAG 服务连通性，日志记录但**不阻断启动**。

---

## 6. Agent 流程详细设计

### 6.1 系统提示词（System Prompt）

```text
你是一个个人健康热量追踪助手。用户通过微信发送自然语言消息，你需要：
1. 理解用户意图（记录饮食/记录运动/查询报告/修正记录/查询历史/设置目标/获取建议/闲聊）
2. 从自然语言中提取结构化信息（食物名称、数量、运动类型、时长等）
3. 使用知识库检索结果获取精确热量（若知识库返回结果，以此为准；若未返回，使用你的常识估算并标注低置信度）
4. 根据意图执行对应操作并生成友好回复

返回格式为 JSON：
{
  "intent": "record_diet" | "record_exercise" | "query_report" | "query_history" | "correct_record" | "set_goal" | "get_advice" | "chat",
  "entities": { ... },
  "reply": "给用户的自然语言回复"
}

注意事项：
- 热量数值优先使用知识库返回的精确值，标注 confidence 和 kb_source
- 回复中包含知识库匹配信息（如"知识库匹配：猪肉包子，每个约110kcal"）
- 报告和建议中融入知识库的健康建议内容
- 无法识别食物/运动时，主动追问用户而非强行记录
```

### 6.2 管道流程伪代码

```typescript
async function handleMessage(userId: string, text: string): Promise<string> {
  // Stage 1: 意图识别 + 实体抽取（单次 LLM 调用）
  const parsed = await agent.parse({
    userId,
    text,
    context: await loadRecentContext(userId),
  });

  // Stage 2: 知识库检索（仅对需要热量估算的意图）
  let knowledgeResult: KnowledgeResponse | undefined;
  if (parsed.intent === "record_diet" && parsed.entities.foodName) {
    knowledgeResult = await knowledgeService.lookupFood(
      parsed.entities.foodName,
      parsed.entities.quantity,
      parsed.entities.unit,
    );
  } else if (parsed.intent === "record_exercise" && parsed.entities.exerciseName) {
    knowledgeResult = await knowledgeService.lookupExercise(
      parsed.entities.exerciseName,
      parsed.entities.durationMin,
      parsed.entities.intensity,
    );
  } else if (parsed.intent === "get_advice") {
    const advice = await knowledgeService.getAdvice(
      parsed.entities.topic ?? "general",
      await loadUserContext(userId),
    );
    return formatAdviceReply(advice, parsed.entities.topic);
  }

  // 合并知识库结果到 entities（覆盖 LLM 估算值）
  if (knowledgeResult?.calories !== undefined) {
    parsed.entities.calories = knowledgeResult.calories;
    parsed.entities.confidence = knowledgeResult.confidence;
    parsed.entities.kbSource = knowledgeResult.reference;
    parsed.entities.kbMatchedName = knowledgeResult.matchedName;
  }

  // Stage 3: 根据意图路由执行（PostgreSQL 持久化）
  switch (parsed.intent) {
    case "record_diet": {
      const record = await dietRepo.create({ userId, ...parsed.entities, recordDate: today() });
      const todaySummary = await dietRepo.getDailySummary(userId, today());
      return formatDietReply(record, todaySummary, knowledgeResult);
    }
    case "record_exercise": {
      const record = await exerciseRepo.create({ userId, ...parsed.entities, recordDate: today() });
      const todaySummary = await exerciseRepo.getDailySummary(userId, today());
      return formatExerciseReply(record, todaySummary, knowledgeResult);
    }
    case "query_report": {
      const report = await reportService.generate({
        userId,
        period: parsed.entities.period,
        date: parsed.entities.date ?? today(),
      });
      return formatReport(report);
    }
    case "query_history": {
      const records = await recordService.getByDate(userId, parsed.entities.date);
      return formatHistory(records, parsed.entities.date);
    }
    case "correct_record": {
      const updated = await recordService.correctRecord(userId, parsed.entities);
      return formatCorrection(updated);
    }
    case "set_goal": {
      await goalRepo.set({ userId, ...parsed.entities });
      return formatGoalReply(parsed.entities);
    }
    case "chat":
    default:
      return parsed.reply;
  }
}
```

### 6.3 上下文管理

每次 LLM 调用需要携带用户上下文：

- **今日已有记录**: 从 PostgreSQL 查询今日饮食+运动记录，让 Agent 知道已记录内容。
- **最近对话历史**: 从 `conversation_messages` 表按用户恢复，并按 `LLM_CONTEXT_WINDOW` 的 token 预算裁剪，支持跨线程、跨重启的上下文理解。
- **工具调用约束**: 每个用户回合必须至少成功调用一个已注册工具后才能输出最终回复；直接 LLM 文本不会被作为成功回复放行。
- **确定性热量汇总**: `health.calculate_intake` 和 `health.calculate_expenditure` 分别汇总数据库中某日饮食与运动记录的 kcal，不使用 LLM 估算。
- **基础代谢**: 总消耗为已记录运动消耗加上档案完整时按 Mifflin–St Jeor 公式计算的 BMR；日报、周报、月报、季报、年报均展示该组成。
- **图片饮食**: iLink 图片经解密后发送给支持视觉输入的模型；识别为食物时，模型必须调用 `health.record_diet` 记录估算值。
- **用户目标**: 当前活跃的卡路里目标，用于报告中的进度计算。
- **知识库状态**: 标记 LightRAG 是否可用，供 Agent 决定是否依赖知识库数据。

### 6.4 热量估算优先级

```
1. LightRAG 知识库精确匹配  →  confidence: high
2. LightRAG 模糊匹配         →  confidence: medium
3. LLM 内置常识估算          →  confidence: low
4. 无法估算                   →  追问用户
```

---

## 7. 报告生成

### 7.1 报告周期定义

| 周期 | 范围 | 触发方式 |
|------|------|----------|
| 每日 | 当天 00:00 ~ 23:59 | 用户主动查询 |
| 每周 | 本周一 ~ 周日 | 用户主动查询 |
| 每月 | 本月 1 日 ~ 月末 | 用户主动查询 |
| 每季度 | 本季度第 1 月 ~ 第 3 月 | 用户主动查询 |
| 每年 | 本年 1 月 ~ 12 月 | 用户主动查询 |

### 7.2 报告内容

```
📊 每日报告（2026-08-08）

【摄入】
  早餐：包子×2 (220kcal, 知识库匹配) + 豆浆×1 (80kcal, 知识库匹配) = 300 kcal
  午餐：牛肉面×1 (280kcal, 知识库匹配) + 可乐×1 (140kcal, 知识库匹配) = 420 kcal
  晚餐：米饭×1 (130kcal) + 红烧肉×1 (450kcal) = 580 kcal
  ─────────────────────
  摄入合计：1,300 kcal

【消耗】
  跑步 5km (300kcal, 知识库匹配) + 力量训练 30min (180kcal)
  ─────────────────────
  消耗合计：480 kcal

【收支】
  净摄入：+820 kcal
  每日目标：2,000 kcal -> 达成 65%

【营养分析】（基于知识库数据）
  蛋白质：约 65g（推荐 60-80g）✓
  碳水：约 180g（推荐 200-300g）✓
  脂肪：约 45g（推荐 40-70g）✓

【知识库建议】
  💡 今日蛋白质摄入达标，碳水略低。
  建议晚餐增加一份粗粮（如红薯100g≈86kcal）补充碳水。
```

### 7.3 周期报告聚合逻辑

```
weekly    = 聚合 7 天的 daily 数据
monthly   = 聚合当月所有 daily 数据
quarterly = 聚合 3 个月的 monthly 数据
yearly    = 聚合 12 个月的 monthly 数据
```

聚合指标：总摄入、总消耗、净摄入、日均摄入、日均消耗、记录天数、趋势方向、知识库建议（通过 LightRAG 查询该周期的健康建议）。

---

## 8. 现有代码改造计划

### 8.1 存储层迁移：SQLite → PostgreSQL

#### 8.1.1 依赖变更

```json
// package.json 移除:
"better-sqlite3": "^11.10.0",
"@types/better-sqlite3": "^7.6.13",

// package.json 新增:
"pg": "^8.13.0",
"@types/pg": "^8.11.10",
```

```bash
# package.json pnpm.onlyBuiltDependencies 移除 better-sqlite3
```

#### 8.1.2 文件改造

| 文件 | 改造内容 |
|------|----------|
| `src/store/db.ts` | 替换 `better-sqlite3` 为 `pg.Pool`，导出 `createPgPool()` 和 `createPgClient()` |
| `src/store/migrations.ts` | SQL 语法适配 PostgreSQL（`TIMESTAMPTZ`、`JSONB`、`BOOLEAN`、`CHECK` 约束），新增健康追踪表 |
| `src/store/repositories/threads.ts` | 同步 API：`db.prepare().run()` → `pool.query()`，`Database.Database` 类型 → `pg.PoolClient` |
| `src/store/repositories/approvals.ts` | 同上 |
| `src/store/repositories/events.ts` | 类型适配 |
| `src/app/entrypoint.ts` | `createSqliteDatabase(path)` → `createPgPool(config)` |
| `src/shared/schema.ts` | `DATABASE_PATH` → `DATABASE_URL`，新增 PG/LightRAG 配置 |
| `src/shared/config.ts` | 适配新配置项 |
| `tests/store/*.test.ts` | 测试改用 PG 测试库或 mock |
| `tests/app/*.test.ts` | `DATABASE_PATH: ":memory:"` → PG 测试连接串 |
| `tests/tasks/service.test.ts` | 同上 |
| `tests/shared/config.test.ts` | `DATABASE_PATH` → `DATABASE_URL` |

#### 8.1.3 迁移策略

- 现有 SQLite 数据库如有数据，编写一次性迁移脚本将历史数据导入 PostgreSQL。
- Migration 脚本使用 PostgreSQL DDL，`CREATE TABLE IF NOT EXISTS` 保证幂等。
- 测试环境使用独立的 PG 测试数据库（如 `wechat_claw_test`），通过 `TEST_DATABASE_URL` 环境变量配置。

### 8.2 模块改造总览

| 模块 | 现有职责 | 改造内容 |
|------|----------|----------|
| `src/store/db.ts` | SQLite 连接 | **重写为 PostgreSQL Pool** |
| `src/store/migrations.ts` | SQLite DDL | **重写为 PostgreSQL DDL**，含全部表 |
| `src/store/repositories/threads.ts` | SQLite 读写 | **改写为 PG Pool 查询** |
| `src/store/repositories/approvals.ts` | SQLite 读写 | **改写为 PG Pool 查询** |
| `src/agent/provider/base.ts` | `AgentPlan` 类型 | 扩展为意图+实体+知识库来源的结构化输出 |
| `src/agent/provider/openai.ts` | 单次 LLM 调用 | 更新 system prompt |
| `src/agent/runtime.ts` | 单次 plan | 改为多流程管道 |
| `src/app/main.ts` | handleAdminMessage 单循环 | 改为健康追踪路由 |
| `src/app/entrypoint.ts` | 装配 | 注入 PG Pool、新 repository、knowledge service |
| `src/tools/registry.ts` | 通用工具 | 替换为健康专用工具 |
| `src/shared/schema.ts` | env schema | `DATABASE_URL` + PG/LightRAG 配置 |
| `src/approval/policies.ts` | 审批策略 | 全部自动审批（空 set） |

### 8.3 新增模块

```
src/
  health/                         # 新增：健康追踪领域模块
    types.ts                      #   领域类型（DietRecord, ExerciseRecord, Report, KnowledgeResult 等）
    intent.ts                     #   意图识别类型与解析
    knowledge.ts                  #   知识库服务封装（lookupFood/lookupExercise/getAdvice）
    lightrag.ts                   #   LightRAG HTTP 客户端
    report-generator.ts           #   报告生成逻辑（聚合查询 + 格式化）
    reply-formatter.ts            #   自然语言回复格式化

  store/
    repositories/
      diet.ts                     #   新增：饮食记录仓库（PG）
      exercise.ts                 #   新增：运动记录仓库（PG）
      goals.ts                    #   新增：用户目标仓库（PG）
      reports.ts                  #   新增：报告快照仓库（PG）

  agent/
    pipeline.ts                   #   新增：多流程管道编排器
    prompts.ts                    #   新增：系统提示词管理

  tools/
    health/
      record-diet.ts              #   新增：记录饮食工具
      record-exercise.ts          #   新增：记录运动工具
      query-report.ts             #   新增：查询报告工具
      query-history.ts            #   新增：查询历史工具
      correct-record.ts           #   新增：修正记录工具
      get-advice.ts               #   新增：获取建议工具
```

### 8.4 配置新增

```bash
# .env 变更

# --- 存储层（替换原 DATABASE_PATH）---
DATABASE_URL=postgresql://user:pass@localhost:5432/wechat_claw

# --- LightRAG 知识库 ---
LIGHTRAG_API_URL=http://localhost:9621          # LightRAG 服务地址
LIGHTRAG_API_KEY=                                # 可选 API key
LIGHTRAG_TIMEOUT_MS=5000                         # 请求超时
LIGHTRAG_ENABLED=true                            # 是否启用知识库（false 时降级为 LLM 估算）

# --- 健康追踪 ---
HEALTH_DEFAULT_CALORIE_GOAL=2000                 # 默认每日摄入目标 kcal
HEALTH_DEFAULT_BURN_GOAL=500                     # 默认每日消耗目标 kcal
LLM_CONTEXT_WINDOW=256000                        # 对话上下文 token 预算（默认 256k）

# --- PostgreSQL 连接池 ---
PG_POOL_MAX=10                                   # 连接池最大连接数
PG_POOL_IDLE_TIMEOUT_MS=30000                    # 空闲连接超时
```

对应 `src/shared/schema.ts`：

```typescript
export const envSchema = z.object({
  ADMIN_USER_ID: z.string().min(1),
  WORKSPACE_ROOT: z.string().min(1),
  LLM_BASE_URL: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().optional(),
  LLM_SUPPORTS_IMAGE_INPUT: z.enum(["true", "false"]).optional(),

  // 存储：PostgreSQL（替换 DATABASE_PATH）
  DATABASE_URL: z.string().min(1),
  PG_POOL_MAX: z.coerce.number().optional(),
  PG_POOL_IDLE_TIMEOUT_MS: z.coerce.number().optional(),

  // LightRAG 知识库
  LIGHTRAG_API_URL: z.string().optional(),
  LIGHTRAG_API_KEY: z.string().optional(),
  LIGHTRAG_TIMEOUT_MS: z.coerce.number().optional(),
  LIGHTRAG_ENABLED: z.enum(["true", "false"]).optional(),

  // 健康追踪
  HEALTH_DEFAULT_CALORIE_GOAL: z.coerce.number().optional(),
  HEALTH_DEFAULT_BURN_GOAL: z.coerce.number().optional(),
  LLM_CONTEXT_WINDOW: z.coerce.number().optional(),

  // iLink
  ILINK_BOT_TOKEN: z.string().optional(),
});
```

---

## 9. LightRAG 部署与初始化

### 9.1 部署方式

LightRAG 作为**独立进程**部署，通过 HTTP API 与主应用通信：

```bash
# LightRAG 服务（独立部署）
# 使用 PostgreSQL + pgvector 作为向量存储
pip install lightrag-hku

# 启动 LightRAG API 服务
lightrag-server --host 0.0.0.0 --port 9621 \
  --db-url postgresql://user:pass@localhost:5432/lightrag \
  --embedding-model bge-m3 \
  --llm-model gpt-4o-mini
```

### 9.2 知识库初始化

编写初始化脚本 `scripts/init-knowledge-base.ts`，将预整理的食物/运动/健康知识文档批量导入 LightRAG：

```typescript
// scripts/init-knowledge-base.ts
import { createLightRagClient } from "../src/health/lightrag.js";

const foodKnowledge = [
  // 主食类
  `【白米饭】每100g约130kcal。蛋白质2.7g，碳水28g，脂肪0.3g。常见主食，百搭。`,
  `【全麦面包】每片(约30g)约75kcal。蛋白质4g，碳水14g，脂肪1g。富含膳食纤维，优于白面包。`,
  // ... 约2000条食物数据
];

const exerciseKnowledge = [
  `【跑步-慢跑】中等配速(7-8km/h)，每公里约消耗60kcal(70kg体重)。30分钟约消耗300kcal。有氧运动，适合减脂。`,
  `【游泳-自由泳】中等强度，每30分钟约消耗300kcal(70kg体重)。全身运动，关节友好。`,
  // ... 约500条运动数据
];

const healthAdviceKnowledge = [
  `【膳食指南-碳水】成人每日碳水建议占总热量50-65%。减脂期可降至40-50%。优质来源：糙米、燕麦、红薯。`,
  `【运动建议-有氧】WHO建议每周至少150分钟中等强度有氧运动。对应热量消耗约500-800kcal/周。`,
  // ... 约300条建议数据
];

const client = createLightRagClient({ apiUrl: process.env.LIGHTRAG_API_URL! });

// 批量插入
for (const doc of [...foodKnowledge, ...exerciseKnowledge, ...healthAdviceKnowledge]) {
  await client.insert(doc);
}

console.log("知识库初始化完成");
```

### 9.3 LightRAG 客户端实现

```typescript
// src/health/lightrag.ts

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

  const timeout = config.timeoutMs ?? 5000;

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

    async insert(text: string): Promise<void> {
      const res = await fetch(`${config.apiUrl}/documents/insert`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok) {
        throw new Error(`LightRAG insert failed: ${res.status}`);
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
```

---

## 10. 持久化与恢复

### 10.1 数据持久化

- 所有饮食记录、运动记录、用户目标、报告快照、线程、事件存储在 **PostgreSQL**。
- 连接字符串由 `DATABASE_URL` 环境变量控制。
- 使用 `pg.Pool` 连接池管理连接，池大小由 `PG_POOL_MAX` 控制（默认 10）。
- 每条记录包含 `created_at` 和 `updated_at` 时间戳。

### 10.2 知识库持久化

- LightRAG 的向量数据和知识图谱存储在**独立的 PostgreSQL 数据库**（如 `lightrag`），与业务数据库分离。
- 知识库内容通过初始化脚本一次性导入，后续可通过 `insert` API 追加。
- LightRAG 服务独立运行，重启不影响主应用。

### 10.3 重启恢复

- 主应用重启后，PG 连接池自动重建，历史数据完整保留。
- LightRAG 服务独立重启不影响主应用（主应用降级为 LLM 估算）。
- 上下文从 `conversation_messages` 表恢复，并按 `LLM_CONTEXT_WINDOW` 裁剪，确保对话连续性。

---

## 11. 实现里程碑

### M0: 存储层迁移 SQLite → PostgreSQL（预计 2 天）

- [ ] `package.json` 依赖变更：移除 `better-sqlite3`，新增 `pg` + `@types/pg`
- [ ] 重写 `src/store/db.ts`：`pg.Pool` 连接管理
- [ ] 重写 `src/store/migrations.ts`：PostgreSQL DDL（现有 3 表 + 新增 4 表）
- [ ] 改写 `src/store/repositories/threads.ts`：PG Pool 查询
- [ ] 改写 `src/store/repositories/approvals.ts`：PG Pool 查询
- [ ] `src/shared/schema.ts`：`DATABASE_PATH` → `DATABASE_URL`
- [ ] `src/app/entrypoint.ts`：适配 PG Pool
- [ ] 全量测试改用 PG 测试库
- [ ] `npm test` + `tsc --noEmit` + `npm run build` 通过

### M1: LightRAG 知识库集成（预计 2 天）

- [ ] 实现 `src/health/lightrag.ts`：LightRAG HTTP 客户端
- [ ] 实现 `src/health/knowledge.ts`：知识库服务封装（lookupFood / lookupExercise / getAdvice）
- [ ] 编写 `scripts/init-knowledge-base.ts`：批量导入知识文档
- [ ] 整理食物热量知识数据（至少 500 条常见食物）
- [ ] 整理运动消耗知识数据（至少 200 条常见运动）
- [ ] 整理健康建议知识数据（至少 100 条）
- [ ] 知识库健康检查 + 降级逻辑
- [ ] 单元测试（mock LightRAG API）

### M2: 数据层新增（预计 1.5 天）

- [ ] 实现 `DietRepository`（PG）
- [ ] 实现 `ExerciseRepository`（PG）
- [ ] 实现 `GoalRepository`（PG）
- [ ] 实现 `ReportRepository`（PG，报告快照）
- [ ] 领域类型定义（`src/health/types.ts`）
- [ ] 单元测试覆盖所有仓库 CRUD

### M3: Agent 管道改造（预计 2.5 天）

- [ ] 定义新的 `AgentPlan` 输出 schema（意图 + 实体 + 回复）
- [ ] 更新 system prompt 为健康追踪助手
- [ ] 实现 `src/agent/pipeline.ts` 多流程管道（含知识库检索阶段）
- [ ] 实现意图路由分发
- [ ] 实现热量估算优先级逻辑（知识库 > LLM 估算）
- [ ] 单元测试覆盖管道各阶段

### M4: 应用层集成（预计 2 天）

- [ ] 改造 `src/app/main.ts` 为健康追踪路由
- [ ] 改造 `src/app/entrypoint.ts` 注入 PG Pool + knowledge service
- [ ] 实现回复格式化器（`reply-formatter.ts`）
- [ ] 改造工具注册为健康专用工具集
- [ ] 集成测试：端到端消息处理

### M5: 报告生成（预计 1.5 天）

- [ ] 实现 `report-generator.ts`（日/周/月/季/年聚合逻辑）
- [ ] 报告中融合知识库营养分析和建议
- [ ] 报告快照缓存
- [ ] 测试覆盖各周期报告生成

### M6: 配置与收尾（预计 1 天）

- [ ] 新增环境变量与 schema 更新
- [ ] `.env.example` 更新
- [ ] 审批策略调整（全部自动审批）
- [ ] README 更新
- [ ] 全量测试通过
- [ ] 端到端 smoke 验证（含 LightRAG 连通）

**总预计：约 12.5 个工作日**

---

## 12. 验收标准

### 12.1 功能验收

1. **饮食记录**: 用户发送"今天中午吃了一碗牛肉面"，Agent 查询知识库获取热量（≈280 kcal）、存储到 PG、回复确认并标注知识库来源。
2. **运动记录**: 用户发送"下午跑了5公里"，Agent 查询知识库获取消耗（≈300 kcal）、存储到 PG、回复确认。
3. **知识库降级**: 当 LightRAG 不可用时，Agent 降级为 LLM 估算，`confidence` 标记为 `low`，回复中标注"未匹配知识库"。
4. **每日报告**: 用户发送"今天的报告"，Agent 返回当日所有记录的汇总，含知识库营养分析和建议。
5. **周期报告**: 用户发送"这周报告"/"这个月报告"，返回对应周期的聚合数据和建议。
6. **历史查询**: 用户发送"我上周三吃了什么"，返回该日期的所有记录。
7. **记录修正**: 用户发送"刚才的包子只吃了一个"，能定位并修正对应记录。
8. **目标设置**: 用户发送"把我的每日摄入目标设为1800"，存储目标并在报告中引用。
9. **知识库建议**: 用户发送"给我一些减脂饮食建议"，Agent 查询知识库返回个性化建议。
10. **自然语言容错**: 用户发送模糊消息如"吃了个饭"，Agent 合理处理或追问。
11. **持久化**: 重启进程后，PG 中历史记录和报告查询功能正常。
12. **上下文连续**: 用户可以基于最近对话进行追问和修正。

### 12.2 非功能验收

1. `npm test` 全部通过（PG 测试库）
2. `npx tsc --noEmit` 类型检查通过
3. `npm run build` 构建成功
4. `npm run start:wechat` 能正常启动，PG 连接 + LightRAG 连通性检查通过
5. PG migration 幂等执行，不丢数据
6. LightRAG 不可用时主应用不崩溃，降级逻辑正常工作

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| LightRAG 服务不可用 | 热量估算降级 | 健康检查 + 自动降级为 LLM 估算，标注低置信度 |
| LightRAG 检索结果不准确 | 热量数据偏差 | 结果附带 confidence + reference，低置信度时提示用户确认 |
| 知识库覆盖不全 | 部分食物/运动无匹配 | 模糊匹配 + LLM 估算兜底；持续扩充知识库 |
| LLM 输出格式不稳定 | 解析失败 | 严格的 JSON schema 校验 + 重试机制 |
| 用户输入过于模糊 | 无法提取有效信息 | Agent 追问引导，而非强行记录 |
| iLink 网关断连 | 消息丢失 | 长轮询自动重连 |
| PostgreSQL 连接池耗尽 | 请求阻塞 | 合理池大小 + 连接超时 + 熔断 |
| 历史数据量大时查询慢 | 报告生成延迟 | 日期索引 + 报告快照缓存 + 定期物化视图 |
| LightRAG 向量存储与业务库竞争资源 | 性能互相影响 | LightRAG 使用独立 PG 数据库实例或 schema |

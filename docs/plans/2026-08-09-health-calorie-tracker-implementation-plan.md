# 实施计划: WeChat 饮食运动热量追踪 Agent

> **对应 PRD**: `docs/plans/2026-08-08-health-calorie-tracker-prd.md`
> **计划日期**: 2026-08-09
> **预计工期**: 12.5 个工作日
> **当前分支**: `master` → 建议开 `dev` 分支开发

---

## 里程碑总览

| 里程碑 | 名称 | 工期 | 依赖 | 状态 |
|--------|------|------|------|------|
| M0 | 存储层迁移 SQLite → PostgreSQL | 2d | — | 待开始 |
| M1 | LightRAG 知识库集成 | 2d | — | 待开始 |
| M2 | 数据层新增（健康领域仓库） | 1.5d | M0 | 待开始 |
| M3 | Agent 管道改造 | 2.5d | M1, M2 | 待开始 |
| M4 | 应用层集成 | 2d | M3 | 待开始 |
| M5 | 报告生成 | 1.5d | M4 | 待开始 |
| M6 | 配置与收尾 | 1d | M5 | 待开始 |

M0 和 M1 无依赖关系，可并行推进。

---

## M0: 存储层迁移 SQLite → PostgreSQL

### 目标

将 `better-sqlite3` 同步调用全部替换为 `pg.Pool` 异步查询，不改变现有功能行为，所有现有测试通过。

### 任务分解

#### M0-T1: 依赖变更与配置更新

**文件**:
- `package.json` — 移除 `better-sqlite3` + `@types/better-sqlite3`，移除 `pnpm.onlyBuiltDependencies`，新增 `pg` + `@types/pg`
- `src/shared/schema.ts` — `DATABASE_PATH: z.string().min(1)` → `DATABASE_URL: z.string().min(1)`，新增 `PG_POOL_MAX` / `PG_POOL_IDLE_TIMEOUT_MS`
- `src/shared/config.ts` — `databasePath` → `databaseUrl`，新增 `pgPoolMax` / `pgPoolIdleTimeoutMs`

**验收**:
- `pnpm install` 成功，无 `better-sqlite3` 残留
- `tsc --noEmit` 通过（此时会有编译错误，因为 `db.ts` 还没改，预期行为）

#### M0-T2: 重写 `src/store/db.ts`

**当前代码** (`src/store/db.ts:1-14`):
```typescript
// 同步: new Database(path) → applyMigrations(db)
```

**改为**:
```typescript
import { Pool } from "pg";
import { applyMigrations } from "./migrations.js";

export type DbPool = Pool;

export async function createPgPool(config: {
  databaseUrl: string;
  max?: number;
  idleTimeoutMs?: number;
}): Promise<DbPool> {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30000,
  });
  await applyMigrations(pool);
  return pool;
}

export async function createTestPgPool(databaseUrl: string): Promise<DbPool> {
  return createPgPool({ databaseUrl, max: 5 });
}
```

**关键决策**:
- `applyMigrations` 改为 `async`，内部用 `pool.query()` 执行 DDL
- 导出 `DbPool` 类型别名，所有 repository 接收 `DbPool` 而非 `Database.Database`
- 移除 `createInMemoryDatabase`（PG 无内存模式，测试用独立测试库）

#### M0-T3: 重写 `src/store/migrations.ts`

**当前代码** (`src/store/migrations.ts:14-39`):
- 接收 `import("better-sqlite3").Database`
- 使用 `db.exec()` 一次执行多语句
- SQLite 语法：`INTEGER`、`datetime('now')`、`rowid`

**改为**:
```typescript
import type { DbPool } from "./db.js";

export async function applyMigrations(pool: DbPool): Promise<void> {
  // PostgreSQL 不支持单次 exec 多语句，需要逐条执行
  await pool.query(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      source_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      kind TEXT NOT NULL,
      summary TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      status TEXT NOT NULL DEFAULT 'pending',
      action TEXT NOT NULL,
      reply TEXT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_thread ON task_events(thread_id)`);
}
```

**关键差异**:
- `db.exec()` → `pool.query()`，每条语句单独调用
- `FOREIGN KEY` 显式声明 `REFERENCES`
- `datetime('now')` → `NOW()`（在 M2 新增表中使用，现有表无此列）
- `rowid` 隐式排序 → 显式 `ORDER BY created_at` 或 `ORDER BY id`
- 后续 M2 新增表会使用 `TIMESTAMPTZ`、`JSONB`、`BOOLEAN`、`CHECK` 等 PG 特性

#### M0-T4: 改写 `src/store/repositories/threads.ts`

**当前** (`src/store/repositories/threads.ts`):
- `class ThreadRepository` 构造接收 `Database.Database`
- 所有方法同步：`db.prepare().run()` / `db.prepare().get()` / `db.prepare().all()`
- `ORDER BY rowid ASC`

**改为**:
- 构造接收 `DbPool`
- 所有方法改为 `async`，返回 `Promise`
- `db.prepare(SQL).run(params)` → `pool.query(SQL, params)`
- `db.prepare(SQL).get(params)` → `(await pool.query(SQL, params)).rows[0]`
- `db.prepare(SQL).all(params)` → `(await pool.query(SQL, params)).rows`
- `ORDER BY rowid ASC` → `ORDER BY created_at ASC, id ASC`（需确认现有表无 `created_at`，用 `id` 排序替代）
- snake_case → camelCase 映射保持不变

**方法签名变更**:
```typescript
// Before (sync)
create(input: ThreadInput): ThreadRecord
get(threadId: string): ThreadRecord | undefined
listAll(): ThreadRecord[]
listBySourceUserId(sourceUserId: string): ThreadRecord[]
listEvents(threadId: string): ThreadEventRecord[]
appendEvent(threadId: string, event: EventInput): ThreadEventRecord
updateStatus(threadId: string, status: string): void

// After (async)
async create(input: ThreadInput): Promise<ThreadRecord>
async get(threadId: string): Promise<ThreadRecord | undefined>
async listAll(): Promise<ThreadRecord[]>
async listBySourceUserId(sourceUserId: string): Promise<ThreadRecord[]>
async listEvents(threadId: string): Promise<ThreadEventRecord[]>
async appendEvent(threadId: string, event: EventInput): Promise<ThreadEventRecord>
async updateStatus(threadId: string, status: string): Promise<void>
```

#### M0-T5: 改写 `src/store/repositories/approvals.ts`

与 T4 同样的模式：
- `Database.Database` → `DbPool`
- 所有方法 `async`
- `JSON.parse(row.action)` 保持不变（PG 中 `action` 列仍为 `TEXT` 存储 JSON 字符串）

#### M0-T6: 改造 `src/app/entrypoint.ts`

**当前** (`src/app/entrypoint.ts:27`):
```typescript
const db = createSqliteDatabase(config.databasePath);
```

**改为**:
```typescript
const db = await createPgPool({
  databaseUrl: config.databaseUrl,
  max: config.pgPoolMax,
  idleTimeoutMs: config.pgPoolIdleTimeoutMs,
});
```

- `createDefaultEntrypoint` 需改为 `async function`
- `ThreadRepository(db)` / `ApprovalRepository(db)` 不变（构造函数签名不变）
- 所有调用 repository 方法的地方加 `await`

**连锁影响**:
- `src/app/bootstrap.ts:77` — `createDefaultEntrypoint` 调用需要 `await`
- `src/app/bootstrap.ts:85` — `start()` 方法需要 `await`

#### M0-T7: 改造 `src/tasks/service.ts`

**当前** (`src/tasks/service.ts`):
- `receiveMessage` 同步调用 `threadRepository.create()` / `threadRepository.listBySourceUserId()`
- `appendEvent` 同步调用 `threadRepository.appendEvent()`

**改为**:
- 所有调用 repository 的方法改为 `async`
- `receiveMessage` → `async receiveMessage(): Promise<{ threadId: string }>`
- `markDone` → `async markDone(threadId: string): Promise<void>`
- `markFailed` → `async markFailed(threadId: string, reason: string): Promise<void>`
- `createApprovalRequest` → `async createApprovalRequest(...): Promise<{ approvalId: string }>`
- `markWaitingApproval` → `async markWaitingApproval(...): Promise<void>`
- `getPendingApproval` → `async getPendingApproval(...): Promise<ApprovalRecord | undefined>`
- `markApproved` → `async markApproved(approvalId: string): Promise<void>`
- `markRejected` → `async markRejected(approvalId: string): Promise<void>`
- `listThreads` → `async listThreads(): Promise<TaskThread[]>`
- `listEvents` → `async listEvents(threadId: string): Promise<TaskEvent[]>`
- `listApprovals` → `async listApprovals(): Promise<...>`

#### M0-T8: 改造 `src/app/main.ts`

**当前** (`src/app/main.ts`):
- `deps.taskService.receiveMessage()` 同步
- `deps.runtime.planNext()` 已是 async
- `deps.tools.run(action)` 已是 async
- `deps.taskService.appendEvent(...)` 同步
- `deps.taskService.markDone(threadId)` 同步

**改为**:
- 所有 taskService 方法调用加 `await`
- `deps.taskService.receiveMessage()` → `await deps.taskService.receiveMessage()`
- `deps.taskService.appendEvent(...)` → `await deps.taskService.appendEvent(...)`
- `deps.taskService.markDone(...)` → `await deps.taskService.markDone(...)`
- `deps.taskService.createApprovalRequest(...)` → `await deps.taskService.createApprovalRequest(...)`
- `deps.taskService.markWaitingApproval(...)` → `await deps.taskService.markWaitingApproval(...)`
- `deps.taskService.getPendingApproval(...)` → `await deps.taskService.getPendingApproval(...)`
- `deps.taskService.markApproved(...)` → `await deps.taskService.markApproved(...)`
- `deps.taskService.markRejected(...)` → `await deps.taskService.markRejected(...)`

#### M0-T9: 测试改造

**受影响测试文件**:

| 测试文件 | 改造内容 |
|----------|----------|
| `tests/store/threads.test.ts` | `createInMemoryDatabase()` → `createTestPgPool(TEST_DB_URL)`，所有断言加 `await` |
| `tests/store/approvals.test.ts` | 同上 |
| `tests/tasks/service.test.ts` | `new Database(":memory:")` → PG 测试库，所有方法调用加 `await` |
| `tests/app/bootstrap.test.ts` | `DATABASE_PATH: ":memory:"` → `DATABASE_URL: TEST_DB_URL` |
| `tests/app/entrypoint.test.ts` | 同上，所有 `DATABASE_PATH` → `DATABASE_URL` |
| `tests/shared/config.test.ts` | `DATABASE_PATH` → `DATABASE_URL` |
| `tests/app/main.test.ts` | mock 的 taskService 方法改为返回 Promise |

**测试策略**:
- 使用 `beforeEach` / `afterEach` 在测试库上执行 `TRUNCATE` 清空数据
- `TEST_DATABASE_URL` 环境变量配置测试库连接串
- 每个 `describe` 块共享同一个 PG 连接池

#### M0-T10: M0 验证

- [ ] `pnpm install` 成功
- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] `pnpm run build` 成功
- [ ] 无 `better-sqlite3` 残留引用（`grep -r "better-sqlite3" src/ tests/` 无结果）
- [ ] `pnpm run start:wechat` 连接 PG 并启动（手动验证）

---

## M1: LightRAG 知识库集成

### 目标

部署 LightRAG 服务，实现客户端 SDK，将 `data/knowledge-base/` 中的知识数据导入，为 Agent 提供食物热量和运动消耗检索能力。

### 任务分解

#### M1-T1: 部署 LightRAG 服务

**操作**:
- 使用 `uv` 安装 `lightrag-hku`
- 配置 LightRAG 使用独立 PG 数据库 `lightrag`（与业务库 `wechat_claw` 分离）
- 配置 embedding 模型（bge-m3 或其他可用的嵌入模型）
- 配置 LLM 模型（复用现有 `LLM_BASE_URL` + `LLM_MODEL`）
- 启动服务在 `localhost:9621`

**验收**:
- `curl http://localhost:9621/health` 返回 200
- LightRAG 日志正常输出

#### M1-T2: 实现 `src/health/lightrag.ts`

**新建文件**: `src/health/lightrag.ts`

按 PRD 9.3 节实现：
- `createLightRagClient(config)` 工厂函数
- `query(query, mode)` — 调用 `POST /query`
- `insert(text)` — 调用 `POST /documents/insert`
- `healthCheck()` — 调用 `GET /health`
- 超时控制 + 错误处理
- 导出 `LightRagConfig` / `LightRagQueryMode` / `LightRagQueryResult` 类型

**测试**: `tests/health/lightrag.test.ts`
- mock `fetch`，验证 query / insert / healthCheck 调用
- 验证超时行为
- 验证错误处理

#### M1-T3: 实现 `src/health/knowledge.ts`

**新建文件**: `src/health/knowledge.ts`

实现知识库服务封装：
- `createKnowledgeService(lightragClient, logger)` 工厂函数
- `lookupFood(foodName, quantity, unit)` — 构造中文检索 query，调用 LightRAG，解析返回文本提取热量和营养素
- `lookupExercise(exerciseName, durationMin, intensity)` — 同上
- `getAdvice(topic, userContext?)` — 构造建议检索 query，返回建议文本数组
- `isAvailable()` — 调用 `healthCheck()`，缓存结果（30s TTL）

**解析逻辑**:
- LightRAG 返回的是自然语言文本，需要用正则/解析提取数值
- 若无法解析出热量数值，返回 `confidence: "low"` + 无 calories
- 若解析成功，返回 `confidence: "medium"` + calories + matchedName

**降级策略**:
- `isAvailable()` 返回 `false` 时，`lookupFood` / `lookupExercise` 直接返回 `confidence: "low"` 空结果
- 主应用根据 `confidence` 决定是否降级为 LLM 估算

**测试**: `tests/health/knowledge.test.ts`
- mock LightRAG client，验证 query 构造和结果解析
- 验证降级路径
- 验证超时和错误处理

#### M1-T4: 知识数据格式化与导入脚本

**新建文件**: `scripts/init-knowledge-base.ts`

读取 `data/knowledge-base/` 下的 JSON 数据，格式化为知识文本文档，批量导入 LightRAG：

**数据源 → 文本格式化**:

1. `food/open-food-calories-5000.json` (5037 条):
   ```
   【White rice (cooked)】
   英文名: White rice (cooked)
   每100克热量: 130 kcal
   类型: solid
   ```

2. `food/caltrack-foods.json` (1015 条):
   ```
   【White Rice (Boiled)】
   类别: carbs
   每100g热量: 130 kcal
   蛋白质: 2.4g | 碳水: 28.2g | 脂肪: 0.3g
   微量营养素: 胆固醇0mg, 钠1mg, ...
   ```

3. `food/calzen-chinese-foods.json` (110 条):
   ```
   【鸡胸肉】
   每100g热量: 165 kcal
   蛋白质: 31g | 脂肪: 3.6g | 碳水: 0g
   ```

4. `exercise/caltrack-activities.json` (70 条):
   ```
   【Running (Fast / 10 kmph)】
   类别: cardio
   MET值: 9.8
   单位: 每分钟
   热量消耗计算: MET × 体重(kg) × 时间(小时)
   ```

5. `health-guidelines/china-dietary-guidelines-2022.md` — 直接导入全文

**导入策略**:
- 按批次导入（每批 50 条），避免单次请求过大
- 导入完成后执行一次测试查询验证
- 记录导入日志和条目数

**验收**:
- 脚本执行完成后，LightRAG 中可查询到食物热量数据
- `lookupFood("白米饭")` 返回 130 kcal
- `lookupFood("鸡胸肉")` 返回 165 kcal
- `lookupExercise("跑步")` 返回 MET 值

#### M1-T5: M1 验证

- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 通过（含 LightRAG client 和 knowledge service 测试）
- [ ] LightRAG 服务运行中，知识库已导入
- [ ] 手动执行 `scripts/init-knowledge-base.ts` 导入成功

---

## M2: 数据层新增（健康领域仓库）

### 目标

在 PostgreSQL 中新增 4 张健康追踪表，实现对应的 Repository 层，提供完整的 CRUD + 聚合查询能力。

### 任务分解

#### M2-T1: 扩展 migration 新增 4 张表

**文件**: `src/store/migrations.ts`

在现有 3 张表 migration 之后，追加 PRD 4.1 节中定义的 4 张新表和索引：
- `diet_records` — 含 `CHECK (meal IN (...))` / `CHECK (confidence IN (...))`
- `exercise_records` — 同上
- `user_goals` — 含 `BOOLEAN` / `CHECK`
- `report_snapshots` — 含 `JSONB`

索引：
- `idx_diet_user_date`
- `idx_diet_user_meal`
- `idx_exercise_user_date`
- `idx_report_user_period`
- `idx_goals_user_active`（部分索引 `WHERE active = TRUE`）

#### M2-T2: 领域类型定义

**新建文件**: `src/health/types.ts`

定义 PRD 4.2 节中所有类型：
- `DietRecord` / `DietInput`
- `ExerciseRecord` / `ExerciseInput`
- `UserGoal` / `GoalInput`
- `ReportSnapshot`
- `KnowledgeResult`（已在 M1 定义，此处 re-export 或在 types.ts 统一定义）
- `Report`
- `DailySummary`
- `Intent`（PRD 3.4 节）
- `AgentPlanOutput`（PRD 6.1 节 LLM 返回的 JSON 结构）

#### M2-T3: 实现 `src/store/repositories/diet.ts`

**新建文件**: `src/store/repositories/diet.ts`

```typescript
export class DietRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: DietInput): Promise<DietRecord>;
  async getByDate(userId: string, date: string): Promise<DietRecord[]>;
  async getDailySummary(userId: string, date: string): Promise<{
    totalCalories: number;
    byMeal: Record<string, number>;
    items: DietRecord[];
  }>;
  async getRangeSummary(userId: string, startDate: string, endDate: string): Promise<{
    totalCalories: number;
    avgDaily: number;
    recordCount: number;
    byMeal: Record<string, number>;
  }>;
  async update(id: string, updates: Partial<DietInput>): Promise<DietRecord | undefined>;
  async delete(id: string): Promise<void>;
}
```

**关键查询**:
- `getDailySummary` — `SELECT meal, SUM(calories) FROM diet_records WHERE user_id = $1 AND record_date = $2 GROUP BY meal`
- `getRangeSummary` — 按 `record_date BETWEEN $1 AND $2` 聚合

#### M2-T4: 实现 `src/store/repositories/exercise.ts`

**新建文件**: `src/store/repositories/exercise.ts`

```typescript
export class ExerciseRepository {
  constructor(private readonly pool: DbPool) {}

  async create(input: ExerciseInput): Promise<ExerciseRecord>;
  async getByDate(userId: string, date: string): Promise<ExerciseRecord[]>;
  async getDailySummary(userId: string, date: string): Promise<{
    totalCalories: number;
    items: ExerciseRecord[];
  }>;
  async getRangeSummary(userId: string, startDate: string, endDate: string): Promise<{
    totalCalories: number;
    avgDaily: number;
    recordCount: number;
    byExercise: Record<string, number>;
  }>;
  async update(id: string, updates: Partial<ExerciseInput>): Promise<ExerciseRecord | undefined>;
  async delete(id: string): Promise<void>;
}
```

#### M2-T5: 实现 `src/store/repositories/goals.ts`

**新建文件**: `src/store/repositories/goals.ts`

```typescript
export class GoalRepository {
  constructor(private readonly pool: DbPool) {}

  async set(input: GoalInput): Promise<UserGoal>;
  async getActive(userId: string): Promise<UserGoal[]>;
  async deactivate(id: string): Promise<void>;
}
```

**`set` 逻辑**: 设置新目标时，先将同类型同周期的旧目标 `active = FALSE`，再插入新目标。

#### M2-T6: 实现 `src/store/repositories/reports.ts`

**新建文件**: `src/store/repositories/reports.ts`

```typescript
export class ReportRepository {
  constructor(private readonly pool: DbPool) {}

  async save(snapshot: ReportSnapshotInput): Promise<ReportSnapshot>;
  async get(userId: string, periodType: string, periodStart: string): Promise<ReportSnapshot | undefined>;
  async invalidate(userId: string, periodType: string, periodStart: string): Promise<void>;
}
```

#### M2-T7: 测试

**新建测试文件**:
- `tests/store/diet.test.ts` — CRUD + getDailySummary + getRangeSummary
- `tests/store/exercise.test.ts` — CRUD + getDailySummary + getRangeSummary
- `tests/store/goals.test.ts` — set + getActive + deactivate + 旧目标自动失效
- `tests/store/reports.test.ts` — save + get + invalidate

每个测试使用 `beforeEach` 清空对应表数据。

#### M2-T8: M2 验证

- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] 4 张新表在 PG 中创建成功
- [ ] Repository CRUD 测试覆盖

---

## M3: Agent 管道改造

### 目标

将现有单次 `plan → execute` 循环改造为 5 阶段管道：意图识别 → 实体抽取 → 知识库检索 → 动作执行 → 回复生成。

### 任务分解

#### M3-T1: 扩展 Agent 类型定义

**文件**: `src/agent/provider/base.ts`

**当前**:
```typescript
export type AgentPlan = {
  reply: string;
  actions: AgentAction[];
};
```

**改为**:
```typescript
export type IntentKind =
  | "record_diet"
  | "record_exercise"
  | "query_report"
  | "query_history"
  | "correct_record"
  | "set_goal"
  | "get_advice"
  | "chat";

export type AgentEntities = {
  // 饮食
  foodName?: string;
  quantity?: number;
  unit?: string;
  meal?: "breakfast" | "lunch" | "dinner" | "snack";
  // 运动
  exerciseName?: string;
  durationMin?: number;
  distanceKm?: number;
  intensity?: "low" | "medium" | "high";
  // 查询
  period?: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  date?: string;
  // 修正
  targetDescription?: string;
  // 目标
  goalType?: "calorie_intake" | "calorie_burn" | "weight";
  targetValue?: number;
  // 建议
  topic?: string;
};

export type AgentPlanOutput = {
  intent: IntentKind;
  entities: AgentEntities;
  reply: string;
};

// 保留旧类型供平滑迁移
export type AgentPlan = {
  reply: string;
  actions: AgentAction[];
};
```

#### M3-T2: 更新 `src/agent/provider/openai.ts`

**当前** (`src/agent/provider/openai.ts:13-17`):
```typescript
const SYSTEM_PROMPT = [
  "You are a planning assistant for a local automation workflow.",
  "Return plain text for direct replies.",
  "If tool execution is needed, return strict JSON: ...",
].join(" ");
```

**改为**:
- 使用 PRD 6.1 节定义的健康追踪 system prompt
- `plan()` 方法改为 `parse()` 方法，返回 `AgentPlanOutput`
- 保留 `plan()` 作为兼容入口，内部调用 `parse()` 并映射为旧格式（过渡期）

**解析逻辑**:
- LLM 返回 JSON `{ intent, entities, reply }`
- 用 Zod schema 校验 JSON 结构
- 若解析失败，重试一次（带 "请返回有效 JSON" 提示）
- 若仍失败，降级为 `intent: "chat"` + `reply: "抱歉，我没理解..."`

#### M3-T3: 实现 `src/agent/prompts.ts`

**新建文件**: `src/agent/prompts.ts`

集中管理所有 system prompt：
- `HEALTH_SYSTEM_PROMPT` — 主 system prompt（PRD 6.1 节）
- `buildContextBlock(context)` — 构造用户上下文文本块（今日记录 + 最近对话 + 目标）

```typescript
export function buildContextBlock(context: {
  todayDiet: DietRecord[];
  todayExercise: ExerciseRecord[];
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
  goals: UserGoal[];
  knowledgeAvailable: boolean;
}): string {
  // 格式化为 LLM 可读的上下文文本
}
```

#### M3-T4: 实现 `src/agent/pipeline.ts`

**新建文件**: `src/agent/pipeline.ts`

管道编排器，串联 5 个阶段：

```typescript
export function createHealthPipeline(deps: {
  provider: AgentProvider;
  knowledgeService: KnowledgeService;
  dietRepo: DietRepository;
  exerciseRepo: ExerciseRepository;
  goalRepo: GoalRepository;
  reportService: ReportService;
  threadRepo: ThreadRepository;
  logger: Logger;
}) {
  return {
    async handleMessage(userId: string, text: string): Promise<string> {
      // Stage 1: 加载上下文
      const context = await loadContext(userId);

      // Stage 2: LLM 意图识别 + 实体抽取
      const parsed = await deps.provider.parse({ userId, text, context });
      deps.logger.info({ intent: parsed.intent }, "agent parsed intent");

      // Stage 3: 知识库检索
      const knowledge = await lookupKnowledge(parsed);

      // Stage 4: 动作执行
      const result = await executeAction(parsed, knowledge, userId);

      // Stage 5: 回复生成
      return formatReply(parsed, result, knowledge);
    },
  };
}
```

**子函数**:
- `loadContext(userId)` — 从 PG 查询今日记录 + 最近对话 + 目标
- `lookupKnowledge(parsed)` — 根据意图调用 `knowledgeService.lookupFood/lookupExercise/getAdvice`
- `executeAction(parsed, knowledge, userId)` — 根据意图路由到对应 repository 操作
- `formatReply(parsed, result, knowledge)` — 格式化最终回复文本

#### M3-T5: 实现 `src/health/intent.ts`

**新建文件**: `src/health/intent.ts`

意图相关的辅助函数：
- `parseIntentFromLlmOutput(content: string): AgentPlanOutput` — 解析 LLM JSON 输出
- `validateEntities(intent: IntentKind, entities: AgentEntities): boolean` — 校验实体完整性
- `getMissingFields(intent: IntentKind, entities: AgentEntities): string[]` — 返回缺失字段列表

#### M3-T6: 实现 `src/health/reply-formatter.ts`

**新建文件**: `src/health/reply-formatter.ts`

各意图的回复格式化器：
- `formatDietReply(record, todaySummary, knowledge?)` — 饮食记录确认回复
- `formatExerciseReply(record, todaySummary, knowledge?)` — 运动记录确认回复
- `formatHistoryReply(records, date)` — 历史查询回复
- `formatCorrectionReply(updated)` — 修正记录回复
- `formatGoalReply(goal)` — 目标设置回复
- `formatAdviceReply(advice, topic?)` — 建议回复

#### M3-T7: 测试

**新建测试文件**:
- `tests/agent/pipeline.test.ts` — mock provider + knowledge + repos，验证管道各阶段
- `tests/health/intent.test.ts` — 验证 LLM 输出解析和实体校验
- `tests/health/reply-formatter.test.ts` — 验证各格式化器输出格式

#### M3-T8: M3 验证

- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] 管道能正确路由 8 种意图
- [ ] 知识库降级逻辑工作正常

---

## M4: 应用层集成

### 目标

将新管道接入应用主循环，替换现有的 `handleAdminMessage` 逻辑，完成端到端的消息处理。

### 任务分解

#### M4-T1: 改造 `src/app/main.ts`

**当前** (`src/app/main.ts`):
- `handleAdminMessage` — 创建线程 → plan → 遍历 actions → 审批 → 执行 → 回复

**改为**:
- `handleAdminMessage` — 创建/复用线程 → 调用 `pipeline.handleMessage()` → 记录事件 → 回复
- 移除 actions 遍历和审批逻辑（健康追踪全部自动审批）
- 保留线程管理（用于上下文恢复）

```typescript
async handleAdminMessage(message: InboundWeChatMessage) {
  if (message.fromUserId !== deps.adminUserId) return;

  // 1. 创建/复用线程
  const { threadId } = await deps.taskService.receiveMessage();

  // 2. 调用健康管道
  const reply = await deps.pipeline.handleMessage(message.fromUserId, message.text);

  // 3. 记录事件
  await deps.taskService.appendEvent(threadId, {
    kind: "message.handled",
    summary: reply.substring(0, 200),
  });

  // 4. 标记完成
  await deps.taskService.markDone(threadId);

  // 5. 回复
  await deps.sendReply(message.fromUserId, reply);
}
```

#### M4-T2: 改造 `src/app/entrypoint.ts`

**当前** (`src/app/entrypoint.ts`):
- 创建 `createSqliteDatabase` / `ThreadRepository` / `ApprovalRepository`
- 创建 `createToolRegistry`（shell/fs/web/wechat 工具）
- 创建 `createApplication`

**改为**:
- `createPgPool` 替代 `createSqliteDatabase`
- 新增 `DietRepository` / `ExerciseRepository` / `GoalRepository` / `ReportRepository`
- 新增 `createLightRagClient` + `createKnowledgeService`
- 新增 `createHealthPipeline` 替代旧 runtime + toolRegistry
- `createApplication` 接收 `pipeline` 而非 `runtime` + `tools` + `approvals`
- 移除 shell/fs/web 工具注册
- `createDefaultEntrypoint` 改为 `async`

#### M4-T3: 工具注册简化

**文件**: `src/tools/registry.ts`

移除 `shell.exec` / `fs.read` / `fs.write` / `web.search` / `web.fetch` / `vision.analyze` / `wechat.reply` 工具。

改为空注册表或直接移除（管道内部直接调用 repository，不再通过 tool registry 分发）。

**保留**:
- `src/tools/wechat/runner.ts` — 类型定义可复用
- `src/approval/` — 保留但 `policies.ts` 改为空 `Set`

#### M4-T4: 审批策略调整

**文件**: `src/approval/policies.ts`

```typescript
export const approvalRequiredTools = new Set<string>();  // 空 set
```

#### M4-T5: 集成测试

**新建测试文件**: `tests/app/health-integration.test.ts`

端到端测试：
1. 启动测试应用（PG 测试库 + mock LightRAG）
2. 模拟微信消息 "今天中午吃了一碗牛肉面"
3. 验证 PG 中 `diet_records` 表有对应记录
4. 验证回复文本包含热量信息
5. 模拟 "今天的报告" 消息
6. 验证回复包含当日汇总

#### M4-T6: M4 验证

- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] 端到端消息处理正常
- [ ] 回复文本格式符合 PRD 用户场景

---

## M5: 报告生成

### 目标

实现日/周/月/季/年五级报告聚合逻辑，融合知识库营养分析和建议。

### 任务分解

#### M5-T1: 实现 `src/health/report-generator.ts`

**新建文件**: `src/health/report-generator.ts`

```typescript
export function createReportService(deps: {
  dietRepo: DietRepository;
  exerciseRepo: ExerciseRepository;
  goalRepo: GoalRepository;
  reportRepo: ReportRepository;
  knowledgeService: KnowledgeService;
  logger: Logger;
}) {
  return {
    async generate(params: {
      userId: string;
      period: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
      date: string;
    }): Promise<Report> {
      // 1. 计算周期范围
      const { start, end } = computePeriod(params.period, params.date);

      // 2. 查询饮食和运动数据
      const dietSummary = await deps.dietRepo.getRangeSummary(userId, start, end);
      const exerciseSummary = await deps.exerciseRepo.getRangeSummary(userId, start, end);

      // 3. 计算聚合指标
      const totalIntake = dietSummary.totalCalories;
      const totalBurn = exerciseSummary.totalCalories;
      const netCalories = totalIntake - totalBurn;
      const days = countDays(start, end);
      const avgDailyIntake = totalIntake / days;
      const avgDailyBurn = totalBurn / days;

      // 4. 计算趋势（与前一个周期比较）
      const trend = await computeTrend(userId, params.period, start, end);

      // 5. 查询知识库建议
      const advice = await deps.knowledgeService.getAdvice(
        `热量报告分析：日均摄入${Math.round(avgDailyIntake)}kcal，消耗${Math.round(avgDailyBurn)}kcal`,
        { recentIntake: avgDailyIntake, recentBurn: avgDailyBurn },
      );

      // 6. 生成洞察
      const insights = generateInsights(dietSummary, exerciseSummary, goals);

      // 7. 组装报告
      const report: Report = { ... };

      // 8. 缓存快照
      await deps.reportRepo.save({ userId, periodType: params.period, periodStart: start, periodEnd: end, summaryJson: report });

      return report;
    },
  };
}
```

**辅助函数**:
- `computePeriod(period, date)` — 计算周期起止日期
  - daily: date ~ date
  - weekly: 周一 ~ 周日
  - monthly: 1日 ~ 月末
  - quarterly: 季初月1日 ~ 季末月末
  - yearly: 1月1日 ~ 12月31日
- `countDays(start, end)` — 计算天数
- `computeTrend(userId, period, start, end)` — 查询前一周期数据比较趋势
- `generateInsights(dietSummary, exerciseSummary, goals)` — 生成洞察文字

#### M5-T2: 报告格式化

**文件**: `src/health/reply-formatter.ts` (扩展)

新增 `formatReport(report: Report): string`，按 PRD 7.2 节格式输出：

```
📊 每日报告（2026-08-08）
【摄入】...
【消耗】...
【收支】...
【营养分析】...
【知识库建议】...
```

#### M5-T3: 报告快照缓存

在 `ReportService.generate` 中：
- 先查 `reportRepo.get()` 是否有缓存
- 若有且当日数据未变化（检查最新 `diet_records.created_at`），直接返回缓存
- 否则重新生成并保存

#### M5-T4: 测试

**新建测试文件**: `tests/health/report-generator.test.ts`

- 测试各周期日期计算
- 测试聚合逻辑（mock repo 返回数据）
- 测试趋势计算
- 测试报告格式化

#### M5-T5: M5 验证

- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] 5 种周期报告均可正确生成
- [ ] 报告格式符合 PRD 示例

---

## M6: 配置与收尾

### 目标

完成所有配置项、文档更新和端到端验证。

### 任务分解

#### M6-T1: 配置更新

**文件**:
- `src/shared/schema.ts` — 确认所有新配置项已添加（PRD 8.4 节）
- `src/shared/config.ts` — 确认 `loadConfig` 返回所有新配置
- `.env.example`（通过 Bash 创建，不读 `.env`）— 更新模板

#### M6-T2: 数据库初始化脚本

**新建文件**: `scripts/init-db.ts`

- 创建业务数据库 `wechat_claw`
- 创建 LightRAG 数据库 `lightrag`
- 执行 migration 创建所有表
- 创建初始管理员目标（从 `HEALTH_DEFAULT_CALORIE_GOAL` 读取）

#### M6-T3: 文档更新

**文件**:
- `README.md` — 更新项目描述、安装步骤、配置说明、启动命令
- `docs/plans/README.md` — 更新活跃计划列表
- `progress.txt` — 记录最终进度

#### M6-T4: 代码清理

- 移除不再使用的 `src/tools/shell/` / `src/tools/fs/` / `src/tools/web/` / `src/tools/vision/`
- 移除 `src/tools/registry.ts` 或精简为空
- 移除 `src/agent/planner.ts`（已被 pipeline 替代）
- 移除 `src/agent/runtime.ts`（已被 pipeline 替代）
- 保留 `src/approval/` 但精简

#### M6-T5: 全量验证

- [ ] `pnpm install` 成功
- [ ] `tsc --noEmit` 通过
- [ ] `pnpm test` 全部通过
- [ ] `pnpm run build` 成功
- [ ] `pnpm run start:wechat` 正常启动
- [ ] PG 连接 + LightRAG 连通性检查通过
- [ ] 手动发送微信消息测试完整流程
- [ ] 重启后历史数据可查询

---

## 依赖关系图

```
M0 (PG 迁移) ──────┐
                    ├──→ M2 (数据层) ──→ M3 (Agent 管道) ──→ M4 (应用集成) ──→ M5 (报告) ──→ M6 (收尾)
M1 (LightRAG) ─────┘                        ↑
                                            │
                                   M3 依赖 M1 的 KnowledgeService
                                   M3 依赖 M2 的 Repository
```

**并行机会**:
- M0 和 M1 可完全并行
- M2 的 T1（migration 扩展）可与 M0 的 T3（migration 重写）合并
- M5 的 T2（报告格式化）可与 M3 的 T6（reply-formatter）合并

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| SQLite → PG 迁移引入大量异步改动，可能遗漏 | M0 完成后全量测试，`tsc --noEmit` 捕获类型不匹配 |
| LightRAG 部署失败 | M1 可先 mock LightRAG API 开发，服务就绪后切换 |
| LLM 输出 JSON 格式不稳定 | Zod schema 校验 + 重试 + 降级为 chat 意图 |
| PG 测试环境不可用 | 使用 Docker 快速启动 PG 测试实例 |
| 知识数据格式化工作量大于预期 | 优先导入 calzen 中文数据（110 条）和 caltrack（1015 条），其余后续补充 |

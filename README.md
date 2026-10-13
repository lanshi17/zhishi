# 知食 ZhīShí

[![CI](https://github.com/lanshi17/zhishi/actions/workflows/ci.yml/badge.svg)](https://github.com/lanshi17/zhishi/actions/workflows/ci.yml)
[![Release](https://github.com/lanshi17/zhishi/actions/workflows/release.yml/badge.svg)](https://github.com/lanshi17/zhishi/actions/workflows/release.yml)

个人健康热量追踪助手 —— 通过微信发送自然语言记录每日饮食摄入与运动消耗，使用 LightRAG 知识库查询精确热量数据，自动生成日/周/月/季/年热量报告。

A personal health calorie tracking assistant. Users send natural language via WeChat to record daily diet and exercise. An agent pipeline parses intents, queries a LightRAG knowledge base for accurate calorie data, persists records to PostgreSQL, and generates periodic reports.

## Architecture

```
WeChat Message → iLink Gateway → Health Pipeline → PostgreSQL
                                     ↓
                              LightRAG Knowledge Base
                                     ↓
                              Reply Formatter → WeChat Reply
```

**5-stage pipeline:**
1. Intent classification + entity extraction (LLM)
2. Knowledge base retrieval (LightRAG)
3. Merge knowledge results into entities
4. Action execution (PostgreSQL persistence)
5. Reply formatting

## Install

Requires [Bun](https://bun.sh) 1.4.2 (pinned in `.bun-version`; the app relies on
Bun's automatic `.env` loading).

```bash
bun install
```

## Configure

1. Copy the example env file.
2. Replace the placeholders with your values.

```bash
cp .env.example .env
```

Required variables:

- `ADMIN_USER_ID`: trusted admin WeChat user ID
- `WORKSPACE_ROOT`: absolute path to the allowed local workspace
- `LLM_BASE_URL`: reachable OpenAI-compatible base URL
- `LLM_MODEL`: model name to call
- `LLM_API_KEY`: optional API key; leave empty if your provider allows it
- `DATABASE_URL`: PostgreSQL connection string
- `LIGHTRAG_API_URL`: LightRAG server URL (optional, enables knowledge base)
- `LIGHTRAG_ENABLED`: set to `false` to disable knowledge base

Optional:

- `LLM_SUPPORTS_IMAGE_INPUT`: set to `true` when the configured model accepts image inputs
- `LLM_VISION_MODEL`: optional vision-capable model override
- `PG_POOL_MAX`: maximum PostgreSQL pool size (default: driver setting)
- `PG_POOL_IDLE_TIMEOUT_MS`: idle PostgreSQL connection timeout in milliseconds
- `LIGHTRAG_API_KEY`: optional LightRAG API key
- `LIGHTRAG_TIMEOUT_MS`: LightRAG request timeout in milliseconds
- `TAVILY_API_KEY`: optional Tavily web-search API key
- `HEALTH_DEFAULT_CALORIE_GOAL`: default daily intake goal (default: 2000)
- `HEALTH_DEFAULT_BURN_GOAL`: default daily burn goal (default: 500)
- `LLM_CONTEXT_WINDOW`: per-user conversation-history token budget (default: `256000`)
- `ILINK_BOT_TOKEN`: iLink WeChat Bot token for real WeChat integration
- `ILINK_BOT_ID`: optional iLink bot identifier populated by QR setup
- `ILINK_USER_ID`: optional iLink user identifier populated by QR setup

The history budget uses a conservative character-based token estimate, so a
smaller custom value retains fewer, more recent messages. Both user messages
and assistant replies are persisted per user.

The health agent requires the LLM to call at least one registered health tool
before it can send a final response. For deterministic totals from saved
records, it uses `health.calculate_intake` and `health.calculate_expenditure`.
The latter includes both recorded exercise and BMR when the profile has gender,
age, height, and weight. Food images are accepted through iLink and sent to a
vision-capable model, which records an estimated food entry through the normal
diet tool.

## Setup

### PostgreSQL

```bash
docker run -d --name zhishi-pg \
  -e POSTGRES_DB=wechat_claw \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg18
```

Migrations run automatically on startup. `wechat_claw` is the database name
referenced by `.env.example`.

### LightRAG (optional but recommended)

```bash
# Start LightRAG server (requires Ollama or OpenAI)
bash scripts/start-lightrag.sh

# Import knowledge base data
bun scripts/init-knowledge-base.ts
```

### Test database

Integration tests connect to `TEST_DATABASE_URL`, which defaults to
`postgres://postgres:postgres@localhost:5432/wechat_claw_test`. Create that
database inside the same PostgreSQL container (a second container cannot bind
port 5432 again):

```bash
docker exec zhishi-pg createdb -U postgres wechat_claw_test
```

## Commands

```bash
bun run test          # run all tests (requires test PG)
bun run typecheck     # type check (tsc --noEmit)
bun run build         # build to dist/
bun run start:wechat  # start runtime
```

## CI and release

- `.github/workflows/ci.yml` runs the full gate on every push and pull request
  targeting `master` or `dev`.
- `.github/workflows/verify.yml` holds the gate itself, so pull requests and
  releases can never drift: `bun install --frozen-lockfile`, `bun run typecheck`,
  `bun run test` against a `pgvector/pgvector:pg18` service container, then
  `bun run build`.
- `.github/workflows/release.yml` runs on `v*` tags: it reuses the gate and
  publishes a GitHub release with the compiled `dist/` bundle attached.

```bash
git tag v0.1.0
git push origin v0.1.0
```

`bun.lock` is committed, so CI installs are reproducible; `package-lock.json`,
`pnpm-lock.yaml`, and `yarn.lock` are ignored by `.gitignore`.

## Usage examples

Send these messages via WeChat:

| Message | Intent | Action |
|---------|--------|--------|
| 今天早餐吃了两个包子 | record_diet | Query KB for calories, persist diet record |
| 下午跑了5公里 | record_exercise | Query KB for burn, persist exercise record |
| 看看今天的报告 | query_report | Generate daily report with insights |
| 给我这周的报告 | query_report | Generate weekly aggregated report |
| 我昨天吃了什么 | query_history | Return all records for the date |
| 今天摄入多少 | calculate_intake | Sum persisted diet-record calories deterministically |
| 今天消耗多少 | calculate_expenditure | Sum persisted exercise-record calories deterministically |
| 设置每天摄入1800千卡 | set_goal | Persist calorie intake goal |
| 给我一些减脂建议 | get_advice | Query KB for personalized advice |

## Project structure

```text
src/
  agent/        LLM provider, health pipeline, prompts, reply formatter
  app/          application composition, entrypoint, bootstrap
  approval/     approval policies and engine
  health/       LightRAG client, knowledge service, report generator, types
  shared/       config and schemas
  store/        PostgreSQL access, migrations, repositories (threads, diet, exercise, goals, reports)
  tasks/        thread routing, task service
  tools/        tool registry and runners
  tui/          terminal UI
  wechat/       WeChat gateway and iLink client

scripts/        LightRAG startup and knowledge base import scripts
docs/plans/     design and implementation docs
tests/          unit and integration tests
```

## Restart and recovery

All records are persisted to PostgreSQL. On restart:

- Diet records, exercise records, goals, and report snapshots are preserved
- Conversation history is restored per user, up to `LLM_CONTEXT_WINDOW`
- Pending approvals (legacy path) are recovered and shown in the TUI
- The health pipeline rebuilds health context from today's records on each message

## Related docs

- `docs/plans/2026-08-08-health-calorie-tracker-prd.md` — full PRD
- `docs/plans/README.md` — active plan list

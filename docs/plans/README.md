# Plans

## Active Plans

- `2026-08-08-health-calorie-tracker-prd.md` - PRD：通过微信通信记录饮食与运动热量，Agent 多流程处理，LightRAG 知识库，按日/周/月/季/年生成报告

## Implementation Status

| Milestone | Description | Status |
|-----------|-------------|--------|
| M0 | SQLite → PostgreSQL migration | ✅ Complete |
| M1 | LightRAG knowledge base integration | ✅ Code complete (server deployment pending LLM provider) |
| M2 | Data layer (health domain repositories) | ✅ Complete |
| M3 | Agent pipeline (5-stage, intent routing) | ✅ Complete |
| M4 | Application integration (entrypoint, main) | ✅ Complete |
| M5 | Report generation (daily/weekly/monthly/quarterly/yearly) | ✅ Complete |
| M6 | Configuration and finalization | ✅ Complete |

All 238 tests pass, tsc clean, build succeeds.

## Remaining operational tasks

- Deploy LightRAG server (requires Ollama or OpenAI LLM provider)
- Import knowledge base data (`scripts/init-knowledge-base.ts`)
- End-to-end smoke verification with live LightRAG

## Historical

- `2026-04-09-deliverable-internal-mvp-design.md`
- `2026-04-09-deliverable-internal-mvp.md`
- `2026-04-06-start-mvp-smoke-entrypoint-design.md`
- `2026-04-06-start-mvp-smoke-entrypoint.md`

Previous MVP design docs remain as historical context.

## Archive

- Completed plan and design documents live in `docs/plans/archive/`.

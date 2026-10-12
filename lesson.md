# Lessons Learned

## YYYY-MM-DD - Topic
- Symptom:
- Cause:
- Attempts:
- Resolution:
- Prevention:

## 2026-08-14 - Health assistant lacks multi-turn LLM context
- Symptom: Follow-up messages that depend on prior conversational wording can appear to be forgotten by the LLM.
- Cause: `createHealthPipeline.handleMessage` initializes the provider message list with only the current user message. The application writes only a truncated `health.replied` event after completion; it does not persist the inbound message or reconstruct ordered `user`/`assistant` messages. Also, the thread router creates a new thread once the prior thread is marked `done`, so the context builder selects the newly created empty thread.
- Attempts: Traced the inbound-message path through application, entrypoint, pipeline, agent loop, provider, task service, and repositories. Ran `pnpm vitest run tests/agent/health-prompt.test.ts tests/agent/pipeline.test.ts` successfully (22 tests); these tests do not cover consecutive-message propagation.
- Resolution: Added the `conversation_messages` PostgreSQL table and repository. The pipeline loads a bounded, chronological user/assistant history before each provider call, writes the inbound message before processing, and writes the final reply afterward. `LLM_CONTEXT_WINDOW` is configurable and defaults to 256000.
- Prevention: Regression tests assert ordered history reaches the second provider request, persisted history trims to the newest messages inside the budget, and the configuration default/override remain stable.

## 2026-08-14 - Direct LLM replies and conversation retention
- Symptom: Concern that context retention might only work when the LLM invokes a tool.
- Cause: The concern was caused by conflating the agent loop's tool-call branch with its final-response branch.
- Attempts: Ran the focused pipeline regression using a provider result of `{ kind: "final" }` and no tool calls.
- Resolution: No production change was needed. The pipeline persists the user message before `runLoop`, then persists every final assistant reply after `runLoop`, irrespective of tool use.
- Prevention: The regression test name explicitly states the no-tool direct-reply guarantee.

## 2026-08-14 - Health-agent replies must be tool-grounded
- Symptom: The agent loop accepted a direct model response even when the health workflow required a tool-grounded result.
- Cause: `createAgentLoop` treated every `final` result as successful, and the health system prompt explicitly allowed idle chat without a tool.
- Attempts: Added failing tests for required tool calls and for deterministic daily intake/expenditure totals. The tests confirmed direct replies were accepted and that the calculation tools were absent.
- Resolution: Added the `requireToolCall` loop option and enabled it for the health pipeline. Added deterministic daily-summary tools backed by the diet and exercise repositories.
- Prevention: Keep the no-tool rejection test and both deterministic-calculation tests in the health-agent regression suite.

## 2026-08-14 - Report expenditure must include BMR
- Symptom: Daily and period reports treated only logged exercise as energy expenditure, so net calories were overstated.
- Cause: The report generator aggregated `exercise_records` but never loaded the user's health profile or calculated BMR.
- Attempts: Added failing report and deterministic-expenditure tests with a complete profile. A first verification exposed leaked `user_profiles` rows between integration tests; the shared database cleanup omitted that table.
- Resolution: Reports now expose `exerciseBurn` and `basalBurn`, and calculate `totalBurn` as their sum. The deterministic expenditure tool follows the same calculation. The test cleanup now truncates `user_profiles`.
- Prevention: Keep profile-aware report coverage and ensure shared test cleanup includes every persisted table that can affect calculations.

## 2026-08-19 - PostgreSQL 未启动导致服务首次启动失败
- Symptom: `pnpm run start:wechat` 首次退出，报 `Startup failed [database]: connect ECONNREFUSED 127.0.0.1:5432`。
- Cause: `.env` 指向本机 PostgreSQL，但 `5432` 无监听进程，已有测试数据库容器也处于退出状态。
- Attempts: 检查 Docker 容器与端口监听；启动 `wechat-claw-pg` PostgreSQL 容器并等待 `pg_isready` 返回 accepting connections；随后重启微信服务。
- Resolution: 数据库就绪后服务成功完成构建、数据库启动初始化并进入 TUI 运行状态。
- Prevention: 启动服务前确认 `DATABASE_URL` 对应数据库可连接；可将数据库容器纳入统一启动脚本。

## 2026-08-19 - LightRAG 配置、代理依赖与向量模型不一致
- Symptom: LightRAG `/health` 不可达；旧启动脚本默认连接本地 Ollama，未继承项目 `.env` 的远程 LLM；修正配置后查询仍返回 `no-context`。
- Cause: 启动脚本没有传播 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`；当前环境的 `ALL_PROXY` 使用 SOCKS5 但 `.venv-lightrag` 缺少 `socksio`；已有 1024 维向量由不同嵌入模型生成，维度相同但语义空间不一致。
- Attempts: 复现 `/health` 连接失败；检查 LightRAG v1.5.6 配置与日志；验证 SiliconFlow 的 LLM/嵌入接口；安装 `socksio`；停服后备份并使用当前配置全量重建 47 个实体、78 个关系和 23 个文本块向量；重启后分别执行健康检查、naive 检索和 hybrid 检索。
- Resolution: `scripts/start-lightrag.sh` 现在加载项目 `.env`，显式配置 OpenAI-compatible LLM/embedding、1024 维且不发送不兼容的 `dimensions` 参数，默认复用现有文件存储，并仅监听 `127.0.0.1`。混合查询已返回“鸡胸肉每100克 165 kcal”。
- Prevention: 更换嵌入模型或提供商时必须重建所有 VDB；保持 `EMBEDDING_MODEL`、`EMBEDDING_DIM`、`EMBEDDING_SEND_DIM` 与 API 能力一致；重建前先停止服务并保留索引备份；代理环境变化时检查 Python SOCKS 依赖。

## 2026-08-20 - 全量测试缺少 PostgreSQL 测试库
- Symptom: 首次运行 `pnpm test` 时，22 个数据库集成测试因 `database "wechat_claw_test" does not exist` 失败；模板一致性测试、typecheck 和 build 不受影响。
- Cause: 当前 `wechat-claw-pg` 容器只创建了开发库 `wechat_claw`，未按 README 的测试配置创建 `wechat_claw_test`。
- Attempts: 检查运行中的 PostgreSQL 容器及数据库列表，确认测试库缺失；创建 `wechat_claw_test` 后重新运行全量测试。
- Resolution: 测试数据库创建成功，第二次 `pnpm test` 全部通过（35 个测试文件、246 个测试）。
- Prevention: 在执行 PostgreSQL 集成测试前，先确认 `TEST_DATABASE_URL` 指向的数据库存在并可连接；将测试库创建纳入本地启动准备步骤。

## 2026-10-12 - 合并到主分支后全量测试因 PostgreSQL 容器停止而失败
- Symptom: 快进合并到 master 后首次 `pnpm test`，11 个测试文件失败、2 个用例失败，错误为 `connect ECONNREFUSED 127.0.0.1:5432`。
- Cause: `wechat-claw-pg` 容器处于 Exited 状态，本机 5432 无监听。失败集合全部是依赖 PostgreSQL 的集成测试（tests/store/*、tests/tasks/service、tests/health/report-generator、tests/app/*），与本次合并内容（.env.example、README、docs、.gitignore、单个模板测试）无因果关系。
- Attempts: 先比对失败文件清单，确认其全部为 DB 集成测试且新增的 `tests/shared/env-example.test.ts` 已通过；随后 `docker start wechat-claw-pg` 并轮询 `pg_isready` 至 accepting connections。
- Resolution: 数据库就绪后重跑全量测试，35 个文件/246 个测试全部通过；typecheck 与 build 通过，master 快进合并后无回归。
- Prevention: 合并或发布前先启动 `wechat-claw-pg` 并确认 5432 可连接；批量失败若集中在 DB 集成测试，应先判定环境因素再怀疑回归，避免把环境性失败当成代码问题。

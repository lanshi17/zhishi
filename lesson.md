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

## 2026-10-12 - gh CLI 凭据失效导致无法自动创建 PR
- Symptom: `gh pr create` 返回 `HTTP 401: Bad credentials (https://api.github.com/graphql)`；`gh auth status` 同时报 GH_TOKEN 无效与 keyring 登录失败。
- Cause: 环境变量 `GH_TOKEN` 为无效 token；`~/.config/gh/hosts.yml` 中保存的 `oauth_token`（user: lanshi17）也已被 GitHub 拒绝。仓库为私有（未认证 REST 请求返回 403），因此不存在匿名创建 PR 的路径。
- Attempts: 核对 `gh auth status`；用 `env -u GH_TOKEN` 排除环境变量干扰后重试（仍 401）；检查 hosts.yml、项目 `.env` 键名与 shell profile，确认无可用凭据；`git push` 走 SSH 仍正常，说明仅 HTTPS API 凭据失效。
- Resolution: 无凭据无法建 PR；改为推送 `fix/lightrag-startup`（ca830e1）并给出 `compare/master...fix/lightrag-startup` 链接，PR 创建交由人工完成。
- Prevention: 涉及 PR 自动化前先执行 `gh auth status` 校验凭据；不要在环境中注入过期 `GH_TOKEN` 覆盖有效凭据；token 轮换后同步更新 `hosts.yml`，并区分 SSH 推送权限与 API 凭据是两套独立凭据。

## 2026-10-13 - bun 迁移：vitest 兼容性与 .env 自动加载
- Symptom: 迁移前存在两个未知风险——Vitest 官方只支持 Node 运行时，担心 `bun run test` 无法执行 246 个测试；同时应用只读取 `process.env`，担心 bun 下的环境变量加载方式与原先不同。
- Cause: 仓库原用 pnpm + Node 24（`packageManager: pnpm@10.17.1`），且 `package-lock.json` 是唯一被跟踪的锁文件，`pnpm-lock.yaml` 被 `.gitignore` 忽略，CI 无法做可复现安装。
- Attempts: 先后执行 `bun install`（自动从 `package-lock.json` 迁移生成 `bun.lock`，84 包）、`bun run typecheck`、`bun run test`、`bun run build`，再以干净克隆（无 `.env`、无 `node_modules`）从零复现全部 CI 步骤，并针对全新数据库（`wechat_claw_ci_dryrun`）运行集成测试。
- Resolution: Vitest 3.2.4 在 bun 1.4.2 下完整通过 35 文件/246 测试；`tsc` 类型检查与构建同样正常；bun 会自动加载 `.env`（`bun run start:mvp` 实测已读到 `.env` 中的 LLM 配置），因此 README 明确标注该依赖。锁文件策略收敛为只保留 `bun.lock`，删除 `package-lock.json`、`pnpm-lock.yaml` 与失效的 `pnpm-workspace.yaml`。
- Prevention: 迁移包管理器后必须在干净克隆中复现 CI 全部步骤，避免依赖本地 `node_modules` 或 `.env` 的假通过；依赖版本以 `bun.lock` 为准，升级依赖后重新跑全量测试；新增运行时假设（如自动加载 `.env`）必须写入 README。

## 2026-10-13 - gh 无有效凭据导致无法完善仓库 About
- Symptom: `gh api -X PATCH repos/lanshi17/zhishi -f description=... -f 'topics[]=...'` 返回 `401 Bad credentials`，仓库 About 的描述、主页与 topics 无法通过 API 写入。
- Cause: 与 2026-10-12 记录同源——环境 `GH_TOKEN` 与 `~/.config/gh/hosts.yml` 的 `oauth_token` 均被 GitHub 拒绝；SSH 推送可用但 API 需要独立凭据，仓库为私有，未认证请求返回 403。
- Attempts: 复查 `gh auth status`；`env -u GH_TOKEN` 排除环境变量干扰后重试 PATCH（仍 401）；确认 `.env`、shell profile、`~/.netrc`、`~/.git-credentials` 中均无可用 token。
- Resolution: About 变更改为人工执行：`gh auth login` 后运行 `gh repo edit lanshi17/zhishi --description "<描述>" --add-topic wechat-bot --add-topic calorie-tracker --add-topic lightrag --add-topic rag --add-topic typescript --add-topic bun --add-topic postgresql`，或在网页 About 面板填写（建议描述：知食 ZhīShí — 个人健康热量追踪微信助手：LightRAG + PostgreSQL + Bun/TypeScript；topics：wechat-bot、health、calorie-tracker、lightrag、rag、agent、typescript、bun、postgresql、llm；homepage 暂无站点可留空）。
- Prevention: 把 About/分支保护等仓库级设置记入待办并标注凭据前提；CI 与发布流程不要假设存在 PAT，凡需要 API 凭据的步骤都先跑 `gh auth status` 判定。

## 2026-10-13 - GH_TOKEN 覆盖导致 gh auth login 无法保存凭据
- Symptom: `gh auth login` 直接退出（code 1），提示 "The value of the GH_TOKEN environment variable is being used for authentication. To have GitHub CLI store credentials instead, first clear the value from the environment."
- Cause: `~/.zshenv` 第 56 行存在 `export GH_TOKEN=<PAT>`，该 PAT 已被 GitHub 拒绝（API 返回 401 Bad credentials）；zsh 每次启动都会注入，且该值进一步传播到 tmux 服务端全局环境与 `systemd --user` 环境，因此交互式登录和新开终端都带着它。
- Attempts: 用 `grep` 定位到 `~/.zshenv` 的导出语句；沿 `ps`/`/proc/<pid>/environ` 进程链确认导出者；检查 `systemctl --user show-environment` 与 `tmux show-environment -g` 确认污染范围。清理后在同一面板重跑仍报同一错误——已运行的 shell 进程内存中依旧持有该变量；实测新建 tmux 会话内启动的 zsh `env | grep -c '^GH_TOKEN='` 为 0，且 `/etc/zsh`、`/etc/profile.d`、`~/.zshrc`、`~/.zprofile`、`~/.config/environment.d` 均无导出。
- Resolution: 注释掉 `.zshenv` 中的导出并写入说明；执行 `systemctl --user unset-environment GH_TOKEN` 与 `tmux setenv -gu GH_TOKEN` 清理已传播的环境；确认新启动的 zsh（在无 GH_TOKEN 的父环境下）不再看到该变量，`gh auth status` 转为提示 `gh auth login -h github.com`。
- Prevention: 需要 `gh auth login` 保存凭据时，先确保 `GH_TOKEN`/`GITHUB_TOKEN` 不在环境里——最稳妥的是 `env -u GH_TOKEN gh auth login ...`，因为已运行的面板无法通过改配置文件消除内存中的变量（或 `unset GH_TOKEN` 后重试）；环境变量优先级高于 keyring 与 hosts.yml，失效的 token 应直接移除而不是留着；该 PAT 曾被打印到会话记录中，应在 GitHub 设置里吊销。

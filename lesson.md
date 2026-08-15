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

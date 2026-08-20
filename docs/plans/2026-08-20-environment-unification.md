# Environment Variable Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align `.env.example`, the local `.env`, and configuration documentation to the complete environment contract defined by `src/shared/schema.ts`, without changing runtime behavior or exposing secrets.

**Architecture:** `src/shared/schema.ts` remains the source of truth for supported variable names. `.env.example` is the safe, committed setup template; `.env` remains ignored and stores machine-specific values. README documents the same contract. A focused Vitest contract test verifies that the public template contains exactly the schema fields.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm, Markdown, shell environment files.

---

### Task 1: Add the template consistency contract

**Files:**
- Create: `tests/shared/env-example.test.ts`
- Reference: `src/shared/schema.ts`
- Reference: `.env.example`

**Step 1: Write the failing test**

Add a Vitest test that:

- reads `.env.example` relative to the repository root;
- extracts non-comment, non-empty assignment names;
- compares the sorted names against `Object.keys(envSchema.shape)`;
- fails if the template omits a schema field or contains an unsupported field;
- does not inspect or print values.

Use the existing `describe`/`it` conventions in `tests/shared/config.test.ts` and import `envSchema` from `src/shared/schema.js`.

**Step 2: Run the focused test**

Run: `pnpm exec vitest run tests/shared/env-example.test.ts`

Expected: FAIL because the current `.env.example` does not include all schema-supported fields and has a field-set mismatch.

**Step 3: Keep the test minimal**

Do not add a runtime configuration loader, a new dependency, or a test of `.env` values. The test protects only the committed public template contract.

**Step 4: Re-run after template alignment**

Run: `pnpm exec vitest run tests/shared/env-example.test.ts`

Expected: PASS.

---

### Task 2: Align public and local environment files

**Files:**
- Modify: `.env.example`
- Modify: `.env` (ignored local file; never stage or commit)
- Reference: `src/shared/schema.ts`

**Step 1: Define the canonical order**

Use these groups and the schema field set:

- Core: `ADMIN_USER_ID`, `WORKSPACE_ROOT`
- LLM: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_SUPPORTS_IMAGE_INPUT`, `LLM_VISION_MODEL`
- PostgreSQL: `DATABASE_URL`, `PG_POOL_MAX`, `PG_POOL_IDLE_TIMEOUT_MS`
- LightRAG: `LIGHTRAG_ENABLED`, `LIGHTRAG_API_URL`, `LIGHTRAG_API_KEY`, `LIGHTRAG_TIMEOUT_MS`
- Tavily: `TAVILY_API_KEY`
- Health: `HEALTH_DEFAULT_CALORIE_GOAL`, `HEALTH_DEFAULT_BURN_GOAL`, `LLM_CONTEXT_WINDOW`
- iLink: `ILINK_BOT_TOKEN`, `ILINK_BOT_ID`, `ILINK_USER_ID`

**Step 2: Update `.env.example`**

Add the missing optional fields with empty values or safe placeholders. Remove duplicate `LLM_SUPPORTS_IMAGE_INPUT`. Keep comments concise and explain only non-obvious defaults. Do not add variables absent from `envSchema`.

**Step 3: Update local `.env` safely**

Reorder and deduplicate the local file to the canonical order, preserving every existing configured value byte-for-byte where possible. Add missing schema fields as empty assignments. Never copy real values into `.env.example`, never print values, and never stage `.env`.

**Step 4: Check field sets without exposing values**

Use a names-only comparison for `.env.example` and `.env` and inspect `git status --short` to confirm `.env` is ignored and unstaged.

---

### Task 3: Synchronize README configuration documentation

**Files:**
- Modify: `README.md:30-58`

**Step 1: Document the complete field contract**

Keep the existing required/optional structure, adding the supported optional variables that are currently undocumented: `PG_POOL_MAX`, `PG_POOL_IDLE_TIMEOUT_MS`, `LIGHTRAG_API_KEY`, `LIGHTRAG_TIMEOUT_MS`, `TAVILY_API_KEY`, `ILINK_BOT_ID`, and `ILINK_USER_ID`. Include `LLM_VISION_MODEL` with its current meaning.

**Step 2: Preserve behavior and wording scope**

Do not change startup commands, provider semantics, database instructions, or historical documentation. Ensure the README says `.env.example` is copied to `.env` and does not suggest committing `.env`.

---

### Task 4: Verify the complete change

**Files:**
- Reference: `package.json`
- Reference: `vitest.config.ts`
- Reference: `tsconfig.json`

**Step 1: Run the focused contract test**

Run: `pnpm exec vitest run tests/shared/env-example.test.ts`

Expected: PASS.

**Step 2: Run the full test suite**

Run: `pnpm test`

Expected: all existing tests plus the template contract test PASS.

**Step 3: Run typecheck and build**

Run: `pnpm run typecheck && pnpm run build`

Expected: both commands exit successfully.

**Step 4: Review staged scope**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only `.env.example`, `README.md`, the new focused test, and required progress/lesson records are staged. `.env`, `command.log`, and unrelated `.gitignore` changes remain unstaged/ignored.

**Step 5: Record completion**

Append the verified result and next step to `progress.txt`. If any command fails or requires a retry, record the symptom, cause, attempt, conclusion, and prevention in `lesson.md` per repository rules.

**Step 6: Commit the implementation**

Use a single Conventional Commit after verification:

```bash
git add .env.example README.md tests/shared/env-example.test.ts progress.txt lesson.md
git commit -m "chore(config): unify environment templates"
```

Never add `.env`, `command.log`, generated logs, or unrelated pre-existing changes.

# Environment Variable Unification Design

## Problem

The repository has a tracked public template (`.env.example`) and an ignored local configuration (`.env`) with different field sets and ordering. The runtime schema in `src/shared/schema.ts` supports fields that are absent from the public template, while the local file contains duplicate and additional fields. This makes configuration setup and review error-prone.

## Decision

Use `src/shared/schema.ts` as the environment-variable source of truth. Keep `.env.example` as the complete, safe-to-share template and keep `.env` as the local-value file. Align both files to the same field set, grouping, and order without exposing or changing local secrets.

Canonical groups:

1. Core
2. LLM (OpenAI-compatible)
3. PostgreSQL
4. LightRAG Knowledge Base
5. Tavily Web Search
6. Health Tracking Defaults
7. iLink WeChat Bot

The template will include every schema-supported field, including optional `LLM_VISION_MODEL`, `TAVILY_API_KEY`, `ILINK_BOT_ID`, and `ILINK_USER_ID`. Duplicate entries will be removed. Sensitive template values remain empty or safe placeholders. The local `.env` keeps its existing values and is not committed.

## Scope

- Update `.env.example` to match the schema and canonical grouping.
- Reorder and deduplicate the ignored local `.env` without changing its configured values.
- Synchronize README configuration documentation with the complete field set.
- Do not change runtime behavior, environment-variable names, dependency management, or database configuration.

## Validation

- Compare the environment field sets in `.env.example`, `.env`, and `src/shared/schema.ts`.
- Run the repository typecheck and Vitest suite.
- Run the project build if the existing verification workflow requires it.
- Confirm `.env` remains ignored and no secret-bearing file is staged.

#!/usr/bin/env bash
set -euo pipefail

# Start LightRAG knowledge base server
# Prerequisites:
#   1. PostgreSQL running with pgvector extension
#   2. Ollama running (or set OPENAI_API_KEY for OpenAI)
#   3. LightRAG installed: uv pip install lightrag-hku fastapi uvicorn aiofiles pyjwt python-multipart bcrypt openai
#
# Usage:
#   ./scripts/start-lightrag.sh
#
# Environment variables:
#   LIGHTRAG_LLM_HOST   - LLM API host (default: http://localhost:11434/v1 for Ollama)
#   LIGHTRAG_LLM_KEY    - LLM API key (default: dummy for Ollama)
#   LIGHTRAG_LLM_MODEL  - LLM model name (default: qwen2.5-coder)
#   LIGHTRAG_EMBED_MODEL - Embedding model (default: nomic-embed-text)
#   LIGHTRAG_EMBED_HOST  - Embedding API host (default: same as LLM host)
#   PG_HOST / PG_PORT / PG_USER / PG_PASSWORD - PostgreSQL connection

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/.venv-lightrag"

LLM_HOST="${LIGHTRAG_LLM_HOST:-http://localhost:11434/v1}"
LLM_KEY="${LIGHTRAG_LLM_KEY:-dummy}"
LLM_MODEL="${LIGHTRAG_LLM_MODEL:-qwen2.5-coder}"
EMBED_MODEL="${LIGHTRAG_EMBED_MODEL:-nomic-embed-text}"
EMBED_HOST="${LIGHTRAG_EMBED_HOST:-$LLM_HOST}"

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-postgres}"
PG_PASSWORD="${PG_PASSWORD:-postgres}"
PG_DB="${PG_DB:-lightrag}"

export POSTGRES_HOST="$PG_HOST"
export POSTGRES_PORT="$PG_PORT"
export POSTGRES_USER="$PG_USER"
export POSTGRES_PASSWORD="$PG_PASSWORD"
export POSTGRES_DATABASE="$PG_DB"

export LLM_BINDING_API_KEY="$LLM_KEY"
export EMBEDDING_BINDING_API_KEY="$LLM_KEY"
export LLM_BINDING_HOST="$LLM_HOST"
export EMBEDDING_BINDING_HOST="$EMBED_HOST"
export LLM_MODEL="$LLM_MODEL"
export EMBEDDING_MODEL="$EMBED_MODEL"

exec "$VENV_DIR/bin/lightrag-server" \
  --host 0.0.0.0 \
  --port 9621 \
  --llm-binding openai \
  --embedding-binding openai \
  --log-level INFO

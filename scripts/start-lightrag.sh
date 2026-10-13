#!/usr/bin/env bash
set -euo pipefail

# Start LightRAG knowledge base server.
#
# The project uses the same OpenAI-compatible provider for the health agent and
# LightRAG. The script imports the project .env so both services cannot silently
# diverge. File-backed storage remains the default because the repository
# already contains the indexed knowledge base under rag_storage/; PostgreSQL
# storage can still be selected through the LIGHTRAG_*_STORAGE variables.
#
# Usage:
#   ./scripts/start-lightrag.sh
#
# Optional overrides:
#   LIGHTRAG_LLM_HOST / LIGHTRAG_LLM_KEY / LIGHTRAG_LLM_MODEL
#   LIGHTRAG_EMBED_HOST / LIGHTRAG_EMBED_KEY / LIGHTRAG_EMBED_MODEL
#   LIGHTRAG_EMBED_DIM / LIGHTRAG_KV_STORAGE / LIGHTRAG_VECTOR_STORAGE
#   LIGHTRAG_GRAPH_STORAGE / LIGHTRAG_DOC_STATUS_STORAGE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$PROJECT_ROOT/.venv-lightrag"

if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

cd "$PROJECT_ROOT"

LLM_HOST="${LIGHTRAG_LLM_HOST:-${LLM_BASE_URL:-http://localhost:11434/v1}}"
LLM_KEY="${LIGHTRAG_LLM_KEY:-${LLM_API_KEY:-dummy}}"
LLM_MODEL="${LIGHTRAG_LLM_MODEL:-${LLM_MODEL:-qwen2.5-coder}}"

if [[ -n "${LIGHTRAG_EMBED_MODEL:-}" ]]; then
  EMBED_MODEL="$LIGHTRAG_EMBED_MODEL"
elif [[ -n "${LLM_BASE_URL:-}" ]]; then
  EMBED_MODEL="BAAI/bge-m3"
else
  EMBED_MODEL="nomic-embed-text"
fi

EMBED_HOST="${LIGHTRAG_EMBED_HOST:-${EMBEDDING_BINDING_HOST:-$LLM_HOST}}"
EMBED_KEY="${LIGHTRAG_EMBED_KEY:-${EMBEDDING_BINDING_API_KEY:-$LLM_KEY}}"
EMBED_DIM="${LIGHTRAG_EMBED_DIM:-${EMBEDDING_DIM:-1024}}"

export LLM_BINDING="openai"
export EMBEDDING_BINDING="openai"
export LLM_BINDING_API_KEY="$LLM_KEY"
export EMBEDDING_BINDING_API_KEY="$EMBED_KEY"
export LLM_BINDING_HOST="$LLM_HOST"
export EMBEDDING_BINDING_HOST="$EMBED_HOST"
export LLM_MODEL="$LLM_MODEL"
export EMBEDDING_MODEL="$EMBED_MODEL"
# SiliconFlow's bge-m3 endpoint returns its native 1024 dimensions but rejects
# the OpenAI-compatible `dimensions` request parameter.
export EMBEDDING_DIM="$EMBED_DIM"
export EMBEDDING_SEND_DIM="false"

# Keep existing indexed data usable and avoid requiring a second database by
# default. Set these explicitly to PG* implementations when PostgreSQL storage
# is desired.
export LIGHTRAG_KV_STORAGE="${LIGHTRAG_KV_STORAGE:-JsonKVStorage}"
export LIGHTRAG_DOC_STATUS_STORAGE="${LIGHTRAG_DOC_STATUS_STORAGE:-JsonDocStatusStorage}"
export LIGHTRAG_GRAPH_STORAGE="${LIGHTRAG_GRAPH_STORAGE:-NetworkXStorage}"
export LIGHTRAG_VECTOR_STORAGE="${LIGHTRAG_VECTOR_STORAGE:-NanoVectorDBStorage}"

exec "$VENV_DIR/bin/lightrag-server" \
  --host 127.0.0.1 \
  --port 9621 \
  --llm-binding openai \
  --embedding-binding openai \
  --workers 1 \
  --log-level INFO

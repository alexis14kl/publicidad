#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PROFILE_NAME="${1:-#1 Chat Gpt PRO}"
CDP_URL="${2:-http://127.0.0.1:9333}"
PROFILE_DEBUG_PORT_HINT="${3:-}"
RUN_MODE="${4:-}"
OPENAPI_PORT_HINT="${5:-}"
OPENAPI_SECRET_HINT="${6:-}"

export DICLOAK_MAIN_CDP_URL="$CDP_URL"
exec ./iniciar_mac.sh "$PROFILE_NAME" "$PROFILE_DEBUG_PORT_HINT" "$RUN_MODE" "$OPENAPI_PORT_HINT" "$OPENAPI_SECRET_HINT"

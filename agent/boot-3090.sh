#!/bin/sh
# Boot the acceptance `dsh web` on :3090 (see plan/PROTOCOL.md).
# Human owns this process. Overnight agents must REUSE it — accept-m1 never
# kills or respawns it. Sources .env.local (never prints keys). Strips session
# + profile vars so this host is not bound to the agent's GUI session.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
# shellcheck disable=SC1091
. "$DIR/.env.local"
# LLAMA_API_KEY arms llama-server; stub is LLAMACPP_API_KEY only.
unset LLAMA_API_KEY LLAMA_API_KEY_FILE
exec env -u DSH_WEB_URL -u DSH_SHELL -u DSH_SESSION_ID -u DSH_PROFILE -u DSH_PROFILE_DIR \
  dsh web --port 3090 --no-open

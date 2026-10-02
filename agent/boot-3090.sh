#!/bin/sh
# Boot the acceptance `dsh web` on :3090 (see plan/PROTOCOL.md "Sacred").
# Sources .env.local for the API keys dsh needs to boot (never prints them),
# and unsets the session vars that would bind the boot to this GUI session.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
. "$DIR/.env.local"
exec env -u DSH_WEB_URL -u DSH_SHELL -u DSH_SESSION_ID dsh web --port 3090 --no-open

#!/usr/bin/env bash
# Emit one action across three sources with a shared trace id. Requires a running
# relay (npx xray) and node + python3 on PATH.
set -euo pipefail

URL="${XRAY_URL:-http://127.0.0.1:7200}"
export XRAY_ENABLED=1
export XRAY_TRACE=demo_trace

if ! curl -s --max-time 1 "$URL/health" >/dev/null; then
  echo "No relay at $URL — start one with: npx xray" >&2
  exit 1
fi

# 1. Node "API" receives the request.
XRAY_SOURCE=api node ./emit.mjs

# 2. Python "worker" picks up the job (uses the relay-served helper).
curl -s "$URL/xray.py" >/tmp/xray_demo_helper.py
XRAY_SOURCE=worker python3 - <<'PY'
import sys, time
sys.path.insert(0, "/tmp")
from xray_demo_helper import xray
xray("job.processed", {"items": 3})
time.sleep(0.3)
PY

# 3. A shell deploy step finishes the action.
XRAY_SOURCE=cli curl -s --max-time 1 -X POST "$URL/events" \
  -H 'Content-Type: application/json' \
  -d "{\"event\":\"deploy.done\",\"source\":\"cli\",\"trace\":\"$XRAY_TRACE\"}" >/dev/null

echo "Emitted api → worker → cli with trace=$XRAY_TRACE. Run: xray drain"

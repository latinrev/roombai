#!/usr/bin/env bash
# Read-only check that a verify run's RoomBai instance is ours and worth driving.
# Usage: doctor.sh RUN_DIR
set -uo pipefail

RUN_DIR=${1:?usage: doctor.sh RUN_DIR}
[ -f "$RUN_DIR/run.env" ] || { echo "FAIL: no run.env in $RUN_DIR"; exit 1; }
# shellcheck disable=SC1091
. "$RUN_DIR/run.env"
CDP="node $(dirname "$0")/cdp.mjs $RUN_DIR"

fail() { echo "FAIL: $*"; exit 1; }
ok() { echo "ok: $*"; }

kill -0 "$PID" 2>/dev/null || fail "process $PID from this run is not running"
[ "$(ps -o pgid= -p "$PID" | tr -d ' ')" = "$PID" ] || fail "process $PID does not lead its own process group"
ok "process group $PID is running"

owner=$(ss -Hltnp 'sport = :47770' | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)
[ -n "$owner" ] || fail "nobody owns port 47770 yet"
[ "$(ps -o pgid= -p "$owner" | tr -d ' ')" = "$PID" ] || fail "port 47770 belongs to pid $owner, outside this run. Do not drive it."
ok "port 47770 belongs to pid $owner in this run"

curl -sf --max-time 3 http://127.0.0.1:47770/ | jq -e 'type == "array"' >/dev/null || fail "GET http://127.0.0.1:47770/ did not return a JSON array"
ok "GET / returns a JSON array"

page=$($CDP eval 'location.pathname + " " + document.title' 2>&1) || fail "CDP on port $CDP_PORT: $page"
[ "$page" = "\"$REPO/src/renderer/index.html Roombai\"" ] || fail "CDP page is $page, not this checkout's renderer"
ok "CDP port $CDP_PORT drives $REPO/src/renderer/index.html"

ready=$($CDP eval 'typeof syncAgents === "function" && roomList.length > 0 && Boolean(appCfg.version)' 2>&1)
[ "$ready" = "true" ] || fail "renderer not ready: $ready"
version=$($CDP eval 'appCfg.version' | tr -d '"')
[ "$version" = "$(jq -r .version "$REPO/package.json")" ] || fail "renderer reports version $version, package.json differs"
ok "renderer ready, version $version, commit $COMMIT"

[ -d "$RUN_DIR/scratch/tmp/roombai-dev" ] || fail "userData is not in $RUN_DIR/scratch/tmp/roombai-dev"
ok "userData in $RUN_DIR/scratch/tmp/roombai-dev, HOME=$APP_HOME"

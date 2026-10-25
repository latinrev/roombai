#!/usr/bin/env bash
# Starts one isolated RoomBai instance under Xvfb and waits until doctor.sh passes.
# Usage: launch.sh [--real-home] [--demo] [extra electron args]
set -euo pipefail

SKILL=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(git -C "$SKILL" rev-parse --show-toplevel)
ROOT=/tmp/roombai-verify
RUN_ID=${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}
RUN_DIR=$ROOT/$RUN_ID

real_home=0
args=()
for a in "$@"; do
  case $a in
    --real-home) real_home=1 ;;
    *) args+=("$a") ;;
  esac
done

taken=$(ss -Hltnp 'sport = :47770' || true)
if [ -n "$taken" ]; then
  echo "REFUSE: port 47770 is already taken. A second RoomBai would run without its HTTP endpoint." >&2
  echo "$taken" >&2
  exit 2
fi
[ -x "$REPO/node_modules/electron/dist/electron" ] || { echo "Electron is missing. Run: npm ci (in $REPO)" >&2; exit 2; }
command -v xvfb-run >/dev/null || { echo "xvfb-run is missing" >&2; exit 2; }

[ -L "$ROOT" ] && { echo "$ROOT is a symlink. Refusing to write through it." >&2; exit 2; }
mkdir -p -m 700 "$ROOT"
mkdir -m 700 "$RUN_DIR" # fails when the run id already exists
mkdir -p "$RUN_DIR/evidence" "$RUN_DIR/scratch/home" "$RUN_DIR/scratch/tmp"

cdp_port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
app_home=$RUN_DIR/scratch/home
[ "$real_home" = 1 ] && app_home=$HOME

cd "$REPO"
env HOME="$app_home" TMPDIR="$RUN_DIR/scratch/tmp" \
  ROOM_SHOT="$RUN_DIR/evidence/autoquit.png" ROOM_SHOT_DELAY="${ROOM_SHOT_DELAY:-1800000}" \
  setsid xvfb-run -a -s "-screen 0 1920x1080x24" \
  node scripts/start.js --no-sandbox --remote-debugging-port="$cdp_port" ${args[@]+"${args[@]}"} \
  >"$RUN_DIR/app.log" 2>&1 </dev/null &
pid=$!

cat >"$RUN_DIR/run.env" <<EOF
RUN_ID=$RUN_ID
RUN_DIR=$RUN_DIR
EVIDENCE=$RUN_DIR/evidence
PID=$pid
CDP_PORT=$cdp_port
REPO=$REPO
COMMIT=$(git -C "$REPO" rev-parse HEAD)
APP_HOME=$app_home
EOF

for _ in $(seq 60); do
  if ! kill -0 "$pid" 2>/dev/null; then break; fi
  if "$SKILL/scripts/doctor.sh" "$RUN_DIR" >/dev/null 2>&1; then
    echo "READY run=$RUN_DIR pid=$pid cdp=$cdp_port"
    exit 0
  fi
  sleep 0.5
done

echo "Launch failed. Last doctor result and app log:" >&2
"$SKILL/scripts/doctor.sh" "$RUN_DIR" >&2 || true
tail -n 20 "$RUN_DIR/app.log" >&2
"$SKILL/scripts/stop.sh" "$RUN_DIR" >&2 || true
exit 1

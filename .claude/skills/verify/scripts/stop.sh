#!/usr/bin/env bash
# Stops the process group a verify run started and deletes its scratch dir. Evidence stays.
# Usage: stop.sh RUN_DIR
set -uo pipefail

RUN_DIR=${1:?usage: stop.sh RUN_DIR}
[ -f "$RUN_DIR/run.env" ] || { echo "no run.env in $RUN_DIR" >&2; exit 1; }
# shellcheck disable=SC1091
. "$RUN_DIR/run.env"
case $RUN_DIR in /tmp/roombai-verify/?*) ;; *) echo "refusing to clean $RUN_DIR" >&2; exit 1 ;; esac

if kill -0 -- "-$PID" 2>/dev/null; then
  kill -TERM -- "-$PID"
  for _ in $(seq 20); do kill -0 -- "-$PID" 2>/dev/null || break; sleep 0.25; done
  kill -0 -- "-$PID" 2>/dev/null && kill -KILL -- "-$PID"
fi
sleep 0.5
if kill -0 -- "-$PID" 2>/dev/null; then echo "FAIL: process group $PID is still alive" >&2; exit 1; fi
echo "stopped process group $PID"

owner=$(ss -Hltnp 'sport = :47770' | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)
[ -n "$owner" ] && echo "note: port 47770 is now owned by pid $owner, which this run did not start"

rm -rf -- "$RUN_DIR/scratch"
echo "removed $RUN_DIR/scratch"
echo "evidence kept:"
find "$RUN_DIR" -type f | sort

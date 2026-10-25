---
name: verify
description: Launch and drive the RoomBai Electron desktop app (the pixel-art room where roombas are coding agents) to prove a change works on the real app. Starts an isolated instance under Xvfb, feeds it agents through its local HTTP endpoint, drives the renderer over CDP and saves screenshots and snapshot JSON. Use after changing src/main.js, src/watcher.js or src/renderer/, before claiming a RoomBai UI or agent-status change works.
---

# Verify RoomBai

RoomBai is an Electron app. `src/main.js` owns the window, the tray and IPC. `src/watcher.js` turns agent transcripts and HTTP events into a list of agents. `src/renderer/game.js` draws that list as roombas in a 360x104 pixel-art room on a canvas. The user runs it on Windows. This skill drives it on Linux under Xvfb.

Helpers live in `.claude/skills/verify/scripts/`. Run them from the repo root. Each run gets its own folder `/tmp/roombai-verify/<run-id>/`.

Before driving a feature, read [features/README.md](features/README.md) and the feature file that matches.

## Launch

Install dependencies once per checkout with `npm ci`.

```sh
.claude/skills/verify/scripts/launch.sh            # empty room, no agents
.claude/skills/verify/scripts/launch.sh --demo     # six fake agents that change status every 9 s
```

It prints `READY run=/tmp/roombai-verify/<run-id> pid=<pid> cdp=<port>` once `doctor.sh` passes, usually within 5 s. Keep the run dir path. Every other helper takes it. Set `RUN_ID=<name>` to choose the folder name. Launch fails if that folder already exists.

What launch does:

- Refuses to start when anything already listens on port 47770. The watcher's HTTP port is fixed, and a second RoomBai silently runs without it.
- Starts `node scripts/start.js --no-sandbox --remote-debugging-port=<free port>` under `setsid xvfb-run -a` with a 1920x1080 screen, so the whole tree is one process group.
- Sets `ROOM_SHOT`, which moves userData to `$TMPDIR/roombai-dev` and turns off auto-update, usage tracking and the community counter. Launch points `TMPDIR` at `<run>/scratch/tmp`, so rooms, todos and window settings start empty and never touch the user's real files.
- Sets `HOME` to `<run>/scratch/home`, so the watcher finds no Claude or Codex transcripts and the room starts empty. Pass `--real-home` to let it tail the real `~/.claude/projects` and `~/.codex/sessions` instead. Real agents then appear and change on their own, so never use `--real-home` for a deterministic proof.
- Sets `ROOM_SHOT_DELAY` to 30 minutes by default. A forgotten instance saves `evidence/autoquit.png` and quits by itself then. Override with `ROOM_SHOT_DELAY=<ms>`.
- Writes `<run>/run.env` (PID, CDP port, repo, commit, HOME) and `<run>/app.log`. Renderer `console.log` lines appear in `app.log` as `[renderer] ...`.

## Doctor

```sh
.claude/skills/verify/scripts/doctor.sh /tmp/roombai-verify/<run-id>
```

Read-only. Run it first whenever anything looks off. Each line starts with `ok:` or `FAIL:`. It checks that the process group is alive, that port 47770 belongs to a process in this run, that `GET /` returns a JSON array, that the CDP page is this checkout's `src/renderer/index.html`, that the renderer is ready with the `package.json` version, and that userData is in the run's scratch dir. If it reports that 47770 belongs to another pid, stop. That instance is someone else's, possibly the user's own RoomBai.

## Drive

There are two ways in, and a proof usually uses both.

Agents come in over HTTP, the same path custom agents and hooks use in production. `POST /event` creates or updates an agent with id `custom:<id>`. `GET /` returns the watcher's snapshot.

```sh
curl -s -X POST http://127.0.0.1:47770/event -H 'content-type: application/json' \
  -d '{"id":"verify-working","title":"Verify working agent","project":"verify","status":"working","detail":"posted by verify","provider":"custom"}'
curl -s http://127.0.0.1:47770/ | jq '.[] | {id, status, title}'
```

`status` is one of `working`, `waiting`, `stuck`, `done` and `idle`. `provider` is `custom`, `claude` or `codex` and picks the roomba's color range.

The UI is driven over CDP with `cdp.mjs`. `click` and `tap` send real Chromium mouse events through `Input.dispatchMouseEvent`, so they run the app's own hit testing.

```sh
CDP="node .claude/skills/verify/scripts/cdp.mjs /tmp/roombai-verify/<run-id>"
$CDP eval '[...roombas.values()].map(r => [r.agent.id, r.agent.status, r.mode])'
$CDP tap '(r => ({ x: r.x, y: r.d - 3 }))(roombas.get("custom:verify-working"))'   # pin a roomba's card
$CDP tap '({ x: ROOF_BTNS.menu + 4, y: ROOF_Y + 5 })'                              # open the menu
$CDP click '#opt-size [data-v="2"]'                                               # a DOM button
$CDP shot /tmp/roombai-verify/<run-id>/evidence/room.png
```

Stable handles. The room is a canvas, so in-room targets are art-pixel positions read from named renderer state, never hard-coded numbers. `tap` converts art pixels to window pixels with the renderer's `scale`, `head` and `viewTop`.

- `roombas` is a Map from agent id to roomba. A roomba's body is at `x`, `d - 3`.
- `ROOF_BTNS.menu`, `ROOF_BTNS.roll` and `ROOF_BTNS.snooze` are the roof buttons at `y: ROOF_Y + 5`. `ACK_BTN_X` is "acknowledge all".
- `PLUS` is the whiteboard's add-todo button. `TRASH` and `BASKET` take tossed notes.
- `roomList`, `room.key` and `switchRoom(key)` are the rooms. `GARAGE` (`"garage"`) shows every agent.
- DOM panels have ids: `#tip` (roomba card: `#tip-status`, `#tip-title`, `#tip-ack`, `#tip-hide`), `#menu` (`#opt-ontop`, `#opt-sound`, `#opt-size`, `#opt-place`, `#opt-roll`, `#opt-changelog`), `#todo-pop` (`#todo-input`, `#todo-form`), `#tcard` (note card), `#rooms` (`.room-row`).

The older `test/*.js` files are renderer scripts for the `ROOM_SCRIPT` hook. Read them for more handles. Some of them call internal setters such as `syncAgents`, which skips the watcher. Do not count that as proof of a user path.

## Evidence

Save everything under `<run>/evidence/<feature>/`. Cleanup keeps it.

A proof has these parts:

- The input you sent, such as the `POST /event` bodies, saved as a file.
- The watcher's state after it, from `GET /`, saved as JSON.
- The renderer's state, from `$CDP eval`, saved as JSON.
- A screenshot from `$CDP shot` that shows the result. Open it and look. A file that exists proves nothing.
- For settings, todos and rooms, the file the app wrote in `<run>/scratch/tmp/roombai-dev/` (`window.json`, `todos.json`, `rooms.json`). Copy it into evidence before cleanup.

Proof standards:

- Feed agents through `POST /event` or a transcript file under the scratch HOME. Do not call `syncAgents` or set `agent.status` in the renderer.
- Click with `tap` or `click`. Calling `toggleMenu()` or a button's `.click()` skips hit testing. Use those only to reach a state that is not the subject of the proof, and say so.
- Capture the state before and after the action, not only the final screen.
- `$CDP shot` captures the whole transparent window, including 180 px of empty space above the room where cards open. `$CDP canvas` saves only the room canvas at 360x104.

## Cleanup

```sh
.claude/skills/verify/scripts/stop.sh /tmp/roombai-verify/<run-id>
```

It sends SIGTERM to the run's process group, then SIGKILL after 5 s, and confirms the group is gone. It deletes `<run>/scratch` (HOME, TMPDIR, userData) and lists what remains: `run.env`, `app.log` and `evidence/`. It never kills by process name. Run it after every failed attempt too. Delete an old run folder by hand only when its evidence is no longer needed.

## Helpers

| Script | Usage | What it does |
|---|---|---|
| `scripts/launch.sh` | `launch.sh [--real-home] [--demo] [electron args]` | Starts an isolated instance and prints `READY run=... pid=... cdp=...` |
| `scripts/doctor.sh` | `doctor.sh RUN_DIR` | Read-only health and ownership check |
| `scripts/cdp.mjs` | `cdp.mjs RUN_DIR eval\|shot\|canvas\|click\|tap ARG` | Evaluates JS, captures screenshots and sends real clicks |
| `scripts/stop.sh` | `stop.sh RUN_DIR` | Kills the run's process group and removes scratch, keeping evidence |
| `scripts/forward.py` | `setsid python3 forward.py LISTEN_PORT TARGET_PORT & echo $!` | Forwards a local port to a T3 server so killing it simulates an outage. See [remote T3 threads](features/remote-t3-threads.md) |

## Linux stand-in limits

This skill runs on Linux. The user runs Windows. These parts differ and stay unverified until a run on Windows covers them:

- `--no-sandbox` is required here because the npm Electron's `chrome-sandbox` is not setuid root. Windows runs with the sandbox.
- Xvfb has no compositor, taskbar or real cursor. Transparency, click-through (`setIgnoreMouseEvents`), always-on-top, the tray icon, notifications and dragging the window across monitors are not observable. CDP clicks bypass the OS, so they reach the page even where a real click would pass through to the desktop.
- Window placement uses the Xvfb work area (1920x1080, scale factor 1), not a Windows display with a taskbar and DPI scaling.
- "Jump to it" opens `t3code://`, `codex://` or `vscode://` links and writes the clipboard. Nothing handles those here.
- Room keys come from each agent's `cwd`. On Windows those are backslash paths with drive letters. `POST /event` cannot set `cwd`, so its agents land in `misc:<project>` rooms on every OS. To test Windows paths here, write a transcript with a Windows `cwd` under the scratch HOME (see [features/rooms-and-mess.md](features/rooms-and-mess.md)).

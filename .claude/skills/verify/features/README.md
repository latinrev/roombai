# RoomBai verification map

This directory is the maintained source for verifying what a RoomBai user sees. Read this index before driving the app, then use the matching feature file as the recipe. The harness is the `verify` skill in the parent directory: `launch.sh`, `doctor.sh`, `cdp.mjs` and `stop.sh`.

## Baseline preconditions

- Start the instance with `.claude/skills/verify/scripts/launch.sh` and keep the printed run dir. The examples below write it as `$RUN`.
- Define `CDP="node .claude/skills/verify/scripts/cdp.mjs $RUN"`.
- Run `.claude/skills/verify/scripts/doctor.sh $RUN` and require every line to start with `ok:`.
- The baseline room is the Garage with no agents, no todos and default settings (size M, bottom right). The scratch HOME and userData guarantee this.
- Never drive an instance this run did not start. If doctor reports that port 47770 belongs to another pid, stop.

## Driving conventions

- Feed agents through `POST http://127.0.0.1:47770/event` or a transcript file under `$RUN/scratch/home`. Those are production inputs.
- Click with `$CDP tap` (canvas targets, in art pixels from named renderer state) or `$CDP click` (DOM elements by id).
- Use `$CDP eval` to read state. Use it to change state only for setup that is not under test, and say so in the report.
- Wait for a state with a short poll on `$CDP eval` or `GET /`. New roombas beam in over about 2 s.
- Use ids prefixed `verify-` for posted agents so they are easy to tell apart.

## Proof and skip reporting

- Save artifacts under `$RUN/evidence/<feature-file-stem>/`.
- Capture the input, the watcher snapshot (`GET /`), the renderer state (`$CDP eval`) and a screenshot (`$CDP shot`). Open the screenshot and describe what it shows.
- For persisted state, copy the file from `$RUN/scratch/tmp/roombai-dev/` into evidence before `stop.sh` deletes it.
- Report an unreachable path with the command you ran and the precondition that was missing. Do not report a path as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then has four H2 sections in this order.

1. `Sub-features` lists short IDs with one line each.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with cdp.mjs and curl` starts with `Preconditions:` and pairs each user action with an exact command and an observable result.
4. `Gotchas` lists traps that waste or invalidate a run.

## Features

- [Agent statuses](./agent-statuses.md) covers agents arriving over HTTP, status colors and bubbles, the roomba card, acknowledging and shooing.
- [Rooms and mess](./rooms-and-mess.md) covers per-project rooms, the room list on the roof sign, and clutter that follows agent activity.
- [Whiteboard](./whiteboard.md) covers adding, completing and tossing todos, and the ISSUES and PRS faces.
- [Menu and settings](./menu-and-settings.md) covers the roof menu, size, placement, roll up and the changelog.
- [Remote T3 threads](./remote-t3-threads.md) is pending. It lands with `feat/remote-t3-threads`.

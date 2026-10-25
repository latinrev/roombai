# Rooms and mess

Each project gets its own generated room, and the Garage shows every agent. The roof sign names the current room and opens a list of rooms. Busy agents make the room messy with floor clutter and dirty furniture. Done and idle roombas clean it up.

## Sub-features

- `rooms-per-project` creates one room per project key, plus the Garage.
- `rooms-switch` changes rooms with the sign's arrows or the room list.
- `rooms-list` shows each room's agent count and status dots, with `!` when an agent needs the user.
- `mess-grow` adds clutter as agents work, wait or get stuck.
- `mess-clean` removes clutter as agents finish.
- `rooms-persist` remembers the selected room and each room's mess in `rooms.json`.

## How to get to it (user POV)

- Click the room name on the roof sign to open the room list, then click a row.
- Click the `<` or `>` arrows beside the sign to cycle rooms.
- Click a roomba's note on the whiteboard. If its agent belongs elsewhere, the room switches to it.
- Mess has no entry point. It follows agent activity.

## Driving it with cdp.mjs and curl

Preconditions:

- Baseline room from the index.
- `doctor.sh $RUN` passes.

- **Agents in two projects.** Post `{"id":"verify-a","title":"A","project":"alpha","status":"working"}` and `{"id":"verify-b","title":"B","project":"beta","status":"waiting"}` to `/event`. Run `$CDP eval 'roomList.map(e => [e.key, e.name, e.agents.length])'`. It lists `garage`, `misc:alpha` and `misc:beta`, each project with one agent.
- **Open the room list.** Run `$CDP tap '({ x: signGeom().x + 4, y: ROOF_Y + 5 })'`. Then `$CDP eval '[!$("rooms").hidden, [...document.querySelectorAll(".room-row .room-name")].map(n => n.textContent)]'` shows the list open with `Garage`, `alpha` and `beta`. Save `$CDP shot`.
- **Switch rooms.** Run `$CDP click '.room-row:nth-child(2)'`. `$CDP eval '[room.key, [...roombas.keys()]]'` shows the clicked room and only its agent. The sign shows the new name.
- **Cycle with arrows.** Run `$CDP tap '({ x: signGeom().rx + 3, y: ROOF_Y + 5 })'`. `room.key` moves to the next entry in `roomList`.
- **Mess grows.** In the Garage, record `$CDP eval '[messTarget, floorJunk()]'`. Post two more `working` agents. Within 3 s `messTarget` rises by 2 per working agent, 3 per waiting and 4 per stuck, and `floorJunk()` rises as clutter lands.
- **Mess cleans.** Post `"status":"done"` for every agent. `messTarget` drops, and over about 15 s `floorJunk()` falls as roombas collect clutter.
- **Persistence.** Copy `$RUN/scratch/tmp/roombai-dev/rooms.json` into evidence. Its `selected` field is the current room key.
- **Real project paths.** To get a room keyed by a folder instead of `misc:<project>`, write a Claude transcript under the scratch HOME. The watcher scans every 2.5 s.
  ```sh
  mkdir -p $RUN/scratch/home/.claude/projects/verify
  printf '%s\n' "{\"type\":\"user\",\"cwd\":\"/work/gamma\",\"timestamp\":\"$(date -u +%FT%TZ)\",\"message\":{\"role\":\"user\",\"content\":\"Verify gamma\"}}" \
    > $RUN/scratch/home/.claude/projects/verify/verify-gamma.jsonl
  ```
  `GET /` lists `claude:verify-gamma` as `working` with project `gamma`. `roomList` gains `/work/gamma`. A `cwd` like `C:\\work\\gamma` gives the key `c:/work/gamma`, which is how Windows paths look.

## Gotchas

- `POST /event` has no `cwd` field. Its agents always land in `misc:<project>` rooms.
- A `cwd` containing `/worktrees/<name>` maps to the key `worktree:<name>`, not the parent repo.
- The room list sorts by busyness, so row order changes as statuses change. Click rows by name, not position, when more than one project is busy.
- Mess targets cap at 26 items, and new clutter lands at 350 ms intervals. Poll, do not sleep a fixed time.
- `test/mess.js` drives mess by calling `syncAgents` with edited agents. That skips the watcher. Do not use it as proof.

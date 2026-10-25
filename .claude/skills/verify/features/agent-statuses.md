# Agent statuses

Every coding agent RoomBai knows about is a roomba in the room. Its eye color, speech bubble and whiteboard note show whether it is working, needs the user, is stuck or is done. Clicking a roomba pins a card with its status, title and buttons to acknowledge or shoo it.

## Sub-features

- `status-arrive` makes an agent posted to `/event` appear as a roomba and in `GET /`.
- `status-render` shows each status with its own eye color, bubble and note color.
- `status-card` pins a card with the status chip, provider, project and title.
- `status-ack` turns a done agent idle with the card's `Got it` button.
- `status-shoo` sends a roomba to the recharge station and removes it from `GET /`.

## How to get to it (user POV)

- A Claude Code or Codex session on the machine starts or changes state. The watcher reads its transcript.
- A script or hook posts to `http://127.0.0.1:47770/event`.
- The user clicks a roomba to pin its card, then clicks `Got it` or `Shoo`.
- The user double-clicks a done roomba, or clicks the roof's acknowledge-all button, to acknowledge it.

## Driving it with cdp.mjs and curl

Preconditions:

- Baseline room from the index: Garage, no agents.
- `doctor.sh $RUN` passes.

- **Post three working agents.** New roombas beam in at the same spot by the recharge station, and waiting or done roombas never drive away. So post all three as `working` first, then let them spread out.
  ```sh
  E=$RUN/evidence/agent-statuses; mkdir -p $E
  post() { curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:47770/event -H 'content-type: application/json' -d "$1"; }
  for s in working waiting done; do
    echo "{\"id\":\"verify-$s\",\"title\":\"Verify $s agent\",\"project\":\"verify\",\"status\":\"working\",\"detail\":\"posted by verify\",\"provider\":\"custom\"}"
  done > $E/events-1-working.jsonl
  while read -r body; do post "$body"; done < $E/events-1-working.jsonl
  ```
  Each POST prints `204`.
- **Wait until they spread.** Poll `$CDP eval '(xs => xs.length === 3 && xs.every((x, i) => xs.every((y, j) => i === j || Math.abs(x - y) > 14)))([...roombas.values()].filter(r => r.mode === "floor").map(r => r.x))'` once a second until it prints `true`. This usually takes 3 to 10 s.
- **Set the final statuses.**
  ```sh
  for s in waiting done; do echo "{\"id\":\"verify-$s\",\"status\":\"$s\"}"; done > $E/events-2-status.jsonl
  while read -r body; do post "$body"; done < $E/events-2-status.jsonl
  ```
- **Read the watcher.** Run `curl -s http://127.0.0.1:47770/ | tee $RUN/evidence/agent-statuses/snapshot.json | jq -c '.[] | {id, status, title}'`. It lists `custom:verify-done` as `done`, `custom:verify-waiting` as `waiting` and `custom:verify-working` as `working`, sorted by id.
- **Read the renderer.** Wait 1 s, then run `$CDP eval '[...roombas.values()].map(r => ({ id: r.agent.id, status: r.agent.status, mode: r.mode, x: Math.round(r.x) }))' | tee $RUN/evidence/agent-statuses/roombas.json`. Three roombas have mode `floor`. The roof counter next to the roomba icon reads `3`.
- **Screenshot the room.** Run `$CDP shot $RUN/evidence/agent-statuses/room.png`. The room shows the three roombas. The working one has a `...` bubble. The waiting one says `NEED YOU` at first. The done one has a green check bubble. The whiteboard's TODO face shows one note per agent, colored by status.
- **Pin each card.** For each id, run `$CDP tap '(r => ({ x: r.x, y: r.d - 3 }))(roombas.get("custom:verify-waiting"))'`, then `$CDP eval '[!tipEl.hidden, $("tip-status").textContent, $("tip-title").textContent]'` and `$CDP shot $RUN/evidence/agent-statuses/card-waiting.png`. The chip reads `working`, `needs you` or `done`, and the title matches the posted one. Tap the same roomba again to unpin.
- **Acknowledge.** Pin `custom:verify-done`, then run `$CDP click '#tip-ack'`. The roomba says `THANKS!`, and within 2 s `GET /` reports `custom:verify-done` as `idle`.
- **Shoo.** Pin `custom:verify-working`, then run `$CDP click '#tip-hide'`. The roomba says `BYE!` and drives into the recharge station. After it arrives, `GET /` no longer lists `custom:verify-working` and the roof counter drops by one.

## Gotchas

- New roombas beam in at `STATION.x + STATION.w / 2` (art x 336). A `waiting` roomba stands still and a `done` roomba spins in place, so agents posted straight into those states stack there for good. A tap then hits whichever is drawn on top. Post them as `working` first, as above.
- The waiting roomba's `NEED YOU` sign blinks. One screenshot may catch it off.
- `GET /` drops an `idle` agent 90 minutes after its last event, and a `done` agent turns `idle` after 30 minutes. Long runs lose agents for that reason, not a bug.
- `stuck` from a transcript needs 6 minutes of silence. Post `"status":"stuck"` to test the look without waiting.
- `--real-home` adds the machine's real agents, which change on their own. Use the scratch HOME for proofs.
- `#tip-ack` is hidden unless the agent is `done`. `click` fails with `no visible element matches #tip-ack` otherwise.

# Remote T3 threads

Pending. This lands with `feat/remote-t3-threads`. Nothing here is verified yet, and none of it works on a checkout without that branch. When it lands, check every handle below against the merged code and remove this paragraph.

RoomBai can watch T3 Code servers on other machines. Each remote thread becomes a roomba, and its card names the machine it runs on.

## Sub-features

- `t3-config` reads the server list from the file named by `ROOMBAI_T3_SERVERS`.
- `t3-threads` turns each remote thread into an agent with a `t3:` id and a `machine` field.
- `t3-status` maps the thread's state to a roomba status.

## How to get to it (user POV)

- The user writes a JSON config with each server's URL and token and starts RoomBai with `ROOMBAI_T3_SERVERS=<config.json>`.
- Remote threads then appear in the room beside local agents.

## Driving it with cdp.mjs and curl

Preconditions:

- The checkout includes `feat/remote-t3-threads`.
- A reachable T3 server and a token for it. The config holds a secret, so keep it in a private temp dir, never in the repo or in evidence.
- `launch.sh` passes the variable through, since it uses `env` and keeps the caller's environment.

- **Configure.** Run `CFG=$(mktemp -d)/t3-servers.json` and write the server URL and token there in the shape the branch defines. Launch with `ROOMBAI_T3_SERVERS=$CFG .claude/skills/verify/scripts/launch.sh`. Delete `$CFG` after `stop.sh`.
- **Read the snapshot.** Run `curl -s http://127.0.0.1:47770/ | jq '.[] | select(.id | startswith("t3:")) | {id, status, title, machine}'`. Each remote thread appears with its `machine`.
- **See it in the room.** Pin a `t3:` roomba with `$CDP tap` and check that the card names the machine. Save `$CDP shot`.

## Gotchas

- Never copy the config or the token into evidence or logs.
- The scratch HOME hides local transcripts, not remote servers. Remote threads change on their own, so a proof should name the thread it watched.

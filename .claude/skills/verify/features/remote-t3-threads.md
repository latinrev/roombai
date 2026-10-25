# Remote T3 threads

RoomBai polls T3 Code servers on other machines. Each top-level remote thread becomes a roomba, and its card names the machine it runs on. Polling is `src/t3remote.js`, tailnet discovery is `src/t3discover.js` and pairing is `src/t3pair.js`.

## Sub-features

- `t3-config` reads the server list from `t3-servers.json` in userData, or from the file named by `ROOMBAI_T3_SERVERS` in dev runs. A plaintext `token` is rewritten as `tokenEnc` with mode 0600.
- `t3-threads` turns each remote thread into an agent with a `t3:<environmentId>:<threadId>` id and a `machine` field. Subagent threads, archived threads and threads idle for more than 12 h stay out.
- `t3-status` copies T3's own `projectThreadAwarenessV2` rules into a roomba status.
- `t3-outage` removes a server's roombas after 30 s without a good poll. Ack and hide survive the outage.
- `t3-problems` lists each bad config entry as a disabled tray line. Invalid JSON keeps the previous servers polling.
- `t3-discover` finds T3 servers on the user's own online Tailscale peers at startup, every 5 minutes, and on Paste or Connect. Each compatible one not in the config gets a `Connect <label>...` tray line. A discovery problem shows as `Finding T3 servers: <reason>`.
- `t3-pair` turns a pasted pairing link into an `orchestration:read` entry with `tokenEnc` and `expiresAt`.
- `t3-expiry` adds `(key expires in N d)` to the status line, and a `Reconnect <label>...` line from 3 days before expiry or on a 401.

## How to get to it (user POV)

- On the T3 host, run `t3 auth session issue --scope orchestration:read --ttl 30d --label roombai --token-only`.
- In RoomBai, open the tray item "Remote T3 servers…", paste the server URL and token, and save.
- Remote threads appear in the room within 10 s. The tray shows one `<machine>: ok` line per server.

## Driving it with cdp.mjs and curl

### Tray lines and pairing

- Launch with `ROOMBAI_T3_SERVERS=$D/t3-servers.json` (a missing file is fine) and an extra `--inspect=<port>` argument.
- Over the inspector, set a conditional breakpoint on the first line inside `trayMenu` in `src/main.js`. The condition runs in that frame, so `(console.log('TRAY ' + JSON.stringify(t3Lines().map((l) => l.label))), false)` prints the T3 lines to `app.log` without pausing. Trigger a rebuild from the renderer with `$CDP eval "bridge.setOption('muted', false)"`. The breakpoint lasts only while the inspector session stays open.
- To pair, make a 5-minute link on the T3 host with `t3 auth pairing create --ttl 5m --base-url <url> --json`, and write its `pairUrl` to a 0600 file without printing it. Use a one-shot condition that calls `clipboard.writeText(fs.readFileSync(<file>, 'utf8'))`, then `pastePairingLink()`, then `clipboard.clear()`. The tray then reads `<label>: ok (key expires in 30 d)` and the config holds `url`, `expiresAt` and `tokenEnc`.
- Revoke the new session on the host with `t3 auth session revoke <id>`. Within one poll the tray reads `unauthorized` with a `Reconnect <label>...` line.

### Polling

Preconditions:

- A reachable T3 server and an `orchestration:read` token. joel-linux keeps one at `~/.local/share/agent-fleet/roombai/joel-linux.token`.
- The config holds a secret. Keep it in a private 0600 file in a `mktemp -d` folder, never in the repo or in evidence, and delete it after `stop.sh`.

Steps:

- **Configure.** Write `[{"url":"https://joel-linux.tail0784c2.ts.net","token":"<token>"}]` to `$CFG` with mode 0600. Launch with `ROOMBAI_T3_SERVERS=$CFG .claude/skills/verify/scripts/launch.sh`.
- **Read the snapshot.** After about 15 s, run `curl -s http://127.0.0.1:47770/ | jq '[.[] | select(.id | startswith("t3:"))] | group_by(.status) | map({status: .[0].status, n: length})'`. Every `t3:` agent has `machine` set to the server's label.
- **Check the rewrite.** `$CFG` now holds `tokenEnc` and no `token`, with mode 600.
- **See it in the room.** Pin a `t3:` roomba with `$CDP tap` and check that `#tip-meta` reads `<Provider> · on <machine> · <project>`. Save `$CDP shot`.
- **Outage.** Point the config at `http://127.0.0.1:<LISTEN_PORT>` and run `forward.py LISTEN_PORT 3773` on the T3 host. Ack a done roomba with `#tip-ack` and hide one with `#tip-hide`. Kill the forwarder by its PID. Sample `GET /` every 5 s. The `t3:` agents leave within about 30 s, and no sample adds a `stuck`. Restart the forwarder. The agents return, the acked one is idle and the hidden one stays hidden.
- **Bad config.** Overwrite `$CFG` with invalid JSON. The `t3:` agents stay, because polling continues with the previous servers.

## Gotchas

- Never copy the config or the token into evidence or logs. Scan the run folder for the token before you finish.
- Xvfb has no tray, so the tray lines can't be seen. To read them, start the app with `--inspect=<port>` and set a non-pausing logpoint on the `trayMenu` line in `src/main.js` that logs `t3servers.status()` and `t3servers.problems()`. The line number moves with edits, so look it up first.
- On joel-linux, `safeStorage` reaches the real GNOME keyring through the D-Bus session even with a scratch HOME. Windows uses DPAPI, which this stand-in never runs.
- Remote threads change on their own. A proof names the thread ids it watched, never their titles.
- Pointing RoomBai at the machine it runs on shows those threads twice, once from local transcripts and once from T3.

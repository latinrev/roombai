# Whiteboard

The whiteboard on the left wall has three faces. TODO holds the user's own sticky notes plus one note per active agent. ISSUES and PRS list GitHub issues and pull requests for the projects in the room. The user adds todos with the `+` button, completes them from a note card, and tosses them by dragging into the trash.

## Sub-features

- `todo-add` adds a note from the `+` popup.
- `todo-card` pins a note card with `Done` and `Toss` buttons.
- `todo-done` completes a todo with confetti and `TODO DONE!`.
- `todo-toss` deletes a todo dragged into the trash or basket.
- `todo-persist` saves todos to `todos.json`.
- `board-spin` turns the board to ISSUES and PRS through the crank or the face title.

## How to get to it (user POV)

- Click the `+` in the board's top-right corner, type, and press Enter.
- Click a note to pin its card. Click `Done` (`#tcard-done`) or `Toss` (`#tcard-del`).
- Drag a note onto the trash can or the basket.
- Click the board's title or its crank to spin to the next face.

## Driving it with cdp.mjs and curl

Preconditions:

- Baseline room from the index, so the TODO face has no notes.
- `doctor.sh $RUN` passes.

- **Open the popup.** Run `$CDP tap '({ x: PLUS.x + 3, y: PLUS.y + 3 })'`. `$CDP eval '!todoPopEl.hidden'` is `true` and `#todo-input` has focus.
- **Add a todo.** Run `$CDP eval '$("todo-input").value = "verify release notes"'`, then `$CDP click '#todo-form button'` (the `Pin it` button). `$CDP eval 'todos.map(t => t.text)'` contains `verify release notes`, and the board shows a new note.
- **Pin the card.** Run `$CDP tap '(n => ({ x: n.x + 4, y: n.y + 3 }))(noteLayout().find(n => n.todo && n.todo.text === "verify release notes"))'`. `#tcard` is visible and `#tcard-text` reads the todo.
- **Complete it.** Run `$CDP click '#tcard-done'`. The todo has `done: true`, and the note leaves the board after 2.5 s.
- **Persistence.** Copy `$RUN/scratch/tmp/roombai-dev/todos.json` into evidence. It contains the todo with its `done` flag.
- **Spin the board.** Run `$CDP tap '({ x: BOARD.x + 10, y: BOARD.y + 4 })'`. After 1 s `FACES[boardFace]` is `ISSUES`. `ghFor()` reports the GitHub state for the room.

## Gotchas

- Setting `#todo-input` through `eval` skips typing. Say so in the report, or add a `type` command to `cdp.mjs` that sends `Input.insertText`.
- Dragging a note to the trash needs a press, several moves and a release. `cdp.mjs` has no drag command yet. `test/todos.js` shows the path with synthetic events, which skip Chromium input.
- ISSUES and PRS run the `gh` CLI with the app's HOME. Under the scratch HOME `gh` is logged out, so the faces show the logged-out state. Use `--real-home` only when the proof is about GitHub data, and report that real agents were present.
- Agent notes on the TODO face come from posted agents. Post none when counting todo notes.

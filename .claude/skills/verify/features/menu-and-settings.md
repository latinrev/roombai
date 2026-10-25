# Menu and settings

The menu button on the right of the roof opens a panel with the app version, the changelog, always-on-top, sounds and notifications, size, placement, roll up, hide, quit and update checks. Settings persist between runs in `window.json`.

## Sub-features

- `menu-open` opens and closes the panel from the roof button.
- `menu-size` resizes the room to S, M or L.
- `menu-place` snaps the room to bottom left, center or right, or leaves it free.
- `menu-toggles` flips always-on-top and sounds.
- `menu-roll` rolls the room up to its roof strip and back.
- `menu-changelog` opens the changelog card beside the menu.
- `menu-persist` writes settings to `window.json`.

## How to get to it (user POV)

- Click the three-line button at the right end of the roof.
- Use the tray icon's menu for the same options. The tray is not observable under Xvfb.

## Driving it with cdp.mjs and curl

Preconditions:

- Baseline settings from the index: size M, anchor `right`.
- `doctor.sh $RUN` passes.

- **Open the menu.** Run `$CDP tap '({ x: ROOF_BTNS.menu + 4, y: ROOF_Y + 5 })'`. `$CDP eval '!menuEl.hidden'` is `true` and `#app-version` shows the `package.json` version.
- **Resize.** Run `$CDP click '#opt-size [data-v="2"]'`. Within 1 s `$CDP eval 'appCfg.size'` is `2`, the window shrinks to 720 px wide, and `window.json` has `"scale":2`.
- **Place.** Run `$CDP click '#opt-place [data-v="left"]'`. `appCfg.anchor` is `left`.
- **Roll up.** Run `$CDP click '#opt-roll'`. `appCfg.collapsed` is `true` and the window is the roof strip. Reopen the menu and click `#opt-roll` again to restore.
- **Changelog.** Run `$CDP click '#opt-changelog'`. `#changelog` is visible and `#changelog-notes` lists recent versions. `#changelog-close` closes it.
- **Persistence.** Copy `$RUN/scratch/tmp/roombai-dev/window.json` into evidence. It holds `pos.anchor` and `settings`.

## Gotchas

- `#opt-quit` quits the app and ends the run. `#opt-hide` hides the window, and only the tray brings it back, which Xvfb cannot show. Leave both for last.
- Always-on-top, placement against a taskbar and DPI scaling need the real Windows desktop.
- Clicking outside the panel closes it. A `tap` on the room after opening the menu closes the menu first.
- When an update is available the menu button moves above the roof. ROOM_SHOT turns updates off, so this skill never sees that state.

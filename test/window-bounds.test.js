const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Run the real main-process geometry and setting handlers without opening a
// desktop window, starting watchers, or touching the user's saved settings.
function desktop(scaleFactor = 1) {
  const display = { id: 1, scaleFactor, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const electron = {
    app: { getPath: () => '/unused', requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {} },
    screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display },
  };
  const context = vm.createContext({
    require(name) {
      if (name === 'electron') return electron;
      if (name === 'fs') return { writeFile() {} };
      if (name === 'path') return path;
      if (name === './watcher' || name === './github') return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
    process: { env: {} },
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  vm.runInContext(source + `
    let actual;
    win = { isDestroyed: () => false, getBounds: () => actual,
      setBounds: (b) => { actual = b; }, webContents: { send() {} } };
    globalThis.fixture = {
      place(anchor, x, y) { pos = { anchor, x, y, displayId: 1 }; actual = bounds(); },
      collapse(value) { setOption('collapsed', value); },
      resize(value) { setOption('scale', value); },
      free() { setOption('anchor', 'free'); },
      rect() { return { ...actual }; }
    };
  `, context);
  return context.fixture;
}

for (const scaleFactor of [1, 1.25, 1.5, 2]) {
  for (const anchor of ['left', 'center', 'right', 'free']) {
    test(`collapse stays at the bottom and restores: ${anchor}, display scale ${scaleFactor}`, () => {
      const room = desktop(scaleFactor);
      room.place(anchor, anchor === 'free' ? 140 : null, anchor === 'free' ? 300 : null);
      const expanded = room.rect();
      for (let cycle = 0; cycle < 3; cycle++) {
        room.collapse(true);
        const collapsed = room.rect();
        assert.ok(collapsed.y > expanded.y, 'first and subsequent collapses move down');
        assert.equal(collapsed.y + collapsed.height, expanded.y + expanded.height);
        assert.equal(collapsed.x, expanded.x);
        room.collapse(false);
        assert.deepEqual(room.rect(), expanded);
      }
    });
  }
}

test('switching to free placement while collapsed preserves the expanded position', () => {
  const room = desktop();
  room.place('right', null, null);
  const expanded = room.rect();
  room.collapse(true);
  const collapsed = room.rect();
  room.free();
  assert.deepEqual(room.rect(), collapsed);
  room.collapse(false);
  assert.deepEqual(room.rect(), expanded);
});

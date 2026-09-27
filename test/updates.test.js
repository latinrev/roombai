const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../src/updates');

function setup(options = {}) {
  const updater = new EventEmitter();
  const messages = [];
  const opened = [];
  const scheduled = [];
  const responses = [];
  let checks = 0;
  let installs = 0;
  let lookups = 0;
  updater.quitAndInstall = () => installs++;
  updater.checkForUpdates = async () => { checks++; return { updateInfo: { version: '0.1.1' } }; };
  const updates = createUpdates({
    app: { isPackaged: true, getVersion: () => '0.1.1' },
    platform: 'win32', env: {}, getUpdater: () => updater,
    dialog: { showMessageBox: async (message) => { messages.push(message); return { response: responses.shift() ?? 1 }; } },
    shell: { openExternal: async (url) => opened.push(url) },
    fetchRelease: async () => { lookups++; return { ok: true, json: async () => ({ tag_name: 'v0.1.2' }) }; },
    timers: { setTimeout: (fn, delay) => { scheduled.push({ fn, delay }); return 1; },
      setInterval: (fn, delay) => { scheduled.push({ fn, delay }); return 2; }, clearTimeout() {}, clearInterval() {} },
    ...options,
  });
  return { updates, updater, messages, opened, scheduled, responses,
    counts: () => ({ checks, installs, lookups }) };
}

test('development and demo builds never check or schedule updates', async () => {
  for (const options of [{ app: { isPackaged: false } }, { disabled: true }]) {
    const f = setup(options);
    f.updates.start();
    await f.updates.check(true);
    assert.equal(f.scheduled.length, 0);
    assert.deepEqual(f.counts(), { checks: 0, installs: 0, lookups: 0 });
    assert.equal(f.updates.menuItem().enabled, false);
  }
});

test('installed builds check after startup and every six hours, only once scheduled', () => {
  const f = setup();
  f.updates.start(); f.updates.start();
  assert.deepEqual(f.scheduled.map(s => s.delay), [15000, 21600000]);
});

test('Windows installer downloads automatically but never installs on normal quit', async () => {
  const f = setup();
  await f.updates.check();
  assert.equal(f.updater.autoDownload, true);
  assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false);
  assert.equal(f.updater.allowDowngrade, false);
  assert.equal(f.messages.length, 0);
});

test('Later leaves the update ready; only an explicit restart installs it', async () => {
  const f = setup();
  await f.updates.check();
  f.updater.emit('update-downloaded', { version: '0.1.2' });
  await new Promise(setImmediate);
  assert.equal(f.counts().installs, 0);
  assert.match(f.updates.menuItem().label, /Restart to install 0.1.2/);
  f.responses.push(0);
  await f.updates.check(true);
  assert.equal(f.counts().installs, 1);
});

test('manual checks report up to date', async () => {
  const f = setup();
  await f.updates.check(true);
  assert.match(f.messages[0].message, /up to date/);
});

test('download failures are quiet in the background and actionable on manual checks', async () => {
  const f = setup();
  f.updater.checkForUpdates = async () => {
    f.updater.emit('error', new Error('offline'));
    throw new Error('offline');
  };
  await f.updates.check();
  assert.equal(f.messages.length, 0);
  await f.updates.check(true);
  assert.match(f.messages[0].message, /Could not check/);
  assert.equal(f.updates.menuItem().enabled, true);
});

test('concurrent checks cannot start a second download', async () => {
  const f = setup();
  let finish;
  let calls = 0;
  f.updater.checkForUpdates = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = f.updates.check();
  await f.updates.check();
  assert.equal(calls, 1);
  assert.equal(f.updates.menuItem().enabled, false);
  finish({ updateInfo: { version: '0.1.1' } });
  await pending;
});

for (const options of [{ platform: 'darwin' }, { platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: '/portable' } }, { platform: 'linux' }]) {
  test(`manual download fallback: ${JSON.stringify(options)}`, async () => {
    const f = setup(options);
    await f.updates.check();
    await f.updates.check();
    assert.equal(f.messages.length, 1, 'only notify once per new version');
    assert.equal(f.counts().checks, 0);
    assert.equal(f.counts().installs, 0);
    f.responses.push(0);
    await f.updates.check(true);
    assert.deepEqual(f.opened, ['https://github.com/latinrev/roombai/releases/latest']);
  });
}

test('Linux AppImage uses the automatic updater', async () => {
  const f = setup({ platform: 'linux', env: { APPIMAGE: '/app/Roombai.AppImage' } });
  await f.updates.check();
  assert.equal(f.counts().checks, 1);
  assert.equal(f.counts().lookups, 0);
});

test('manual fallback ignores drafts, prereleases and older versions', async () => {
  for (const release of [{ tag_name: 'v0.1.0' }, { tag_name: 'v0.1.2', draft: true }, { tag_name: 'v0.1.2-beta.1', prerelease: true }]) {
    const f = setup({ platform: 'darwin', fetchRelease: async () => ({ ok: true, json: async () => release }) });
    await f.updates.check();
    assert.equal(f.messages.length, 0);
  }
});

test('shutdown prevents future checks and update prompts', async () => {
  const f = setup();
  f.updates.start();
  f.updates.dispose();
  await f.updates.check(true);
  assert.equal(f.counts().checks, 0);
});

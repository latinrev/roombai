const { app, BrowserWindow, ipcMain, screen, Tray, Menu, Notification, nativeImage, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { Watcher, PORT } = require('./watcher');
const github = require('./github');

const SCALE_DEFAULT = 3;
const ROOM_W = 360; // internal pixel-art resolution
const ROOM_H = 104;

let win;
let tray;
let watcher;
let updates;
// room settings, changeable from the in-game menu or the tray, remembered between runs
const settings = { scale: SCALE_DEFAULT, muted: false, onTop: true, collapsed: false };
const COLLAPSED_H = 12;
// Where the room lives: snapped to the bottom of a screen (left / center / right),
// or 'free' once you drag it somewhere yourself. Remembered between runs.
let pos = { anchor: 'right', x: null, y: null, displayId: null };
const posFile = () => path.join(app.getPath('userData'), 'window.json');
function loadPos() {
  try {
    const saved = JSON.parse(fs.readFileSync(posFile(), 'utf8'));
    pos = { ...pos, ...saved.pos || saved };
    Object.assign(settings, saved.settings || {});
  } catch {}
}
function savePos() { fs.writeFile(posFile(), JSON.stringify({ pos, settings }), () => {}); }
function config() { return { version: app.getVersion(), update: updates?.status(), scale: cssScale(), muted: settings.muted, onTop: settings.onTop, collapsed: settings.collapsed, anchor: pos.anchor, size: settings.scale }; }
function sendConfig() { if (win && !win.isDestroyed()) win.webContents.send('config', config()); }
const lastStatus = new Map();

// Dev runs (screenshots, scripted tests) keep their state away from your real rooms and todos.
if (process.env.ROOM_SHOT) app.setPath('userData', path.join(require('os').tmpdir(), 'roombai-dev'));

if (!app.requestSingleInstanceLock()) app.quit();

// The app used to be called "Roomba Room": bring its saved rooms, todos and window spot along once.
function migrateOldData() {
  const dir = app.getPath('userData');
  const old = path.join(app.getPath('appData'), 'roomba-room');
  if (process.env.ROOM_SHOT || !fs.existsSync(old)) return;
  for (const f of ['rooms.json', 'todos.json', 'window.json']) {
    const from = path.join(old, f); const to = path.join(dir, f);
    try { if (fs.existsSync(from) && !fs.existsSync(to)) { fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(from, to); } } catch {}
  }
}

function roomDisplay() {
  return screen.getAllDisplays().find((d) => d.id === pos.displayId) || screen.getPrimaryDisplay();
}

// Snap the scale so every art pixel maps to a whole number of physical pixels
// on whichever screen the room is on.
function cssScale(display = roomDisplay()) {
  const sf = display.scaleFactor || 1;
  return Math.max(1, Math.round(settings.scale * sf)) / sf;
}

// window size on a display; rolled up, the window is just the roof strip
function sizeOn(display) {
  const s = cssScale(display);
  const expandedH = Math.round(ROOM_H * s);
  const h = settings.collapsed ? Math.round(COLLAPSED_H * s) : expandedH;
  // pos.y always stores the expanded top. Keep the bottom edge fixed when
  // collapsing, including after dragging or restoring a freely placed room.
  return { w: Math.round(ROOM_W * s), h, offY: expandedH - h };
}

function bounds() {
  const wa = roomDisplay().workArea;
  const { w, h, offY } = sizeOn(roomDisplay());
  const clampX = (x) => Math.max(wa.x, Math.min(wa.x + wa.width - w, x));
  const clampY = (y) => Math.max(wa.y, Math.min(wa.y + wa.height - h, y));
  if (pos.anchor === 'free' && pos.x !== null) return { x: clampX(pos.x), y: clampY(pos.y + offY), width: w, height: h };
  const xByAnchor = { left: wa.x + 12, center: wa.x + Math.round((wa.width - w) / 2), right: wa.x + wa.width - w - 12 };
  return { x: xByAnchor[pos.anchor] ?? xByAnchor.right, y: wa.y + wa.height - h, width: w, height: h };
}

function createWindow() {
  win = new BrowserWindow({
    ...bounds(),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(settings.onTop, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', sendConfig);
  // Windows sometimes drops "always on top" after the taskbar gets focus.
  setInterval(() => win && !win.isDestroyed() && settings.onTop && win.setAlwaysOnTop(true, 'screen-saver'), 5000);
}

function notify(agent, status) {
  if (settings.muted || !Notification.isSupported()) return;
  const who = `${agent.provider}${agent.project ? ' · ' + agent.project : ''}`;
  const text = {
    done: ['✅ Roomba finished!', agent.title],
    stuck: ['🚨 Roomba is stuck!', `${agent.title} — ${agent.detail || 'no activity for a while'}`],
    waiting: ['✋ Roomba needs you', `${agent.title} is waiting for approval or input`],
  }[status];
  if (!text) return;
  const n = new Notification({ title: text[0], body: `${text[1]}\n${who}`, silent: true });
  n.on('click', () => win && win.webContents.send('focus-agent', agent.id));
  n.show();
}

function onAgents(list) {
  for (const a of list) {
    const prev = lastStatus.get(a.id);
    if (prev && prev !== a.status) notify(a, a.status);
    lastStatus.set(a.id, a.status);
  }
  if (win && !win.isDestroyed()) win.webContents.send('agents', list);
  if (tray) {
    const open = list.filter((a) => a.status !== 'idle' && a.status !== 'done').length;
    const bad = list.filter((a) => a.status === 'stuck' || a.status === 'waiting').length;
    tray.setToolTip(`Roombai — ${open} task(s) on the board${bad ? `, ${bad} need attention` : ''}`);
  }
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Show / hide room', click: () => setOption('hidden', win.isVisible()) },
    { label: settings.collapsed ? 'Unroll the room' : 'Roll up the room', click: () => setOption('collapsed', !settings.collapsed) },
    { label: 'Always on top', type: 'checkbox', checked: settings.onTop, click: (i) => setOption('onTop', i.checked) },
    { type: 'separator' },
    { label: 'Wherever I drag it', type: 'radio', checked: pos.anchor === 'free', click: () => setOption('anchor', 'free') },
    { label: 'Snap to bottom left', type: 'radio', checked: pos.anchor === 'left', click: () => setOption('anchor', 'left') },
    { label: 'Snap to bottom center', type: 'radio', checked: pos.anchor === 'center', click: () => setOption('anchor', 'center') },
    { label: 'Snap to bottom right', type: 'radio', checked: pos.anchor === 'right', click: () => setOption('anchor', 'right') },
    { type: 'separator' },
    { label: 'Size: small (2x)', type: 'radio', checked: settings.scale === 2, click: () => setOption('scale', 2) },
    { label: 'Size: normal (3x)', type: 'radio', checked: settings.scale === 3, click: () => setOption('scale', 3) },
    { label: 'Size: big (4x)', type: 'radio', checked: settings.scale === 4, click: () => setOption('scale', 4) },
    { type: 'separator' },
    { label: 'Mute alerts', type: 'checkbox', checked: settings.muted, click: (i) => setOption('muted', i.checked) },
    { label: `Event endpoint: http://127.0.0.1:${PORT}/event`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setContextMenu(trayMenu());
  tray.on('click', () => setOption('hidden', win.isVisible()));
}

// every setting goes through here, from the in-game menu and the tray alike
function setOption(key, value) {
  if (key === 'update') { if (updates) void updates.install(); return; }
  if (key === 'check-update') { if (updates) void updates.check(true); return; }
  if (key === 'anchor') {
    if (value === 'free' && pos.x === null) { const b = win.getBounds(); pos.x = b.x; pos.y = b.y - sizeOn(roomDisplay()).offY; }
    pos.anchor = value;
  } else if (key === 'scale') {
    settings.scale = value;
  } else if (key === 'muted') {
    settings.muted = Boolean(value);
  } else if (key === 'onTop') {
    settings.onTop = Boolean(value);
    win.setAlwaysOnTop(settings.onTop, 'screen-saver');
  } else if (key === 'collapsed') {
    settings.collapsed = Boolean(value);
  } else if (key === 'hidden') {
    if (value) win.hide(); else win.showInactive();
  } else if (key === 'quit') {
    app.quit();
    return;
  }
  win.setBounds(bounds());
  savePos();
  sendConfig();
  if (tray) tray.setContextMenu(trayMenu());
}

app.whenReady().then(() => {
  migrateOldData();
  loadPos();
  createWindow();
  updates = require('./updates').createUpdates({
    app, shell,
    getUpdater: () => require('electron-updater').autoUpdater,
    disabled: Boolean(process.env.ROOM_SHOT) || process.argv.includes('--demo'),
    onChange: sendConfig,
  });
  buildTray();
  updates.start();
  watcher = new Watcher({ demo: process.argv.includes('--demo') });
  watcher.on('agents', onAgents);
  watcher.start();

  ipcMain.on('set-ignore', (_e, ignore) => win.setIgnoreMouseEvents(ignore, { forward: true }));
  // Dragging the roof moves the room anywhere on any screen. Moves are measured from where
  // the drag started, so bumping into an edge never leaves the room lagging behind the cursor.
  let drag = null;
  ipcMain.on('drag-start', () => { const b = win.getBounds(); drag = { x: b.x, y: b.y }; });
  ipcMain.on('drag-move', (_e, dx, dy) => {
    if (!drag) return;
    const b = win.getBounds();
    const want = { x: drag.x + Math.round(dx), y: drag.y + Math.round(dy || 0) };
    // the screen under the room's middle decides its size (scaling) and the edges it stays inside
    const d = screen.getDisplayNearestPoint({ x: Math.round(want.x + b.width / 2), y: Math.round(want.y + b.height / 2) });
    const { w, h, offY } = sizeOn(d);
    const wa = d.workArea;
    const nx = Math.max(wa.x, Math.min(wa.x + wa.width - w, want.x));
    const ny = Math.max(wa.y, Math.min(wa.y + wa.height - h, want.y));
    win.setBounds({ x: nx, y: ny, width: w, height: h });
    const moved = d.id !== pos.displayId;
    pos = { anchor: 'free', x: nx, y: ny - offY, displayId: d.id };
    if (moved) sendConfig();
  });
  ipcMain.on('drag-end', () => { drag = null; savePos(); if (tray) tray.setContextMenu(trayMenu()); });
  ipcMain.on('set-option', (_e, key, value) => setOption(String(key), value));
  ipcMain.on('ack', (_e, id) => watcher.ack(id));
  ipcMain.on('hide-agent', (_e, id) => watcher.hide(id));
  ipcMain.handle('jump', (_e, agent) => jumpTo(agent));
  ipcMain.handle('github', (_e, cwds, force) => github.lookup((cwds || []).filter((c) => typeof c === 'string'), Boolean(force)));
  ipcMain.on('open-url', (_e, url) => { if (/^https:\/\/github\.com\//.test(String(url))) shell.openExternal(url); });

  // your own todos live in a small JSON file next to the app settings
  const todoFile = path.join(app.getPath('userData'), 'todos.json');
  ipcMain.handle('todos-load', () => { try { return JSON.parse(fs.readFileSync(todoFile, 'utf8')); } catch { return []; } });
  ipcMain.on('todos-save', (_e, todos) => fs.writeFile(todoFile, JSON.stringify(todos, null, 2), () => {}));

  // each room remembers how messy it is between runs
  const roomsFile = path.join(app.getPath('userData'), 'rooms.json');
  ipcMain.handle('rooms-load', () => { try { return JSON.parse(fs.readFileSync(roomsFile, 'utf8')); } catch { return null; } });
  ipcMain.on('rooms-save', (_e, state) => fs.writeFile(roomsFile, JSON.stringify(state), () => {}));
  screen.on('display-metrics-changed', () => win.setBounds(bounds()));

  // Dev helper: ROOM_SHOT=out.png saves a screenshot after a few seconds and quits.
  if (process.env.ROOM_SHOT) {
    win.webContents.on('console-message', (_e, _l, msg) => {
      if (msg.startsWith('GALLERY:')) { require('fs').writeFileSync('gallery.png', nativeImage.createFromDataURL(msg.slice(8)).toPNG()); return; }
      const asset = msg.match(/^ASSET:([a-z0-9-]+):(data:image\/png;base64,.+)$/);
      if (asset) { fs.mkdirSync('site/assets', { recursive: true }); fs.writeFileSync(`site/assets/${asset[1]}.png`, nativeImage.createFromDataURL(asset[2]).toPNG()); return; }
      console.log('[renderer]', msg);
    });
    if (process.env.ROOM_SCRIPT) {
      win.webContents.on('did-finish-load', () => setTimeout(() => {
        win.webContents.executeJavaScript(require('fs').readFileSync(process.env.ROOM_SCRIPT, 'utf8')).catch((e) => console.error('script', e));
      }, 2500));
    }
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.ROOM_SHOT, img.toPNG());
      const raw = await win.webContents.executeJavaScript('document.getElementById("room").toDataURL()');
      const big = nativeImage.createFromDataURL(raw);
      require('fs').writeFileSync(process.env.ROOM_SHOT.replace('.png', '-raw.png'), big.toPNG());
      app.quit();
    }, Number(process.env.ROOM_SHOT_DELAY || 6000));
  }
});

// The room only watches. "Jump to it" hands you over to wherever the agent actually lives.
function jumpTo(a) {
  if (a.host === 't3code') { shell.openExternal('t3code://'); return 'Opening t3code'; }
  if (a.host === 'codex-app') { shell.openExternal('codex://'); return 'Opening the Codex app'; }
  if (a.host === 'vscode' && a.cwd) { shell.openExternal('vscode://file/' + a.cwd.replace(/\\/g, '/')); return 'Opening VS Code'; }
  if (a.sessionId && (a.provider === 'codex' || a.provider === 'claude')) {
    const resume = a.provider === 'codex' ? `codex resume ${a.sessionId}` : `claude --resume ${a.sessionId}`;
    clipboard.writeText(a.cwd ? `cd "${a.cwd}"; ${resume}` : resume);
    return 'Resume command copied';
  }
  return 'Nowhere to jump to';
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (updates) updates.dispose(); if (watcher) watcher.stop(); });

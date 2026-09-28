/* global pixelText, pixelTextWidth, Sfx */
// Roombai — a messy little room where every roomba is one of your coding agents.

// ---------- layout (internal pixel resolution) ----------
const W = 360;
const H = 104;
const RX0 = 7; // interior left
const RX1 = W - 7; // interior right
const ROOF_Y = 11;
const CEIL = 21; // interior top
const FLOOR_TOP = 70;
const FLOOR_BACK = 75; // the furthest back a roomba can drive
const FLOOR_FRONT = 95; // the nearest
const BOTTOM = 99;
const GRAVITY = 420;
const MAX_CLUTTER = 26;

const BOARD = { x: 14, y: 26, w: 64, h: 34 };
const TRASH = { x: 310, y: 60, w: 9, h: 10 };
const BASKET = { x: 290, y: 80, w: 12, h: 11 };
const STATION = { x: 322, w: 28 }; // the recharge pod where shooed roombas go

// the room currently on screen (see rooms.js) and its live state
let room = null;
let FURNITURE = []; // pieces a roomba can climb and scrub
let clutter = [];

const PROVIDER = {
  codex: { body: '#ecebf3', shade: '#c3c1d3', accent: '#10a37f', name: 'Codex' },
  claude: { body: '#f0a37e', shade: '#c9714b', accent: '#fff1e6', name: 'Claude' },
  custom: { body: '#9fc6e8', shade: '#6f97bd', accent: '#ffd166', name: 'Agent' },
};
const STATUS_EYE = { working: '#6ff3ff', waiting: '#ffd166', stuck: '#ff4d5e', done: '#7dff8a', idle: '#8a8fb0' };
const NOTE = { working: '#ffe66d', waiting: '#ffb347', stuck: '#ff6b6b', done: '#8ee59b' };

// ---------- canvas ----------
const canvas = document.getElementById('room');
let ctx = canvas.getContext('2d'); // swapped briefly while the whiteboard draws offscreen
canvas.width = W;
canvas.height = H;
let scale = 3;
function applyScale(s) {
  scale = s;
  canvas.style.width = W * s + 'px';
  canvas.style.height = H * s + 'px';
}
applyScale(3);

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
function px(x, y, c) { rect(x, y, 1, 1, c); }
function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
function mix(a, b, t) {
  const A = hex(a); const B = hex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t, 0, 1)).toString(16).padStart(2, '0')).join('');
}
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  return (s / 3600).toFixed(1) + 'h';
}

// ---------- world state ----------
let agents = [];
const roombas = new Map();
const particles = [];
const floaters = [];
let cleanliness = 0.6; // smoothed, 0 = pigsty, 1 = spotless
let messTarget = null;
let flash = { t: 0, color: '#ff4d5e' };
let time = 0;
let muted = false;
let nextId = 1;

const STAINS = (() => {
  const r = seeded(7);
  return Array.from({ length: 9 }, () => ({ x: RX0 + 8 + r() * (RX1 - RX0 - 30), y: FLOOR_BACK + r() * 18, w: 4 + Math.floor(r() * 7), c: r() > 0.5 ? '#3d2b1a' : '#4a5a2a' }));
})();
const WALL_MARKS = (() => {
  const r = seeded(99);
  return Array.from({ length: 6 }, () => ({ x: RX0 + 4 + r() * 250, y: CEIL + 6 + r() * 38, s: r() }));
})();

// ---------- clutter ----------
const CLUTTER_TYPES = ['sock', 'shirt', 'pizza', 'can', 'paper', 'banana', 'mug', 'undies', 'book', 'pants', 'sock', 'paper'];
function roomSpots(r) {
  const spots = [{ x: BOARD.x + 55, y: BOARD.y - 1, types: ['sock', 'undies'] }];
  for (const p of r.pieces) for (const sp of p.spec.spots(p)) spots.push({ ...sp, furn: p.spec.surface(p) ? p : null });
  return spots;
}

function spawnClutter(animated = true, floorTypes = null) {
  const freeSpots = room.spots.filter((s) => !clutter.some((c) => c.spot === s && c.mode !== 'dying'));
  let c;
  if (!floorTypes && freeSpots.length && Math.random() < 0.3) {
    const s = pick(freeSpots);
    c = { type: pick(s.types), x: s.x, restY: s.y, spot: s };
  } else {
    c = { type: pick(floorTypes || CLUTTER_TYPES), x: rand(RX0 + 10, STATION.x - 8), restY: rand(FLOOR_BACK + 1, FLOOR_FRONT), spot: null };
  }
  Object.assign(c, {
    id: nextId++, color: pick(['#e63946', '#457b9d', '#f4a261', '#8338ec', '#2a9d8f', '#f1faee']),
    flip: Math.random() < 0.5, mode: animated ? 'air' : 'rest', y: animated ? CEIL + 2 : 0, vx: 0, vy: 0, doomed: false, dieT: 0,
  });
  if (!animated) c.y = c.restY;
  clutter.push(c);
  if (animated) Sfx.plop();
}

function drawClutter(type, x, y, color, flip, alpha = 1) {
  // (x, y) is the bottom-center of the item
  ctx.globalAlpha = alpha;
  const f = flip ? -1 : 1;
  const X = (dx) => x + dx * f - (flip ? 1 : 0);
  switch (type) {
    case 'sock':
      rect(X(-2), y - 5, 2, 4, color); rect(flip ? X(-2) - 2 : X(-2), y - 2, 4, 2, color); px(X(-2), y - 5, '#fff'); px(X(-1), y - 5, '#fff');
      break;
    case 'shirt':
      rect(x - 4, y - 4, 8, 4, color); rect(x - 5, y - 4, 2, 2, color); rect(x + 3, y - 4, 2, 2, color); px(x - 1, y - 4, '#0003'); px(x, y - 4, '#0003');
      break;
    case 'pants':
      rect(x - 4, y - 3, 9, 2, '#3a5a8c'); rect(x - 4, y - 1, 3, 1, '#3a5a8c'); rect(x + 2, y - 1, 3, 1, '#3a5a8c'); px(x, y - 3, '#2a4570');
      break;
    case 'pizza':
      rect(x - 5, y - 2, 10, 2, '#c9a26b'); rect(x - 5, y - 3, 10, 1, '#e3c08d'); px(x - 2, y - 3, '#d64933'); px(x + 2, y - 3, '#d64933'); px(x, y - 3, '#f7d358');
      break;
    case 'can':
      rect(x - 1, y - 5, 3, 5, color); px(x - 1, y - 5, '#ccc'); px(x + 1, y - 5, '#ccc'); px(x, y - 3, '#fff');
      break;
    case 'paper':
      rect(x - 2, y - 3, 4, 3, '#f1f1f1'); px(x - 1, y - 2, '#bbb'); px(x + 1, y - 3, '#ccc');
      break;
    case 'banana':
      rect(x - 3, y - 1, 6, 1, '#f5d547'); px(x - 3, y - 2, '#f5d547'); px(x + 2, y - 2, '#f5d547'); px(x - 4, y - 2, '#6b4f1d'); px(x, y - 2, '#e6c235');
      break;
    case 'mug':
      rect(x - 2, y - 4, 4, 4, '#f1faee'); px(x + 2, y - 3, '#f1faee'); px(x + 2, y - 2, '#f1faee'); rect(x - 2, y - 4, 4, 1, '#6b3e1f');
      break;
    case 'undies':
      rect(x - 3, y - 3, 7, 1, color); rect(x - 3, y - 2, 2, 2, color); rect(x + 2, y - 2, 2, 2, color); px(x - 1, y - 2, color); px(x + 1, y - 2, color); px(x, y - 2, '#ff9ecb');
      break;
    case 'book':
      rect(x - 3, y - 2, 7, 2, color); rect(x - 3, y - 3, 7, 1, '#f1faee'); px(x - 3, y - 2, '#0004');
      break;
  }
  ctx.globalAlpha = 1;
}

// ---------- roombas ----------
function makeRoomba(agent, how) {
  const beam = how === 'beam';
  return {
    id: agent.id, agent, prevStatus: agent.status,
    x: beam ? STATION.x + STATION.w / 2 : rand(RX0 + 12, STATION.x - 12),
    d: beam ? FLOOR_BACK + 2 : rand(FLOOR_BACK + 2, FLOOR_FRONT), y: FLOOR_BACK,
    vx: 0, vy: 0, dir: -1, mode: beam ? 'beam-in' : 'floor', beamT: 0,
    goalX: null, goalD: null, pause: rand(0, 2), hop: 0, hopV: 0,
    wheel: 0, dustT: 0, target: null, hat: null, ceilT: 0, bubbleBob: rand(0, 6), stuckX: null, zT: 0, spin: 0, blink: rand(2, 5),
  };
}

// Every agent gets its own color, picked from its provider's family:
// Codex = greens/teals/blues, Claude = corals/oranges/pinks, others = purples.
const HUE_RANGE = { codex: [135, 225], claude: [-25, 40], custom: [255, 305] };
const colorCache = new Map();
function agentColors(agent) {
  let c = colorCache.get(agent.id);
  if (c) return c;
  let h = 2166136261;
  for (const ch of agent.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  const [a, b] = HUE_RANGE[agent.provider] || HUE_RANGE.custom;
  const hue = (a + (h % 1000) / 1000 * (b - a) + 360) % 360;
  const light = 64 + ((h >>> 10) % 14);
  c = {
    body: `hsl(${hue.toFixed(0)} 62% ${light}%)`,
    shade: `hsl(${hue.toFixed(0)} 48% ${light - 20}%)`,
    accent: (PROVIDER[agent.provider] || PROVIDER.custom).accent,
  };
  colorCache.set(agent.id, c);
  return c;
}
function baseOf(r) {
  if (r.mode === 'floor' || r.mode === 'beam-in' || r.mode === 'beam-out') return r.d - r.hop;
  if (r.mode === 'perch') return r.y - r.hop;
  return r.y;
}
function roombaColors(r) { return agentColors(r.agent); }

function drawRoomba(r) {
  const { x } = r;
  const upside = r.mode === 'ceiling';
  const baseY = baseOf(r);
  const col = roombaColors(r);
  const status = r.agent.status;
  ctx.save();
  let wx = Math.round(x);
  if (status === 'stuck' && r.mode === 'floor') wx += Math.sin(time * 40) > 0 ? 1 : 0;
  const by = Math.round(baseY);
  if (upside) { ctx.translate(0, by * 2 - 7); ctx.scale(1, -1); }

  if (r.mode === 'floor') { ctx.globalAlpha = 0.25; rect(wx - 7, r.d, 14, 1, '#000'); ctx.globalAlpha = 1; }
  // wheels
  const wOn = Math.floor(r.wheel) % 2 === 0;
  rect(wx - 5, by - 1, 3, 1, '#1d1a26'); rect(wx + 2, by - 1, 3, 1, '#1d1a26');
  px(wx - (wOn ? 4 : 5), by - 1, '#555'); px(wx + (wOn ? 3 : 4), by - 1, '#555');
  // body
  rect(wx - 7, by - 3, 14, 2, col.shade);
  rect(wx - 7, by - 5, 14, 2, col.body);
  rect(wx - 6, by - 6, 12, 1, col.body);
  rect(wx - 5, by - 7, 10, 1, '#2b2838');
  px(wx - 6, by - 5, '#ffffff88');
  rect(wx - 7, by - 2, 14, 1, '#00000030');
  // face screen
  const fx = wx - 3 + r.dir;
  rect(fx, by - 5, 6, 2, '#1b1830');
  const eye = STATUS_EYE[status] || STATUS_EYE.idle;
  const blinking = r.blink < 0.12;
  if (r.mode === 'held' || r.mode === 'air') {
    rect(fx + 1, by - 5, 1, 2, eye); rect(fx + 4, by - 5, 1, 2, eye); // wide eyes
  } else if (status === 'idle' || blinking) {
    px(fx + 1, by - 4, eye); px(fx + 4, by - 4, eye);
  } else if (status === 'done') {
    px(fx + 1, by - 5, eye); px(fx + 4, by - 5, eye); px(fx + 2, by - 4, eye); px(fx + 3, by - 4, eye); // smile-ish ^‿^
  } else if (status === 'stuck') {
    px(fx + 1, by - 5, eye); px(fx + 2, by - 4, eye); px(fx + 4, by - 5, eye); px(fx + 3, by - 4, eye); // >< eyes
  } else {
    rect(fx + 1 + (r.dir > 0 ? 1 : 0), by - 5, 1, 2, eye); rect(fx + 4 + (r.dir > 0 ? 0 : -1), by - 5, 1, 2, eye);
  }
  // provider hat
  if (!r.hat) {
    if (r.agent.provider === 'codex') {
      rect(wx + 3, by - 10, 1, 3, '#2b2838');
      px(wx + 3, by - 11, Math.sin(time * 6) > 0 ? col.accent : '#7dffd8');
    } else if (r.agent.provider === 'claude') {
      const c = '#d97757';
      px(wx, by - 9, c); px(wx - 1, by - 10, c); px(wx + 1, by - 10, c); px(wx, by - 11, c); px(wx - 1, by - 8, c); px(wx + 1, by - 8, c);
    } else {
      rect(wx - 1, by - 9, 3, 2, col.accent);
    }
    if (r.agent.host === 't3code') { rect(wx - 4, by - 11, 1, 4, '#2b2838'); rect(wx - 3, by - 11, 3, 2, '#9b5de5'); }
  } else {
    drawClutter(r.hat.type, wx, by - 6, r.hat.color, r.hat.flip);
  }
  ctx.restore();
}

function drawBubble(r) {
  const s = r.agent.status;
  if (s === 'idle') return; // idle roombas just snore Z's
  if (r.mode === 'held' || r.mode === 'beam-in' || r.mode === 'beam-out') return;
  const upside = r.mode === 'ceiling';
  const baseY = baseOf(r);
  const bob = Math.round(Math.sin(time * 4 + r.bubbleBob));
  const bx = Math.round(r.x) - 4;
  const by = upside ? Math.round(baseY) + 4 + bob : Math.round(baseY) - 20 + bob;
  const border = { stuck: '#e63946', waiting: '#e09f1f', done: '#2a9d4b', working: '#3a86ff', idle: '#8d8497' }[s];
  if (s === 'stuck' && Math.sin(time * 10) < -0.3) return; // blink
  rect(bx, by + 1, 9, 7, border); rect(bx + 1, by, 7, 9, border);
  rect(bx + 1, by + 1, 7, 7, '#fffaf0');
  if (!upside) { px(bx + 4, by + 9, border); } else { px(bx + 4, by - 1, border); }
  if (s === 'stuck') pixelText(ctx, '!', bx + 3, by + 2, '#e63946');
  else if (s === 'waiting') pixelText(ctx, '?', bx + 3, by + 2, '#c77d00');
  else if (s === 'done') { const c = '#2a9d4b'; px(bx + 2, by + 4, c); px(bx + 3, by + 5, c); px(bx + 4, by + 4, c); px(bx + 5, by + 3, c); px(bx + 6, by + 2, c); px(bx + 3, by + 6, c); }
  else if (s === 'working') { const k = Math.floor(time * 3) % 4; for (let i = 0; i < 3; i++) if (i < k) px(bx + 2 + i * 2, by + 5, '#3a86ff'); }
}

// ---------- agent sync ----------
let allAgents = [];
const knownAgents = new Set(); // agents we've seen at least once, so only truly new ones beam in
function syncAgents(list) {
  allAgents = list;
  refreshRoomList();
  agents = list.filter((a) => belongsHere(a));
  const seen = new Set();
  for (const a of agents) {
    seen.add(a.id);
    let r = roombas.get(a.id);
    if (!r) {
      const isNew = !knownAgents.has(a.id);
      r = makeRoomba(a, isNew && !firstSync ? 'beam' : 'place');
      roombas.set(a.id, r);
      if (r.mode === 'beam-in') Sfx.beam();
      continue;
    }
    const prev = r.agent.status;
    const before = r.agent;
    r.agent = a;
    onActivity(r, (a.turns || 0) - (before.turns || 0), (a.toolCalls || 0) - (before.toolCalls || 0));
    if (prev !== a.status) onStatusChange(r, prev, a.status);
  }
  for (const [id, r] of roombas) {
    if (!seen.has(id) && r.mode !== 'beam-out') {
      burst(r.x, baseOf(r) - 4, ['#ddd', '#fff'], 8);
      roombas.delete(id);
    }
  }
  for (const a of list) knownAgents.add(a.id);
  firstSync = false;
  if (pinned && !roombas.has(pinned.id)) hideTip();
}

function onStatusChange(r, prev, next) {
  r.stuckX = null;
  if (r.mode !== 'perch') r.goalX = null;
  if (next === 'done') {
    Sfx.done();
    confetti(r.x, baseOf(r) - 8);
    floater('DONE!', r.x, baseOf(r) - 14, '#2a9d4b');
    r.hopV = 90;
  } else if (next === 'stuck') {
    Sfx.stuck();
    flash = { t: 1.2, color: '#ff4d5e' };
    floater('HELP!', r.x, baseOf(r) - 14, '#e63946');
  } else if (next === 'waiting') {
    Sfx.waiting();
    flash = { t: 0.8, color: '#ffd166' };
  } else if (next === 'working' && prev !== 'working') {
    r.hopV = 60;
  }
}

function computeMessTarget() {
  let t = 0;
  for (const a of agents) {
    if (a.status === 'working') t += 2;
    else if (a.status === 'waiting') t += 3;
    else if (a.status === 'stuck') t += 4;
    else if (a.status === 'done') t -= 1;
  }
  t += roomTodos().filter((k) => !k.done).length;
  return clamp(Math.round(t), 0, MAX_CLUTTER);
}

let firstSync = true;
function updateMess() {
  if (!room) return;
  const target = computeMessTarget();
  if (messTarget === null) {
    messTarget = target;
    for (let i = 0; i < target; i++) { if (i % 2) dirtyFurniture(false); else spawnClutter(false); }
    return;
  }
  if (target > messTarget) {
    const n = target - messTarget;
    // half the new mess lands on the floor, half trashes the furniture
    for (let i = 0; i < n; i++) setTimeout(() => (Math.random() < 0.5 ? spawnClutter(true) : dirtyFurniture(true)), i * 350);
  } else if (target < messTarget) {
    let n = messTarget - target;
    const alive = clutter.filter((c) => !c.doomed && c.mode === 'rest');
    // clean the floor first so roombas get to do it
    alive.sort((a, b) => (a.spot ? 1 : 0) - (b.spot ? 1 : 0));
    for (const c of alive) { if (n-- <= 0) break; c.doomed = true; c.doomedAt = time; }
  }
  messTarget = target;
  markRoomDirty();
}

const WRECKED = 0.66;
function dirtyFurniture(animated) {
  const candidates = FURNITURE.filter((f) => f.dirtable && f.dirt < 1);
  if (!candidates.length) return spawnClutter(animated);
  // cleaner pieces are more likely to get hit, so grime spreads around the room
  candidates.sort((a, b) => a.dirt - b.dirt + rand(-0.4, 0.4));
  const f = candidates[0];
  const before = f.dirt;
  f.dirt = Math.min(1, f.dirt + rand(0.18, 0.3));
  markRoomDirty();
  if (!animated) { f.shown = f.dirt; return; }
  const [bx, by, bw] = f.box;
  burst(bx + bw / 2, by + 3, ['#6b5a2a', '#56652d', '#3b2d20'], 7);
  if (before < WRECKED && f.dirt >= WRECKED) { Sfx.crash(); floater('CRASH!', bx + bw / 2, by - 4, '#e63946'); }
  else Sfx.splat();
}

// ---------- activity makes mess ----------
// Every new message is new work arriving: deliveries drop from the ceiling and sometimes
// the furniture takes grime. The roomba whose agent is working is the one that cleans it up.
function floorJunk() { return clutter.filter((c) => c.mode !== 'dying').length; }

function onActivity(r, newTurns, newTools) {
  if (newTurns > 0) {
    for (let i = 0; i < Math.min(newTurns * 2, 4); i++) setTimeout(() => { if (floorJunk() < MAX_CLUTTER) { spawnClutter(true, ['pizza', 'pizza', 'can', 'mug']); clutter[clutter.length - 1].announce = true; } }, i * 300);
  }
  if (newTurns > 0 && Math.random() < 0.5) setTimeout(() => dirtyFurniture(true), 700);
}

// ---------- particles ----------
function burst(x, y, colors, n = 6) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-40, 40), vy: rand(-60, -10), life: rand(0.3, 0.7), c: pick(colors), g: 120 });
}
function confetti(x, y) {
  for (let i = 0; i < 22; i++) particles.push({ x, y, vx: rand(-60, 60), vy: rand(-110, -40), life: rand(0.7, 1.4), c: pick(['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#fff']), g: 160 });
}
function dust(x, y) {
  particles.push({ x: x + rand(-2, 2), y: y - 1, vx: rand(-6, 6), vy: rand(-10, -3), life: rand(0.3, 0.6), c: '#d8cfc4', g: 0 });
}
function floater(text, x, y, c) {
  const half = pixelTextWidth(text) / 2;
  floaters.push({ text, x: clamp(x, RX0 + half + 1, RX1 - half - 1), y, c, life: 1.3 });
}

// ---------- input ----------
let pointer = { x: -99, y: -99, inside: false, down: false, history: [] };
let dragging = null; // { kind: 'roomba'|'clutter'|'window', obj, offX, offY, moved }
let hoverRoomba = null;
let hoverFurn = null;
let hoverCrank = false;
let hoverFaceTitle = false;
let pinned = null;
let ignoring = true;

function toInternal(e) { return { x: e.clientX / scale, y: e.clientY / scale + viewTop }; }

function roombaAt(x, y) {
  let best = null;
  for (const r of roombas.values()) {
    const by = baseOf(r);
    const top = r.mode === 'ceiling' ? by - 1 : by - 11;
    const bottom = r.mode === 'ceiling' ? by + 11 : by + 1;
    if (x >= r.x - 8 && x <= r.x + 8 && y >= top && y <= bottom) {
      if (!best || by > (best.mode === 'floor' ? best.d : best.y)) best = r;
    }
  }
  return best;
}
function clutterAt(x, y) {
  for (let i = clutter.length - 1; i >= 0; i--) {
    const c = clutter[i];
    if (c.mode === 'dying') continue;
    if (Math.abs(x - c.x) <= 5 && y <= c.y + 1 && y >= c.y - 7) return c;
  }
  return null;
}
function onPlus(x, y) { return boardFace === 0 && !spin && x >= PLUS.x - 1 && x <= PLUS.x + PLUS.w && y >= PLUS.y - 1 && y <= PLUS.y + PLUS.h; }
function noteAt(x, y) {
  for (const n of noteLayout()) if (x >= n.x && x < n.x + 9 && y >= n.y && y < n.y + 8) return n;
  return null;
}
function inRoom(x, y) { return x >= 3 && x <= W - 3 && y >= ROOF_Y - 2 && y <= H - 1; }
function onRoof(x, y) { return y >= ROOF_Y - 2 && y < CEIL - 1 && x >= 3 && x <= W - 3; }
function signPart(x, y) {
  if (y < ROOF_Y || y > ROOF_Y + 9) return null;
  const g = signGeom();
  if (x >= g.lx && x < g.lx + 7) return 'prev';
  if (x >= g.rx && x < g.rx + 7) return 'next';
  if (x >= g.x && x < g.x + g.w) return 'name';
  return null;
}

function updateIgnore(e) {
  const { x, y } = toInternal(e);
  const overTip = e.target instanceof Element && Boolean(e.target.closest('.panel'));
  const want = !(dragging || overTip || inRoom(x, y) || roofButtonAt(x, y) || roombaAt(x, y));
  if (want !== ignoring) { ignoring = want; window.bridge && window.bridge.setIgnore(want); }
}

window.addEventListener('mousemove', (e) => {
  updateIgnore(e);
  const p = toInternal(e);
  pointer.x = p.x; pointer.y = p.y;
  pointer.history.push({ x: p.x, y: p.y, t: performance.now() });
  while (pointer.history.length > 8) pointer.history.shift();
  if (dragging) {
    if (dragging.kind === 'window') {
      window.bridge.dragMove(e.screenX - dragging.sx, e.screenY - dragging.sy);
      return;
    }
    if (Math.abs(p.x - dragging.startX) + Math.abs(p.y - dragging.startY) > 2) dragging.moved = true;
    return;
  }
  const r = roombaAt(p.x, p.y);
  const n = r ? null : noteAt(p.x, p.y);
  const target = r || (n && n.agent && roombas.get(n.agent.id));
  hoverRoomba = target || null;
  hoverTodo = n && n.todo ? n.todo : null;
  const ghNote = n && (n.issue || n.pr) ? n : null;
  hoverGh = ghNote ? ghNote.issue || ghNote.pr : null;
  hoverCrank = !r && onCrank(p.x, p.y);
  hoverFaceTitle = !r && onFaceTitle(p.x, p.y);
  hoverPlus = !r && onPlus(p.x, p.y);
  hoverFurn = target || clutterAt(p.x, p.y) ? null : furnitureAt(p.x, p.y);
  hoverSign = signPart(p.x, p.y);
  canvas.style.cursor = r || hoverTodo || clutterAt(p.x, p.y) ? 'grab' : hoverPlus || hoverSign || hoverGh || hoverCrank || hoverFaceTitle ? 'pointer' : onRoof(p.x, p.y) ? 'move' : 'default';
  if (!pinned) {
    if (target) showTip(target, false);
    else if (!tipEl.hidden && !tipEl.matches(':hover')) hideTip();
  }
  if (!pinnedTodo && !pinnedGh) {
    if (hoverTodo && !pinned) showTodoCard(hoverTodo, false);
    else if (ghNote && !pinned) showGhCard(ghNote, false);
    else if (!tcardEl.hidden && !tcardEl.matches(':hover')) hideTodoCard();
  }
});

canvas.addEventListener('mousedown', (e) => {
  const p = toInternal(e);
  if (e.button === 2) return;
  const r = roombaAt(p.x, p.y);
  if (r) {
    dragging = { kind: 'roomba', obj: r, startX: p.x, startY: p.y, moved: false };
    return;
  }
  const c = clutterAt(p.x, p.y);
  if (c) {
    dragging = { kind: 'clutter', obj: c, startX: p.x, startY: p.y, moved: false };
    return;
  }
  const sp = signPart(p.x, p.y);
  const rb = roofButtonAt(p.x, p.y);
  if (rb === 'menu') { toggleMenu(); return; }
  if (rb === 'roll') { window.bridge.setOption('collapsed', !appCfg.collapsed); return; }
  if (sp === 'prev' || sp === 'next') { cycleRoom(sp === 'prev' ? -1 : 1); return; }
  if (sp === 'name') { toggleRoomList(); return; }
  if (onRoof(p.x, p.y)) { dragging = { kind: 'window', sx: e.screenX, sy: e.screenY }; window.bridge.dragStart(e.screenX, e.screenY); return; }
  if (onCrank(p.x, p.y) || onFaceTitle(p.x, p.y)) { spinBoard(1); return; }
  if (onPlus(p.x, p.y)) { if (todoPopEl.hidden) openTodoPop(); else closeTodoPop(); Sfx.squeak(); return; }
  const n = spin ? null : noteAt(p.x, p.y);
  if (n && (n.issue || n.pr)) { hideTip(); hideTodoCard(); showGhCard(n, true); return; }
  if (n && n.todo && !n.todo.done) { dragging = { kind: 'note', obj: n.todo, startX: p.x, startY: p.y, moved: false }; return; }
  if (n && n.agent && roombas.get(n.agent.id)) { hideTodoCard(); showTip(roombas.get(n.agent.id), true); return; }
  if (pinned) hideTip();
  if (pinnedTodo || pinnedGh) hideTodoCard();
  if (!todoPopEl.hidden) closeTodoPop();
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  if (d.kind === 'window') { window.bridge.dragEnd(); return; }
  const p = toInternal(e);
  const obj = d.obj;
  if (d.kind === 'note') { releaseNote(obj, p, d.moved); return; }
  if (!d.moved) {
    if (obj.mode === 'held') release(obj, p, true);
    if (d.kind === 'roomba') {
      if (pinned === obj) hideTip(); else showTip(obj, true);
      obj.hopV = 70; Sfx.squeak();
    } else {
      obj.vy = -80; obj.mode = 'air'; obj.vx = rand(-20, 20); Sfx.squeak();
    }
    return;
  }
  release(obj, p, false, d.kind);
});

canvas.addEventListener('contextmenu', (e) => {
  const p = toInternal(e);
  const r = roombaAt(p.x, p.y);
  if (r) { e.preventDefault(); shoo(r); }
});

canvas.addEventListener('dblclick', (e) => {
  const p = toInternal(e);
  const gn = spin ? null : noteAt(p.x, p.y);
  if (gn && (gn.issue || gn.pr)) { window.bridge.openUrl((gn.issue || gn.pr).url); hideTodoCard(); return; }
  const r = roombaAt(p.x, p.y);
  if (r && r.agent.status === 'done') { window.bridge.ack(r.id); hideTip(); floater('THANKS!', r.x, r.d - 14, '#3a86ff'); }
});

function throwVelocity() {
  const h = pointer.history;
  if (h.length < 2) return { vx: 0, vy: 0 };
  const a = h[0]; const b = h[h.length - 1];
  const dt = Math.max(16, b.t - a.t) / 1000;
  return { vx: clamp((b.x - a.x) / dt, -400, 400), vy: clamp((b.y - a.y) / dt, -500, 500) };
}

function release(obj, p, quiet, kind) {
  const v = quiet ? { vx: 0, vy: 0 } : throwVelocity();
  obj.mode = 'air';
  obj.vx = v.vx; obj.vy = v.vy;
  if (kind === 'clutter') {
    obj.spot = null;
    obj.restY = clamp(p.y > FLOOR_BACK ? p.y : rand(FLOOR_BACK + 1, FLOOR_FRONT), FLOOR_BACK + 1, FLOOR_FRONT);
    // dropped into the laundry basket?
    const bin = [BASKET, TRASH].find((k) => p.x >= k.x - 2 && p.x <= k.x + k.w + 2 && p.y >= k.y - 10 && p.y <= k.y + k.h);
    if (bin) {
      obj.mode = 'dying'; obj.dieT = 0.35; obj.intoBasket = bin;
      Sfx.tidy(); floater('+1 TIDY', bin.x + 6, bin.y - 8, '#2a9d4b');
        return;
    }
    // dropped onto a roomba? it eats it or wears it
    const r = roombaAt(p.x, p.y + 3);
    if (r && r.mode !== 'held') {
      if (!r.hat && ['sock', 'undies', 'shirt', 'pizza', 'mug', 'book'].includes(obj.type) && Math.random() < 0.55) {
        r.hat = { type: obj.type, color: obj.color, flip: obj.flip };
        obj.mode = 'dying'; obj.dieT = 0.01; obj.silent = true;
        floater('NICE HAT', r.x, baseOf(r) - 16, '#8338ec');
        Sfx.squeak();
      } else {
        obj.mode = 'dying'; obj.dieT = 0.3;
        floater('*BURP*', r.x, baseOf(r) - 16, '#6b5f73');
        setTimeout(() => Sfx.burp(), 250);
      }
      return;
    }
    Sfx.drop();
  } else {
    obj.perch = null;
    obj.landD = p.y > FLOOR_BACK ? clamp(p.y, FLOOR_BACK, FLOOR_FRONT) : obj.d;
    obj.y = clamp(p.y + 5, CEIL + 7, FLOOR_FRONT);
    // released over furniture: set it gently on top instead of dropping it behind
    const f = furnitureAt(p.x, p.y);
    if (f && Math.abs(v.vx) + Math.abs(v.vy) < 250) {
      obj.x = clamp(obj.x, f.sx0 + 7, Math.max(f.sx0 + 7, f.sx1 - 7));
      obj.y = Math.min(obj.y, f.top - 2);
      obj.vx *= 0.2; obj.vy = Math.min(obj.vy, 0) * 0.2;
    }
    if (!quiet) Sfx.drop();
  }
}

// ---------- your own todos (just notes — the room never acts on them) ----------
let todos = []; // { id, text, createdAt, done, doneAt }
const PLUS = { x: BOARD.x + BOARD.w - 10, y: BOARD.y + 2, w: 7, h: 7 };
let hoverPlus = false;
let hoverTodo = null;
let pinnedTodo = null;
const todoPopEl = document.getElementById('todo-pop');
const tcardEl = document.getElementById('tcard');
const $ = (id) => document.getElementById(id);

function roomTodos() { return room && room.key !== GARAGE ? todos.filter((t) => t.room === room.key) : todos; }
function openTodos() { return roomTodos().filter((t) => !t.done); }
function saveTodos() { if (window.bridge) window.bridge.saveTodos(todos); }

function addTodo(text) {
  const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, createdAt: Date.now(), done: false, room: room.key };
  todos.push(t);
  saveTodos();
  Sfx.plop();
  const n = noteLayout().find((k) => k.todo === t);
  if (n) burst(n.x + 4, n.y + 3, ['#fff', '#bcd4f0'], 5);
  updateMess();
}

function completeTodo(t) {
  if (t.done) return;
  t.done = true; t.doneAt = Date.now();
  saveTodos();
  const n = noteLayout().find((k) => k.todo === t);
  if (n) { confetti(n.x + 4, n.y + 3); floater('TODO DONE!', n.x + 4, n.y - 4, '#2a9d4b'); }
  Sfx.done();
  if (pinnedTodo === t) hideTodoCard();
  updateMess();
}

function deleteTodo(t) {
  todos = todos.filter((k) => k !== t);
  saveTodos();
  if (pinnedTodo === t) hideTodoCard();
  updateMess();
}

function openTodoPop() {
  hideTip(); hideTodoCard();
  todoPopEl.hidden = false;
  todoPopEl.style.left = clamp(BOARD.x * scale, 4, W * scale - todoPopEl.offsetWidth - 4) + 'px';
  todoPopEl.style.top = clamp((BOARD.y + 10) * scale, 2, H * scale - todoPopEl.offsetHeight - 2) + 'px';
  $('todo-input').focus();
}
function closeTodoPop() { todoPopEl.hidden = true; $('todo-input').blur(); }
$('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('todo-input').value.trim();
  if (text) addTodo(text);
  $('todo-input').value = '';
});

function showTodoCard(t, pin) {
  if (pin) pinnedTodo = t;
  const n = noteLayout().find((k) => k.todo === t);
  $('tcard-status').textContent = t.done ? 'done' : 'todo';
  $('tcard-status').className = 'chip ' + (t.done ? 'done' : 'todo');
  $('tcard-meta').textContent = 'added ' + ago(t.createdAt) + ' ago';
  $('tcard-text').textContent = t.text;
  $('tcard-foot').style.display = pin ? 'flex' : 'none';
  $('tcard-done').hidden = false; $('tcard-del').hidden = false; $('tcard-open').hidden = true;
  $('tcard-hint').textContent = 'or drag it into the trash';
  tcardEl.hidden = false;
  if (n) {
    tcardEl.style.left = clamp(n.x * scale - 20, 4, W * scale - tcardEl.offsetWidth - 4) + 'px';
    tcardEl.style.top = clamp((n.y + 10) * scale, 2, H * scale - tcardEl.offsetHeight - 2) + 'px';
  }
}
function hideTodoCard() { pinnedTodo = null; pinnedGh = null; pinnedGhNote = null; tcardEl.hidden = true; }
$('tcard-done').addEventListener('click', () => { if (pinnedTodo) completeTodo(pinnedTodo); hideTodoCard(); });
$('tcard-del').addEventListener('click', () => { if (pinnedTodo) { deleteTodo(pinnedTodo); Sfx.tidy(); } hideTodoCard(); });

function releaseNote(t, p, moved) {
  if (!moved) { hideTip(); showTodoCard(t, true); return; }
  const bin = [BASKET, TRASH].find((k) => p.x >= k.x - 2 && p.x <= k.x + k.w + 2 && p.y >= k.y - 10 && p.y <= k.y + k.h);
  if (bin) { deleteTodo(t); Sfx.tidy(); floater('TOSSED', bin.x + 5, bin.y - 8, '#6b5f73'); return; }
  Sfx.drop(); // back to the board
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeTodoPop(); hideTip(); hideTodoCard(); if (document.activeElement) document.activeElement.blur(); }
});

// ---------- tooltip ----------
const tipEl = document.getElementById('tip');
function showTip(r, pin) {
  if (pin) pinned = r;
  const a = r.agent;
  const statusText = { working: 'working', waiting: 'needs you', stuck: 'stuck', done: 'done', idle: 'napping' }[a.status];
  $('tip-status').textContent = statusText;
  $('tip-status').className = 'chip ' + a.status;
  const prov = (PROVIDER[a.provider] || PROVIDER.custom).name;
  $('tip-meta').textContent = [prov, a.host && a.host !== 'cli' ? 'via ' + a.host : '', a.project].filter(Boolean).join(' · ');
  $('tip-title').textContent = a.title;
  $('tip-detail').textContent = a.detail || '';
  $('tip-time').textContent = a.status === 'done' ? 'finished ' + ago(a.since) + ' ago' : a.status === 'idle' ? 'last seen ' + ago(a.lastEventAt) + ' ago' : 'for ' + ago(a.since);
  $('tip-ack').hidden = a.status !== 'done';
  $('tip-snooze').hidden = !(a.status === 'waiting' || a.status === 'stuck') || (snoozed.get(a.id) || 0) > Date.now();
  $('tip-jump').textContent = JUMP_LABEL[a.host] || (a.sessionId ? 'Copy resume cmd' : 'Jump to it ↗');
  $('tip-jump').hidden = !JUMP_LABEL[a.host] && !a.sessionId;
  document.querySelector('#tip-foot .btns').style.display = pin ? 'flex' : 'none';
  tipEl.hidden = false;
  tipEl.dataset.id = r.id;
  // Follow the roomba; its movement pauses while this card is pinned.
  const by = baseOf(r);
  const w = tipEl.offsetWidth; const h = tipEl.offsetHeight;
  let left = r.x * scale - w / 2;
  left = clamp(left, 4, W * scale - w - 4);
  let top = (by - 16) * scale - h;
  if (top < 2) top = Math.min((by + 6) * scale, H * scale - h - 2);
  tipEl.style.left = left + 'px';
  tipEl.style.top = Math.max(2, top) + 'px';
}
function hideTip() { pinned = null; tipEl.hidden = true; }
$('tip-ack').addEventListener('click', () => {
  const r = roombas.get(tipEl.dataset.id);
  if (r) { window.bridge.ack(r.id); floater('THANKS!', r.x, r.d - 14, '#3a86ff'); }
  hideTip();
});
const JUMP_LABEL = { t3code: 'Open t3code ↗', 'codex-app': 'Open Codex app ↗', vscode: 'Open VS Code ↗' };
$('tip-jump').addEventListener('click', async () => {
  const r = roombas.get(tipEl.dataset.id);
  if (!r) return;
  const said = await window.bridge.jump(r.agent);
  floater(said === 'Resume command copied' ? 'COPIED!' : 'OFF YOU GO', r.x, baseOf(r) - 16, '#3a86ff');
  hideTip();
});
$('tip-snooze').addEventListener('click', () => { snoozed.set(tipEl.dataset.id, Date.now() + 10 * 60e3); hideTip(); });
$('tip-hide').addEventListener('click', () => { const r = roombas.get(tipEl.dataset.id); if (r) shoo(r); hideTip(); });

// ---------- simulation ----------
function freeFloorRoombas() {
  return [...roombas.values()].filter((r) => r.mode === 'floor' && r.agent.status === 'working' && !r.leaving);
}

function update(dt) {
  time += dt;
  if (!room) return;
  updateSpin(dt);
  animateRoomHop(dt);
  flash.t = Math.max(0, flash.t - dt);

  // cleanliness drifts toward what the clutter says
  const alive = clutter.filter((c) => c.mode !== 'dying').length;
  const stuck = agents.filter((a) => a.status === 'stuck').length;
  const dirtable = FURNITURE.filter((f) => f.dirtable);
  const avgDirt = dirtable.length ? dirtable.reduce((t, f) => t + f.dirt, 0) / dirtable.length : 0;
  const goal = clamp(1 - alive / 16 - avgDirt * 0.7 - stuck * 0.08, 0, 1);
  cleanliness += (goal - cleanliness) * Math.min(1, dt * 0.8);

  // assign vacuum jobs
  for (const c of clutter) {
    if (!c.doomed || c.mode !== 'rest' || c.claimedBy) continue;
    if (c.spot || time - c.doomedAt > 12) { // furniture clutter just gets tidied by magic
      c.mode = 'dying'; c.dieT = 0.4; Sfx.tidy(); burst(c.x, c.y - 2, ['#fff', '#aef'], 5);
      continue;
    }
    const free = freeFloorRoombas().filter((r) => !r.target);
    if (!free.length) continue;
    free.sort((a, b) => Math.abs(a.x - c.x) - Math.abs(b.x - c.x));
    free[0].target = c; c.claimedBy = free[0].id;
  }

  for (const r of roombas.values()) {
    const st = r.agent.status;
    if (r.mode !== 'floor' || r.target || r.leaving || st !== 'working') continue; // only the roomba whose agent is working cleans
    r.cleanCd = (r.cleanCd || rand(1, 3)) - dt;
    if (r.cleanCd > 0) continue;
    r.cleanCd = rand(0.8, 2.2);
    let best = null;
    for (const c of clutter) {
      if (c.mode !== 'rest' || c.spot || c.claimedBy) continue;
      if (!best || Math.abs(c.x - r.x) < Math.abs(best.x - r.x)) best = c;
    }
    if (best) { r.target = best; best.claimedBy = r.id; }
  }

  for (const r of roombas.values()) updateRoomba(r, dt);
  for (const c of clutter) updateClutter(c, dt);
  for (let i = clutter.length - 1; i >= 0; i--) if (clutter[i].gone) clutter.splice(i, 1);

  for (const p of particles) { p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  for (const f of floaters) { f.life -= dt; f.y -= dt * 10; }
  for (let i = floaters.length - 1; i >= 0; i--) if (floaters[i].life <= 0) floaters.splice(i, 1);
}

function updateRoomba(r, dt) {
  r.blink -= dt;
  if (r.blink < 0) r.blink = rand(2.5, 6);
  const status = r.agent.status;
  if (r.mode === 'beam-in' || r.mode === 'beam-out' || (r.leaving && r.mode === 'floor')) { updateBeam(r, dt); return; }

  if (dragging && dragging.obj === r && dragging.moved) {
    if (r.mode !== 'held') { r.mode = 'held'; Sfx.pickup(); if (pinned === r) hideTip(); }
    r.x = clamp(pointer.x, RX0 + 7, RX1 - 7);
    r.y = clamp(pointer.y + 5, CEIL + 7, BOTTOM);
    r.wheel += dt * 30;
    return;
  }

  // Let dragging and lifecycle transitions work, but pause the selected
  // roomba's physics, celebration, and reminders until its card closes.
  if (pinned === r) return;
  nagRoomba(r, dt);

  if (r.mode === 'air') {
    const prevY = r.y;
    r.vy += GRAVITY * dt;
    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.wheel += dt * 20;
    if (r.x < RX0 + 7) { r.x = RX0 + 7; r.vx = -r.vx * 0.6; Sfx.bonk(); }
    if (r.x > RX1 - 7) { r.x = RX1 - 7; r.vx = -r.vx * 0.6; Sfx.bonk(); }
    if (r.y < CEIL + 7) {
      r.y = CEIL + 7;
      if (r.vy < -120) { // splat onto the ceiling and stay there
        r.mode = 'ceiling'; r.ceilT = rand(20, 50); r.vx = 0; r.vy = 0; Sfx.stickCeiling();
        floater('WHEE', r.x, CEIL + 16, '#8338ec');
        return;
      }
      r.vy = Math.abs(r.vy) * 0.3;
    }
    // falling onto a piece of furniture? hop on and start scrubbing
    if (r.vy > 0) {
      for (const f of FURNITURE) {
        if (r.x < f.sx0 + 3 || r.x > f.sx1 - 3 || prevY > f.top || r.y < f.top) continue;
        r.y = f.top;
        if (r.vy > 170) { r.vy = -r.vy * 0.3; Sfx.bonk(); break; }
        perchOn(r, f);
        return;
      }
    }
    const land = r.landD || r.d;
    if (r.y >= land && r.vy > 0) {
      r.y = land;
      if (r.vy > 110) {
        r.vy = -r.vy * 0.35; r.vx *= 0.7; Sfx.bonk();
        for (let i = 0; i < 4; i++) dust(r.x, land);
        if (r.hat && r.vy < -60) { dropHat(r); }
      } else {
        r.mode = 'floor'; r.d = land; r.landD = null; r.vx = 0; r.vy = 0; r.goalX = null; r.pause = 0.6;
      }
    }
    return;
  }

  if (r.mode === 'perch') { updatePerch(r, dt); return; }

  if (r.mode === 'ceiling') {
    r.ceilT -= dt;
    r.wheel += dt * 6;
    if (!r.goalX || Math.abs(r.goalX - r.x) < 1) r.goalX = rand(RX0 + 12, RX1 - 12);
    const sp = status === 'stuck' || status === 'waiting' ? 0 : 10;
    r.dir = r.goalX > r.x ? 1 : -1;
    r.x += r.dir * sp * dt;
    if (r.ceilT <= 0) { r.mode = 'air'; r.vy = 0; r.vx = 0; r.landD = r.d; floater('OOPS', r.x, CEIL + 16, '#e63946'); Sfx.squeak(); }
    return;
  }

  // ---- floor behaviour ----
  if (r.hopV || r.hop > 0) {
    r.hop += r.hopV * dt;
    r.hopV -= GRAVITY * dt;
    if (r.hop <= 0) { r.hop = 0; r.hopV = 0; }
  }

  let speed = 0;
  if (r.target) {
    const c = r.target;
    if (c.mode !== 'rest' || c.gone) { r.target = null; }
    else {
      r.goalX = c.x; r.goalD = c.restY;
      speed = 22;
      if (Math.abs(r.x - c.x) < 2 && Math.abs(r.d - c.restY) < 2) {
        c.mode = 'dying'; c.dieT = 0.35; Sfx.slurp(); r.target = null; r.hopV = 40; markRoomDirty();
      }
    }
  } else if (status === 'working') {
    r.pause -= dt;
    if (r.pause <= 0 && (r.goalX === null || (Math.abs(r.goalX - r.x) < 1 && Math.abs(r.goalD - r.d) < 1))) {
      r.goalX = rand(RX0 + 10, RX1 - 10); r.goalD = rand(FLOOR_BACK + 2, FLOOR_FRONT); r.pause = rand(0.3, 2);
    }
    if (r.pause <= 0) speed = 14;
  } else if (status === 'stuck') {
    if (r.stuckX === null) r.stuckX = r.x < W / 2 ? RX0 + 9 : STATION.x - 12;
    r.goalX = r.stuckX; r.goalD = FLOOR_FRONT - 2; speed = 18;
    if (Math.abs(r.x - r.stuckX) < 1) { speed = 0; r.wheel += dt * 25; if (Math.random() < dt * 6) dust(r.x - r.dir * 6, r.d); }
  } else if (status === 'waiting') {
    speed = 0;
    if (Math.random() < dt * 0.5) r.hopV = 45;
  } else if (status === 'done') {
    r.spin -= dt;
    if (r.spin <= 0) { r.dir = -r.dir; r.spin = rand(0.4, 1.4); if (Math.random() < 0.35) r.hopV = 55; }
    if (Math.random() < dt * 1.5) particles.push({ x: r.x + rand(-7, 7), y: r.d - rand(4, 10), vx: 0, vy: -8, life: 0.5, c: '#fff6a8', g: 0 });
  } else { // idle -> go nap at the dock
    const idleOnes = [...roombas.values()].filter((o) => o.agent.status === 'idle');
    const i = idleOnes.indexOf(r);
    r.goalX = clamp(room.dockX + (i % 2 ? 1 : -1) * 15 * Math.ceil(i / 2), RX0 + 10, STATION.x - 10);
    r.goalD = FLOOR_BACK + 1;
    speed = 12;
    if (Math.abs(r.goalX - r.x) < 1) {
      speed = 0;
      r.zT -= dt;
      if (r.zT <= 0) { r.zT = 1.6; floaters.push({ text: 'Z', x: r.x + 4, y: r.d - 10, c: '#8d8497', life: 1.4 }); }
    }
  }

  if (speed > 0 && r.goalX !== null) {
    const dx = r.goalX - r.x;
    const dd = (r.goalD ?? r.d) - r.d;
    const dist = Math.hypot(dx, dd);
    if (dist > 0.5) {
      const step = Math.min(dist, speed * dt);
      r.x += (dx / dist) * step;
      r.d += (dd / dist) * step;
      if (Math.abs(dx) > 0.5) r.dir = dx > 0 ? 1 : -1;
      r.wheel += dt * 12;
      r.dustT -= dt;
      if (r.dustT <= 0 && cleanliness < 0.7) { r.dustT = 0.25; dust(r.x - r.dir * 7, r.d); }
      // working roombas visibly suck up dust in front of them
      if (status === 'working' && Math.random() < dt * 14) {
        particles.push({ x: r.x + r.dir * rand(10, 16), y: r.d - rand(0, 3), vx: -r.dir * 30, vy: rand(-3, 3), life: 0.28, c: pick(['#d8cfc4', '#bfb5a8', '#ffffff']), g: 0 });
      }
    }
  }
  r.x = clamp(r.x, RX0 + 7, RX1 - 7);
  r.d = clamp(r.d, FLOOR_BACK, FLOOR_FRONT);
}

// ---------- furniture cleaning ----------
const SCRUB_RATE = { working: 0.07, done: 0.045, idle: 0.03, waiting: 0.015, stuck: 0 };

function perchOn(r, f) {
  r.mode = 'perch'; r.perch = f; r.y = f.top; r.vx = 0; r.vy = 0; r.hop = 0; r.hopV = 0;
  r.goalX = null; r.target = null; r.leaveT = f.dirt > 0.02 ? null : 4;
  Sfx.drop();
  if (f.dirt > 0.02) floater(f.dirt >= WRECKED ? 'FIXING' : 'SCRUB', r.x, f.top - 14, '#3a86ff');
}

function hopOff(r) {
  const f = r.perch;
  r.perch = null; r.mode = 'air';
  const mid = (f.sx0 + f.sx1) / 2;
  r.vx = (mid < W / 2 ? 1 : -1) * rand(25, 45); r.vy = -90;
  r.landD = rand(FLOOR_BACK + 2, FLOOR_FRONT);
  Sfx.squeak();
}

function updatePerch(r, dt) {
  const f = r.perch;
  const status = r.agent.status;
  r.y = f.top;
  if (r.hopV || r.hop > 0) { r.hop += r.hopV * dt; r.hopV -= GRAVITY * dt; if (r.hop <= 0) { r.hop = 0; r.hopV = 0; } }

  // drive back and forth across the surface
  const lo = f.sx0 + 7; const hi = f.sx1 - 7;
  if (status !== 'stuck' && hi > lo) {
    if (r.goalX === null || Math.abs(r.goalX - r.x) < 0.5) r.goalX = r.x < (lo + hi) / 2 ? hi : lo;
    const sp = status === 'working' ? 12 : 7;
    r.dir = r.goalX > r.x ? 1 : -1;
    r.x += r.dir * Math.min(Math.abs(r.goalX - r.x), sp * dt);
    r.wheel += dt * 10;
  } else {
    r.x = clamp(r.x, Math.min(lo, hi), Math.max(lo, hi));
    if (status === 'stuck') r.wheel += dt * 25;
  }

  // gobble any junk lying on this piece
  for (const c of clutter) {
    if (c.mode === 'rest' && c.spot && c.spot.furn === f && Math.abs(c.x - r.x) < 3) {
      c.mode = 'dying'; c.dieT = 0.35; Sfx.slurp(); r.hopV = 35;
    }
  }

  const rate = SCRUB_RATE[status] || 0;
  if (f.dirt > 0 && rate > 0) {
    const before = f.dirt;
    f.dirt = Math.max(0, f.dirt - rate * dt);
    markRoomDirty();
    if (Math.random() < dt * 10) {
      particles.push({ x: r.x - r.dir * 7 + rand(-1, 1), y: f.top - rand(0, 3), vx: rand(-10, 10), vy: rand(-25, -8), life: rand(0.3, 0.6), c: pick(['#bde0fe', '#ffffff', '#a2d2ff']), g: 60 });
      Sfx.scrub();
    }
    if (before >= WRECKED && f.dirt < WRECKED) { floater('FIXED!', (f.sx0 + f.sx1) / 2, f.top - 12, '#3a86ff'); Sfx.tidy(); }
    if (f.dirt === 0) {
      const [bx, by, bw, bh] = f.box;
      for (let i = 0; i < 14; i++) particles.push({ x: bx + rand(0, bw), y: by + rand(0, bh), vx: 0, vy: rand(-15, -5), life: rand(0.5, 1.1), c: pick(['#fff', '#fff6a8', '#bde0fe']), g: 0 });
      floater('SPARKLY!', (f.sx0 + f.sx1) / 2, f.top - 14, '#2a9d4b');
      Sfx.shine();
      r.hopV = 70;
      r.leaveT = 2.5;
    }
  } else if (r.leaveT === null) {
    r.leaveT = 6;
  }
  if (r.leaveT !== null && status !== 'stuck') {
    r.leaveT -= dt;
    if (r.leaveT <= 0) hopOff(r);
  }
}

function furnitureAt(x, y) {
  for (let i = FURNITURE.length - 1; i >= 0; i--) {
    const f = FURNITURE[i]; const [bx, by, bw, bh] = f.box;
    if (x >= bx && x < bx + bw && y >= by - 4 && y < by + bh) return f;
  }
  return null;
}

function dropHat(r) {
  const h = r.hat; r.hat = null;
  clutter.push({ id: nextId++, type: h.type, color: h.color, flip: h.flip, x: r.x, y: r.y - 8, restY: r.d, spot: null, mode: 'air', vx: rand(-40, 40), vy: -60, doomed: false });
}

function updateClutter(c, dt) {
  if (dragging && dragging.obj === c && dragging.moved) {
    if (c.mode !== 'held') { c.mode = 'held'; c.doomed = false; c.claimedBy = null; Sfx.pickup(); }
    c.x = clamp(pointer.x, RX0 + 4, RX1 - 4);
    c.y = clamp(pointer.y + 3, CEIL + 6, BOTTOM);
    return;
  }
  if (c.mode === 'air') {
    c.vy += GRAVITY * dt;
    c.x += (c.vx || 0) * dt;
    c.y += c.vy * dt;
    if (c.x < RX0 + 4) { c.x = RX0 + 4; c.vx = -c.vx * 0.5; }
    if (c.x > RX1 - 4) { c.x = RX1 - 4; c.vx = -c.vx * 0.5; }
    if (c.y < CEIL + 6) { c.y = CEIL + 6; c.vy = Math.abs(c.vy) * 0.2; }
    if (c.y >= c.restY && c.vy > 0) {
      c.y = c.restY;
      if (c.vy > 120) { c.vy = -c.vy * 0.3; c.vx *= 0.5; }
      else {
        c.mode = 'rest'; c.vy = 0; dust(c.x, c.y);
        if (c.announce) { for (let i = 0; i < 5; i++) dust(c.x + rand(-4, 4), c.y); floater('+MESS', c.x, c.y - 10, '#c77d00'); Sfx.drop(); c.announce = false; }
        c.freshUntil = time + 2.5;
      }
    }
  } else if (c.mode === 'dying') {
    c.dieT -= dt;
    if (c.intoBasket) { const k = c.intoBasket; c.x += (k.x + k.w / 2 - c.x) * Math.min(1, dt * 12); c.y += (k.y + 3 - c.y) * Math.min(1, dt * 12); }
    if (c.dieT <= 0) c.gone = true;
  }
}

// ---------- drawing: room ----------
function skyColors() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 7 && h < 17) return { top: '#6ec3ff', bottom: '#bfe7ff', night: false };
  if (h >= 17 && h < 20) return { top: '#ff8a5b', bottom: '#ffd29d', night: false };
  if (h >= 5 && h < 7) return { top: '#8fa6ff', bottom: '#ffc9a8', night: false };
  return { top: '#1b1f4b', bottom: '#3a3f7a', night: true };
}

function signGeom() {
  const label = signLabel();
  const w = Math.max(pixelTextWidth(label), ...roomList.map((entry) => pixelTextWidth(signLabel(entry.name)))) + 8;
  const x = Math.round(W / 2 - w / 2);
  return { label, x, w, lx: x - 9, rx: x + w + 2 };
}
function signLabel(name = room ? room.name : 'ROOMBAI') {
  const n = name.toUpperCase();
  return n.length > 22 ? n.slice(0, 21) + '.' : n;
}

function drawRoof() {
  rect(3, ROOF_Y, W - 6, CEIL - ROOF_Y, '#5b3a4a');
  rect(3, ROOF_Y, W - 6, 1, '#7d5266');
  for (let x = 6; x < W - 6; x += 8) rect(x, ROOF_Y + 2, 6, 1, '#6b4658');
  for (let x = 10; x < W - 6; x += 8) rect(x, ROOF_Y + 5, 6, 1, '#6b4658');
  drawSiren();
  drawMessGauge();
  drawRoofButtons();

  // the sign doubles as the room selector: < NAME >
  const g = signGeom();
  const alert = otherRoomsNeedYou();
  const hot = hoverSign === 'name' || !roomsEl.hidden;
  rect(g.x, ROOF_Y + 1, g.w, 8, hot ? '#3d2f4a' : '#2b2233');
  if (room && room.key === GARAGE) { rect(g.x + 2, ROOF_Y + 3, 2, 3, '#adb5bd'); }
  pixelText(ctx, g.label, g.x + Math.round((g.w - pixelTextWidth(g.label)) / 2), ROOF_Y + 2, '#ffd166');
  for (const [side, gx] of [['prev', g.lx], ['next', g.rx]]) {
    const blink = alert && Math.sin(time * 8) > 0;
    rect(gx, ROOF_Y + 1, 7, 8, hoverSign === side ? '#3d2f4a' : '#2b2233');
    pixelText(ctx, side === 'prev' ? '<' : '>', gx + 2, ROOF_Y + 2, blink ? '#ff4d5e' : '#ffd166');
  }
}

function drawRoom() {
  const c = cleanliness;
  const dirt = 1 - c;
  const th = room.theme;
  drawRoof();

  // wall
  const wall = mix(th.wall.dirty, th.wall.clean, c);
  const accent = mix(th.wall.accentDirty, th.wall.accent, c);
  rect(RX0, CEIL, RX1 - RX0, FLOOR_TOP - CEIL, wall);
  if (th.pattern === 'stripes') for (let x = RX0 + 3; x < RX1; x += 8) rect(x, CEIL, 3, FLOOR_TOP - CEIL, accent);
  else if (th.pattern === 'dots') for (let y = CEIL + 3; y < FLOOR_TOP - 4; y += 6) for (let x = RX0 + 3 + (y % 12 ? 3 : 0); x < RX1; x += 6) px(x, y, accent);
  else if (th.pattern === 'diamonds') for (let y = CEIL + 2; y < FLOOR_TOP - 4; y += 8) for (let x = RX0 + 2 + (y % 16 ? 4 : 0); x < RX1; x += 8) { px(x, y, accent); px(x - 1, y + 1, accent); px(x + 1, y + 1, accent); px(x, y + 2, accent); }
  else if (th.pattern === 'wainscot') { rect(RX0, 50, RX1 - RX0, FLOOR_TOP - 50, accent); rect(RX0, 50, RX1 - RX0, 1, mix(th.wall.accentDirty, '#ffffff', 0.4 * c)); for (let x = RX0 + 6; x < RX1; x += 12) rect(x, 52, 1, 15, mix(th.wall.dirty, th.wall.skirting, 0.4)); }
  else if (th.pattern === 'blocks') for (let y = CEIL + 5, row = 0; y < FLOOR_TOP; y += 6, row++) { rect(RX0, y, RX1 - RX0, 1, accent); for (let x = RX0 + (row % 2 ? 7 : 0); x < RX1; x += 14) rect(x, y - 5, 1, 5, accent); }
  const skirt = mix('#4a3a2e', th.wall.skirting, c);
  rect(RX0, FLOOR_TOP - 3, RX1 - RX0, 3, skirt);
  rect(RX0, FLOOR_TOP - 3, RX1 - RX0, 1, mix(skirt, '#ffffff', 0.2));
  ctx.globalAlpha = dirt * 0.8;
  for (const m of WALL_MARKS) { rect(m.x, m.y, 3 + Math.round(m.s * 4), 2, '#5a4a30'); px(m.x + 1, m.y + 2, '#5a4a30'); }
  ctx.globalAlpha = 1;

  // floor
  const fl = th.floor;
  const base = mix(fl.dirty, fl.clean, c);
  const line = mix(fl.lineDirty, fl.line, c);
  rect(RX0, FLOOR_TOP, RX1 - RX0, BOTTOM - FLOOR_TOP, base);
  if (fl.kind === 'wood') {
    for (let y = FLOOR_TOP + 4; y < BOTTOM; y += 5) rect(RX0, y, RX1 - RX0, 1, line);
    for (let y = FLOOR_TOP, row = 0; y < BOTTOM; y += 5, row++) for (let x = RX0 + (row % 2 ? 14 : 3); x < RX1; x += 26) rect(x, y, 1, 4, line);
  } else if (fl.kind === 'tiles') {
    for (let y = FLOOR_TOP, row = 0; y < BOTTOM; y += 6, row++) for (let x = RX0 + (row % 2 ? 6 : 0); x < RX1; x += 12) { ctx.globalAlpha = 0.35; rect(x, y, 6, 6, line); ctx.globalAlpha = 1; }
  } else if (fl.kind === 'carpet') {
    const r = seeded(5);
    for (let i = 0; i < 140; i++) px(RX0 + r() * (RX1 - RX0), FLOOR_TOP + r() * (BOTTOM - FLOOR_TOP), line);
  } else if (fl.kind === 'concrete') {
    for (let x = RX0 + 60; x < RX1; x += 90) rect(x, FLOOR_TOP, 1, BOTTOM - FLOOR_TOP, line);
    ctx.globalAlpha = 0.35 + dirt * 0.4;
    rect(230, 86, 18, 3, '#2b2a28'); rect(233, 85, 10, 1, '#2b2a28'); rect(120, 90, 8, 2, '#2b2a28'); // oil stains
    ctx.globalAlpha = 1;
  }
  if (th.rug) {
    const rg = th.rug;
    rect(rg.x, 80, rg.w, 12, mix('#5a4a4a', rg.a, c));
    rect(rg.x + 2, 82, rg.w - 4, 8, mix('#6a5a5a', rg.b, c));
    for (let x = rg.x + 4; x < rg.x + rg.w - 4; x += 4) px(x, 86, mix('#6a5a5a', rg.c, c));
  }
  ctx.globalAlpha = dirt * 0.7;
  for (const s of STAINS) { rect(s.x, s.y, s.w, 2, s.c); rect(s.x + 1, s.y - 1, s.w - 2, 1, s.c); }
  ctx.globalAlpha = 1;

  // wall pieces, the whiteboard, then furniture
  for (const p of room.pieces) p.shown += (p.dirt - p.shown) * 0.08;
  for (const p of room.pieces) if (p.spec.kind === 'wall') p.spec.draw(p);
  drawBoard();
  for (const p of room.pieces) if (p.spec.kind !== 'wall') p.spec.draw(p);
  drawTrash();

  if (th.garage) { // bare bulb swinging from the ceiling
    const sw = Math.round(Math.sin(time * 0.8) * 2);
    rect(160 + sw, CEIL, 1, 6, '#2b2233'); rect(159 + sw, CEIL + 6, 3, 3, skyColors().night ? '#fff3a3' : '#e9e1c0');
  }

  if (c < 0.4) {
    ctx.globalAlpha = (0.4 - c) * 2;
    const web = '#e8e8e8';
    for (let i = 0; i < 6; i++) { px(RX0 + i, CEIL + i, web); px(RX0 + i, CEIL, web); px(RX0, CEIL + i, web); }
    for (let i = 0; i < 6; i++) { px(RX1 - 1 - i, CEIL + i, web); px(RX1 - 1 - i, CEIL, web); px(RX1 - 1, CEIL + i, web); }
    px(RX0 + 3, CEIL + 1, web); px(RX0 + 1, CEIL + 3, web);
    ctx.globalAlpha = 1;
    const sy = CEIL + 8 + Math.round(Math.sin(time * 1.3) * 3);
    rect(RX1 - 4, CEIL, 1, sy - CEIL, '#ddd');
    rect(RX1 - 5, sy, 3, 2, '#222');
  }
}

// ---------- the three-sided whiteboard: TODO, ISSUES, PRS ----------
const FACES = ['TODO', 'ISSUES', 'PRS'];
let boardFace = 0;
let spin = null; // { t, from, to } while it's turning
const CRANK = { x: BOARD.x + BOARD.w + 1, y: BOARD.y + 11, w: 5, h: 12 };
const boardCanvas = document.createElement('canvas');
boardCanvas.width = BOARD.w + 2;
boardCanvas.height = BOARD.h + 3;
const bctx = boardCanvas.getContext('2d');

function spinBoard(dir = 1) {
  if (spin) return;
  spin = { t: 0, from: boardFace, to: (boardFace + dir + FACES.length) % FACES.length };
  hideTodoCard(); closeTodoPop();
  Sfx.spin();
  if (spin.to !== 0) requestGh(false);
}

function updateSpin(dt) {
  if (!spin) return;
  spin.t += dt * 2.2;
  if (spin.t >= 0.5 && boardFace !== spin.to) boardFace = spin.to;
  if (spin.t >= 1) spin = null;
}

function onCrank(x, y) { return x >= CRANK.x - 1 && x <= CRANK.x + CRANK.w + 1 && y >= CRANK.y - 2 && y <= CRANK.y + CRANK.h + 2; }
function onFaceTitle(x, y) { return x >= BOARD.x + 2 && x <= BOARD.x + 36 && y >= BOARD.y + 1 && y <= BOARD.y + 7; }

function noteLayout(face = boardFace) {
  let items;
  if (face === 0) {
    items = [
      ...agents.filter((a) => a.status !== 'idle').map((a) => ({ agent: a })),
      ...roomTodos().filter((t) => !t.done || Date.now() - t.doneAt < 2500).map((t) => ({ todo: t })),
    ];
  } else {
    const gh = ghFor();
    const kind = face === 1 ? 'issues' : 'prs';
    items = [];
    for (const repo of gh.repos || []) for (const it of repo[kind] || []) items.push(face === 1 ? { issue: it, repo: repo.slug } : { pr: it, repo: repo.slug });
    items.sort((a, b) => String((b.issue || b.pr).updatedAt).localeCompare(String((a.issue || a.pr).updatedAt)));
  }
  const cols = 6; const rows = 3;
  items.forEach((n, i) => {
    if (i < cols * rows) {
      n.x = BOARD.x + 4 + (i % cols) * 10;
      n.y = BOARD.y + 9 + Math.floor(i / cols) * 8;
    } else if (face === 0) {
      // overflow: notes taped all over the wall — peak chaos
      const r = seeded(i * 31 + 5);
      n.x = RX0 + 4 + Math.floor(r() * 210);
      n.y = CEIL + 3 + Math.floor(r() * 38);
    } else {
      n.hidden = true; // GitHub overflow is summarized as "+N" instead
    }
  });
  return items.filter((n) => !n.hidden);
}

function drawBoard() {
  const { x, y, w, h } = BOARD;
  // the board turns on a post
  rect(x + w / 2 - 1, y - 3, 3, h + 8, '#5c616b');
  rect(x + w / 2 - 2, y + h + 4, 5, 2, '#495057');
  // crank handle on the side
  const turning = spin ? Math.floor(spin.t * 8) % 2 : 0;
  rect(CRANK.x, CRANK.y + 5, 3, 2, '#6c757d');
  rect(CRANK.x + 2, CRANK.y + (turning ? 8 : 1), 2, 5, hoverCrank ? '#3a86ff' : '#495057');
  rect(CRANK.x + 1, CRANK.y + (turning ? 12 : 0), 4, 2, hoverCrank ? '#bde0fe' : '#e63946');

  let face = boardFace; let k = 1;
  if (spin) { k = Math.abs(Math.cos(spin.t * Math.PI)); face = spin.t < 0.5 ? spin.from : spin.to; }
  const main = ctx;
  ctx = bctx;
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
  bctx.setTransform(1, 0, 0, 1, -(x - 1), -(y - 1));
  drawBoardFace(face);
  ctx = main;
  const fullW = w + 2;
  const dw = Math.max(2, Math.round(fullW * k));
  const dx = Math.round(x - 1 + (fullW - dw) / 2);
  ctx.imageSmoothingEnabled = false;
  if (k < 0.12) { rect(dx, y - 1, dw, h + 3, '#6c757d'); return; } // edge-on
  ctx.drawImage(boardCanvas, dx, y - 1, dw, h + 3);
  if (spin) { ctx.globalAlpha = (1 - k) * 0.45; rect(dx, y - 1, dw, h + 3, '#1d1a26'); ctx.globalAlpha = 1; }
}

function drawBoardFace(face) {
  const { x, y, w, h } = BOARD;
  const tint = ['#f7f7f2', '#fbf3f5', '#f2f8f4'][face];
  rect(x - 1, y - 1, w + 2, h + 2, '#8d99ae');
  rect(x, y, w, h, tint);
  rect(x, y + h, w, 2, '#6c757d');
  // face dots on the tray
  for (let i = 0; i < 3; i++) rect(x + w / 2 - 5 + i * 4, y + h, 2, 1, i === face ? '#ffd166' : '#adb5bd');

  const title = FACES[face];
  const tw = pixelTextWidth(title);
  pixelText(ctx, title, x + 3, y + 2, hoverFaceTitle ? '#3a86ff' : '#1d3557');
  if (face === 0) {
    px(x + 6, y + h - 1, '#e63946'); rect(x + 9, y + h - 1, 4, 1, '#1d3557');
    const open = agents.filter((a) => a.status !== 'idle' && a.status !== 'done').length + openTodos().length;
    pixelText(ctx, String(open), x + tw + 7, y + 2, open > 4 ? '#e63946' : '#2a9d4b');
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < Math.min(open, 6); i++) rect(x + 31 + (i % 3) * 7, y + 3 + Math.floor(i / 3) * 3, 5, 1, i % 3 ? '#457b9d' : '#e63946');
    ctx.globalAlpha = 1;
    const hot = hoverPlus || !todoPopEl.hidden;
    rect(PLUS.x - 1, PLUS.y - 1, PLUS.w + 2, PLUS.h + 2, hot ? '#3a86ff' : '#1d3557');
    rect(PLUS.x, PLUS.y, PLUS.w, PLUS.h, hot ? '#bde0fe' : '#ffd166');
    pixelText(ctx, '+', PLUS.x + 2, PLUS.y + 1, '#1d3557');
    if (!agents.length && !openTodos().length) pixelText(ctx, 'ALL QUIET', x + 14, y + 18, '#b8b3c4');
  } else {
    const gh = ghFor();
    const all = (gh.repos || []).reduce((t, r) => t + (r[face === 1 ? 'issues' : 'prs'] || []).length, 0);
    if (gh.state === 'ok') {
      pixelText(ctx, String(all), x + tw + 7, y + 2, all > 9 ? '#e63946' : all ? '#e09f1f' : '#2a9d4b');
      if (all > 18) pixelText(ctx, '+' + (all - 18), x + w - 14, y + 2, '#8d8497');
    }
    const msg = gh.loading && gh.state !== 'ok' ? 'LOADING...'
      : { 'no-repo': 'NO GITHUB REPO', missing: 'INSTALL GH CLI', 'logged-out': 'GH LOGIN NEEDED', error: 'GITHUB ERROR' }[gh.state]
        || (gh.state === 'ok' && !all ? (face === 1 ? 'NO OPEN ISSUES' : 'NO OPEN PRS') : '');
    if (msg) pixelText(ctx, msg, x + w / 2 - pixelTextWidth(msg) / 2, y + 17, '#b8b3c4');
    if (gh.loading) px(x + w - 3, y + 3, Math.sin(time * 10) > 0 ? '#3a86ff' : tint);
  }

  for (const n of noteLayout(face)) {
    if (dragging && dragging.kind === 'note' && dragging.obj === n.todo && dragging.moved) {
      ctx.globalAlpha = 0.15; rect(n.x, n.y, 9, 7, '#000'); ctx.globalAlpha = 1;
      continue;
    }
    if (n.todo) drawTodoNote(n.todo, n.x, n.y, hoverTodo === n.todo || pinnedTodo === n.todo);
    else if (n.agent) drawAgentNote(n.agent, n.x, n.y);
    else if (n.issue) drawIssueNote(n.issue, n.x, n.y, hoverGh === n.issue || pinnedGh === n.issue);
    else drawPrNote(n.pr, n.x, n.y, hoverGh === n.pr || pinnedGh === n.pr);
  }
}

function drawAgentNote(a, x, y) {
  const s = a.status;
  let nx = x; let ny = y;
  if (s === 'stuck') nx += Math.round(Math.sin(time * 18));
  if (s === 'waiting' && Math.sin(time * 5) > 0.7) ny -= 1;
  rect(nx, ny, 9, 7, NOTE[s] || '#ffe66d');
  rect(nx, ny + 7, 9, 1, '#0002');
  rect(nx + 3, ny - 1, 3, 1, '#ffffffaa');
  rect(nx + 1, ny + 1, 2, 1, agentColors(a).shade);
  rect(nx + 3, ny + 2, 5, 1, '#0004'); rect(nx + 1, ny + 4, 6, 1, '#0004');
  if (s === 'done') rect(nx + 1, ny + 3, 7, 1, '#2a9d4b');
  if (hoverRoomba && hoverRoomba.id === a.id) outline(nx, ny, '#3a86ff');
}

function drawIssueNote(it, x, y, hot) {
  rect(x, y, 9, 7, '#ffe3ea');
  rect(x, y + 7, 9, 1, '#0002');
  rect(x, y, 9, 2, it.labels.length ? it.labels[0].color : '#f28482'); // first label's color
  rect(x + 1, y + 3, 6, 1, '#0004'); rect(x + 1, y + 5, 4, 1, '#0004');
  if (it.comments) px(x + 7, y + 5, '#457b9d');
  if (hot) outline(x, y, '#e63946');
}

function drawPrNote(pr, x, y, hot) {
  rect(x, y, 9, 7, pr.draft ? '#e5e5e5' : '#d8f3dc');
  rect(x, y + 7, 9, 1, '#0002');
  // branch-merge glyph
  const g = pr.draft ? '#8d8497' : '#2d6a4f';
  px(x + 2, y + 1, g); px(x + 2, y + 2, g); px(x + 2, y + 3, g); px(x + 2, y + 4, g); px(x + 2, y + 5, g);
  px(x + 5, y + 1, g); px(x + 4, y + 2, g); px(x + 3, y + 3, g);
  const ci = { pass: '#2a9d4b', fail: '#e63946', pending: '#ffb703', none: '#adb5bd' }[pr.ci];
  const blink = (pr.ci === 'fail' || pr.ci === 'pending') && Math.sin(time * 6) < 0;
  rect(x + 6, y + 1, 2, 2, blink ? '#fff' : ci); // CI light
  if (pr.review === 'APPROVED') { px(x + 5, y + 5, '#2a9d4b'); px(x + 6, y + 6, '#2a9d4b'); px(x + 7, y + 5, '#2a9d4b'); px(x + 8, y + 4, '#2a9d4b'); }
  else if (pr.review === 'CHANGES_REQUESTED') { px(x + 6, y + 4, '#e63946'); px(x + 8, y + 4, '#e63946'); px(x + 7, y + 5, '#e63946'); px(x + 6, y + 6, '#e63946'); px(x + 8, y + 6, '#e63946'); }
  if (hot) outline(x, y, '#2a9d4b');
}

// ---------- GitHub data for the room on screen ----------
const ghData = new Map(); // room key -> { state, repos, at, loading }
let hoverGh = null;
let pinnedGh = null;

function roomCwds() {
  const isPath = (k) => /^[a-z]:\//.test(k) || k.startsWith('/');
  if (room.key !== GARAGE) return isPath(room.key) ? [room.key] : [];
  return roomList.map((e) => e.key).filter(isPath);
}

function ghFor() { return (room && ghData.get(room.key)) || { state: 'loading', repos: [], loading: true }; }

async function requestGh(force) {
  if (!room || !window.bridge) return;
  const key = room.key;
  const cur = ghData.get(key);
  if (cur && cur.loading) return;
  if (cur && !force && Date.now() - cur.at < 3 * 60e3) return;
  ghData.set(key, { ...(cur || { state: 'loading', repos: [] }), loading: true });
  const cwds = roomCwds();
  let res;
  try { res = cwds.length ? await window.bridge.github(cwds, force) : { state: 'no-repo', repos: [] }; } catch { res = { state: 'error', repos: [] }; }
  if (res.state === 'ok' && res.repos.length && res.repos.every((r) => r.error)) res.state = 'error';
  ghData.set(key, { ...res, at: Date.now(), loading: false });
}
setInterval(() => { if (boardFace !== 0) requestGh(false); }, 60e3);

function showGhCard(n, pin) {
  const it = n.issue || n.pr;
  if (pin) { pinnedGh = it; pinnedGhNote = n; }
  $('tcard-status').textContent = n.issue ? 'issue #' + it.number : (it.draft ? 'draft PR #' : 'PR #') + it.number;
  $('tcard-status').className = 'chip ' + (n.issue ? 'issue' : 'pr');
  $('tcard-meta').textContent = [n.repo, it.author, 'updated ' + ago(Date.parse(it.updatedAt)) + ' ago'].filter(Boolean).join(' · ');
  $('tcard-text').textContent = it.title;
  const bits = n.issue
    ? [it.labels.map((l) => l.name).join(', '), it.comments ? it.comments + ' comments' : '']
    : [{ pass: 'checks passing ✓', fail: 'checks failing ✗', pending: 'checks running…', none: 'no checks' }[it.ci], { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review needed' }[it.review] || '', it.branch];
  $('tcard-hint').textContent = bits.filter(Boolean).join(' · ');
  $('tcard-done').hidden = true; $('tcard-del').hidden = true; $('tcard-open').hidden = false;
  $('tcard-foot').style.display = pin ? 'flex' : 'none';
  tcardEl.hidden = false;
  tcardEl.style.left = clamp(n.x * scale - 20, 4, W * scale - tcardEl.offsetWidth - 4) + 'px';
  tcardEl.style.top = clamp((n.y + 10) * scale, 2, H * scale - tcardEl.offsetHeight - 2) + 'px';
}
let pinnedGhNote = null;
$('tcard-open').addEventListener('click', () => { if (pinnedGh) window.bridge.openUrl(pinnedGh.url); hideTodoCard(); });

function drawTodoNote(t, x, y, hot) {
  rect(x, y, 9, 7, t.done ? '#c8f7c5' : '#fdfdf6');
  rect(x, y + 7, 9, 1, '#0002');
  rect(x + 1, y + 2, 7, 1, '#bcd4f0'); rect(x + 1, y + 4, 7, 1, '#bcd4f0');
  rect(x + 1, y + 2, Math.min(7, 2 + (t.text.length % 6)), 1, '#1d3557'); // handwriting
  rect(x + 1, y + 4, Math.min(7, 1 + (t.text.length % 5)), 1, '#1d3557');
  px(x + 4, y, '#e63946'); // pin
  if (t.done) { const c = '#2a9d4b'; px(x + 2, y + 3, c); px(x + 3, y + 4, c); px(x + 4, y + 3, c); px(x + 5, y + 2, c); px(x + 6, y + 1, c); }
  if (hot) outline(x, y, '#7b6cf6');
}

function outline(x, y, c) {
  rect(x - 1, y - 1, 11, 1, c); rect(x - 1, y + 8, 11, 1, c); rect(x - 1, y, 1, 8, c); rect(x + 9, y, 1, 8, c);
}

function drawTrash() {
  const { x, y, w, h } = TRASH;
  rect(x, y, w, h, '#6c757d'); rect(x - 1, y - 1, w + 2, 2, '#495057');
  for (let i = 1; i < w; i += 3) rect(x + i, y + 2, 1, h - 3, '#5a6268');
  const full = 1 - cleanliness;
  if (full > 0.3) { rect(x + 1, y - 3, 3, 2, '#f1f1f1'); px(x + 5, y - 2, '#f5d547'); }
  if (full > 0.6) { rect(x + 3, y - 5, 3, 2, '#c9a26b'); px(x + 7, y - 3, '#e63946'); }
  if (dragging && dragging.kind === 'clutter' && Math.floor(time * 2) % 2 === 0) rect(x - 1, y - 3, w + 2, 1, '#2a9d4b');
}

function drawBasket() {
  const b = BASKET;
  rect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, '#4a3020');
  rect(b.x, b.y, b.w, b.h, '#e0bf7a');
  for (let i = 0; i < b.h; i += 2) rect(b.x, b.y + i, b.w, 1, '#b8904f');
  for (let i = 1; i < b.w; i += 3) rect(b.x + i, b.y, 1, b.h, '#b8904f');
  rect(b.x - 2, b.y - 1, b.w + 4, 2, '#8c6a3a');
  if (cleanliness < 0.5) { px(b.x + 3, b.y - 2, '#e63946'); px(b.x + 4, b.y - 3, '#e63946'); }
  if (Math.floor(time * 2) % 2 === 0 && dragging && dragging.kind === 'clutter') rect(b.x - 1, b.y - 3, b.w + 2, 1, '#2a9d4b');
}

// dirt meter + outline so you know where to drop a roomba
function furnitureHints() {
  const carrying = dragging && dragging.kind === 'roomba' && dragging.moved;
  for (const f of FURNITURE) {
    const perched = [...roombas.values()].some((r) => r.mode === 'perch' && r.perch === f);
    const hovered = hoverFurn === f;
    if (!(carrying || perched || hovered) || f.dirt <= 0.01) continue;
    const cx = Math.round((f.sx0 + f.sx1) / 2);
    const y = perched ? f.top + 2 : f.top - 5;
    rect(cx - 7, y, 14, 3, '#2b2233');
    rect(cx - 6, y + 1, Math.max(1, Math.round(12 * (1 - f.dirt))), 1, f.dirt >= WRECKED ? '#e63946' : f.dirt > 0.33 ? '#ffd166' : '#7dff8a');
    if (carrying && Math.sin(time * 8) > 0) {
      const [bx, by, bw] = f.box;
      rect(bx, by - 1, bw, 1, '#6ff3ff');
    }
    if (hovered && !carrying) {
      const label = f.name + (f.dirt >= WRECKED ? ' WRECKED' : f.dirt > 0.33 ? ' GROSS' : ' DUSTY');
      const w = pixelTextWidth(label);
      const lx = clamp(cx - w / 2, RX0 + 1, RX1 - w - 1);
      rect(lx - 2, y - 8, w + 4, 7, '#2b2233');
      pixelText(ctx, label, lx, y - 7, '#ffd166');
    }
  }
}

// ---------- the recharge station: where shooed roombas go ----------
let stationOpen = 0;
function drawStation() {
  const { x, w } = STATION;
  const busy = [...roombas.values()].some((r) => r.mode === 'beam-in' || r.mode === 'beam-out' || (r.leaving && Math.abs(r.x - (x + w / 2)) < 24));
  stationOpen += ((busy ? 1 : 0) - stationOpen) * 0.12;
  // pod shell
  rect(x + 2, 36, w - 4, 2, '#5c616b');
  rect(x, 38, w, 32, '#8d99ae');
  rect(x + 1, 38, w - 2, 1, '#c3cad4');
  rect(x, 68, w, 2, '#5c616b');
  // lightning sign
  rect(x + 9, 30, 10, 7, '#2b2233');
  const bolt = stationOpen > 0.2 || Math.sin(time * 2) > 0 ? '#ffd166' : '#8a6d1f';
  px(x + 14, 31, bolt); px(x + 13, 32, bolt); px(x + 12, 33, bolt); px(x + 13, 33, bolt); px(x + 14, 33, bolt); px(x + 15, 33, bolt); px(x + 14, 34, bolt); px(x + 13, 35, bolt);
  // doorway, glowing when open
  const dx = x + 5; const dw = w - 10;
  rect(dx, 42, dw, 28, '#1d1a26');
  if (stationOpen > 0.05) {
    ctx.globalAlpha = stationOpen * 0.8;
    rect(dx + 1, 43, dw - 2, 27, '#6ff3ff');
    ctx.globalAlpha = 1;
  }
  const half = Math.round((dw / 2) * (1 - stationOpen));
  rect(dx, 42, half, 28, '#adb5bd'); rect(dx + dw - half, 42, half, 28, '#adb5bd');
  if (half > 1) { rect(dx + half - 1, 42, 1, 28, '#6c757d'); rect(dx + dw - half, 42, 1, 28, '#6c757d'); }
  // status lights
  for (let i = 0; i < 3; i++) px(x + 2, 44 + i * 6, Math.sin(time * 3 + i) > 0 ? '#7dff8a' : '#2a9d4b');
  px(x + w - 3, 48, stationOpen > 0.2 ? '#ff4d5e' : '#5c616b');
}

function shoo(r) {
  if (r.leaving) return;
  r.leaving = true;
  r.target = null; r.hat = null;
  knownAgents.delete(r.id); // when it comes back it beams in again
  if (r.mode !== 'floor') { r.perch = null; r.mode = 'air'; r.vy = 0; r.vx = 0; r.landD = FLOOR_BACK + 2; }
  floater('BYE!', r.x, baseOf(r) - 14, '#8d8497');
  Sfx.squeak();
}

function updateBeam(r, dt) {
  const doorX = STATION.x + STATION.w / 2;
  if (r.mode === 'beam-in') {
    r.beamT += dt;
    if (Math.random() < dt * 30) particles.push({ x: r.x + rand(-6, 6), y: r.d - rand(0, 14), vx: 0, vy: -20, life: 0.4, c: pick(['#6ff3ff', '#ffffff']), g: 0 });
    if (r.beamT >= 0.9) {
      r.mode = 'floor'; r.goalX = doorX - rand(24, 70); r.goalD = rand(FLOOR_BACK + 4, FLOOR_FRONT); r.pause = 0;
      floater('HI!', r.x, r.d - 16, '#3a86ff');
    }
    return;
  }
  if (r.mode === 'beam-out') {
    r.beamT += dt;
    if (Math.random() < dt * 30) particles.push({ x: r.x + rand(-6, 6), y: r.d - rand(0, 14), vx: 0, vy: -25, life: 0.4, c: pick(['#6ff3ff', '#ffffff']), g: 0 });
    if (r.beamT >= 0.9) {
      roombas.delete(r.id);
      if (pinned === r) hideTip();
      window.bridge.hide(r.id);
    }
    return;
  }
  // leaving: drive to the pod's door, then beam out
  const dx = doorX - r.x; const dd = FLOOR_BACK + 2 - r.d;
  const dist = Math.hypot(dx, dd);
  if (dist < 1) { r.mode = 'beam-out'; r.beamT = 0; r.dir = 1; Sfx.beam(); return; }
  const step = Math.min(dist, 70 * dt);
  r.x += (dx / dist) * step; r.d += (dd / dist) * step;
  r.dir = dx > 0 ? 1 : -1; r.wheel += dt * 16;
}

// a roomba materializing (or dematerializing) in a column of light
function drawBeaming(r) {
  const t = clamp(r.beamT / 0.9, 0, 1);
  const shown = r.mode === 'beam-in' ? t : 1 - t;
  ctx.globalAlpha = 0.35 * Math.sin(t * Math.PI);
  rect(r.x - 7, CEIL, 14, r.d - CEIL, '#6ff3ff');
  ctx.globalAlpha = 1;
  const top = r.d - 12;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x - 10, top + 13 * (1 - shown), 20, 13 * shown + 1);
  ctx.clip();
  drawRoomba(r);
  ctx.restore();
}

// ---------- frame ----------
function drawFrame() {
  // outer border
  const nag = currentNag();
  const border = flash.t > 0 && Math.sin(flash.t * 20) > 0 ? flash.color : nag && Math.sin(time * 5) > 0 ? NAG_COLOR[nag.status] : '#2b2233';
  rect(3, CEIL - 1, 1, BOTTOM - CEIL + 3, border);
  rect(W - 4, CEIL - 1, 1, BOTTOM - CEIL + 3, border);
  rect(4, CEIL - 1, 3, BOTTOM - CEIL + 2, '#4a3544'); rect(RX1, CEIL - 1, 3, BOTTOM - CEIL + 2, '#4a3544');
  rect(3, BOTTOM, W - 6, 3, '#4a3544');
  rect(3, BOTTOM + 2, W - 6, 1, border);
  rect(3, ROOF_Y - 1, W - 6, 1, border);
  rect(2, ROOF_Y, 1, CEIL - ROOF_Y, border); rect(W - 3, ROOF_Y, 1, CEIL - ROOF_Y, border);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (!room) return;
  drawRoom();

  drawBasket();
  drawStation();
  // furniture clutter (not on floor)
  for (const c of clutter) if (c.spot && c.mode === 'rest') drawClutter(c.type, c.x, c.y, c.color, c.flip);
  // stink lines above old pizza when grim
  if (cleanliness < 0.45) {
    ctx.globalAlpha = 0.6;
    for (const c of clutter) {
      if (c.type !== 'pizza' && c.type !== 'banana') continue;
      for (let i = 0; i < 2; i++) { const sx = c.x - 2 + i * 4 + Math.round(Math.sin(time * 3 + i) * 1); px(sx, c.y - 6 - ((time * 6 + i * 3) % 6), '#9bbf6a'); }
    }
    ctx.globalAlpha = 1;
  }

  for (const r of roombas.values()) if (r.mode === 'perch') drawRoomba(r);

  // floor entities sorted by depth
  const floorThings = [];
  for (const c of clutter) {
    if (c.spot && c.mode === 'rest') continue;
    if (c.mode === 'held') continue;
    floorThings.push({ z: c.mode === 'air' ? c.restY : c.y, draw: () => {
      const a = c.mode === 'dying' ? Math.max(0, c.dieT / 0.35) : 1;
      drawClutter(c.type, c.x, c.y, c.color, c.flip, a);
      if (c.doomed && c.mode === 'rest' && Math.sin(time * 8) > 0) px(c.x, c.y - 8, '#6ff3ff');
      if (c.freshUntil > time && Math.sin(time * 12) > 0) { px(c.x, c.y - 9, '#ffd166'); px(c.x - 1, c.y - 10, '#ffd166'); px(c.x + 1, c.y - 10, '#ffd166'); } // new junk!
    } });
  }
  for (const r of roombas.values()) {
    if (r.mode === 'floor') floorThings.push({ z: r.d, draw: () => drawRoomba(r) });
    if (r.mode === 'beam-in' || r.mode === 'beam-out') floorThings.push({ z: r.d, draw: () => drawBeaming(r) });
  }
  floorThings.sort((a, b) => a.z - b.z);
  floorThings.forEach((t) => t.draw());

  for (const r of roombas.values()) if (r.mode === 'ceiling' || r.mode === 'air') drawRoomba(r);

  // flies around a messy room
  const flies = Math.round((1 - cleanliness) * 5);
  const anchors = clutter.filter((c) => c.mode === 'rest');
  for (let i = 0; i < flies && anchors.length; i++) {
    const a = anchors[(i * 3) % anchors.length];
    const fx = a.x + Math.sin(time * (5 + i) + i) * 6;
    const fy = a.y - 8 + Math.cos(time * (7 + i) + i * 2) * 3;
    px(fx, fy, '#111');
    if (Math.sin(time * 40 + i) > 0) px(fx - 1, fy - 1, '#ffffff99');
  }

  // sparkles in a clean room
  if (cleanliness > 0.8) {
    const r = seeded(Math.floor(time * 1.5));
    for (let i = 0; i < 3; i++) {
      const sx = RX0 + r() * (RX1 - RX0); const sy = CEIL + r() * (BOTTOM - CEIL);
      px(sx, sy, '#fff'); px(sx - 1, sy, '#fff8'); px(sx + 1, sy, '#fff8'); px(sx, sy - 1, '#fff8'); px(sx, sy + 1, '#fff8');
    }
  }

  drawFrame();
  furnitureHints();

  for (const p of particles) { ctx.globalAlpha = clamp(p.life * 2, 0, 1); px(p.x, p.y, p.c); }
  ctx.globalAlpha = 1;

  // held things float above everything
  for (const r of roombas.values()) if (r.mode === 'held') drawRoomba(r);
  for (const c of clutter) if (c.mode === 'held') drawClutter(c.type, c.x, c.y, c.color, c.flip);
  if (dragging && dragging.kind === 'note' && dragging.moved) drawTodoNote(dragging.obj, Math.round(pointer.x - 4), Math.round(pointer.y - 3), true);

  for (const r of roombas.values()) drawBubble(r);

  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1);
    const w = pixelTextWidth(f.text);
    pixelText(ctx, f.text, Math.round(f.x - w / 2) + 1, Math.round(f.y) + 1, '#0006');
    pixelText(ctx, f.text, Math.round(f.x - w / 2), Math.round(f.y), f.c);
  }
  ctx.globalAlpha = 1;

  // empty state
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  if (pinned) showTip(pinned, true);
  if (pinnedTodo) showTodoCard(pinnedTodo, true);
  else if (pinnedGh && pinnedGhNote) showGhCard(pinnedGhNote, true);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- wiring ----------
if (window.bridge) {
  window.bridge.onAgents((list) => { if (!room) { pendingAgents = list; return; } syncAgents(list); updateMess(); });
  window.bridge.onConfig(applyConfig);
  window.bridge.loadTodos().then((list) => { todos = Array.isArray(list) ? list.filter((t) => !t.done) : []; updateMess(); });
  window.bridge.onFocusAgent((id) => {
    const a = allAgents.find((k) => k.id === id);
    if (a && !belongsHere(a)) switchRoom(projectKeyOf(a));
    setTimeout(() => { const r = roombas.get(id); if (r) { showTip(r, true); r.hopV = 80; } }, 50);
  });
  bootRooms();
}


// ---------- rooms: switching, the selector, and remembering each room's mess ----------
const roomCache = new Map(); // key -> generated room with its live state
let roomSave = { selected: GARAGE, rooms: {} };
let roomList = [];
let pendingAgents = null;
let hoverSign = null;
let saveDirty = false;
const roomsEl = document.getElementById('rooms');

function belongsHere(a) { return room.key === GARAGE || projectKeyOf(a) === room.key; }
function markRoomDirty() { saveDirty = true; }

function snapshotRoom() {
  if (!room) return;
  room.messTarget = messTarget;
  room.cleanliness = cleanliness;
  roomSave.rooms[room.key] = {
    name: room.name,
    lastSeen: Date.now(),
    dirt: room.pieces.map((p) => Math.round(p.dirt * 1000) / 1000),
    messTarget,
    clutter: clutter.filter((c) => c.mode === 'rest').map((c) => ({
      type: c.type, color: c.color, flip: c.flip, x: Math.round(c.x), restY: Math.round(c.restY), spot: c.spot ? room.spots.indexOf(c.spot) : -1,
    })),
  };
}

function loadRoom(key, name) {
  let r = roomCache.get(key);
  if (r) return r;
  r = generateRoom(key, name || projectNameOf(key));
  r.spots = roomSpots(r);
  r.furniture = r.pieces.filter((p) => p.dirtable);
  const dock = r.pieces.find((p) => p.type === 'dock');
  r.dockX = dock ? dock.x + 7 : 150;
  r.clutter = [];
  r.messTarget = null;
  const saved = roomSave.rooms[key];
  if (saved) {
    (saved.dirt || []).forEach((d, i) => { if (r.pieces[i]) { r.pieces[i].dirt = d; r.pieces[i].shown = d; } });
    for (const c of saved.clutter || []) {
      const spot = c.spot >= 0 ? r.spots[c.spot] || null : null;
      r.clutter.push({ ...c, spot, id: nextId++, mode: 'rest', y: c.restY, vx: 0, vy: 0, doomed: false, dieT: 0 });
    }
    r.messTarget = typeof saved.messTarget === 'number' ? saved.messTarget : null;
  }
  const avg = r.furniture.length ? r.furniture.reduce((t, p) => t + p.dirt, 0) / r.furniture.length : 0;
  r.cleanliness = clamp(1 - r.clutter.length / 16 - avg * 0.7, 0, 1);
  roomCache.set(key, r);
  return r;
}

function enterRoom(key, name) {
  room = loadRoom(key, name);
  FURNITURE = room.furniture;
  clutter = room.clutter;
  messTarget = room.messTarget;
  cleanliness = room.cleanliness;
  reseedStains(key);
  if (boardFace !== 0) requestGh(false);
}

function reseedStains(key) {
  const r = seeded(hashStr(key + 'stains'));
  STAINS.length = 0; WALL_MARKS.length = 0;
  for (let i = 0; i < 9; i++) STAINS.push({ x: RX0 + 8 + r() * (RX1 - RX0 - 30), y: FLOOR_BACK + r() * 18, w: 4 + Math.floor(r() * 7), c: r() > 0.5 ? '#3d2b1a' : '#4a5a2a' });
  for (let i = 0; i < 6; i++) WALL_MARKS.push({ x: RX0 + 4 + r() * 300, y: CEIL + 6 + r() * 38, s: r() });
}

function switchRoom(key) {
  if (room && room.key === key) { closeRoomList(); return; }
  snapshotRoom();
  hideTip(); hideTodoCard(); closeTodoPop(); closeRoomList();
  const entry = roomList.find((k) => k.key === key);
  enterRoom(key, entry && entry.name);
  roombas.clear();
  particles.length = 0;
  floaters.length = 0;
  roomSave.selected = key;
  markRoomDirty();
  firstSync = true; // roombas are already home — they don't beam in
  syncAgents(allAgents);
  updateMess();
  flash = { t: 0.3, color: '#ffd166' };
  Sfx.whoosh();
}

function cycleRoom(dir) {
  if (!roomList.length) return;
  const i = Math.max(0, roomList.findIndex((k) => k.key === room.key));
  switchRoom(roomList[(i + dir + roomList.length) % roomList.length].key);
}

const needsYou = (a) => a.status === 'stuck' || a.status === 'waiting';
function otherRoomsNeedYou() {
  if (!room || room.key === GARAGE) return false;
  return allAgents.some((a) => needsYou(a) && projectKeyOf(a) !== room.key);
}

function refreshRoomList() {
  const map = new Map();
  map.set(GARAGE, { key: GARAGE, name: 'Garage', agents: allAgents, lastSeen: Infinity });
  const fresh = Date.now() - 14 * 86400e3;
  for (const [key, sv] of Object.entries(roomSave.rooms)) {
    if (key !== GARAGE && (sv.lastSeen || 0) > fresh) map.set(key, { key, name: sv.name || projectNameOf(key), agents: [], lastSeen: sv.lastSeen || 0 });
  }
  for (const a of allAgents) {
    const key = projectKeyOf(a);
    const e = map.get(key) || { key, name: projectNameOf(key, a.project), agents: [], lastSeen: 0 };
    e.name = projectNameOf(key, a.project);
    e.agents.push(a);
    e.lastSeen = Math.max(e.lastSeen, a.lastEventAt || 0);
    map.set(key, e);
  }
  const busy = (e) => e.agents.filter((a) => a.status !== 'idle').length;
  roomList = [...map.values()].sort((a, b) => (a.key === GARAGE ? -1 : b.key === GARAGE ? 1 : busy(b) - busy(a) || b.lastSeen - a.lastSeen));
  if (!roomsEl.hidden) renderRoomList();
}

function toggleRoomList() { if (roomsEl.hidden) openRoomList(); else closeRoomList(); }
function openRoomList() {
  hideTip(); hideTodoCard(); closeTodoPop();
  refreshRoomList();
  renderRoomList();
  roomsEl.hidden = false;
  roomsEl.style.left = clamp(W * scale / 2 - roomsEl.offsetWidth / 2, 4, W * scale - roomsEl.offsetWidth - 4) + 'px';
  roomsEl.style.top = (ROOF_Y + 10) * scale + 'px';
  Sfx.squeak();
}
function closeRoomList() { roomsEl.hidden = true; }

function renderRoomList() {
  const list = $('rooms-list');
  list.textContent = '';
  for (const e of roomList) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'room-row' + (room && e.key === room.key ? ' current' : '');
    const icon = document.createElement('span'); icon.className = 'room-icon'; icon.textContent = e.key === GARAGE ? '🚗' : '🏠';
    const name = document.createElement('span'); name.className = 'room-name'; name.textContent = e.name;
    const sub = document.createElement('span'); sub.className = 'room-sub';
    sub.textContent = e.key === GARAGE ? 'all projects' : e.agents.length ? `${e.agents.length} agent${e.agents.length > 1 ? 's' : ''}` : 'quiet';
    const dots = document.createElement('span'); dots.className = 'room-dots';
    for (const a of e.agents.slice(0, 8)) { const d = document.createElement('i'); d.className = 'dot ' + a.status; dots.append(d); }
    if (e.agents.some(needsYou)) { const b = document.createElement('b'); b.className = 'room-alert'; b.textContent = '!'; dots.append(b); }
    row.append(icon, name, sub, dots);
    row.addEventListener('click', () => switchRoom(e.key));
    list.append(row);
  }
}

async function bootRooms() {
  try {
    const sv = await window.bridge.loadRooms();
    if (sv && sv.rooms) roomSave = sv;
  } catch {}
  const key = roomSave.selected || GARAGE;
  enterRoom(key, (roomSave.rooms[key] || {}).name);
  if (pendingAgents) { syncAgents(pendingAgents); pendingAgents = null; }
  refreshRoomList();
  updateMess();
}

setInterval(() => {
  if (!saveDirty || !room || !window.bridge) return;
  snapshotRoom();
  window.bridge.saveRooms(roomSave);
  saveDirty = false;
}, 4000);
window.addEventListener('beforeunload', () => { if (room && window.bridge) { snapshotRoom(); window.bridge.saveRooms(roomSave); } });


// ---------- settings from main, the in-game menu, and rolling up ----------
let appCfg = { scale: 3, muted: false, onTop: true, collapsed: false, anchor: 'right', size: 3 };
let viewTop = 0; // rows of art hidden above the window while rolled up
const COLLAPSED_TOP = 9;
const menuEl = document.getElementById('menu');

function applyConfig(cfg) {
  appCfg = { ...appCfg, ...cfg };
  applyScale(cfg.scale);
  muted = cfg.muted;
  Sfx.setMuted(cfg.muted);
  viewTop = appCfg.collapsed ? COLLAPSED_TOP : 0;
  canvas.style.top = -viewTop * scale + 'px';
  if (appCfg.collapsed) { hideTip(); hideTodoCard(); closeTodoPop(); closeRoomList(); }
  syncMenu();
}

function syncMenu() {
  $('share-count-option').hidden = !appCfg.communityAvailable;
  $('opt-share-count').checked = Boolean(appCfg.shareCount);
  $('app-version').textContent = appCfg.version ? `v${appCfg.version}` : '';
  const update = appCfg.update || { state: 'disabled' };
  const available = ['available', 'downloading', 'ready'].includes(update.state);
  $('update-notice').hidden = !available && update.state !== 'error';
  $('update-message').textContent = update.state === 'error' ? 'Update failed' : "There's a new update";
  $('update-detail').textContent = update.state === 'ready' ? `v${update.version} · Installs and restarts Roombai.`
    : update.state === 'downloading' ? `Downloading v${update.version}…`
    : update.state === 'available' ? `v${update.version} · Download and replace this build.`
    : 'Check your connection and try again.';
  $('opt-update').textContent = update.state === 'downloading' ? 'Downloading…' : update.state === 'error' ? 'Retry' : update.automatic ? 'Install' : 'Download';
  $('opt-update').disabled = update.busy || update.state === 'downloading';
  $('opt-check-update').hidden = update.state === 'disabled' || available || update.state === 'error';
  $('opt-check-update').disabled = update.busy;
  $('opt-check-update').textContent = update.state === 'checking' ? 'Checking…' : update.state === 'current' ? 'Up to date' : 'Check for updates';
  $('opt-ontop').checked = appCfg.onTop;
  $('opt-sound').checked = !appCfg.muted;
  for (const b of document.querySelectorAll('#opt-size button')) b.classList.toggle('on', Number(b.dataset.v) === appCfg.size);
  for (const b of document.querySelectorAll('#opt-place button')) b.classList.toggle('on', b.dataset.v === appCfg.anchor);
  $('opt-roll').textContent = appCfg.collapsed ? 'Unroll' : 'Roll up';
  if (!menuEl.hidden) positionMenu();
}

function positionMenu() {
  // Reserve the roof controls; scroll the panel instead of moving it over them.
  const top = (ROOF_Y + 10 - viewTop) * scale;
  menuEl.style.maxHeight = Math.max(0, window.innerHeight - top - 4) + 'px';
  menuEl.style.left = Math.max(4, Math.min(W * scale - menuEl.offsetWidth - 8, window.innerWidth - menuEl.offsetWidth - 4)) + 'px';
  menuEl.style.top = top + 'px';
}
window.addEventListener('resize', () => { if (!menuEl.hidden) positionMenu(); });

function toggleMenu() {
  if (!menuEl.hidden) { menuEl.hidden = true; return; }
  if (appCfg.collapsed) window.bridge.setOption('collapsed', false);
  hideTip(); hideTodoCard(); closeTodoPop(); closeRoomList();
  syncMenu();
  menuEl.hidden = false;
  positionMenu();
  Sfx.squeak();
}

$('opt-ontop').addEventListener('change', (e) => window.bridge.setOption('onTop', e.target.checked));
$('opt-update').addEventListener('click', () => window.bridge.setOption('update', true));
$('opt-check-update').addEventListener('click', () => window.bridge.setOption('check-update', true));
$('opt-share-count').addEventListener('change', (e) => window.bridge.setOption('share-count', e.target.checked));
$('opt-sound').addEventListener('change', (e) => window.bridge.setOption('muted', !e.target.checked));
for (const b of document.querySelectorAll('#opt-size button')) b.addEventListener('click', () => window.bridge.setOption('scale', Number(b.dataset.v)));
for (const b of document.querySelectorAll('#opt-place button')) b.addEventListener('click', () => window.bridge.setOption('anchor', b.dataset.v));
$('opt-roll').addEventListener('click', () => { menuEl.hidden = true; window.bridge.setOption('collapsed', !appCfg.collapsed); });
$('opt-hide').addEventListener('click', () => { menuEl.hidden = true; window.bridge.setOption('hidden', true); });
$('opt-quit').addEventListener('click', () => window.bridge.setOption('quit', true));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') menuEl.hidden = true; });
canvas.addEventListener('mousedown', (e) => {
  const p = toInternal(e);
  if (!menuEl.hidden && roofButtonAt(p.x, p.y) !== 'menu') menuEl.hidden = true;
}, true);

// roof buttons live where the grip dots used to be, on the right end of the roof
const ROOF_BTNS = { roll: W - 26, menu: W - 15 };
function roofButtonAt(x, y) {
  if (['available', 'downloading', 'ready'].includes(appCfg.update?.state)) {
    const by = appCfg.collapsed ? ROOF_Y - 1 : ROOF_Y - 5;
    if (x >= ROOF_BTNS.menu + 4 && x < ROOF_BTNS.menu + 11 && y >= by && y < by + 7) return 'menu';
  }
  if (y < ROOF_Y + 1 || y > ROOF_Y + 9) return null;
  for (const [k, bx] of Object.entries(ROOF_BTNS)) if (x >= bx && x < bx + 9) return k;
  return null;
}

function drawRoofButtons() {
  const hover = roofButtonAt(pointer.x, pointer.y);
  for (const [k, bx] of Object.entries(ROOF_BTNS)) {
    const hot = hover === k || (k === 'menu' && !menuEl.hidden);
    rect(bx, ROOF_Y + 1, 9, 8, hot ? '#3d2f4a' : '#2b2233');
    const c = hot ? '#ffffff' : '#ffd166';
    if (k === 'roll') { // roll up / unroll arrow
      if (appCfg.collapsed) { px(bx + 4, ROOF_Y + 3, c); rect(bx + 3, ROOF_Y + 4, 3, 1, c); rect(bx + 2, ROOF_Y + 5, 5, 1, c); }
      else { rect(bx + 2, ROOF_Y + 3, 5, 1, c); rect(bx + 3, ROOF_Y + 4, 3, 1, c); px(bx + 4, ROOF_Y + 5, c); }
      rect(bx + 2, ROOF_Y + 6, 5, 1, c);
    } else { // menu: three bars
      for (let i = 0; i < 3; i++) rect(bx + 2, ROOF_Y + 3 + i * 2, 5, 1, c);
    }
  }
  if (['available', 'downloading', 'ready'].includes(appCfg.update?.state)) {
    const bx = ROOF_BTNS.menu + 4;
    const by = appCfg.collapsed ? ROOF_Y - 1 : ROOF_Y - 5;
    rect(bx, by, 7, 7, '#2b2233');
    rect(bx + 1, by + 1, 5, 5, '#e63946');
    rect(bx + 3, by + 1, 1, 3, '#ffffff');
    px(bx + 3, by + 5, '#ffffff');
  }
}

// ---------- nagging: something needs you until you deal with it ----------
const NAG_COLOR = { stuck: '#ff4d5e', waiting: '#ffb703', done: '#3ddc84' };
const NAG_SHOUT = { stuck: 'HELP!', waiting: 'NEED YOU', done: 'DONE!' };
const NAG_RANK = { stuck: 3, waiting: 2, done: 1 };
const snoozed = new Map(); // agent id -> snoozed until (ms)

function nagging(a) {
  return NAG_RANK[a.status] && (snoozed.get(a.id) || 0) < Date.now();
}

function currentNag() {
  let best = null;
  for (const a of allAgents) if (nagging(a) && (!best || NAG_RANK[a.status] > NAG_RANK[best.status])) best = a;
  return best;
}

function nagRoomba(r, dt) {
  if (!nagging(r.agent) || r.mode === 'held' || r.leaving) return;
  r.nagT = (r.nagT ?? rand(0.5, 2)) - dt;
  if (r.nagT > 0) return;
  r.nagT = 4.5;
  if (r.mode === 'floor' || r.mode === 'perch') r.hopV = 95;
  floater(NAG_SHOUT[r.agent.status], r.x, baseOf(r) - 22, NAG_COLOR[r.agent.status]);
}

// the whole room hops every few seconds while something is waiting on you
let roomHop = 0;
setInterval(() => {
  const nag = currentNag();
  if (!nag) { canvas.style.transform = ''; return; }
  roomHop = 1;
}, 5000);
function animateRoomHop(dt) {
  if (pinned) { roomHop = 0; canvas.style.transform = ''; return; }
  if (roomHop <= 0) return;
  roomHop = Math.max(0, roomHop - dt * 2.5);
  const lift = Math.sin((1 - roomHop) * Math.PI) * 5 * scale;
  canvas.style.transform = roomHop > 0 ? `translateY(${-lift}px)` : '';
}

// rotating siren on the roof, dark when all is calm
function drawSiren() {
  const nag = currentNag();
  const x = 7; const y = ROOF_Y + 2;
  rect(x, y + 4, 7, 2, '#2b2233');
  if (!nag) { rect(x + 1, y + 1, 5, 3, '#6b4658'); return; }
  const c = NAG_COLOR[nag.status];
  rect(x + 1, y + 1, 5, 3, c);
  px(x + 2, y + 1, '#ffffff');
  const phase = Math.floor(time * 8) % 4;
  ctx.globalAlpha = 0.55;
  if (phase === 0 || phase === 2) { rect(x - 3, y + 1, 3, 1, c); rect(x + 7, y + 1, 3, 1, c); }
  if (phase === 1) { px(x - 1, y - 1, c); px(x + 7, y - 1, c); }
  if (phase === 3) { px(x + 3, y - 2, c); }
  ctx.globalAlpha = 1;
}

// how messy is this room, at a glance
function drawMessGauge() {
  const x = 18; const y = ROOF_Y + 2;
  const avgDirt = FURNITURE.length ? FURNITURE.reduce((t, f) => t + f.dirt, 0) / FURNITURE.length : 0;
  const level = clamp(floorJunk() / 18 * 0.6 + avgDirt * 0.4, 0, 1);
  const segs = 8; const on = Math.round(level * segs);
  rect(x - 1, y - 1, segs * 3 + 2, 7, '#2b2233');
  for (let i = 0; i < segs; i++) {
    const c = i < 3 ? '#3ddc84' : i < 6 ? '#ffd166' : '#ff4d5e';
    rect(x + i * 3, y, 2, 5, i < on ? c : '#4a3544');
  }
  if (level > 0.75 && Math.sin(time * 6) > 0) rect(x - 1, y - 1, segs * 3 + 2, 1, '#ff4d5e');
}

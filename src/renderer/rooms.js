/* global makePiece, CATALOG, seeded, RX0, RX1, W */
// Rooms: one per project (keyed by its folder), plus the Garage that holds everything.
// Each project's room is generated from a seed of its path, so it always looks the same.

const GARAGE = 'garage';
const LAYOUT_X0 = 84; // right of the whiteboard
const LAYOUT_X1 = 306; // left of the trash can & recharge station

const WALLS = [
  { clean: '#f3d9b8', dirty: '#877a63', accent: '#ecc9a0', accentDirty: '#7a6d57', skirting: '#a86f48' }, // peach
  { clean: '#d7e8cf', dirty: '#6f7a63', accent: '#c6dcbb', accentDirty: '#626c57', skirting: '#6a8a5a' }, // sage
  { clean: '#cfe0f2', dirty: '#6d7784', accent: '#bcd2ea', accentDirty: '#606a76', skirting: '#5a7896' }, // sky
  { clean: '#e3d7f2', dirty: '#776d84', accent: '#d5c5ea', accentDirty: '#696076', skirting: '#7c6a9a' }, // lavender
  { clean: '#f6e7a8', dirty: '#857c56', accent: '#efdc8e', accentDirty: '#776f4c', skirting: '#b08a3a' }, // butter
  { clean: '#f2cdc4', dirty: '#86706a', accent: '#ebbdb2', accentDirty: '#78635d', skirting: '#b0665a' }, // blush
  { clean: '#e4e4e8', dirty: '#76767c', accent: '#d6d6dc', accentDirty: '#68686e', skirting: '#6c6c78' }, // grey
];
const PATTERNS = ['stripes', 'dots', 'plain', 'diamonds', 'wainscot'];
const FLOORS = [
  { kind: 'wood', clean: '#c08a55', dirty: '#5b3f2c', line: '#a2703f', lineDirty: '#47301f' },
  { kind: 'wood', clean: '#d9b27c', dirty: '#6a5638', line: '#bf955f', lineDirty: '#554429' },
  { kind: 'wood', clean: '#8f5f3f', dirty: '#4a3222', line: '#774c30', lineDirty: '#3a2619' },
  { kind: 'tiles', clean: '#f1ede4', dirty: '#7a766c', line: '#3a86ff', lineDirty: '#3d4a66' },
  { kind: 'tiles', clean: '#e9e9e9', dirty: '#6f6f6f', line: '#2b2233', lineDirty: '#2b2233' },
  { kind: 'carpet', clean: '#8e9aaf', dirty: '#4f5563', line: '#7d889c', lineDirty: '#454a57' },
  { kind: 'carpet', clean: '#b5838d', dirty: '#5f474c', line: '#a3747e', lineDirty: '#523d41' },
];
const RUGS = [
  { a: '#c9536b', b: '#e5798d', c: '#ffd1dc' },
  { a: '#3d5a80', b: '#98c1d9', c: '#e0fbfc' },
  { a: '#6a994e', b: '#a7c957', c: '#f2e8cf' },
  { a: '#bc6c25', b: '#dda15e', c: '#fefae0' },
];

// what a room "is" decides which furniture it prefers
const ARCHETYPES = {
  living: { name: 'living room', must: ['couch', 'tv'], maybe: ['armchair', 'lamp', 'plant', 'shelf', 'desk', 'fridge', 'arcade'] },
  bedroom: { name: 'bedroom', must: ['bed', 'dresser'], maybe: ['lamp', 'plant', 'desk', 'shelf', 'armchair', 'tv'] },
  office: { name: 'office', must: ['desk', 'shelf'], maybe: ['plant', 'armchair', 'fridge', 'lamp', 'arcade', 'couch', 'plant'] },
  studio: { name: 'studio', must: ['desk', 'couch'], maybe: ['fridge', 'lamp', 'plant', 'tv', 'shelf', 'arcade', 'bed'] },
};

function hashStr(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 2147483646 + 1;
}

function projectKeyOf(agent) {
  if (!agent.cwd) return 'misc:' + (agent.project || 'unknown').toLowerCase();
  let p = agent.cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  // git worktrees belong to the project they came from
  const wt = p.match(/\/worktrees\/([^/]+)/);
  if (wt) p = 'worktree:' + wt[1];
  return p;
}

function projectNameOf(key, fallback) {
  if (key === GARAGE) return 'Garage';
  if (key.startsWith('misc:')) return key.slice(5);
  if (key.startsWith('worktree:')) return key.slice(9);
  return fallback || key.split('/').pop();
}

// ---------- generation ----------
function generateRoom(key, name) {
  if (key === GARAGE) return generateGarage();
  const r = seeded(hashStr(key));
  const pickR = (arr) => arr[Math.floor(r() * arr.length)];
  const arch = pickR(Object.keys(ARCHETYPES));
  const A = ARCHETYPES[arch];
  const theme = {
    wall: pickR(WALLS), pattern: pickR(PATTERNS), floor: pickR(FLOORS),
    rug: r() < 0.75 ? { ...pickR(RUGS), x: 20 + Math.floor(r() * 180), w: 44 + Math.floor(r() * 30) } : null,
  };

  // choose floor furniture: the must-haves, then extras until the wall is full
  const extras = [...A.maybe].sort(() => r() - 0.5);
  let list = [...A.must, ...extras.slice(0, 2 + Math.floor(r() * 3)), 'dock'];
  list = [...new Set(list)];
  list.sort(() => r() - 0.5);
  // believable pairings: a lamp stands right next to something you sit or sleep on
  const li = list.indexOf('lamp');
  if (li >= 0) {
    list.splice(li, 1);
    const seat = list.findIndex((t) => t === 'couch' || t === 'bed' || t === 'armchair');
    list.splice(seat >= 0 ? seat + (r() < 0.5 ? 0 : 1) : list.length, 0, 'lamp');
  }

  const placed = [];
  let x = LAYOUT_X0;
  for (const type of list) {
    const w = CATALOG[type].w;
    if (x + w > LAYOUT_X1) continue;
    placed.push({ type, x, w });
    x += w + 2 + Math.floor(r() * 6);
  }
  // spread leftover space between pieces so nothing is crammed to one side
  const slack = LAYOUT_X1 - x;
  placed.forEach((p, i) => { p.x += Math.floor((slack * (i + 1)) / (placed.length + 1)); });
  const pieces = placed.map((p, i) => makePiece(p.type, p.x, Math.floor(r() * 8), hashStr(key + i)));

  // hang wall pieces only where they won't collide with tall furniture
  const wallWish = ['window'];
  if (r() < 0.45) wallWish.push('window');
  for (const t of ['poster', 'clock', 'painting', 'poster']) if (r() < 0.55) wallWish.push(t);
  for (const t of wallWish) {
    const spec = CATALOG[t];
    const ok = [];
    for (let wx = LAYOUT_X0; wx + spec.w <= LAYOUT_X1; wx++) {
      const clearOfFloor = pieces.every((p) => p.spec.kind !== 'floor' || p.x + p.spec.w <= wx || p.x >= wx + spec.w || p.spec.extent >= spec.bottom);
      const clearOfWall = pieces.every((p) => p.spec.kind !== 'wall' || p.x + p.spec.w + 3 <= wx || p.x >= wx + spec.w + 3);
      if (clearOfFloor && clearOfWall) ok.push(wx);
    }
    if (ok.length) pieces.push(makePiece(t, ok[Math.floor(r() * ok.length)], Math.floor(r() * 8), hashStr(key + t + pieces.length)));
  }
  return { key, name, theme, archetype: A.name, pieces: orderPieces(pieces) };
}

function generateGarage() {
  const theme = { garage: true, wall: { clean: '#c9c4b8', dirty: '#6f6b62', accent: '#bdb8ab', accentDirty: '#625e56', skirting: '#8d8a84' }, pattern: 'blocks', floor: { kind: 'concrete', clean: '#a8a49c', dirty: '#5e5b55', line: '#96928a', lineDirty: '#4f4c47' }, rug: null };
  const pieces = [
    makePiece('rack', 84, 1, 11),
    makePiece('workbench', 114, 0, 12),
    makePiece('toolchest', 162, 0, 13),
    makePiece('fridge', 184, 3, 14, { beer: true }),
    makePiece('garagedoor', 212, 0, 15),
    makePiece('car', 206, 0, 16),
    makePiece('dock', 288, 0, 17),
    makePiece('neon', 180, 0, 18),
    makePiece('tires', 278, 0, 19),
  ];
  return { key: GARAGE, name: 'Garage', theme, archetype: 'garage', pieces: orderPieces(pieces) };
}

// wall pieces and the garage door go first, then floor furniture left to right
function orderPieces(pieces) {
  const rank = { wall: 0, backdrop: 1, floor: 2 };
  return pieces.sort((a, b) => rank[a.spec.kind] - rank[b.spec.kind] || a.x - b.x);
}

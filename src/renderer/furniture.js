/* global ctx, rect, px, mix, clamp, time, agents, skyColors, seeded, pixelText, cleanliness, BOTTOM, FLOOR_TOP, WRECKED */
// Furniture catalog. Every piece is drawn at its own x, carries its own dirt level
// (0 = like new, >= WRECKED = wrecked) and says where roombas can stand and junk can land.
//
// kind:   'floor' pieces stand against the back wall, 'wall' pieces hang on it,
//         'backdrop' pieces (garage door) sit behind floor pieces.
// extent: the highest pixel a floor piece reaches — wall pieces only hang above pieces
//         whose extent is below their bottom edge, so nothing overlaps.

const WOODS = [
  { dark: '#5d4030', light: '#8b5e3c', top: '#a47148' },
  { dark: '#4a3526', light: '#6f4b32', top: '#8a5d3d' },
  { dark: '#6d5a44', light: '#b89266', top: '#caa57a' },
  { dark: '#3b3f4a', light: '#5d6472', top: '#707887' }, // painted grey
];
const FABRICS = [
  { a: '#5e60ce', b: '#4e50b8', dirtyA: '#4a4e69', dirtyB: '#3c3f58' },
  { a: '#e76f51', b: '#c95b40', dirtyA: '#6e4a3f', dirtyB: '#5a3c33' },
  { a: '#2a9d8f', b: '#21867a', dirtyA: '#40564f', dirtyB: '#334540' },
  { a: '#e9c46a', b: '#d4ad52', dirtyA: '#6f6444', dirtyB: '#5c5237' },
  { a: '#9b5de5', b: '#8446cf', dirtyA: '#554666', dirtyB: '#463a55' },
];

function grimeFor(p) {
  const r = seeded(p.seed || 7);
  const [bx, by, bw, bh] = p.spec.box(p);
  return Array.from({ length: 10 }, () => ({ x: bx + 1 + r() * (bw - 4), y: by + 1 + r() * (bh - 4), w: 1 + Math.floor(r() * 3), c: ['#4a3a22', '#56652d', '#3b2d20', '#6b5a2a'][Math.floor(r() * 4)] }));
}

function grimeOverlay(p) {
  const d = p.shown;
  if (d <= 0.02) return;
  const [bx, by, bw, bh] = p.spec.box(p);
  ctx.globalAlpha = d * 0.28;
  rect(bx, by, bw, bh, '#3b2f1e');
  ctx.globalAlpha = clamp(d * 1.4, 0, 0.9);
  const n = Math.ceil(d * p.grime.length);
  for (let i = 0; i < n; i++) { const g = p.grime[i]; rect(g.x, g.y, g.w, 1, g.c); px(g.x + 1, g.y + 1, g.c); }
  ctx.globalAlpha = 1;
}

const crack = (x, y, c = '#e8e8e8') => { px(x, y, c); px(x + 1, y + 1, c); px(x + 2, y + 1, c); px(x + 3, y + 2, c); px(x + 1, y + 2, c); px(x + 4, y + 3, c); };

const CATALOG = {
  // ---------------- living / bedroom / office ----------------
  shelf: {
    name: 'BOOKSHELF', kind: 'floor', w: 20, extent: 28,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 20, top: 28 }),
    box: (p) => [p.x, 28, 20, 42],
    spots: (p) => [{ x: p.x + 10, y: 28, types: ['pizza', 'sock', 'can'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const y = 28; const wd = WOODS[p.variant % WOODS.length];
      const wood = mix(wd.dark, wd.light, 1 - d * 0.7);
      rect(x, y, 20, 42, wood);
      rect(x + 1, y + 1, 18, 40, mix('#3e2a1e', '#5a3d2a', 1 - d));
      const wrecked = d >= WRECKED;
      const bookCols = ['#e63946', '#457b9d', '#f4a261', '#2a9d8f', '#8338ec', '#ffd166'];
      for (let s = 0; s < 3; s++) {
        const sy = y + 12 + s * 10;
        if (wrecked && s === 1) {
          for (let i = 0; i < 17; i++) px(x + 1 + i, sy + Math.floor(i / 4) - 1, wood);
          for (let i = 0; i < 4; i++) rect(x + 9 + i * 2, sy + 1 - (i % 2), 2, 3, bookCols[(i + 2) % 6]);
        } else {
          rect(x + 1, sy, 18, 1, wood);
          const books = s === 2 && d > 0.33 ? 3 : 6;
          for (let i = 0; i < books; i++) {
            const tilt = d > 0.33 && i === books - 1;
            rect(x + 2 + i * 3, sy - (tilt ? 2 : 7), tilt ? 4 : 2, tilt ? 2 : 7, bookCols[(i + s + p.variant) % 6]);
          }
        }
      }
      rect(x + 2, y + 3, 7, 6, mix('#9a8b6a', '#e9d8a6', 1 - d));
      if (wrecked) { rect(x + 3, y + 4, 1, 4, '#2b2233'); px(x + 4, y + 5, '#2b2233'); px(x + 5, y + 6, '#2b2233'); }
      grimeOverlay(p);
    },
  },

  desk: {
    name: 'DESK', kind: 'floor', w: 34, extent: 35,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 34, top: 50 }),
    box: (p) => [p.x, 35, 34, 35],
    spots: (p) => [{ x: p.x + 28, y: 50, types: ['mug', 'can', 'paper'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const y = 50; const wd = WOODS[p.variant % WOODS.length];
      const wrecked = d >= WRECKED;
      const wood = mix(wd.dark, wd.light, 1 - d);
      rect(x, y, 34, 3, wood);
      rect(x, y, 34, 1, mix(wd.dark, wd.top, 1 - d));
      rect(x + 1, y + 3, 2, 17, wood);
      if (wrecked) { rect(x + 30, y + 3, 3, 10, wood); rect(x + 29, y + 14, 5, 6, '#e63946'); rect(x + 29, y + 16, 5, 1, '#f1faee'); }
      else rect(x + 31, y + 3, 2, 17, wood);
      rect(x + 22, y + 3, 9, 8, mix('#4d3526', wd.dark, 1 - d)); px(x + 26, y + 6, '#d4a373');
      if (d > 0.33) { rect(x + 22, y + 10, 9, 1, '#2b2233'); rect(x + 23, y + 11, 6, 2, '#f1faee'); }
      rect(x + 4, y - 14, 18, 12, '#2b2838');
      rect(x + 5, y - 13, 16, 10, '#0f1424');
      rect(x + 12, y - 2, 3, 2, '#2b2838');
      if (agents.some((a) => a.status === 'working')) {
        const off = Math.floor(time * 4);
        for (let i = 0; i < 5; i++) {
          const w = 3 + ((i * 7 + off) % 9);
          const cols = ['#6ff3ff', '#ffd166', '#7dff8a', '#ff8fab'];
          rect(x + 6 + ((i + off) % 3), y - 12 + i * 2, Math.min(w, 13), 1, cols[(i + off) % 4]);
        }
      } else {
        const bx = x + 6 + Math.round((Math.sin(time * 0.9) + 1) * 6);
        const byy = y - 12 + Math.round((Math.cos(time * 1.3) + 1) * 3.5);
        rect(bx, byy, 3, 2, '#9b5de5');
      }
      if (wrecked) crack(x + 8, y - 12);
      if (d > 0.33) for (let i = 0; i < 3; i++) rect(x + 5 + i * 5, y - 16 + (i % 2), 3, 3, ['#ffe66d', '#ff8fab', '#8ee59b'][i]);
      const chairTilt = wrecked ? 2 : 0;
      rect(x + 8, y + 6, 10, 2, '#3d405b'); rect(x + 16 + chairTilt, y - 4, 2, 10, '#3d405b'); rect(x + 12, y + 8, 2, 9, '#2b2838'); rect(x + 9, y + 17, 8, 1, '#2b2838');
      rect(x + 5, y - 1, 12, 1, '#8d99ae');
      grimeOverlay(p);
    },
  },

  tv: {
    name: 'TV', kind: 'floor', w: 28, extent: 40,
    surface: (p) => ({ sx0: p.x + 2, sx1: p.x + 26, top: 44 }),
    box: (p) => [p.x, 44, 28, 26],
    spots: (p) => [{ x: p.x + 21, y: 44, types: ['can', 'mug', 'banana'] }],
    draw(p) {
      const d = p.shown; const x = p.x + 1; const y = 44; const wd = WOODS[p.variant % WOODS.length];
      const wrecked = d >= WRECKED;
      rect(x - 1, y + 16, 28, 10, mix('#4d3526', wd.light, 1 - d));
      rect(x, y + 17, 12, 8, mix('#3e2a1e', wd.dark, 1 - d)); rect(x + 14, y + 17, 12, 8, mix('#3e2a1e', wd.dark, 1 - d));
      rect(x + 2, y + 21, 8, 2, '#2b2838'); px(x + 3, y + 21, '#e63946');
      if (d > 0.33) { rect(x + 15, y + 23, 5, 3, '#8d99ae'); rect(x + 21, y + 24, 3, 2, '#2b2838'); }
      rect(x, y, 26, 15, '#1d1a26');
      rect(x + 2, y + 2, 22, 11, '#0f1424');
      rect(x + 11, y + 15, 4, 1, '#1d1a26');
      if (wrecked) {
        for (let i = 0; i < 18; i++) px(x + 3 + ((i * 7) % 20), y + 3 + ((i * 5 + Math.floor(time * 12)) % 9), '#8d99ae');
        crack(x + 13, y + 3);
      } else {
        const t = time * 1.4;
        const bx = x + 4 + Math.round(Math.abs(((t * 9) % 36) - 18));
        const by = y + 4 + Math.round(Math.abs(((t * 5) % 14) - 7));
        rect(x + 3, y + 5 + Math.round(Math.sin(t) * 2), 1, 3, '#7dff8a');
        rect(x + 22, y + 5 + Math.round(Math.cos(t) * 2), 1, 3, '#ff8fab');
        px(Math.min(bx, x + 21), by, '#fff');
      }
      rect(x + 9, y - 4, 1, 4, '#8d99ae');
      if (wrecked) { px(x + 16, y - 1, '#8d99ae'); px(x + 17, y - 2, '#8d99ae'); px(x + 18, y - 2, '#8d99ae'); } else rect(x + 16, y - 4, 1, 4, '#8d99ae');
      grimeOverlay(p);
    },
  },

  couch: {
    name: 'COUCH', kind: 'floor', w: 48, extent: 55,
    surface: (p) => ({ sx0: p.x + 4, sx1: p.x + 44, top: 63 }),
    box: (p) => [p.x, 55, 48, 18],
    spots: (p) => [{ x: p.x + 14, y: 63, types: ['pizza', 'shirt', 'pants'] }, { x: p.x + 32, y: 63, types: ['can', 'book', 'sock'] }],
    draw(p) {
      const d = p.shown; const x = p.x + 2; const y = 55; const fb = FABRICS[p.variant % FABRICS.length];
      const wrecked = d >= WRECKED;
      const fab = mix(fb.dirtyA, fb.a, 1 - d);
      const fab2 = mix(fb.dirtyB, fb.b, 1 - d);
      rect(x, y, 44, 8, fab2);
      rect(x - 2, y + 4, 4, 12, fab); rect(x + 42, y + 4, 4, 12, fab);
      rect(x + 2, y + 8, 40, 5, fab);
      rect(x + 2, y + 13, 40, 3, fab2);
      rect(x + 21, y + 1, 1, 12, fab2);
      rect(x + 1, y + 16, 2, 2, '#2b2233');
      if (wrecked) rect(x + 41, y + 16, 2, 1, '#2b2233'); else rect(x + 41, y + 16, 2, 2, '#2b2233');
      if (d > 0.33) { rect(x + 30, y + 9, 5, 3, '#f1faee'); px(x + 29, y + 10, '#f1faee'); px(x + 35, y + 8, '#f1faee'); }
      if (wrecked) {
        rect(x + 8, y + 2, 6, 4, '#f1faee'); px(x + 9, y + 1, '#f1faee');
        const sp = '#b8b8c8'; px(x + 12, y + 7, sp); px(x + 13, y + 6, sp); px(x + 12, y + 5, sp); px(x + 13, y + 4, sp);
        rect(x - 2, y + 4, 4, 3, '#f1faee');
      }
      rect(x + 5, y + 3, 7, 5, mix('#a08d4a', '#ffd166', 1 - d));
      grimeOverlay(p);
    },
  },

  armchair: {
    name: 'ARMCHAIR', kind: 'floor', w: 22, extent: 55,
    surface: (p) => ({ sx0: p.x + 2, sx1: p.x + 20, top: 62 }),
    box: (p) => [p.x, 55, 22, 15],
    spots: (p) => [{ x: p.x + 11, y: 62, types: ['book', 'shirt', 'pizza'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const y = 55; const fb = FABRICS[(p.variant + 2) % FABRICS.length];
      const wrecked = d >= WRECKED;
      const fab = mix(fb.dirtyA, fb.a, 1 - d); const fab2 = mix(fb.dirtyB, fb.b, 1 - d);
      rect(x + 3, y, 16, 8, fab2);
      rect(x + 3, y, 16, 1, mix(fb.dirtyA, '#ffffff', 0.15));
      rect(x, y + 4, 4, 11, fab); rect(x + 18, y + 4, 4, 11, fab);
      rect(x + 4, y + 7, 14, 5, fab);
      rect(x + 4, y + 12, 14, 2, fab2);
      rect(x + 2, y + 15, 2, 2, '#2b2233'); rect(x + 18, y + 15, 2, wrecked ? 1 : 2, '#2b2233');
      if (d > 0.33) { rect(x + 12, y + 8, 3, 2, '#f1faee'); px(x + 11, y + 9, '#f1faee'); }
      if (wrecked) { rect(x + 5, y + 2, 4, 3, '#f1faee'); const sp = '#b8b8c8'; px(x + 15, y + 6, sp); px(x + 16, y + 5, sp); px(x + 15, y + 4, sp); }
      grimeOverlay(p);
    },
  },

  bed: {
    name: 'BED', kind: 'floor', w: 50, extent: 54,
    surface: (p) => ({ sx0: p.x + 6, sx1: p.x + 48, top: 61 }),
    box: (p) => [p.x, 54, 50, 16],
    spots: (p) => [{ x: p.x + 20, y: 61, types: ['shirt', 'pants', 'undies'] }, { x: p.x + 38, y: 61, types: ['sock', 'book', 'pizza'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const wd = WOODS[p.variant % WOODS.length]; const fb = FABRICS[(p.variant + 1) % FABRICS.length];
      const wrecked = d >= WRECKED;
      const wood = mix(wd.dark, wd.light, 1 - d);
      rect(x, 54, 4, 16, wood); rect(x, 54, 4, 1, mix(wd.dark, wd.top, 1 - d)); // headboard
      rect(x + 46, 60, 4, 10, wood); // footboard
      rect(x + 3, 64, 44, 3, wood); // frame
      rect(x + 4, 67, 2, 3, '#2b2233'); rect(x + 44, 67, 2, 3, '#2b2233');
      rect(x + 4, 60, 43, 4, mix('#bdb6a3', '#f7f3ea', 1 - d)); // mattress
      rect(x + 5, 57, 9, 3, mix('#c9c3b3', '#ffffff', 1 - d)); rect(x + 5, 57, 9, 1, mix('#b0a996', '#f0ede6', 1 - d)); // pillow
      const bl = mix(fb.dirtyA, fb.a, 1 - d); const bl2 = mix(fb.dirtyB, fb.b, 1 - d);
      if (d > 0.33) { // blanket kicked into a heap
        rect(x + 26, 58, 16, 3, bl); rect(x + 28, 57, 10, 1, bl2); rect(x + 30, 61, 12, 2, bl2);
      } else {
        rect(x + 15, 59, 32, 5, bl); rect(x + 15, 59, 32, 1, bl2); rect(x + 46, 59, 1, 6, bl2);
      }
      if (wrecked) { // broken slat, mattress sagging, blanket on the floor
        rect(x + 20, 64, 8, 2, '#2b2233'); rect(x + 21, 62, 6, 2, mix('#bdb6a3', '#f7f3ea', 0.3));
        rect(x + 44, 66, 8, 4, bl); px(x + 43, 67, bl);
        const sp = '#b8b8c8'; px(x + 24, 63, sp); px(x + 25, 62, sp);
      }
      grimeOverlay(p);
    },
  },

  dresser: {
    name: 'DRESSER', kind: 'floor', w: 26, extent: 50,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 26, top: 50 }),
    box: (p) => [p.x, 50, 26, 20],
    spots: (p) => [{ x: p.x + 7, y: 50, types: ['mug', 'undies', 'sock'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const wd = WOODS[(p.variant + 2) % WOODS.length];
      const wrecked = d >= WRECKED;
      const wood = mix(wd.dark, wd.light, 1 - d);
      rect(x, 50, 26, 18, wood);
      rect(x, 50, 26, 1, mix(wd.dark, wd.top, 1 - d));
      rect(x + 1, 68, 2, 2, '#2b2233'); rect(x + 23, 68, 2, 2, '#2b2233');
      for (let i = 0; i < 3; i++) {
        const dy = 52 + i * 5;
        const out = (d > 0.33 && i === 1) || (wrecked && i === 2) ? 2 : 0; // drawers left hanging open
        rect(x + 2, dy + out, 22, 4, mix(wd.dark, wd.top, 0.4 + (1 - d) * 0.4));
        rect(x + 12, dy + 1 + out, 2, 1, '#e9c46a');
        if (out) { rect(x + 5, dy + out + 3, 4, 2, '#e63946'); rect(x + 15, dy + out + 3, 3, 3, '#457b9d'); } // clothes spilling out
      }
      if (wrecked) { rect(x + 20, 67, 6, 3, wood); px(x + 25, 66, wood); } // leg snapped
      grimeOverlay(p);
    },
  },

  lamp: {
    name: 'LAMP', kind: 'floor', w: 13, extent: 39,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 12, top: 39 }),
    box: (p) => [p.x, 39, 13, 35],
    spots: (p) => [{ x: p.x + 6, y: 39, types: ['undies', 'sock'] }],
    draw(p) {
      const d = p.shown; const x = p.x + 5; const y = 40;
      const wrecked = d >= WRECKED;
      const shade = mix('#9e8a6a', ['#ffe8a3', '#ffc8dd', '#bde0fe'][p.variant % 3], 1 - d);
      if (wrecked) { rect(x - 3, y + 1, 12, 5, shade); rect(x - 2, y, 10, 1, shade); rect(x + 6, y + 2, 3, 4, mix('#7e6a4a', '#e0c883', 1 - d)); }
      else { rect(x - 5, y, 12, 6, shade); rect(x - 4, y - 1, 10, 1, shade); }
      if (d > 0.33) { px(x - 4, y + 2, '#6b5a2a'); px(x + 3, y + 4, '#6b5a2a'); }
      rect(x, y + 6, 1, 26, '#3d405b');
      rect(x - 3, y + 28, 7, 2, '#3d405b');
      const on = skyColors().night && (!wrecked || Math.sin(time * 23) > 0.4);
      if (on) {
        ctx.globalAlpha = 0.18 * (1 - d * 0.5);
        ctx.fillStyle = '#ffe8a3';
        ctx.beginPath(); ctx.moveTo(x - 5, y + 6); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x + 18, BOTTOM - 4); ctx.lineTo(x - 16, BOTTOM - 4); ctx.fill();
        ctx.globalAlpha = 1;
      }
      grimeOverlay(p);
    },
  },

  fridge: {
    name: 'FRIDGE', kind: 'floor', w: 19, extent: 42,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 17, top: 42 }),
    box: (p) => [p.x, 42, 19, 28],
    spots: (p) => [{ x: p.x + 5, y: 42, types: ['pizza', 'undies', 'paper'] }],
    draw(p) {
      const d = p.shown; const { x } = p; const y = 42;
      const wrecked = d >= WRECKED;
      const tint = ['#eef3f6', '#f7e1d7', '#d8f3dc', '#e5e5e5'][p.variant % 4];
      const body = mix('#b9b9a8', tint, 1 - d);
      rect(x, y, 17, 28, body);
      rect(x, y + 9, 17, 1, mix('#8d8d7e', '#b8c4cc', 1 - d));
      rect(x + 14, y + 3, 1, 4, '#8d99ae'); rect(x + 14, y + 12, 1, 6, '#8d99ae');
      if (p.beer) { rect(x + 3, y + 12, 8, 6, '#e63946'); rect(x + 4, y + 14, 6, 1, '#fff'); rect(x + 4, y + 16, 4, 1, '#fff'); }
      else { rect(x + 3, y + 12, 6, 5, '#fffaf0'); px(x + 5, y + 14, '#e63946'); px(x + 6, y + 13, '#3a86ff'); }
      px(x + 3, y + 3, '#ffd166'); px(x + 7, y + 5, '#8ac926');
      if (d > 0.33) { rect(x + 16, y + 10, 3, 17, body); rect(x + 15, y + 10, 1, 17, '#bfffb0'); if (Math.sin(time * 3) > 0) px(x + 18, y + 24, '#7dff8a'); }
      if (wrecked) {
        rect(x + 2, y + 20, 5, 3, '#8ac926'); px(x + 3, y + 19, '#8ac926'); px(x + 5, y + 18, '#8ac926');
        px(x + 3, y + 21, '#2b2233'); px(x + 5, y + 21, '#2b2233');
        rect(x + 1, y + 27, 6, 1, '#6aa84f');
      }
      rect(x + 1, y + 28, 2, 1, '#2b2233'); rect(x + 14, y + 28, 2, 1, '#2b2233');
      grimeOverlay(p);
    },
  },

  arcade: {
    name: 'ARCADE', kind: 'floor', w: 16, extent: 36,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 16, top: 36 }),
    box: (p) => [p.x, 36, 16, 34],
    spots: (p) => [{ x: p.x + 8, y: 36, types: ['can', 'sock'] }],
    draw(p) {
      const d = p.shown; const { x } = p;
      const wrecked = d >= WRECKED;
      const body = mix('#3a2f4f', ['#7b2cbf', '#d00000', '#0077b6'][p.variant % 3], 1 - d * 0.7);
      rect(x, 36, 16, 34, body);
      rect(x, 36, 16, 5, mix('#5a4a3a', '#ffd166', 1 - d)); // marquee
      pixelText(ctx, 'GO', x + 5, 36, '#2b2233');
      rect(x + 2, 43, 12, 10, '#0f1424');
      if (wrecked) { for (let i = 0; i < 10; i++) px(x + 3 + ((i * 5) % 10), 44 + ((i * 3 + Math.floor(time * 10)) % 8), '#8d99ae'); crack(x + 6, 44); }
      else { // tiny space shooter
        const k = Math.floor(time * 3) % 10;
        px(x + 4 + k, 45, '#ff8fab'); px(x + 12 - k % 8, 47, '#7dff8a'); rect(x + 7, 51, 3, 1, '#6ff3ff'); px(x + 8, 50 - (Math.floor(time * 8) % 5), '#fff');
      }
      rect(x + 1, 54, 14, 3, mix('#2b2233', '#3d405b', 1 - d));
      px(x + 4, 54, '#e63946'); px(x + 9, 55, '#ffd166'); px(x + 11, 55, '#7dff8a');
      rect(x + 5, 59, 6, 1, '#1d1a26'); // coin slot
      if (d > 0.33) rect(x + 3, 62, 3, 2, '#e9c46a'); // quarters everywhere
      grimeOverlay(p);
    },
  },

  plant: {
    name: 'PLANT', kind: 'floor', w: 11, extent: 51, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 51, 11, 19],
    spots: () => [],
    draw(p) {
      const x = p.x + 5; const y = 52; const h = cleanliness;
      const pot = ['#c66b3d', '#457b9d', '#f1faee', '#2a9d8f'][p.variant % 4];
      rect(x - 4, y + 10, 9, 8, pot); rect(x - 5, y + 9, 11, 2, mix(pot, '#ffffff', 0.2));
      const leaf = mix('#8a7a3a', '#3fa34d', h); const leaf2 = mix('#6d5f2c', '#2d7a3a', h);
      const droop = Math.round((1 - h) * 4);
      if (p.variant % 2) { // tall snake plant
        for (let i = -2; i <= 2; i += 2) rect(x + i, y - 2 + Math.abs(i) + droop, 1, 12 - Math.abs(i) - droop, i ? leaf : leaf2);
      } else {
        rect(x, y + 1 + droop, 1, 9 - droop, leaf2);
        rect(x - 4, y + 3 + droop * 1.5, 4, 2, leaf); rect(x + 1, y + 2 + droop * 1.5, 4, 2, leaf);
        rect(x - 3, y + 6 + droop, 3, 2, leaf2); rect(x + 1, y + 6 + droop, 3, 2, leaf2);
      }
      if (h > 0.75) { rect(x - 1, y - 1, 3, 2, '#ff6fa5'); px(x, y - 1, '#ffd166'); }
      if (h < 0.3) { px(x - 4, y + 17, '#8a7a3a'); px(x + 5, y + 17, '#8a7a3a'); }
    },
  },

  dock: {
    name: 'DOCK', kind: 'floor', w: 14, extent: 63, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 63, 14, 7],
    spots: () => [],
    draw(p) {
      const x = p.x + 7;
      rect(x - 6, FLOOR_TOP - 7, 12, 7, '#2b2838');
      rect(x - 5, FLOOR_TOP - 6, 10, 2, '#3d3a50');
      px(x, FLOOR_TOP - 5, Math.sin(time * 3) > 0 ? '#7dff8a' : '#2a9d4b');
    },
  },

  // ---------------- wall pieces ----------------
  window: {
    name: 'WINDOW', kind: 'wall', w: 48, bottom: 55, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 24, 48, 31],
    spots: (p) => [{ x: p.x + 35, y: 55, types: ['can', 'mug'] }],
    draw(p) {
      const x = p.x + 5; const y = 27; const w = 38; const h = 26;
      const sky = skyColors();
      rect(x - 2, y - 2, w + 4, h + 4, '#6b4a36');
      for (let i = 0; i < h; i++) rect(x, y + i, w, 1, mix(sky.top, sky.bottom, i / h));
      if (sky.night) {
        const r = seeded(3 + p.x);
        for (let i = 0; i < 9; i++) { const sx = x + Math.floor(r() * w); const sy = y + Math.floor(r() * (h - 6)); if (Math.sin(time * 2 + i) > -0.6) px(sx, sy, '#fff'); }
        rect(x + w - 10, y + 4, 4, 4, '#fdf6c9'); px(x + w - 10, y + 4, sky.top); rect(x + w - 11, y + 5, 1, 2, '#fdf6c9');
      } else {
        rect(x + w - 11, y + 3, 5, 5, '#fff3a3');
        const cx = x + ((time * 2 + p.x) % (w + 16)) - 12;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        rect(cx, y + 9, 10, 3, '#ffffff'); rect(cx + 2, y + 7, 5, 2, '#ffffff');
        ctx.restore();
      }
      const bld = sky.night ? '#262a5e' : '#8fb6d6';
      if (p.variant % 2) { // trees instead of a skyline
        const tr = sky.night ? '#1f3b2d' : '#5a9e6f';
        for (let i = 0; i < 5; i++) { rect(x + i * 8, y + h - 7 + (i % 2) * 2, 7, 7 - (i % 2) * 2, tr); }
      } else {
        rect(x, y + h - 5, 6, 5, bld); rect(x + 7, y + h - 8, 5, 8, bld); rect(x + 13, y + h - 4, 7, 4, bld); rect(x + 21, y + h - 7, 4, 7, bld); rect(x + 26, y + h - 5, 12, 5, bld);
        if (sky.night) { px(x + 9, y + h - 6, '#ffe66d'); px(x + 22, y + h - 5, '#ffe66d'); }
      }
      rect(x + w / 2 - 1, y, 1, h, '#6b4a36');
      rect(x, y + h / 2, w, 1, '#6b4a36');
      rect(x - 4, y + h + 1, w + 8, 2, '#8d6448');
      const cur = mix('#6d5a7e', ['#b56576', '#6d9dc5', '#e9c46a', '#84a98c'][p.variant % 4], cleanliness);
      rect(x - 5, y - 3, 5, h + 2, cur); rect(x + w, y - 3, 5, h + 2, cur);
      px(x - 3, y + 4, '#0002'); px(x + w + 2, y + 9, '#0002');
      // sunbeam on the floor when the room is tidy and it's daytime
      if (!sky.night && cleanliness > 0.55) {
        ctx.globalAlpha = (cleanliness - 0.55) * 0.5;
        ctx.fillStyle = '#fff4c2';
        ctx.beginPath(); ctx.moveTo(x + 2, y + h); ctx.lineTo(x + w - 2, y + h); ctx.lineTo(x + w - 22, BOTTOM); ctx.lineTo(x - 26, BOTTOM); ctx.fill();
        ctx.globalAlpha = 1;
      }
    },
  },

  poster: {
    name: 'POSTER', kind: 'wall', w: 16, bottom: 48, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 28, 16, 20],
    spots: (p) => [{ x: p.x + 6, y: 28, types: ['sock'] }],
    draw(p) {
      const { x } = p; const y = 28;
      const bg = ['#457b9d', '#e76f51', '#2a9d8f', '#6d597a'][p.variant % 4];
      rect(x, y, 16, 20, '#1d3557'); rect(x + 1, y + 1, 14, 18, bg);
      if (p.variant % 2) { // rocket
        rect(x + 7, y + 4, 2, 8, '#f1faee'); px(x + 7, y + 3, '#e63946'); px(x + 8, y + 3, '#e63946'); rect(x + 6, y + 10, 1, 2, '#e63946'); rect(x + 9, y + 10, 1, 2, '#e63946');
        px(x + 7, y + 12, '#ffd166'); px(x + 8, y + 13, '#f4a261');
      } else { // hang in there, kitty
        rect(x + 7, y + 2, 1, 5, '#a8dadc');
        rect(x + 5, y + 7, 5, 4, '#f4a261'); px(x + 5, y + 6, '#f4a261'); px(x + 9, y + 6, '#f4a261');
        px(x + 6, y + 8, '#1d3557'); px(x + 8, y + 8, '#1d3557'); rect(x + 6, y + 11, 3, 3, '#f4a261');
      }
      rect(x + 2, y + 16, 12, 1, '#f1faee'); rect(x + 4, y + 18, 8, 1, '#f1faee');
      if (cleanliness < 0.35) { rect(x + 12, y + 13, 3, 6, bg); rect(x + 13, y + 16, 2, 3, '#e9dfc9'); }
    },
  },

  painting: {
    name: 'PAINTING', kind: 'wall', w: 24, bottom: 45, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 30, 24, 15],
    spots: () => [],
    draw(p) {
      const { x } = p; const y = 30;
      rect(x, y, 24, 15, '#b08d57'); rect(x + 1, y + 1, 22, 13, '#8c6a3a');
      rect(x + 2, y + 2, 20, 11, ['#bde0fe', '#ffd6a5', '#cdb4db'][p.variant % 3]);
      rect(x + 2, y + 9, 20, 4, '#84a98c'); rect(x + 6, y + 6, 5, 3, '#52796f'); rect(x + 12, y + 5, 7, 4, '#52796f'); // hills
      rect(x + 16, y + 3, 3, 2, '#ffd166'); // sun
      if (cleanliness < 0.35) { ctx.save(); ctx.translate(x + 12, y + 7); ctx.rotate(0.08); ctx.restore(); px(x + 23, y + 14, '#2b2233'); } // hangs crooked
    },
  },

  clock: {
    name: 'CLOCK', kind: 'wall', w: 11, bottom: 40, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 29, 11, 11],
    spots: () => [],
    draw(p) {
      const cx = p.x + 5; const cy = 34;
      rect(cx - 4, cy - 5, 9, 11, '#2b2233'); rect(cx - 5, cy - 4, 11, 9, '#2b2233');
      rect(cx - 3, cy - 4, 7, 9, '#fffaf0'); rect(cx - 4, cy - 3, 9, 7, '#fffaf0');
      const now = new Date();
      const hand = (ang, len, c) => { for (let i = 1; i <= len; i++) px(Math.round(cx + Math.sin(ang) * i), Math.round(cy - Math.cos(ang) * i), c); };
      hand(((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2, 2, '#2b2233');
      hand(now.getMinutes() / 60 * Math.PI * 2, 3, '#e63946');
      px(cx, cy, '#2b2233');
    },
  },

  // ---------------- garage ----------------
  garagedoor: {
    name: 'DOOR', kind: 'backdrop', w: 62, extent: 26, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 26, 62, 44],
    spots: () => [],
    draw(p) {
      const { x } = p;
      rect(x, 26, 62, 44, '#4a4e57');
      rect(x + 2, 28, 58, 42, mix('#8a8f99', '#cfd4dc', cleanliness));
      for (let y = 30; y < 70; y += 5) { rect(x + 2, y, 58, 1, mix('#6f747d', '#aeb4bd', cleanliness)); }
      for (let i = 0; i < 4; i++) rect(x + 6 + i * 14, 33, 10, 3, skyColors().night ? '#262a5e' : '#9ad1ff'); // little windows
      rect(x + 28, 62, 6, 2, '#3b3f4a'); // handle
    },
  },

  workbench: {
    name: 'WORKBENCH', kind: 'floor', w: 44, extent: 28,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 44, top: 52 }),
    box: (p) => [p.x, 52, 44, 18],
    spots: (p) => [{ x: p.x + 34, y: 52, types: ['can', 'mug', 'paper'] }],
    draw(p) {
      const d = p.shown; const { x } = p;
      const wrecked = d >= WRECKED;
      // pegboard with tool outlines
      rect(x, 28, 44, 20, mix('#9c7b4f', '#d4a373', 1 - d * 0.5));
      for (let i = 2; i < 44; i += 4) for (let j = 30; j < 48; j += 4) px(x + i, j, mix('#6b5436', '#a47148', 0.5));
      rect(x + 4, 31, 2, 10, '#495057'); rect(x + 3, 31, 4, 3, '#adb5bd'); // hammer
      rect(x + 11, 30, 1, 12, '#adb5bd'); rect(x + 10, 40, 3, 3, '#e63946'); // screwdriver
      rect(x + 17, 32, 8, 2, '#adb5bd'); rect(x + 17, 34, 2, 6, '#adb5bd'); // wrench
      if (!wrecked) { rect(x + 30, 31, 9, 7, '#ffb703'); rect(x + 31, 38, 3, 3, '#2b2233'); } // drill (fell off when wrecked)
      else { rect(x + 30, 31, 9, 7, '#00000022'); }
      // bench
      const wood = mix('#6d4c2f', '#b5835a', 1 - d);
      rect(x, 52, 44, 3, wood); rect(x, 52, 44, 1, mix('#7d5a3a', '#c9965f', 1 - d));
      rect(x + 2, 55, 3, 15, wood); rect(x + 39, 55, 3, wrecked ? 11 : 15, wood);
      if (wrecked) rect(x + 38, 66, 5, 4, '#adb5bd'); // propped on a paint can
      rect(x + 4, 62, 36, 2, wood); // lower shelf
      rect(x + 8, 58, 6, 4, '#e63946'); rect(x + 18, 59, 5, 3, '#457b9d'); // paint cans
      rect(x + 3, 49, 6, 3, '#495057'); rect(x + 4, 48, 4, 1, '#adb5bd'); // vise
      if (d > 0.33) { rect(x + 20, 51, 8, 1, '#adb5bd'); px(x + 26, 50, '#adb5bd'); } // tools left out
      grimeOverlay(p);
    },
  },

  toolchest: {
    name: 'TOOL CHEST', kind: 'floor', w: 18, extent: 46,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 18, top: 46 }),
    box: (p) => [p.x, 46, 18, 24],
    spots: (p) => [{ x: p.x + 9, y: 46, types: ['can', 'paper'] }],
    draw(p) {
      const d = p.shown; const { x } = p;
      const wrecked = d >= WRECKED;
      const red = mix('#6e3b3b', '#d62828', 1 - d);
      rect(x, 46, 18, 22, red);
      rect(x, 46, 18, 1, mix('#8a4b4b', '#f25c54', 1 - d));
      for (let i = 0; i < 5; i++) {
        const out = d > 0.33 && i === 2 ? 2 : 0;
        rect(x + 1, 48 + i * 4 + out, 16, 3, mix('#5a2f2f', '#b71c1c', 1 - d)); rect(x + 6, 49 + i * 4 + out, 6, 1, '#adb5bd');
      }
      rect(x + 1, 68, 3, 2, '#2b2233'); rect(x + 14, 68, 3, wrecked ? 1 : 2, '#2b2233'); // casters
      if (wrecked) { rect(x + 18, 64, 4, 1, '#adb5bd'); px(x + 20, 63, '#adb5bd'); }
      grimeOverlay(p);
    },
  },

  rack: {
    name: 'STORAGE RACK', kind: 'floor', w: 26, extent: 30,
    surface: (p) => ({ sx0: p.x, sx1: p.x + 26, top: 30 }),
    box: (p) => [p.x, 30, 26, 40],
    spots: (p) => [{ x: p.x + 13, y: 30, types: ['book', 'can'] }],
    draw(p) {
      const d = p.shown; const { x } = p;
      const wrecked = d >= WRECKED;
      const metal = mix('#5c616b', '#9aa3ad', 1 - d * 0.6);
      rect(x, 30, 2, 40, metal); rect(x + 24, 30, 2, 40, metal);
      const boxes = ['#c9a26b', '#b08d57', '#d4b483', '#457b9d'];
      for (let s = 0; s < 4; s++) {
        const sy = 30 + s * 10;
        if (wrecked && s === 2) { for (let i = 0; i < 22; i++) px(x + 2 + i, sy + Math.floor(i / 6), metal); }
        else rect(x + 2, sy, 22, 1, metal);
        if (s < 3) {
          rect(x + 3, sy + 3, 9, 7, boxes[(s + p.variant) % 4]); rect(x + 13, sy + 5 - (d > 0.33 && s === 1 ? 2 : 0), 8, 5, boxes[(s + 2) % 4]);
          rect(x + 5, sy + 5, 5, 1, '#6b5436');
        }
      }
      if (d > 0.33) { rect(x + 20, 66, 7, 4, '#c9a26b'); } // box fell off
      grimeOverlay(p);
    },
  },

  car: {
    name: 'CAR', kind: 'floor', w: 74, extent: 50,
    surface: (p) => ({ sx0: p.x + 24, sx1: p.x + 52, top: 50 }),
    box: (p) => [p.x, 50, 74, 20],
    spots: (p) => [{ x: p.x + 60, y: 58, types: ['can', 'paper', 'pizza'] }],
    draw(p) {
      const d = p.shown; const { x } = p;
      const wrecked = d >= WRECKED;
      const paint = mix('#6b6b6b', ['#e63946', '#3a86ff', '#ffb703', '#2a9d8f'][p.variant % 4], 1 - d * 0.8);
      const shade = mix('#4a4a4a', ['#b71c1c', '#1d4ed8', '#d48800', '#1d6d63'][p.variant % 4], 1 - d * 0.8);
      rect(x + 22, 50, 32, 2, paint); // roof
      rect(x + 18, 52, 40, 6, paint); // cabin
      rect(x + 23, 52, 13, 5, '#bde0fe'); rect(x + 38, 52, 14, 5, '#bde0fe'); // windows
      if (wrecked) crack(x + 40, 52, '#ffffff');
      rect(x + 2, 58, 70, 8, paint); rect(x + 2, 64, 70, 2, shade);
      rect(x, 60, 3, 4, '#adb5bd'); rect(x + 71, 60, 3, 4, '#adb5bd'); // bumpers
      rect(x + 2, 59, 3, 2, '#fff3a3'); rect(x + 69, 59, 3, 2, '#e63946'); // lights
      rect(x + 37, 60, 3, 1, shade); // door handle
      const tire = (tx, flat) => { rect(tx, flat ? 66 : 64, 12, flat ? 4 : 6, '#1d1a26'); rect(tx + 4, flat ? 67 : 66, 4, 2, '#8d99ae'); };
      tire(x + 10, false); tire(x + 52, wrecked);
      if (d > 0.33) { for (let i = 0; i < 6; i++) rect(x + 6 + i * 11, 63 + (i % 2), 3, 2, '#6b5436'); } // mud
      grimeOverlay(p);
    },
  },

  tires: {
    name: 'TIRES', kind: 'wall', w: 14, bottom: 46, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 30, 14, 16],
    spots: () => [],
    draw(p) {
      const { x } = p;
      rect(x + 6, 28, 2, 3, '#495057');
      for (let i = 0; i < 2; i++) { rect(x + 1, 31 + i * 7, 12, 6, '#1d1a26'); rect(x + 4, 33 + i * 7, 6, 2, '#495057'); }
    },
  },

  neon: {
    name: 'SIGN', kind: 'wall', w: 30, bottom: 38, dirtable: false,
    surface: () => null,
    box: (p) => [p.x, 29, 30, 9],
    spots: () => [],
    draw(p) {
      const { x } = p;
      rect(x, 29, 30, 9, '#1d1a26');
      const on = Math.sin(time * 1.7) > -0.9;
      pixelText(ctx, 'OPEN', x + 7, 31, on ? '#ff4d8d' : '#5a2a3a');
      if (on) { ctx.globalAlpha = 0.15; rect(x - 2, 27, 34, 13, '#ff4d8d'); ctx.globalAlpha = 1; }
    },
  },
};

function makePiece(type, x, variant, seed, extra = {}) {
  const p = { type, x: Math.round(x), variant, seed, spec: CATALOG[type], dirt: 0, shown: 0, ...extra };
  p.grime = grimeFor(p);
  const s = p.spec.surface(p);
  if (s) Object.assign(p, s);
  p.box = p.spec.box(p);
  p.name = p.spec.name;
  p.dirtable = p.spec.dirtable !== false && Boolean(s);
  return p;
}

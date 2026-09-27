// Roombai landing page: downloads per OS, the live demo sizing, the night sky,
// the clean/wrecked slider, the spinning whiteboard and the sponsor pyramid.

// Update the version after a tagged release has published all installers.
const DOWNLOAD_VERSION = '0.1.0';
const RELEASE_ASSETS = `https://github.com/latinrev/roombai/releases/download/v${DOWNLOAD_VERSION}`;
const DOWNLOADS = {
  windows: { label: 'Download for Windows', href: `${RELEASE_ASSETS}/Roombai-Setup-${DOWNLOAD_VERSION}.exe` },
  mac: { label: 'Download for macOS', href: `${RELEASE_ASSETS}/Roombai-${DOWNLOAD_VERSION}-mac.dmg` },
  linux: { label: 'Download for Linux', href: `${RELEASE_ASSETS}/Roombai-${DOWNLOAD_VERSION}-linux-x86_64.AppImage` },
};

function detectOS() {
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
  if (/win/i.test(p)) return 'windows';
  if (/mac|iphone|ipad/i.test(p)) return 'mac';
  if (/linux|x11|cros/i.test(p)) return 'linux';
  return null;
}

const os = detectOS();
for (const a of document.querySelectorAll('.os[data-os]')) {
  const d = DOWNLOADS[a.dataset.os];
  a.href = d.href;
  if (a.dataset.os === os) a.classList.add('mine');
}
if (os) {
  for (const a of document.querySelectorAll('[data-download]')) a.href = DOWNLOADS[os].href;
  for (const s of document.querySelectorAll('[data-download-label]')) s.textContent = DOWNLOADS[os].label + ' · free';
}

// ---------- live demo: size the iframe to whole art pixels ----------
const demo = document.querySelector('.demo');
function fitDemo() {
  const screenEl = document.querySelector('.screen');
  const pad = parseFloat(getComputedStyle(demo.parentElement).paddingLeft) * 2;
  const w = screenEl.clientWidth - pad - 2;
  const dpr = window.devicePixelRatio || 1;
  let scale = w / 360;
  if (scale >= 1) scale = Math.floor(scale * dpr) / dpr;
  scale = Math.min(scale, 3);
  demo.style.width = Math.round(360 * scale) + 'px';
  demo.style.height = Math.round(104 * scale) + 'px';
}
fitDemo();
window.addEventListener('resize', fitDemo);

const soundBtn = document.querySelector('[data-sound]');
soundBtn.addEventListener('click', () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'Sound: on' : 'Sound: off';
  demo.contentWindow.postMessage({ roombaSound: on }, '*');
});

// taskbar clock
const clock = document.querySelector('[data-clock]');
const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
tickClock();
setInterval(tickClock, 15000);

// ---------- night sky: pixel stars and a skyline, drawn at art resolution ----------
const sky = document.querySelector('.sky');
const sctx = sky.getContext('2d');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let stars = [];
let skyline = [];
function layoutSky() {
  const r = sky.getBoundingClientRect();
  sky.width = Math.ceil(r.width / 4);
  sky.height = Math.ceil(r.height / 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  stars = Array.from({ length: Math.round(sky.width * sky.height / 260) }, () => ({ x: Math.floor(rnd() * sky.width), y: Math.floor(rnd() * sky.height * 0.7), p: rnd() * 6, big: rnd() < 0.12 }));
  skyline = [];
  for (let x = 0; x < sky.width;) {
    const w = 6 + Math.floor(rnd() * 14);
    skyline.push({ x, w, h: 8 + Math.floor(rnd() * 26), lit: Array.from({ length: 6 }, () => [Math.floor(rnd() * (w - 2)) + 1, Math.floor(rnd() * 20) + 2, rnd() < 0.5]) });
    x += w + Math.floor(rnd() * 3);
  }
}
function drawSky(t) {
  const W = sky.width; const H = sky.height;
  const bands = ['#221830', '#2a1d38', '#33243f', '#3c2a46', '#4d2f4f'];
  bands.forEach((c, i) => { sctx.fillStyle = c; sctx.fillRect(0, Math.floor(H * 0.55 + i * H * 0.09), W, H); });
  sctx.fillStyle = bands[0]; sctx.fillRect(0, 0, W, Math.floor(H * 0.55));
  for (const s of stars) {
    const on = reduced || Math.sin(t / 700 + s.p) > -0.4;
    if (!on) continue;
    sctx.fillStyle = s.big ? '#ffd166' : '#f6e9ee';
    sctx.fillRect(s.x, s.y, 1, 1);
    if (s.big) { sctx.fillRect(s.x - 1, s.y, 3, 1); sctx.fillRect(s.x, s.y - 1, 1, 3); }
  }
  sctx.fillStyle = '#fdf6c9'; // moon
  const mx = Math.floor(W * 0.82); const my = Math.floor(H * 0.12);
  sctx.fillRect(mx, my, 8, 8); sctx.fillStyle = bands[0]; sctx.fillRect(mx - 3, my - 2, 7, 7);
  for (const b of skyline) {
    sctx.fillStyle = '#1a1226';
    sctx.fillRect(b.x, H - b.h, b.w, b.h);
    for (const [lx, ly, on] of b.lit) if (on && ly < b.h - 1) { sctx.fillStyle = '#ffd166'; sctx.fillRect(b.x + lx, H - b.h + ly, 1, 1); }
  }
  if (!reduced) requestAnimationFrame(drawSky);
}
layoutSky();
requestAnimationFrame(drawSky);
window.addEventListener('resize', () => { layoutSky(); if (reduced) drawSky(0); });

// ---------- clean / wrecked slider ----------
const compare = document.querySelector('.compare');
compare.querySelector('.compare-range').addEventListener('input', (e) => compare.style.setProperty('--pos', e.target.value + '%'));

// ---------- the whiteboard spins ----------
const board = document.querySelector('.board-flip');
const faces = [
  ['assets/board-todo.png', 'Whiteboard, TODO side: agents and your own notes'],
  ['assets/board-issues.png', 'Whiteboard, ISSUES side: open GitHub issues tinted by label'],
  ['assets/board-prs.png', 'Whiteboard, PRS side: pull requests with CI lights'],
];
let face = 0;
function spinBoard() {
  if (board.classList.contains('spinning')) return;
  board.classList.add('spinning');
  setTimeout(() => {
    face = (face + 1) % faces.length;
    const img = board.querySelector('[data-face]');
    img.src = faces[face][0]; img.alt = faces[face][1];
    board.classList.remove('spinning');
  }, 260);
}
board.addEventListener('click', spinBoard);
board.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); spinBoard(); } });
for (const f of faces) { const i = new Image(); i.src = f[0]; }

// ---------- sponsor pyramids: 1, 2, 3, 4 (in the page, and on both side rails) ----------
for (const pyramid of document.querySelectorAll('[data-pyramid]')) {
  const side = pyramid.dataset.side || 'page';
  for (let row = 1; row <= 4; row++) {
    const r = document.createElement('div');
    r.className = 'pyramid-row';
    for (let i = 0; i < row; i++) {
      const a = document.createElement('a');
      a.className = 'slot';
      a.href = 'mailto:hello@example.com?subject=Roomba%20Room%20sponsor%20square';
      a.innerHTML = row <= 2 || side === 'page' ? '<i>+</i><span>Your company here</span>' : '<i>+</i>';
      a.title = 'Your company here';
      a.setAttribute('aria-label', `Sponsor square (${side}, row ${row}): your company here`);
      r.append(a);
    }
    pyramid.append(r);
  }
}

// ---------- gentle reveals ----------
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.15 });
for (const el of document.querySelectorAll('.how, .feature, .setup, .sponsors > *, .download > *')) { el.classList.add('reveal'); io.observe(el); }

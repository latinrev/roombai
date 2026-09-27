// Stands in for the desktop app's bridge so the real room runs in a web page.
// Everything here is pretend: five made-up agents across three made-up projects.
(() => {
  const now = Date.now();
  const P = { shop: 'c:/code/webshop', api: 'c:/code/api-gateway', blog: 'c:/code/blog' };
  const agents = [
    { id: 'demo:1', provider: 'claude', host: 't3code', cwd: P.shop, project: 'webshop', title: 'Fix checkout on mobile', status: 'working' },
    { id: 'demo:2', provider: 'codex', host: 'cli', cwd: P.shop, project: 'webshop', title: 'Add dark mode', status: 'working' },
    { id: 'demo:3', provider: 'codex', host: 'codex-app', cwd: P.api, project: 'api-gateway', title: 'Rate limit the public API', status: 'waiting' },
    { id: 'demo:4', provider: 'claude', host: 'cli', cwd: P.api, project: 'api-gateway', title: 'Migrate to Postgres 17', status: 'done' },
    { id: 'demo:5', provider: 'codex', host: 't3code', cwd: P.blog, project: 'blog', title: 'Write the launch post', status: 'working' },
  ].map((a, i) => ({
    ...a, sessionId: 'demo-' + i, turns: 1, toolCalls: 0,
    since: now - (5 + i * 7) * 60e3, lastEventAt: now,
    detail: {
      working: 'Pretend agent. Reading files, running tests, making a mess.',
      waiting: 'Pretend agent. Wants permission to run the migration.',
      done: 'Pretend agent. All done, tests are green.',
    }[a.status],
  }));
  const NEXT = { working: ['working', 'working', 'done', 'waiting'], waiting: ['working'], done: ['idle', 'working'], idle: ['working'], stuck: ['working'] };
  const DETAIL = {
    working: 'Pretend agent. Reading files, running tests, making a mess.',
    waiting: 'Pretend agent. Wants permission to run a command.',
    stuck: 'Pretend agent. Hit an error and is spinning its wheels.',
    done: 'Pretend agent. All done, tests are green.',
    idle: 'Pretend agent. Napping at the dock.',
  };
  const hidden = new Set();
  const listeners = {};
  const snapshot = () => agents.filter((a) => !hidden.has(a.id)).map((a) => ({ ...a }));
  const emit = () => listeners.agents && listeners.agents(snapshot());

  function tick() {
    const t = Date.now();
    for (const a of agents) {
      a.lastEventAt = t;
      if (a.status === 'working') {
        a.toolCalls += Math.floor(Math.random() * 3);
        if (Math.random() < 0.06) a.turns += 1;
      }
    }
    if (Math.random() < 0.18) {
      const a = agents[Math.floor(Math.random() * agents.length)];
      const opts = NEXT[a.status] || ['working'];
      let next = opts[Math.floor(Math.random() * opts.length)];
      if (next === 'waiting' && Math.random() < 0.35) next = 'stuck';
      if (next !== a.status) { a.status = next; a.since = t; a.detail = DETAIL[next]; if (next === 'working') a.turns += 1; }
    }
    emit();
  }

  const fake = (n, title, extra) => ({ number: n, title, url: 'https://github.com/', updatedAt: new Date(now - n * 3.6e6).toISOString(), author: 'you', ...extra });
  const gh = {
    state: 'ok',
    repos: [{
      slug: 'you/webshop (pretend)',
      issues: [
        fake(42, 'Cart badge shows the wrong count', { labels: [{ name: 'bug', color: '#d73a4a' }], comments: 3 }),
        fake(41, 'Add Apple Pay', { labels: [{ name: 'enhancement', color: '#a2eeef' }], comments: 0 }),
        fake(38, 'Footer links 404 on /about', { labels: [{ name: 'bug', color: '#d73a4a' }], comments: 1 }),
        fake(35, 'Search is slow with 10k products', { labels: [{ name: 'perf', color: '#fbca04' }], comments: 5 }),
        fake(31, 'Translate checkout to Spanish', { labels: [{ name: 'i18n', color: '#0e8a16' }], comments: 0 }),
      ],
      prs: [
        fake(44, 'Fix checkout on mobile', { ci: 'pending', review: 'REVIEW_REQUIRED', branch: 'fix/mobile-checkout' }),
        fake(43, 'Dark mode', { ci: 'pass', review: 'APPROVED', branch: 'feat/dark-mode' }),
        fake(39, 'Bump deps', { ci: 'fail', review: '', branch: 'chore/deps', draft: true }),
      ],
    }],
  };

  let muted = true;
  let collapsed = false;
  const tellParent = (data) => { if (window.parent !== window) window.parent.postMessage(data, window.location.origin); };
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== window.location.origin) return;
    if (e.data && e.data.roombaSound !== undefined) { muted = !e.data.roombaSound; listeners.config && listeners.config(cfg()); }
    if (e.data && e.data.roombaRelease) {
      window.dispatchEvent(new MouseEvent('mouseup', e.data.roombaRelease));
    }
  });
  const cfg = () => {
    const dpr = window.devicePixelRatio || 1;
    const raw = window.innerWidth / 360;
    const fit = raw >= 1 ? Math.floor(raw * dpr) / dpr : raw; // shrink below 1x on phones
    return { version: document.querySelector('meta[name="roombai-version"]')?.content, scale: fit, muted, collapsed, onTop: true, anchor: 'free', size: 3 };
  };

  window.bridge = {
    onAgents(fn) { listeners.agents = fn; setTimeout(emit, 30); setInterval(tick, 1200); },
    onConfig(fn) { listeners.config = fn; const go = () => fn(cfg()); window.addEventListener('resize', go); setTimeout(go, 0); },
    onFocusAgent() {},
    setIgnore() {},
    dragStart(screenX, screenY) { tellParent({ roombaDrag: 'start', screenX, screenY }); },
    dragMove(dx, dy) { tellParent({ roombaDrag: 'move', dx, dy }); },
    dragEnd() { tellParent({ roombaDrag: 'end' }); },
    setOption(key, value) {
      if (key === 'muted') muted = Boolean(value);
      if (key === 'collapsed') { collapsed = Boolean(value); tellParent({ roombaCollapsed: collapsed }); }
      if (listeners.config) listeners.config(cfg());
    },
    ack(id) { const a = agents.find((k) => k.id === id); if (a) { a.status = 'idle'; a.detail = DETAIL.idle; emit(); } },
    hide(id) { hidden.add(id); emit(); setTimeout(() => { hidden.delete(id); const a = agents.find((k) => k.id === id); if (a) { a.status = 'working'; a.turns += 1; } emit(); }, 9000); },
    jump: async () => 'Nowhere to jump to',
    loadTodos: async () => [{ id: 'demo-todo', text: 'Ship the landing page', createdAt: now - 3.6e6, done: false }],
    saveTodos() {},
    loadRooms: async () => null,
    saveRooms() {},
    github: async () => gh,
    openUrl() {},
  };
})();

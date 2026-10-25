#!/usr/bin/env node
// Drives the renderer of one verify run over the Chrome DevTools Protocol.
import fs from 'node:fs';

const usage = `usage: cdp.mjs RUN_DIR <command>
  eval <js>             print the JSON value of <js> run in the renderer
  shot <out.png>        save a screenshot of the whole window (room, cards, menus)
  canvas <out.png>      save the room canvas at art resolution (360x104)
  click <css-selector>  real mouse click at the center of a visible element
  tap <js>              real mouse click at room art pixels; <js> returns {x, y}`;

const [runDir, cmd, arg] = process.argv.slice(2);
if (!runDir || !cmd || !arg) { console.error(usage); process.exit(2); }

const env = Object.fromEntries(fs.readFileSync(`${runDir}/run.env`, 'utf8').trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
const targets = await (await fetch(`http://127.0.0.1:${env.CDP_PORT}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url === `file://${env.REPO}/src/renderer/index.html`);
if (!page) throw new Error(`no renderer page for ${env.REPO} on CDP port ${env.CDP_PORT}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map();
let seq = 0;
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function press({ x, y }) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  console.log(JSON.stringify({ x, y }));
}

const save = (out, base64) => { fs.writeFileSync(out, Buffer.from(base64, 'base64')); console.log(out); };

try {
  if (cmd === 'eval') console.log(JSON.stringify(await evaluate(arg), null, 2));
  else if (cmd === 'shot') save(arg, (await send('Page.captureScreenshot', { format: 'png' })).data);
  else if (cmd === 'canvas') save(arg, (await evaluate('document.getElementById("room").toDataURL()')).split(',')[1]);
  else if (cmd === 'click') {
    const at = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(arg)});
      if (!el || el.closest('[hidden]') || !el.getClientRects().length) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    })()`);
    if (!at) throw new Error(`no visible element matches ${arg}`);
    await press(at);
  } else if (cmd === 'tap') {
    await press(await evaluate(`(() => { const p = (${arg}); return { x: p.x * scale, y: (p.y - viewTop) * scale + head }; })()`));
  } else { console.error(usage); process.exitCode = 2; }
} finally {
  ws.close();
}

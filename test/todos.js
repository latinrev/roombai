// Dev-only: exercises the todo board and the agent card (run via ROOM_SCRIPT).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (x, y) => ({ clientX: x * scale, clientY: y * scale, screenX: 0, screenY: 0, bubbles: true, button: 0 });
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', at(x, y)));
  const down = (x, y) => { move(x, y); canvas.dispatchEvent(new MouseEvent('mousedown', at(x, y))); };
  const up = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', at(x, y)));
  const log = [];
  const before = todos.length;

  down(PLUS.x + 3, PLUS.y + 3); up(PLUS.x + 3, PLUS.y + 3);
  log.push('pop open: ' + !todoPopEl.hidden);
  for (const t of ['TEST add dark mode', 'TEST release notes', 'TEST flaky login']) {
    $('todo-input').value = t;
    $('todo-form').dispatchEvent(new Event('submit', { cancelable: true }));
  }
  log.push('added: ' + (todos.length - before));
  closeTodoPop();
  await sleep(300);

  const n = noteLayout().filter((k) => k.todo && k.todo.text.startsWith('TEST'))[1];
  down(n.x + 4, n.y + 3);
  for (let i = 1; i <= 8; i++) { move(n.x + 4 + ((TRASH.x + 4 - n.x - 4) * i) / 8, n.y + 3 + ((TRASH.y - n.y - 3) * i) / 8); await sleep(30); }
  up(TRASH.x + 4, TRASH.y);
  log.push('after toss: ' + todos.filter((t) => t.text.startsWith('TEST')).map((t) => t.text).join(' / '));

  await sleep(300);
  const r = [...roombas.values()].find((k) => k.agent.host === 't3code' && k.mode === 'floor') || [...roombas.values()][0];
  down(r.x, r.d - 3); up(r.x, r.d - 3);
  showTip(r, true);
  log.push('card: ' + r.agent.host + ' button="' + $('tip-jump').textContent + '" visible=' + !$('tip-jump').hidden);
  console.log('[todos] ' + log.join(' | '));
  // clean up the test notes so they don't linger
  todos = todos.filter((t) => !t.text.startsWith("TEST")); saveTodos();
})();

const $ = id => document.getElementById(id);
const money = amount => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount / 100);
const date = seconds => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const params = new URLSearchParams(location.search);
let catalog, selected, logo = '', owner, managed, renewal = null, pendingId, busy = false;
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
async function api(path = '', options = {}) {
  const response = await fetch(`/api/sponsors${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load sponsorships. Please try again.');
  return data;
}
function error(message) { $('form-error').textContent = message; $('form-error').hidden = !message; }
function select(slot) {
  selected = slot; pendingId = null;
  document.querySelectorAll('.picker-slot').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.slot === slot.id)));
  $('selected-slot').textContent = `${slot.side === 'left' ? 'Left' : 'Right'} wall · row ${slot.row} · square ${slot.id.split('-')[2]} · ${money(slot.amount)} USD`;
  updatePay();
  updateTerm();
  preview();
}
function updateTerm() {
  const start = Math.max(Date.now() / 1000, renewal ? managed.endsAt || 0 : 0);
  $('term-preview').textContent = renewal && start > Date.now() / 1000
    ? `Adds 30 days to your current term. New expiry: ${date(start + 30 * 86400)}.`
    : `30 days from payment confirmation. If paid now, ends ${date(start + 30 * 86400)}.`;
}
function updatePay() {
  $('pay').disabled = busy || !catalog?.enabled || !selected;
  $('pay').textContent = busy ? 'Opening secure checkout…' : !catalog?.enabled ? 'Checkout opens soon' : selected ? `Pay ${money(selected.amount)} for 30 days` : 'Choose a square';
}
function renderPicker() {
  $('slot-picker').replaceChildren();
  for (const side of ['left', 'right']) {
    const wall = document.createElement('div'); wall.className = 'picker-wall';
    const title = document.createElement('h3'); title.textContent = `${side === 'left' ? 'Left' : 'Right'} wall`; wall.append(title);
    for (let row = 1; row <= 4; row++) {
      const strip = document.createElement('div'); strip.className = 'picker-row';
      for (const slot of catalog.slots.filter(s => s.side === side && s.row === row)) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'picker-slot'; button.dataset.slot = slot.id;
        const own = renewal && managed.slot === slot.id;
        button.disabled = slot.reserved || (!!slot.sponsor && !own);
        button.textContent = slot.reserved ? 'Held' : slot.sponsor && !own ? 'Taken' : money(slot.amount);
        button.setAttribute('aria-label', `${side} wall, row ${row}, square ${slot.id.split('-')[2]}: ${button.disabled ? button.textContent : money(slot.amount) + ' for 30 days'}`);
        button.setAttribute('aria-pressed', String(selected?.id === slot.id));
        button.addEventListener('click', () => { if (renewal && slot.id !== managed.slot) { renewal = null; renderPicker(); } select(slot); });
        strip.append(button);
      }
      wall.append(strip);
    }
    $('slot-picker').append(wall);
  }
}
function preview() {
  $('preview-name').textContent = $('company').value || 'Your company';
  $('preview-website').textContent = $('website').value || 'Your link goes here';
  $('preview-placement').textContent = selected
    ? `${selected.side === 'left' ? 'Left' : 'Right'} wall · row ${selected.row} · square ${selected.id.split('-')[2]} · ${money(selected.amount)} USD / 30 days`
    : 'Choose a square to see its placement and price.';
  if (logo) { const img = new Image(); img.src = logo; img.alt = 'Your logo preview'; $('logo-preview').replaceChildren(img); }
}
async function loadCatalog() {
  catalog = await api();
  $('service-status').hidden = catalog.enabled;
  $('service-status').textContent = 'Sponsor checkout is being prepared. You can preview your square below; payments are not open yet.';
  renderPicker(); updatePay();
  const initial = catalog.slots.find(s => s.id === params.get('slot') && !s.sponsor && !s.reserved);
  if (initial && !selected) select(initial);
}
async function refreshOrder() {
  try {
    managed = await api(`/order/${owner.id}`, { headers: { Authorization: `Bearer ${owner.token}` } });
    const active = managed.status === 'active' && managed.endsAt > Date.now() / 1000;
    const text = active ? `${managed.company} is on the wall until ${date(managed.endsAt)}.`
      : managed.status === 'active' ? 'Your 30-day placement has ended. Renew if the square is still available.'
      : managed.status === 'processing' ? 'Stripe is confirming your payment. Your square is held; your 30 days start once payment succeeds.'
      : ['creating','open'].includes(managed.status) ? 'Your checkout is not complete yet. If you just paid, refresh the status in a moment.'
      : managed.status === 'removed' ? 'This placement has been removed. Contact support@nottifai.com for help.'
      : 'This checkout ended without an active placement. You can choose a square and start again.';
    $('manage-status').textContent = text;
    $('renew').hidden = managed.status !== 'active';
    $('resume-checkout').hidden = !managed.checkoutUrl;
    if (managed.checkoutUrl) $('resume-checkout').href = managed.checkoutUrl;
    await loadCatalog();
  } catch (e) { $('manage-status').textContent = e.message; }
}
$('refresh-status').addEventListener('click', refreshOrder);
$('copy-link').addEventListener('click', async () => {
  const link = `${location.origin}/sponsor/?order=${owner.id}#${owner.token}`;
  try { await navigator.clipboard.writeText(link); $('copy-link').textContent = 'Copied! Save it somewhere safe'; }
  catch { $('manage-status').textContent = 'Copy this page’s address from your browser to save your private link.'; history.replaceState(null, '', link); }
});
$('renew').addEventListener('click', () => {
  renewal = managed.id;
  logo = managed.logo; $('company').value = managed.company; $('website').value = managed.website;
  renderPicker();
  const slot = catalog.slots.find(s => s.id === managed.slot);
  if (!slot || slot.reserved || (slot.sponsor && slot.sponsor.logo !== `/api/sponsors/logo/${managed.id}`)) {
    error('This square is no longer available to renew. Please choose another square.'); renewal = null; return;
  }
  select(slot); preview(); $('details-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('company').addEventListener('input', preview); $('website').addEventListener('input', preview);
$('logo').addEventListener('change', async () => {
  error(''); const file = $('logo').files[0]; if (!file) return;
  logo = ''; $('logo-preview').textContent = 'Loading…';
  try {
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('Choose a PNG, JPG, or WebP under 2 MB.');
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 192 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    logo = canvas.toDataURL('image/png');
    if (logo.length > 90000) { logo = ''; throw new Error('This logo is too detailed. Try a simpler or smaller image.'); }
    pendingId = null; preview();
  } catch (e) { $('logo-preview').textContent = 'Your logo'; error(e.message); }
});
$('sponsor-form').addEventListener('input', () => { if (!busy) pendingId = null; });
$('sponsor-form').addEventListener('submit', async e => {
  e.preventDefault(); error('');
  if (!selected || !catalog.enabled || busy) return;
  if (!logo) { error('Please choose a company logo.'); $('logo').focus(); return; }
  try {
    busy = true; updatePay();
    pendingId ||= crypto.randomUUID();
    const token = renewal ? owner.token : newToken();
    // Persist before redirecting. Management secrets never go to Stripe or into server logs.
    const stored = localStorage.getItem(`sponsor:${pendingId}`);
    const savedToken = stored || token;
    localStorage.setItem(`sponsor:${pendingId}`, savedToken);
    const result = await api('/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      id: pendingId, token: savedToken, slot: selected.id, company: $('company').value, website: $('website').value,
      logo, agreed: $('agreed').checked, renewOrder: renewal,
    }) });
    location.assign(result.url);
  } catch (e) { error(e.message); busy = false; updatePay(); }
});
try {
  await loadCatalog();
  const id = params.get('order');
  if (id && /^[0-9a-f-]{36}$/.test(id)) {
    const fragment = location.hash.slice(1);
    let token;
    try { token = /^[0-9a-f]{64}$/.test(fragment) ? fragment : localStorage.getItem(`sponsor:${id}`); } catch { /* link still works without storage */ }
    $('manage').hidden = false;
    if (token) {
      owner = { id, token };
      await refreshOrder();
    } else {
      $('manage-status').textContent = 'Open this page in the browser you used for checkout, or use your saved private link. Lost it? Contact support@nottifai.com or @joeldev_ on Twitter using the links below. Recovery is handled manually and may take a few days.';
      $('copy-link').hidden = true; $('refresh-status').hidden = true;
    }
  }
} catch (e) { $('service-status').textContent = 'Could not load sponsor squares. Please refresh to try again.'; }

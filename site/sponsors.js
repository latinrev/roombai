// Public placements are read at runtime; buying a square never needs a deployment.
const prices = [49, 29, 19, 9];
const popup = document.createElement('div');
popup.className = 'sponsor-popup'; popup.id = 'sponsor-popup'; popup.hidden = true;
popup.setAttribute('role', 'region'); popup.setAttribute('aria-label', 'Sponsor details');
const popupName = document.createElement('strong');
const popupLabel = document.createElement('span'); popupLabel.textContent = 'Roombai sponsor';
const popupLink = document.createElement('a'); popupLink.target = '_blank'; popupLink.rel = 'sponsored noopener noreferrer';
popup.append(popupLabel, popupName, popupLink); document.body.append(popup);
let popupOwner, hideTimer;
function closePopup() {
  clearTimeout(hideTimer); popup.hidden = true;
  popupOwner?.setAttribute('aria-expanded', 'false'); popupOwner = null;
}
function positionPopup() {
  if (!popupOwner) return;
  const r = popupOwner.getBoundingClientRect(), gap = 12, margin = 12;
  const width = popup.offsetWidth, height = popup.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  let left = r.right + gap;
  if (left + width > viewportWidth - margin) left = r.left - width - gap;
  if (left < margin) left = Math.max(margin, Math.min(r.left, viewportWidth - width - margin));
  let top = r.top;
  if (left < r.right && left + width > r.left) top = r.bottom + gap;
  popup.style.left = `${left}px`;
  popup.style.top = `${Math.max(margin, Math.min(top, innerHeight - height - margin))}px`;
}
function showPopup(anchor, sponsor) {
  clearTimeout(hideTimer);
  if (popupOwner !== anchor) popupOwner?.setAttribute('aria-expanded', 'false');
  popupOwner = anchor; popupName.textContent = sponsor.company;
  popupLink.href = sponsor.website;
  popupLink.textContent = `Visit ${new URL(sponsor.website).hostname}`;
  popup.hidden = false; anchor.setAttribute('aria-expanded', 'true'); positionPopup();
}
function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(closePopup, 180); }
popup.addEventListener('pointerenter', () => clearTimeout(hideTimer));
popup.addEventListener('pointerleave', scheduleHide);
popup.addEventListener('focusin', () => clearTimeout(hideTimer));
popup.addEventListener('focusout', scheduleHide);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });
document.addEventListener('pointerdown', e => { if (!popup.contains(e.target) && !popupOwner?.contains(e.target)) closePopup(); });
window.addEventListener('resize', positionPopup);
window.addEventListener('scroll', positionPopup, true);
const fallback = ['left', 'right'].flatMap(side => prices.flatMap((price, i) => Array.from({ length: i + 1 }, (_, j) => ({
  id: `${side}-${i + 1}-${j + 1}`, side, row: i + 1, amount: price * 100, sponsor: null,
}))));
function render(slots) {
  closePopup();
  for (const pyramid of document.querySelectorAll('[data-pyramid]')) {
    const sides = pyramid.dataset.side ? [pyramid.dataset.side] : ['left', 'right'];
    pyramid.replaceChildren();
    for (const side of sides) {
      const wall = document.createElement('div'); wall.className = 'public-wall';
      if (sides.length > 1) { const heading = document.createElement('h3'); heading.textContent = `${side === 'left' ? 'Left' : 'Right'} wall`; wall.append(heading); }
      for (let row = 1; row <= 4; row++) {
        const strip = document.createElement('div'); strip.className = 'pyramid-row';
        for (const slot of slots.filter(s => s.side === side && s.row === row)) {
          const a = document.createElement('a'); a.className = 'slot';
          a.href = slot.sponsor ? slot.sponsor.website : `/sponsor/?slot=${slot.id}`;
          if (slot.sponsor) {
            a.classList.add('slot-filled'); a.target = '_blank'; a.rel = 'sponsored noopener noreferrer';
            const img = new Image(); img.src = slot.sponsor.logo; img.alt = slot.sponsor.company; img.loading = 'lazy';
            a.append(img);
            a.setAttribute('aria-label', `${slot.sponsor.company} · Roombai sponsor`);
            a.setAttribute('aria-controls', popup.id); a.setAttribute('aria-expanded', 'false');
            a.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') showPopup(a, slot.sponsor); });
            a.addEventListener('pointerleave', scheduleHide);
            a.addEventListener('focus', () => showPopup(a, slot.sponsor));
            a.addEventListener('blur', scheduleHide);
            let touch = false;
            a.addEventListener('pointerdown', e => { touch = e.pointerType === 'touch'; });
            a.addEventListener('click', e => { if (touch) { e.preventDefault(); showPopup(a, slot.sponsor); } });
          } else {
            const icon = document.createElement('i'); icon.textContent = '+';
            const label = document.createElement('span');
            label.textContent = slot.reserved ? 'Held' : `$${slot.amount / 100}${pyramid.dataset.side && row > 1 ? '' : ' / 30 days'}`;
            a.append(icon, label); a.title = `${side} wall, row ${row}: ${slot.reserved ? 'Checkout in progress' : `$${slot.amount / 100} for 30 days`}`;
          }
          if (!slot.sponsor) a.setAttribute('aria-label', a.title);
          strip.append(a);
        }
        wall.append(strip);
      }
      pyramid.append(wall);
    }
  }
}
render(fallback);
let rendered = '';
async function refresh() {
  try {
    const response = await fetch('/api/sponsors'); if (!response.ok) return;
    const { slots } = await response.json();
    // Rebuilding closes an open popup and reloads logos, so only do it when placements change.
    const key = JSON.stringify(slots);
    if (key !== rendered) { rendered = key; render(slots); }
  }
  catch { /* Keep the claim links usable while the API is temporarily unavailable. */ }
}
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 60000);

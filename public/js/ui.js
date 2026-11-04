// Utilitários de UI: el(), menu de contexto, modal, toast, som
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

// ---------- menu de contexto ----------
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
document.addEventListener('pointerdown', (e) => { if (openMenu && !e.target.closest('.menu')) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

function buildMenu(items) {
  const m = el('div', { class: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.title) { m.append(el('div', { class: 'menu-title' }, it.title)); continue; }
    const row = el('div', { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '') },
      it.icon ? el('span', { class: 'mi' }, it.icon) : el('span', { class: 'mi' }),
      el('span', { class: 'ml' }, it.label), it.kbd ? el('kbd', {}, it.kbd) : null, it.sub ? el('span', { class: 'arrow' }, '›') : null);
    if (it.sub) {
      let subEl;
      row.addEventListener('pointerenter', () => {
        subEl?.remove(); subEl = buildMenu(it.sub); subEl.classList.add('submenu'); row.append(subEl);
        const r = subEl.getBoundingClientRect();
        if (r.right > innerWidth - 8) { subEl.style.left = 'auto'; subEl.style.right = '100%'; }
        if (r.bottom > innerHeight - 8) subEl.style.top = -(r.bottom - innerHeight + 12) + 'px';
      });
      row.addEventListener('pointerleave', () => { subEl?.remove(); subEl = null; });
    } else if (!it.disabled) row.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); it.fn?.(); });
    m.append(row);
  }
  return m;
}

export function menu(items, x, y) {
  closeMenu();
  const m = buildMenu(items);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  document.body.append(m); openMenu = m;
  const r = m.getBoundingClientRect();
  if (r.right > innerWidth - 8) m.style.left = Math.max(8, innerWidth - r.width - 8) + 'px';
  if (r.bottom > innerHeight - 8) m.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
}

// ---------- modal ----------
export function modal({ title, wide, cls = '', onClose } = {}) {
  const body = el('div', { class: 'modal-body' });
  const root = el('div', { class: 'overlay' },
    el('div', { class: `modal ${wide ? 'wide' : ''} ${cls}`, role: 'dialog' },
      el('div', { class: 'modal-head' }, el('h2', {}, title || ''), el('button', { class: 'x', title: 'Fechar (Esc)', onclick: () => close() }, '✕')), body));
  const close = () => { root.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => { if (e.key === 'Escape' && [...document.querySelectorAll('.overlay')].pop() === root) close(); };
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(root);
  return { root, body, close, setTitle: (t) => (root.querySelector('h2').textContent = t) };
}

// ---------- toast ----------
export function toast(text, kind = '') {
  const t = el('div', { class: 'toast ' + kind }, text);
  document.getElementById('toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, 3200);
}

// ---------- som ----------
let ac;
export function beep(kind = 'point') {
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'call' ? [660, 880] : kind === 'turn' ? [440, 660, 880] : [740];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.09;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.25);
    });
  } catch {}
}

export const manaHTML = (cost) => (cost || '').replace(/\{([^}]+)\}/g, (_, s) => `<i class="pip pip-${s.replace(/[\/]/g, '').toLowerCase()}">${/^[0-9X]+$/.test(s) ? s : ''}</i>`);

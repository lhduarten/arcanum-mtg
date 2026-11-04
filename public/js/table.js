// A mesa: renderização incremental, arrastar/soltar, menus, pings, pilha, log
import { S, send, on, zoneIds, zoneCount, faceOf } from './net.js';
import { $, $$, el, menu, closeMenu, modal, toast, beep, manaHTML } from './ui.js';
import * as scry from './scry.js';

const els = new Map();        // id da carta -> elemento (reaproveitado entre zonas)
const seats = {};             // pid -> refs do assento
const peeked = {};            // cartas da biblioteca conhecidas via peek (só o dono vê)
const sel = new Set();
const dragging = new Set();
let seatSig = '', hoverId = null, zoneModals = [], zoom = 1;
export function setZoom(z) { zoom = z; for (const pid of Object.keys(seats)) sizeSeat(pid); }

export const getCard = (id) => S.cards[id] || peeked[id];
const me = () => S.players[S.you];
const canControl = (c) => c && (c.owner === S.you || c.pid === S.you);
const isMine = (c) => c && (c.pid === S.you || (c.owner === S.you && c.zone !== 'battlefield'));
const ZNAME = { library: 'Biblioteca', graveyard: 'Cemitério', exile: 'Exílio', command: 'Zona de comando', hand: 'Mão' };
const ZSHORT = { library: 'Biblioteca', graveyard: 'Cemitério', exile: 'Exílio', command: 'Comando' };
const COUNTERS = ['+1/+1', '-1/-1', 'loyalty', 'charge', 'lore', 'time', 'shield', 'stun', 'oil', 'level', 'flying', 'deathtouch', 'lifelink', 'indestructible'];
const CLABEL = { 'loyalty': 'lealdade', 'charge': 'carga', 'lore': 'saga', 'time': 'tempo', 'shield': 'escudo', 'stun': 'atordoar', 'oil': 'óleo', 'level': 'nível', 'defense': 'defesa' };

// ====================== ASSENTOS ======================
function orderedOthers() {
  const ps = Object.values(S.players).sort((a, b) => a.seat - b.seat);
  const i = ps.findIndex((p) => p.id === S.you);
  return [...ps.slice(i + 1), ...ps.slice(0, i)];
}

const PILES = ['library', 'graveyard', 'exile', 'command'];

function buildSeats() {
  const others = orderedOthers(); const mine = me(); if (!mine) return;
  const sig = [mine.id, ...others.map((p) => p.id)].join(',');
  if (sig === seatSig) return;
  seatSig = sig;
  $('#opps').innerHTML = ''; $('#me').innerHTML = '';
  $('#opps').dataset.n = others.length;
  for (const p of [...others, mine]) {
    const isMe = p.id === S.you;
    const head = el('div', { class: 'seat-head' },
      el('span', { class: 'dot' }), el('span', { class: 'pname' }),
      el('span', { class: 'turn-flag' }, 'TURNO'),
      el('div', { class: 'life' },
        el('button', { class: 'lb', 'data-life': -1, title: 'Perder vida (Shift = 5)' }, '−'),
        el('b', { class: 'lv', title: 'Clique para definir' }),
        el('button', { class: 'lb', 'data-life': 1, title: 'Ganhar vida (Shift = 5)' }, '+')),
      el('div', { class: 'pcounters' },
        ['poison', 'energy', 'exp', 'rad', 'tix'].map((k) => el('span', { class: 'pc pc-' + k, 'data-pc': k, title: { poison: 'Veneno', energy: 'Energia', exp: 'Experiência', rad: 'Rad', tix: 'Bilhetes' }[k] + ' (clique +1, direito −1)' }, el('i'), el('b', {})))),
      el('div', { class: 'cmdd' }, Object.values(S.players).filter((q) => q.id !== p.id).map((q) =>
        el('span', { class: 'cd', 'data-from': q.id, style: { '--c': q.color }, title: `Dano de comandante de ${q.name} (clique +1, direito −1)` }, el('i'), el('b', {}), el('em', {}, '/21')))),
      el('button', { class: 'pmore', title: 'Contadores e dano de comandante' }, '⋯'));
    const piles = el('div', { class: 'piles' }, PILES.map((z) => el('div', { class: 'pile', 'data-zone': z, 'data-pid': p.id, 'data-drop': 'pile', 'data-label': ZSHORT[z] },
      el('div', { class: 'pile-stack' }), el('div', { class: 'pile-label' }, ZSHORT[z]), el('div', { class: 'pile-count' }))));
    const bf = el('div', { class: 'bf', 'data-pid': p.id, 'data-drop': 'bf' }, el('div', { class: 'bf-hint' }, isMe ? 'Seu campo de batalha' : ''));
    const root = el('section', { class: 'seat' + (isMe ? ' me' : ''), 'data-pid': p.id, style: { '--pc': p.color } }, head, el('div', { class: 'seat-body' }, piles, bf));
    $(isMe ? '#me' : '#opps').append(root);
    seats[p.id] = { root, head, bf, piles };
    new ResizeObserver(() => sizeSeat(p.id)).observe(bf);
    requestAnimationFrame(() => sizeSeat(p.id));
  }
  for (const id of Object.keys(S.cards)) syncCard(id);
  for (const k of Object.keys(S.zones)) onZone(k);
  for (const p of Object.values(S.players)) updateSeat(p);
  renderStack();
}

function sizeSeat(pid) {
  const s = seats[pid]; if (!s) return;
  const w = s.bf.clientWidth, h = s.bf.clientHeight;
  if (!w || !h) return;
  const z = zoom;
  const base = pid === S.you ? Math.min(w / 10.5, h / 3.1 / 1.4) : Math.min(w / 8.5, h / 2.9 / 1.4);
  s.bf.style.setProperty('--cw', Math.max(40, Math.min(150, base * z)) + 'px');
  s.piles.style.setProperty('--cw', Math.max(40, Math.min(86, h / 4.4 / 1.4)) + 'px');
}

function updateSeat(p) {
  const s = seats[p.id]; if (!s) return;
  const h = s.head;
  $('.dot', h).style.background = p.color;
  $('.pname', h).textContent = p.name + (p.id === S.you ? ' (você)' : '');
  s.root.classList.toggle('offline', !p.connected);
  s.root.classList.toggle('active', S.turn.active === p.id);
  s.root.classList.toggle('dead', p.life <= 0);
  const lv = $('.lv', h); if (lv.textContent !== String(p.life)) { lv.textContent = p.life; lv.classList.remove('bump'); void lv.offsetWidth; lv.classList.add('bump'); }
  lv.classList.toggle('low', p.life <= 10); lv.classList.toggle('crit', p.life <= 5);
  for (const k of ['poison', 'energy', 'exp', 'rad', 'tix']) { const n = $(`.pc-${k}`, h); $('b', n).textContent = p[k]; n.classList.toggle('zero', !p[k]); }
  for (const cd of $$('.cd', h)) { const v = p.cmd?.[cd.dataset.from] || 0; $('b', cd).textContent = v; cd.classList.toggle('zero', !v); cd.classList.toggle('lethal', v >= 21); }
  s.root.classList.toggle('holding', !!p.hold);
}

// ====================== CARTAS ======================
const backEl = () => el('div', { class: 'back' }, el('div', { class: 'back-in' }));

function mkCard(id) {
  const e = el('div', { class: 'card', 'data-id': id },
    el('div', { class: 'face' }, el('img', { draggable: 'false', decoding: 'async', alt: '' }), el('span', { class: 'cname' })),
    backEl(), el('div', { class: 'overlay-fx' }), el('div', { class: 'badges' }), el('div', { class: 'ptbox' }), el('div', { class: 'loy' }));
  $('img', e).addEventListener('error', () => e.classList.add('noimg'));
  els.set(id, e);
  return e;
}

function updateCardEl(e, c) {
  const f = faceOf(c);
  const mineView = c.owner === S.you || c.pid === S.you;
  const hidden = !c.sid || !f;
  e.classList.toggle('tapped', !!c.tapped);
  e.classList.toggle('sick', !!c.sick && c.zone === 'battlefield');
  e.classList.toggle('fd', !!c.fd);
  e.classList.toggle('token', !!c.token);
  e.classList.toggle('mine', mineView);
  e.classList.toggle('showback', hidden || (c.fd && !mineView));
  e.classList.toggle('selected', sel.has(c.id));
  e.dataset.zone = c.zone;
  if (f) {
    const img = $('img', e);
    const src = (c.zone === 'battlefield' && !mineView ? f.s : f.n) || f.n || f.s || '';
    if (img.getAttribute('src') !== src) { e.classList.remove('noimg'); img.src = src; }
    $('.cname', e).textContent = f.name;
  }
  if (c.zone === 'battlefield' && !dragging.has(c.id)) {
    e.style.setProperty('--x', c.x); e.style.setProperty('--y', c.y); e.style.zIndex = c.z || 1;
  }
  // badges / P-T / lealdade
  const cn = c.counters || {};
  const sig = JSON.stringify([cn, c.dmg, c.mp, c.mt, c.tax, c.cmd, c.face, c.zone, f?.power, f?.toughness]);
  if (e._sig !== sig) {
    e._sig = sig;
    const b = $('.badges', e); b.textContent = '';
    for (const [k, v] of Object.entries(cn)) {
      if (k === 'loyalty' || k === 'defense' || !v) continue;
      b.append(el('span', { class: 'chip k-' + (k === '+1/+1' ? 'plus' : k === '-1/-1' ? 'minus' : 'gen'), 'data-k': k, title: `${k}: clique +1, botão direito −1` }, el('i', {}, k === '+1/+1' ? '▲' : k === '-1/-1' ? '▼' : '◆'), el('em', {}, CLABEL[k] || k), el('b', {}, v)));
    }
    if (c.dmg) b.append(el('span', { class: 'chip k-dmg', 'data-k': '__dmg', title: 'Dano marcado (clique +1, direito −1)' }, el('i', {}, '✹'), el('b', {}, c.dmg)));
    if (c.zone === 'command' && c.tax) b.append(el('span', { class: 'chip k-tax', title: 'Taxa de comandante' }, el('i', {}, '⚑'), el('b', {}, '+' + 2 * c.tax)));
    const pt = $('.ptbox', e);
    const isCreature = /Creature/.test(f?.type || '');
    const mod = (cn['+1/+1'] || 0) - (cn['-1/-1'] || 0); const mp = mod + (c.mp || 0), mt = mod + (c.mt || 0);
    if (c.zone === 'battlefield' && isCreature && (mp || mt || c.dmg) && /^-?\d+$/.test(f.power) && /^-?\d+$/.test(f.toughness)) {
      const P = +f.power + mp, T = +f.toughness + mt;
      pt.textContent = `${P}/${T - (c.dmg || 0)}`; pt.className = 'ptbox on ' + (c.dmg ? 'hurt' : mp + mt > 0 ? 'up' : 'down');
    } else { pt.textContent = ''; pt.className = 'ptbox'; }
    const loy = $('.loy', e); const lv = cn.loyalty ?? cn.defense;
    if (c.zone === 'battlefield' && lv != null) { loy.textContent = lv; loy.className = 'loy on' + (cn.defense != null ? ' def' : ''); loy.dataset.k = cn.loyalty != null ? 'loyalty' : 'defense'; } else { loy.textContent = ''; loy.className = 'loy'; }
  }
}

function syncCard(id) {
  const c = S.cards[id];
  let e = els.get(id);
  if (!c) { e?.remove(); els.delete(id); sel.delete(id); delete peeked[id]; return; }
  e ||= mkCard(id);
  delete peeked[id];
  updateCardEl(e, c);
  let target = null;
  if (c.zone === 'battlefield') target = seats[c.pid]?.bf;
  else if (c.zone === 'hand' && c.pid === S.you) target = $('#hand');
  else if (c.zone === 'stack') target = $('#stackcards');
  if (target) { if (e.parentNode !== target) target.append(e); }
  else if (e.parentNode && !e.parentNode.classList.contains('pile-stack') && !e.parentNode.classList.contains('modal-grid')) e.remove();
  if (c.zone !== 'battlefield') sel.delete(id); else scheduleBadges(c.pid);
}

let badgeQ = new Set(), badgeRaf = 0;
function scheduleBadges(pid) {
  badgeQ.add(pid);
  if (!badgeRaf) badgeRaf = requestAnimationFrame(() => { badgeRaf = 0; for (const p of badgeQ) stackBadges(p); badgeQ.clear(); });
}
function stackBadges(pid) {
  const groups = {};
  for (const id of zoneIds(pid, 'battlefield')) { const c = S.cards[id]; if (!c) continue; const k = `${c.sid}|${c.tapped ? 1 : 0}|${c.fd ? 1 : 0}|${Math.round(c.x * 35)}|${Math.round(c.y * 35)}`; (groups[k] ||= []).push(c); }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => b.z - a.z);
    g.forEach((c, i) => { const e = els.get(c.id); if (!e) return; let b = $('.stackn', e); if (i === 0 && g.length > 1) { if (!b) { b = el('span', { class: 'stackn' }); e.append(b); } b.textContent = '×' + g.length; } else b?.remove(); });
  }
}

function onZone(key) {
  const [pid, zone] = key.split(':');
  if (zone === 'hand' && pid === S.you) {
    const hand = $('#hand'); const ids = zoneIds(pid, 'hand');
    ids.forEach((id, i) => { const e = els.get(id); if (e && hand.children[i] !== e) hand.insertBefore(e, hand.children[i] || null); });
    hand.classList.toggle('empty', !ids.length);
    document.documentElement.style.setProperty('--hn', Math.max(ids.length, 1));
  }
  if (zone === 'battlefield') scheduleBadges(pid);
  if (PILES.includes(zone)) updatePile(pid, zone);
  if (zone === 'hand' && pid !== S.you) { /* contagem exibida no cabeçalho */ updateHandBadge(pid); }
  zoneModals.forEach((m) => m.refresh?.(key));
}

function updateHandBadge(pid) {
  const s = seats[pid]; if (!s) return;
  let b = $('.hc', s.head);
  if (!b) { b = el('span', { class: 'hc', title: 'Cartas na mão' }, el('i', {}, '✋'), el('b', {})); $('.pname', s.head).after(b); }
  $('b', b).textContent = zoneCount(pid, 'hand');
}

function updatePile(pid, zone) {
  const s = seats[pid]; if (!s) return;
  const pile = $(`.pile[data-zone="${zone}"]`, s.piles); const st = $('.pile-stack', pile);
  const ids = zoneIds(pid, zone); const n = zone === 'library' ? zoneCount(pid, 'library') : ids.length;
  $('.pile-count', pile).textContent = n || '';
  pile.classList.toggle('empty', !n);
  if (zone === 'library') { if (!st.firstChild) st.append(el('div', { class: 'card libtop showback' }, backEl())); return; }
  const want = zone === 'command' ? ids : ids.slice(-1);
  [...st.children].forEach((ch) => { if (!want.includes(ch.dataset?.id)) ch.remove(); });
  want.forEach((id, i) => { const e = els.get(id) || (S.cards[id] ? mkCard(id) : null); if (!e) return; if (S.cards[id]) updateCardEl(e, S.cards[id]); if (e.parentNode !== st) st.append(e); e.style.setProperty('--i', i); });
}

// ====================== DELTAS ======================
on('delta', (ch) => {
  if (ch.full) { for (const e of els.values()) e.remove(); els.clear(); seatSig = ''; }
  buildSeats();
  if (ch.players) Object.values(S.players).forEach(updateSeat);
  for (const id of ch.cards) syncCard(id);
  for (const k of ch.zones) onZone(k);
  if (ch.stack) renderStack();
  if (ch.turn) { renderTurn(); Object.values(S.players).forEach(updateSeat); }
  if (ch.combat || ch.full) { renderCombat(); renderControls(); }
  if (ch.players || ch.zones.has(S.you + ':hand')) { renderMull(); renderControls(); }
  if (ch.cards.size && S.combat) renderCombat();
  if (ch.log.length) appendLog(ch.log);
  if (ch.full) { for (const k of Object.keys(S.zones)) onZone(k); renderTurn(); renderSettings(); }
});

on('alert', (m) => { showBanner(m.text, m.kind); beep(m.kind === 'turn' ? 'turn' : 'call'); });

// ====================== PILHA ======================
function renderStack() {
  const z = $('#stackzone'); const n = S.stack.length;
  z.classList.toggle('has', n > 0);
  const box = $('#stackcards');
  S.stack.forEach((id, i) => { const e = els.get(id); if (e && box.children[i] !== e) box.insertBefore(e, box.children[i] || null); });
  $('#stacktitle').textContent = n ? `Pilha · ${n}` : 'Pilha';
  $('#btn-resolve').disabled = !n;
  const held = Object.values(S.players).filter((p) => p.connected && p.hold);
  $('#btn-hold').classList.toggle('on', !!me()?.hold);
  $('#passinfo').textContent = held.length ? `${held.map((p) => p.name).join(', ')} quer responder` : '';
  const bar = $('#stackbar i');
  if (n && S.stackIn > 0 && !held.length) {
    bar.style.transition = 'none'; bar.style.width = '100%'; void bar.offsetWidth;
    bar.style.transition = `width ${S.stackIn}ms linear`; bar.style.width = '0%'; bar.parentNode.classList.remove('held');
  } else { bar.style.transition = 'none'; bar.style.width = n ? '100%' : '0%'; bar.parentNode.classList.toggle('held', !!n && !!held.length); }
}


// ====================== TURNO ======================
const PHASE_NAME = { upkeep: 'Manutenção', draw: 'Compra', main1: 'Principal 1', combat: 'Combate', main2: 'Principal 2', end: 'Final' };
let attackTarget = null;


function renderTurn() {
  const t = S.turn; const ap = S.players[t.active];
  $('#turnnum').textContent = t.num ? `Turno ${t.num}` : 'Aguardando jogadores';
  const who = $('#turnwho'); who.textContent = ap ? ap.name : ''; who.style.color = ap?.color || '';
  $('#phasename').textContent = t.num ? PHASE_NAME[t.phase] || '' : '';
  renderControls();
}

function renderControls() {
  const t = S.turn, cb = S.combat, mine = t.active === S.you, p = me();
  const pb = $('#btn-primary'), nb = $('#btn-next'), bar = $('#combatbar');
  let label = '', fn = null, showNext = false, hint = '';
  if (!p) return;
  if (!t.num) {
    if (p.deck && p.keep) { label = 'Iniciar jogo'; fn = () => send('start'); }
  } else if (mine) {
    if (cb?.step === 'declare') {
      label = cb.atk.length ? `Confirmar ataque (${cb.atk.length})` : 'Sem ataque'; fn = () => send('endDeclare');
      hint = cb.atk.length ? 'Duplo clique em mais criaturas para atacar, ou confirme.' : 'Duplo clique nas suas criaturas para atacar (ou selecione e pressione A).';
    } else if (cb?.step === 'block') {
      label = 'Resolver dano'; fn = () => send('resolveCombat'); hint = 'Aguardando os bloqueios…';
    } else if (['upkeep', 'draw', 'main1'].includes(t.phase)) { label = '⚔ Combate'; fn = () => send('phase', { phase: 'combat' }); showNext = true; }
    else { label = 'Fim do turno'; fn = () => send('next'); }
  } else if (cb?.step === 'block' && cb.atk.some((a) => a.target === S.you) && !cb.done[S.you]) {
    label = 'Concluir bloqueios'; fn = () => send('doneBlock');
    hint = 'Selecione suas criaturas e clique no atacante para bloquear.';
  } else if (cb?.step === 'block') hint = 'Aguardando os bloqueios…';
  pb.classList.toggle('hidden', !label); pb.textContent = label; pb.onclick = fn;
  nb.classList.toggle('hidden', !showNext); nb.onclick = () => send('next');
  bar.classList.toggle('hidden', !hint);
  $('#combattext').textContent = hint;
  // alvo do ataque (multiplayer)
  const old = $('.atkt', bar); old?.remove();
  const opps = Object.values(S.players).filter((q) => q.id !== S.you && q.connected);
  if (mine && cb?.step === 'declare' && opps.length > 1) {
    if (!opps.some((q) => q.id === attackTarget)) attackTarget = opps[0].id;
    const box = el('span', { class: 'atkt' }, opps.map((q) => el('button', { class: 'chipbtn' + (q.id === attackTarget ? ' on' : ''), style: { '--c': q.color }, onclick: () => { attackTarget = q.id; renderControls(); } }, q.name)));
    bar.prepend(box);
  }
}

function renderCombat() {
  const cb = S.combat;
  for (const e of els.values()) { e.classList.remove('attacking', 'blocking', 'blocked'); $('.cbadge', e)?.remove(); }
  if (!cb) return;
  const tag = (id, cls, text) => { const e = els.get(id); if (!e) return; e.classList.add(cls); e.append(el('span', { class: 'cbadge ' + cls }, text)); };
  for (const a of cb.atk) {
    const n = (cb.blocks[a.id] || []).length;
    tag(a.id, 'attacking', `⚔ ${S.players[a.target]?.name || ''}${n ? ' · 🛡' + n : ''}`);
    if (n) els.get(a.id)?.classList.add('blocked');
  }
  for (const [aid, list] of Object.entries(cb.blocks)) for (const b of list) tag(b, 'blocking', `🛡 ${nameOf(S.cards[aid] || {})}`);
}

function renderSettings() {}

// ====================== MULLIGAN ======================
let mullBottom = new Set(), mullSig = '';
function renderMull() {
  const p = me(); const box = $('#mull');
  const show = !!p && p.deck && !p.keep;
  box.classList.toggle('hidden', !show);
  if (!show) { mullSig = ''; return; }
  const need = Math.max(0, p.mulls - 1);
  const ids = zoneIds(S.you, 'hand');
  const sig = ids.join(',') + '|' + p.mulls;
  if (sig !== mullSig) { mullSig = sig; mullBottom = new Set(); }
  $('#mulltitle').textContent = p.mulls ? `Mulligan ${p.mulls}` : 'Sua mão inicial';
  $('#mulltext').textContent = need ? `Escolha ${need} carta(s) para o fundo da biblioteca (${mullBottom.size}/${need}).` : p.mulls ? 'O primeiro mulligan é grátis no Commander. Manter esta mão?' : 'Manter esta mão ou fazer mulligan?';
  const hand = $('#mullhand'); hand.textContent = '';
  for (const id of ids) {
    const c = S.cards[id]; const f = faceOf(c); if (!f) continue;
    const b = el('button', { class: 'mc' + (mullBottom.has(id) ? ' sel' : ''), title: f.name, onclick: () => { if (!need) return; if (mullBottom.has(id)) mullBottom.delete(id); else if (mullBottom.size < need) mullBottom.add(id); renderMull(); } }, el('img', { src: f.n || f.s, alt: f.name }));
    hand.append(b);
  }
  $('#btn-keep').disabled = mullBottom.size !== need;
  $('#btn-keep').onclick = () => send('keep', { bottom: [...mullBottom] });
  $('#btn-mull').onclick = () => send('mulligan');
  $('#btn-mull').classList.toggle('hidden', p.mulls >= 6);
}


// ====================== LOG / CHAT ======================
function appendLog(list) {
  const box = $('#log'); const stick = box.scrollTop + box.clientHeight > box.scrollHeight - 40;
  for (const l of list) {
    const p = S.players[l.p];
    const line = l.chat
      ? el('div', { class: 'ln chat' }, el('b', { style: { color: p?.color } }, (p?.name || '?') + ': '), l.m)
      : el('div', { class: 'ln' + (/^—/.test(l.m) ? ' turn' : '') }, l.p && p ? el('i', { class: 'ld', style: { background: p.color } }) : null, l.m);
    box.append(line);
  }
  while (box.children.length > 300) box.firstChild.remove();
  if (!$('#game').classList.contains('sideopen')) { const chats = list.filter((l) => l.chat).length; if (chats) { unread += chats; const b = $('#chatbadge'); b.textContent = unread; b.classList.remove('hidden'); } }
  if (stick) box.scrollTop = box.scrollHeight;
}

// ====================== PINGS & CALLOUTS ======================
on('ping', (m) => {
  const from = S.players[m.from]; const color = from?.color || '#fff';
  if (m.kind === 'call') { showBanner(`${from?.name}: ${m.text}`, 'call', color); beep('call'); return; }
  let rect;
  if (m.cid && els.get(m.cid)?.isConnected) {
    const e = els.get(m.cid); rect = e.getBoundingClientRect(); e.classList.add('pinged'); setTimeout(() => e.classList.remove('pinged'), 1800);
    rect = { left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 };
  } else if (m.pid && seats[m.pid]) {
    const r = seats[m.pid].bf.getBoundingClientRect(); rect = { left: r.left + (m.x ?? 0.5) * r.width, top: r.top + (m.y ?? 0.5) * r.height };
  } else return;
  const p = el('div', { class: 'ping', style: { left: rect.left + 'px', top: rect.top + 'px', '--c': color } }, el('i'), el('i'), el('i'), el('span', {}, from?.name));
  $('#pings').append(p); setTimeout(() => p.remove(), 2200); beep('point');
});

let bannerT;
function showBanner(text, kind, color) {
  const b = $('#banner'); b.textContent = text; b.className = 'show ' + (kind || '');
  b.style.setProperty('--c', color || '');
  clearTimeout(bannerT); bannerT = setTimeout(() => (b.className = ''), kind === 'turn' ? 2400 : 3000);
}

export function callout(text) { send('ping', { kind: 'call', text }); }

// ====================== MENUS ======================
const nameOf = (c) => faceOf(c)?.name || 'carta';
const mv = (ids, zone, extra = {}) => send('move', { ids, zone, ...extra });

function counterMenu(ids) {
  const id = ids[0];
  const c = getCard(id);
  const existing = Object.keys(c?.counters || {});
  const add = (k, d = 1) => () => ids.forEach((i) => send('counter', { id: i, kind: k, delta: d }));
  return [
    ...COUNTERS.slice(0, 5).map((k) => ({ label: `+1 ${k === 'loyalty' ? 'lealdade' : k}`, fn: add(k) })),
    { label: 'Outros contadores', sub: [...COUNTERS.slice(5).map((k) => ({ label: `+1 ${k}`, fn: add(k) })), { sep: true }, { label: 'Personalizado…', fn: async () => { const k = await ask('Nome do contador'); if (k) add(k)(); } }] },
    { label: '+1 dano marcado', fn: () => ids.forEach((i) => send('dmg', { id: i, delta: 1 })) },
    ...(existing.length ? [{ sep: true }, ...existing.map((k) => ({ label: `−1 ${CLABEL[k] || k} (${c.counters[k]})`, fn: add(k, -1) }))] : []),
  ];
}

function ask(title, def = '') {
  return new Promise((res) => {
    const m = modal({ title, cls: 'small', onClose: () => res(null) });
    const inp = el('input', { type: 'text', value: def, class: 'inp' });
    const ok = () => { const v = inp.value.trim(); m.root.remove(); res(v || null); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    m.body.append(inp, el('div', { class: 'row end' }, el('button', { class: 'btn primary', onclick: ok }, 'OK')));
    inp.focus(); inp.select();
  });
}

function playerMenu(pid, x, y) {
  const p = S.players[pid];
  const items = [{ title: p.name }];
  for (const [k, lbl] of [['poison', '☣ Veneno'], ['energy', '⚡ Energia'], ['exp', '★ Experiência'], ['rad', '☢ Rad'], ['tix', '🎟 Bilhetes']]) items.push({ label: `${lbl} (${p[k] || 0})`, sub: [{ label: '+1', fn: () => send('pcount', { pid, kind: k, delta: 1 }) }, { label: '−1', fn: () => send('pcount', { pid, kind: k, delta: -1 }) }] });
  items.push({ sep: true });
  for (const q of Object.values(S.players)) if (q.id !== pid) items.push({ label: `Dano de comandante de ${q.name} (${p.cmd?.[q.id] || 0}/21)`, sub: [1, 2, 3, 5].map((n) => ({ label: `+${n}`, fn: () => send('cmdDmg', { to: pid, from: q.id, delta: n }) })).concat([{ label: '−1', fn: () => send('cmdDmg', { to: pid, from: q.id, delta: -1 }) }]) });
  items.push({ sep: true }, { label: 'Ping neste jogador', icon: '📍', fn: () => send('ping', { kind: 'point', pid, x: 0.5, y: 0.1 }) });
  menu(items, x, y);
}

function cardMenu(c, x, y, ids) {
  ids ||= [c.id];
  const f = faceOf(c); const multi = S.meta[c.sid]?.faces.length > 1;
  const items = [{ title: nameOf(c) + (ids.length > 1 ? ` (+${ids.length - 1})` : '') }];
  const others = Object.values(S.players).filter((p) => p.id !== S.you);
  const dest = (label, zone, extra = {}, icon) => ({ label, icon, fn: () => mv(ids, zone, extra) });
  if (!canControl(c)) { items.push({ label: 'Ping nesta carta', icon: '📍', fn: () => send('ping', { kind: 'point', cid: c.id }) }); menu(items, x, y); return; }
  if (c.zone === 'battlefield') {
    items.push({ label: c.tapped ? 'Desvirar' : 'Virar', icon: '↻', kbd: 'T', fn: () => send('tap', { ids }) });
    items.push({ label: 'Contadores', icon: '◆', sub: counterMenu(ids) });
    items.push({ label: 'Bônus até o fim do turno', icon: '⇧', sub: [[1, 1], [2, 2], [3, 3], [1, 0], [2, 0], [0, 2], [-1, -1], [-2, -2]].map(([a, b]) => ({ label: `${a >= 0 ? '+' : ''}${a}/${b >= 0 ? '+' : ''}${b}`, fn: () => send('pump', { ids, p: a, t: b }) })) });
    if (S.combat?.step === 'declare' && S.turn.active === S.you) items.push({ label: 'Atacar / cancelar ataque', icon: '⚔', kbd: 'A', fn: () => send('attack', { ids, target: attackTarget }) });
    items.push({ label: 'Copiar como ficha', icon: '⧉', sub: [1, 2, 3, 5].map((n) => ({ label: `${n}×`, fn: () => send('copy', { id: c.id, n }) })) });
    if (ids.length > 1) items.push({ label: 'Empilhar seleção aqui', icon: '▤', fn: () => send('stackAt', { ids }) }, { label: 'Espalhar seleção em linha', icon: '▥', fn: () => send('spread', { ids }) });
    items.push({ label: c.fd ? 'Virar para cima' : 'Virar face para baixo', icon: '🂠', kbd: 'F', fn: () => send('flip', { ids }) });
    if (multi) items.push({ label: 'Transformar', icon: '⟲', kbd: 'X', fn: () => send('face', { ids }) });
    items.push({ sep: true });
    items.push(dest('Cemitério', 'graveyard', {}, '☠'), dest('Exílio', 'exile', {}, '✦'), dest('Mão', 'hand', {}, '✋'));
    items.push({ label: 'Biblioteca', icon: '📚', sub: [{ label: 'Topo', fn: () => mv(ids, 'library', { pos: 'top' }) }, { label: 'Fundo', fn: () => mv(ids, 'library', { pos: 'bottom' }) }, { label: 'Topo e embaralhar', fn: () => mv(ids, 'library', { pos: 'top', shuffle: true }) }] });
    if (c.cmd) items.push(dest('Zona de comando', 'command', {}, '♛'));
    if (others.length) items.push({ label: 'Dar controle a…', icon: '⇄', sub: others.map((p) => ({ label: p.name, fn: () => mv(ids, 'battlefield', { pid: p.id }) })) });
  } else if (c.zone === 'hand') {
    items.push({ label: 'Jogar no campo', icon: '▶', fn: () => mv(ids, 'battlefield', { force: true }) });
    items.push({ label: 'Conjurar (pilha)', icon: '✧', fn: () => mv(ids, 'stack') });
    items.push({ label: 'Jogar virada para baixo', icon: '🂠', fn: () => mv(ids, 'battlefield', { fd: true, force: true }) });
    items.push({ sep: true });
    items.push(dest('Descartar', 'graveyard', {}, '☠'), dest('Exilar', 'exile', {}, '✦'));
    items.push({ label: 'Biblioteca', icon: '📚', sub: [{ label: 'Topo', fn: () => mv(ids, 'library', { pos: 'top' }) }, { label: 'Fundo', fn: () => mv(ids, 'library', { pos: 'bottom' }) }] });
    items.push({ label: 'Revelar para todos', icon: '👁', fn: () => send('revealHand', { ids }) });
  } else if (c.zone === 'stack') {
    items.push({ label: 'Resolver (topo)', icon: '✔', fn: () => send('resolve') });
    items.push(dest('Contra-magia → cemitério', 'graveyard', {}, '⛔'), dest('Voltar à mão', 'hand', {}, '✋'), dest('Exilar', 'exile', {}, '✦'));
  } else { // graveyard / exile / command / biblioteca (peek)
    items.push({ label: 'Jogar no campo', icon: '▶', fn: () => mv(ids, 'battlefield', { force: true, ...(c.zone === 'library' && c._search ? { shuffle: true } : {}) }) });
    items.push({ label: 'Conjurar (pilha)', icon: '✧', fn: () => mv(ids, 'stack') });
    items.push(dest('Mão', 'hand', c._search ? { shuffle: true } : {}, '✋'));
    if (c.zone !== 'graveyard') items.push(dest('Cemitério', 'graveyard', {}, '☠'));
    if (c.zone !== 'exile') items.push(dest('Exílio', 'exile', {}, '✦'));
    items.push({ label: 'Biblioteca', icon: '📚', sub: [{ label: 'Topo', fn: () => mv(ids, 'library', { pos: 'top' }) }, { label: 'Fundo', fn: () => mv(ids, 'library', { pos: 'bottom' }) }] });
    if (c.cmd && c.zone !== 'command') items.push(dest('Zona de comando', 'command', {}, '♛'));
  }
  if (c.owner === S.you) { items.push({ sep: true }); items.push({ label: c.cmd ? 'Remover marca de comandante' : 'Marcar como comandante', icon: '♛', fn: () => send('setCmd', { ids, v: !c.cmd }) }); }
  if (c.zone !== 'library') items.push({ label: 'Ping nesta carta', icon: '📍', fn: () => send('ping', { kind: 'point', cid: c.id }) });
  menu(items, x, y);
}

function pileMenu(pid, zone, x, y) {
  const mine = pid === S.you; const items = [{ title: `${ZNAME[zone]} de ${S.players[pid]?.name}` }];
  items.push({ label: 'Abrir / ver', icon: '👁', fn: () => openZone(pid, zone) });
  if (mine && zone === 'library') {
    items.push({ label: 'Comprar 1', icon: '🂠', kbd: 'D', fn: () => send('draw', { n: 1 }) });
    items.push({ label: 'Comprar…', sub: [2, 3, 5, 7].map((n) => ({ label: `${n} cartas`, fn: () => send('draw', { n }) })) });
    items.push({ label: 'Embaralhar', icon: '🔀', kbd: 'S', fn: () => send('shuffle') });
    items.push({ sep: true });
    items.push({ label: 'Ver topo (scry)', icon: '🔮', sub: [1, 2, 3, 4, 5, 7, 10].map((n) => ({ label: `${n}`, fn: () => send('peek', { n, mode: 'scry' }) })) });
    items.push({ label: 'Procurar na biblioteca', icon: '🔎', fn: () => send('peek', { all: true, mode: 'search' }) });
    items.push({ label: 'Revelar topo', icon: '👁', fn: () => send('revealTop', { n: 1 }) });
    items.push({ label: 'Moer (→ cemitério)', sub: [1, 2, 3, 5, 10].map((n) => ({ label: `${n}`, fn: () => send('mill', { n }) })) });
    items.push({ label: 'Exilar do topo', sub: [1, 2, 3].map((n) => ({ label: `${n}`, fn: () => send('exileTop', { n }) })) });
    items.push({ sep: true }); items.push({ label: 'Mulligan (embaralhar e comprar 7)', icon: '↺', danger: true, fn: () => send('mulligan') });
  }
  menu(items, x, y);
}

// ====================== MODAIS DE ZONA / PEEK ======================
export function openZone(pid, zone) {
  if (zone === 'library') { if (pid === S.you) send('peek', { all: true, mode: 'search' }); return; }
  const m = modal({ title: `${ZNAME[zone]} — ${S.players[pid]?.name}`, wide: true, onClose: () => { zoneModals = zoneModals.filter((z) => z !== ctrl); } });
  const filter = el('input', { class: 'inp', placeholder: 'Filtrar por nome…', type: 'search' });
  const grid = el('div', { class: 'modal-grid' });
  m.body.append(filter, grid);
  const ctrl = { refresh: (key) => { if (key === `${pid}:${zone}`) draw(); } };
  const draw = () => {
    const q = filter.value.toLowerCase(); grid.textContent = '';
    const ids = zoneIds(pid, zone).slice().reverse();
    for (const id of ids) {
      const c = S.cards[id]; if (!c) continue;
      if (q && !nameOf(c).toLowerCase().includes(q)) continue;
      const e = els.get(id) || mkCard(id); updateCardEl(e, c); grid.append(e);
    }
    if (!grid.children.length) grid.append(el('p', { class: 'muted' }, 'Vazio.'));
    m.setTitle(`${ZNAME[zone]} — ${S.players[pid]?.name} (${ids.length})`);
  };
  filter.addEventListener('input', draw); draw(); zoneModals.push(ctrl);
  // quando fechar, devolve as cartas para a pilha
  const origClose = m.close; m.close = () => { origClose(); updatePile(pid, zone); };
  m.root.querySelector('.x').onclick = m.close;
}

on('peek', (m) => {
  const search = m.mode === 'search';
  const dlg = modal({ title: search ? `Biblioteca (${m.total})` : `Topo da biblioteca (${m.cards.length})`, wide: true });
  const filter = el('input', { class: 'inp', placeholder: 'Filtrar por nome…', type: 'search' });
  const grid = el('div', { class: 'modal-grid peek' });
  dlg.body.append(search ? filter : el('p', { class: 'muted' }, 'Escolha o destino de cada carta. Cartas deixadas aqui permanecem no topo, na ordem mostrada.'), grid);
  let list = m.cards.slice();
  const draw = () => {
    grid.textContent = ''; const q = filter.value.toLowerCase();
    list.forEach((x, i) => {
      peeked[x.id] = { id: x.id, sid: x.sid, owner: S.you, pid: S.you, zone: 'library', face: 0, counters: {}, _search: search };
      const c = peeked[x.id]; const nm = S.meta[x.sid]?.name || '';
      if (q && !nm.toLowerCase().includes(q)) return;
      const e = els.get(x.id) || mkCard(x.id); updateCardEl(e, c);
      const bar = el('div', { class: 'peekbar' },
        ...(search ? [] : [el('button', { onclick: () => done(x, 'library', { pos: 'bottom' }), title: 'Fundo' }, '⤓ Fundo')]),
        el('button', { onclick: () => done(x, 'graveyard'), title: 'Cemitério' }, '☠'),
        el('button', { onclick: () => done(x, 'exile'), title: 'Exílio' }, '✦'),
        el('button', { onclick: () => done(x, 'hand', search ? { shuffle: true } : {}), title: 'Mão' }, '✋'),
        el('button', { onclick: () => done(x, 'battlefield', { force: true, ...(search ? { shuffle: true } : {}) }), title: 'Campo' }, '▶'));
      grid.append(el('div', { class: 'peekitem' }, e, bar));
    });
  };
  const done = (x, zone, extra = {}) => { mv([x.id], zone, extra); list = list.filter((y) => y.id !== x.id); draw(); if (!list.length && !search) dlg.close(); };
  filter.addEventListener('input', draw); draw();
  if (search) dlg.root.addEventListener('close', () => {});
});

on('reveal', (m) => {
  const dlg = modal({ title: `${S.players[m.by]?.name} revelou ${m.from === 'hand' ? 'da mão' : 'do topo da biblioteca'}`, wide: true });
  const grid = el('div', { class: 'modal-grid' }); dlg.body.append(grid);
  for (const x of m.cards) {
    const c = { id: 'rv' + x.id, sid: x.sid, owner: m.by, pid: m.by, zone: 'reveal', face: 0, counters: {} };
    const e = mkCard('rv' + x.id); S.cards['rv' + x.id] = c; updateCardEl(e, c); grid.append(e);
  }
  const cl = dlg.close; dlg.close = () => { for (const x of m.cards) { delete S.cards['rv' + x.id]; els.delete('rv' + x.id); } cl(); };
  dlg.root.querySelector('.x').onclick = dlg.close;
});

// ====================== INTERAÇÃO ======================
let gesture = null, marquee = null;
const interactive = (t) => t.closest('button,input,textarea,select,a,.chip,.lb,.lv,.pc,.cd,.menu,.peekbar');

function dropTarget(x, y) {
  for (const t of document.elementsFromPoint(x, y)) { const d = t.closest?.('[data-drop]'); if (d) return d; }
  return null;
}
const clearHot = () => $$('.drop-hot').forEach((e) => e.classList.remove('drop-hot'));

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || interactive(e.target)) return;
  const ce = e.target.closest('.card[data-id]');
  if (ce) {
    const id = ce.dataset.id; const c = getCard(id); if (!c) return;
    if (e.altKey) { send('ping', { kind: 'point', cid: id }); e.preventDefault(); return; }
    gesture = { id, ce, c, sx: e.clientX, sy: e.clientY, drag: false, mode: null, ctrl: e.ctrlKey || e.metaKey || e.shiftKey };
    e.preventDefault();
    return;
  }
  const bf = e.target.closest('.bf');
  if (bf) {
    const pid = bf.dataset.pid;
    const r = bf.getBoundingClientRect();
    if (e.altKey) { send('ping', { kind: 'point', pid, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); return; }
    if (pid === S.you) { marquee = { bf, sx: e.clientX, sy: e.clientY, box: null, add: e.shiftKey || e.ctrlKey }; if (!marquee.add && sel.size) { sel.clear(); renderSel(); } }
  }
});

window.addEventListener('pointermove', (e) => {
  if (marquee) {
    const dx = e.clientX - marquee.sx, dy = e.clientY - marquee.sy;
    if (!marquee.box && Math.hypot(dx, dy) > 4) { marquee.box = el('div', { class: 'marquee' }); document.body.append(marquee.box); }
    if (marquee.box) {
      const l = Math.min(e.clientX, marquee.sx), t = Math.min(e.clientY, marquee.sy), w = Math.abs(dx), h = Math.abs(dy);
      Object.assign(marquee.box.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' });
      for (const ce of $$('.card', marquee.bf)) {
        const r = ce.getBoundingClientRect(); const hit = r.left < l + w && r.right > l && r.top < t + h && r.bottom > t;
        if (hit) sel.add(ce.dataset.id); else if (!marquee.add) sel.delete(ce.dataset.id);
      }
      renderSel();
    }
    return;
  }
  if (!gesture) return;
  const g = gesture;
  if (!g.drag) {
    if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
    if (!canControl(g.c)) { gesture = null; return; }
    g.drag = true; startDrag(g, e);
  }
  moveDrag(g, e);
});

function startDrag(g, e) {
  const c = g.c;
  if (c.zone === 'battlefield' && c.pid === S.you && g.ce.closest('.bf')) {
    g.mode = 'bf';
    if (!sel.has(g.id)) { sel.clear(); sel.add(g.id); renderSel(); }
    const bf = seats[S.you].bf; const br = bf.getBoundingClientRect();
    g.items = [...sel].map((id) => { const el_ = els.get(id); const r = el_.getBoundingClientRect(); dragging.add(id); el_.classList.add('dragging'); return { id, el: el_, x0: (r.left + r.width / 2 - br.left), y0: (r.top + r.height / 2 - br.top), w: r.width, h: r.height }; });
    g.br = br; g.lastSend = 0;
  } else {
    g.mode = 'ghost';
    const r = g.ce.getBoundingClientRect();
    const ghost = g.ce.cloneNode(true); ghost.className = 'card ghost'; ghost.style.width = r.width + 'px'; ghost.style.setProperty('--cw', r.width + 'px');
    ghost.style.left = '0'; ghost.style.top = '0'; document.body.append(ghost);
    g.ghost = ghost; g.gw = r.width; g.gh = r.height; g.ce.classList.add('ghosted');
  }
  document.body.classList.add('is-dragging');
}

function moveDrag(g, e) {
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (g.mode === 'bf') {
    for (const it of g.items) it.el.style.translate = `${dx}px ${dy}px`;
    const now = performance.now();
    if (now - g.lastSend > 70) { g.lastSend = now; sendPositions(g, dx, dy); }
  } else {
    g.ghost.style.transform = `translate(${e.clientX - g.gw / 2}px, ${e.clientY - g.gh * 0.4}px)`;
  }
  clearHot(); const t = dropTarget(e.clientX, e.clientY);
  if (t && dropOK(g, t)) t.classList.add('drop-hot');
}

function dropOK(g, t) {
  const k = t.dataset.drop;
  if (k === 'bf') return t.dataset.pid === S.you;
  if (k === 'pile') return t.dataset.pid === S.you || t.dataset.pid === g.c.owner;
  return true;
}

function sendPositions(g, dx, dy, finalize) {
  const br = g.br;
  const moves = g.items.map((it) => {
    const cw = it.w; const x = (it.x0 + dx - cw / 2) / br.width, y = (it.y0 + dy - it.h / 2) / br.height;
    const cx = Math.max(0, Math.min(1 - cw / br.width, x)), cy = Math.max(0, Math.min(1 - it.h / br.height, y));
    if (finalize) { it.el.style.setProperty('--x', cx); it.el.style.setProperty('--y', cy); }
    return { id: it.id, x: cx, y: cy };
  });
  send('pos', { moves });
}

window.addEventListener('pointerup', (e) => {
  if (marquee) { marquee.box?.remove(); marquee = null; return; }
  if (!gesture) return;
  const g = gesture; gesture = null; clearHot(); document.body.classList.remove('is-dragging');
  if (!g.drag) { clickCard(g, e); return; }
  const t = dropTarget(e.clientX, e.clientY);
  const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
  if (g.mode === 'bf') {
    g.items.forEach((it) => { dragging.delete(it.id); it.el.classList.remove('dragging'); });
    const kind = t?.dataset.drop;
    if (kind === 'bf' && t.dataset.pid === S.you) sendPositions(g, dx, dy, true);
    else if (t && dropOK(g, t)) dropOn(t, g.items.map((i) => i.id), g, e);
    g.items.forEach((it) => (it.el.style.translate = ''));
  } else {
    g.ghost.remove(); g.ce.classList.remove('ghosted');
    if (t && dropOK(g, t)) dropOn(t, [g.id], g, e);
  }
});

function dropOn(t, ids, g, e) {
  const k = t.dataset.drop; const extra = g.c._search ? { shuffle: true } : {};
  if (k === 'bf') {
    const r = t.getBoundingClientRect(); const cw = parseFloat(getComputedStyle(t).getPropertyValue('--cw')) || 80;
    const x = Math.max(0, Math.min(1 - cw / r.width, (e.clientX - r.left - cw / 2) / r.width));
    const y = Math.max(0, Math.min(1 - cw * 1.4 / r.height, (e.clientY - r.top - cw * 0.7) / r.height));
    mv(ids, 'battlefield', { x, y, ...extra });
  } else if (k === 'pile') {
    const z = t.dataset.zone; mv(ids, z, { pos: e.shiftKey ? 'bottom' : 'top' });
  } else if (k === 'hand') mv(ids, 'hand', extra);
  else if (k === 'stack') mv(ids, 'stack', extra);
}

function clickCard(g, e) {
  const c = g.c;
  const cb = S.combat;
  if (cb?.step === 'block' && c.zone === 'battlefield') {
    const atk = cb.atk.find((a) => a.id === c.id);
    if (atk && atk.target === S.you) {
      const mine = [...sel].filter((id) => { const x = S.cards[id]; return x && x.pid === S.you && x.zone === 'battlefield'; });
      if (mine.length) { send('block', { ids: mine, attacker: c.id }); sel.clear(); renderSel(); } else toast('Selecione suas criaturas primeiro, depois clique no atacante.');
      return;
    }
  }
  if (g.ce.closest('.pile-stack')) { const p = g.ce.closest('.pile'); openZone(p.dataset.pid, p.dataset.zone); return; }
  if (c.zone === 'battlefield' && g.ce.closest('.bf')) {
    if (g.ctrl) { sel.has(g.id) ? sel.delete(g.id) : sel.add(g.id); } else { sel.clear(); sel.add(g.id); }
    renderSel();
  }
}

function renderSel() { for (const [id, e] of els) e.classList.toggle('selected', sel.has(id)); }

document.addEventListener('dblclick', (e) => {
  const ce = e.target.closest('.card[data-id]'); if (!ce || interactive(e.target)) return;
  const c = getCard(ce.dataset.id); if (!c || !canControl(c)) return;
  const cb = S.combat;
  if (c.zone === 'battlefield') {
    if (cb?.step === 'declare' && S.turn.active === S.you) { send('attack', { ids: sel.has(c.id) ? [...sel] : [c.id], target: attackTarget }); return; }
    if (cb?.step === 'block' && Object.values(cb.blocks).some((l) => l.includes(c.id))) { send('unblock', { ids: [c.id] }); return; }
    send('tap', { ids: sel.has(c.id) ? [...sel] : [c.id] });
  } else if (c.zone === 'hand') mv([c.id], 'battlefield', {});
  else if (c.zone !== 'stack' && c.zone !== 'reveal') mv([c.id], 'battlefield', { force: true });
  else if (c.zone === 'stack') send('resolve');
});

// chips: contadores, vida etc.
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-k]');
  if (chip) { const id = chip.closest('.card').dataset.id; chipAct(id, chip.dataset.k, e.shiftKey ? -1 : 1); return; }
  const loy = e.target.closest('.loy.on');
  if (loy) { const id = loy.closest('.card').dataset.id; send('counter', { id, kind: loy.dataset.k, delta: e.shiftKey ? -1 : 1, silent: true }); return; }
  const lb = e.target.closest('.lb'); if (lb) { const pid = lb.closest('.seat').dataset.pid; send('life', { pid, delta: (e.shiftKey ? 5 : 1) * +lb.dataset.life, quiet: false }); return; }
  const lv = e.target.closest('.lv'); if (lv) { const pid = lv.closest('.seat').dataset.pid; ask('Definir vida', String(S.players[pid].life)).then((v) => { if (v != null && /^-?\d+$/.test(v)) send('life', { pid, set: +v }); }); return; }
  const pm = e.target.closest('.pmore'); if (pm) { playerMenu(pm.closest('.seat').dataset.pid, e.clientX, e.clientY); return; }
  const pc = e.target.closest('.pc'); if (pc) { send('pcount', { pid: pc.closest('.seat').dataset.pid, kind: pc.dataset.pc, delta: e.shiftKey ? -1 : 1 }); return; }
  const cd = e.target.closest('.cd'); if (cd) { send('cmdDmg', { to: cd.closest('.seat').dataset.pid, from: cd.dataset.from, delta: e.shiftKey ? -1 : 1 }); return; }
  const pile = e.target.closest('.pile'); if (pile && !e.target.closest('.card')) openZone(pile.dataset.pid, pile.dataset.zone);
});

function chipAct(id, k, d) { if (k === '__dmg') send('dmg', { id, delta: d }); else send('counter', { id, kind: k, delta: d, silent: true }); }

document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input,textarea')) return;
  const chip = e.target.closest('.chip[data-k]');
  if (chip) { e.preventDefault(); chipAct(chip.closest('.card').dataset.id, chip.dataset.k, -1); return; }
  const loy = e.target.closest('.loy.on'); if (loy) { e.preventDefault(); send('counter', { id: loy.closest('.card').dataset.id, kind: loy.dataset.k, delta: -1, silent: true }); return; }
  const pc = e.target.closest('.pc'); if (pc) { e.preventDefault(); send('pcount', { pid: pc.closest('.seat').dataset.pid, kind: pc.dataset.pc, delta: -1 }); return; }
  const cd = e.target.closest('.cd'); if (cd) { e.preventDefault(); send('cmdDmg', { to: cd.closest('.seat').dataset.pid, from: cd.dataset.from, delta: -1 }); return; }
  const lb = e.target.closest('.lb'); if (lb) { e.preventDefault(); return; }
  const ce = e.target.closest('.card[data-id]');
  if (ce && !ce.classList.contains('libtop')) {
    const c = getCard(ce.dataset.id); if (!c) return; e.preventDefault();
    if (c.zone === 'battlefield' && sel.has(c.id) && sel.size > 1) cardMenu(c, e.clientX, e.clientY, [...sel]);
    else cardMenu(c, e.clientX, e.clientY);
    return;
  }
  const pile = e.target.closest('.pile'); if (pile) { e.preventDefault(); pileMenu(pile.dataset.pid, pile.dataset.zone, e.clientX, e.clientY); return; }
  const bf = e.target.closest('.bf');
  if (bf && bf.dataset.pid === S.you) {
    e.preventDefault(); const r = bf.getBoundingClientRect(); const nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
    menu([{ title: 'Campo de batalha' }, { label: 'Criar ficha…', icon: '✚', fn: () => openTokens(nx, ny) }, { label: 'Desvirar tudo', icon: '↻', kbd: 'U', fn: () => send('untapAll') }, { label: 'Ping aqui', icon: '📍', fn: () => send('ping', { kind: 'point', pid: S.you, x: nx, y: ny }) }, sel.size ? { label: `Virar/Desvirar seleção (${sel.size})`, fn: () => send('tap', { ids: [...sel] }) } : null], e.clientX, e.clientY);
  }
  const seat = e.target.closest('.seat-head');
  if (seat) { e.preventDefault(); const pid = seat.closest('.seat').dataset.pid; menu([{ title: S.players[pid].name }, { label: 'Ping neste jogador', icon: '📍', fn: () => send('ping', { kind: 'point', pid, x: 0.5, y: 0.1 }) }, pid === S.you ? { label: 'Renomear', fn: () => ask('Seu nome', me().name).then((n) => n && send('rename', { name: n })) } : null], e.clientX, e.clientY); }
});

// hover preview
document.addEventListener('mouseover', (e) => {
  const ce = e.target.closest?.('.card[data-id]');
  const id = ce && !ce.classList.contains('libtop') ? ce.dataset.id : null;
  if (id === hoverId) return; hoverId = id;
  const pv = $('#preview');
  const c = id && getCard(id);
  if (!c) { pv.classList.remove('on'); return; }
  const f = faceOf(c);
  const hidden = !f || ce.classList.contains('showback');
  if (hidden) { pv.classList.remove('on'); return; }
  $('img', pv).src = f.n || f.s || '';
  $('.pv-name', pv).textContent = f.name;
  $('.pv-type', pv).textContent = f.type;
  $('.pv-mana', pv).innerHTML = manaHTML(f.mana);
  const n = Object.entries(c.counters || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ');
  $('.pv-extra', pv).textContent = n;
  pv.classList.add('on');
});

// ====================== TECLADO ======================
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input,textarea')) { send('undo'); e.preventDefault(); return; }
  if (e.target.closest('input,textarea,select') || e.ctrlKey || e.metaKey) return;
  if ($('.overlay')) return;
  const k = e.key.toLowerCase();
  const ids = () => (hoverId && getCard(hoverId) && !sel.has(hoverId) ? [hoverId] : [...sel]).filter((i) => canControl(getCard(i)));
  const act = (fn) => { const l = ids(); if (l.length) { fn(l); e.preventDefault(); } };
  if (k === 'd') send('draw', { n: 1 });
  else if (k === 's') send('shuffle');
  else if (k === 'u') send('untapAll');
  else if (k === 't') act((l) => send('tap', { ids: l }));
  else if (k === 'f') act((l) => send('flip', { ids: l }));
  else if (k === 'x') act((l) => send('face', { ids: l }));
  else if (k === 'g' || k === 'delete') act((l) => mv(l, 'graveyard'));
  else if (k === 'e') act((l) => mv(l, 'exile'));
  else if (k === 'h') act((l) => mv(l, 'hand'));
  else if (k === 'c') act((l) => l.forEach((i) => send('counter', { id: i, kind: '+1/+1', delta: 1 })));
  else if (k === 'v') act((l) => l.forEach((i) => send('counter', { id: i, kind: '-1/-1', delta: 1 })));
  else if (k === '+' || k === '=') act((l) => l.forEach((i) => send('counter', { id: i, kind: getCard(i).counters?.loyalty != null ? 'loyalty' : '+1/+1', delta: 1 })));
  else if (k === '-') act((l) => l.forEach((i) => send('counter', { id: i, kind: getCard(i).counters?.loyalty != null ? 'loyalty' : '-1/-1', delta: 1 })));
  else if (k === ' ') { if (S.stack.length) send('resolve'); else { const pb = $('#btn-primary'); if (!pb.classList.contains('hidden')) pb.click(); } e.preventDefault(); }
  else if (k === 'a') { const ids2 = [...sel].filter((i) => canControl(getCard(i))); if (ids2.length) send('attack', { ids: ids2, target: attackTarget }); }
  else if (k === 'b') send('doneBlock');
  else if (k === 'escape') { sel.clear(); renderSel(); closeMenu(); }
  else if (k === 'enter') { $('#chatin').focus(); e.preventDefault(); }
  else if ('12345'.includes(k) && k.length === 1) callout(CALLS[+k - 1][1]);
});

export const CALLS = [['❗', 'Prioridade?'], ['✋', 'Espera!'], ['👍', 'Ok / Pode seguir'], ['⚔️', 'Vou atacar'], ['↩️', 'Tenho resposta']];

// ====================== TOKENS ======================
const QUICK_TOKENS = ['Treasure', 'Food', 'Clue', 'Blood', 'Soldier', 'Zombie', 'Goblin', 'Spirit', 'Thopter', 'Elf Warrior', 'Beast', 'Saproling', 'Human', 'Rat', 'Construct', 'Angel', 'Dragon', 'Wolf', 'Cat', 'Insect'];
export function openTokens(x, y) {
  const m = modal({ title: 'Criar ficha ou carta temporária', wide: true });
  const inp = el('input', { class: 'inp', placeholder: 'Buscar ficha (ex.: Treasure, Goblin, Zombie 2/2…) ou carta qualquer', type: 'search' });
  const anyCard = el('input', { type: 'checkbox', id: 'anycard' });
  const qty = el('input', { class: 'inp qty', type: 'number', min: 1, max: 30, value: 1, title: 'Quantidade' });
  const quick = el('div', { class: 'quick' }, QUICK_TOKENS.map((n) => el('button', { class: 'tag', onclick: () => { inp.value = n; run(); } }, n)));
  const res = el('div', { class: 'modal-grid tokres' });
  m.body.append(el('div', { class: 'row' }, inp, el('label', { class: 'chk' }, anyCard, 'incluir cartas normais'), el('label', { class: 'chk' }, 'Qtd.', qty)), quick, res);
  const run = async () => {
    const q = inp.value.trim(); if (!q) return; res.textContent = ''; res.append(el('p', { class: 'muted' }, 'Buscando…'));
    try {
      const j = await scry.search(anyCard.checked ? q : `t:token ${q}`, { order: 'name', unique: anyCard.checked ? 'cards' : 'art' });
      res.textContent = '';
      if (!j.data?.length) res.append(el('p', { class: 'muted' }, 'Nada encontrado.'));
      for (const c of j.data.slice(0, 40)) {
        const meta = scry.getMeta(c.id); const f = meta.faces[0];
        res.append(el('button', { class: 'tokcard', title: c.name, onclick: () => { send('token', { meta, n: +qty.value || 1, x, y }); m.close(); } }, el('img', { src: f.s, loading: 'lazy', alt: c.name }), el('span', {}, `${c.name}${f.power ? ' ' + f.power + '/' + f.toughness : ''}`)));
      }
    } catch (err) { res.textContent = ''; res.append(el('p', { class: 'err' }, 'Falha na busca: ' + err.message)); }
  };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && run()); inp.focus();
}

// ====================== MENU / CONFIG ======================
function settingsModal() {
  const m = modal({ title: 'Configurações', cls: 'small' });
  const sw = (key, label) => { const i = el('input', { type: 'checkbox', checked: !!S.settings[key], onchange: () => send('settings', { [key]: i.checked }) }); return el('label', { class: 'sw' }, i, el('span', {}, label)); };
  const delay = el('select', { class: 'inp sel', onchange: () => send('settings', { stackDelay: +delay.value }) }, [2, 4, 6, 10].map((n) => el('option', { value: n, selected: (S.settings.stackDelay || 4) === n }, `${n}s`)));
  const zr = el('input', { type: 'range', min: 0.7, max: 1.7, step: 0.05, value: zoom, oninput: () => { setZoom(+zr.value); try { localStorage.setItem('mtg.zoom', zr.value); } catch {} } });
  m.body.append(
    el('h4', {}, 'Automação'),
    sw('autoPay', 'Pagar mana automaticamente'), sw('autoResolve', 'Resolver a pilha sozinha'),
    el('div', { class: 'sw' }, el('span', {}, 'Tempo para responder'), delay),
    sw('autoDamage', 'Dano letal destrói criaturas'), sw('autoCommander', 'Comandante volta à zona de comando'),
    sw('autoUntap', 'Desvirar no início do turno'), sw('autoDraw', 'Comprar no início do turno'),
    el('h4', {}, 'Tamanho das cartas'), zr);
}

function mainMenu(x, y) {
  const solo = S.solo;
  menu([
    { label: 'Comprar carta', icon: '🂠', kbd: 'D', fn: () => send('draw', { n: 1 }) },
    { label: 'Desfazer', icon: '↶', kbd: 'Ctrl+Z', fn: () => send('undo') },
    { label: 'Desvirar tudo', icon: '↻', kbd: 'U', fn: () => send('untapAll') },
    { label: 'Criar ficha…', icon: '✚', fn: () => openTokens() },
    { sep: true },
    { label: 'Decks', icon: '📚', fn: () => window.dispatchEvent(new Event('arcanum:decks')) },
    !solo ? { label: 'Convidar para a sala', icon: '🔗', fn: () => window.dispatchEvent(new Event('arcanum:invite')) } : null,
    { label: 'Registro e chat', icon: '💬', fn: toggleSide },
    { label: 'Avisos rápidos', icon: '📣', sub: CALLS.map(([i, t]) => ({ label: `${i}  ${t}`, fn: () => callout(t) })) },
    { sep: true },
    { label: 'Configurações', icon: '⚙', fn: settingsModal },
    { label: 'Atalhos', icon: '⌨', fn: () => $('#help').classList.toggle('hidden') },
    { label: solo ? 'Sair do modo solo' : 'Sair da sala', icon: '⎋', danger: true, fn: () => window.dispatchEvent(new Event('arcanum:leave')) },
  ], x, y);
}

let unread = 0;
function toggleSide(force) {
  const g = $('#game'); const open = force === undefined || typeof force === 'object' ? !g.classList.contains('sideopen') : force;
  g.classList.toggle('sideopen', open);
  if (open) { unread = 0; $('#chatbadge').classList.add('hidden'); const l = $('#log'); l.scrollTop = l.scrollHeight; }
}

// ====================== INIT ======================
export function initTable() {
  $('#stackzone').dataset.drop = 'stack'; $('#hand').dataset.drop = 'hand'; $('#handbar').dataset.drop = 'hand';
  $('#btn-resolve').onclick = () => send('resolve');
  $('#btn-hold').onclick = () => send('hold');
  $('#btn-menu').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); mainMenu(Math.max(8, r.right - 230), r.bottom + 6); };
  $('#btn-chat').onclick = toggleSide; $('#btn-side-x').onclick = () => toggleSide(false);
  $('#chatform').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#chatin').value.trim(); if (v) send('chat', { text: v }); $('#chatin').value = ''; $('#chatin').blur(); });
}

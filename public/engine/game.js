// Motor de jogo autoritativo. Cada ação do cliente é validada aqui, aplicada,
// passa pelas "state-based actions" (automação) e vira um DELTA enviado a cada jogador
// (com informação oculta já filtrada: biblioteca e mãos alheias nunca saem do servidor).

import { parseCost, manaSource, planPayment } from './mana.js';

const COLORS = ['#e0b24a', '#4aa3e0', '#e05a5a', '#5ac98a', '#b27ae0', '#e08f4a'];
const PUBLIC_ZONES = ['battlefield', 'graveyard', 'exile', 'command'];
const PERMANENT = /Creature|Artifact|Enchantment|Land|Planeswalker|Battle/;

export function createRoom(id) {
  return {
    id, players: [], cards: {}, meta: {}, stack: [],
    seq: 1, z: 1, log: [], history: [],
    turn: { active: null, num: 0, phase: 'main1' },
    settings: { autoCommander: true, autoDamage: true, autoDraw: true, autoUntap: true, autoPay: true, autoResolve: true, stackDelay: 4 },
    combat: null, timers: {}, stackDue: 0,
    dirty: null, out: [], lastActive: Date.now(),
  };
}

const newDirty = () => ({ cards: new Set(), zones: new Set(), players: new Set(), stack: false, turn: false, settings: false, combat: false, log: [] });

export function addPlayer(room, cid, name) {
  const seat = room.players.length;
  if (seat >= 6) return null;
  const p = {
    id: 'p' + (room.seq++), cid, name: (name || 'Jogador').slice(0, 24), color: COLORS[seat % COLORS.length], seat,
    connected: true, life: 40, poison: 0, energy: 0, exp: 0, rad: 0, tix: 0, cmd: {}, passed: false, hold: false, keep: false, mulls: 0, deck: false,
    zones: { library: [], hand: [], graveyard: [], exile: [], command: [], battlefield: [] },
  };
  room.players.push(p);
  return p;
}

export const getPlayer = (room, pid) => room.players.find((p) => p.id === pid);
const zoneArr = (room, pid, zone) => (zone === 'stack' ? room.stack : getPlayer(room, pid).zones[zone]);
const faceOf = (room, c) => { const m = room.meta[c.sid]; return m ? m.faces[Math.min(c.face || 0, m.faces.length - 1)] : null; };
const typeOf = (room, c) => (faceOf(room, c)?.type || '');
const numOf = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

// ---------- helpers de log/dirty ----------
function begin(room) { room.dirty = newDirty(); }
function say(room, pid, m) {
  const e = { p: pid, m, ts: Date.now() };
  room.dirty.log.push(e); room.log.push(e); if (room.log.length > 250) room.log.shift();
}
const dc = (room, c) => room.dirty.cards.add(c.id);
const dz = (room, pid, zone) => { if (zone === 'stack') room.dirty.stack = true; else room.dirty.zones.add(pid + ':' + zone); };
const dp = (room, p) => room.dirty.players.add(p.id);

function cname(room, c) {
  if (c.fd) return 'uma carta virada';
  return room.meta[c.sid]?.faces[c.face || 0]?.name || room.meta[c.sid]?.name || 'carta';
}

// ---------- movimentação de cartas (núcleo da automação) ----------
function removeFromZone(room, c) {
  const arr = c.zone === 'stack' ? room.stack : getPlayer(room, c.pid)?.zones[c.zone];
  if (!arr) return;
  const i = arr.indexOf(c.id);
  if (i >= 0) arr.splice(i, 1);
  dz(room, c.pid, c.zone);
}

function freeSpot(room, p, c) {
  // Posição automática: terrenos embaixo, criaturas no meio, resto em cima.
  const t = typeOf(room, c);
  const y = /Land/.test(t) ? 0.68 : /Creature/.test(t) ? 0.36 : 0.04;
  const others = p.zones.battlefield.map((id) => room.cards[id]).filter((o) => o && o !== c && Math.abs(o.y - y) < 0.12);
  for (let row = 0; row < 3; row++) {
    for (let x = 0.02; x < 0.88; x += 0.075) {
      if (!others.some((o) => Math.abs(o.x - x) < 0.065 && Math.abs(o.y - (y + row * 0.0)) < 0.1)) return { x, y };
    }
    break;
  }
  return { x: 0.02 + Math.random() * 0.8, y: y + (Math.random() - 0.5) * 0.08 };
}

export function moveCard(room, c, toPid, toZone, o = {}) {
  const from = c.zone;
  const owner = c.owner;
  const prevPid = c.pid;
  // Fichas deixam de existir ao sair do campo
  if (c.token && toZone !== 'battlefield' && toZone !== 'stack') {
    removeFromZone(room, c); delete room.cards[c.id]; room.dirty.cards.add(c.id);
    if (from === 'battlefield') say(room, o.by, `${cname(room, c)} (ficha) deixou de existir.`);
    return null;
  }
  // Comandante volta para a zona de comando
  if (c.cmd && room.settings.autoCommander && (from === 'battlefield' || from === 'stack') && ['graveyard', 'exile', 'hand', 'library'].includes(toZone)) {
    say(room, o.by, `${cname(room, c)} voltou para a zona de comando.`);
    toZone = 'command';
  }
  removeFromZone(room, c);
  if (from === 'battlefield') {
    c.tapped = false; c.counters = {}; c.dmg = 0; c.mp = 0; c.mt = 0; c.dtd = false; c.fd = false; c.face = 0; c.sick = false;
  }
  if (from === 'command' && (toZone === 'stack' || toZone === 'battlefield')) c.tax = (c.tax || 0) + 1;
  if (toZone === 'stack') { c.pid = null; c.caster = o.by || owner; c.zone = 'stack'; room.stack.push(c.id); room.dirty.stack = true; }
  else {
    c.zone = toZone;
    c.pid = toZone === 'battlefield' ? (toPid || owner) : owner;
    const arr = getPlayer(room, c.pid).zones[toZone];
    if (toZone === 'library' && o.pos !== 'bottom') arr.unshift(c.id); else arr.push(c.id);
    dz(room, c.pid, toZone);
  }
  if (toZone === 'battlefield') {
    c.z = ++room.z;
    if (from !== 'battlefield') enterBattlefield(room, c, o);
    const p = getPlayer(room, c.pid);
    if (o.x != null && o.y != null) { c.x = o.x; c.y = o.y; }
    else if (from !== 'battlefield' || prevPid !== c.pid) Object.assign(c, freeSpot(room, p, c));
  }
  if (toZone === 'hand' || toZone === 'library') c.revealed = false;
  dc(room, c);
  return c;
}

function enterBattlefield(room, c, o) {
  const f = faceOf(room, c) || {};
  const t = f.type || '';
  c.counters = c.counters || {};
  if (o.fd) c.fd = true;
  if (/Planeswalker/.test(t) && numOf(f.loyalty) != null) c.counters.loyalty = numOf(f.loyalty);
  if (/Battle/.test(t) && numOf(f.defense) != null) c.counters.defense = numOf(f.defense);
  if (/Saga/.test(t)) c.counters.lore = 1;
  const nm = (f.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = (f.text || '').split('\n');
  if (lines.some((l) => new RegExp(`^(${nm}|~) enters( the battlefield)? tapped\\.?$`, 'i').test(l.trim()))) c.tapped = true;
  if (/Creature/.test(t) && !/\bHaste\b/i.test(f.text || '')) c.sick = true;
}

// ---------- state-based actions ----------
export function runSBA(room) {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const p of room.players) {
      for (const id of [...p.zones.battlefield]) {
        const c = room.cards[id]; if (!c) continue;
        const f = faceOf(room, c) || {}; const t = f.type || '';
        // +1/+1 e -1/-1 se anulam
        const a = c.counters['+1/+1'] || 0, b = c.counters['-1/-1'] || 0;
        if (a && b) {
          const m = Math.min(a, b);
          c.counters['+1/+1'] -= m; c.counters['-1/-1'] -= m;
          dc(room, c); changed = true;
        }
        for (const k of Object.keys(c.counters)) if (!c.counters[k] && k !== 'loyalty') { delete c.counters[k]; dc(room, c); }
        if (c.fd) continue;
        if (/Creature/.test(t)) {
          const base = numOf(f.toughness);
          if (base != null) {
            const tough = base + (c.counters['+1/+1'] || 0) - (c.counters['-1/-1'] || 0) + (c.mt || 0);
            const indestr = /indestructible/i.test(f.text || '');
            if (tough <= 0) { say(room, null, `${cname(room, c)} morreu (resistência 0).`); moveCard(room, c, null, 'graveyard'); changed = true; continue; }
            if (room.settings.autoDamage && (c.dmg >= tough || c.dtd) && !indestr) { say(room, null, `${cname(room, c)} foi destruído (dano letal).`); moveCard(room, c, null, 'graveyard'); changed = true; continue; }
          }
        }
        if (/Planeswalker/.test(t) && c.counters.loyalty != null && c.counters.loyalty <= 0) {
          say(room, null, `${cname(room, c)} foi para o cemitério (0 de lealdade).`); moveCard(room, c, null, 'graveyard'); changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

// ---------- baralho ----------
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } }

function newCard(room, owner, sid, extra = {}) {
  const c = { id: 'c' + (room.seq++), sid, owner, pid: owner, zone: 'library', x: 0.1, y: 0.4, z: 0, tapped: false, fd: false, face: 0, counters: {}, dmg: 0, sick: false, token: false, cmd: false, tax: 0, ...extra };
  room.cards[c.id] = c; dc(room, c); return c;
}

function clearPlayerCards(room, p) {
  for (const c of Object.values(room.cards)) if (c.owner === p.id) { removeFromZone(room, c); delete room.cards[c.id]; room.dirty.cards.add(c.id); }
  for (const z of Object.keys(p.zones)) { p.zones[z] = []; dz(room, p.id, z); }
}

function draw(room, p, n) {
  let k = 0;
  for (let i = 0; i < n && p.zones.library.length; i++) {
    const c = room.cards[p.zones.library[0]]; moveCard(room, c, p.id, 'hand', { by: p.id }); k++;
  }
  return k;
}

// ---------- ações ----------
const canAct = (c, pid) => c && (c.owner === pid || c.pid === pid || c.zone === 'stack');
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

function startTurn(room, p) {
  room.turn.active = p.id; room.turn.num++; room.turn.phase = 'upkeep'; room.dirty.turn = true;
  for (const q of room.players) { q.passed = false; q.hold = false; }
  clearCombat(room);
  for (const q of room.players) for (const id of q.zones.battlefield) { const c = room.cards[id]; if (c.dmg || c.mp || c.mt || c.dtd) { c.dmg = 0; c.mp = 0; c.mt = 0; c.dtd = false; dc(room, c); } }
  if (room.settings.autoUntap) {
    for (const id of p.zones.battlefield) { const c = room.cards[id]; if (c.tapped || c.sick) { c.tapped = false; c.sick = false; dc(room, c); } }
  }
  say(room, p.id, `— Turno ${room.turn.num}: ${p.name} —`);
  if (room.settings.autoDraw && room.turn.num > 1) { const k = draw(room, p, 1); if (k) say(room, p.id, `${p.name} comprou uma carta.`); }
  room.turn.phase = 'main1';
}

function resolveTop(room, byPid) {
  const id = room.stack[room.stack.length - 1]; const c = room.cards[id]; if (!c) return;
  const perm = PERMANENT.test(typeOf(room, c));
  const caster = c.caster || c.owner;
  say(room, byPid, `${cname(room, c)} resolveu${perm ? '' : ' e foi para o cemitério'}.`);
  if (perm) moveCard(room, c, caster, 'battlefield', { by: caster }); else moveCard(room, c, null, 'graveyard', { by: caster });
  for (const q of room.players) q.passed = false;
}

// ---------- combate automático ----------
const KNOWN_KW = ['flying', 'reach', 'vigilance', 'defender', 'haste', 'deathtouch', 'lifelink', 'trample', 'first strike', 'double strike', 'menace', 'indestructible', 'infect', 'hexproof', 'flash'];
export function keywords(room, c) {
  const set = new Set(); const f = faceOf(room, c);
  if (f && !c.fd) for (const raw of (f.text || '').split('\n')) {
    const line = raw.replace(/\([^)]*\)/g, '').trim().toLowerCase(); if (!line) continue;
    const parts = line.split(/,\s*/);
    if (parts.every((x) => KNOWN_KW.includes(x))) parts.forEach((x) => set.add(x));
  }
  for (const k of KNOWN_KW) if (c.counters?.[k] > 0) set.add(k);
  return set;
}
const isCreature = (room, c) => !!c && (c.fd || /Creature/.test(typeOf(room, c)));
const baseStat = (room, c, k) => (c.fd ? 2 : numOf((faceOf(room, c) || {})[k]) ?? 0);
const powerOf = (room, c) => Math.max(0, baseStat(room, c, 'power') + (c.counters['+1/+1'] || 0) - (c.counters['-1/-1'] || 0) + (c.mp || 0));
const toughOf = (room, c) => baseStat(room, c, 'toughness') + (c.counters['+1/+1'] || 0) - (c.counters['-1/-1'] || 0) + (c.mt || 0);
const defendersOf = (cb) => [...new Set(cb.atk.map((a) => a.target))];
const ableBlockers = (room, pid) => (getPlayer(room, pid)?.zones.battlefield || []).map((i) => room.cards[i]).filter((c) => c && !c.tapped && isCreature(room, c));
const dcb = (room) => { room.dirty.combat = true; };

function canBlock(room, blocker, attacker) {
  const ka = keywords(room, attacker), kb = keywords(room, blocker);
  if (ka.has('flying') && !(kb.has('flying') || kb.has('reach'))) return `${cname(room, blocker)} não pode bloquear um atacante com voar.`;
  return null;
}

function newCombat(room) { room.combat = { step: 'declare', atk: [], blocks: {}, done: {} }; dcb(room); }
function clearCombat(room) { if (room.combat) { room.combat = null; dcb(room); } }

function finishDeclare(room, ctx, p) {
  const cb = room.combat; if (!cb || cb.step !== 'declare') return;
  cb.atk = cb.atk.filter((a) => room.cards[a.id]?.zone === 'battlefield');
  if (!cb.atk.length) { clearCombat(room); return; }
  cb.step = 'block'; cb.done = {}; dcb(room);
  for (const pid of defendersOf(cb)) { const d = getPlayer(room, pid); if (!d.connected || !ableBlockers(room, pid).length) cb.done[pid] = true; }
  const names = defendersOf(cb).map((x) => getPlayer(room, x).name).join(', ');
  say(room, p.id, `⚔ ${p.name} ataca ${names} com ${cb.atk.length} criatura(s).`);
  ctx.broadcast({ t: 'alert', kind: 'turn', text: `⚔ ${p.name} ataca ${names}!` });
  if (defendersOf(cb).every((x) => cb.done[x])) resolveCombat(room, ctx);
}

function lethalCheck(room, ctx, t) {
  if (t.life <= 0) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${t.name} está com ${t.life} de vida!` });
  if (t.poison >= 10) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${t.name} tem ${t.poison} marcadores de veneno!` });
  for (const [from, n] of Object.entries(t.cmd || {})) if (n >= 21) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${t.name} recebeu ${n} de dano de comandante de ${getPlayer(room, from)?.name}!` });
}

export function resolveCombat(room, ctx) {
  const cb = room.combat; if (!cb) return;
  const live = () => cb.atk.map((a) => ({ a, c: room.cards[a.id] })).filter((x) => x.c && x.c.zone === 'battlefield');
  const blockersOf = (a) => (cb.blocks[a.id] || []).map((i) => room.cards[i]).filter((b) => b && b.zone === 'battlefield');
  const fsAny = () => [...live().map((x) => x.c), ...live().flatMap((x) => blockersOf(x.a))].some((c) => { const k = keywords(room, c); return k.has('first strike') || k.has('double strike'); });
  const dealsIn = (c, first) => { const k = keywords(room, c); return first ? (k.has('first strike') || k.has('double strike')) : (!k.has('first strike') || k.has('double strike')); };
  const hit = {};
  const step = (first) => {
    const ev = [];
    for (const { a, c } of live()) {
      const k = keywords(room, c); const bl = blockersOf(a); const wasBlocked = (cb.blocks[a.id] || []).length > 0;
      if (dealsIn(c, first)) {
        const P = powerOf(room, c);
        if (!wasBlocked) ev.push({ src: c, player: a.target, n: P });
        else if (!bl.length) { if (k.has('trample')) ev.push({ src: c, player: a.target, n: P }); }
        else {
          let rem = P;
          bl.forEach((b, i) => {
            const need = k.has('deathtouch') ? 1 : Math.max(0, toughOf(room, b) - (b.dmg || 0));
            const give = i === bl.length - 1 && !k.has('trample') ? rem : Math.min(rem, need);
            if (give > 0) ev.push({ src: c, card: b, n: give }); rem -= give;
          });
          if (k.has('trample') && rem > 0) ev.push({ src: c, player: a.target, n: rem });
        }
      }
      for (const b of bl) if (dealsIn(b, first)) { const n = powerOf(room, b); if (n > 0) ev.push({ src: b, card: c, n }); }
    }
    for (const e of ev) {
      if (e.n <= 0) continue;
      const ks = keywords(room, e.src); const ctrl = getPlayer(room, e.src.pid);
      if (e.card) {
        if (ks.has('infect')) e.card.counters['-1/-1'] = (e.card.counters['-1/-1'] || 0) + e.n; else e.card.dmg = (e.card.dmg || 0) + e.n;
        if (ks.has('deathtouch')) e.card.dtd = true;
        dc(room, e.card);
      } else {
        const t = getPlayer(room, e.player);
        if (ks.has('infect')) t.poison += e.n;
        else { t.life -= e.n; if (e.src.cmd) t.cmd[e.src.owner] = (t.cmd[e.src.owner] || 0) + e.n; }
        hit[t.id] = (hit[t.id] || 0) + e.n; dp(room, t);
        say(room, null, `💥 ${cname(room, e.src)} causou ${e.n} de ${ks.has('infect') ? 'veneno' : 'dano'} a ${t.name}${e.src.cmd ? ' (comandante)' : ''}.`);
      }
      if (ks.has('lifelink') && ctrl) { ctrl.life += e.n; dp(room, ctrl); say(room, null, `♥ ${ctrl.name} ganhou ${e.n} de vida.`); }
    }
    runSBA(room);
  };
  if (fsAny()) step(true);
  step(false);
  for (const id of Object.keys(hit)) lethalCheck(room, ctx, getPlayer(room, id));
  say(room, null, '— Combate resolvido —');
  clearCombat(room);
}

// ---------- pagamento automático de mana ----------
function payFor(room, p, c, from) {
  const f = faceOf(room, c); if (!f) return;
  const tax = from === 'command' ? 2 * (c.tax || 0) : 0;
  const cost = parseCost(f.mana, tax);
  if (!cost.g && !cost.pips.length) return;
  const sources = [];
  for (const id of p.zones.battlefield) {
    const s = room.cards[id]; if (!s || s.tapped || s.fd) continue;
    const sf = faceOf(room, s); if (/Creature/.test(sf?.type || '') && s.sick) continue;
    const ms = manaSource(sf); if (ms) sources.push({ id, ...ms });
  }
  const plan = planPayment(cost, sources);
  const label = `${f.mana || ''}${tax ? ` +${tax} (taxa)` : ''}`;
  if (!plan) { say(room, p.id, `⚠ Mana insuficiente para ${cname(room, c)} (${label}) — conjurada sem pagar.`); return; }
  const names = [];
  for (const id of plan) {
    const s = room.cards[id]; names.push(cname(room, s));
    if (sources.find((x) => x.id === id).sac) moveCard(room, s, null, 'graveyard', { by: p.id }); else { s.tapped = true; dc(room, s); }
  }
  say(room, p.id, `${p.name} pagou ${label.trim()} (${names.join(', ')}).`);
}

// ---------- pilha com auto-resolução ----------
function syncStackTimer(room, ctx, prevLen) {
  const stop = () => { if (room.timers.stack) { ctx.cancel('stack'); room.stackDue = 0; room.dirty.stack = true; } };
  if (!room.stack.length || !room.settings.autoResolve) return stop();
  if (room.players.some((q) => q.connected && q.hold)) return stop();
  if (room.timers.stack && room.stack.length === prevLen) return;
  const ms = room.settings.stackDelay * 1000; room.stackDue = Date.now() + ms; room.dirty.stack = true;
  ctx.later('stack', ms, () => {
    if (room.stack.length && !room.players.some((q) => q.connected && q.hold)) resolveTop(room, null);
    room.stackDue = 0; room.dirty.stack = true;
    syncStackTimer(room, ctx, -1);
  });
}

export function tick(room, fn) { begin(room); fn(); runSBA(room); }

// ---------- início de jogo / mulligan ----------
function startGame(room, ctx) {
  const live = room.players.filter((q) => q.connected && q.deck && !q.bot);
  if (!live.length) return;
  const first = live[(Math.random() * live.length) | 0]; room.turn.num = 0; startTurn(room, first);
  say(room, null, `${first.name} começa o jogo.`); ctx.broadcast({ t: 'alert', kind: 'turn', text: `${first.name} começa!` });
}
function maybeAutoStart(room, ctx) {
  if (room.turn.num > 0) return;
  const live = room.players.filter((q) => q.connected && !q.bot);
  if (live.length && live.every((q) => q.deck && q.keep)) startGame(room, ctx);
}

const PHASES = ['upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];
function nextTurn(room, ctx) {
  if (room.turn.active == null) return;
  const live = room.players.filter((q) => q.connected && !q.bot); if (!live.length) return;
  if (room.combat) { if (room.combat.step === 'block') resolveCombat(room, ctx); else clearCombat(room); }
  const idx = live.findIndex((q) => q.id === room.turn.active);
  startTurn(room, live[(idx + 1) % live.length]);
  const act = getPlayer(room, room.turn.active); ctx.broadcast({ t: 'alert', kind: 'turn', text: `Turno de ${act.name}` });
}
function nextPhase(room, ctx, p) {
  if (room.turn.active == null) return;
  const cb = room.combat;
  if (cb && room.turn.phase === 'combat') {
    if (cb.step === 'declare') { finishDeclare(room, ctx, p); if (room.combat) return; }
    else if (cb.step === 'block') { resolveCombat(room, ctx); }
  }
  const i = PHASES.indexOf(room.turn.phase);
  if (i >= PHASES.length - 1) return nextTurn(room, ctx);
  room.turn.phase = PHASES[i + 1]; room.dirty.turn = true;
  if (room.turn.phase === 'combat') { newCombat(room); say(room, null, `${getPlayer(room, room.turn.active).name} entra na fase de combate.`); }
}

// ---------- desfazer: snapshots do estado de jogo ----------
const NONMUT = ['ping', 'chat', 'peek', 'revealTop', 'revealHand', 'rename', 'settings', 'undo', 'lib', 'phase'];
const snapshot = (room) => structuredClone({
  cards: room.cards, stack: room.stack, z: room.z, turn: room.turn, combat: room.combat,
  players: room.players.map((p) => ({ id: p.id, life: p.life, poison: p.poison, energy: p.energy, exp: p.exp, rad: p.rad, tix: p.tix, cmd: p.cmd, mulls: p.mulls, deck: p.deck, keep: p.keep, passed: p.passed, zones: p.zones })),
});
function restore(room, s) {
  const ids = new Set([...Object.keys(room.cards), ...Object.keys(s.cards)]);
  room.cards = s.cards; room.stack = s.stack; room.z = s.z; room.turn = s.turn; room.combat = s.combat;
  for (const sp of s.players) { const p = getPlayer(room, sp.id); if (p) Object.assign(p, sp); }
  for (const id of ids) room.dirty.cards.add(id);
  for (const p of room.players) { room.dirty.players.add(p.id); for (const z of Object.keys(p.zones)) room.dirty.zones.add(p.id + ':' + z); }
  room.dirty.stack = room.dirty.turn = room.dirty.combat = true;
}

export function handle(room, p, m, ctx) {
  begin(room);
  room.lastActive = Date.now();
  const A = m.a; const prevStackLen = room.stack.length;
  if (!NONMUT.includes(A)) {
    const h = room.history, last = h[h.length - 1], now = Date.now();
    if (A === 'pos' && last && last.pid === p.id && last.a === 'pos' && now - last.t < 1500) last.t = now; // arrastar = 1 passo
    else { h.push({ pid: p.id, a: A, t: now, snap: snapshot(room) }); if (h.length > 40) h.shift(); }
  }
  const cards = () => (m.ids || (m.id ? [m.id] : [])).map((i) => room.cards[i]).filter((c) => canAct(c, p.id));
  switch (A) {
    case 'loadDeck': {
      const entries = (m.entries || []).slice(0, 400);
      const total = entries.reduce((s, e) => s + clampN(e.qty | 0, 1, 99), 0);
      if (total > 400) break;
      for (const [sid, meta] of Object.entries(m.meta || {})) if (meta && Array.isArray(meta.faces) && meta.faces.length) room.meta[sid] = { ...meta, sid };
      clearPlayerCards(room, p);
      for (const e of entries) {
        if (!room.meta[e.sid]) continue;
        for (let i = 0; i < clampN(e.qty | 0, 1, 99); i++) {
          const c = newCard(room, p.id, e.sid, { cmd: !!e.cmd, zone: e.cmd ? 'command' : 'library' });
          p.zones[c.zone].push(c.id);
        }
      }
      shuffle(p.zones.library); p.deck = true; p.life = entries.some((e) => e.cmd) ? 40 : 20; p.mulls = 0; p.cmd = {}; p.keep = room.turn.num > 0;
      for (const z of ['library', 'command']) dz(room, p.id, z);
      draw(room, p, 7); dp(room, p);
      say(room, p.id, `${p.name} carregou o baralho (${total} cartas) e comprou 7.`);
      maybeAutoStart(room, ctx);
      break;
    }
    case 'draw': { const k = draw(room, p, clampN(m.n | 0 || 1, 1, 30)); say(room, p.id, `${p.name} comprou ${k} carta${k > 1 ? 's' : ''}.`); break; }
    case 'shuffle': shuffle(p.zones.library); dz(room, p.id, 'library'); say(room, p.id, `${p.name} embaralhou a biblioteca.`); break;
    case 'mulligan': {
      if (p.keep) break;
      for (const id of [...p.zones.hand]) moveCard(room, room.cards[id], p.id, 'library', { by: p.id });
      shuffle(p.zones.library); p.mulls++; draw(room, p, 7);
      say(room, p.id, `${p.name} fez mulligan (${p.mulls}). Escolha ${p.mulls} carta(s) para o fundo.`); break;
    }
    case 'mill': case 'exileTop': {
      const n = clampN(m.n | 0 || 1, 1, 60); const dest = A === 'mill' ? 'graveyard' : 'exile';
      for (let i = 0; i < n && p.zones.library.length; i++) moveCard(room, room.cards[p.zones.library[0]], p.id, dest, { by: p.id });
      say(room, p.id, `${p.name} ${A === 'mill' ? 'moeu' : 'exilou'} ${n} carta(s) do topo.`); break;
    }
    case 'peek': case 'revealTop': case 'revealHand': {
      let ids;
      if (A === 'revealHand') ids = m.ids?.length ? m.ids.filter((i) => p.zones.hand.includes(i)) : [...p.zones.hand];
      else ids = p.zones.library.slice(0, m.all ? 1e9 : clampN(m.n | 0 || 1, 1, 100));
      const list = ids.map((i) => ({ id: i, sid: room.cards[i].sid }));
      if (A === 'peek') ctx.sendTo(p.id, { t: 'peek', mode: m.mode || 'scry', cards: list, total: p.zones.library.length });
      else { ctx.broadcast({ t: 'reveal', by: p.id, from: A === 'revealHand' ? 'hand' : 'library', cards: list }); say(room, p.id, `${p.name} revelou ${list.map((x) => room.meta[x.sid]?.name).join(', ') || 'nada'}.`); }
      break;
    }
    case 'move': {
      const list = cards(); if (!list.length) break;
      const zone = m.zone; if (!['battlefield', 'graveyard', 'exile', 'hand', 'library', 'command', 'stack'].includes(zone)) break;
      let i = 0;
      for (const c of list) {
        const from = c.zone;
        const fromDesc = { hand: 'da mão', battlefield: 'do campo', graveyard: 'do cemitério', exile: 'do exílio', library: 'da biblioteca', command: 'da zona de comando', stack: 'da pilha' }[from];
        const nm = cname(room, c);
        let dest = zone, toPid = zone === 'battlefield' ? (m.pid && getPlayer(room, m.pid) ? m.pid : p.id) : null;
        // Mágicas instantâneas/feitiços soltos no campo vão para a pilha
        if (dest === 'battlefield' && from !== 'battlefield' && from !== 'stack' && !m.force && /^(Instant|Sorcery)/.test(typeOf(room, c).replace(/^(Tribal|Kindred|Snow|Legendary)\s+/g, ''))) dest = 'stack';
        const x = m.x != null ? clampN(m.x + (i % 6) * 0.035, 0, 0.92) : null, y = m.y != null ? clampN(m.y + (i % 6) * 0.025, 0, 0.9) : null;
        if (from === 'battlefield' && dest === 'battlefield' && toPid === c.pid) { if (x != null) { c.x = x; c.y = y; c.z = ++room.z; dc(room, c); } i++; continue; }
        if (room.settings.autoPay && (from === 'hand' || from === 'command') && (dest === 'stack' || (dest === 'battlefield' && !m.fd))) payFor(room, p, c, from);
        const r = moveCard(room, c, toPid, dest, { by: p.id, pos: m.pos, x, y, fd: !!m.fd });
        const lbl = { battlefield: 'campo de batalha', graveyard: 'cemitério', exile: 'exílio', hand: 'mão', library: m.pos === 'bottom' ? 'fundo da biblioteca' : 'topo da biblioteca', command: 'zona de comando', stack: 'pilha' };
        const finalName = r && r.zone === 'stack' ? nm : nm;
        if (r && !m.silent && from !== dest) say(room, p.id, from === 'hand' && (dest === 'battlefield' || dest === 'stack') ? `${p.name} ${dest === 'stack' ? 'conjurou' : 'jogou'} ${r?.fd ? 'uma carta virada' : finalName}.` : from === 'library' && dest === 'hand' ? `${p.name} pegou uma carta da biblioteca.` : `${finalName} ${fromDesc} → ${lbl[r ? r.zone : dest] || 'jogo'}.`);
        i++;
      }
      if (m.shuffle) { shuffle(p.zones.library); dz(room, p.id, 'library'); }
      break;
    }
    case 'pos': {
      for (const mv of (m.moves || []).slice(0, 40)) {
        const c = room.cards[mv.id]; if (!canAct(c, p.id) || c.zone !== 'battlefield') continue;
        c.x = clampN(+mv.x || 0, -0.02, 0.95); c.y = clampN(+mv.y || 0, -0.02, 0.92); c.z = ++room.z; dc(room, c);
      }
      break;
    }
    case 'tap': {
      for (const c of cards()) { if (c.zone !== 'battlefield') continue; c.tapped = m.v == null ? !c.tapped : !!m.v; c.z = c.z; dc(room, c); }
      break;
    }
    case 'untapAll': for (const id of p.zones.battlefield) { const c = room.cards[id]; if (c.tapped) { c.tapped = false; dc(room, c); } } say(room, p.id, `${p.name} desvirou tudo.`); break;
    case 'flip': for (const c of cards()) { if (c.zone === 'battlefield') { c.fd = !c.fd; dc(room, c); say(room, p.id, `${p.name} virou uma carta ${c.fd ? 'para baixo' : 'para cima'}.`); } } break;
    case 'face': for (const c of cards()) { const mt = room.meta[c.sid]; if (mt && mt.faces.length > 1) { c.face = (c.face + 1) % mt.faces.length; dc(room, c); say(room, p.id, `${p.name} transformou → ${cname(room, c)}.`); } } break;
    case 'counter': {
      const c = cards()[0]; if (!c || c.zone !== 'battlefield') break;
      const k = String(m.kind || '+1/+1').slice(0, 24); const d = clampN(m.delta | 0, -99, 99);
      c.counters[k] = Math.max(0, (c.counters[k] || 0) + d); if (k === 'loyalty') c.counters[k] = (c.counters[k] || 0);
      if (!c.counters[k] && k !== 'loyalty') delete c.counters[k];
      dc(room, c); if (!m.silent) say(room, p.id, `${cname(room, c)}: ${d > 0 ? '+' : ''}${d} ${k} (${c.counters[k] ?? 0}).`); break;
    }
    case 'dmg': { const c = cards()[0]; if (!c) break; c.dmg = Math.max(0, (c.dmg || 0) + (m.delta | 0)); dc(room, c); break; }
    case 'setCmd': for (const c of cards()) { if (c.owner === p.id) { c.cmd = !!m.v; dc(room, c); } } break;
    case 'token': {
      const mt = m.meta; if (!mt || !Array.isArray(mt.faces) || !mt.sid) break;
      room.meta[mt.sid] = { ...mt, token: true };
      let tokSpot = null;
      const n = clampN(m.n | 0 || 1, 1, 30);
      for (let i = 0; i < n; i++) {
        const c = newCard(room, p.id, mt.sid, { token: true, zone: 'battlefield', pid: p.id });
        p.zones.battlefield.push(c.id); c.z = ++room.z;
        if (m.x != null) { c.x = clampN(m.x + i * 0.012, 0, 0.92); c.y = clampN(m.y + i * 0.016, 0, 0.9); }
        else { tokSpot ||= freeSpot(room, p, c); c.x = clampN(tokSpot.x + i * 0.012, 0, 0.92); c.y = clampN(tokSpot.y + i * 0.016, 0, 0.9); }
        enterBattlefield(room, c, {}); if (m.tapped) c.tapped = true;
      }
      dz(room, p.id, 'battlefield'); say(room, p.id, `${p.name} criou ${n}× ${mt.name}.`); break;
    }
    case 'copy': {
      const src = cards()[0]; if (!src || src.zone !== 'battlefield') break;
      const n = clampN(m.n | 0 || 1, 1, 20);
      for (let i = 0; i < n; i++) {
        const c = newCard(room, p.id, src.sid, { token: true, zone: 'battlefield', pid: p.id, face: src.face, x: clampN(src.x + 0.012 * (i + 1), 0, 0.92), y: clampN(src.y + 0.016 * (i + 1), 0, 0.9) });
        c.z = ++room.z; p.zones.battlefield.push(c.id); enterBattlefield(room, c, {});
      }
      dz(room, p.id, 'battlefield'); say(room, p.id, `${p.name} copiou ${cname(room, src)} (${n}×).`); break;
    }
    case 'life': {
      const t = getPlayer(room, m.pid || p.id); if (!t) break;
      const before = t.life; t.life = m.set != null ? clampN(m.set | 0, -999, 9999) : clampN(t.life + (m.delta | 0), -999, 9999);
      dp(room, t); if (t.life !== before && !m.quiet) say(room, p.id, `${t.name}: vida ${before} → ${t.life}.`);
      if (t.life <= 0 && before > 0) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${t.name} está com 0 de vida ou menos!` });
      break;
    }
    case 'pcount': {
      const t = getPlayer(room, m.pid || p.id); if (!t || !['poison', 'energy', 'exp', 'rad', 'tix'].includes(m.kind)) break;
      t[m.kind] = clampN(t[m.kind] + (m.delta | 0), 0, 999); dp(room, t);
      if (m.kind === 'poison' && t.poison >= 10) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${t.name} tem 10+ marcadores de veneno!` });
      break;
    }
    case 'cmdDmg': {
      const to = getPlayer(room, m.to), from = getPlayer(room, m.from); if (!to || !from) break;
      const d = clampN(m.delta | 0, -21, 21); const nv = Math.max(0, (to.cmd[from.id] || 0) + d); const real = nv - (to.cmd[from.id] || 0);
      to.cmd[from.id] = nv; to.life -= real; dp(room, to);
      say(room, p.id, `Dano de comandante de ${from.name} em ${to.name}: ${nv}/21.`);
      if (nv >= 21) ctx.broadcast({ t: 'alert', kind: 'dead', text: `${to.name} recebeu 21 de dano de comandante de ${from.name}!` });
      break;
    }
    case 'undo': {
      const h = room.history, last = h[h.length - 1];
      if (!last || last.pid !== p.id) { ctx.sendTo(p.id, { t: 'error', msg: last ? 'Outro jogador agiu depois — não dá para desfazer.' : 'Nada para desfazer.' }); break; }
      h.pop(); restore(room, last.snap); say(room, p.id, `${p.name} desfez a última ação.`);
      break;
    }
    case 'stackAt': case 'spread': {
      const list = cards().filter((c) => c.zone === 'battlefield' && c.pid === p.id); if (list.length < 2) break;
      const a = list[0];
      list.forEach((c, i) => {
        if (A === 'stackAt') { c.x = clampN(a.x + i * 0.012, 0, 0.95); c.y = clampN(a.y + i * 0.016, 0, 0.92); }
        else { c.x = clampN(a.x + i * 0.075, 0, 0.95); c.y = a.y; }
        c.z = ++room.z; dc(room, c);
      });
      break;
    }
    case 'attack': {
      if (room.turn.active !== p.id) { ctx.sendTo(p.id, { t: 'error', msg: 'Só o jogador da vez pode atacar.' }); break; }
      if (!room.combat) newCombat(room);
      const cb = room.combat; if (cb.step !== 'declare') break;
      const opps = room.players.filter((q) => q.id !== p.id && q.connected);
      let target = m.target; if (!opps.some((q) => q.id === target)) target = opps[0]?.id; if (!target) break;
      for (const c of cards()) {
        if (c.zone !== 'battlefield' || c.pid !== p.id || !isCreature(room, c)) continue;
        const k = keywords(room, c); const i = cb.atk.findIndex((a) => a.id === c.id);
        if (i >= 0) { cb.atk.splice(i, 1); if (!k.has('vigilance')) { c.tapped = false; dc(room, c); } continue; }
        if (c.tapped) { ctx.sendTo(p.id, { t: 'error', msg: cname(room, c) + ' está virada.' }); continue; }
        if (c.sick) { ctx.sendTo(p.id, { t: 'error', msg: cname(room, c) + ' está com enjoo de invocação.' }); continue; }
        if (k.has('defender')) { ctx.sendTo(p.id, { t: 'error', msg: cname(room, c) + ' tem defensor e não pode atacar.' }); continue; }
        cb.atk.push({ id: c.id, target }); if (!k.has('vigilance')) c.tapped = true; dc(room, c);
      }
      room.turn.phase = 'combat'; room.dirty.turn = true; dcb(room); break;
    }
    case 'endDeclare': if (room.combat?.step === 'declare' && room.turn.active === p.id) finishDeclare(room, ctx, p); break;
    case 'block': {
      const cb = room.combat; if (!cb || cb.step !== 'block') break;
      const atk = cb.atk.find((a) => a.id === m.attacker); if (!atk || atk.target !== p.id) break;
      const attacker = room.cards[atk.id];
      for (const bid of m.ids || []) {
        const b = room.cards[bid]; if (!b || b.pid !== p.id || b.zone !== 'battlefield' || b.tapped || !isCreature(room, b)) continue;
        const why = canBlock(room, b, attacker); if (why) { ctx.sendTo(p.id, { t: 'error', msg: why }); continue; }
        for (const k of Object.keys(cb.blocks)) cb.blocks[k] = cb.blocks[k].filter((x) => x !== bid);
        (cb.blocks[atk.id] ||= []).push(bid);
      }
      cb.done[p.id] = false; dcb(room); break;
    }
    case 'unblock': {
      const cb = room.combat; if (!cb || cb.step !== 'block') break;
      for (const bid of m.ids || []) for (const k of Object.keys(cb.blocks)) cb.blocks[k] = cb.blocks[k].filter((x) => x !== bid);
      dcb(room); break;
    }
    case 'doneBlock': {
      const cb = room.combat; if (!cb || cb.step !== 'block') break;
      cb.done[p.id] = true; dcb(room);
      if (defendersOf(cb).every((x) => cb.done[x])) resolveCombat(room, ctx);
      break;
    }
    case 'resolveCombat': if (room.combat?.step === 'block' && room.turn.active === p.id) resolveCombat(room, ctx); break;
    case 'pump': for (const c of cards()) { if (c.zone !== 'battlefield') continue; c.mp = (c.mp || 0) + (m.p | 0); c.mt = (c.mt || 0) + (m.t | 0); dc(room, c); say(room, p.id, `${cname(room, c)} recebe ${(m.p | 0) >= 0 ? '+' : ''}${m.p | 0}/${(m.t | 0) >= 0 ? '+' : ''}${m.t | 0} até o fim do turno.`); } break;
    case 'hold': p.hold = !p.hold; dp(room, p); say(room, p.id, p.hold ? `✋ ${p.name} quer responder — a pilha espera.` : `${p.name} liberou a pilha.`); break;
    case 'keep': {
      if (!p.deck || p.keep) break;
      const need = Math.max(0, p.mulls - 1); const bottom = (m.bottom || []).filter((i) => p.zones.hand.includes(i));
      if (bottom.length !== need) { ctx.sendTo(p.id, { t: 'error', msg: `Escolha ${need} carta(s) para o fundo da biblioteca.` }); break; }
      for (const id of bottom) moveCard(room, room.cards[id], p.id, 'library', { by: p.id, pos: 'bottom' });
      p.keep = true; dp(room, p); say(room, p.id, `${p.name} manteve a mão (${p.zones.hand.length} cartas).`);
      maybeAutoStart(room, ctx); break;
    }
    case 'resolve': if (room.stack.length) resolveTop(room, p.id); break;
    case 'pass': {
      p.passed = !p.passed; dp(room, p);
      const live = room.players.filter((q) => q.connected);
      if (live.length && live.every((q) => q.passed)) {
        if (room.stack.length) resolveTop(room, p.id); else for (const q of live) q.passed = false;
        for (const q of room.players) dp(room, q);
      }
      break;
    }
    case 'start': startGame(room, ctx); break;
    case 'next': nextTurn(room, ctx); break;
    case 'nextPhase': if (room.turn.active === p.id || !room.turn.active) nextPhase(room, ctx, p); break;
    case 'phase': if (PHASES.includes(m.phase)) { room.turn.phase = m.phase; room.dirty.turn = true; if (m.phase === 'combat' && !room.combat) newCombat(room); } break;
    case 'settings': for (const k of Object.keys(room.settings)) if (typeof m[k] === 'boolean') room.settings[k] = m[k]; if (m.stackDelay != null) room.settings.stackDelay = clampN(m.stackDelay | 0, 1, 20); room.dirty.settings = true; break;
    case 'ping': ctx.broadcast({ t: 'ping', from: p.id, kind: m.kind || 'point', pid: m.pid, x: m.x, y: m.y, cid: m.cid, text: String(m.text || '').slice(0, 40) }); break;
    case 'chat': { const text = String(m.text || '').slice(0, 300).trim(); if (text) { const e = { p: p.id, m: text, chat: true, ts: Date.now() }; room.dirty.log.push(e); room.log.push(e); } break; }
    case 'rename': p.name = String(m.name || p.name).slice(0, 24); dp(room, p); break;
    case 'lib': { // ações sobre carta específica da biblioteca (buscar/scry) já passam por 'move'
      break;
    }
    default: break;
  }
  runSBA(room);
  syncStackTimer(room, ctx, prevStackLen);
}

// ---------- serialização de deltas por jogador ----------
const pubPlayer = (p) => ({ id: p.id, name: p.name, color: p.color, seat: p.seat, connected: p.connected, life: p.life, poison: p.poison, energy: p.energy, exp: p.exp, rad: p.rad, tix: p.tix, cmd: p.cmd, passed: p.passed, hold: p.hold, keep: p.keep, mulls: p.mulls, deck: p.deck });

function cardView(room, c, viewer) {
  if (c.zone === 'library') return null;
  if (c.zone === 'hand' && c.pid !== viewer) return null;
  const hide = c.fd && c.zone === 'battlefield' && c.pid !== viewer && c.owner !== viewer;
  return { id: c.id, sid: hide ? null : c.sid, owner: c.owner, pid: c.pid, zone: c.zone, x: c.x, y: c.y, z: c.z, tapped: c.tapped, fd: c.fd, face: c.face, counters: c.counters, dmg: c.dmg, mp: c.mp || 0, mt: c.mt || 0, sick: c.sick, token: c.token, cmd: c.cmd, tax: c.tax, caster: c.caster };
}

export function buildDelta(room, viewerPid, known, full) {
  const d = full ? (() => {
    const x = newDirty();
    for (const c of Object.values(room.cards)) x.cards.add(c.id);
    for (const p of room.players) { x.players.add(p.id); for (const z of Object.keys(p.zones)) x.zones.add(p.id + ':' + z); }
    x.stack = x.turn = x.settings = x.combat = true; x.log = room.log.slice(-60);
    return x;
  })() : room.dirty;
  const msg = { t: 'delta' };
  if (full) msg.full = true;
  const cards = {}, meta = {};
  for (const id of d.cards) {
    const c = room.cards[id];
    const v = c ? cardView(room, c, viewerPid) : null;
    cards[id] = v;
    if (v && v.sid && !known.has(v.sid)) { known.add(v.sid); meta[v.sid] = room.meta[v.sid]; }
  }
  if (d.cards.size) msg.cards = cards;
  if (Object.keys(meta).length) msg.meta = meta;
  if (d.zones.size) {
    msg.zones = {};
    for (const k of d.zones) {
      const [pid, zone] = k.split(':'); const p = getPlayer(room, pid); if (!p) continue;
      const arr = p.zones[zone];
      msg.zones[k] = zone === 'library' || (zone === 'hand' && pid !== viewerPid) ? { n: arr.length } : arr;
    }
  }
  if (d.players.size) msg.players = [...d.players].map((i) => getPlayer(room, i)).filter(Boolean).map(pubPlayer);
  if (d.stack) { msg.stack = room.stack; msg.stackIn = room.stackDue ? Math.max(0, room.stackDue - Date.now()) : 0; }
  if (d.combat) msg.combat = room.combat;
  if (d.turn) msg.turn = room.turn;
  if (d.settings) msg.settings = room.settings;
  if (d.log.length) msg.log = d.log;
  return msg;
}

export function peekMeta(room, sids, known) {
  const meta = {};
  for (const s of sids) if (!known.has(s) && room.meta[s]) { known.add(s); meta[s] = room.meta[s]; }
  return meta;
}

// Conexão WebSocket com reconexão automática + estado local alimentado por deltas
import { createRoom, addPlayer, handle, buildDelta, peekMeta, getPlayer, tick } from '../engine/game.js';

export const S = {
  you: null, room: null, players: {}, cards: {}, zones: {}, stack: [], turn: { active: null, num: 0, phase: 'main1' },
  settings: {}, meta: {}, log: [], connected: false, combat: null, stackIn: 0, solo: false,
};

let ws, handlers = {}, joinInfo = null, retry = 0, queue = [];
export const on = (t, fn) => { (handlers[t] ||= []).push(fn); };
const emit = (t, ...a) => (handlers[t] || []).forEach((f) => f(...a));

// Servidor alternativo (usado quando a página está no GitHub Pages)
export const serverBase = () => { try { return (localStorage.getItem('mtg.server') || '').replace(/\/+$/, ''); } catch { return ''; } };
export const apiUrl = (p) => serverBase() + p;

let local = null, welcomed = false;

// Modo solo: o motor roda no próprio navegador (sem servidor), com um boneco de treino como alvo.
export function connectLocal(info) {
  const room = createRoom('SOLO'); const p = addPlayer(room, info.cid, info.name);
  const bot = addPlayer(room, 'bot', 'Boneco de treino'); Object.assign(bot, { bot: true, deck: true, keep: true });
  const known = new Set(); const timers = {};
  const flush = () => { const d = room.dirty; if (!d) return; if (d.cards.size || d.zones.size || d.players.size || d.stack || d.turn || d.settings || d.combat || d.log.length) dispatch(buildDelta(room, p.id, known, false)); };
  const withMeta = (msg) => { if (msg.cards) { const meta = peekMeta(room, msg.cards.map((c) => c.sid), known); if (Object.keys(meta).length) msg.meta = meta; } return msg; };
  const ctx = {
    broadcast: (m) => dispatch(withMeta({ ...m })), sendTo: (pid, m) => { if (pid === p.id) dispatch(withMeta({ ...m })); },
    later: (key, ms, fn) => { clearTimeout(timers[key]); room.timers[key] = timers[key] = setTimeout(() => { delete room.timers[key]; tick(room, fn); flush(); }, ms); },
    cancel: (key) => { clearTimeout(timers[key]); delete room.timers[key]; },
  };
  local = { room, p, ctx, flush };
  S.you = p.id; S.room = 'SOLO'; S.solo = true; S.connected = true;
  emit('status', true); emit('welcome', { room: 'SOLO', you: p.id });
  dispatch(buildDelta(room, p.id, known, true));
}
function dispatch(m) { if (m.t === 'delta') applyDelta(m); else emit(m.t, m); }

export function connect(info) {
  joinInfo = info;
  const base = serverBase(); let url;
  if (base) { const u = new URL(base); url = (u.protocol === 'https:' ? 'wss' : 'ws') + '://' + u.host; }
  else url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; welcomed = false; S.connected = true; ws.send(JSON.stringify({ t: 'join', ...joinInfo })); queue.forEach((m) => ws.send(m)); queue = []; emit('status', true); };
  ws.onclose = () => {
    S.connected = false; emit('status', false);
    if (!welcomed && retry >= 2) { emit('connfail'); return; }
    setTimeout(() => connect(joinInfo), Math.min(4000, 400 * ++retry));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { welcomed = true; S.you = m.you; S.room = m.room; emit('welcome', m); }
    else if (m.t === 'delta') applyDelta(m);
    else emit(m.t, m);
  };
}

export function send(a, data = {}) {
  if (local) { const { room, p, ctx, flush } = local; handle(room, p, { t: 'act', a, ...data }, ctx); flush(); return; }
  const s = JSON.stringify({ t: 'act', a, ...data });
  if (ws && ws.readyState === 1) ws.send(s);
}

function applyDelta(m) {
  if (m.full) { S.cards = {}; S.zones = {}; S.log = []; S.combat = null; }
  const ch = { cards: new Set(), zones: new Set(), players: false, stack: false, turn: false, settings: false, combat: false, log: m.log || [], full: !!m.full };
  if (m.meta) Object.assign(S.meta, m.meta);
  if (m.players) {
    for (const p of m.players) S.players[p.id] = p;
    ch.players = true;
  }
  if (m.cards) for (const [id, c] of Object.entries(m.cards)) { if (c) S.cards[id] = c; else delete S.cards[id]; ch.cards.add(id); }
  if (m.zones) for (const [k, z] of Object.entries(m.zones)) { S.zones[k] = z; ch.zones.add(k); }
  if (m.stack) { S.stack = m.stack; S.stackIn = m.stackIn || 0; ch.stack = true; }
  if ('combat' in m) { S.combat = m.combat; ch.combat = true; }
  if (m.turn) { S.turn = m.turn; ch.turn = true; }
  if (m.settings) { S.settings = m.settings; ch.settings = true; }
  if (m.log) S.log.push(...m.log);
  emit('delta', ch);
}

export const zoneIds = (pid, zone) => { const z = S.zones[pid + ':' + zone]; return Array.isArray(z) ? z : []; };
export const zoneCount = (pid, zone) => { const z = S.zones[pid + ':' + zone]; return Array.isArray(z) ? z.length : z?.n || 0; };
export const faceOf = (c) => { const m = c && S.meta[c.sid]; return m ? m.faces[Math.min(c.face || 0, m.faces.length - 1)] : null; };

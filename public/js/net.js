// Conexão WebSocket com reconexão automática + estado local alimentado por deltas
export const S = {
  you: null, room: null, players: {}, cards: {}, zones: {}, stack: [], turn: { active: null, num: 0, phase: 'main1' },
  settings: {}, meta: {}, log: [], connected: false,
};

let ws, handlers = {}, joinInfo = null, retry = 0, queue = [];
export const on = (t, fn) => { (handlers[t] ||= []).push(fn); };
const emit = (t, ...a) => (handlers[t] || []).forEach((f) => f(...a));

// Servidor alternativo (usado quando a página está no GitHub Pages)
export const serverBase = () => { try { return (localStorage.getItem('mtg.server') || '').replace(/\/+$/, ''); } catch { return ''; } };
export const apiUrl = (p) => serverBase() + p;

export function connect(info) {
  joinInfo = info;
  const base = serverBase(); let url;
  if (base) { const u = new URL(base); url = (u.protocol === 'https:' ? 'wss' : 'ws') + '://' + u.host; }
  else url = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; S.connected = true; ws.send(JSON.stringify({ t: 'join', ...joinInfo })); queue.forEach((m) => ws.send(m)); queue = []; emit('status', true); };
  ws.onclose = () => { S.connected = false; emit('status', false); setTimeout(() => connect(joinInfo), Math.min(4000, 400 * ++retry)); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { S.you = m.you; S.room = m.room; emit('welcome', m); }
    else if (m.t === 'delta') applyDelta(m);
    else emit(m.t, m);
  };
}

export function send(a, data = {}) {
  const s = JSON.stringify({ t: 'act', a, ...data });
  if (ws && ws.readyState === 1) ws.send(s);
}

function applyDelta(m) {
  if (m.full) { S.cards = {}; S.zones = {}; S.log = []; }
  const ch = { cards: new Set(), zones: new Set(), players: false, stack: false, turn: false, settings: false, log: m.log || [], full: !!m.full };
  if (m.meta) Object.assign(S.meta, m.meta);
  if (m.players) {
    for (const p of m.players) S.players[p.id] = p;
    ch.players = true;
  }
  if (m.cards) for (const [id, c] of Object.entries(m.cards)) { if (c) S.cards[id] = c; else delete S.cards[id]; ch.cards.add(id); }
  if (m.zones) for (const [k, z] of Object.entries(m.zones)) { S.zones[k] = z; ch.zones.add(k); }
  if (m.stack) { S.stack = m.stack; ch.stack = true; }
  if (m.turn) { S.turn = m.turn; ch.turn = true; }
  if (m.settings) { S.settings = m.settings; ch.settings = true; }
  if (m.log) S.log.push(...m.log);
  emit('delta', ch);
}

export const zoneIds = (pid, zone) => { const z = S.zones[pid + ':' + zone]; return Array.isArray(z) ? z : []; };
export const zoneCount = (pid, zone) => { const z = S.zones[pid + ':' + zone]; return Array.isArray(z) ? z.length : z?.n || 0; };
export const faceOf = (c) => { const m = c && S.meta[c.sid]; return m ? m.faces[Math.min(c.face || 0, m.faces.length - 1)] : null; };

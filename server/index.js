import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRoom, addPlayer, getPlayer, handle, buildDelta, peekMeta } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
const UA = { 'User-Agent': 'MTGTable/0.1 (hobby project)', Accept: 'application/json' };

// ---------- proxy de decks públicos (Archidekt) ----------
const cache = new Map();
async function cached(url, ttl = 120000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('upstream ' + r.status);
  const v = await r.json();
  cache.set(url, { t: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}

async function api(req, res, url) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  try {
    if (url.pathname === '/api/decks/search') {
      const q = url.searchParams;
      const u = new URL('https://archidekt.com/api/decks/v3/');
      u.searchParams.set('pageSize', '24');
      u.searchParams.set('page', q.get('page') || '1');
      u.searchParams.set('orderBy', q.get('order') || '-viewCount');
      if (q.get('q')) u.searchParams.set('name', q.get('q'));
      if (q.get('commander')) u.searchParams.set('commanderName', q.get('commander'));
      if (q.get('format') !== 'all') u.searchParams.set('deckFormat', '3');
      const j = await cached(u.toString());
      return send(200, {
        count: j.count,
        results: (j.results || []).map((d) => ({ id: d.id, name: d.name, size: d.size, art: d.featured || d.customFeatured, owner: d.owner?.username, colors: d.colors, views: d.viewCount, updated: d.updatedAt })),
      });
    }
    const m = url.pathname.match(/^\/api\/decks\/(\d+)$/);
    if (m) {
      const j = await cached('https://archidekt.com/api/decks/' + m[1] + '/', 600000);
      const cards = [];
      for (const e of j.cards || []) {
        const cats = (e.categories || []).map((s) => s.toLowerCase());
        if (cats.some((c) => c.includes('sideboard') || c.includes('maybeboard'))) continue;
        const sid = e.card?.uid; const name = e.card?.oracleCard?.name || e.card?.displayName;
        if (!sid && !name) continue;
        cards.push({ name, sid, qty: e.quantity || 1, cmd: cats.includes('commander') });
      }
      return send(200, { id: j.id, name: j.name, owner: j.owner?.username, cards });
    }
    send(404, { error: 'not found' });
  } catch (e) { send(502, { error: String(e.message || e) }); }
}

// ---------- http estático ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let f = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- websocket / salas ----------
const rooms = new Map();
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024, perMessageDeflate: { threshold: 1024 } });

function roomClients(room) { return room.clients || (room.clients = new Set()); }
const out = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function flush(room) {
  const d = room.dirty; if (!d) return;
  const empty = !d.cards.size && !d.zones.size && !d.players.size && !d.stack && !d.turn && !d.settings && !d.log.length;
  if (empty) return;
  for (const ws of roomClients(room)) out(ws, buildDelta(room, ws.pid, ws.known, false));
}

function ctxFor(room) {
  const withMeta = (ws, msg) => {
    if (msg.cards) { const meta = peekMeta(room, msg.cards.map((c) => c.sid), ws.known); if (Object.keys(meta).length) msg.meta = meta; }
    return msg;
  };
  return {
    broadcast: (msg) => { for (const ws of roomClients(room)) out(ws, withMeta(ws, { ...msg })); },
    sendTo: (pid, msg) => { for (const ws of roomClients(room)) if (ws.pid === pid) out(ws, withMeta(ws, { ...msg })); },
  };
}

wss.on('connection', (ws) => {
  ws.known = new Set(); ws.room = null; ws.pid = null; ws.alive = true; ws.pingAt = 0;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'join') {
      const id = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if (!id) return out(ws, { t: 'error', msg: 'Código de sala inválido.' });
      let room = rooms.get(id); if (!room) { room = createRoom(id); rooms.set(id, room); }
      let p = room.players.find((q) => q.cid === m.cid);
      const wasOnline = !!p && p.connected && [...roomClients(room)].some((o) => o.pid === p.id);
      if (!p) { p = addPlayer(room, m.cid, m.name); if (!p) return out(ws, { t: 'error', msg: 'Sala cheia (máx. 6 jogadores).' }); }
      else { p.connected = true; if (m.name) p.name = String(m.name).slice(0, 24); }
      // derruba conexão antiga do mesmo jogador
      for (const o of roomClients(room)) if (o.pid === p.id && o !== ws) { o.room = null; o.close(); roomClients(room).delete(o); }
      ws.room = room; ws.pid = p.id; roomClients(room).add(ws);
      out(ws, { t: 'welcome', you: p.id, room: id });
      out(ws, buildDelta(room, p.id, ws.known, true));
      room.dirty = { cards: new Set(), zones: new Set(), players: new Set([p.id]), stack: false, turn: false, settings: false, log: wasOnline ? [] : [{ p: p.id, m: `${p.name} entrou na sala.`, ts: Date.now() }] };
      if (room.dirty.log[0]) room.log.push(room.dirty.log[0]);
      flush(room);
      return;
    }
    const room = ws.room; if (!room) return;
    const p = getPlayer(room, ws.pid); if (!p) return;
    if (m.t === 'act') {
      try { handle(room, p, m, ctxFor(room)); } catch (e) { console.error('handle error', e); out(ws, { t: 'error', msg: 'Erro interno ao processar ação.' }); }
      flush(room);
    }
  });
  ws.on('close', () => {
    const room = ws.room; if (!room) return;
    roomClients(room).delete(ws);
    const p = getPlayer(room, ws.pid);
    if (p && ![...roomClients(room)].some((o) => o.pid === p.id)) {
      p.connected = false;
      room.dirty = { cards: new Set(), zones: new Set(), players: new Set([p.id]), stack: false, turn: false, settings: false, log: [{ p: p.id, m: `${p.name} desconectou.`, ts: Date.now() }] };
      flush(room);
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [id, r] of rooms) if (!roomClients(r).size && Date.now() - r.lastActive > 3 * 3600e3) rooms.delete(id);
}, 20000);

server.listen(PORT, () => console.log(`MTG Table rodando em http://localhost:${PORT}`));

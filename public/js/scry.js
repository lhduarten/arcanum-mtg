// Camada Scryfall + parser de listas de deck
const API = 'https://api.scryfall.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;

async function sf(path, opts) {
  const wait = 110 - (Date.now() - lastReq); // respeita ~10 req/s
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
  const r = await fetch(API + path, { ...opts, headers: { Accept: 'application/json', ...(opts?.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.status === 404) return { data: [], total_cards: 0 };
  if (!r.ok) throw new Error('Scryfall ' + r.status);
  return r.json();
}

const faceFrom = (f, top) => ({
  name: f.name, type: f.type_line || top.type_line || '', mana: f.mana_cost || '',
  text: f.oracle_text || '', power: f.power, toughness: f.toughness, loyalty: f.loyalty, defense: f.defense,
  s: f.image_uris?.small || top.image_uris?.small, n: f.image_uris?.normal || top.image_uris?.normal,
});

export function metaFromCard(c) {
  let faces;
  if (c.card_faces && !c.image_uris) faces = c.card_faces.map((f) => faceFrom(f, c));
  else if (c.card_faces) { // split / adventure / flip: uma imagem só
    const f = { ...faceFrom(c.card_faces[0], c), name: c.name, type: c.type_line, text: c.card_faces.map((x) => x.oracle_text).join('\n'), mana: c.mana_cost || c.card_faces.map((x) => x.mana_cost).join(' // '), s: c.image_uris.small, n: c.image_uris.normal };
    f.power = c.power ?? c.card_faces[0].power; f.toughness = c.toughness ?? c.card_faces[0].toughness;
    faces = [f];
  } else faces = [faceFrom(c, c)];
  return { sid: c.id, name: c.name, faces, cmc: c.cmc || 0, ci: c.color_identity || [], layout: c.layout };
}

// entrada de deck "leve" (o que fica salvo no localStorage)
export const entryFromCard = (c, extra = {}) => {
  const m = metaFromCard(c);
  return { sid: c.id, name: c.name, qty: 1, cmd: false, type: c.type_line || '', cmc: c.cmc || 0, ci: c.color_identity || [], mana: m.faces[0].mana || '', img: m.faces[0].s, legal: c.legalities?.commander, ...extra };
};

const metaCache = new Map();
export const getMeta = (sid) => metaCache.get(sid);
export const cacheCard = (c) => { const m = metaFromCard(c); metaCache.set(m.sid, m); return m; };

export async function collection(identifiers, onProgress) {
  const found = [], missing = [];
  for (let i = 0; i < identifiers.length; i += 75) {
    const j = await sf('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: identifiers.slice(i, i + 75) }) });
    found.push(...(j.data || [])); missing.push(...(j.not_found || []));
    onProgress?.(Math.min(i + 75, identifiers.length), identifiers.length);
  }
  return { found, missing };
}

export async function search(q, { order = 'edhrec', page = 1, unique = 'cards' } = {}) {
  const j = await sf(`/cards/search?q=${encodeURIComponent(q)}&order=${order}&unique=${unique}&page=${page}`);
  (j.data || []).forEach(cacheCard);
  return j;
}

export async function named(name) {
  const j = await sf(`/cards/named?fuzzy=${encodeURIComponent(name)}`);
  return j.object === 'card' ? j : null;
}

export async function autocomplete(q) { const j = await sf(`/cards/autocomplete?q=${encodeURIComponent(q)}`); return j.data || []; }

// Garante meta de todos os sids (busca os que faltam)
export async function ensureMetas(sids, onProgress) {
  const need = [...new Set(sids)].filter((s) => !metaCache.has(s));
  if (need.length) {
    const { found } = await collection(need.map((id) => ({ id })), onProgress);
    found.forEach(cacheCard);
  }
  return Object.fromEntries(sids.filter((s) => metaCache.has(s)).map((s) => [s, metaCache.get(s)]));
}

// ---------- parser de lista de deck ----------
export function parseDecklist(text) {
  const out = []; let section = 'main';
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//') && !/^\/\/\s*(commander|sideboard|maybeboard|deck|main)/i.test(line)) continue;
    const hdr = line.replace(/^\/\/\s*/, '').replace(/[:()\d]/g, '').trim().toLowerCase();
    if (/^(commander|commanders)$/.test(hdr)) { section = 'cmd'; continue; }
    if (/^(deck|main|mainboard|main deck)$/.test(hdr)) { section = 'main'; continue; }
    if (/^(sideboard|maybeboard|maybe|companion|tokens|considering)$/.test(hdr)) { section = 'skip'; continue; }
    if (/^sb:/i.test(line)) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+?)\s*$/i) || [null, '1', line];
    let name = m[2]; let set, num; let cmd = section === 'cmd';
    if (/\*cmdr\*|\[commander\]|\*commander\*/i.test(name)) cmd = true;
    name = name.replace(/\s*\*[^*]*\*\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s*\^[^^]*\^\s*/g, ' ').trim();
    const sm = name.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)\s*([\w★-]+)?$/);
    if (sm) { name = sm[1]; set = sm[2].toLowerCase(); num = sm[3]; }
    if (section === 'skip') continue;
    out.push({ qty: Math.min(parseInt(m[1], 10) || 1, 99), name: name.trim(), set, num, cmd });
  }
  return out;
}

// Resolve lista -> entradas completas
export async function resolveList(items, onProgress) {
  const ids = items.map((it) => (it.set && it.num ? { set: it.set, collector_number: it.num } : { name: it.name }));
  const { found, missing } = await collection(ids, onProgress);
  const byName = new Map(), bySetNum = new Map();
  for (const c of found) { byName.set(c.name.toLowerCase(), c); (c.card_faces || []).forEach((f) => byName.set(f.name.toLowerCase(), c)); bySetNum.set(c.set + '/' + c.collector_number, c); cacheCard(c); }
  const entries = [], notFound = [];
  for (const it of items) {
    let c = (it.set && it.num && bySetNum.get(it.set + '/' + it.num)) || byName.get(it.name.toLowerCase()) || byName.get(it.name.split('//')[0].trim().toLowerCase());
    if (!c) { try { c = await named(it.name); if (c) cacheCard(c); } catch {} }
    if (!c) { notFound.push(it.name); continue; }
    const ex = entries.find((e) => e.sid === c.id);
    if (ex) { ex.qty += it.qty; ex.cmd ||= it.cmd; } else entries.push(entryFromCard(c, { qty: it.qty, cmd: it.cmd }));
  }
  return { entries, notFound };
}

export const entriesToText = (entries) => {
  const cmd = entries.filter((e) => e.cmd), rest = entries.filter((e) => !e.cmd);
  return [...(cmd.length ? ['Commander', ...cmd.map((e) => `${e.qty} ${e.name}`), '', 'Deck'] : []), ...rest.map((e) => `${e.qty} ${e.name}`)].join('\n');
};

// Fichas populares (busca do primeiro resultado)
export async function findToken(name) {
  const j = await sf(`/cards/search?q=${encodeURIComponent(`t:token name:"${name}"`)}&unique=cards&order=released`);
  const c = j.data?.[0]; if (!c) return null;
  return cacheCard(c);
}

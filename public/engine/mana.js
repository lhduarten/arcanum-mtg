// Pagamento automático de mana: interpreta custos e habilidades de mana simples
// ("{T}: Add {G}", terrenos básicos, "any color", Sol Ring…) e escolhe quais permanentes virar.

const BASIC = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const ALL = ['W', 'U', 'B', 'R', 'G'];

// "{2}{U}{U/B}" -> { g: 2, pips: [['U'], ['U','B']] }
export function parseCost(str = '', extraGeneric = 0) {
  const cost = { g: extraGeneric, pips: [] };
  for (const [, t] of (str || '').matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(t)) cost.g += +t;
    else if (t === 'X' || t === 'Y' || t === 'Z') continue;
    else if (t === 'S') cost.g += 1;
    else if (/^[WUBRGC]$/.test(t)) cost.pips.push([t]);
    else if (/^[WUBRG]\/[WUBRG]$/.test(t)) cost.pips.push(t.split('/'));
    else if (/^2\/[WUBRG]$/.test(t)) cost.pips.push([t[2]]);
    else if (/^[WUBRG]\/P$/.test(t)) cost.pips.push([t[0]]);
    else cost.g += 1;
  }
  return cost;
}

// Retorna { opts: [[símbolos]…], sac } ou null se a face não produz mana com {T}.
export function manaSource(face) {
  if (!face) return null;
  const type = face.type || ''; const opts = []; let sac = false;
  if (/Land/.test(type)) for (const [n, s] of Object.entries(BASIC)) if (type.includes(n)) opts.push([s]);
  const text = (face.text || '').replace(/\([^)]*\)/g, '');
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(/^\{T\}((?:, [^:]+)?): Add (.+?)(?:\.|$)/);
    if (!m) continue;
    const extra = m[1], body = m[2];
    if (/\{/.test(extra) || /for each|equal to|that much|X/.test(body)) continue;
    if (/Sacrifice/.test(extra)) sac = true;
    if (/any color|any one color|any type/i.test(body)) { for (const s of ALL) opts.push([s]); if (/any type/i.test(body)) opts.push(['C']); continue; }
    const parts = body.split(/,? or |, /).map((p) => (p.match(/\{[WUBRGC]\}/g) || []).map((x) => x[1])).filter((a) => a.length);
    for (const a of parts) opts.push(a);
  }
  return opts.length ? { opts, sac } : null;
}

// Escolhe fontes para pagar o custo. sources: [{id, opts, sac}]. Retorna array de ids ou null.
export function planPayment(cost, sources) {
  const single = sources.filter((s) => s.opts.every((a) => a.length === 1));
  const match = new Map(); // id da fonte -> índice do pip
  const can = (s, pip) => s.opts.some((a) => pip.includes(a[0]));
  const assign = (i, seen) => {
    for (const s of single) {
      if (seen.has(s.id) || !can(s, cost.pips[i])) continue;
      seen.add(s.id);
      if (!match.has(s.id) || assign(match.get(s.id), seen)) { match.set(s.id, i); return true; }
    }
    return false;
  };
  const order = cost.pips.map((_, i) => i).sort((a, b) => cost.pips[a].length - cost.pips[b].length);
  for (const i of order) if (!assign(i, new Set())) return null;
  const picked = [...match.keys()];
  let rem = cost.g;
  const left = sources.filter((s) => !match.has(s.id));
  const amt = (s) => Math.max(...s.opts.map((a) => a.length));
  while (rem > 0) {
    if (!left.length) return null;
    const fit = left.filter((s) => amt(s) <= rem);
    const pool = fit.length ? fit : left;
    pool.sort((a, b) => (fit.length ? amt(b) - amt(a) : amt(a) - amt(b)) || (a.sac - b.sac) || (a.opts.length - b.opts.length));
    const s = pool[0]; left.splice(left.indexOf(s), 1); picked.push(s.id); rem -= amt(s);
  }
  return picked;
}

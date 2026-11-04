// Gerenciador de decks: meus decks (localStorage), construtor (busca Scryfall), busca de decks online (Archidekt), importar lista
import { $, $$, el, modal, toast, manaHTML } from './ui.js';
import * as scry from './scry.js';
import { send, apiUrl, serverBase } from './net.js';

const KEY = 'mtg.decks.v1';
export const loadDecks = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveDecks = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { toast('Não foi possível salvar (armazenamento cheio?)', 'err'); } };
const uid = () => Math.random().toString(36).slice(2, 9);
const total = (d) => d.entries.reduce((s, e) => s + e.qty, 0);

const GROUPS = [['Comandante', null], ['Criaturas', /Creature/], ['Planeswalkers', /Planeswalker/], ['Instantâneos', /^Instant|Instant$/], ['Feitiços', /Sorcery/], ['Artefatos', /Artifact/], ['Encantamentos', /Enchantment/], ['Batalhas', /Battle/], ['Terrenos', /Land/]];
function groupOf(e) {
  if (e.cmd) return 'Comandante';
  const t = e.type || '';
  if (/Land/.test(t)) return 'Terrenos';
  for (const [n, re] of GROUPS) if (re && re.test(t)) return n;
  return 'Outros';
}

const SAMPLE = `Commander
1 Krenko, Mob Boss

Deck
1 Sol Ring
1 Arcane Signet
1 Command Tower
1 Goblin Chieftain
1 Goblin Matron
1 Goblin Recruiter
1 Goblin Warchief
1 Goblin Piledriver
1 Skirk Prospector
1 Siege-Gang Commander
1 Impact Tremors
1 Purphoros, God of the Forge
1 Goblin Bombardment
1 Mogg War Marshal
1 Legion Warboss
1 Hordeling Outburst
1 Dockside Extortionist
1 Chaos Warp
1 Blasphemous Act
1 Vandalblast
1 Lightning Bolt
1 Abrade
1 Swiftfoot Boots
1 Lightning Greaves
1 Skullclamp
1 Mind Stone
1 Thought Vessel
1 Fellwar Stone
1 Wayfarer's Bauble
1 Gamble
1 Wheel of Fortune
1 Faithless Looting
1 Jeska's Will
1 Goblin Rabblemaster
1 Goblin Chainwhirler
1 Goblin Ringleader
1 Battle Cry Goblin
1 Muxus, Goblin Grandee
1 Tin Street Kingpin
1 Pashalik Mons
1 Warren Soultrader
1 Goblin Sharpshooter
1 Cathartic Reunion
1 Kher Keep
1 Rogue's Passage
1 Myriad Landscape
1 Mountain`;

const sampleText = () => { const n = (SAMPLE.match(/^1 /gm) || []).length - 2; return SAMPLE.replace(/1 Mountain$/, (99 - n) + " Mountain"); };

// ---------------- janela principal ----------------
export function openDeckManager(opts = {}) {
  const m = modal({ title: 'Decks', wide: true, cls: 'decks' });
  const tabs = el('div', { class: 'tabs' });
  const pane = el('div', { class: 'pane' });
  m.body.append(tabs, pane);
  const prev = el('div', { class: 'dm-preview' }, el('img', { alt: '' }));
  document.body.append(prev);
  const origClose = m.close; m.close = () => { prev.remove(); origClose(); }; m.root.querySelector('.x').onclick = m.close;
  const showPrev = (src) => { if (!src) { prev.classList.remove('on'); return; } $('img', prev).src = src; prev.classList.add('on'); };
  const hoverable = (node, src) => { node.addEventListener('mouseenter', () => showPrev(src)); node.addEventListener('mouseleave', () => showPrev(null)); return node; };

  let current = null; // deck em edição
  const T = {};
  const go = (name) => { showPrev(null); $$('.tab', tabs).forEach((b) => b.classList.toggle('on', b.dataset.t === name)); pane.textContent = ''; pane.className = 'pane p-' + name; T[name](); };
  for (const [k, n] of [['mine', '📚 Meus decks'], ['build', '🛠 Construtor'], ['online', '🌐 Buscar decks'], ['import', '📋 Importar lista']]) tabs.append(el('button', { class: 'tab', 'data-t': k, onclick: () => go(k) }, n));

  async function playDeck(deck) {
    if (!deck.entries.length) return toast('Deck vazio.', 'err');
    const prog = toast('Carregando cartas…');
    try {
      const meta = await scry.ensureMetas(deck.entries.map((e) => e.sid));
      send('loadDeck', { entries: deck.entries.map((e) => ({ sid: e.sid, qty: e.qty, cmd: !!e.cmd })), meta });
      try { localStorage.setItem('mtg.lastDeck', deck.id); } catch {}
      m.close();
    } catch (err) { toast('Erro ao carregar cartas: ' + err.message, 'err'); }
  }
  if (opts.autoPlay) { /* reservado */ }

  // ---- Meus decks ----
  T.mine = () => {
    const decks = loadDecks();
    const head = el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => { current = { id: uid(), name: 'Novo deck', entries: [] }; go('build'); } }, '＋ Novo deck'),
      el('button', { class: 'btn', onclick: async () => { await importText(sampleText(), 'Goblins (exemplo)'); } }, '✨ Carregar deck de exemplo'));
    const list = el('div', { class: 'decklist' });
    if (!decks.length) list.append(el('div', { class: 'empty-state' }, el('h3', {}, 'Nenhum deck salvo ainda'), el('p', {}, 'Crie um no construtor, busque decks da comunidade, importe uma lista de texto ou carregue o deck de exemplo para testar a mesa.')));
    for (const d of decks.sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
      const cmdr = d.entries.find((e) => e.cmd);
      const art = cmdr?.img || d.entries[0]?.img;
      list.append(el('div', { class: 'deckcard' },
        el('div', { class: 'dc-art', style: art ? { backgroundImage: `url(${art.replace('/small/', '/art_crop/').replace(/\.jpg.*$/, '.jpg')}), url(${art})` } : {} }),
        el('div', { class: 'dc-info' }, el('h3', {}, d.name), el('p', {}, `${total(d)} cartas${cmdr ? ' · ♛ ' + cmdr.name : ''}`)),
        el('div', { class: 'dc-act' },
          el('button', { class: 'btn primary', onclick: () => playDeck(d) }, '▶ Usar na mesa'),
          el('button', { class: 'btn', onclick: () => { current = JSON.parse(JSON.stringify(d)); go('build'); } }, 'Editar'),
          el('button', { class: 'btn', onclick: () => { const all = loadDecks(); all.push({ ...JSON.parse(JSON.stringify(d)), id: uid(), name: d.name + ' (cópia)', updated: Date.now() }); saveDecks(all); go('mine'); } }, 'Duplicar'),
          el('button', { class: 'btn danger', onclick: () => { if (confirm(`Excluir "${d.name}"?`)) { saveDecks(loadDecks().filter((x) => x.id !== d.id)); go('mine'); } } }, 'Excluir'))));
    }
    pane.append(head, list);
  };

  // ---- Construtor ----
  T.build = () => {
    if (!current) current = { id: uid(), name: 'Novo deck', entries: [] };
    const d = current;
    const q = el('input', { class: 'inp', type: 'search', placeholder: 'Buscar cartas (sintaxe Scryfall: t:creature c:r cmd:… o:"treasure")' });
    const optLegal = el('input', { type: 'checkbox', checked: true }), optId = el('input', { type: 'checkbox', checked: true });
    const results = el('div', { class: 'results' });
    const more = el('button', { class: 'btn', style: { display: 'none' } }, 'Carregar mais');
    const name = el('input', { class: 'inp deck-name', value: d.name, oninput: () => (d.name = name.value) });
    const listBox = el('div', { class: 'dlist' });
    const stats = el('div', { class: 'dstats' });
    let page = 1, lastQ = '';

    const ci = () => [...new Set(d.entries.filter((e) => e.cmd).flatMap((e) => e.ci || []))].join('').toLowerCase();
    async function runSearch(next) {
      const txt = q.value.trim(); if (!txt) return;
      if (!next) { page = 1; results.textContent = ''; } else page++;
      let query = txt + ' game:paper';
      if (optLegal.checked) query += ' f:commander';
      if (optId.checked && d.entries.some((e) => e.cmd)) query += ` id<=${ci() || 'c'}`;
      results.append(el('p', { class: 'muted load' }, 'Buscando…'));
      try {
        const j = await scry.search(query, { page });
        $('.load', results)?.remove();
        if (!j.data?.length && !next) results.append(el('p', { class: 'muted' }, 'Nenhuma carta encontrada.'));
        for (const c of j.data || []) {
          const meta = scry.getMeta(c.id); const f = meta.faces[0];
          const card = el('button', { class: 'rc', title: c.name }, el('img', { src: f.s, loading: 'lazy', alt: c.name }), el('span', { class: 'rc-add' }, '＋'));
          card.addEventListener('click', (e) => { addCard(scry.entryFromCard(c), e.shiftKey && /Legendary/.test(c.type_line)); });
          card.addEventListener('contextmenu', (e) => { e.preventDefault(); addCard(scry.entryFromCard(c), true); });
          results.append(hoverable(card, f.n));
        }
        more.style.display = j.has_more ? '' : 'none';
      } catch (err) { $('.load', results)?.remove(); results.append(el('p', { class: 'err' }, 'Erro: ' + err.message)); }
    }
    more.onclick = () => runSearch(true);
    q.addEventListener('keydown', (e) => e.key === 'Enter' && runSearch(false));

    function addCard(entry, asCmd) {
      const ex = d.entries.find((e) => e.sid === entry.sid || e.name === entry.name);
      const basic = /^Basic/.test(entry.type) || /Relentless Rats|Shadowborn Apostle|Rat Colony|Persistent Petitioners|Dragon's Approach|Slime Against Humanity|Seven Dwarves|Hare Apparent/.test(entry.name);
      if (asCmd) { if (ex) { ex.cmd = true; ex.qty = 1; } else d.entries.push({ ...entry, cmd: true }); }
      else if (ex) { if (basic) ex.qty++; else return toast(`${entry.name} já está no deck (Commander é singleton).`); }
      else d.entries.push(entry);
      renderList();
    }

    function renderList() {
      listBox.textContent = ''; const groups = {};
      for (const e of d.entries) (groups[groupOf(e)] ||= []).push(e);
      const order = ['Comandante', 'Criaturas', 'Planeswalkers', 'Instantâneos', 'Feitiços', 'Artefatos', 'Encantamentos', 'Batalhas', 'Terrenos', 'Outros'];
      for (const g of order) {
        const L = groups[g]; if (!L) continue;
        listBox.append(el('h4', {}, `${g} `, el('span', {}, L.reduce((s, e) => s + e.qty, 0))));
        for (const e of L.sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name))) {
          const row = el('div', { class: 'drow' },
            el('div', { class: 'qtyc' }, el('button', { onclick: () => { e.qty = Math.max(0, e.qty - 1); if (!e.qty) d.entries.splice(d.entries.indexOf(e), 1); renderList(); } }, '−'), el('b', {}, e.qty), el('button', { onclick: () => { e.qty++; renderList(); } }, '+')),
            el('span', { class: 'dn' }, e.name), el('span', { class: 'dm', innerHTML: '' }),
            el('button', { class: 'star' + (e.cmd ? ' on' : ''), title: 'Comandante', onclick: () => { e.cmd = !e.cmd; if (e.cmd) e.qty = 1; renderList(); } }, '♛'),
            el('button', { class: 'rm', title: 'Remover', onclick: () => { d.entries.splice(d.entries.indexOf(e), 1); renderList(); } }, '✕'));
          $('.dm', row).innerHTML = manaHTML(e.mana);
          const full = e.img && e.img.replace('/small/', '/normal/');
          listBox.append(hoverable(row, full));
        }
      }
      if (!d.entries.length) listBox.append(el('p', { class: 'muted pad' }, 'Pesquise cartas à esquerda e clique para adicionar.\nShift+clique (ou botão direito) em uma lendária define o comandante.'));
      // estatísticas
      const n = total(d); const cmdN = d.entries.filter((e) => e.cmd).length;
      const curve = Array(8).fill(0); d.entries.filter((e) => !/Land/.test(e.type) && !e.cmd).forEach((e) => (curve[Math.min(7, Math.floor(e.cmc))] += e.qty));
      const mx = Math.max(1, ...curve);
      const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      d.entries.forEach((e) => (e.mana.match(/\{([WUBRG])\}/g) || []).forEach((s) => (colors[s[1]] += e.qty)));
      stats.textContent = '';
      stats.append(el('div', { class: 'count' + (n === 100 ? ' ok' : '') }, el('b', {}, n), '/100', cmdN ? '' : el('em', {}, ' · defina um comandante ♛')),
        el('div', { class: 'curve' }, curve.map((v, i) => el('div', { class: 'bar', title: `${i === 7 ? '7+' : i} mana: ${v}` }, el('i', { style: { height: (v / mx) * 100 + '%' } }), el('span', {}, i === 7 ? '7+' : i)))),
        el('div', { class: 'cpips' }, Object.entries(colors).filter(([, v]) => v).map(([k, v]) => el('span', { innerHTML: manaHTML(`{${k}}`) + `<b>${v}</b>` }))));
    }

    const actions = el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => { save(); toast('Deck salvo ✔'); } }, '💾 Salvar'),
      el('button', { class: 'btn', onclick: () => { save(); playDeck(d); } }, '▶ Salvar e usar na mesa'),
      el('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(scry.entriesToText(d.entries)); toast('Lista copiada para a área de transferência'); } }, '📋 Exportar texto'),
      el('button', { class: 'btn danger', onclick: () => { d.entries.length = 0; renderList(); } }, 'Limpar'));
    function save() {
      d.name = name.value.trim() || 'Sem nome'; d.updated = Date.now();
      const all = loadDecks(); const i = all.findIndex((x) => x.id === d.id);
      if (i >= 0) all[i] = d; else all.push(d); saveDecks(all);
    }

    pane.append(el('div', { class: 'builder' },
      el('div', { class: 'bsearch' }, el('div', { class: 'row' }, q, el('button', { class: 'btn', onclick: () => runSearch(false) }, 'Buscar')),
        el('div', { class: 'row small' }, el('label', { class: 'chk' }, optLegal, 'Legal em Commander'), el('label', { class: 'chk' }, optId, 'Respeitar identidade de cor do comandante')),
        results, more),
      el('div', { class: 'bdeck' }, name, stats, listBox, actions)));
    renderList(); q.focus();
    if (!d.entries.length) { q.value = 'is:commander'; }
  };

  // ---- Buscar decks online ----
  T.online = () => {
    const q = el('input', { class: 'inp', type: 'search', placeholder: 'Nome do deck ou comandante (ex.: Atraxa, Korvold, Edgar Markov…)' });
    const order = el('select', { class: 'inp sel' }, ...[['-viewCount', 'Mais vistos'], ['-updatedAt', 'Mais recentes'], ['-createdAt', 'Mais novos']].map(([v, n]) => el('option', { value: v }, n)));
    const fmt = el('input', { type: 'checkbox', checked: true });
    const res = el('div', { class: 'decklist online' });
    const more = el('button', { class: 'btn', style: { display: 'none' } }, 'Carregar mais');
    let page = 1;
    async function run(next) {
      if (!next) { page = 1; res.textContent = ''; } else page++;
      res.append(el('p', { class: 'muted load' }, 'Buscando decks…'));
      try {
        const r = await fetch(apiUrl(`/api/decks/search?q=${encodeURIComponent(q.value)}&order=${order.value}&page=${page}&format=${fmt.checked ? 'edh' : 'all'}`));
        const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
        $('.load', res)?.remove();
        if (!j.results.length && !next) res.append(el('p', { class: 'muted' }, 'Nenhum deck encontrado.'));
        for (const d of j.results) {
          res.append(el('div', { class: 'deckcard' },
            el('div', { class: 'dc-art', style: d.art ? { backgroundImage: `url(${d.art})` } : {} }),
            el('div', { class: 'dc-info' }, el('h3', {}, d.name), el('p', {}, `por ${d.owner} · ${d.size} cartas · ${d.views?.toLocaleString('pt-BR')} views`),
              el('div', { class: 'cpips', innerHTML: Object.entries(d.colors || {}).filter(([, v]) => v).map(([k]) => manaHTML(`{${k}}`)).join('') })),
            el('div', { class: 'dc-act' },
              el('button', { class: 'btn primary', onclick: (ev) => importArchidekt(d.id, ev.target) }, 'Abrir no construtor'),
              el('a', { class: 'btn', href: `https://archidekt.com/decks/${d.id}`, target: '_blank', rel: 'noopener' }, 'Ver no site ↗'))));
        }
        more.style.display = j.results.length >= 24 ? '' : 'none';
      } catch (err) { $('.load', res)?.remove(); res.append(el('p', { class: 'err' }, 'Erro na busca de decks: ' + err.message), (/github.io$/.test(location.hostname) && !serverBase()) ? el('p', { class: 'muted' }, 'A busca de decks públicos precisa do servidor do jogo (não funciona só com o GitHub Pages). Você ainda pode montar decks no Construtor ou importar uma lista de texto.') : null); }
    }
    q.addEventListener('keydown', (e) => e.key === 'Enter' && run(false)); more.onclick = () => run(true);
    pane.append(el('div', { class: 'row' }, q, order, el('label', { class: 'chk' }, fmt, 'só Commander'), el('button', { class: 'btn primary', onclick: () => run(false) }, 'Buscar')),
      el('p', { class: 'muted' }, 'Decks públicos do Archidekt. Abra no construtor para ajustar, salvar ou jogar.'), res, more);
    run(false);
  };

  async function importArchidekt(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Carregando…'; }
    try {
      const r = await fetch(apiUrl('/api/decks/' + id)); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
      const ids = j.cards.map((c) => (c.sid ? { id: c.sid } : { name: c.name }));
      const { found } = await scry.collection(ids);
      const by = new Map(found.map((c) => [c.id, c])); const byName = new Map(found.map((c) => [c.name, c]));
      const entries = [];
      for (const c of j.cards) {
        const card = by.get(c.sid) || byName.get(c.name); if (!card) continue;
        scry.cacheCard(card);
        const ex = entries.find((e) => e.sid === card.id);
        if (ex) ex.qty += c.qty; else entries.push(scry.entryFromCard(card, { qty: c.qty, cmd: c.cmd }));
      }
      current = { id: uid(), name: j.name, entries, source: 'archidekt:' + id };
      go('build');
      toast(`"${j.name}" carregado (${total(current)} cartas)`);
    } catch (err) { toast('Falha ao importar: ' + err.message, 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Abrir no construtor'; } }
  }

  // ---- Importar lista ----
  async function importText(text, nameHint, statusEl) {
    const items = scry.parseDecklist(text);
    if (!items.length) return toast('Não encontrei cartas nessa lista.', 'err');
    try {
      const { entries, notFound } = await scry.resolveList(items, (a, b) => { if (statusEl) statusEl.textContent = `Resolvendo cartas… ${a}/${b}`; });
      current = { id: uid(), name: nameHint || 'Deck importado', entries };
      go('build');
      if (notFound.length) toast(`Não encontradas: ${notFound.slice(0, 6).join(', ')}${notFound.length > 6 ? '…' : ''}`, 'err');
      else toast(`Importado: ${total(current)} cartas`);
    } catch (err) { toast('Erro: ' + err.message, 'err'); }
  }

  T.import = () => {
    const ta = el('textarea', { class: 'inp ta', placeholder: 'Cole sua lista aqui:\n\nCommander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n1 Command Tower\n…\n\n(aceita formatos do Archidekt, Moxfield, MTG Arena e MTGO: "1 Sol Ring", "1x Sol Ring (CMM) 400")' });
    const url = el('input', { class: 'inp', placeholder: 'ou cole a URL de um deck do Archidekt (https://archidekt.com/decks/123456)' });
    const status = el('span', { class: 'muted' });
    pane.append(url, el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => { const mm = url.value.match(/decks\/(\d+)/); if (!mm) return toast('URL do Archidekt inválida. Para Moxfield/outros sites, copie a lista de texto e cole abaixo.', 'err'); importArchidekt(mm[1]); } }, 'Importar da URL')), ta,
      el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: async (ev) => { ev.target.disabled = true; await importText(ta.value, 'Deck importado', status); ev.target.disabled = false; } }, 'Importar texto'), status));
  };

  go(opts.tab || (loadDecks().length ? 'mine' : 'mine'));
  return m;
}

// carrega automaticamente o último deck usado (atalho)
export async function playLast() {
  const id = localStorage.getItem('mtg.lastDeck'); const d = loadDecks().find((x) => x.id === id);
  if (!d) return false;
  const meta = await scry.ensureMetas(d.entries.map((e) => e.sid));
  send('loadDeck', { entries: d.entries.map((e) => ({ sid: e.sid, qty: e.qty, cmd: !!e.cmd })), meta });
  return true;
}

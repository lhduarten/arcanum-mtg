import { S, connect, connectLocal, on, send } from './net.js';
import { $, el, toast } from './ui.js';
import { initTable, setZoom } from './table.js';
import { openDeckManager, loadDecks, playLast } from './decks.js';

const ls = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const cid = ls.get('mtg.cid') || (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now());
ls.set('mtg.cid', cid);

const code = () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').sort(() => Math.random() - 0.5).slice(0, 5).join('');
const nameIn = $('#in-name'), roomIn = $('#in-room'), srvIn = $('#in-server');
nameIn.value = ls.get('mtg.name', '');
roomIn.value = decodeURIComponent(location.hash.slice(1)).toUpperCase();

// Em hospedagem estática (GitHub Pages) não há servidor de jogo: o modo com amigos pede o endereço de um.
const qs = new URLSearchParams(location.search);
if (qs.get('server')) ls.set('mtg.server', qs.get('server'));
const isStatic = /github\.io$/.test(location.hostname) || qs.has('server');
if (isStatic) { $('#srvwrap').classList.remove('hidden'); $('#srvnote').classList.remove('hidden'); srvIn.value = ls.get('mtg.server', ''); }
srvIn.addEventListener('change', () => ls.set('mtg.server', srvIn.value.trim()));

const playerName = () => {
  const name = nameIn.value.trim() || 'Jogador ' + Math.floor(Math.random() * 90 + 10);
  ls.set('mtg.name', name); return name;
};

function enter(room) {
  room = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!room) { roomIn.focus(); return toast('Digite o código da sala ou crie uma nova.', 'err'); }
  if (isStatic) {
    const s = srvIn.value.trim(); ls.set('mtg.server', s);
    if (!s) { srvIn.focus(); return toast('Informe o endereço do servidor de jogo, ou use o modo solo.', 'err'); }
  }
  history.replaceState(null, '', location.pathname + location.search + '#' + room);
  connect({ room, cid, name: playerName() });
}

$('#btn-create').onclick = () => enter(code());
$('#btn-join').onclick = () => enter(roomIn.value);
$('#btn-solo').onclick = () => connectLocal({ cid, name: playerName() });
roomIn.addEventListener('keydown', (e) => e.key === 'Enter' && enter(roomIn.value));
nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && $('#btn-solo').click());
$('#btn-lobby-decks').onclick = () => openDeckManager({ standalone: true });

initTable();
setZoom(+ls.get('mtg.zoom', '1'));

on('welcome', (m) => { $('#lobby').classList.add('hidden'); $('#game').classList.remove('hidden'); $('#game').dataset.solo = S.solo ? '1' : ''; });
on('error', (m) => toast(m.msg, 'err'));
on('connfail', () => { $('#lobby').classList.remove('hidden'); $('#game').classList.add('hidden'); toast('Não consegui conectar ao servidor. Verifique o endereço ou use o modo solo.', 'err'); });
on('status', (ok) => { $('#conn').className = 'conn ' + (ok ? 'ok' : 'bad'); $('#conn').title = ok ? 'Conectado' : 'Reconectando…'; });

window.addEventListener('arcanum:decks', () => openDeckManager());
window.addEventListener('arcanum:leave', () => { location.href = location.pathname + location.search; location.reload(); });
window.addEventListener('arcanum:invite', async () => {
  const srv = ls.get('mtg.server', '');
  const url = `${location.origin}${location.pathname}${srv ? '?server=' + encodeURIComponent(srv) : ''}#${S.room}`;
  try { await navigator.clipboard.writeText(url); toast('Link da sala copiado!'); } catch { prompt('Copie o link:', url); }
});

// prompt de deck quando o jogador ainda não carregou um
function updateDeckPrompt() {
  const p = S.players[S.you]; const box = $('#deckprompt');
  const need = p && !p.deck;
  box.classList.toggle('hidden', !need);
  if (!need) return;
  const last = ls.get('mtg.lastDeck'); const d = loadDecks().find((x) => x.id === last);
  const act = $('#dp-actions'); act.textContent = '';
  if (d) act.append(el('button', { class: 'btn primary big', onclick: async (e) => { e.target.disabled = true; try { await playLast(); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; } } }, `▶ ${d.name}`));
  act.append(el('button', { class: 'btn big' + (d ? '' : ' primary'), onclick: () => openDeckManager() }, 'Escolher deck'));
}
on('delta', (ch) => { if (ch.players) updateDeckPrompt(); });

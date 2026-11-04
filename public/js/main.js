import { S, connect, on, send } from './net.js';
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
const nameIn = $('#in-name'), roomIn = $('#in-room');
nameIn.value = ls.get('mtg.name', ''); roomIn.value = decodeURIComponent(location.hash.slice(1)).toUpperCase();

// Em hospedagem estática (GitHub Pages) é preciso informar o servidor de jogo
const qs = new URLSearchParams(location.search);
if (qs.get('server')) ls.set('mtg.server', qs.get('server'));
const srvIn = $('#in-server');
if (/github\.io$/.test(location.hostname) || qs.has('server')) { $('#srvwrap').classList.remove('hidden'); srvIn.value = ls.get('mtg.server', ''); }
srvIn.addEventListener('change', () => ls.set('mtg.server', srvIn.value.trim()));

function enter(room) {
  if (!$('#srvwrap').classList.contains('hidden')) ls.set('mtg.server', srvIn.value.trim());
  const name = nameIn.value.trim() || 'Jogador ' + Math.floor(Math.random() * 90 + 10);
  room = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (!room) { roomIn.focus(); return toast('Digite o código da sala ou crie uma nova.', 'err'); }
  ls.set('mtg.name', name);
  history.replaceState(null, '', '#' + room);
  connect({ room, cid, name });
}

$('#btn-create').onclick = () => enter(code());
$('#btn-join').onclick = () => enter(roomIn.value);
roomIn.addEventListener('keydown', (e) => e.key === 'Enter' && enter(roomIn.value));
nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && (roomIn.value ? enter(roomIn.value) : roomIn.focus()));
$('#btn-lobby-decks').onclick = () => openDeckManager({ standalone: true });

initTable();

on('welcome', (m) => {
  $('#lobby').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#roomcode').textContent = m.room;
});
on('error', (m) => toast(m.msg, 'err'));
on('status', (ok) => {
  $('#conn').className = 'conn ' + (ok ? 'ok' : 'bad'); $('#conn').title = ok ? 'Conectado' : 'Reconectando…';
});

$('#btn-invite').onclick = async () => {
  const srv = ls.get('mtg.server', '');
  const url = `${location.origin}${location.pathname}${srv ? '?server=' + encodeURIComponent(srv) : ''}#${S.room}`;
  try { await navigator.clipboard.writeText(url); toast('Link da sala copiado!'); } catch { prompt('Copie o link:', url); }
};
$('#btn-decks').onclick = () => openDeckManager();
$('#btn-side').onclick = () => $('#game').classList.toggle('noside');
$('#btn-help').onclick = () => $('#help').classList.toggle('hidden');
$('#help .x').onclick = () => $('#help').classList.add('hidden');

// prompt de deck quando o jogador ainda não carregou um
function updateDeckPrompt() {
  const p = S.players[S.you]; const box = $('#deckprompt');
  const need = p && !p.deck;
  box.classList.toggle('hidden', !need);
  if (!need) return;
  const last = ls.get('mtg.lastDeck'); const d = loadDecks().find((x) => x.id === last);
  const act = $('#dp-actions'); act.textContent = '';
  if (d) act.append(el('button', { class: 'btn primary big', onclick: async (e) => { e.target.disabled = true; try { await playLast(); } catch (err) { toast(err.message, 'err'); e.target.disabled = false; } } }, `▶ Usar "${d.name}"`));
  act.append(el('button', { class: 'btn big' + (d ? '' : ' primary'), onclick: () => openDeckManager() }, '📚 Escolher / montar / buscar deck'));
}
on('delta', (ch) => { if (ch.players) updateDeckPrompt(); });


const zr = $('#zoom'); zr.value = ls.get('mtg.zoom', '1'); setZoom(+zr.value);
zr.addEventListener('input', () => { ls.set('mtg.zoom', zr.value); setZoom(+zr.value); });

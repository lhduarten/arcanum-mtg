// Teste de integração: combate, pagamento de mana, pilha automática, mulligan/início. Uso: PORT=3055 node server/index.js
import WebSocket from 'ws';
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = (name, room) => new Promise((r) => {
  const ws = new WebSocket('ws://localhost:3055'); const st = { cards: {}, zones: {}, players: {}, err: [], log: [], alerts: [], combat: null, settings: {}, turn: {}, stack: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, cid: room + name, name })));
  ws.on('message', (d) => { const m = JSON.parse(d);
    if (m.t === 'welcome') st.you = m.you; if (m.t === 'error') st.err.push(m.msg); if (m.t === 'alert') st.alerts.push(m.text);
    if (m.t === 'delta') { for (const [k, v] of Object.entries(m.cards || {})) v ? (st.cards[k] = v) : delete st.cards[k]; Object.assign(st.zones, m.zones || {});
      for (const p of m.players || []) st.players[p.id] = p; if ('combat' in m) st.combat = m.combat; if (m.settings) st.settings = m.settings; if (m.turn) st.turn = m.turn; if (m.stack) st.stack = m.stack; if (m.log) st.log.push(...m.log.map((l) => l.m)); } });
  st.send = (a, o = {}) => ws.send(JSON.stringify({ t: 'act', a, ...o })); st.ws = ws; setTimeout(() => r(st), 300);
});
const F = (name, type, power, toughness, text = '', mana = '') => ({ name, type, power, toughness, text, mana });
const meta = {
  bear: { name: 'Bear', faces: [F('Bear', 'Creature — Bear', '2', '2', '', '{1}')] },
  fly: { name: 'Bird', faces: [F('Bird', 'Creature — Bird', '1', '1', 'Flying')] },
  dt: { name: 'Snake', faces: [F('Snake', 'Creature — Snake', '1', '1', 'Deathtouch')] },
  tank: { name: 'Wall', faces: [F('Wall', 'Creature — Wall', '0', '4', 'Defender')] },
  cmdr: { name: 'Krenko', faces: [F('Krenko', 'Legendary Creature — Goblin', '3', '3', '', '{2}{R}')] },
  isl: { name: 'Island', faces: [F('Island', 'Basic Land — Island', null, null, '({T}: Add {U}.)')] },
  mtn: { name: 'Mountain', faces: [F('Mountain', 'Basic Land — Mountain', null, null, '({T}: Add {R}.)')] },
  bolt: { name: 'Bolt', faces: [F('Bolt', 'Instant', null, null, '', '{R}')] },
};
const A = await mk('A', 'CMB'), B = await mk('B', 'CMB');
A.send('loadDeck', { entries: [{ sid: 'bear', qty: 12 }, { sid: 'fly', qty: 4 }, { sid: 'mtn', qty: 20 }, { sid: 'bolt', qty: 4 }, { sid: 'cmdr', qty: 1, cmd: true }], meta });
B.send('loadDeck', { entries: [{ sid: 'bear', qty: 12 }, { sid: 'dt', qty: 4 }, { sid: 'tank', qty: 4 }, { sid: 'isl', qty: 20 }], meta });
await sl(300);
ok(A.turn.num === undefined || A.turn.num === 0, 'jogo ainda não começou (mulligan pendente)');
A.send('keep', { bottom: [] }); await sl(200);
ok(!A.turn.num, 'não inicia até todos manterem');
B.send('mulligan'); await sl(200); B.send('mulligan'); await sl(200);
B.send('keep', { bottom: [] }); await sl(200);
ok(B.err.at(-1)?.includes('1 carta'), 'mulligan 2 exige 1 carta no fundo: ' + B.err.at(-1));
B.send('keep', { bottom: [B.zones[B.you + ':hand'][0]] }); await sl(300);
ok(A.turn.num === 1, 'início automático após todos manterem');
const first = A.turn.active === A.you ? A : B, second = first === A ? B : A;
// Coloca criaturas em campo (cheat via move; o "sick" será limpo no próximo turno do dono)
const pick = (S, sid) => S.zones[S.you + ':hand'].concat(S.zones[S.you + ':command'] || []).find((i) => S.cards[i]?.sid === sid);
// força mãos: compra tudo
first.send('draw', { n: 30 }); second.send('draw', { n: 30 }); await sl(300);
const byS = (S, sid, zone = 'hand') => S.zones[S.you + ':' + zone].filter((i) => S.cards[i]?.sid === sid);
// --- pagamento automático
const lands = byS(first, first === A ? 'mtn' : 'isl'); const bears = byS(first, 'bear');
first.send('move', { ids: lands.slice(0, 3), zone: 'battlefield', x: .1, y: .7 }); await sl(200);
first.send('move', { ids: [bears[0]], zone: 'battlefield', x: .3, y: .3 }); await sl(250);
ok(first.log.some((l) => /pagou|insuficiente/.test(l)), 'jogar criatura cobra mana / avisa: ' + first.log.filter((l) => /pagou|insuficiente/.test(l)).at(-1));
if (first === A) { A.send('settings', { stackDelay: 1 }); await sl(100); const bolt = byS(A, 'bolt')[0]; A.send('move', { ids: [bolt], zone: 'battlefield' }); await sl(200);
  ok(A.stack.includes(bolt), 'instantânea vai para a pilha'); await sl(1700); ok(A.cards[bolt].zone === 'graveyard', 'pilha auto-resolve após o atraso → cemitério'); }
// --- combate: próximo turno do dono para tirar enjoo
first.send('next'); await sl(200); second.send('next'); await sl(300);
ok(first.turn.active === first.you, 'volta ao turno do primeiro');
const atk = bears[0]; first.cards[atk].sick === false || ok(false, 'enjoo limpo');
const defB = byS(second, 'bear')[0], dtB = byS(second, 'dt')[0], tank = byS(second, 'tank')[0];
second.send('move', { ids: [defB, tank].filter(Boolean), zone: 'battlefield', x: .4, y: .3 }); await sl(300);
const life0 = second.players[second.you].life;
first.send('nextPhase'); await sl(300);
ok(first.turn.phase === 'combat' && first.combat?.step === 'declare', 'fase de combate abre declaração: ' + first.turn.phase);
// 1) ataque sem bloqueio => dano automático
first.send('attack', { ids: [atk], target: second.you }); await sl(200);
ok(first.cards[atk].tapped, 'atacante vira');
first.send('endDeclare'); await sl(200);
ok(second.combat?.step === 'block', 'defensor recebe etapa de bloqueio');
second.send('doneBlock'); await sl(300);
ok(second.players[second.you].life === life0 - 2, `dano automático sem bloqueio: ${life0} → ${second.players[second.you].life}`);
ok(first.combat === null, 'combate encerrado');
// 2) ataque bloqueado: urso x urso morrem
first.send('next'); await sl(200); second.send('next'); await sl(200);
first.send('nextPhase'); await sl(200);
first.send('attack', { ids: [atk], target: second.you }); await sl(150); first.send('endDeclare'); await sl(150);
second.send('block', { ids: [defB], attacker: atk }); await sl(150); second.send('doneBlock'); await sl(300);
ok(first.cards[atk].zone === 'graveyard' && second.cards[defB].zone === 'graveyard', 'bloqueio 2/2 x 2/2: ambos morrem');
// 3) voar não pode ser bloqueado por criatura sem voar/alcance
if (first === A) {
  const bird = byS(A, 'fly')[0]; A.send('move', { ids: [bird], zone: 'battlefield', x: .5, y: .3 }); await sl(200);
  A.send('next'); await sl(150); second.send('next'); await sl(200);
  A.send('nextPhase'); await sl(150);
  A.send('attack', { ids: [bird], target: second.you }); await sl(150); A.send('endDeclare'); await sl(150);
  second.send('block', { ids: [tank], attacker: bird }); await sl(200);
  ok(second.err.some((e) => e.includes('voar')), 'voar: bloqueio ilegal recusado');
  second.send('doneBlock'); await sl(300);
  ok(second.players[second.you].life === life0 - 3, 'pássaro passa e causa 1');
}
// 4) pump + ping de tarefas
console.log(fails ? `\n${fails} FALHAS` : '\nTudo certo');
process.exit(fails ? 1 : 0);

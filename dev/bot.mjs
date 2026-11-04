import WebSocket from 'ws';
const names=['Sol Ring','Command Tower','Atraxa, Praetors\' Voice','Jace, the Mind Sculptor','Llanowar Elves','Birds of Paradise','Swords to Plowshares','Counterspell','Forest','Island','Plains','Swamp','Eternal Witness','Rhystic Study','Cultivate','Doubling Season'];
const r=await fetch('https://api.scryfall.com/cards/collection',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','User-Agent':'MTGTable/0.1'},body:JSON.stringify({identifiers:names.map(name=>({name}))})});
const j=await r.json();
const meta={};const entries=[];
for(const c of j.data){const f=c.card_faces&&!c.image_uris?c.card_faces:[c];meta[c.id]={sid:c.id,name:c.name,cmc:c.cmc,faces:f.map(x=>({name:x.name,type:x.type_line||c.type_line,mana:x.mana_cost,text:x.oracle_text||'',power:x.power,toughness:x.toughness,loyalty:x.loyalty,s:(x.image_uris||c.image_uris).small,n:(x.image_uris||c.image_uris).normal}))};entries.push({sid:c.id,qty:c.type_line.startsWith('Basic')?15:1,cmd:c.name.startsWith('Atraxa')});}
const ws=new WebSocket('ws://localhost:3000');let me;const cards={};const zones={};
ws.on('open',()=>ws.send(JSON.stringify({t:'join',room:'TESTE',cid:'bot-'+process.argv[2],name:process.argv[2]||'Bot'})));
ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='welcome')me=m.you;if(m.t==='delta'){for(const[k,v]of Object.entries(m.cards||{}))v?cards[k]=v:delete cards[k];Object.assign(zones,m.zones||{});}});
const act=(a,o={})=>ws.send(JSON.stringify({t:'act',a,...o}));
await new Promise(r=>setTimeout(r,800));
act('loadDeck',{entries,meta});await new Promise(r=>setTimeout(r,500));
act('draw',{n:10});await new Promise(r=>setTimeout(r,400));
const hand=zones[me+':hand']||[];let i=0;
for(const id of hand){if(i>6)break;act('move',{ids:[id],zone:'battlefield',x:.04+i*.11,y:i%2?.1:.5});i++;}
await new Promise(r=>setTimeout(r,500));
const bf=zones[me+':battlefield']||[];if(bf[0]){act('counter',{id:bf[0],kind:'+1/+1',delta:3});act('tap',{ids:[bf[1]]});}
console.log('bot ready, bf',bf.length);
setInterval(()=>{},1000);

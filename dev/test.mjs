import WebSocket from 'ws';
const mk=(name)=>new Promise(r=>{const ws=new WebSocket('ws://localhost:3055');const st={cards:{},zones:{},log:[]};ws.on('open',()=>{ws.send(JSON.stringify({t:'join',room:'TEST',cid:name,name}))});
ws.on('message',d=>{const m=JSON.parse(d);if(m.t==='welcome')st.you=m.you;if(m.t==='delta'){for(const[k,v]of Object.entries(m.cards||{}))v?st.cards[k]=v:delete st.cards[k];Object.assign(st.zones,m.zones||{});if(m.log)st.log.push(...m.log.map(l=>l.m));}if(m.t==='alert')st.log.push('ALERT '+m.text);});
st.send=(o)=>ws.send(JSON.stringify({t:'act',...o}));setTimeout(()=>r(st),300)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const meta={a:{name:'Bear',faces:[{name:'Bear',type:'Creature — Bear',text:'',power:'2',toughness:'2'}]},b:{name:'Bolt',faces:[{name:'Bolt',type:'Instant',text:''}]},c:{name:'Krenko',faces:[{name:'Krenko',type:'Legendary Creature — Goblin',text:'',power:'3',toughness:'3'}]},d:{name:'Tapland',faces:[{name:'Tapland',type:'Land',text:'Tapland enters tapped.'}]},w:{name:'Jace',faces:[{name:'Jace',type:'Legendary Planeswalker — Jace',text:'',loyalty:'3'}]}};
const A=await mk('A'),B=await mk('B');
A.send({a:'loadDeck',entries:[{sid:'a',qty:30},{sid:'b',qty:5},{sid:'d',qty:5},{sid:'w',qty:1},{sid:'c',qty:1,cmd:true}],meta});
B.send({a:'loadDeck',entries:[{sid:'a',qty:40}],meta});
await sleep(300);
const hand=A.zones[A.you+':hand'];console.log('A hand',hand.length,'B sees A hand as',JSON.stringify(B.zones[A.you+':hand']));
console.log('B sees cards of A hand?',Object.values(B.cards).filter(c=>c.owner===A.you&&c.zone==='hand').length);
const bear=hand.find(i=>A.cards[i].sid==='a');
A.send({a:'move',ids:[bear],zone:'battlefield',x:.3,y:.3});await sleep(150);
console.log('bear on bf',A.cards[bear].zone,'sick',A.cards[bear].sick, 'B sees', B.cards[bear]?.zone);
A.send({a:'counter',id:bear,kind:'-1/-1',delta:1});A.send({a:'counter',id:bear,kind:'+1/+1',delta:1});await sleep(150);
console.log('counters after cancel',JSON.stringify(A.cards[bear].counters));
A.send({a:'counter',id:bear,kind:'-1/-1',delta:2});await sleep(150);
console.log('bear zone after -1/-1 x2:',A.cards[bear].zone);
// commander
const cmd=A.zones[A.you+':command'][0];A.send({a:'move',ids:[cmd],zone:'battlefield',x:.5,y:.3});await sleep(100);
A.send({a:'move',ids:[cmd],zone:'graveyard'});await sleep(100);console.log('cmd zone',A.cards[cmd].zone,'tax',A.cards[cmd].tax);
A.send({a:'move',ids:[cmd],zone:'stack'});await sleep(100);console.log('cmd tax',A.cards[cmd].tax,A.cards[cmd].zone);
A.send({a:'pass'});B.send({a:'pass'});await sleep(150);console.log('auto-resolve ->',A.cards[cmd].zone);
// instant
A.send({a:'draw',n:20});await sleep(150);
const hid=A.zones[A.you+':hand'];const bolt=hid.find(i=>A.cards[i].sid==='b');
A.send({a:'move',ids:[bolt],zone:'battlefield',x:.2,y:.2});await sleep(100);console.log('bolt goes',A.cards[bolt].zone);
A.send({a:'resolve'});await sleep(100);console.log('bolt after resolve',A.cards[bolt].zone);
const tl=hid.find(i=>A.cards[i].sid==='d');A.send({a:'move',ids:[tl],zone:'battlefield'});await sleep(100);console.log('tapland tapped',A.cards[tl].tapped);
const jw=hid.find(i=>A.cards[i].sid==='w');if(jw){A.send({a:'move',ids:[jw],zone:'battlefield'});await sleep(100);console.log('jace',JSON.stringify(A.cards[jw].counters));}
A.send({a:'token',meta:{sid:'tk',name:'Goblin',faces:[{name:'Goblin',type:'Token Creature — Goblin',power:'1',toughness:'1',text:''}]},n:3});await sleep(100);
const tok=Object.values(A.cards).filter(c=>c.token).map(c=>c.id);console.log('tokens',tok.length);
A.send({a:'move',ids:[tok[0]],zone:'graveyard'});await sleep(100);console.log('token exists after gy?',!!A.cards[tok[0]]);
A.send({a:'start'});await sleep(100);A.send({a:'next'});await sleep(100);
console.log(A.log.slice(-8).join('\n'));process.exit(0);

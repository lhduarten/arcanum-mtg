# ARCANUM — mesa de Magic online (Commander)

    npm install
    npm start          # http://localhost:3000

Abra em duas abas/máquinas, crie uma sala e compartilhe o link (#CÓDIGO).

- Cartas/imagens: Scryfall API (direto do navegador). Decks públicos: Archidekt (via proxy do servidor).
- Servidor autoritativo (server/game.js): biblioteca e mãos alheias nunca saem do servidor; só deltas trafegam.
- Automação: ficha some ao sair do campo, comandante volta ao comando (+taxa), +1/+1 e -1/-1 se anulam,
  criatura morre com resistência 0 / dano letal, planeswalker com 0 de lealdade vai ao cemitério,
  mágicas vão para a pilha e resolvem para o cemitério, "enters tapped", lealdade/saga ao entrar,
  desvirar+comprar no início do turno, dano de comandante desconta vida.
- dev/test.mjs: teste de integração do motor (PORT=3055 node server/index.js).

## GitHub Pages
A pasta `public/` é publicada no GitHub Pages (workflow em `.github/workflows/pages.yml`).
Pages só serve arquivos estáticos: o jogo precisa do servidor Node (`npm start`) rodando em algum lugar acessível.
Na página do Pages, informe o endereço do servidor no campo "Servidor de jogo" (ou use `?server=https://seu-servidor`).
O servidor aceita CORS na API de decks; o WebSocket usa o mesmo host.

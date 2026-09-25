# Spike de desempenho da Mesa

Data: 2026-09-24 (time Vista). Spec: `docs/superpowers/specs/2026-09-24-sala-em-dois-modos-design.md`,
seção 5. Script: `tools/mesa-prints/harness.js desempenho`.

## Como foi medido

- Chromium 141 headless do Playwright (`/opt/node22/lib/node_modules/playwright`),
  **sem GPU** (container de 4 núcleos, rasterização e composição em software),
  janela de 1920 × 1080. Não é o Electron 44 de ninguém: os números servem para
  **comparar** Transmissão e Mesa na mesma máquina, não como valor absoluto.
- O renderer de verdade (`src/renderer/index.html`) com a ponte `window.golive`
  simulada, entrando pela interface numa sala do **servidor de sinalização de
  verdade**; as outras pessoas são clientes `ws` crus que vão ao vivo e ligam a
  câmera (o servidor põe as janelas `tela`/`camera` sozinho).
- Na mesa: **3 telas** de 1920 × 1080 e **2 câmeras** de 1280 × 720, todas
  `canvas.captureStream(30)` redesenhando um gradiente com um quadrado andando
  a cada quadro (o custo de gerar esses 5 vídeos entra na conta), postas no
  palco por `ui.grid.showTile` como a track do WebRTC faria, e **1 iframe em
  branco** (conteúdo de teste no lugar do placar). A mesa em "Ver tudo".
- Cada linha: 3 s contando `requestAnimationFrame`. "Longos" = intervalos acima
  de 33,4 ms.

## Números

Rodada 1, Chromium com vsync (o headless trava perto de 30 qps):

| Cenário | qps | p50 (ms) | p95 (ms) | pior (ms) | longos |
|---|---|---|---|---|---|
| Transmissão, parada (5 vídeos no palco) | 31,0 | 33,3 | 33,4 | 33,4 | 17 |
| Mesa, parada | 32,0 | 33,3 | 33,4 | 50,0 | 8 |
| Mesa, andando (arrastar o fundo) | 32,6 | 33,3 | 33,4 | 50,0 | 8 |
| Mesa, zoom na roda | 31,3 | 33,3 | 66,6 | 116,7 | 22 |
| Mesa, arrastando uma tela | 32,9 | 33,3 | 50,0 | 66,7 | 26 |
| Mesa, voo do "Ver tudo" repetido | 26,5 | 33,4 | 66,6 | 83,3 | 47 |
| Transmissão de novo, parada | 31,3 | 33,3 | 33,4 | 66,7 | 23 |

Rodada 2, `SEM_VSYNC=1` (`--disable-gpu-vsync --disable-frame-rate-limit`),
mostra o teto da máquina (a CPU satura gerando os 5 vídeos falsos):

| Cenário | qps | p50 (ms) | p95 (ms) | pior (ms) | longos |
|---|---|---|---|---|---|
| Transmissão, parada | 35,2 | 34,2 | 35,3 | 52,0 | 64 |
| Mesa, parada | 36,8 | 34,0 | 35,1 | 41,5 | 58 |
| Mesa, andando | 34,7 | 34,0 | 35,2 | 51,8 | 57 |
| Mesa, zoom na roda | 31,7 | 34,3 | 51,3 | 74,6 | 59 |
| Mesa, arrastando uma tela | 34,1 | 33,0 | 43,6 | 68,9 | 51 |
| Mesa, voo do "Ver tudo" repetido | 26,2 | 34,9 | 72,5 | 100,3 | 66 |
| Transmissão de novo, parada | 34,9 | 34,0 | 47,8 | 69,1 | 58 |

## Leitura

- **Mesa parada e andando custam o mesmo que a Transmissão.** Andar mexe só
  numa `transform` do contêiner e nas três propriedades de fundo da grade:
  nenhum layout.
- **Zoom e voo são o caro** (p95 de 50 a 70 ms aqui, sem GPU): a cada passo de
  escala o navegador re-rasteriza o texto das janelas e reescala os 5 vídeos.
  Com GPU, os vídeos escalam no compositor; o texto é o que sobra. Se no PC de
  alguém isso aparecer, o próximo passo é travar a rasterização durante o
  gesto (`will-change: transform` no contêiner já fica ligado enquanto a vista
  anda, 200 ms depois do último passo) e/ou arredondar o zoom da roda em
  degraus.
- **Arrastar uma janela** fica perto da Transmissão: só a `transform` da janela
  muda, com `will-change` só nela e só durante o arraste; o contorno de onde
  ela assenta é um retângulo à parte.
- **Voltar à Transmissão** devolve os tiles ao palco sem renegociar (o mesmo
  `<video>` continua tocando: `videosTocando` na checagem do script) e o custo
  volta ao da primeira linha.
- Nada disto roda na Transmissão: antes de abrir a Mesa e depois de fechá-la,
  `document.querySelectorAll('.mesa, .mesa-win').length === 0` (checagem do
  modo `prints`).

## O que não deu para medir aqui

- **Electron 44 com GPU de verdade**, jogo aberto e encoder rodando: precisa de
  um PC. Rodar `node tools/mesa-prints/harness.js desempenho` num Windows com
  o Playwright instalado dá a mesma tabela; o ideal é repetir dentro do app.
- **"Fora da vista não recebe vídeo"** ponta a ponta: o banco de prova não tem
  WebRTC (os vídeos são falsos, nenhum `view-state` sai). A carência de 2 s e o
  teto de largura estão cobertos por teste puro (`mesa-vista.test.js`,
  `peerquality-width.test.js`); o caminho no app é `wantsMedia` e o `maxWidth`
  do `view-state` em `app.js`. Conferir com 2 PCs: andar a mesa até uma tela
  sumir e ver o `[assistir] view-state -> ... watching=false` no log depois de
  2 s.

# Ponteiro laser e reações rápidas — design

Frente **interação** (C: ponteiro laser; D: reações rápidas), branch
`feat/laser-e-reacoes`. Reaproveita a infraestrutura de rabisco/anotação já
existente (`src/renderer/annotate.js`, `tile-annot-bar`/`tile-annot-canvas` em
`ui.js`, mensagens `annotate`/`annotate-sync` no `server/signaling-core.js`,
overlay real em `src/main.js` + `src/renderer/overlay.js`). Ver
`docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md`
e `2026-09-05-rabisco-na-tela-real-design.md`.

## 1. Visão geral

**C — Laser.** Quem assiste vira uma terceira ferramenta na MESMA barra de
anotação do tile (`tile-annot-bar`): ao lado de Caneta/Escrever entra
**Laser**. Com a barra ligada (o mesmo toggle liga/desliga que já existe) e a
ferramenta Laser escolhida, mover o mouse sobre o tile manda a posição
normalizada (0–1) em throttle de ~20–30 Hz. Quem recebe desenha um ponto com
rastro curto, na cor da pessoa, que **some sozinho** ~1 s depois de parar —
sem mensagem explícita de "apaguei o laser": o desaparecimento é decidido
pelo relógio de quem desenha (`age > 1000ms`), não por um evento de rede. Isso
também resolve de graça o "laser de quem sai da sala" (RQ4): sem mensagem
nova chegando, o ponto já era pra sumir sozinho.

**D — Reações.** Uma fileira de 6 emojis fixos (👍 😂 😮 🔥 👏 ❤️), acessível
no tile por uma barra que aparece ao passar o mouse (nova, `tile-react-bar`).
Clicar manda `{surface, emoji}`; quem recebe sobe um emoji que nasce, sobe um
pouco e desaparece sobre aquele tile — pra TODO mundo que assiste, inclusive
quem clicou (aplicado localmente na hora, sem esperar o servidor devolver).

Os dois reaproveitam o esquema de endereçamento que o rabisco já usa:
`surface = '<dono>:<kind>'` (`annotate.surfaceKey`/`parseSurface`). Isso não é
capricho — é o que permite:
- Laser e reação em uma CÂMERA funcionarem pelo mesmo caminho que a tela (o
  addressing já distingue os dois).
- O overlay da tela real (que só existe pra tela inteira, nunca câmera) saber
  quando uma mensagem é sobre A TELA de quem está compartilhando, e ignorá-la
  quando for sobre uma câmera.
- Reaproveitar a checagem de sala do servidor (`surfaceOwner`) sem escrever
  uma segunda validação de "essa pessoa existe nesta sala".

## 2. Permissão — a decisão mais importante deste documento

A pergunta do brief: laser usa a MESMA permissão do rabisco
(`allow-annotations`/`shareAnnotations`); reação, o brief pede pra decidir e
justificar.

**Decisão: os dois — laser e reação na TELA REAL — usam a MESMA permissão do
rabisco.** A reação DENTRO do app (sobre o tile, no `<canvas>`/grid de
alguém) **não pede permissão nenhuma** — é só um efeito visual do lado de quem
assiste, não toca a tela real de ninguém.

Por quê uma permissão só, e não uma nova para reação-na-tela-real:
- O princípio do brief já é "agir na tela de alguém é permissão de quem
  transmite" — no singular. O checkbox "Deixar a sala rabiscar na minha tela"
  (`#allow-annotations`) já É essa permissão; ele autoriza "coisas que a sala
  desenha por cima da minha tela real", e um emoji subindo ou um ponto de
  laser são exatamente isso — desenho efêmero por cima da tela, a mesma
  categoria de intrusão que caneta e texto.
- Uma segunda caixa de seleção no diálogo de compartilhar ("permitir reação
  na tela real: sim/não", separada de "permitir rabisco: sim/não") duplica
  uma decisão que quem vai ao vivo já tomou um segundo antes, sem ganho real
  — ninguém vai querer rabisco mas não reação, ou vice-versa, e cada opção a
  mais no diálogo de ir ao vivo é fricção antes de transmitir.
- Reaproveitar a permissão existente é a MENOR mudança nos arquivos
  disputados: nenhuma linha nova em `index.html`, nenhum campo novo no
  `broadcast-state`/`camera-state`. Laser e reação-na-tela-real ficam de
  graça atrás do `annotate: true` que já viaja.

Descartado: permissão própria por recurso (`allowLaser`, `allowReactions`).
Motivo: fragmenta uma decisão que já existe, exige UI nova em arquivo
disputado (`index.html`) e duas mensagens de protocolo maiores, sem um caso
de uso concreto que peça o corte fino.

Consequência prática: se o dono da tela NUNCA ligou "Deixar a sala rabiscar
na minha tela", a ferramenta Laser nem aparece na barra do tile (mesmo gate
que já esconde Caneta/Escrever — `canDraw`), e a reação continua funcionando
no tile só que nunca chega ao overlay real (o mesmo caminho de
`pushToAnnotOverlay` já existente, estendido).

## 3. Protocolo de sinalização — dois tipos novos

O servidor (`server/signaling-core.js`) NÃO guarda estado de laser nem de
reação (assim como não guarda rabisco) — só valida e repassa. Nada disso vai
pro `chatHistory`, nada é persistido, e não existe `*-sync` pra quem entra
depois (diferente do rabisco): quem chega no meio de um laser ou de uma
reação simplesmente não vê o que já aconteceu, porque os dois somem sozinhos
em ~1–1.4 s — não há "estado" pra sincronizar.

### 3.1 `laser`

Cliente → servidor:
```
{ type: 'laser', surface: '<ownerId>:<kind>', x: 0..1, y: 0..1 }
```
Servidor → sala (exceto quem mandou):
```
{ type: 'laser', surface: '<ownerId>:<kind>', from: '<peerId>', x, y }
```

Validação no servidor (`sanitizeLaserOp`, espelho de `sanitizeAnnotateOp`):
- `surface` resolve pra um peer que existe NESTA sala (`surfaceOwner`, a
  mesma função que `annotate` já usa — nenhuma duplicação nova).
- `x`/`y`: `normPoint` (mesma função do `annotate`) — finito, 0..1, 3 casas;
  qualquer outra coisa descarta a mensagem inteira.
- Sem `id`, sem `width`, sem `color` no fio: a cor do ponto do lado de quem
  recebe é `colorOf({from})` → `annotate.colorFor(from)` (a mesma cor do
  pincel da pessoa) — não existe campo pra forjar a cor de outro, igual ao
  resto do rabisco.
- Rate limit: `createRateLimiter({ limit: 30, windowMs: 1000 })` por peer,
  limitador PRÓPRIO (`laserLimiters`, não reaproveita o de `annotate` —
  mesmo raciocínio do comentário já existente no arquivo: laser rápido não
  pode gastar a cota de rabisco nem fechar o socket). Estoura em silêncio,
  igual chat/annotate/watchers.
- Handler inteiro em `try` implícito do `switch` (mesma estrutura dos outros
  `case`) — `msg` inválido nunca lança, sempre descarta.

### 3.2 `reaction`

Cliente → servidor:
```
{ type: 'reaction', surface: '<ownerId>:<kind>', emoji: '👍' }
```
Servidor → sala (exceto quem mandou):
```
{ type: 'reaction', surface: '<ownerId>:<kind>', from: '<peerId>', emoji: '👍' }
```

Validação no servidor (`sanitizeReactionOp`):
- `surface` resolve pra um peer nesta sala (mesma checagem de `laser`).
- `emoji` tem que bater IGUAL (comparação de string exata) com um item da
  lista fechada `REACTION_EMOJI` (👍 😂 😮 🔥 👏 ❤️) — espelho do array
  `REACTIONS` de `src/renderer/reactions.js`, do mesmo jeito que
  `SURFACE_KINDS`/`ANNOTATE_COLOR_RE` já espelham `annotate.js`. Qualquer
  outra coisa (emoji fora da lista, string vazia, objeto, número) descarta.
- Rate limit: token-bucket simples (`createBurstLimiter`, novo, pequeno,
  testado) — rajada de 5, depois 1 a cada 300 ms por peer
  (`reactionLimiters`, cota própria). Ver seção 5 — implementado como um
  balde de fichas (capacidade 5, reabastece 1 ficha a cada 300 ms), não como
  o `createRateLimiter` de janela fixa que o resto do arquivo usa: "rajada
  curta, depois devagar" é literalmente a definição de um token bucket, e
  aproximar isso com janela fixa daria ou rajada boa demais ou steady-state
  ruim demais.

### 3.3 Por que sem `*-sync`

`annotate-sync` existe porque rabisco e texto PERSISTEM na lousa até alguém
apagar — quem entra no meio da sessão precisa do snapshot. Laser e reação
são o oposto: cada um já nasce com prazo de validade (~1 s / ~1.4 s) mais
curto que qualquer round-trip de sincronização faria sentido cobrir. Nenhum
`*-sync` novo, nenhum estado novo no servidor.

## 4. Ciclo de vida — client-side, em módulo puro

### 4.1 `src/renderer/laser.js` (novo)

Sem DOM, sem WebRTC — só o que `annotate.js` já não resolve:

- `shouldEmit(lastSentAt, now, hz)`: throttle de envio. `hz` é a taxa alvo
  (20–30); devolve `true` quando `now - lastSentAt >= 1000/hz`. Puro,
  testável com relógio fake.
- `createStore()`: um Map `peerId -> { surfaceId, x, y, ts }` (a POSIÇÃO MAIS
  RECENTE de cada pessoa apontando, não uma lista de pontos — o "rastro
  curto" é efeito visual, não estado guardado; ver seção 4.3).
  - `apply(surfaceId, from, { x, y }, now)`: valida `x`/`y` normalizados
    (reaproveita `isNorm`/`round3`, copiados de `annotate.js` — o mesmo tipo
    de espelho que o servidor já faz, porque este módulo não pode depender
    de `annotate.js` carregar primeiro nem o contrário).
  - `active(now, ttlMs = 1000)`: devolve a lista de pontos "vivos" agora
    (`now - ts < ttlMs`), com `age` calculado — quem desenha usa `age` pra
    decidir opacidade/tamanho do rastro sem guardar histórico de pontos.
  - `dropAuthor(peerId)`: remove o ponto de quem saiu da sala (mesmo padrão
    de `annotate.dropAuthor`, chamado no `peer-left`).
  - `drop(surfaceId)`: some quando a tela para (mesmo padrão de
    `annotate.drop`).
- Reexporta `TTL_MS` (1000) e `EMIT_HZ` (24, meio da faixa 20–30 pedida).

### 4.2 `src/renderer/reactions.js` (novo)

- `REACTIONS = ['👍','😂','😮','🔥','👏','❤️']` (fonte única; `signaling-core.js`
  espelha o mesmo array, documentado como tal).
- `isValidEmoji(e)`: `REACTIONS.includes(e)`.
- `createBurstLimiter({ capacity = 5, refillMs = 300 } = {})`: token bucket
  puro, com `hit(now)` que devolve `true`/`false` — usado no SERVIDOR (a
  cota real) e também no CLIENTE (freio antes de mandar, pra não depender só
  do servidor descartar em silêncio). Testado com relógio fake:
  rajada de 5 imediatas passa, a 6ª na mesma janela falha, e uma ficha nova
  libera a cada `refillMs`.
- `createStore()`: lista de "bolhas" vivas por superfície —
  `{ id, surfaceId, from, emoji, ts }`. `apply` valida emoji contra
  `REACTIONS` e empurra; `active(surfaceId, now, ttlMs = 1400)` devolve as
  que ainda não expiraram (pra quem desenha saber o que remover do DOM);
  `prune(now)` limpa as expiradas de TODAS as superfícies (chamado num
  `setInterval`/`requestAnimationFrame` leve do `ui.js`).
- `TTL_MS = 1400` (sobe + desaparece — ver CSS na seção 6).

Os dois arquivos seguem o IIFE padrão do repo
(`root.GoLive.laser`/`root.GoLive.reactions`, `module.exports` no fim) e
ganham `<script>` em `index.html` **antes** de `app.js` — `laser.js`/
`reactions.js` logo depois de `annotate.js`, já que os três formam o mesmo
grupo (anotação na tela).

## 5. UI — `ui.js`

### 5.1 Laser: terceira ferramenta da barra existente

`annotTool` passa a aceitar `'laser'` além de `'pen'`/`'text'`. Na
`tile-annot-bar` (`syncAnnotBar`), um terceiro botão:
```html
<button ... data-tool="laser" title="Laser" aria-label="Laser">${ANNOT_TOOLS.laser}</button>
```
(ícone novo, um alvo/ponto — SVG inline no mesmo estilo `stroke=currentColor`
dos outros).

Em `wireTileAnnotations`, o `pointermove` do canvas ganha um ramo: quando
`annotTool === 'laser'` E o tile está com `annot-on`, calcula o ponto
normalizado (mesma `pointOf`/`contentRect` de sempre) e, se
`laser.shouldEmit(lastSentAt, now, EMIT_HZ)`, chama `onLaserOp?.(surfaceId,
{x, y})` — SÓ manda, não desenha local (ver seção 1: o próprio cursor da
pessoa já mostra onde ela está apontando; desenhar de novo seria redundante
só pra quem está apontando). `pointerleave`/`pointerup` não precisam
mandar nada — o apagar é por tempo, não por evento (seção 1).

O `pointerdown` continua só relevante pra `pen`/`text` (`if (annotTool ===
'laser') return;` bem no topo do handler — sem começar traço nenhum).

Recepção: `case 'laser'` em `app.js` chama `ui.laser.apply(surfaceId, from,
{x, y})`; `ui.js` expõe isso chamando `laserStore.apply` e marcando o tile
pra redesenhar no próximo quadro (mesmo `requestAnimationFrame` coalescido
que o `redrawAnnot` já usa — o desenho do laser entra no MESMO
`redrawAnnot`/`ctx` do `tile-annot-canvas`, não um canvas novo: menos DOM,
e "rabisco" e "laser" já competem pelo mesmo espaço visual da tela).
Como o ponto some sozinho por idade (não por evento), `ui.js` também
agenda um `requestAnimationFrame` contínuo e barato enquanto existir pelo
menos um ponto de laser vivo em qualquer tile (pra o rastro desbotar mesmo
sem nenhum pacote novo chegando) — para sozinho quando `laserStore.active`
fica vazio, sem *setInterval* correndo pra sempre em sala parada.

### 5.2 Reação: barra nova no hover do tile

Novo elemento no `innerHTML` do tile (`showTile`), ao lado de
`tile-annot-bar`:
```html
<div class="tile-react-bar" role="group" aria-label="Reagir a esta tela">
  <button type="button" data-emoji="👍" aria-label="Reagir com like">👍</button>
  ... (as 6)
</div>
```
Visível só no `:hover`/`:focus-within` do tile (CSS, sem JS de show/hide —
mesmo espírito do resto da UI que já reage a hover). Existe em TODO tile
(inclusive `me`/`cam-me` — reagir à própria prévia é inofensivo e mantém uma
regra só, sem exceção por id) — mas só é alcançável com mouse sobre aquele
tile especificamente, então na prática ninguém reage à toa à própria tela.

Clique: `onReactionOp?.(surfaceId, emoji)` (sempre — SEM checar `canDraw` ou
`allowed`: reação no tile não pede permissão nenhuma, seção 2) E aplica
local na hora (`reactionsStore.apply(surfaceId, meuId, emoji, now)`) pra
quem clicou já ver a própria reação subir sem esperar o servidor (mesmo
padrão de `applyLocalAnnot` pro próprio traço).

Renderização: um `<div class="tile-react-pop">👍</div>` absoluto sobre o
tile, animação CSS (`@keyframes tile-react-rise`), removido do DOM quando a
animação termina (`animationend`) OU, se `prefers-reduced-motion`, num
`setTimeout` curto (a animação reduzida não sobe, só aparece/some — sem
`animationend` de subida pra escutar). Várias reações simultâneas empilham
(cada clique cria um elemento novo, independente).

### 5.3 API nova exposta por `ui.js`

```js
laser: { apply: applyRemoteLaser, dropAuthor: laserDropAuthor, drop: laserDrop },
reactions: { apply: applyRemoteReaction },
```
ao lado do bloco `annotations` que já existe (mesmo objeto `ui` devolvido no
fim do módulo).

## 6. CSS — bloco novo no fim de `style.css`

Cabeçalho de frente, como o brief pede. Sem `backdrop-filter`, sem `--live`
usado pra isso (cor é a da pessoa, `--act` só no botão de reagir se precisar
de destaque neutro de hover). Pontos:

- `.tile-react-bar`: fileira de 6 botões, `opacity: 0` por padrão,
  `opacity: 1` em `.tile:hover &`/`.tile:focus-within &` (mesmo padrão de
  "sai da frente do vídeo" que a interface já usa). Emoji é CONTEÚDO — o
  botão continua com `aria-label`, mas o emoji em si não vira `<svg>`.
- `.tile-react-pop`: `position: absolute`, `font-size` grande o bastante pra
  ler à distância, `pointer-events: none` (não pode atrapalhar clique no
  vídeo).
- `@keyframes tile-react-rise`: opacity 0→1→0 + `translateY` de baixo pra
  cima, ~1.4s, curva de saída suave.
- `@media (prefers-reduced-motion: reduce)`: a keyframe de subida é
  substituída por uma sem `translateY` — só aparece e some (regra explícita
  do brief).
- Cor do ponto/rastro do laser: `currentColor` setado via `style="color:
  ...”` inline pelo canvas (é `<canvas>`, não CSS) — sem token novo aqui,
  reaproveita a MESMA paleta de `annotate.PALETTE`/`colorFor`, sem
  `--live`.

## 7. Overlay na tela real — `main.js` / `overlay.js` / `preload-overlay.js`

Reaproveita a janela e o pipeline que já existe (`overlayWin`,
`createOverlayWindow`, `setContentProtection`, `sendToOverlay`). Dois canais
NOVOS e pequenos no lugar de reusar `overlay:op` (que hoje carrega só ops de
`annotate` com semântica de "lousa persistente" — misturar laser/reação
nesse canal obrigaria o `overlay.js` a distinguir tipos dentro de um canal
pensado pra outra coisa; dois canais dedicados mantêm cada lado simples):

- `overlay:fx` (novo, `ipcMain.handle`/`sendToOverlay`, mesmo padrão de
  `overlay:op`) — payload `{ kind: 'laser'|'reaction', surface, from, ...op
  }`. `app.js` só chama isso quando `surface` é a MINHA tela (mesma checagem
  que `pushToAnnotOverlay` já faz) E `shareAnnotations` está ligado (seção
  2) — o `overlay.js` recebe já filtrado, não recebe nada que não deveria
  desenhar (mesma responsabilidade que o app já tem hoje pro rabisco: o
  overlay é "burro", só desenha o que chega).
- `overlay.js` ganha os mesmos dois módulos puros (`laser.js`/`reactions.js`
  carregados por `<script>` em `overlay.html`, ANTES de `overlay.js`,
  igual `annotate.js` já é) e um `store` de cada, do mesmo jeito que já tem
  um `store` de anotação — desenha no MESMO canvas `#lousa`, no mesmo
  `redraw()` coalescido (mais um bloco no loop `for (const item of
  store.items(...))`, mais dois loops pequenos pros pontos de laser e
  reações vivos, cada um limpo pela própria idade).
- `preload-overlay.js` ganha `onFx: (callback) =>
  ipcRenderer.on('overlay:fx', ...)`, espelho de `onOp`.

Nenhuma mudança em `setContentProtection`/`setAlwaysOnTop`/`click-through` —
a janela já é a certa, só ganha mais uma coisa pra desenhar.

## 8. `app.js` — fiação mínima

- Import: `laser`, `reactions` na desestruturação do topo (mesma linha que
  já traz `annotate`, `screenrelay`, etc).
- `case 'laser':` no switch de mensagens — chama `ui.laser.apply(msg.surface,
  msg.from, msg)` e, se a superfície é a minha tela e `shareAnnotations`,
  `pushToOverlayFx('laser', msg.surface, msg.from, { x: msg.x, y: msg.y })`
  (função nova, espelho pequeno de `pushToAnnotOverlay`).
- `case 'reaction':` idem, chamando `ui.reactions.apply(...)` e o mesmo
  `pushToOverlayFx('reaction', ...)`.
- `onLaserOp`/`onReactionOp` passados pro `ui.grid(...)` (o objeto de
  callbacks que `wireTileAnnotations` já recebe) mandam
  `currentSession?.sig.send({ type: 'laser'|'reaction', surface, ... })` —
  mesmíssimo padrão do `onAnnotOp` existente.
- `peer-left`: ao lado de `ui.annotations.forgetAuthor(peerId)`, chama
  `ui.laser.dropAuthor(peerId)` (reações não precisam — já somem sozinhas em
  1.4s, e não há "traço" pra ficar órfão, só bolhas mortas rápido; ver seção
  3.3).
- Ao parar de compartilhar/trocar de tela: junto de `ui.annotations.setSurface('me',
  {allowed:false})`, chama `ui.laser.drop(minhaTela)` (reação de novo não
  precisa, mesmo motivo).

## 9. O que fica de fora (por escopo, não por dúvida)

- Histórico de reações/laser no chat — o brief é explícito: nada disso é
  persistido nem vai pro histórico.
- Laser/reação na câmera aparecendo em algum "overlay" — câmera não tem tela
  real pra sobrepor; o endereçamento por `kind` já cobre o tile, e o overlay
  simplesmente nunca reage a `kind !== 'screen'`.
- Configuração de quais 6 emojis aparecem (lista fixa, decisão de produto
  fora deste escopo).
- Teclado (segurar tecla pra ativar laser): decidido pela ferramenta na
  barra (seção 5.1) em vez de atalho de teclado — o tile já tem o padrão
  "ferramenta escolhida na barra + toggle liga/desliga" pra Caneta/Escrever,
  e um atalho de teclado novo precisaria de uma tecla que não colida com
  nada do app (não auditado aqui) e não teria equivalente por toque/trackpad
  quando o app rodar em tela sensível ao toque no futuro.

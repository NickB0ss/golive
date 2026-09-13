# Ponteiro laser e reações rápidas — plano de implementação

Spec: `docs/superpowers/specs/2026-09-12-laser-e-reacoes-design.md`. Branch
`feat/laser-e-reacoes`, worktree próprio. Base: `main` em `d356223`
(581 testes, lint 0 erros/9 avisos).

Regras globais (do `BRIEF-COMUM.md`, valem pra toda tarefa abaixo):
comentário de código em português SEM acento (texto de UI COM acento);
`node --test` ao lado do módulo; módulo novo do renderer no formato IIFE +
`<script>` antes de `app.js`; `app.js` sem teste próprio; nenhuma dependência
nova; mudança mínima e localizada nos arquivos disputados
(`app.js`/`ui.js`/`index.html`/`style.css`/`main.js`/`preload.js`/
`server/signaling-core.js`); CSS novo só em bloco no fim do arquivo com
comentário de cabeçalho; validação por tipo/campo no servidor, sem coerção
arbitrária, erro contido, limite de tamanho (P1 da avaliação).

## Tarefa 1 — `src/renderer/laser.js` + teste

Módulo puro: `shouldEmit(lastSentAt, now, hz)`, `createStore()` com `apply`,
`active(now, ttlMs)`, `dropAuthor`, `drop`, constantes `TTL_MS`/`EMIT_HZ`.
Sem DOM. Ver spec, seção 4.1.

Testes (`laser.test.js`): `shouldEmit` respeita o intervalo (não emite antes
da hora, emite depois); `apply` rejeita x/y fora de 0..1 ou não finitos;
`active` devolve só os pontos com `now - ts < ttlMs`, com `age` correto;
`dropAuthor` remove só do autor certo, em todas as superfícies;
`drop(surfaceId)` some com a superfície inteira.

Critério de pronto: `node --test src/renderer/laser.test.js` verde.

## Tarefa 2 — `src/renderer/reactions.js` + teste

Módulo puro: `REACTIONS` (array fechado de 6 emojis), `isValidEmoji`,
`createBurstLimiter({capacity, refillMs})` (token bucket com `hit(now)`),
`createStore()` com `apply`/`active(surfaceId, now, ttlMs)`/`prune(now)`,
`TTL_MS`. Sem DOM. Ver spec, seção 4.2.

Testes (`reactions.test.js`): `isValidEmoji` aceita só os 6, rejeita string
fora da lista/objeto/vazio; `createBurstLimiter` deixa passar a rajada de 5,
recusa a 6ª na mesma janela, libera 1 nova a cada `refillMs` (relógio fake);
`apply` rejeita emoji inválido; `active` expira pelo TTL; `prune` limpa
várias superfícies de uma vez.

Critério de pronto: `node --test src/renderer/reactions.test.js` verde.

**Tarefas 1 e 2 podem ir pro Codex (`gpt-5.6-terra`, `medium`) numa mesma
leva** — são módulos isolados, sem tocar em arquivo disputado, com a
especificação inteira na seção 4 da spec. Prompt autocontido: colar a seção
4 da spec, os trechos relevantes de `annotate.js` (pra copiar o estilo de
`isNorm`/`round3`/IIFE) e o pedido explícito de rodar `node --test` nos dois
arquivos novos e reportar a saída.

## Tarefa 3 — `server/signaling-core.js`: `laser` e `reaction`

Dentro de `createSignalingServer`, ao lado do `case 'annotate'`:

- `sanitizeLaserOp(msg)`: reaproveita `surfaceOwner`/`normPoint` já
  existentes no arquivo; devolve `{x, y}` ou `null`.
- `sanitizeReactionOp(msg)`: novo array `REACTION_EMOJI` (espelho de
  `reactions.js`, comentário dizendo isso); devolve `{emoji}` ou `null`.
- `case 'laser'`: checa peer existe, resolve `surfaceOwner(msg.surface)` na
  MESMA sala, rate limit `laserLimiters` (`createRateLimiter({limit:30,
  windowMs:1000})`), sanitiza, `broadcastToRoom(me.room, peerId, {...op,
  type:'laser', surface: String(msg.surface), from: peerId})`.
- `case 'reaction'`: mesma forma, com `createBurstLimiter`-equivalente — ver
  decisão da spec 3.2: implementar um pequeno `createBurstLimiter` local no
  próprio `signaling-core.js` (função pura, do tamanho de
  `createRateLimiter`, testável isoladamente) OU, se ficar mais simples sem
  duplicar, aproximar com `createRateLimiter({limit:5, windowMs:1500})` —
  **decisão final na implementação**, documentando no comentário por que
  (ver spec 3.2, a aproximação por janela fixa é aceitável e mais barata).
  `reactionLimiters` é cota PRÓPRIA, separada de `laserLimiters`,
  `annotateLimiters`, `chatRateLimiters` etc.
- Limpar `laserLimiters`/`reactionLimiters` nos MESMOS pontos onde
  `annotateLimiters.delete(peerId)` já roda (saída normal e depois de
  retomada — ver linhas 462 e 633 do arquivo atual).

Testes em `signaling-core.test.js`, ao lado dos testes de `annotate`
existentes (copiar a forma: `once(ws, type)`, conectar dois/três peers):

- `laser`: repassa pra sala com `from` carimbado, MENOS pra quem mandou
  (mesmo teste que `annotate` já tem, adaptado).
- `laser`: superfície que não existe na sala é descartada em silêncio.
- `laser`: x/y fora de 0..1 (ou string, ou ausente) descarta a mensagem
  inteira, socket continua aberto.
- `laser`: estourar 30/s não fecha o socket, só some em silêncio depois do
  teto (mesmo padrão do teste de `annotate` estourando cota).
- `reaction`: repassa pra sala com `from` carimbado, menos pra quem mandou.
- `reaction`: emoji fora da lista fechada é descartado (mensagem inteira,
  não "corrigido" pro mais próximo).
- `reaction`: rajada de 5 passa, a 6ª na mesma janela é descartada; depois
  de esperar o refil (usar `windowMs`/`refillMs` pequeno no teste, ou mockar
  o relógio se o limiter aceitar `now` explícito), uma nova reação passa.
- Ambos: mensagem sem `join` prévio (peer não numa sala) é descartada sem
  lançar (mesmo padrão do resto do arquivo — nenhum handler novo pode ser o
  que finalmente derruba o processo com uma exceção não tratada, é
  literalmente o P1 da avaliação de lançamento).

Critério de pronto: `node --test server/signaling-core.test.js` verde,
incluindo os testes novos.

**Tarefa 3 vai pro Codex** (`gpt-5.6-terra`, primeiro `high` só pra revisar o
formato exato de `sanitizeLaserOp`/`sanitizeReactionOp`/rate limit contra os
requisitos de validação do P1 antes de implementar, depois `medium` pra
escrever o código e os testes) — arquivo disputado, então **revisar o diff
inteiro** antes de aceitar (nenhuma linha fora do escopo de `laser`/
`reaction`, nenhum `case` existente tocado).

## Tarefa 4 — `ui.js`: ferramenta laser + barra de reação + render

Feito por mim (Claude), não pelo Codex — é a parte mais entrelaçada com
estado existente (`annotTool`, `wireTileAnnotations`, `redrawAnnot`,
`showTile`) em arquivo disputado, onde um erro de integração é caro.

1. `ANNOT_TOOLS.laser` (ícone SVG novo).
2. `annotTool` aceita `'laser'`; botão novo em `syncAnnotBar`.
3. `wireTileAnnotations`: `pointerdown` ignora quando `annotTool==='laser'`;
   `pointermove` ganha o ramo de laser (throttle via `laser.shouldEmit`,
   chama `onLaserOp`, NÃO desenha local — ver spec 5.1).
4. `redrawAnnot` (ou uma função irmã) desenha os pontos de laser vivos do
   `laserStore` no MESMO `tile-annot-canvas`, com o `age` decidindo raio/
   opacidade do rastro.
5. Loop de repintura: enquanto `laserStore` tiver pontos vivos em algum
   tile, um `requestAnimationFrame` contínuo mantém o desbote fluindo; para
   sozinho quando esvaziar.
6. `tile-react-bar` no `innerHTML` de `showTile`; listener de clique chama
   `onReactionOp` + aplica local; `tile-react-pop` criado/removido por
   `animationend`/timeout (reduced motion).
7. API nova exposta: `ui.laser.{apply,dropAuthor,drop}`,
   `ui.reactions.apply`.

Critério de pronto: sem teste de `node --test` (é DOM/`app.js`-adjacente,
regra do brief) — validado por `npm run lint` limpo e pelo roteiro manual da
Tarefa 7.

## Tarefa 5 — `app.js`: fiação de rede

Feito por mim. `case 'laser'`/`case 'reaction'` no switch de mensagens,
`onLaserOp`/`onReactionOp` mandando pra rede, `pushToOverlayFx` (espelho
pequeno de `pushToAnnotOverlay`), limpeza em `peer-left` e ao parar de
compartilhar (ver spec, seção 8).

## Tarefa 6 — Overlay real: `main.js` + `preload-overlay.js` + `overlay.js`/`overlay.html`

Feito por mim (`main.js` e `preload.js`/`preload-overlay.js` são
disputados). Canal `overlay:fx` (handler em `main.js`, exposto em
`preload-overlay.js` como `onFx`), scripts `laser.js`/`reactions.js` em
`overlay.html`, `overlay.js` ganha os dois `store`s e desenha no mesmo
`redraw()`.

## Tarefa 7 — CSS

Bloco novo no fim de `style.css`, cabeçalho "Laser e reações (frente
interação, 2026-09-12)". `.tile-react-bar`, `.tile-react-pop`, `@keyframes
tile-react-rise` (+ variante reduced-motion). Ícone do laser não precisa de
CSS novo (reaproveita `.annot-tool`). Nenhuma cor crua fora de `:root` —
tudo por `var(--...)` existente ou `currentColor` vindo do canvas.

**Pode ir pro Codex** (`gpt-5.6-luna`, `medium`) — mecânico, isolado no fim
do arquivo, com a seção 6 da spec como especificação completa. Revisar que
não invadiu nenhuma regra de tema (nada de `#fff`/`rgba` cru fora de
`:root`, nada de `--live` fora do sentido "ao vivo", zero
`backdrop-filter`).

## Tarefa 8 — validação final

1. `npm test` no worktree — tem que continuar em 581 + os testes novos
   (laser + reactions + signaling-core), TODOS passando.
2. `npm run lint` — 0 erros; não pode introduzir aviso novo além dos 9 já
   existentes na base (ou, se introduzir, investigar e não simplesmente
   ignorar).
3. Ler a saída de verdade antes de reportar sucesso.

## Tarefa 9 — relatório final

Formato do `BRIEF-COMUM.md`: o que foi feito, arquivos tocados (marcando os
disputados), números de teste/lint, roteiro de teste manual com 2 PCs
(incluindo tela real com jogo por cima — ponto explícito pedido no prompt do
time), riscos/limitações, mudanças de protocolo (tipos `laser` e `reaction`,
campos, rate limits).

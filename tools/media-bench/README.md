# media-bench: bancada de captura, encode e relay (Windows)

Mede, no mesmo PC e em loopback, o que o app faz com video: quantos quadros o
encoder entrega, quanto custa cada quadro, quanta CPU o app usa e o que chega
ao espectador. Compara quatro caminhos de envio com 1 e 4 espectadores. Fica em
`tools/`, fora do instalador, e **nao e** o bootstrap do app.

```
node tools/media-bench/run.js --help
npm run bench:media:quick          # 8 cenarios em ~40 s
npm run bench:media -- --list      # mostra o que rodaria, sem abrir o Electron
```

## O que roda

| id | pipeline | contentHint | topologia |
|----|----------|-------------|-----------|
| `direct-nohint` | direta (a track da fonte vai ao sender) | nenhum | p2p |
| `direct-motion` | direta | `motion` | p2p |
| `canvas-motion` | `src/renderer/screenrelay.js` de producao (Processor -> canvas -> `captureStream(0)`) | `motion` | p2p |
| `relay-motion` | canvas, como no app | `motion` | origem -> **relay** -> espectadores |

Cada cenario roda com 1 e 4 espectadores (`--viewers=N,N`). Todo cenario cria
**senders novos**; nada e reaproveitado entre cenarios.

- **p2p**: um `RTCPeerConnection` de envio por espectador (como o mesh do app sem arvore).
- **relay**: a origem envia **uma vez** a um no intermediario; ele **recebe, decodifica e
  reenvia** a track recebida por senders novos, um por espectador (decode + encode de
  verdade, como `mesh.relayTo`, que tambem reaplica `contentHint='motion'`). A origem
  nunca e enviada duas vezes.
- Sem STUN/TURN: `iceServers` vazio, so candidatos host em loopback. O relatorio grava o
  tipo do par escolhido (`candidates`) e avisa se aparecer `srflx`/`relay`.
- Reutiliza `txstats.js`, `rxstats.js` e `screenrelay.js` de producao (carregados do
  `src/renderer/`, nao copiados) e `runtime-info.js`/`chromiumflags.js` do main.

## Fontes

- `--source=synthetic` (padrao): cena animada **deterministica** num canvas
  (`shared/scene-math.js`). **Nao e captura WGC real.**
- `--source=owned-window --allow-own-window-capture`: captura via `getDisplayMedia` a
  janela **criada pela propria bancada** (mesma cena, sem moldura, mostrada sem foco, com a
  resolucao e o fps do cenario: `--width/--height/--fps`; a janela e limitada a area de
  trabalho do monitor e pede `pixels/escala` DIP para capturar os pixels pedidos). O relatorio
  grava `source.requested`, `source.measured` (`track.getSettings()`), `source.ownedWindow`
  (tamanho efetivo) e uma `note` quando a resolucao/fps medidos diferem do pedido. O main
  so autoriza o pedido se vier da pagina da bancada, armado por ela, com video e sem
  audio, e entrega EXATAMENTE `ownedWindow.getMediaSourceId()` (conferido de novo depois
  do `await` de `desktopCapturer`). Nunca usa `sources[0]`, tela, outras janelas ou
  microfone. E opt-in: sem `--allow-own-window-capture` o launcher recusa (codigo 3).
  **Este modo nao roda automaticamente nem em CI**; quem for medir deve executa-lo de
  proposito:

  ```
  node tools/media-bench/run.js --source=owned-window --allow-own-window-capture --label=janela
  ```

  E o unico modo em que o getStats expoe `encoderImplementation`,
  `powerEfficientEncoder` e `decoderImplementation` (veja Limites).

## Rodar em outros PCs

A bancada mede UM PC por vez; para comparar maquinas, rode a mesma sequencia em cada uma e
junte os JSON.

Pre-requisitos em cada PC (Windows): Node 20+ e o repositorio clonado (mesmo commit), depois
`npm ci` (instala o Electron). O addon nativo (`build/Release`) **nao e necessario**. Feche
jogos e outros apps pesados e deixe o PC na tomada.

Sequencia (de dentro da pasta do repositorio; `<pc>` = nome curto da maquina, ex. `notebook`):

```
node tools/media-bench/run.js --list                         # confere o plano, nao abre o Electron
node tools/media-bench/run.js --label=<pc>-sintetico          # padrao: 1920x1080@60, 3 s + 15 s de medida
node tools/media-bench/run.js --label=<pc>-sintetico          # repita (3 execucoes) para ver a variacao
node tools/media-bench/run.js --source=owned-window --allow-own-window-capture --label=<pc>-janela
node tools/media-bench/run.js --source=owned-window --allow-own-window-capture --label=<pc>-janela
```

- Use o **padrao** (15 s de medida) e repita cada modo ao menos 3 vezes; `--quick` so
  serve de teste rapido e e ruidoso. Cada execucao completa leva cerca de 6 min.
- O modo `owned-window` abre uma janela propria da bancada (e captura so ela); rode-o com a
  tela livre e sem mexer no PC. Ele e o unico que mostra o encoder usado (veja Limites).
- Cada execucao grava um arquivo em `lab-out/media-bench/` (`media-bench-<UTC>-<rotulo>.json`).
  Copie os JSON de todos os PCs para uma pasta so (nao fazem parte do git).

O que comparar entre PCs/execucoes (campos do JSON):

- `runtime.gpuFeatureStatus` (e `runtime.gpuInfo`, `runtime.cpu`, `runtime.os`): diz se o PC
  tem codificacao de video por GPU habilitada; e so uma dica do ambiente.
- `scenarios[].roles.*.encoders` / `decoders` (so aparecem no `owned-window`): qual
  implementacao o Chromium escolheu (OpenH264 = software; outras = hardware).
- `scenarios[].roles.origin-sender` / `relay-sender`: `msPerFrameMedian` (custo do encode por
  quadro), `fpsMedian`, `mbpsMeanTotal`, `resolutions`.
- `scenarios[].roles.viewer-receiver`: `fpsMedian` e `bufferMsMedian` (o que chega).
- `scenarios[].cpu` (CPU so dos processos do Electron) e `status`/`problems`/`notes`.

Compare so execucoes do mesmo modo, do mesmo cenario (`key`) e do mesmo commit/`runtime.electron`.

## Relatorio

`lab-out/media-bench/media-bench-<UTC>[-rotulo].json` (pasta ignorada no git, `--out`
muda). Schema `golive-media-bench/1`:

- `status`: `ok`, `partial` (algum cenario falhou), `error`, `timeout`;
- `runtime` (Electron/Chrome/Node/SO/CPU/`gpuFeatureStatus`/`gpuInfo`), `flags` (efetivas),
  `profile` (perfil temporario, lock nao tomado), `limitations`;
- `scenarios[]`: `config`, `source` (hint pedido x efetivo, quadros desenhados/relay),
  `topology.rtpSenders`, `nodes[]` (resumo por sender/receiver: fps, ms/quadro, Mbps, RTT
  de transporte, encoder/decoder, resolucao, codec, perdas, congelamentos), `roles`
  (agregado por papel: `origin-sender`, `relay-receiver`, `relay-sender`, `viewer-receiver`),
  `cpu` (processos do Electron), `problems`/`notes`, e `raw` (cada amostra de cada no mais
  o getStats filtrado do ultimo tick, para auditar os numeros).

Codigos de saida: `0` ok, `1` falha de cenario ou runtime, `2` timeout, `3` uso invalido.
Falha parcial grava o relatorio mesmo assim; o perfil temporario e removido sempre; o
launcher mata a arvore de processos no timeout, em SIGINT e em SIGTERM.

## Como ler os numeros

Medido por **delta entre amostras** (nunca media desde o inicio). Contador que anda pra
tras (reinicio) vira `null` na janela, nunca zero. Campo ausente e `null`.

- `fps` do sender = `framesEncoded`/dt; do receiver = `framesDecoded`/dt.
- `msPerFrame` = delta `totalEncodeTime` / delta `framesEncoded`; `decodeMsPerFrame` idem.
- `bufferMs` = espera recente do jitter buffer (delta), nao latencia ponta a ponta.
- `rttMs` e o RTT do transporte ICE, **nao** a latencia do video.
- `rtpSenders` conta `RTCRtpSender` de video; **nao e** a contagem de sessoes de encoder
  de hardware (o Chromium nao expoe esse numero; o limite de sessoes NVENC so se
  descobre no sintoma).
- CPU vem de `app.getAppMetrics()` (so processos do Electron; nao ve o encoder de hardware
  nem o resto da maquina; unidade do Electron, 100 = um nucleo).

## Limites

1. Sintetico != captura real. O defeito que motivou o `screenrelay` (track de **captura**
   + `motion` cai no OpenH264) nao se reproduz com uma track de canvas; aqui `direct-motion`
   e `direct-nohint` tendem a empatar. Para medir esse efeito use `owned-window` (WGC de
   verdade) e depois uma maquina com jogo.
2. Sem captura ativa, o Chromium **omite** `encoderImplementation`, `powerEfficientEncoder`
   e `decoderImplementation` do getStats (medido no Electron 44.4.3, mesmo com a pagina
   isolada por COOP/COEP e com a consulta de permissao `media` respondida sim). No modo
   sintetico esses campos ficam vazios e o relatorio diz `encoder/decoder desconhecidos`
   (nao e "software"). `gpuFeatureStatus.video_encode` e so uma dica do ambiente.
3. Loopback no mesmo processo: sem perda, jitter nem banda reais. Um PC so.
4. Janelas curtas (`--quick`) sao ruidosas: o controle de banda pode baixar a resolucao no
   meio da medida (`resolutions` mostra a ultima). Para comparar de verdade use os padroes
   (15 s de medida) e repita.
5. A janela escondida nao muda o resultado de timers (a pagina usa
   `backgroundThrottling: false` e as mesmas flags `disable-*-throttling` do app).

## Estrutura

```
run.js                 launcher Node: valida, grava o plano, abre o Electron, espera, limpa
main.js                main Electron proprio: perfil temporario, flags de producao, politica de sessao
preload.js             contextBridge minimo (getPlan, armCapture, scenarioStart/Done, log, finish)
lib/                   Node puro: config (args, limites, matriz), cpu, report, launch, flags, capture-guard
shared/                UMD (Node e navegador): metrics (leitura/contas de getStats), scene-math
renderer/              pagina: scene, source, topology, sampler, scenario, boot (+ janela de origem)
```

## Contrato para reutilizar (SFU e outras topologias)

- Plano: `{ scenarios: [{ key, id, label, config }], timeoutMs }`, `config` validado por
  `lib/config.js#validateConfig` (`topology` e uma lista fechada; uma `sfu` entra la).
- Uma topologia e `async build(cfg, sourceTrack) -> { nodes, rtpSenders, close }` em
  `renderer/topology.js`, onde `nodes[i] = { role, label, kind: 'sender'|'receiver', pc }`.
  Se o novo no entregar `RTCPeerConnection`s e esses papeis, `sampler`, `metrics`, relatorio
  e CPU funcionam sem alteracao.
- `shared/metrics.js` expoe `readSender/readReceiver/senderWindow/receiverWindow/stat/
  summarizeNode/summarizeRoles/evaluateScenario`; todos puros e testados em Node.
- `renderer/source.js#create(cfg, { arm })` devolve `{ track, effectiveHint, stats, stop }`.

## Testes

`node --test "tools/media-bench/**/*.test.js"` (config, metricas, relatorio, CPU, guarda de
captura, tamanho da janela propria, argumentos internos, flags, paginas HTML, launcher). Nenhum deles abre o Electron.

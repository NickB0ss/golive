# Qualidade adaptativa por destinatário — design

**Goal:** fazer a degradação de qualidade valer **por conexão**, não pela sala
inteira. Um espectador com CPU fraca, link ruim ou os dois passa a receber um
preset menor **sozinho**, enquanto os demais ficam no piso. O critério é o
"menor pior caso": minimizar quantas pessoas ficam abaixo do que a máquina e o
link delas aguentam.

**Architecture:** toda lógica nova nasce em módulo puro do renderer
(`rxstats.js` ganha uma função, `peerquality.js` é novo, um helper puro de
`scaleResolutionDownBy`), com teste em `node --test`; `app.js` só fia. A
adaptação fecha dentro do `updateStats` que já roda a cada segundo, do mesmo
jeito que a escada global da branch "transmissão honesta" (Task 2): cada
conexão de saída ganha sua própria escada de histerese, cuja saída entra em
`setParameters`/`scaleResolutionDownBy` — sem renegociação, sem tela preta.
Nenhuma dependência nova. Nenhuma mudança de topologia: a malha e a árvore de
retransmissão ficam como estão.

**Tech Stack:** Electron 32, JavaScript sem build step, WebRTC do Chromium,
`node --test`, zero dependências novas.

## Contexto

A branch `feat/transmissao-honesta` (13 commits, 176 testes, aguardando
verificação manual) fechou o laço de qualidade **global**: a escada da Task 2
desce o preset quando a **nossa** saúde de encode — ou a de um relay — piora, e
a Task 5 passou a ler as estatísticas do lado de quem recebe (`rxstats.js`,
tabela "Recebendo"). Mas a saída dessa escada é um preset só, aplicado a todas
as conexões por `reapplyAudienceQuality()`.

Consequência para os três casos que o dono do projeto levantou:

1. **Espectador com CPU fraca** (decode em software, engasga): hoje não há
   adaptação nenhuma para ele — sofre calado.
2. **Espectador com link ruim**: o congestion control do Chromium já baixa o
   bitrate **daquela** conexão sozinho, mas a resolução e o framerate seguem
   altos, então o resultado é um 1080p esburacado em vez de um 720p limpo.
3. **Relay fraco derruba a sala inteira**: a Task 2 funde a saúde do relay na
   escada **global**, então quando é o relay que sofre — não a origem — os
   espectadores diretos da origem caem junto, sem precisar.

Este design ataca os três sem SFU. A discussão do SFU (peer forte da sala roda
um servidor de mídia de verdade, origem faz simulcast) fica registrada como o
próximo degrau **se**, depois disto, o caso 4 — quem transmite ainda trava com
a árvore — continuar mordendo, ou as salas passarem de 4 pessoas. Ver
`Decisões/golive - árvore de retransmissão em vez de SFU no host` (o gatilho de
"salas de 5+ com host de upload gordo" já está escrito lá).

## Relação com a branch parqueada

`feat/orcamento-banda-relay` já tem `config.qualityForRelay(preset, filhos,
availableBps)` — o relay re-codifica por filho respeitando o uplink. Esse
trabalho é **complementar** e deve ser mesclado antes ou junto: `qualityForRelay`
resolve "quanto o relay pode subir no total", este design resolve "qual filho
recebe qual preset". Onde os dois se encontram (`flushPendingRelay`,
`relayTo`), o preset por filho é o **menor** entre os dois cálculos.

## Global Constraints

Valem para todas as tarefas. Um reviewer deve tratar violação como defeito.

1. **Comentários em português, sem acentos**, no estilo do arquivo. Texto
   visível ao usuário (a tag do painel de membros) usa acentos.
2. **Testes com `node --test`**, arquivo ao lado do módulo, módulo termina com
   `if (typeof module !== 'undefined') module.exports = api;`.
3. **Nenhuma dependência npm nova.**
4. **`src/renderer/app.js` não tem testes.** Lógica testável vai em módulo
   puro; `app.js` apenas chama.
5. **Todo módulo novo do renderer** segue o IIFE dos existentes e ganha uma tag
   `<script>` em `index.html` **antes** de `app.js`.
6. **`npm test` passa inteiro.** A base é o estado de `feat/transmissao-honesta`
   mesclado (176 testes). Nenhum teste existente afrouxado ou deletado.
7. **Um commit por tarefa**, mensagem no estilo do repositório (`feat(escopo):`,
   em português, minúsculas depois do prefixo, sem acentos).
8. **A regra do tema é lei:** `--live` só significa "alguém ao vivo". A tag de
   preset por-peer é neutra (`--text-2`/`--surface-3`), não usa `--warn` nem
   `--live`. Sem `backdrop-filter`/blur.

## Os sinais

Cada conexão de saída é avaliada por três entradas booleanas. Duas saem das
estatísticas que o **próprio sender** já coleta por peer em `updateStats`; uma
é nova e chega pelo `view-state`.

| Entrada | Verdadeira quando | Fonte |
|---|---|---|
| `senderBandwidthLimited` | `qualityLimitationReason === 'bandwidth'` na `outbound-rtp` daquele peer naquela amostra (a escada ja debounce: exige 3 seguidas) | stats locais do sender — **sem feedback** |
| `viewerFreezing` | `freezeRate > 6` travadas/min **e** `lossPct < 2` (trava sem ser por perda de rede = decode nao acompanha) | `view-state.receiveHealth` (novo) |
| `viewerSoftwareDecode` | o espectador reporta `softwareDecoder: true` | `view-state.receiveHealth` (novo) |

`viewerFreezing` exige `lossPct` baixo de proposito: travar **por perda** já é
o caso 2, e o remédio é outro (o GCC já está agindo; só falta a resolução
seguir). Travar **sem** perda é o caso 1. Os limiares (`> 6`/min, `< 2`%) sao
constantes de `peerquality.LIMITS`, ajustaveis por `opts` no teste.

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/renderer/rxstats.js` | `+ receiveHealth(cur, prev, dtMs)` — deriva taxa de travadas (freezeCount e cumulativo), perda %, flag de decoder em software. Puro. | 1 |
| `src/renderer/peerquality.js` (novo) | escada de histerese **por peer**: `initialState`, `next(state, signals, opts)`, `LIMITS`. Puro. Mesma disciplina do `autoquality.js` (desce rapido, sobe devagar, teto). | 2 |
| `src/renderer/config.js` | `+ scaleFactorFor(captureWidth, targetWidth)` — helper puro pro `scaleResolutionDownBy`. | 3 |
| `src/renderer/mesh.js` | `+ applyEncodingToPeer(peerId, quality, kind)` — um `RTCRtpSender`, com `scaleResolutionDownBy`. | 3 |
| `src/renderer/app.js` | fiacao: `view-state` leva `receiveHealth`; guarda `peer.receiveHealth`; `Map peerQuality` tickado no `updateStats`; `qualityForPeer`; `reapplyAudienceQuality` itera peers; remove a fusao de saude de relay da escada global; relay usa `qualityForPeer` por filho. | 1,4,5 |
| `src/renderer/ui.js` | `+` tag de preset no `buildMemberRow` / `renderMembers`. | 6 |
| `src/renderer/index.html` | `<script src="peerquality.js">` antes de `app.js`. | 2 |
| `src/renderer/style.css` | `.member-quality-tag` neutra. | 6 |

## Componentes e interfaces

### `rxstats.receiveHealth(cur, prev, dtMs) -> { lossPct, freezeRate, softwareDecoder } | null`

Puro. `cur`/`prev` sao dois retornos de `readReceiverReport` da mesma conexao;
`dtMs` o intervalo entre eles. Devolve `null` quando `prev` e ausente ou nao
houve quadro decodificado no intervalo (ausencia nao e diagnostico). `freezeRate`
em travadas por minuto: `(cur.freezeCount - prev.freezeCount) / dtMs * 60000`.
`lossPct` da janela: `deltaLost / (deltaLost + deltaReceived) * 100`.

### `peerquality.next(state, signals, opts) -> state`

Puro, relogio via `signals.atMs`. `state = { steps, badRun, goodSinceMs }`,
identico em forma ao `autoquality`. `signals = { atMs, senderBandwidthLimited,
viewerFreezing, viewerSoftwareDecode }`. Politica:

- **ruim** = qualquer um dos tres booleanos. `BAD_SAMPLES_TO_DEGRADE` amostras
  ruins seguidas descem um degrau (`steps++`, ate `MAX_PEER_STEPS`).
- **folga** = os tres falsos. `GOOD_MS_TO_RECOVER` continuos sobem um degrau.
- Assimetrico pelo mesmo motivo do `autoquality`: descer e barato, subir cedo
  recria o regime que quebrou.

`LIMITS = { MAX_PEER_STEPS: 2, BAD_SAMPLES_TO_DEGRADE: 3, GOOD_MS_TO_RECOVER:
20000, FREEZE_PER_MIN: 6, LOSS_PCT_MAX: 2 }`. `MAX_PEER_STEPS` 2: a partir do piso global, dois degraus chegam num
preset que ainda serve pra assistir; abaixo disso o problema da pessoa e outro.
`GOOD_MS_TO_RECOVER` menor que os 30s do `autoquality` global (20s): a
recuperacao por-peer e menos arriscada — nao afeta a sala.

Nota de reuso: `peerquality.next` e `autoquality.next` sao quase iguais. A
decisao e manter separados — entradas diferentes (booleanos vs `health`),
limiares diferentes, e o `autoquality` tem o conceito de `worstHealth` que aqui
nao existe. Um reviewer que achar que devem fundir deve dizer, mas o custo de
fundir (um `isBad` parametrizado) provavelmente nao paga.

### `config.scaleFactorFor(captureWidth, targetWidth) -> number`

Puro. `captureWidth / targetWidth`, preso em `[1, 4]` e arredondado pra um
degrau util (1, 1.5, 2, 3, 4 — o Chromium aceita fracionario mas valores
"redondos" evitam artefato de reamostragem). `scaleResolutionDownBy` escala no
**encoder**, entao a captura continua paga inteira — o piso global e quem
controla a captura (via `applyConstraints`, Task 3 da branch anterior).

### `mesh.applyEncodingToPeer(peerId, quality, kind)`

Como `applyEncoding`, mas resolve uma conexao (`peers.get(peerId).outConns[kind]`).
Aplica `maxBitrate`, `maxFramerate` e
`encodings[0].scaleResolutionDownBy = scaleFactorFor(capturaW, quality.width)`.
`degradationPreference` fica como o `applyEncoding` ja deixa. Silenciosa em
falha (`setParameters().catch(() => {})`), igual as irmas.

### `app.js` — fiacao

- **`view-state` de saida**: onde hoje anexa `encodeHealth: myEncodeHealth`,
  anexa tambem `receiveHealth`, calculado no `updateStats` a partir do
  `rxstats.receiveHealth` da conexao de entrada correspondente (a Task 5 ja
  itera `receivingFrom()`; guardar o `prev` por `peerId:kind` pra derivar a
  taxa).
- **`view-state` recebido**: `peer.receiveHealth = normalize(msg.receiveHealth)`
  ao lado do `peer.encodeHealth` que ja e guardado.
- **`peerQuality`**: `Map<peerId, state>`. Inicializado no primeiro
  `view-state`/`peer-joined`, tickado uma vez por peer no fim do `updateStats`
  com os tres sinais, limpo no `peer-left` e zerado inteiro no `stopShare`
  (mesma regra do `autoQuality`: os degraus descrevem uma conexao, nao a
  maquina). Reusa `resetShareState()`.
- **`qualityForPeer(peerId, kind)`**: parte de `qualityFor(kind)` (o piso
  global) e aplica `peerQuality.get(peerId).steps` degraus adicionais via
  `config.degradePreset`. Nunca sobe acima do piso.
- **`reapplyAudienceQuality`**: passa a iterar `mesh.peers` e chamar
  `mesh.applyEncodingToPeer(peerId, qualityForPeer(peerId, kind), kind)` por
  conexao, em vez de um `applyEncoding` unico. O `applyConstraints` da captura
  (Task 3 anterior) continua guiado pelo **piso global** — captura e comum.
- **M3 — isolar o relay**: a escada global (`autoQuality`) para de fundir a
  saude de encode dos relays (remove `relayHealths` do
  `autoquality.worstHealth([...])` — volta a ser so `myEncodeHealth`). A saude
  ruim de um relay agora chega como `receiveHealth`/`encodeHealth` no
  `view-state` dele pra origem e degrada **so** a conexao origem->relay via
  `qualityForPeer`. O relay, sendo sender dos filhos, roda o mesmo laco
  por-peer pra eles.
- **relay -> filhos**: `flushPendingRelay` e `relayTo` recebem
  `qualityForPeer(childId, kind)` — o menor entre isso e o `qualityForRelay`
  da branch parqueada.

### UI — tag no painel de membros

Quando `peerQuality.get(peer.id).steps > 0`, a linha daquele membro ganha uma
tag pequena com `qualityForPeer(peer.id, 'screen').preset` — o preset efetivo
que estamos mandando pra ele (ex.: `720p30`).
Neutra — `--text-2` sobre `--surface-3`, sem `--warn`. So aparece pra quem
**transmite** (e a nossa decisao de encode); um espectador puro nunca ve tag
nos outros. `buildMemberRow` ganha um prop `qualityTag`; `renderMembers` recebe
do `renderMembersPanel` um `Map<peerId, string>` derivado de `peerQuality` +
`qualityForPeer`.

## Fluxo de dados

```
espectador:  updateStats -> readReceiverReport -> receiveHealth(cur, prev, dt)
             -> proximo view-state pro sender carrega receiveHealth

sender:      view-state recebido -> peer.receiveHealth guardado
             updateStats:
               - por peer: le outbound-rtp[peer].qualityLimitationReason
               - por peer: peerquality.next(state, { atMs,
                   senderBandwidthLimited, viewerFreezing, viewerSoftwareDecode })
               - se algum steps mudou -> reapplyAudienceQuality()
             reapplyAudienceQuality -> mesh.applyEncodingToPeer por conexao
               (setParameters + scaleResolutionDownBy, sem renegociacao)
             renderMembersPanel -> tag de preset nas linhas com steps > 0
```

## Testes

- **`rxstats.receiveHealth`** — `node --test`: derivacao de taxa,
  cumulativo->taxa, `null` sem `prev`, `null` sem quadro decodificado no
  intervalo, flag de decoder em software, perda da janela (nao acumulada).
- **`peerquality.js`** — `node --test`: histerese (3 ruins seguidas descem,
  uma boa no meio zera a corrida), teto em `MAX_PEER_STEPS`, folga continua de
  20s sobe um, uma ruim na espera cancela, sinal ausente nao conta como ruim,
  independencia entre peers (dois `state` separados nao se contaminam).
- **`config.scaleFactorFor`** — `node --test`: razao, preso em `[1,4]`,
  arredondamento pros degraus uteis, captura == alvo devolve 1.
- **Fiacao do `app.js`** — manual, 2+ maquinas, uma estrangulada (throttle de
  CPU no DevTools de um espectador, ou `tc`/Clumsy no link de outro): a linha
  dele no painel de membros ganha `720p30`, a resolucao que ele recebe cai, e
  a dos **outros** espectadores **nao** muda. Soltar o estrangulamento: sobe de
  volta em ~20s, uma vez.

## Fora deste plano (YAGNI)

- **SFU / simulcast / dependencia nova.** Proximo degrau, com gatilho ja
  escrito na nota de decisao.
- **Adaptacao de captura por conexao.** Impossivel — um capturador. Per-peer so
  desce a partir do piso, via `scaleResolutionDownBy` no encoder.
- **Feedback pro caso 2.** O sender ja ve `qualityLimitationReason` nas
  proprias stats; nao precisa o espectador dizer.
- **Reagir a `receiveHealth` na escada GLOBAL.** So o piso global sobe/desce a
  sala; a saude de recepcao de um peer nunca move a qualidade dos outros.
- **Mexer na eleicao da arvore.** A tree.js fica intacta.
- **UI alem da tag.** Sem grafico, sem historico, sem painel.

## Ordem e dependencias

```
Task 1 (receiveHealth + view-state)  ->  Task 4 (peerQuality no app.js)
Task 2 (peerquality.js)              ->  Task 4
Task 3 (scaleFactorFor + applyEncodingToPeer)  ->  Task 5 (reapplyAudienceQuality per-peer + M3)
Task 4  ->  Task 5
Task 5  ->  Task 6 (tag no painel de membros)
```

Task 1, 2 e 3 sao independentes entre si e podem ir em paralelo. A verificacao
manual so vale depois da Task 5; a Task 6 e cosmetica.

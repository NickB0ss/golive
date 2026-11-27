# Bugs do renderer: mídia e rede (auditoria 25/11/2026)

Escopo: `src/renderer/app.js` (transmissão, WebRTC, relay, pausa, troca de
fonte, reconexão), `mesh.js`, `screenrelay.js`, `autoquality.js`,
`capturequality.js`, `capturewatch.js`, `broadcastguards.js`,
`encodehealth.js`, `leaderloss.js`, `audio-capture.js`, `annotate.js`,
`laser.js`, `qualitypolicy.js`, `txstats.js`, `screenres.js` e `stallwatch.js`.
Interface, CSS e jogos da Mesa ficaram de fora. Base: branch
`claude/charming-babbage-0joydr`, versão 0.28.x com as correções da 0.28.1.

Evidência:

- **CONFIRMADO**: reproduzido por teste `node --test` em
  `/tmp/claude-0/-home-user-golive/55573a2c-39b7-58ae-bbac-ac37f25f7d3b/scratchpad/bugs-renderer/renderer-midia.repro.test.js`
  (6 testes, todos passam e mostram o defeito; usam os módulos de produção,
  sem alterá-los).
- **PLAUSÍVEL**: `app.js` não carrega no Node. O caminho foi conferido
  lendo o código, com as linhas indicadas; o motivo de não haver teste está
  em cada item.

Ordem: do mais grave ao menos grave.

---

## R-01 — alta — relay que não assiste a tela nunca pede de volta a própria entrada

- **Onde:** `src/renderer/app.js:3385-3396` (`checkStalledInput` usa
  `wantsMedia` + `isAppWatching` como demanda), `src/renderer/stallwatch.js:19-25`
  (`stallDemand`), `src/renderer/app.js:3527-3545` (`reofferOne`, ramo de repasse).
- **Defeito:** o vigia de imagem do relay só cuida da entrada origem→relay
  quando o próprio relay está olhando aquela tela. A demanda dos filhos
  (`folhaAssistindo`) entra no `view-state`, mas o vigia não a considera.
- **Cenário:** o relay R está jogando com o GoLive escondido
  (`isAppWatching() === false`), ou assiste outra tela. A entrada O→R
  congela, mas o ICE segue `connected`, então a origem não vê falha. As
  folhas de R detectam o congelamento e mandam `reoffer` para R. R refaz só
  a conexão R→folha (`relayTo`) com a mesma track de entrada, que continua
  congelada. Depois de 3 tentativas as folhas desistem. R nunca manda
  `reoffer` para O, porque `stallDemand({ wanted:false | watching:false })`
  devolve `watched:false` e o `observe` apaga o estado. A origem também não
  reage: a `receiveHealth` de R fica `null` quando não há quadros, que é o
  caso neutro. Resultado: as folhas ficam sem imagem até a árvore mudar.
- **Evidência:** PLAUSÍVEL. O caminho foi lido inteiro. Não dá para testar
  no Node porque depende de `checkStalledInput` e `reofferOne`, que ficam
  em `app.js`. A árvore elege relay só entre peers não suspensos
  (`tree.js:187`), e depois disso nada impede o relay de esconder a janela;
  esse é o caso normal de quem joga.
- **Correção:** em `checkStalledInput`, quando `parseKind(kind).sourceId`
  é nulo e `folhaAssistindo(session, baseKind, peerId)` é verdadeiro,
  tratar a demanda como `wanted:true, watching:true`. Outra opção: no ramo
  de repasse de `reofferOne`, se a entrada não teve quadro novo na janela,
  mandar também `reoffer` para a origem.

## R-02 — média — desligar a câmera deixa um tile fantasma em quem assiste

- **Onde:** `src/renderer/mesh.js:600` (`ensureInConn` reaproveita a PC na
  renegociação), `mesh.js:978-1000` (`removeTrack`), `app.js:5496-5516`
  (`stopCamera`), `app.js:4210-4221` (`camera-state` só grava flags).
- **Defeito:** desde a correção A8, a oferta de `removeTrack` chega com
  `renegotiate:true` e reaproveita a `inConn`. Nesse caminho o mesh não
  emite `onPeerState({ removedTile })` nem outro evento, e o `app.js` não
  remove `cam-<id>` em nenhum outro ponto. O `camera-state {on:false}` só
  troca `peer.cameraOn` e a lousa. O `ui.js` também não escuta
  `removetrack`/`mute`.
- **Cenário:** A liga a câmera e B a vê. A desliga. Em B o tile `cam-A`
  continua na grade, preto ou com o último quadro, e o painel de membros
  mostra câmera ligada, porque `ui.js:3208` considera
  `tileRegistry.has('cam-A')`. O tile só some quando A sai da sala. Variante:
  se B tinha optado por não ver a câmera (demanda suspensa, sender com
  `track === null`), `removeTrack` não encontra o sender (`mesh.js:982`),
  devolve `false` e nem renegocia.
- **Evidência:** CONFIRMADO (testes `R-02` e `R-02b`): após
  `removeTrack` + `handleOffer(..., renegotiate=true)` o receptor teve zero
  `removedTile`, e com a demanda suspensa `removeTrack` devolve `false` sem
  oferta. A ausência de remoção no `app.js` foi conferida por busca:
  `cam-${` só aparece em `peer-left`, `teardownPeers` e falha de órfã.
- **Correção:** no `case 'camera-state'` com `on !== true`, chamar
  `dropTile('cam-'+id)` e `dropWatchers`. No mesh, procurar o sender de
  vídeo pelo transceiver (`receiver.track.kind === 'video'`) e não por
  `s.track === track`, para renegociar também com a demanda suspensa.

## R-03 — média — `peer-left` não limpa o que passava pelo peer que saiu

Duas faces do mesmo defeito em `src/renderer/app.js:3905-3970`, somadas a
`mesh.removePeer` (`mesh.js:372`), que fecha as PCs sem
`onPeerState`; `pc.close()` não dispara `connectionstatechange`.

1. **O relay sai e o vigia da folha fica cego.** Na folha, o tile `O` (tela da
   origem, entregue por R) continua com `tileSource.get('O') === 'R|screen@O'`,
   uma conexão que já não existe. O handler só derruba os tiles próprios de R
   (`dropTile(msg.id)`, `cam-${msg.id}`). Em `checkStalledTiles`
   (`app.js:3479`) o `if (tileSource.has(tileId)) continue;` não confere
   se aquela conexão ainda existe. Por isso, se a oferta direta da origem
   (`recoverFromRelayLoss`) ou a do novo relay falhar ou for recusada, a
   folha nunca pede reoferta. Enquanto isso o tile mostra o último quadro
   congelado.
2. **A origem sai e o relay não fecha os repasses.** Em R, `peer-left(O)` faz
   `myRole[kind].delete(O)` (`app.js:3961`), mas não chama
   `dropRelaysOf(session, kind, O, { ended:true })`. As PCs R→folha
   `screen@O` / `camera@O` continuam abertas, com a track encerrada e
   consent checks de ICE. Na folha, as `inConns['screen@O']` também ficam,
   porque a chave está sob o peer R. Cada saída e reentrada de uma origem
   deixa um par de PCs vazadas por filho até R ou a folha saírem.

- **Evidência:** PLAUSÍVEL com alta confiança. O teste `R-03` CONFIRMA a
  premissa do mesh (`removePeer` não emite nada). O efeito no `app.js` foi
  lido linha a linha.
- **Correção:** em `peer-left`, antes de `mesh.removePeer`, chamar
  `dropRelaysOf(session, kind, msg.id, { ended:true })` para cada kind e
  apagar todo tile cujo `tileSource` comece com `${msg.id}|`. Em
  `checkStalledTiles`, ignorar a entrada de `tileSource` cuja conexão não
  esteja em `receivingFrom()`.

## R-04 — média — `view-state` enviado ao receber oferta ignora a escolha de tela e os filhos

- **Onde:** `src/renderer/app.js:3990-3992` (`case 'offer'`).
- **Defeito:** ao aceitar uma oferta, o app só corrige a demanda quando
  `!isAppWatching()`. Duas falhas:
  1. Quem vê a janela mas não escolheu esta tela (`wantsMedia === false`:
     assiste outra pessoa ou está na Mesa sem a janela) não manda nada. Toda
     PC nova nasce com `suspended=false` (`closeOut` zera), então a origem
     volta a codificar 1080p para quem não está olhando. Para quem só
     assiste não existe loop de stats, e o próximo `view-state` só sai em
     outro evento de visibilidade, escolha ou `broadcast-state`. Acontece a
     cada `reofferOne`, `scheduleDirectRetry`, `reofferForResumedPeer`,
     re-oferta do `welcome` e recuperação de relay. Na prática é um encoder
     NVENC a mais por espectador desinteressado, que é o limite de sessões
     que derruba o encode para software.
  2. Um relay com a janela escondida e filhos assistindo responde
     `watching:false` cru, sem `folhaAssistindo`. A origem suspende o
     relay e as folhas ficam pretas até o próximo tick de `updateStats`,
     que leva até 5 s com a janela escondida.
- **Evidência:** PLAUSÍVEL. A expressão está literalmente na linha 3990, e
  `broadcastViewState` (`app.js:6047`), que faz a conta certa, não é chamado
  nesse caminho.
- **Correção:** depois de `sig.send({ type:'answer' })`, chamar
  `broadcastViewState()`, que já calcula `watching`/`looking` por conexão
  com `wantsMedia` e `folhaAssistindo`, em vez do envio fixo.

## R-05 — média — relay de tela que para por erro não se recupera (pendência do diagnóstico)

- **Onde:** `src/renderer/screenrelay.js:255-265` (laço) e
  `src/renderer/app.js:4690` (`onFrameError` só faz `console.error`).
- **Defeito:** qualquer exceção no laço (`drawImage` em contexto inválido,
  erro do `MediaStreamTrackProcessor`) encerra o relay. A track de saída
  continua `live`, sem `ended`, e nada no app reage. `loopRunning=false`
  só aparece no log `[diag] captura-local`.
- **Cenário:** a GPU sofre um soluço durante o jogo e `drawImage` lança. A
  saída do canvas para, e todos os espectadores ficam com o quadro
  congelado. O vigia deles pede reoferta, e a origem reoferta a mesma track
  morta. Depois de 3 tentativas eles desistem. Só trocar a fonte ou parar e
  recomeçar resolve. O diagnóstico de 21/11 apontou isso (“`onFrameError` só
  registra erro… não inicia recuperação”), e a 0.28.1 não tratou.
- **Evidência:** CONFIRMADO (teste `R-05`): o segundo `drawImage` lança, o
  laço para, `loopRunning=false`, a saída não é parada e o quadro seguinte
  não é lido.
- **Correção:** em `onFrameError`, se `captureTrack` ainda estiver `live`,
  recriar o relay como o `swapShare` faz (`createScreenRelay` + troca em
  `localStream` + `replaceLocalTrack`), com limite de tentativas. Se a
  captura também morreu, chamar `stopShare` com aviso.

## R-06 — média — sair da sala não para o medidor de som (timer e aviso falso)

- **Onde:** `src/renderer/app.js:1889-1928` (`teardownMedia`). Compare com
  `stopShare`, `app.js:5074`.
- **Defeito:** `teardownMedia` para captura, relay e `captureWatch`, mas não
  chama `stopSoundMeter()`. O `setInterval(readSoundMeter, 100)` e o
  `MediaStreamAudioSourceNode` ligado ao `AnalyserNode` sobrevivem.
- **Cenário:** alguém transmite com som e clica em Desconectar, ou é
  expulso, ou a sala fecha. A track de áudio é parada, o medidor continua
  lendo silêncio 10 vezes por segundo e, depois de 20 s
  (`SILENCE_MS_DEFAULT`), a central de avisos do lobby mostra “silêncio no
  áudio”. O medidor também fica visível. Isso dura até a próxima
  transmissão.
- **Evidência:** PLAUSÍVEL com alta confiança. Por busca, `stopSoundMeter`
  só é chamado em `stopShare` (5074) e `startSoundMeter` (5229).
- **Correção:** chamar `stopSoundMeter()` dentro do `if (localStream)` de
  `teardownMedia`, ou em `resetShareState`.

## R-07 — média — `tree` aceita `filhos`/`epoch` sem validação

- **Onde:** `src/renderer/app.js:4437-4501` (`case 'tree'`),
  `mesh.js:575/1030` (`ensureOutConn` → `addPeer` cria o peer).
- **Defeito:** `filhos` é usado como veio (qualquer tipo, qualquer tamanho,
  ids fora da sala), e `epoch` não é conferido como inteiro. O servidor só
  repassa a mensagem (`server/signaling-core.js:1774-1787`).
- **Cenário:** uma origem com bug ou hostil manda `filhos` com 50 ids
  inexistentes. O relay chama `relayTo` para cada um: `ensureOutConn`
  fabrica peers fantasmas no mesh, cada um com uma `RTCPeerConnection` e um
  encoder. `relayLoad()` passa a anunciar 50 e as ofertas vão para o vazio.
  Com `epoch: undefined`, `msg.epoch < state.epoch` dá falso e grava
  `undefined`. A partir daí `undefined < n` é sempre falso, e a proteção
  contra tree antiga daquela origem deixa de funcionar.
- **Evidência:** CONFIRMADO para a parte do mesh (teste `R-07`: 50
  `relayTo` para ids desconhecidos geram 51 peers e PCs reais). O consumo
  cru no `app.js` foi conferido por leitura.
- **Correção:** aceitar `tree` só com `Number.isInteger(epoch) && epoch >= 0`;
  filtrar `filhos` para strings que sejam peers da sessão, sem repetir e
  com teto (o fanout é 2, então um teto de 4 ou 8 cobre); exigir que
  `paiId` seja a origem ou um peer conhecido.

## R-08 — baixa — `startShare` interrompido por queda da sinalização deixa a transmissão sem controles

- **Onde:** `src/renderer/app.js:4840-4866`.
- **Defeito:** depois de `localStream = stream` (4778) há
  `await startAnnotOverlay()` e o laço de ofertas, cada uma com até 10 s.
  Se a sinalização cai nesse intervalo, `currentSession` muda,
  `canContinue()` fica falso e a função retorna sem
  `setToggleState('share','on')`, sem mostrar Pausar/Trocar fonte e sem
  `startStatsLoop`. A captura continua: o `welcome` da reconexão re-oferta
  e anuncia ao vivo, mas os botões ficam no estado “desligado”. O botão
  principal mostra “Compartilhar” e, se clicado, para a transmissão
  (`if (localStream) return stopShare()`); pausar só funciona pelo atalho.
- **Evidência:** PLAUSÍVEL (leitura).
- **Correção:** separar o “cancelado por `stopShare`” (epoch mudou: limpar)
  do “sessão trocou” (manter e ajustar a UI), ou atualizar
  toggle e botões a partir de `localStream` no `welcome`.

## R-09 — baixa — `cpuLimited` se perde no `view-state`

- **Onde:** `src/renderer/qualitypolicy.js:51-61` (`normalizeEncodeHealth`),
  consumido em `app.js:6983-6985` (`peerEncodeSaturated`).
- **Defeito:** o resumo local (`encodehealth.summarizeScreenEncodeHealth`)
  tem `cpuLimited`, que `autoquality.isBad` trata como sinal autoritativo
  (`autoquality.js:66`). A normalização de quem recebe descarta o campo.
- **Cenário:** o relay está com `qualityLimitationReason = 'cpu'` e
  `load ≤ 1`. Para ele mesmo a escada consideraria o encode ruim, mas a
  origem calcula `peerEncodeSaturated = false` e não desce o degrau da
  conexão origem→relay.
- **Evidência:** CONFIRMADO (teste `R-09`).
- **Correção:** incluir `cpuLimited: raw.cpuLimited === true` (e `limit`,
  se for útil) em `normalizeEncodeHealth`.

## R-10 — baixa — overlay de anotação pode abrir depois de a transmissão parar

- **Onde:** `src/renderer/app.js:2938-2964` (`startAnnotOverlay` /
  `stopAnnotOverlay`), chamados em 4840 e 5033.
- **Defeito:** `startAnnotOverlay` zera `annotOverlayOn` antes do
  `await` de IPC. Se `stopShare` ou `teardownMedia` rodam durante essa
  espera, `stopAnnotOverlay` vê `false` e não manda parar. Quando o IPC
  resolve com `ok`, a função marca `annotOverlayOn = true` e envia o
  snapshot.
- **Cenário:** a pessoa clica em Parar logo depois de “Ao vivo” ou de
  trocar de fonte. A janela transparente fica sempre por cima, sobre o
  monitor, sem transmissão, até a próxima parada.
- **Evidência:** PLAUSÍVEL (leitura; depende do tempo do IPC).
- **Correção:** guardar `shareEpoch` na entrada e, se ele mudou ao voltar
  do IPC, chamar `window.golive.stopAnnotOverlay()` em vez de ligar.

---

## Conferência das correções da 0.28.1

- Conexão ausente recriada respeitando a árvore (`reofferOne`,
  `app.js:3501-3524`): completa. Folha não recebe envio direto, e antes da
  primeira árvore só uma saída que já existia é refeita.
- Negociação com prazo e invalidação por PC (`mesh.runNegotiation`): os
  efeitos após `await` conferem `currentPc`, e uma resposta tardia não
  derruba a PC nova. Não encontrei regressão.
- Pausa ligada à conexão atual (`offerOwnStreamTo` com `videoPaused`,
  `closeOut` zerando `suspended`): completa para a pausa manual. A demanda
  por espectador (`watching:false`) não acompanha a PC nova; ver R-04.
- `capturequality.js`: serialização, coalescência, reset e repetição
  corretos. Não reproduzi defeito; uma constraint impossível é repetida a
  cada 10 s para sempre (uma linha de log por tentativa), o que é aceitável.
- Troca de fonte recria relay encerrado (`swapShare`, `app.js:4980-4990`):
  completa. O relay que morre por erro sem troca de fonte continua sem
  recuperação (R-05).

## Avisos `require-atomic-updates` do lint

Os 6 avisos atuais (`app.js` 4607, 4669, 4778, 4870, 5425, 5456) são falsos
positivos. `ownPidCache` e `nativeAudioAvailable` são caches idempotentes.
`localStream` e `cameraStream` são gravados depois de guardas de época
(`canContinue`, `mediaEpoch`) com latch (`sharing`, `cameraStarting`) que
impede uma segunda chamada concorrente. Os `finally` só soltam o latch.

## Descartado após conferência

- Glare SDP: entrada e saída usam PCs separadas por (peer, kind), e a saída
  serializa ofertas com `negotiating`. Não há colisão alcançável.
- Pausa e despausa contra `watching:false`: a despausa religa todos, mas o
  `broadcast-state` faz o espectador reenviar o `view-state` via
  `syncWatchedScreens` e a situação se corrige em um RTT.
- Unidades em `txstats` (Mbps, ms/quadro), `startBitrateKbps`,
  `bitrateCap` e `screenres`: corretas. As divisões são protegidas
  (`dtMs > 0`, `frames > 0`, `contentRect` sem zero).
- `annotate.js`, `laser.js`: coordenadas `isNorm`, cor `#rrggbb`, tetos de
  pontos, itens e texto, autoria pelo `from` carimbado. A tabela de
  estatísticas escapa nomes e textos que vêm da rede.
- `audio-capture.js`: o abort antes do `captureId` não vaza captura nativa,
  porque o `stop` posterior usa o id.

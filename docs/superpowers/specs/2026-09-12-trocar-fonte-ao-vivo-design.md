# Trocar de tela/janela sem parar a transmissão — design

Item B da avaliação de lançamento público (`docs/2026-09-07-avaliacao-lancamento-publico.md`,
seção 7, item 3): "Troca de fonte sem encerrar a sessão". Hoje, pra mudar o
que se compartilha, é preciso parar, escolher de novo e ir ao vivo outra vez
— os espectadores perdem a imagem e precisam clicar de novo pra assistir.

## Objetivo

Um botão **Trocar** na barra de controle (ao lado de Pausar), visível só
enquanto a pessoa está compartilhando tela. Abre o seletor num modo
reduzido (só fonte + som; qualidade e anotações ficam como estão) e, ao
confirmar, a imagem muda **sem encerrar a sessão e sem renegociar** — os
espectadores não clicam em nada, a árvore de retransmissão continua de pé.

## Decisão central: por que dá pra trocar sem `replaceTrack` nenhum

A tela já passa por `src/renderer/screenrelay.js`: captura →
`MediaStreamTrackProcessor` → canvas → `canvas.captureStream(0)` → a track
que de fato vai pros senders. Essa track de SAÍDA nasce uma vez em
`screenrelay.create()` e nunca muda de identidade enquanto a transmissão
dura — é o mesmo objeto `MediaStreamTrack` do início ao fim.

Consequência: se o relay aprender a **trocar só a entrada** (cancelar o
leitor da track antiga do `MediaStreamTrackProcessor` e começar a ler de
uma nova, continuando a desenhar no MESMO canvas e a emitir na MESMA track
de saída), **nenhum sender em lugar nenhum da árvore precisa saber que algo
mudou**:

- Os senders da origem (pra quem recebe direto) seguram a mesma referência
  de track o tempo todo — nunca chamamos `replaceTrack` nelas.
- Um relay que repassa a tela (`mesh.js relayTo`) leu, na hora em que a
  árvore foi montada, o track **remoto** recebido da origem
  (`peer.inStreams.screen.getVideoTracks()[0]`) e criou o próprio sender
  com ESSE objeto. Track remota de um `RTCRtpReceiver` é o mesmo objeto
  durante toda a vida da conexão (a menos que a conexão renegocie) —
  então o que sai do encoder do relay muda sozinho, sem o relay fazer nada,
  porque é o mesmo track "passando por dentro".
- A árvore (`tree.js`) e os papéis (relay/folha/direto) não mudam: a
  atribuição depende de quem está na sala, RTT e saúde de encode — nada
  disso muda ao trocar a IMAGEM que está sendo mandada.

Isso só vale pro **vídeo**, e só quando o relay de canvas está ativo (é o
caso normal — `screenrelay.isSupported()` cobre qualquer Chromium com
`MediaStreamTrackProcessor`, que é o motivo de o relay existir desde a
0.11.0). Quando o relay não está disponível (fallback raro, navegador sem
suporte), a track crua vai direto pro sender e a troca PRECISA de
`sender.replaceTrack()` em cada conexão de saída da origem (não dos
relays-filhos — o mesmo argumento acima faz o valor se propagar sozinho
depois que a origem troca).

**Áudio nunca passa pelo canvas** — é uma track separada (loopback do
Electron ou `MediaStreamAudioDestinationNode` da captura nativa por
processo), somada ao mesmo `localStream` e enviada por um segundo
transceiver na MESMA `RTCPeerConnection` de tela. Trocar de fonte quase
sempre troca também o modo de captura de áudio (worksheet abaixo), e isso
SEMPRE usa `sender.replaceTrack()` nos sender de áudio dos peers a quem a
origem manda direto (relay propaga de graça, mesmo argumento).

**Conclusão da arquitetura:** troca de fonte = trocar a ENTRADA do relay de
canvas (vídeo, no caso comum) + `replaceTrack` de áudio nos meus próprios
`outConns['screen']` (nunca nos dos relays). Nenhuma oferta nova, nenhuma
mensagem de sinalização nova, nenhuma mudança na árvore.

## O que muda em cada arquivo

### `src/renderer/screenrelay.js` (função nova: `swapSource`)

O laço hoje é `while (vivo) { r = await leitor.read(); ... }`, e quando o
leitor devolve erro ou `done`, o laço `break`s — é o comportamento certo
pra uma falha de verdade, mas cancelar o leitor de propósito (pra trocar
de fonte) PARECE um erro/done pro mesmo código.

Precisa de uma flag (`trocando`) que o laço consulta antes de decidir
`break`: se a leitura terminou porque `swapSource` cancelou o leitor de
propósito, o laço CONTINUA com o leitor novo (já trocado na variável de
closure) em vez de parar. Ver comentário no código pra o detalhe de que
`leitor` (a variável de closure) é reatribuída ANTES do cancelamento, pra
que a iteração seguinte já pegue o leitor novo.

`swapSource(newTrack)` devolve `true`/`false` (troca aceita ou recusada —
`MediaStreamTrackProcessor` pode rejeitar uma track encerrada). Continua
desenhando no MESMO canvas, então nenhum quadro preto: entre cancelar o
leitor velho e o primeiro quadro do novo, o encoder simplesmente não recebe
quadro novo por uma fração de segundo — sem `requestFrame()` novo ele
segura o último quadro desenhado, não pinta nada preto.

### `src/renderer/sourceswap.js` (novo, puro, testado)

A parte "decidir o que muda" que o item pede pra ficar fora do `app.js`:

- `decideAudioStrategy({ shareSound, isWindowSource, includeDiscord, windowPid, ownPid })`
  — espelha byte a byte a lógica que já existe em `app.js` (linhas
  ~2864-2886 do `startShare`), só que como função pura (os PIDs chegam já
  resolvidos, a IPC fica do lado de fora). Devolve
  `{ mode: 'none'|'system-loopback'|'process'|'include-list', basePid, baseExclude }`.
  **Deliberadamente duplicada, não extraída** do `startShare` — ver seção
  "O que fica de fora" pro porquê.
- `wantsSeparateDiscordCapture({ isWindowSource, includeDiscord, discordPid, basePid })`
  — mesma regra do `startShare` (soma uma captura só do Discord quando a
  base já é uma janela específica).
- `planSwap({ fromSourceId, toSourceId })` — deriva `{ fromIsWindow,
  toIsWindow, overlayShouldReopen }` a partir dos dois ids (prefixo
  `screen:`/`window:`); usado pelo `app.js` pra decidir overlay e log, sem
  reimplementar o parsing em cada lugar.

### `src/renderer/mesh.js` (função nova: `replaceLocalTrack`)

```
replaceLocalTrack(kind, matchKind, track)
```

Itera `peers`, pega `peer.outConns[kind]` (só as conexões de SAÍDA da
ORIGEM — nunca mexe em `inConns` nem em conexões de relay-pra-filho, que
pertencem a outra máquina). Pra cada peer com aquela conexão:

- **Se `matchKind === 'video'` e o peer está com aquele `kind` suspenso**
  (`peer.suspended[kind]`, ver F1.3/pausa) **pula** — não reativa um
  sender que a pausa deixou sem track. Isto é o que faz a pausa (P1 da
  avaliação) sobreviver à troca: quem pausou continua com o sender em
  `replaceTrack(null)`; a troca de fonte não mexe nesses peers, e
  quando a pessoa despausar, o código de despausar (`setSharePaused`)
  já busca `localStream.getVideoTracks()[0]` (ou a referência nova, ver
  abaixo) NA HORA — ele automaticamente pega a fonte certa, mais nova.
- Senão, acha o sender cujo `sender.track?.kind === matchKind` e chama
  `sender.replaceTrack(track)`.

Devolve quantos peers foram tocados (só pra log/teste).

Áudio nunca suspende (comentário já existente em `setPeerDemand`), então
`matchKind === 'audio'` sempre substitui, em todo peer com a conexão.

### `src/renderer/app.js` (função nova: `swapShare`; poucas linhas em volta)

Chama os módulos acima, na ordem:

1. Guarda de reentrância (`swapping`, paralela a `sharing`) e de sessão
   (`currentSession !== session` → aborta, mesmo padrão do `startShare`).
2. `selectSource(newSourceId, ...)` — igual ao `startShare`, decide o modo
   de áudio do próprio `getDisplayMedia` (loopback do Electron ou não).
3. `getDisplayMedia({ video: config.videoConstraints(cfg.quality), audio })`
   — MESMA qualidade (`cfg.quality` não muda na troca). Falha aqui? toast
   e aborta, a fonte antiga continua no ar (não há nada pra desfazer:
   ainda não tocamos em nada).
4. **Vídeo:** se `screenRelay` existe, `screenRelay.swapSource(novaTrack)`.
   Se devolver `false` (raro) OU se `screenRelay` nunca existiu nesta
   máquina, cai no caminho de fallback: `localStream.removeTrack` /
   `addTrack` da track crua + `mesh.replaceLocalTrack('screen', 'video', …)`
   (que já pula quem está pausado).
5. Troca o listener `'ended'` da `captureTrack` pra track nova ANTES de
   parar a antiga — **detalhe que não é opcional**: a track antiga tem
   `addEventListener('ended', stopShare)`; pará-la sem tirar esse listener
   dispara `stopShare()` e derruba a sessão inteira no meio da própria
   troca.
6. **Áudio**, só se `shareSound` já estava ligado (ver decisão abaixo sobre
   não deixar religar/desligar som na troca): `decideAudioStrategy` +
   `startNativeProcessAudioNode`/`startIncludeListCapture` iguais ao
   `startShare`, montando a nova track mista. Falha na captura nativa da fonte
   nova (PID sumiu, addon indisponível)? **Não cai pro loopback de
   sistema** — mantém o áudio ANTIGO tocando e avisa por toast. É a
   correção do P1 (b) da avaliação aplicada ao código NOVO: o `startShare`
   existente já tem esse comportamento (cair pro sistema quando falha o
   PID) e ele fica como está — não é escopo desta tarefa mexer nele — mas
   o caminho novo não repete o problema.
7. `mesh.replaceLocalTrack('screen', 'audio', novaTrackOuNull)`.
8. **Rabisco:** `stopAnnotOverlay()` sempre (idempotente); se o novo é
   TELA, `startAnnotOverlay()` de novo — a função já existente destrói e
   recria a janela na posição certa (`createOverlayWindow` chama
   `destroyOverlayWindow()` no início). `ui.annotations.clearSurface('me')`
   (função nova, uma linha em `ui.js`) limpa o que estava desenhado —
   mesma regra de "a lousa morre com a tela" que já existe no `stopShare`,
   porque a imagem por baixo mudou e os traços antigos não fazem mais
   sentido no lugar onde estão.
9. Atualiza a referência local (`captureTrack`, `currentSourceId`) e
   mostra um toast de confirmação.

`stopShare`/`resetShareState` zeram `currentSourceId` e escondem o botão
Trocar, igual já fazem com o de Pausar.

### `src/renderer/ui.js` (poucas linhas)

- `openPicker({ …, mode: 'swap' })`: esconde a seção "Qualidade" e a de
  "Anotações" (duas `classList.toggle('hidden', mode === 'swap')` nos
  contêineres que já existem — `#picker-quality`/`h3` acima dele,
  `.check-group.bare` das anotações), troca o texto do `h2` e do botão
  "Ir ao vivo" → "Trocar", e trava a checkbox de som (ver decisão abaixo).
  `mode` default `'start'`, então `openPicker` sem esse campo continua
  idêntico a hoje.
- `annotations.clearSurface(tileId)`: uma linha nova que chama o
  `emitAnnotOp` interno com `{ op: 'clear', scope: 'all' }` — o MESMO
  caminho que o botão "Apagar tudo" já usa, só que disparado pelo
  `app.js` em vez de um clique.

### `src/renderer/index.html` / `style.css`

Botão novo `#btn-swap-share`, mesma família visual do `#btn-pause-share`
(`.secondary.control-btn`, nasce `hidden`), ícone (duas setas circulares —
já existe um SVG parecido no botão de atualizar do seletor, reaproveitar a
forma) + `<span class="btn-label">Trocar</span>` + `aria-label="Trocar de
tela ou janela"`. CSS: nenhuma classe nova de cor — o botão usa
`.secondary` que já existe, não precisa de bloco novo em `style.css`.

## Decisões e o que fica de fora

**Som não liga nem desliga na troca.** O seletor em modo troca mostra a
checkbox "Compartilhar som" MARCADA/DESMARCADA conforme o estado atual, mas
**desabilitada** — só a de "incluir o som do Discord" continua editável
(e só faz sentido quando o som já está ligado). Ligar ou desligar áudio
significa adicionar ou remover um transceiver na conexão — o `mesh.js` não
tem hoje um jeito de ADICIONAR uma track a uma `RTCPeerConnection` que já
existe sem duplicar os transceivers que já estão lá (`negotiateOffer`
adiciona um `addTransceiver` por track do zero; chamá-lo de novo numa
conexão existente dobraria o de vídeo). Implementar isso exigiria
renegociação de verdade, o que o objetivo do item B pede pra evitar
("sem renegociar se possível") e é uma superfície de erro a mais bem no
meio da P1 de áudio. Quem quer ligar/desligar o som troca com o botão de
parar/começar de novo — fora do botão Trocar.

**`app.js` não extrai a lógica de áudio do `startShare` pro módulo novo.**
`sourceswap.js` duplica a decisão em vez de importar de um `startShare`
refatorado — o `startShare` é código que já funciona, testado em produção,
e outros times mexem perto dele (`app.js` está na lista de arquivos
disputados do brief comum). Refatorá-lo pra compartilhar teria mais risco
de conflito de merge e de regressão do que valeria pra esta tarefa.

**Qualidade não muda na troca.** O teto (`cfg.quality`) é o mesmo antes e
depois — só a fonte capturada muda. `screenres.js`/`autoquality.js` já
leem a resolução da captura a cada ciclo do laço de qualidade
(`captureTrack.getSettings()`, ver `screenSourceSize` em `app.js`) — uma
janela 4:3 depois de uma tela 16:9 já cai dentro do "a resolução da
captura mudou" que o laço já trata toda vez que a pessoa MINIMIZA/já
tratava antes desta tarefa. Nada novo precisa ser escrito aqui: é
consequência de ler o tamanho ao vivo em vez de guardá-lo uma vez no
início.

**Árvore de retransmissão não recalcula.** Ver a seção "decisão central":
papéis (relay/folha/direto) dependem de quem está na sala, não do que está
sendo mostrado. `recomputeTree`/`broadcastWatchers` não são chamados na
troca.

**Protocolo de sinalização não ganha mensagem nova.** Tudo o que muda de
rede nesta tarefa já tem mensagem: a op `annotate` (`clear`/`scope:'all'`)
já existe e já é validada no servidor. Nenhum campo novo em
`signaling-core.js`.

**Overlay do rabisco na tela real.** Tela→tela: a janela é destruída e
recriada no monitor novo (`createOverlayWindow` já faz isso sozinho —
nada de código novo no `main.js`). Tela→janela: `stopAnnotOverlay()` some
com a janela de overlay (o toast já existente avisa "rabiscos aparecem no
app"). Janela→janela: nunca havia overlay, `stopAnnotOverlay()` é no-op.

**Trocar pra a MESMA fonte que já está no ar** não é bloqueado — é tratado
como uma re-captura válida (a pessoa pode querer "reiniciar" a captura de
uma janela que travou, por exemplo). Não é um bug, é a mesma lógica sem
caso especial.

**Fora desta tarefa:** câmera (o botão Trocar só existe pra tela, não pra
webcam — trocar de câmera não tem o mesmo problema de hardware que motivou
o relay de canvas); trocar durante retomada de sessão órfã (o botão fica
escondido enquanto não há `localStream` de qualquer forma); qualquer UI de
"quem está vendo o quê mudou" pros espectadores (eles simplesmente veem a
imagem nova, sem toast — não há mensagem de chat automática).

## Compatibilidade com a pausa (P1 da avaliação)

Coberto na íntegra pelo desenho acima, sem código extra dedicado:

- **Canvas-relay (caso comum):** a track de saída nunca muda de
  identidade. Quem está com o sender em `replaceTrack(null)` (pausado)
  continua exatamente assim durante e depois da troca — a troca não toca
  nesses senders.
- **Fallback sem relay:** `mesh.replaceLocalTrack('screen', 'video', …)`
  pula peers com `peer.suspended.screen` — a troca não reativa ninguém.
- **Despausar depois de trocar:** `setSharePaused`/`enforceSharePauseFor`
  já buscam a track "atual" (`localStream.getVideoTracks()[0]`) no
  momento em que despausam, não uma referência guardada no início da
  pausa — então automaticamente pegam a fonte pós-troca, sem mudança de
  código nesses dois pontos.

## Roteiro de teste manual (2 PCs, com a árvore ligada quando possível)

1. **Tela → tela** (dois monitores num PC, ou trocar de monitor
   principal): compartilhar tela A, espectador vendo; clicar Trocar,
   escolher tela B; confirmar que a imagem muda sem o espectador precisar
   clicar em nada, sem "Reconectando", sem tela preta. Se a pessoa tinha
   rabisco ativado, confirmar que o overlay real se move pro monitor novo
   e a lousa antiga sumiu (tanto no app de quem compartilha quanto na tela
   real).
2. **Tela → janela**: mesma coisa, mas confirmar que o overlay real
   desaparece e aparece o toast "rabiscos aparecem no app, não na tela".
3. **Janela → tela**: inverso do 2, overlay real aparece.
4. **Pausado**: pausar, trocar de fonte, confirmar que o espectador
   continua vendo "Transmissão pausada" (não volta a receber quadro
   nenhum) durante e depois da troca; despausar depois e confirmar que a
   imagem que aparece é a NOVA fonte, não a antiga.
5. **Com retransmissão em árvore** (3+ pessoas, uma virando relay):
   confirmar que quem é FOLHA (recebe do relay, não da origem) também vê
   a troca, sem clique nenhum da parte dele nem do relay.
6. **Áudio**: compartilhando com som ligado (sistema ou processo), trocar
   de tela pra janela (ou vice-versa) e confirmar que o som contínua
   saindo, e que é o da fonte nova (tocar algo só na janela nova e
   confirmar que o espectador ouve). Testar também o caso de falha
   (renomear/fechar o processo da janela escolhida bem na hora da troca,
   se der pra forçar) e confirmar que NÃO vira áudio do sistema inteiro
   sem avisar.
7. **Concorrência**: clicar Trocar duas vezes rápido (escolher fontes
   diferentes nas duas) — confirmar que não trava e não duplica encoder
   (checar o painel de estatísticas/[diag] no console por sender extra).

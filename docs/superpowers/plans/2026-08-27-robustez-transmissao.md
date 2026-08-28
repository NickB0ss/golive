# Plano — robustez da transmissão (auditoria de 2026-08-27)

Executa o backlog restante de `docs/2026-08-27-auditoria-de-fragilidade.md`.
Os itens A2, A4, A5, A6, A7, C1, C2, C3, C6, F2 e G4 já foram feitos na
branch `chore/robustez-e-higiene` — não estão aqui.

Ficam **fora** deste plano, por precisarem de verificação manual rodando o
app ou de esforço de dias: B1 (subir Electron), D1 (extrair orquestração
testável de `app.js`), G1–G3 (áudio nativo em C++), B6 (assinatura de
código), F1 (acessibilidade), F4 (redesign).

## Global Constraints

Estas valem para **todas** as tarefas. Um reviewer deve tratar violação
como defeito.

1. **Comentários em português, sem acentos**, no estilo do arquivo em que
   você está mexendo: explicam *por que*, não *o quê*. O código deste
   projeto documenta decisões e armadilhas — mantenha esse padrão. Texto
   visível ao usuário (UI, toasts) **usa** acentos normalmente.
2. **Testes com `node --test`**, sem framework novo, sem dependência nova.
   Os arquivos de teste ficam ao lado do módulo (`x.js` → `x.test.js`) e o
   módulo precisa terminar com o rodapé
   `if (typeof module !== 'undefined') module.exports = api;` já usado em
   `mesh.js`, `tree.js` e `config.js`.
3. **Nenhuma dependência npm nova.** Nem de produção, nem de dev.
4. **`src/renderer/app.js` não tem testes** (é DOM + WebRTC puro, sem
   harness). Quando uma tarefa pede lógica nova testável, ela vai num
   módulo separado (`config.js`, `tree.js`, `mesh.js` ou um módulo novo) e
   `app.js` apenas chama. Nunca "teste" `app.js` com mocks improvisados.
5. **Todo módulo novo do renderer** segue o padrão IIFE dos existentes:
   `(function (root) { … root.GoLive.<nome> = api; if (typeof module !== 'undefined') module.exports = api; })(typeof window !== 'undefined' ? window : global);`
   e precisa de uma tag `<script>` em `src/renderer/index.html` **antes**
   de `app.js`.
6. **`npm test` (que roda `node --test`) tem de passar inteiro** — hoje são
   105 testes. Nenhum teste existente pode ser afastado, afrouxado ou
   deletado para uma mudança passar. Se um teste existente conflita com a
   tarefa, isso é um sinal para parar e reportar, não para reescrevê-lo.
7. **Um commit por tarefa** (ou poucos, coerentes), mensagem no estilo do
   repositório: `fix(escopo): …`, `feat(escopo): …`, `docs: …`, em
   português, sem acentos, minúsculas depois do prefixo.
8. **Não mexa em arquivos fora do escopo da sua tarefa.** Em particular:
   não reformate, não renomeie, não "arrume de passagem".

---

## Task 1: buffer de candidatos ICE + fila serial de sinalização (A1)

**Problema** (auditoria A1, o item de maior ganho da lista): `handleSignal`
é `async` e ninguém aguarda seu retorno
(`src/renderer/app.js:691` — `onMessage: (msg) => handleSignal(session, msg)`).
Duas mensagens seguidas do WebSocket rodam **concorrentes**. Na prática:
chega `offer` → `mesh.handleOffer` cria a `RTCPeerConnection`
(síncrono) e para em `await pc.setRemoteDescription(sdp)`; chega `ice` no
meio desse await → `handleIce` acha a conexão (ela já existe) e chama
`addIceCandidate` com `remoteDescription === null`, que pela spec do WebRTC
rejeita com `InvalidStateError`; o `catch` de `src/renderer/mesh.js:321`
engole o erro com o comentário "candidato tardio, ignorar" — **não é
tardio, é adiantado**. O mesmo vale pro par `answer`/`ice` do outro lado.
Perder o candidato host da VPN significa ICE que nunca fecha: o peer aparece
na lista e o vídeo nunca vem. Piora sob carga, que é justamente o cenário do
app.

### Parte A — buffer de ICE em `src/renderer/mesh.js`

Candidato que chega antes de a conexão ter `remoteDescription` deve ser
**guardado e drenado**, não descartado.

- Guarde os pendentes numa `WeakMap<RTCPeerConnection, RTCIceCandidateInit[]>`
  no escopo de `createMesh` (WeakMap para que o buffer morra junto com a
  `pc` quando ela é fechada e descartada — nada de vazar por peer que saiu).
- `handleIce(fromId, dir, candidate, kind)`: depois de achar `target` como
  hoje, se `target.remoteDescription` for nulo, empurre o candidato no
  buffer e retorne. Caso contrário, `await target.addIceCandidate(candidate)`
  dentro do try/catch existente — mas **corrija o comentário do catch**, que
  hoje mente sobre a causa.
- Nova função interna `drainIce(pc)`: `async`, esvazia o buffer daquela `pc`
  chamando `addIceCandidate` em cada candidato na ordem em que chegaram,
  ignorando falha individual (um candidato inválido não pode impedir os
  outros). Remova a entrada do WeakMap ao terminar.
- Chame `drainIce` **logo depois de cada `setRemoteDescription`**: em
  `handleOffer` (depois do `await pc.setRemoteDescription(sdp)`, antes do
  `createAnswer`) e em `handleAnswer` (depois do
  `await peer.outConns[kind].setRemoteDescription(sdp)`).
- **Limite o buffer** a 64 candidatos por conexão: um peer com defeito não
  pode fazer a memória crescer sem teto. Ao estourar, descarte o mais
  antigo (o buffer só existe por alguns milissegundos numa negociação sã).
  Defina o limite como constante nomeada no topo do arquivo, com comentário.
- Escreva um comentário de bloco acima do WeakMap explicando a corrida (é o
  estilo do arquivo) e citando "auditoria de 2026-08-27, item A1".

### Parte B — fila serial de sinalização

Crie o módulo **novo** `src/renderer/queue.js` exportando
`createSerialQueue()`, que devolve um objeto com um método
`push(fn) -> Promise`:

- encadeia `fn` no fim de uma promise interna, de modo que duas chamadas
  nunca rodem concorrentes, **na ordem exata em que `push` foi chamado**;
- uma `fn` que **rejeita ou lança** não pode quebrar a cadeia: as
  subsequentes continuam rodando normalmente;
- o `Promise` devolvido por `push` reflete o resultado daquela `fn`
  (resolve com seu valor, rejeita com seu erro) — quem chama pode ignorar,
  mas quem quiser aguardar consegue;
- uma `fn` **síncrona** que lança também não pode quebrar a cadeia.

Crie `src/renderer/queue.test.js` cobrindo, no mínimo: ordem preservada com
`fn`s de durações diferentes (a que demora mais tem de terminar antes da
seguinte começar); rejeição no meio não interrompe as seguintes; o valor de
retorno chega a quem chamou `push`; erro síncrono não quebra a cadeia.

Em `src/renderer/app.js`:

- adicione `queue` à desestruturação de `window.GoLive` no topo;
- dê à sessão uma fila própria em `joinRoom` (a fila morre com a sessão) e
  troque `onMessage: (msg) => handleSignal(session, msg)` por um `push` na
  fila dessa sessão;
- comentário curto no ponto da troca explicando por que a serialização é
  necessária (a corrida `offer`/`ice`), citando o item A1.

Adicione a tag `<script>` de `queue.js` em `src/renderer/index.html`, antes
de `app.js`, junto das outras.

### Verificação

- `npm test` passa inteiro, com os testes novos de `queue.test.js` e os
  novos de `mesh.test.js` (buffer de ICE) inclusos.
- Em `mesh.test.js`, use o mesmo estilo de dublê de `RTCPeerConnection` que
  os testes existentes daquele arquivo já usam — leia-os antes de inventar
  outro. Cubra: candidato que chega sem `remoteDescription` é guardado e
  entregue depois do `setRemoteDescription`; candidato que chega com
  `remoteDescription` presente é entregue na hora; o teto do buffer é
  respeitado.

---

## Task 2: limites de payload e taxa no WebSocket + sala no roteamento (B4, B5)

Arquivo único: `server/signaling-core.js` (e seus testes).

### B4 — `maxPayload` e limite de taxa

`new WebSocketServer({ port })` (`server/signaling-core.js:31`) usa o
`maxPayload` padrão de **100 MB**, e o servidor roda **no mesmo processo do
app de quem está jogando**. O avatar já aceita 256 KB por peer
(`signaling-core.js:102`) e é reenviado no `welcome` de cada entrada.

- Passe `maxPayload: 512 * 1024` na construção do `WebSocketServer`.
- Adicione um limite simples de mensagens por segundo por socket: um
  contador por conexão com janela de 1 segundo; ao estourar o teto, feche
  aquele socket (`ws.close(1008, 'flood')`) em vez de continuar processando.
  Escolha um teto folgado o bastante para não afetar uso normal — a
  sinalização normal são dezenas de mensagens por *sessão*, não por segundo;
  documente o número escolhido num comentário.
- Ambos precisam ser constantes nomeadas no topo do arquivo, com comentário
  explicando o porquê (estilo do repositório).

### B5 — remetente e destino na mesma sala

`case 'offer'/'answer'/'ice'/'view-state'/'tree'` faz
`peers.get(String(msg.to))` sem conferir `peer.room` contra a sala de quem
mandou. Inofensivo hoje (todo cliente entra na sala fixa `'geral'`), vira
bug no dia em que salas separadas existirem.

- No ponto único onde a mensagem é roteada para `msg.to`, exija que o
  destino exista **e** esteja na mesma `room` do remetente; caso contrário,
  descarte em silêncio, como já se faz com destino inexistente.

### Verificação

`npm test` passa inteiro. Acrescente testes em
`server/signaling-core.test.js`, no estilo dos que já existem lá:
roteamento entre salas diferentes é descartado; roteamento dentro da mesma
sala continua funcionando (não pode haver regressão — os testes existentes
já cobrem o caminho feliz e devem continuar passando sem alteração).

O limite de taxa é testável se a lógica de contagem estiver numa função
pura ou num objeto isolado — prefira essa forma a espalhar contadores pelo
handler.

---

## Task 3: qualidade em função do tamanho da sala (H4)

**Problema** (auditoria H4): `cfg.quality` é um preset escolhido uma vez e
aplicado sempre. O app sabe exatamente quantas pessoas há na sala
(`mesh.peers`) e não usa esse número pra nada. A medição do próprio projeto
diz que 4 espectadores a 1080p60 quebram o NVENC **sem jogo nenhum aberto**.
"1080p60 é o preset certo pra 1 espectador e o preset errado pra 3."

Isso combina com a decisão registrada de "app usual e fácil, sem opções
avançadas": ninguém escolhe nada, a sala só não entra no regime onde quebra.

### Parte A — lógica pura em `src/renderer/config.js`

- Defina uma **cadeia de degradação** explícita, preset → preset seguinte
  (ou `null` no piso). Ela derruba **fps antes de resolução**, porque a
  resolução é o que a pessoa escolheu ver:

  ```
  1440p60 -> 1440p30 -> 1080p30 -> 720p30
  1440p30 -> 1080p30 -> 720p30
  1080p60 -> 1080p30 -> 720p30
  1080p30 -> 720p30
  720p60  -> 720p30
  720p30  -> (piso, null)
  ```

  Note que a ordem por bitrate **não** serve como cadeia: `1440p30` (10
  Mbps) é mais barato que `1080p60` (12 Mbps), então "descer por bitrate"
  aumentaria a resolução. Escreva isso num comentário — é exatamente o tipo
  de armadilha que a próxima pessoa redescobriria.

- `degradePreset(preset, steps)`: anda `steps` passos na cadeia; para no
  piso; `steps <= 0` ou preset desconhecido devolve o preset de entrada
  (nunca lança).
- `audienceSteps(viewers)`: **0** para `viewers <= 2`, **1** para
  `viewers >= 3`. Exatamente isso, nada mais — a auditoria pede um degrau
  só. Sem segundo degrau, sem interpolação.
- `qualityForAudience(preset, viewers)`: devolve o objeto de qualidade
  completo (o mesmo formato de `qualityFromPreset`) já degradado. O campo
  `preset` do objeto devolvido é o preset **efetivo**, não o escolhido pelo
  usuário.
- Exporte as três em `api`.

### Parte B — uso em `src/renderer/app.js`

- `qualityFor(kind)` (`app.js:171`) passa a devolver, para o kind base
  `'screen'`, `config.qualityForAudience(cfg.quality.preset, audienceSize())`.
  O kind `'camera'` continua exatamente como está — a câmera é 720p30 de
  2 Mbps, já é o piso, e degradá-la não resolve nada.
- `audienceSize()`: número de pessoas na sala além de nós
  (`currentSession?.mesh.peers.size ?? 0`). Use o tamanho da **sala**, não a
  contagem de out-conns: com a árvore ligada a origem só tem 1–2 out-conns,
  então contar conexões faria a degradação nunca disparar, e o custo que
  interessa (o total de encoders na sala, incluindo os 2 do relay) escala
  com o tamanho da sala. Comente esse raciocínio no código.
- **Reaplique quando a sala muda de tamanho.** Hoje `peer-joined` e
  `peer-left` já chamam `recomputeTree`. Nos dois casos, se estivermos
  transmitindo aquele kind, chame também `mesh.applyEncoding(qualityFor(kind), kind)`
  para que as conexões **já abertas** peguem o novo teto — `applyEncoding`
  mexe em `maxBitrate`/`maxFramerate` via `setParameters`, sem renegociação
  e sem tela preta. Sem isso, só quem entrasse depois pegaria o preset novo.
- O preset **de captura** (`getDisplayMedia`) não muda no meio da
  transmissão: mexer nele exigiria recapturar. Só o encode se ajusta. Deixe
  isso escrito num comentário — é uma limitação consciente, não um
  esquecimento.

### Verificação

`npm test` passa. Acrescente testes em `src/renderer/config.test.js`, no
estilo dos existentes: a cadeia leva cada preset ao piso sem ciclo; um
passo a partir de `1080p60` dá `1080p30`; o piso não desce mais; preset
desconhecido e `steps` zero/negativo devolvem a entrada;
`audienceSteps` nos limites 0, 1, 2, 3, 4; `qualityForAudience` devolve
`1080p60` com 2 espectadores e `1080p30` com 3, com o campo `preset`
refletindo o efetivo.

---

## Task 4: cair pra malha nunca em qualidade cheia + histerese na re-eleição (H3)

**Problema** (auditoria H3): existe um laço que se realimenta e é
silencioso.

1. Soluço de ICE no link origem→relay vira falha (agora com a carência de
   5s de A2, mas ainda acontece).
2. O relay é vetado por 8s (`RELAY_FAILURE_COOLDOWN_MS`, `app.js:1632`).
3. Sala de 4 com duas pessoas transmitindo: sobram 2 candidatos, um já
   vetado. Vetou o segundo → `eligible` vazio → `computeTree` devolve
   `allDirect` (`tree.js:77`).
4. `allDirect` é a malha, e `applyOriginAssignments` re-oferta pra todo
   mundo **no preset cheio**.
5. N encoders de 1080p60 de novo → encoder de software → jitter → mais
   `disconnected` → volta ao passo 1.

Depende da Task 3 (a cadeia de degradação e `qualityFor` já existem).

### Parte A — a malha é o modo degradado

Sem relay elegível, a malha é o **fallback**, e o preset tem de degradar
junto: a origem passa a pagar N encoders em vez de 1.

- `tree.js`: `computeTree` precisa deixar quem chama saber que caiu no
  fallback de malha por falta de candidato elegível. Não mude a assinatura
  de retorno (`Map<peerId, assignment>`) — os testes existentes dependem
  dela e o `Map` é passado adiante por `applyOriginAssignments`. Em vez
  disso, exporte um helper puro que responda isso a partir do resultado,
  ex. `isAllDirect(assignments)` (verdadeiro quando **todo mundo** é
  `'direct'` e há pelo menos um peer). Teste-o.
- `app.js`: em `recomputeTree`, quando o resultado for malha degenerada
  **e** `cfg.network.tree` estiver ligado (ou seja, queríamos árvore e não
  conseguimos), aplique **um degrau extra** de degradação naquele kind, por
  cima do que a Task 3 já calcula. Concretamente: um estado por kind
  (ex. `meshFallback[kind] = true|false`) que `qualityFor` consulta para
  somar 1 a `audienceSteps`. Ao voltar a haver árvore de verdade, o estado
  volta a `false`.
- Sempre que esse estado mudar, chame `mesh.applyEncoding` naquele kind
  para as conexões já abertas seguirem junto.
- **Avise.** Hoje a árvore desliga sem log, sem toast, sem nada na UI. Use
  o `showToast` que já existe (`app.js:398`) na transição para o modo
  degradado, com texto curto e humano — algo como "Sem ninguém pra
  retransmitir: baixei a qualidade pra sala aguentar." Só na **transição**,
  nunca a cada recálculo, ou vira spam.

### Parte B — histerese na re-eleição

- Não re-eleger relay mais de uma vez a cada N segundos: guarde o instante
  da última re-eleição por kind e, dentro da janela, adie o recálculo
  (`setTimeout` para o fim da janela) em vez de descartá-lo — descartar
  perderia a última mudança de topologia, que é a que vale. Uma re-eleição
  já agendada não deve gerar uma segunda.
- Escolha a janela e justifique num comentário. Ela precisa ser maior que a
  carência de `disconnected` (5s, `mesh.js:22`) para não brigar com ela.
- `recomputeTree(kind, { force: true })` vindo de `recoverFromRelayLoss`
  **não** pode ser adiado: é o caminho que reconecta órfãs, e atrasá-lo
  deixa gente sem vídeo. A histerese vale só para o recálculo comum.

### Verificação

`npm test` passa, com testes novos em `tree.test.js` para `isAllDirect`
(malha degenerada é verdadeira; árvore com relay é falsa; mapa vazio é
falso). A parte de `app.js` não é testável hoje — descreva no relatório o
que verificou por leitura.

---

## Task 5: preservar a captura local através da reconexão (A3)

**Problema** (auditoria A3, casa com o relato registrado em
`Decisões/golive - árvore ligada por padrão, sem opção avançada`): no
`onClose` com queda anormal, o caminho de retry chama `teardownSession(session)`
(`app.js:722`), e `teardownSession` faz
`localStream.getTracks().forEach((t) => t.stop())` (`app.js:578`). A
reconexão funciona, mas quem estava transmitindo volta **sem transmitir**, e
precisa clicar em "Compartilhar tela" e escolher a fonte de novo. Como a
queda acontece justamente sob carga, a pessoa nem percebe até alguém avisar.

Só derrubar a captura quando a saída for **deliberada** (`leaveRoom`, troca
de sala) ou quando o retry desistir de vez.

### Mudanças em `src/renderer/app.js`

- Quebre `teardownSession(session)` em duas partes nomeadas:
  - `teardownMedia()` — para `localStream` e `cameraStream`, roda os
    `stopNativeAudioFns`, remove os tiles `'me'` e `'cam-me'`, tira o
    `active` de `#btn-toggle-share` e `#btn-toggle-camera`.
  - `teardownPeers(session)` — `removePeer` de todos, `dropTile` de cada um
    (peer e `cam-`), limpa `tileSource`.
  - `teardownSession(session)` continua existindo e continua fazendo
    **exatamente o que faz hoje** (`stopStatsLoop`, `resetTreeState`, as
    duas partes acima, `renderMembersPanel`), agora por composição. Todos os
    chamadores atuais de `teardownSession` que representam saída
    deliberada — `leaveRoom`, a troca de sala no topo de `joinRoom` — ficam
    inalterados.
- No caminho de **retry** do `onClose` (`app.js:714-730`), troque
  `teardownSession(session)` por: `stopStatsLoop()`, `resetTreeState()`,
  `teardownPeers(session)`, `renderMembersPanel()` — **sem** `teardownMedia()`.
  As conexões P2P morrem (a Task 6 trata disso), mas a **captura** sobrevive.
  Comente por quê, citando A3.
- No caminho de **desistência** (`app.js:732-745`), `teardownSession`
  continua: o retry desistiu, é o fim da sessão.
- Re-ofertar depois do `welcome`: no `case 'welcome'` de `handleSignal`
  (`app.js:874`), depois de `addPeer` de todos e do `renderMembersPanel`,
  se `localStream` existir, ofereça-o a **cada** peer de `msg.peers`
  (`mesh.offerTo(p.id, localStream, qualityFor('screen'), 'screen')`),
  depois `broadcastWatchers('screen')` e `recomputeTree('screen')` — o
  mesmo tratamento que `peer-joined` já dá a um peer novo. Idem para
  `cameraStream` com `'camera'`. Antes desta tarefa esse caminho era
  impossível (a captura nunca sobrevivia a um `welcome`), então ele não
  existe hoje.
  - Use `qualityFor(kind)`, **não** `cfg.quality` direto — a Task 3
    deixou `qualityFor` como a fonte da verdade, e o `peer-joined` que hoje
    usa `cfg.quality` (`app.js:885`) deve ser corrigido junto, por
    consistência.
  - Cada `offerTo` é `await`ado dentro de um try/catch que não deixa uma
    falha isolada abortar as demais.
- Reponha o estado visível de "estou transmitindo": depois de re-ofertar,
  garanta que o tile `'me'` continua na grade e que o botão continua
  `active` (se `teardownMedia` não rodou, os dois já estão de pé — confirme
  por leitura e não faça trabalho redundante).

### Verificação

Sem teste automatizado possível (é `app.js`). No relatório, liste
explicitamente: todos os chamadores de `teardownSession` antes e depois, e
por que cada um continua correto; e o que acontece com `localStream` em
cada um dos quatro caminhos (troca de sala, `leaveRoom`, retry, desistência).
`npm test` continua passando (105 testes).

---

## Task 6: perder a sinalização não pode matar a mídia (H1)

**Problema** (auditoria H1, junto com A3 é o maior ganho da lista): a nota
de decisão que rejeitou o SFU no host lista como motivo nº 2 que "hoje as
conexões são P2P diretas — o host cair só derruba a sinalização, o vídeo
continua". **O código faz o contrário.** `teardownSession` percorre todos
os peers e chama `mesh.removePeer`, que fecha todas as `RTCPeerConnection`
de entrada e saída, e é chamado direto do `onClose` do WebSocket. O host
fecha o app → cai a sinalização → o vídeo de todo mundo morre junto, **com
os links P2P intactos e funcionando**. A propriedade usada como argumento a
favor da malha nunca chegou a existir.

A sinalização só é necessária para *estabelecer* conexão; depois disso pode
sumir por minutos sem consequência.

Depende da Task 5 (`teardownMedia` / `teardownPeers` já separados).

### Desenho

Introduza um estado de **sessão órfã**: a sinalização caiu, mas a mídia
continua correndo.

- Módulo-level `let orphanSession = null`.
- No `onClose`, tanto no caminho de retry quanto no de desistência, em vez
  de destruir os peers: `orphanSession = session`, mantenha `session.mesh`
  e as `RTCPeerConnection` **intactas**, pare só o que depende da
  sinalização. Os tiles continuam na tela. `currentSession` continua indo
  para `null` (é o que faz callbacks tardios virarem no-op) — portanto todo
  código que hoje testa `currentSession !== session` e desiste vai desistir;
  isso é o comportamento desejado para *envio*, e os `onTrack`/`onPeerState`
  do mesh vão parar de agir. **Trate isso explicitamente**: os callbacks do
  mesh precisam continuar funcionando para a sessão órfã, senão um peer que
  morrer de verdade nunca some da tela. Ajuste a condição desses dois
  callbacks para aceitar `session === currentSession || session === orphanSession`.
- Um peer só é derrubado quando o `connectionstatechange` **daquele peer**
  disser que ele morreu — o que `mesh.js` já reporta via `onPeerState`
  com `failed: true`, agora com a carência de 5s de A2. Nada mais derruba
  peer nenhum.
- **UI**: mostre um estado claro e honesto enquanto órfã — que a conexão com
  a sala caiu e que o vídeo continua enquanto durar. Use os mecanismos que
  já existem (`#setup-error`, `showToast`, `renderHostWarning`), não
  invente componente novo. O botão de desconectar tem de continuar
  funcionando: `leaveRoom` hoje sai cedo com `if (!currentSession) return;` —
  ele precisa encerrar a órfã também (`teardownSession(orphanSession)`,
  `orphanSession = null`).
- **Descarte da órfã** — exatamente três gatilhos, e nenhum outro:
  1. uma reconexão **abre de verdade** (`onOpen` da sessão nova): aí as
     conexões P2P antigas estão mesmo mortas do outro lado (o servidor nos
     deu um id novo e os outros peers nos viram sair e entrar), então
     `teardownPeers(orphanSession)` — **e não** `teardownMedia`, que a Task
     5 já fez questão de preservar;
  2. `leaveRoom` (saída deliberada): `teardownSession` completo;
  3. `joinRoom` para outra sala: `teardownSession` completo.
- Enquanto a órfã existe, o loop de estatísticas pode continuar (as
  out-conns estão vivas e é a única telemetria restante). Decida e comente.

### Riscos a tratar explicitamente

- `emptyMessage()` e `renderMembersPanel()` dependem de `currentSession`.
  Com a órfã viva e `currentSession === null`, o painel de membros iria a
  "só você por aqui" enquanto ainda há gente com vídeo na tela — mentira
  visível. Faça esses dois consultarem a sessão **efetiva**
  (`currentSession || orphanSession`).
- Não pode existir **duas** sessões vivas ao mesmo tempo mandando coisa: a
  órfã tem `session.sig` fechado, e `mesh.send` já é guardado por
  `currentSession === session`, então ela é muda por construção. Confirme
  por leitura e registre no relatório.
- `resetTreeState()` zera `myId` e os papéis. Com a órfã viva, chamá-lo cedo
  demais quebra a leitura da topologia que ainda está no ar. Decida onde ele
  entra e justifique.

### Verificação

Sem teste automatizado (é `app.js`). No relatório: a tabela dos caminhos de
saída (troca de sala, `leaveRoom`, retry, desistência, reconexão bem
sucedida) × o que acontece com `localStream`, com as `RTCPeerConnection`,
com os tiles e com o painel de membros. `npm test` continua passando.

---

## Task 7: relay eleito por saúde de encode, não por RTT (H2)

**Problema** (auditoria H2): `computeTree` ordena candidatos por `rtt` e
desempata por `joinedAt` (`tree.js:68`). Mas o gargalo **medido** não é
rede, é encode: um relay com 5 ms de RTT e NVENC saturado é pior que um com
30 ms e GPU livre. E o dado certo **já é coletado e descartado** —
`readSenderReport` (`app.js`, seção de estatísticas) lê
`encoderImplementation`, `powerEfficientEncoder`, `msPerFrame` e
`qualityLimitationReason`, tudo vira uma tabela na aba Estatísticas e morre
ali. O único campo que volta pra uma decisão é o RTT.

Agrava: o relay roda **2 encoders** (um por filho) mais 1 decoder. É o
trabalho mais pesado da sala, dado a alguém sem perguntar se ele dá conta —
e que provavelmente também está jogando.

Depende das Tasks 3, 4 e 6 (mexem nos mesmos arredores).

### Parte A — a métrica, pura, em `src/renderer/tree.js`

- Acrescente ao contrato de candidato um campo opcional
  `encodeHealth: { softwareEncoder: boolean, msPerFrame: number|null } | null`.
- `computeTree` passa a ordenar os elegíveis por, nesta ordem:
  1. **encoder em software é veto** — quem codifica em software não pode ser
     relay se houver qualquer alternativa que não codifique em software.
     (Se *todos* forem software, não invente exclusão: ordene entre eles
     pelo resto.)
  2. `msPerFrame` acima do orçamento é **penalidade**, não veto. Defina o
     orçamento como constante nomeada, derivada do alvo de fps, e comente.
  3. RTT como desempate.
  4. `joinedAt` como desempate final (comportamento atual).
- `encodeHealth` ausente/`null` **não** pode virar veto: quem ainda não
  reportou nada é neutro, ordenado só por RTT/joinedAt como hoje. Um
  candidato sem dado nunca deve perder para um comprovadamente ruim.
- Os testes existentes de `tree.test.js` continuam passando sem alteração —
  eles não passam `encodeHealth`, então o comportamento sem o campo tem de
  ser idêntico ao de hoje. **Isto é a principal restrição desta tarefa.**

### Parte B — o transporte do dado, em `src/renderer/app.js`

- O canal já existe: `view-state` sobe do espectador para quem transmite.
  Anexe a esse `send` um resumo pequeno da própria saúde de encode
  (`softwareEncoder`, `msPerFrame`), derivado das amostras que
  `updateStats` já calcula. Não crie mensagem nova.
  - O servidor precisa deixar o campo passar. Confirme se ele repassa a
    mensagem inteira ou só campos escolhidos, e ajuste se preciso — e se
    ajustar, acrescente teste em `server/signaling-core.test.js`.
  - Um cliente de versão antiga não manda o campo: o lado que recebe tem de
    tratar ausência como `null` (o caso neutro da Parte A), nunca como zero
    ou como "saudável".
- Guarde o último resumo recebido por peer, e alimente `candidates` em
  `recomputeTree` com ele.
- **Só reporte saúde de encode quando estivermos de fato codificando**
  aquele kind. Quem não está mandando nada não tem `msPerFrame`, e reportar
  um valor inventado é pior que reportar `null`.

### Verificação

`npm test` passa. Testes novos em `tree.test.js`: veto de software com
alternativa disponível; sem alternativa, software não é excluído;
`msPerFrame` alto perde para `msPerFrame` baixo com RTT pior; candidato sem
`encodeHealth` não é penalizado nem favorecido indevidamente; e — o mais
importante — **os testes existentes continuam passando intactos**.

---

## Task 8: README em dia + STATUS.md (E1–E4)

Documentação. Nenhum código.

### E1 — a seção de qualidade descreve uma UI que não existe

A seção "Configurações de qualidade" do `README.md` fala de um modal
Configurações > **Transmissão** com controles de **bitrate**, **codec**
(H.264/VP9/AV1) e **áudio do sistema**. Hoje as categorias de Configurações
são `Perfil`, `Voz e Vídeo`, `Rede` e `Estatísticas`
(`src/renderer/index.html`), não existe aba Transmissão, a qualidade virou
um `select` de presets fechados dentro do diálogo de compartilhar
(`src/renderer/ui.js`), e o codec é fixo em H.264 (`src/renderer/config.js`),
sem VP9 nem AV1. Reescreva a seção para o que existe — **abra os arquivos e
confira**, não copie desta descrição.

Se as Tasks 3 e 4 já tiverem entrado, documente também que a qualidade se
ajusta sozinha ao tamanho da sala, e que a queda para malha degrada de
propósito.

### E2 — "Limites conhecidos" ainda descreve a malha pura

O README termina dizendo que "a malha P2P é o desenho certo pra 2-4 pessoas"
e que o caminho pra crescer é um SFU. A árvore de retransmissão foi
implementada, mesclada e está **sempre ligada** desde a 0.1.5, e o README
não a menciona em lugar nenhum. Descreva a árvore (origem → relay → folha,
fanout 1/2, profundidade 2) e o teto real de ~4 pessoas, com a razão
(`src/renderer/tree.js` tem os números e os comentários que explicam).

### E3 — o que falta

Acrescente ao README: a pasta de logs e o botão que a abre; o botão de
buscar atualização; e o botão "Permitir acesso à rede" do aviso de firewall
— que o README ainda descreve como "é copiar o texto mesmo", embora o botão
exista desde o PR #15.

### E4 — criar `STATUS.md`

Não existe `STATUS.md` no repositório, e hoje o estado real do projeto está
espalhado entre o README (desatualizado), seis specs e quatro planos em
`docs/superpowers/`. Crie um `STATUS.md` na raiz com: o que o app faz hoje,
a versão atual, o que está em andamento, o backlog técnico com ponteiro
para `docs/2026-08-27-auditoria-de-fragilidade.md`, e os itens
explicitamente fora de escopo (B1, D1, G1–G3, B6, F1, F4) com o motivo.
Curto — uma página. Ele existe para ser lido em trinta segundos por alguém
que voltou ao projeto depois de um mês, e para ser fácil de manter em dia.

### Verificação

`npm test` continua passando (nada de código mudou). Toda afirmação técnica
nova precisa ter sido conferida no arquivo correspondente — cite no
relatório qual arquivo confirmou cada uma. Não escreva nada sobre
comportamento que você não leu no código.

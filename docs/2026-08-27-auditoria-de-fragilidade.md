# GoLive LAN — auditoria de fragilidade (2026-08-27)

> **Nota de 2026-08-27 (pós-execução):** o corpo abaixo é o diagnóstico
> original e não foi reescrito. Boa parte do grupo A (A1–A7), B4, B5, C1–C3,
> C6, F2, G4 e o grupo H (H1–H4) já foi feita na branch
> `chore/robustez-e-higiene`.
> O estado atual — o que entrou, o que falta e o que ficou de fora de
> propósito — está em `STATUS.md`, na raiz. Consulte-o antes de agir sobre
> qualquer item daqui.

Leitura completa do código na `main` em `c06d8b6` (v0.1.8). Os 97 testes
automatizados passam; nada aqui é regressão do que já está coberto. O que
segue é o que **não** está coberto.

Cada item está marcado como:

- **[confirmado]** — verificado no código ou na máquina.
- **[provável]** — a leitura do código diz isso, mas não foi reproduzido.

Ordenado por "quanto isso te morde".

---

## Se você só fizer cinco coisas

1. **A1** — candidato ICE descartado por corrida. É o suspeito número um
   do "conecta, aparece o peer, mas o vídeo não vem".
2. **A2 + A3** — `disconnected` tratado como morte, e reconexão que mata a
   transmissão. Juntos explicam o relato do seu amigo (sair sozinho da sala
   compartilhando tela).
3. **C1 + C2** — sem CI, e o addon nativo não está no git. Um checkout
   limpo gera um instalador sem áudio por processo, em silêncio.
4. **B1** — Electron 32.3.3 está fora de suporte (Chromium 128).
5. **A4** — a checagem de firewall ignora `program=`, então a regra que
   você criou rodando `npm start` faz o app instalado achar que está
   liberado quando não está.

---

## A. Bugs de conexão e sessão

### A1. Candidato ICE chega antes do `setRemoteDescription` terminar e é jogado fora — [confirmado]

`signaling.connect` entrega cada mensagem direto pro `handleSignal`, que é
`async` e cujo retorno ninguém aguarda (`src/renderer/signaling.js:17`,
`src/renderer/app.js:684`). Duas mensagens seguidas do WebSocket rodam
**concorrentes**, não em fila.

Sequência real:

1. Chega `offer`. `handleSignal` chama `mesh.handleOffer`, que cria a
   `RTCPeerConnection` (síncrono) e para no `await pc.setRemoteDescription(sdp)`
   (`src/renderer/mesh.js:247`).
2. Chega `ice` no meio desse await. `handleIce` acha a conexão
   (ela já existe) e chama `addIceCandidate`.
3. Pela spec do WebRTC, `addIceCandidate` com `remoteDescription === null`
   rejeita com `InvalidStateError`.
4. O `catch` de `src/renderer/mesh.js:266` engole o erro com o comentário
   "candidato tardio, ignorar". **Não é tardio — é adiantado.**

O mesmo vale pro par `answer`/`ice` do outro lado.

Quantos candidatos se perdem depende de quão devagar o
`setRemoteDescription` roda — ou seja, **piora exatamente quando a máquina
está sob carga**, que é o cenário do app. Perder o candidato host da VPN
significa ICE que nunca fecha: o peer aparece na lista e o vídeo não vem.

**Correção:** as duas valem, e a segunda é a de verdade.

- Bufferizar candidatos por `(peerId, kind)` até `remoteDescription` existir,
  e drenar o buffer logo depois.
- Serializar `handleSignal` numa fila por peer (uma promise encadeada), pra
  que `offer` → `ice` nunca se cruzem. Isso conserta a classe inteira do
  problema, não só ICE.

### A2. `disconnected` é tratado como morte — [confirmado]

```js
const failed = ['failed', 'closed', 'disconnected'].includes(pc.connectionState);
```

(`src/renderer/mesh.js:155`)

`disconnected` é o estado **transitório** do ICE: perdeu conectividade,
está tentando de novo, e na maioria das vezes volta pra `connected` sozinho
em poucos segundos. Num túnel Radmin com jitter isso acontece o tempo todo.

Hoje, um soluço de 2 segundos causa:

- `clearInStream` + `removedTile` — o tile some;
- se você for relay daquele conteúdo, `dropRelaysOf` fecha **todos** os
  repasses (`src/renderer/app.js:790`);
- se você for a origem, `recoverFromRelayLoss` fecha a conexão com o relay,
  veta ele por 8s e re-elege a árvore inteira (`src/renderer/app.js:1704`).

Ou seja: um soluço que ia se curar sozinho vira uma reconstrução completa
da topologia, com tela preta pra todo mundo.

**Correção:** reagir só a `failed` e `closed`. Pra `disconnected`, armar um
timer de ~5s e só tratar como falha se não tiver voltado.

### A3. Reconexão automática mata o compartilhamento de tela — [confirmado]

No `onClose` com queda anormal, o caminho de retry chama
`teardownSession(session)` (`src/renderer/app.js:718`), e `teardownSession`
faz `localStream.getTracks().forEach(t => t.stop())`
(`src/renderer/app.js:572`).

Resultado: a reconexão até funciona, mas quem estava transmitindo volta
**sem transmitir**, e precisa clicar em "Compartilhar tela" e escolher a
fonte de novo. Como a queda costuma acontecer justamente sob carga (durante
o jogo), a pessoa nem percebe até alguém avisar.

Isso casa exatamente com o relato registrado em
`Decisões/golive - árvore ligada por padrão, sem opção avançada`.

**Correção:** manter `localStream`/`cameraStream` vivos através da
reconexão e re-ofertar depois do `welcome`. Só derrubar a captura quando a
saída for deliberada (`leaveRoom`) ou quando o retry desistir de vez.

### A4. Firewall: a checagem ignora qual executável a regra libera — [confirmado]

`ruleCoversPort` (`src/main/firewall.js:19`) roda
`netsh advfirewall firewall show rule name="GoLive"` e só olha as linhas
`LocalPort:`. Ela **não** compara o `program=`.

Como o nome da regra é a constante `"GoLive"` pra qualquer executável:

- você roda `npm start` uma vez → cria regra "GoLive" na porta 9000 pra
  `node_modules\electron\dist\electron.exe`;
- depois instala o app → `ruleCoversPort(9000)` acha a regra pelo nome e
  pela porta, devolve `true`;
- o app relata `firewall: { ok: true }`, não mostra o aviso, **e o
  executável instalado continua bloqueado**.

Verificado nesta máquina: a regra existe e o `netsh` devolve
`Nome da Regra: GoLive` / `LocalPort: 9000`, sem nenhuma referência a
programa no filtro que o código lê.

Dois detalhes de lambuja:

- `/No rules match/i` (`firewall.js:27`) é código morto em Windows pt-BR —
  a mensagem é "Nenhuma regra corresponde…". Não quebra nada porque o
  `netsh` sai com código de erro e cai no `catch`, mas confia numa string
  em inglês num app feito pra brasileiros.
- Cada porta nova (9000–9010) adiciona **outra** regra chamada "GoLive".
  Elas se acumulam no firewall e nunca são removidas.

**Correção:** trocar `netsh` por PowerShell, que é estruturado e não
localizado:
`Get-NetFirewallRule -DisplayName GoLive | Get-NetFirewallApplicationFilter`
e comparar `Program` com `process.execPath`. Ou incluir um hash do execPath
no nome da regra (`GoLive-<hash>`), o que também resolve o acúmulo.

### A5. A tela compartilhada pode não ser a que o usuário escolheu — [confirmado]

```js
const chosen = sources.find((s) => s.id === selectedSourceId) || sources[0];
```

(`src/main.js:187`)

Se a janela escolhida fechou entre o clique no card e o `getDisplayMedia`
(ou se o id mudou), o app cai silenciosamente em `sources[0]` — que é
tipicamente o **monitor principal inteiro**.

A pessoa acha que está mostrando uma janela de jogo e está mostrando a área
de trabalho, o Discord e o que mais estiver aberto. É o único bug de
privacidade real da lista.

**Correção:** `callback({})` quando o id escolhido não existe mais, e
mostrar "a janela que você escolheu não existe mais" no renderer.

### A6. `handleSignal` não tem try/catch — [confirmado]

Todo `await` dentro de `handleSignal` (`app.js:857`) pode rejeitar:
`setRemoteDescription` com SDP inesperado, `createAnswer` numa conexão já
fechada, `flushPendingRelay`. Como ninguém aguarda o retorno, vira
`unhandledrejection` — que só aparece como texto no log via
`console-message`, sem contexto de qual mensagem causou.

**Correção:** envolver o `switch` num try/catch que loga `msg.type`,
`msg.from` e `msg.kind`. Barato, e vai encurtar a próxima investigação.

### A7. `myId` nunca é zerado — [confirmado]

`myId` é setado no `welcome` (`app.js:868`) e nunca volta a `null` — nem em
`teardownSession`, nem em `leaveRoom`, nem em `resetTreeState`. Ele é usado
como `origem` nas mensagens `tree` (`app.js:1753`) e como `originId` no
cálculo da árvore.

Não achei um caminho em que isso quebre hoje (`recomputeTree` exige stream
local, que exige sessão viva). Mas é exatamente o tipo de estado
sobrevivente que o resto do arquivo tomou o cuidado de matar — e o comentário
de `resetTreeState` explica por quê. Zerar junto.

### A8. Renegociação não é suportada; `stopCamera` sobrevive por acidente — [provável]

`ensureInConn` (`mesh.js:182`) **fecha e recria** a `RTCPeerConnection`
sempre que chega uma `offer` daquele kind. Isso está certo pra uma oferta
nova, e errado pra uma renegociação na conexão existente.

`removeTrack` (`mesh.js:305`) faz exatamente uma renegociação: cria uma
oferta nova na mesma `pc` e manda. Do outro lado, `ensureInConn` mata a
conexão e monta outra do zero, com ICE ufrag e fingerprint DTLS novos — o
que a `pc` do ofertante não espera receber como resposta.

Na prática o único usuário disso é desligar a câmera, e o efeito desejado
(vídeo some) acontece de qualquer jeito. Mas o desenho não suporta
renegociação, e qualquer feature futura que precise dela (trocar de fonte
sem derrubar a conexão, adicionar áudio no meio) vai bater nisso.

**Correção:** marcar a oferta de renegociação (ex.: `renegotiate: true` na
mensagem) e, nesse caso, reusar a `inConn` existente em vez de recriar.

---

## B. Segurança

### B1. Electron 32.3.3 está fora de suporte — [confirmado]

Electron 32 saiu de suporte em 2025; ele carrega Chromium 128. Todo CVE de
Chromium desde então está aberto neste app, e ele renderiza conteúdo que
vem de outras máquinas (nomes, avatares como data URL, SDP).

Bônus de subir: WGC melhor (as flags marcadas como NÃO VERIFICADAS em
`main.js:27` mudaram de nome justamente entre versões), encode AV1 por
hardware mais maduro, e o `console-message` com assinatura nova (o handler
de `main.js:171` vai precisar de ajuste — vale conferir na hora da subida).

### B2. 14 vulnerabilidades em devDeps — [confirmado]

`npm audit`: 14 (13 high, 1 critical), todas na cadeia do `node-gyp@9`
(`make-fetch-happen`, `cacache`, `tar`). `npm audit --omit=dev` dá **0** —
não afeta quem usa o app, só a sua máquina de build. Subir pro `node-gyp@10+`
resolve.

### B3. Sala sem autenticação nenhuma — [confirmado, por desenho]

Qualquer um que alcance o IP:porta entra na sala e vê todas as
transmissões. Não há senha, PIN, nem lista de convidados. E o beacon UDP
(`src/main/discovery.js`) **anuncia a sala ativamente** pra rede inteira,
com nome e contagem de gente.

Numa rede Radmin pública ou numa rede compartilhada (república, escritório,
faculdade), isso é entrar sem bater. Provavelmente aceitável pro seu uso —
mas é uma decisão que hoje está implícita no código, não escrita em lugar
nenhum.

**Correção mínima, se quiser:** um PIN de 4 dígitos gerado com a sala,
validado no `join` do servidor (`server/signaling-core.js:98`), mostrado ao
lado do endereço. Não precisa de cripto: só corta o entrar-por-acidente.

### B4. Sem limite de payload nem de taxa no WebSocket — [confirmado]

`new WebSocketServer({ port })` (`signaling-core.js:31`) usa o `maxPayload`
padrão de 100 MB. O avatar já aceita 256 KB por peer
(`signaling-core.js:102`) e é reenviado no `welcome` de cada entrada.

Um cliente com bug (ou um `for` mal escrito) consegue segurar o servidor
embutido — que roda no mesmo processo do app de quem está jogando.

**Correção:** `maxPayload: 512 * 1024` e um contador simples de mensagens
por segundo por socket.

### B5. O servidor não valida se remetente e destino estão na mesma sala — [confirmado]

`case 'offer'/'answer'/'ice'/'view-state'/'tree'` faz
`peers.get(String(msg.to))` sem conferir `peer.room`
(`signaling-core.js:121`). Inofensivo hoje, porque todo cliente entra na
sala fixa `'geral'`. Vira bug no dia em que salas separadas existirem —
e a linha que conserta é uma só.

### B6. Instalador sem assinatura de código — [confirmado]

O NSIS sai sem assinatura: SmartScreen avisa em toda instalação, e o
updater confia apenas no `sha512` do `latest.yml` servido pelo GitHub.
Aceitável entre amigos; só registre que é uma escolha, não um esquecimento.

---

## C. Build e release — a parte mais frágil do projeto

### C1. Não existe CI — [confirmado]

Não há `.github/` no repositório. Os 97 testes só rodam quando você lembra
de rodar. Nenhum dos 15 PRs mesclados teve verificação automática.

**Correção:** um workflow de ~15 linhas rodando `node --test` em cada push
e PR. É o item de melhor relação custo/benefício da lista inteira.

### C2. O addon nativo não está no git, mas está listado no build — [confirmado]

`.gitignore` tem `build/`. `package.json` tem
`"build/Release/golive_audio.node"` em `build.files`.

Num checkout limpo esse arquivo não existe. O electron-builder **não
reclama** de um caminho literal que não casa com nada — ele simplesmente
não empacota. O instalador sai normal, instala normal, abre normal, e
`require` do addon cai no `catch` de `src/main.js:61` que define
`audioAddon = null`.

O efeito silencioso disso:

- "Incluir o som do Discord" para de funcionar;
- o modo lista-de-inclusão some;
- **a exclusão do próprio processo do GoLive some** — que é o que evita o
  eco/loop quando duas pessoas compartilham tela e se ouvem
  (o comentário em `app.js:1233` explica bem o porquê).

Tudo isso sem um erro, sem um aviso na UI, sem uma linha no log.

**Correção:** as três juntas.

- Logar explicitamente "addon de áudio nativo indisponível" no `catch` de
  `main.js:61` — hoje ele é vazio.
- Fazer o build falhar se o `.node` não existir (uma checagem no script
  `dist`).
- Decidir conscientemente: ou versionar o `.node` compilado (é um binário
  pequeno, e o projeto é só Windows/x64), ou compilar no CI.

### C3. O `.node` vai dentro do `app.asar` — [confirmado]

Verificado no `app.asar` do último build: `build/Release/golive_audio.node`
está lá dentro, e não existe `app.asar.unpacked` em `resources/`.

Funciona hoje porque o Electron intercepta o `process.dlopen` e copia o
arquivo pro diretório temporário antes de carregar. Mas isso significa uma
extração pro `%TEMP%` a cada abertura — sujeita a antivírus, política de
pasta temporária e permissão.

**Correção:** `"asarUnpack": ["build/Release/*.node"]` no bloco `build`.

### C4. `dist/` acumulou 1,2 GB — [confirmado]

Nove instaladores (0.1.0 a 0.1.8), mais `win-unpacked`, mais blockmaps.
Está no `.gitignore`, então não polui o repositório — só o seu disco. Os
`.exe` que importam já estão nos Releases do GitHub.

### C5. Branches e worktree obsoletos — [confirmado]

Já mescladas e ainda vivas: `discord-redesign`, `master` (idêntica à
`main`), `native-audio-capture-and-ui-fixes`, `worktree-golive-installable-ui`,
`fase2-arvore-retransmissao`. Não mescladas e provavelmente mortas:
`fix/csp-websocket-connect`, `performance-fase1`,
`worktree-agent-a7a0f97350214bfe3`, `worktree-agent-ae919cdfc1ebecc44`.

Além disso, `.worktrees/fase2-arvore` continua registrado como worktree,
apontando pra uma branch já mesclada.

### C6. Metadados do pacote incompletos — [confirmado]

`package.json` não tem `license`, `repository`, `author` nem `engines`. Não
existe arquivo `LICENSE` no repositório — ou seja, hoje o projeto é
tecnicamente "todos os direitos reservados", o que provavelmente não é o que
você quer pra algo que nasceu de um problema coletivo.

### C7. Sem lint nem formatador — [confirmado]

17 mil linhas, nenhum ESLint. Um ESLint com `no-floating-promises`
pegaria sozinho boa parte do grupo A (A6 inclusive).

---

## D. Testes

### D1. O arquivo mais complexo é o único sem teste — [confirmado]

| arquivo | linhas | testes |
|---|---|---|
| `src/renderer/app.js` | 2007 | **0** |
| `src/renderer/ui.js` | 1250 | **0** |
| `src/renderer/mesh.js` | 478 | 380 linhas de teste |
| `src/renderer/tree.js` | 97 | 163 linhas de teste |
| `server/signaling-core.js` | 182 | 218 linhas de teste |

`tree.js` (o cálculo puro da topologia) está bem coberto. Mas a
**orquestração** — quem chama `recomputeTree`, quando `flushPendingRelay`
roda, o que sobrevive a um teardown, a ordem de `recoverFromRelayLoss` — mora
em `app.js` e não tem um teste sequer. É exatamente onde os bugs de F2
apareceram durante a implementação (ver os commits `fix(f2):` da série).

**Correção:** extrair de `app.js` um módulo puro de orquestração de sessão e
árvore (entra: eventos; sai: lista de ações), no mesmo espírito de como
`discovery.js` separou a lógica pura do socket. Aí ele fica testável sem
DOM nem WebRTC.

### D2. Nenhum teste ponta a ponta de sinalização — [confirmado]

`signaling-core.test.js` testa o servidor isolado. Não há um teste que suba
o servidor, conecte dois clientes falsos e verifique um handshake
`join → welcome → offer → answer → ice` completo. Seria o teste que pegaria
A1.

---

## E. Documentação fora de sincronia

### E1. O README descreve uma interface que não existe mais — [confirmado]

A seção "Configurações de qualidade" do README fala de um modal
Configurações > **Transmissão** com controles de **bitrate**, **codec**
(H.264/VP9/AV1) e **áudio do sistema**.

Hoje as categorias de Configurações são `Perfil`, `Voz e Vídeo`, `Rede` e
`Estatísticas` (`src/renderer/index.html:105-108`) — não existe aba
Transmissão. A qualidade virou um `select` de presets fechados dentro do
diálogo de compartilhar (`ui.js:1052`), e o codec é fixo em H.264
(`config.js:25`), sem opção de VP9 ou AV1.

Quem ler o README hoje vai procurar botões que não existem.

### E2. "Limites conhecidos" ainda descreve a malha pura — [confirmado]

O README termina dizendo que "a malha P2P é o desenho certo pra 2-4 pessoas"
e que o caminho pra crescer é um SFU. A árvore de retransmissão foi
implementada, mesclada e está **sempre ligada** desde 0.1.5 — decisão
registrada em `Decisões/golive - árvore ligada por padrão, sem opção avançada`.
O README não menciona a árvore em lugar nenhum.

### E3. Faltam no README — [confirmado]

Pasta de logs e o botão que a abre (`logs:openFolder`), o botão de buscar
atualização, e o botão "Permitir acesso à rede" do aviso de firewall — que
o próprio README ainda descreve como "é copiar o texto mesmo", embora o
botão exista desde o PR #15.

### E4. Não existe `STATUS.md` — [confirmado]

O vault trata `STATUS.md` como o lugar do backlog técnico ("o backlog
técnico mora na spec"), mas o repositório não tem esse arquivo. Hoje o
estado real do projeto está espalhado entre o README (desatualizado), seis
specs e quatro planos em `docs/superpowers/`, e as notas do vault.

### E5. Uma nota do vault ficou errada — [confirmado]

`Decisões/golive - atualização silenciosa sem consentimento nem instalador.md`
está marcada como **fechada** e diz que `autoInstallOnAppQuit = true` e que o
botão "Reiniciar e atualizar" foi removido.

O código hoje diz o contrário: `src/main/updater.js:60-61` tem
`autoDownload = false` e `autoInstallOnAppQuit = false`, e o botão
`#update-banner-action` ("Reiniciar e instalar") existe em
`index.html:15`. A spec de 2026-08-26 (PR #14) reverteu aquela decisão.

Pela regra do vault, o repositório vence e a nota precisa de correção —
provavelmente reabrindo-a com o motivo da volta atrás.

---

## F. Interface e produto

### F1. Zero atributos de acessibilidade — [confirmado]

`grep -c "aria-"` no `index.html` devolve **0**. Botões de ícone se apoiam
só em `title`, e `:focus-visible` aparece em 2 lugares no CSS inteiro.
`prefers-reduced-motion` está tratado (bom) — a acessibilidade parou aí.

### F2. `alert()` nativo para erros de captura — [confirmado]

Três lugares (`app.js:255`, `1289`, `1407`) usam `alert()`. Ele **bloqueia
o processo do renderer** — no meio de uma transmissão, isso congela a
pintura e trava a UI até alguém clicar. E some atrás do jogo em fullscreen.
Você já tem um `showToast` (`app.js:388`); usar ele.

### F3. Se o host cai, a sala morre — [confirmado, por desenho]

Documentado no README, mas continua sendo o limite mais duro do produto:
não há transferência de sala. O servidor de sinalização mora no processo de
quem criou. Se essa pessoa fecha o app, todo mundo cai.

### F4. O redesign "Superfície e sinal" continua em aberto — [confirmado]

A nota `Decisões/golive - acento reservado a ao vivo, sem blur no redesign`
está com `status: em aberto` e diz "a spec está escrita, nada foi
implementado". Continua verdade: o CSS atual ainda é o tema clone do Discord.

---

## G. Desempenho e arquitetura

### G1. Áudio nativo atravessa o IPC como PCM cru — [confirmado]

O addon entrega pacotes a cada `GetBuffer` (`loopback_capture.cc:286`), que
viram `sender.send('audio:chunk', ...)` (`main.js:454`) e chegam no
renderer como `Float32Array` por structured clone. A ~10 ms por pacote, são
**~100 mensagens por segundo, por captura**.

No modo lista-de-inclusão isso é **uma captura por processo tocando som** —
navegador, jogo, player, notificações. Cinco processos = ~500 mensagens/s
de IPC + 500 alocações de `Float32Array`/s, no processo principal do app,
durante o jogo. É trabalho invisível competindo pela mesma CPU que a spec
de performance está tentando liberar.

**Correção:** agrupar pacotes em blocos de ~40-60 ms antes de mandar, ou
trocar o IPC por `SharedArrayBuffer` com ring buffer.

### G2. `LoopbackCapture::Stop()` pode congelar o processo principal por até 5s — [provável]

`Stop()` (`loopback_capture.cc:147`) e o destrutor fazem
`thread_.join()` — na thread do JS. Se a thread de captura ainda estiver
dentro do `WaitForSingleObject(handler->event_, 5000)` da ativação COM
(`loopback_capture.cc:195`), o `join` espera até esse timeout inteiro.

`audio:stopCapture` é um `ipcMain.handle` síncrono
(`main.js:476`), e `window-all-closed` (`main.js:220`) para todas as
capturas em sequência. Fechar o app logo depois de começar a compartilhar
pode travar a janela por segundos.

**Correção:** sinalizar o evento de ativação no `stop` (um segundo
`HANDLE` de cancelamento em `WaitForMultipleObjects`), pra que a thread saia
na hora.

### G3. `NonBlockingCall` que falha vaza o chunk — [confirmado]

`tsfnData_.NonBlockingCall(chunk, DeliverAudioChunk)`
(`loopback_capture.cc:286`) ignora o `napi_status` de retorno. Quando a
`ThreadSafeFunction` já está fechando, a chamada não acontece,
`DeliverAudioChunk` nunca roda e o `delete chunk` de dentro dela nunca
acontece. Vazamento pequeno e limitado ao encerramento — mas é `new` sem
`delete`, e o comentário de `loopback_capture.cc:17` promete o contrário.

### G4. `findFreeServer` deixa servidores pendurados — [confirmado]

Em `createSignalingServer` (`signaling-core.js:29`), o `reject(err)` do
`EADDRINUSE` não fecha o `WebSocketServer` que acabou de ser criado
(`signaling-core.js:31`). `findFreeServer` (`src/main/ports.js:14`) tenta
até 11 portas em sequência — cada falha deixa um objeto de servidor e seu
`http.Server` interno pra trás.

Não vaza porta (o bind falhou), mas vaza objeto e listener a cada tentativa,
e roda de novo a cada "Criar sala".

**Correção:** `wss.close()` dentro do `onError` antes do `reject`.

### G5. `sources:list` codifica um PNG por janela — [confirmado, já conhecido]

Cada thumbnail vira data URL via `s.thumbnail.toDataURL()`
(`main.js:272`). O comentário no código já reconhece o custo e já reduziu o
tamanho pra 224x126. Com muitas janelas abertas isso ainda é um pico de CPU
no processo principal, no exato momento em que a pessoa vai começar a
transmitir. Um `nativeImage.toJPEG(70)` corta isso bastante.

### G6. Limite estrutural: a sala não passa de ~4 — [confirmado, por desenho]

`FANOUT_ORIGEM = 1`, `FANOUT_RELAY = 2`, `PROFUNDIDADE_MAX = 2`
(`src/renderer/tree.js:10-12`). Quem sobra vira `direct` — ou seja, volta a
custar um encoder na origem. Com 6 espectadores: 1 relay + 2 folhas + 3
diretos = **4 encoders na origem**, que é o problema que a árvore existe pra
resolver, de volta.

Não é bug — a spec assume sala de 4. Mas o comportamento de excedente é
decisão do módulo, não da spec (o próprio comentário de `tree.js:52` diz
isso), e vale saber que o teto é esse.

---

## H. O degrau que falta — transmissão de tela

Os grupos acima são defeitos pontuais. Este é a leitura de conjunto sobre a
transmissão em si, depois de reler as notas
`Decisões/golive - árvore de retransmissão em vez de SFU no host` e
`Decisões/golive - árvore ligada por padrão, sem opção avançada`.

**A fragilidade não é a topologia. É que todo modo de falha do app é
binário** — ou funciona, ou a sessão acaba. Não existe estado intermediário.
A árvore resolveu o problema certo (N encoders na origem, medido). O que
sobrou não é defeito de desenho da árvore: é a ausência de um degrau entre
"tudo bem" e "acabou".

### H1. A vantagem que justificou rejeitar o SFU não está implementada — [confirmado]

A nota de decisão da árvore lista, como motivo nº 2 pra descartar o SFU no
host:

> "Hoje as conexões são P2P diretas — o host cair só derruba a sinalização,
> o vídeo continua."

**O código faz o contrário.** `teardownSession` (`app.js:568`) percorre
todos os peers e chama `mesh.removePeer`, que fecha todas as
`RTCPeerConnection` de entrada e saída (`mesh.js:127`). E `teardownSession`
é chamado direto do `onClose` do WebSocket, tanto no caminho de retry
(`app.js:718`) quanto no de desistência (`app.js:735`).

Ou seja: o host fecha o app → cai a sinalização → **o vídeo de todo mundo
morre junto**, com os links P2P intactos e funcionando. A propriedade que
foi usada como argumento a favor da malha nunca chegou a existir.

Isso é a fragilidade central da transmissão, e ela é gratuita de resolver.
A sinalização só é necessária pra *estabelecer* conexão; depois disso pode
sumir por minutos sem consequência.

**Correção:** separar os ciclos de vida. Perder a sinalização vira um estado
"reconectando" — a UI avisa, ninguém entra nem sai, mas as tracks continuam
correndo. Só derrubar um peer quando o `connectionstatechange` daquele peer
disser que ele morreu (com a carência de A2), ou quando o retry desistir de
vez. Junto com A3 (manter `localStream` vivo), isso transforma o sintoma
relatado — "saiu sozinho da sala compartilhando tela" — em "sumiu a lista
de gente por três segundos".

### H2. O relay é eleito pelo RTT, a única métrica irrelevante pro problema — [confirmado]

`computeTree` ordena candidatos por `rtt` e desempata por `joinedAt`
(`tree.js:68`). Mas o gargalo **medido** não é rede, é encode: um relay com
5 ms de RTT e NVENC saturado é pior que um com 30 ms e GPU livre.

E o dado certo já é coletado e descartado. `readSenderReport`
(`app.js:1797`) lê `encoderImplementation`, `powerEfficientEncoder`,
`msPerFrame` e `qualityLimitationReason` — tudo isso vira uma tabela na aba
Estatísticas e morre ali. O único campo que volta pra uma decisão é o RTT
(`app.js:1900`).

Agrava: o relay roda **2 encoders** (um por filho, `FANOUT_RELAY = 2`) mais
1 decoder. É o trabalho mais pesado da sala, dado a alguém sem perguntar se
ele dá conta — e que provavelmente também está jogando.

**Correção:** cada peer manda um indicador simples de saúde de encode rio
acima (o canal já existe — `view-state` sobe até a origem), e `computeTree`
ordena por ele, com RTT como desempate. Não precisa inventar métrica:
encoder em software é veto, `msPerFrame` acima do orçamento é penalidade.

### H3. Quando a árvore desmorona, ela cai no estado que derrete o encoder — [confirmado]

Laço que o código permite hoje:

1. Soluço de ICE no link origem→relay. `disconnected` está na mesma lista
   que `failed` (`mesh.js:155`, ver A2) → `recoverFromRelayLoss`.
2. O relay é vetado por 8s (`RELAY_FAILURE_COOLDOWN_MS`, `app.js:1613`).
3. Sala de 4 com duas pessoas transmitindo: sobram 2 candidatos, um já
   vetado. Vetou o segundo → `eligible` vazio → `computeTree` devolve
   `allDirect` (`tree.js:77`).
4. `allDirect` é a malha. `applyOriginAssignments` re-oferta pra todo mundo
   **no preset cheio** — `qualityFor(kind)` devolve sempre `cfg.quality`
   (`app.js:1745`).
5. N encoders de 1080p60 de novo → encoder de software → jitter → mais
   `disconnected` → volta ao passo 1.

Realimenta e é silencioso: não há log, nem aviso, nem nada na UI dizendo
que a árvore desligou.

**Correção**, em ordem de importância:
- carência de ~5s no `disconnected` antes de tratar como falha (é A2);
- histerese na re-eleição: não trocar de relay por ganho marginal, não
  re-eleger mais de uma vez a cada N segundos;
- **cair pra malha nunca deve ser em qualidade cheia.** Sem relay elegível,
  a malha é o modo degradado — e o preset tem que degradar junto.

### H4. A qualidade é fixa, independente de quantas pessoas estão assistindo — [confirmado]

`cfg.quality` é um preset escolhido uma vez e aplicado sempre. O app sabe
exatamente quantos espectadores tem (`mesh.peers`) e não usa esse número
pra nada.

A medição do próprio projeto diz que 4 espectadores a 1080p60 quebram o
NVENC **sem jogo nenhum aberto**. E o README já tem a tabela que relaciona
espectadores com banda. O conhecimento existe; só não está no código.

É a mudança mais barata desta seção, e a que mais combina com a decisão de
"app usual e fácil, sem opções avançadas": **1080p60 é o preset certo pra 1
espectador e o preset errado pra 3.** Em vez de fixo, derivado — 1 ou 2
espectadores: 1080p60; 3 ou mais: 1080p30, subindo sozinho pra 60 se a
telemetria mostrar folga por alguns segundos. Ninguém escolhe nada, e a
sala não entra no regime onde ela quebra.

No mesmo espírito: hoje `qualityLimitationReason: "cpu"` e encoder em
software produzem **texto** (`updateEncoderWarning`, `app.js:1996`).
Deviam produzir **ação** — descer um degrau, avisar, e tentar voltar depois.
A diferença entre um app frágil e um robusto quase sempre é essa: o frágil
relata o problema, o robusto reage a ele.

### H5. A contabilidade honesta da árvore, e o que reduziria o total — [confirmado]

Sala de 4 (origem + 3 espectadores):

| topologia | encoders na origem | encoders no sistema | decoders extras | hops |
|---|---|---|---|---|
| malha | 3 | 3 | 0 | 1 |
| árvore (hoje) | 1 | **3** (1 + 2 no relay) | 1 | 2 |
| encode-once | 1 | **1** | 0 | 1 |

A árvore resolve o problema que existia — o custo na *origem* — e resolve de
verdade. Mas não reduz o total: move dois encoders pra cima de um espectador
que provavelmente também está jogando, e paga por isso com um decode a mais,
perda geracional, um hop de latência e toda a máquina de estado de
recuperação, que é de onde vêm H2 e H3.

A única forma que reduz o total é **codificar uma vez e distribuir o
bitstream**: `VideoEncoder` do WebCodecs com `prefer-hardware` (uma sessão
de NVENC, independente do número de espectadores), chunks saindo por
`RTCDataChannel` pra cada peer, `VideoDecoder` do outro lado.

Isso responde três das seis objeções feitas ao SFU: não há dependência nova,
não há ponto único de falha (continua P2P direto) e não há hop extra. Mas
**não responde a objeção nº 4, que era a mais séria** — congestion control
não vem pronto, e junto se perdem o jitter buffer, o PLI/FIR pra keyframe e
a sincronia A/V de graça do RTP.

Numa LAN com bitrate declarado pelo usuário, GCC pesa bem menos que na
internet aberta — o usuário já declara a banda, é literalmente o que o
README manda ele fazer antes de instalar. Mas sincronia de áudio e vídeo
passaria a ser problema da aplicação, e isso é caro de acertar.

**Leitura: não vale hoje.** É o plano B se, depois de H1–H4, a sala de 4
ainda quebrar. Fica registrado aqui pra não ser redescoberto do zero daqui
a três meses.

### H6. O SFU não reabre — [confirmado]

A condição de reabertura escrita na própria nota —
"salas de 5+ pessoas com um host de upload gordo que não joga" — não
aconteceu. A decisão continua válida como está. Nada nesta auditoria mexe
nela.

---

## Resumo por esforço

| Correção | Esforço | Ganho |
|---|---|---|
| CI rodando `node --test` (C1) | 15 min | alto |
| `wss.close()` no erro (G4) | 5 min | baixo |
| Logar addon nativo ausente (C2) | 5 min | alto |
| `asarUnpack` do `.node` (C3) | 5 min | médio |
| try/catch no `handleSignal` (A6) | 15 min | alto |
| `disconnected` com carência (A2) | 30 min | **alto** |
| `sources[0]` → recusar (A5) | 15 min | alto (privacidade) |
| `alert()` → toast (F2) | 20 min | médio |
| Qualidade em função do tamanho da sala (H4) | 1 h | **alto** |
| Firewall por programa (A4) | 1 h | alto |
| Malha degradada em vez de malha cheia (H3) | 1 h | **alto** |
| Buffer de ICE + fila por peer (A1) | 2-3 h | **o mais alto** |
| Reconexão preservando a transmissão (A3) | 2-3 h | **alto** |
| README em dia + STATUS.md (E1-E4) | 2 h | médio |
| Relay eleito por saúde de encode (H2) | meio dia | **alto** |
| Separar sinalização de mídia (H1) | meio dia | **o mais alto** |
| Subir Electron (B1) | meio dia | alto |
| Extrair orquestração testável de `app.js` (D1) | 1-2 dias | alto, a prazo |

H1, H3 e H4 são a mesma correção vista de três ângulos: criar o degrau do
meio, entre "tudo bem" e "acabou".

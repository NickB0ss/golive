# Transferência de sala quando o host cai — design

Data: 2026-09-12. Item **F3** da auditoria de fragilidade (`docs/2026-08-27-auditoria-de-fragilidade.md`),
"confirmado, por desenho": o servidor de sinalização mora no processo de quem
criou a sala; se essa pessoa fecha o app ou cai, a sala morre e ninguém mais
entra, mesmo que o vídeo P2P (H1, retomada de sessão 0.13.0) continue de pé
entre quem já está dentro.

## 1. O que já existe e dá base pra isto

Três coisas do código atual tornam esta feature mais barata do que parece:

1. **Liderança já é um conceito do protocolo**, não só de UI
   (`docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md`,
   seção 4). O servidor guarda `peer.tokenHolder` (apresentou o `ownerToken`
   no join), `peer.owner` (quem manda AGORA) e `transferredTo` (sala) —
   `owner = transferredTo ? clientId === transferredTo : tokenHolder`. Isso
   já resolve "duas coroas" quando alguém reconecta. Reaproveitamos
   `transferredTo` para semear o dono da sala nova sem inventar mecanismo
   novo.
2. **O vídeo sobrevive à sinalização cair** (H1/0.13.0): perder o WebSocket
   não derruba as `RTCPeerConnection`. A transferência de sala é sobretudo um
   problema de **sinalização e descoberta**, não de mídia — os tiles que já
   estão abertos não precisam recomeçar.
3. **O beacon UDP de descoberta já escuta o tempo todo**, independente de
   lobby ou sala (`ensureDiscoveryStarted()` roda uma vez no boot,
   `src/main.js:618`). Isso dá um canal de rendez-vous pronto pra "onde está
   o sucessor" sem inventar transporte novo.

## 2. Decisões e por que (o que foi descartado)

### 2.1 Quem é o sucessor: ordem de entrada, sem votação

Cada peer no servidor tem um `id` numérico atribuído em sequência
(`nextId++`) na ordem de entrada, e a retomada de sessão preserva esse id
(`resumedId`). Isso já é uma ordem total, conhecida por igual por servidor e
clientes (todo mundo vê `id` nas mensagens `welcome`/`peer-joined`).

**Regra: o sucessor é o sobrevivente de MENOR id, excluindo quem hospedava.**
Todo cliente com o roster em dia calcula o mesmo valor sem trocar uma
mensagem — não tem eleição, não tem empate a resolver (ids não se repetem).

Descartado: RTT ou "quem está mais perto" (métrica de H2, e não temos essa
telemetria pra sinalização — só pra encode) e "primeiro a se candidatar"
(corrida, não determinismo).

**Se o sucessor falhar** (não consegue abrir porta, firewall recusa, a
própria máquina também sumiu junto): o **próximo da lista** assume depois de
um **timeout escalonado por posição** — quem seria o 2º candidato arma um
timer de `SUCCESSOR_TIMEOUT_MS` (15 s) esperando o beacon de migração do
`roomId`; se não chegar, tenta virar host ele mesmo. O 3º espera 2×, o 4º 3×,
e assim por diante. Sem round de votação, sem mensagem de "desisto": o
silêncio no beacon É o sinal.

### 2.2 Quem fica sendo dono da sala nova

Regra: **o dono atual continua dono se sobreviver; senão, o sucessor vira
dono.** Formaliza o mesmo espírito de `reclaimOwnership` (a liderança "volta
pra casa" se puder, e só fica vaga quando não há pra quem voltar) — só que
agora "casa" pode ser qualquer sobrevivente, não só quem criou a sala.

- **Saída graciosa:** o SERVIDOR (autoritativo, não o cliente) calcula os
  dois ids — sucessor e novo dono — a partir da própria tabela de peers, no
  mesmo instante em que decide fechar. Ninguém precisa confiar num cliente
  dizendo "eu decido quem manda".
- **Queda:** não há servidor vivo pra calcular nada. Cada sobrevivente roda
  **o mesmo algoritmo, localmente, com o roster que já tinha** (módulo puro
  compartilhado — §4). Diverge só se os rosters já tivessem divergido antes
  (bug seria noutro lugar).

**Por que não simplesmente "o sucessor sempre vira dono"?** Foi a alternativa
mais simples e cheguei a considerar (evita precisar mandar o `clientId` do
dono atual pro sucessor). Descartada porque regride uma feature já lançada
(0.9.0, passar a liderança): alguém que recebeu a coroa deliberadamente e
ainda está na sala não pode perdê-la só porque a máquina que hospeda o
servidor mudou — isso é o tipo de coisa que vai gerar "por que eu não
consigo mais banir, se ontem eu conseguia" sem nenhum aviso.

O preço dessa escolha: o servidor precisa mandar o **`clientId`** (não o
`id` de conexão, que é descartável a cada servidor novo) de quem deve ser
dono na sala nova, pro sucessor semear `transferredTo` ao criar o servidor
novo. `clientId` já não é segredo (aparece pro dono na lista de banidos
desde a 0.4.0); mandar pro sucessor não abre superfície nova.

### 2.3 Endereço do sucessor: o cliente NÃO sabe o IP de ninguém hoje

Verificado: `roomPeers()` e `peer-joined` mandam `{id, name, avatar, owner}`
— nunca endereço. ICE candidates ficam dentro do RTCPeerConnection, sem API
que devolva "qual IP:porta de sinalização essa pessoa serve". Então a
pergunta do brief ("hoje o cliente sabe o IP de todo mundo?") tem resposta
não — e por isso a transferência precisa de um canal de descoberta
explícito.

**Decisão: um beacon UDP de migração, separado do beacon de descoberta de
salas.** Mesma infra (`src/main/discovery.js`, broadcast na LAN virtual),
`type` novo (`golive-room-migrate`) pra não vazar pro lobby de ninguém nem
depender do "Anunciar na rede" da sala original (ele pode estar desligado —
migração não é feature de descoberta, é infraestrutura de sobrevivência).
Payload: `{ type, roomId, address, port, protected }`. Emitido só pelo
processo que está virando o novo host, por uma janela curta (45 s, dá folga
pro pior caso de reconexão de 110 s do H1/A3 mais margem), e só reage quem
já conhece o `roomId` daquela sala — todo mundo mais na LAN descarta o
pacote sem processar (tipo desconhecido).

Descartado: exigir que "Anunciar na rede" estivesse ligado na sala original
(a migração ficaria indisponível pra quem preferiu não anunciar — errado,
são propriedades diferentes: uma é "quero que estranhos me achem", a outra é
"quero que quem já está dentro continue dentro"). Descartado também expor
endereço LAN de todo mundo no roster só pra isso — superfície nova grande
(cada peer aprende o IP de todos os outros o tempo todo) por um benefício
que o beacon já entrega sem esse custo.

### 2.4 Porta e firewall

O sucessor chama exatamente o mesmo caminho que "Criar sala" já usa:
`findFreeServer` (9000–9010) + `ensureFirewallRule(port)`
(`src/main/firewall.js`, já filtra por `program=<execPath>`, então não há
falso-positivo de regra de outro executável). **Risco real, documentado, não
resolvido aqui:** se a máquina do sucessor NUNCA hospedou uma sala antes,
essa é a primeira vez que o Windows pede UAC pra ela — e a pessoa pode estar
de tela cheia, no jogo, sem ver o prompt. Se a elevação falhar ou for
ignorada, `ensureFirewallRule` devolve `{ok:false, manualCommand}` do mesmo
jeito que já devolve hoje pro host original; a sala nova sobe mesmo assim
(escuta em `0.0.0.0`), só que sem garantia de alcance de fora até alguém
clicar "Permitir acesso à rede" — mesmo aviso que já existe na barra do
palco, reaproveitado, agora podendo aparecer pra qualquer membro, não só
pra quem clicou "Criar sala". Teste manual necessário (roteiro no relatório
final).

### 2.5 Segurança: nada que vem de um cliente vira autoridade sem checar

- **Saída graciosa:** sucessor/novo-dono/bans/chat são calculados e enviados
  pelo SERVIDOR antigo (autoritativo — tem a tabela de peers e o histórico
  de verdade), não por um cliente se autoproclamando. A única coisa que um
  cliente faz é *avisar o processo local* que está saindo de propósito
  (já existe: `room:unhost`, `window-all-closed`, `session-end`).
- **Queda:** cada sobrevivente calcula sucessor/dono sozinho a partir do
  PRÓPRIO roster (dado que já recebeu do servidor antigo via
  `welcome`/`peer-joined`/`owner-changed`), não de um valor que outro
  cliente mandou por cima do ombro. Se dois clientes divergirem (roster
  dessincronizado — não deveria acontecer, mas rede é rede), o pior caso é
  **dois sucessores tentando virar host ao mesmo tempo**: o servidor novo
  criado por cada um simplesmente não colide (portas diferentes, ids de sala
  diferentes) — vira duas salas migradas, e quem ficar pra trás eventualmente
  ouve o beacon do outro e para de tentar. Não é elegante, mas não é
  inseguro: ninguém ganha poder que não tinha.
- **O servidor NOVO não aceita bans/dono "porque o cliente falou".** Bans e
  `transferredTo` são passados como **parâmetros de criação do processo
  local** (`createSignalingServer({ initialBans, initialTransferredTo, ... })`),
  isto é, decisão de quem está rodando ESSE processo (o próprio usuário, na
  própria máquina) — o mesmo modelo de confiança que já existe pro
  `ownerToken` hoje (gerado localmente, nunca chega por mensagem de rede).
  Nenhum peer remoto manda "sou o dono" ou "bane fulano" pelo canal de
  migração; only o servidor ANTIGO (que já validava tudo isso o tempo todo)
  resolve esses valores antes de morrer.
- **PIN continua exigido.** A sala nova nasce com o MESMO PIN (repassado
  pelo servidor antigo na saída graciosa; na queda, cada sobrevivente já
  guarda o PIN que ele mesmo digitou pra entrar — ver §3.3). Quem nunca
  esteve na sala continua barrado exatamente como hoje.
- **Trava de versão continua valendo.** O servidor novo nasce com
  `appVersion: app.getVersion()` do processo que virou host, igual a hoje —
  se o sucessor estiver em versão diferente da maioria (não deveria, é o
  mesmo requisito de sempre), quem tentar entrar e não bater versão toma o
  `join-denied` de sempre.

## 3. Protocolo

### 3.1 Mensagens novas

**Servidor → sala inteira**, mandada pelo servidor ANTIGO um instante antes
de `room-closed`, só quando sobra gente (saída graciosa):

```json
{
  "type": "room-migrating",
  "roomId": "<uuid da sala>",
  "successor": "5",
  "successorName": "Fulano",
  "newOwnerClientId": "abc123...|null",
  "pin": "1234|null",
  "bans": [{ "key": "client:...", "name": "..." }],
  "chat": [ /* mesmo shape de chatHistory, ate 50 itens */ ]
}
```

`successor`/`successorName` são só pra UI ("Anfitrião saiu — Fulano está
assumindo a sala..."). `newOwnerClientId` é o único campo com peso de
autoridade, e é resolvido pelo servidor (não aceito de ninguém). Omitido
(`null`) quando a sala fica sem dono nenhum sobrevivente elegível — mesmo
caso que já existe em `reclaimOwnership`.

Peer roteado como o próprio `close()` já sabe filtrar: quem está saindo
(o host) não recebe isto — ele já está desconectando.

**UDP, beacon de migração** (broadcast, não vai por WebSocket):

```json
{ "type": "golive-room-migrate", "roomId": "<uuid>", "address": "10.x.x.x:9001", "port": 9001, "protected": true }
```

### 3.2 Mensagens existentes que ganham campo

- `welcome` ganha `roomId` (uuid estável, criado uma vez em `room:host` e
  preservado por toda migração seguinte — o sucessor recebe o `roomId` da
  sala antiga e passa pro `createSignalingServer` novo) e `hostId` (o `id`
  do peer conectado por loopback — quem hospeda ESTE servidor; usado
  só pelo cliente pra saber quem excluir do cálculo de sucessor na queda,
  nunca pro servidor decidir nada).
- Beacon de **descoberta de sala** (não o de migração) ganha `roomId`
  opcional — cosmético, deixa a lista da rede eventualmente mostrar
  continuidade; não é usado por nenhuma lógica de migração.

### 3.3 O que cada cliente já guarda (sem mensagem nova) e passa a preservar

- **PIN usado no `join`**: hoje é um parâmetro local de `joinRoom(...)`,
  descartado depois de usado. Passa a ficar guardado (`let joinedPin`) pela
  duração da sessão — é o que permite ao sucessor recriar a sala com o MESMO
  PIN na queda, quando não há `room-migrating` pra entregar isso.
- **Cauda do chat**: o renderer já mantém as últimas mensagens pra desenhar
  o painel (`ui.chat`/histórico local). Na queda, o sucessor semeia o
  servidor novo com essa cauda local em vez do `chatHistory` do servidor
  morto (que ele não tem como pedir) — cobre "se for barato" do jeito mais
  barato possível: dado que já existe, sem mensagem nova.
- **Bans na queda**: **não preservados**, a não ser que o sucessor por
  acaso seja o dono atual (só o dono recebe `banned-list`). É a limitação
  mais honesta desta spec — ver §6.

## 4. Módulo puro: `src/renderer/succession.js`

Mesmo padrão de `resume.js`/`reconnect.js` (IIFE + `module.exports`,
`node --test` ao lado, usável tanto do renderer via `<script>` quanto de
`server/signaling-core.js` via `require` — é puro, sem DOM nem `ws`).

```js
// candidates: array de ids (string) de quem ESTÁ na sala agora, incluindo
// quem hospeda. hostId: id de quem hospeda (excluído do resultado).
function chooseSuccessor(candidates, hostId) { ... }

// survivors: mesma lista, já sem o host. currentOwnerId: id (ou null/'me'
// traduzido pra id real antes de chamar). successorId: resultado de cima.
function chooseNewOwner(survivors, currentOwnerId, successorId) { ... }

// posição (0-based) de um candidato na ordem de sucessão, pra saber quanto
// esperar antes de se candidatar sozinho (§2.1).
function successorRank(candidates, hostId, myId) { ... }
function successorTimeoutMs(rank) { ... } // rank * SUCCESSOR_TIMEOUT_MS
```

Comparação de ids é **numérica** (ids são strings de inteiro crescente,
`"10" < "9"` como string seria errado).

## 5. Fluxo passo a passo

### 5.1 Saída graciosa

1. Host clica "Sair"/fecha o app enquanto hospeda. Caminho já existente
   (`room:unhost`, `window-all-closed`, `session-end`) chama
   `closeEmbeddedServer()` → `embeddedServer.close({ migrate: true })`.
   `migrate` é `false` por padrão (o `close()` que `room:host` já chama pra
   derrubar um servidor anterior ANTES de criar outro — recriação de sala —
   não deve disparar migração nenhuma).
2. Dentro de `close({ migrate })`, se `migrate` e sobra gente: calcula
   sucessor/novo-dono, manda `room-migrating` pra sala, espera um tick
   (mesma fila do `send`, sem timer) e só então segue o fluxo de sempre
   (`room-closed` + `close(1001)` por conexão).
3. Cada sobrevivente recebe `room-migrating`. UI muda de "conectado" pra
   "anfitrião saiu — migrando" (não volta pro lobby, não derruba tiles).
   Quem é o sucessor dispara o fluxo de "virar host" (§5.3) imediatamente
   (rank 0, sem timeout).
4. Os demais armam o timeout escalonado (§2.1) esperando o beacon de
   migração com o `roomId` da sala.
5. Sucessor sobe servidor novo (mesmo `roomId`, PIN e `appVersion` de
   sempre, `initialTransferredTo` = `newOwnerClientId` se != o próprio,
   `initialBans`, `initialChatHistory`), começa a emitir o beacon de
   migração, e reconecta a SI MESMO nele (igual `hostRoomFlow` hoje).
6. Demais clientes recebem o beacon, conferem `roomId`, e chamam o `joinRoom`
   de sempre pro endereço novo — com o PIN que o `room-migrating` entregou.
   Sessões P2P existentes não são tocadas; só a sinalização reconecta.

### 5.2 Queda

1. Socket cai (1006) ou heartbeat mata. A retomada/reconexão EXISTENTE
   (`resume.js`/`reconnect.js`, H1/A3) tenta primeiro — sem mudança
   nenhuma aqui, é o comportamento já lançado na 0.13.0. Isso cobre "a
   rede engasgou 5 segundos".
2. Se as tentativas de reconexão ao MESMO endereço se esgotam
   (`MAX_RECONNECT` de `reconnect.js`, hoje ~110 s de pior caso) SEM um
   `welcome` novo: em vez de só desistir e voltar pro lobby, calcula
   localmente sucessor/novo-dono com `succession.js` + o roster que já
   tinha.
3. Se `successor === myId`: sobe servidor novo já (rank 0). Se não: arma o
   timeout escalonado da própria posição, ouvindo o beacon de migração.
4. Resto igual a 5.1 a partir do passo 5 (o beacon é o mesmo mecanismo nos
   dois casos) — exceto que aqui não há `room-migrating` pra buscar
   bans/PIN/chat: o sucessor usa o PIN que ELE MESMO digitou (§3.3), a
   cauda de chat que ELE MESMO tem localmente, e bans **vazios** a menos
   que ele seja o dono atual.
5. **Timeout do próprio sucessor** (o candidato de rank 0 falha em subir o
   servidor — porta, firewall, ou a própria queda pegou mais de uma
   máquina junto): rank 1 não viu beacon dentro de `SUCCESSOR_TIMEOUT_MS`,
   assume o papel e tenta. Assim por diante.

## 6. Limitações conhecidas (honestas, não escondidas)

- **Bans somem na queda**, a não ser que o sucessor por acaso seja o dono
  atual. Alguém banido pode reentrar até ser banido de novo. Não há
  persistência em disco de bans hoje (fora de escopo desta frente); seria a
  correção, se isso incomodar na prática.
- **Chat perdido nos segundos de transição** já era uma limitação conhecida
  da retomada de sessão (STATUS.md, "pendente") — continua valendo aqui: o
  que foi mandado enquanto a sala estava sem servidor nenhum não chega a
  lugar nenhum.
- **Firewall na primeira vez do sucessor** pode pedir UAC sem a pessoa ver
  (tela cheia, jogo). Sem solução automática — mesmo risco que já existe
  hoje pra quem cria sala pela primeira vez, só que agora pode acontecer
  sem a pessoa ter clicado em nada.
- **Divergência de roster** entre clientes (bug em outro lugar, ou uma
  mensagem `peer-left` perdida) pode fazer dois sobreviventes se acharem
  sucessor ao mesmo tempo na queda. Coberto em segurança (§2.5) como "não
  inseguro, só duas salas por um tempo" — não testado em cenário real de
  perda de pacote induzida, só no raciocínio.
- **Servidor não escolhido nem testado por telemetria de encode** (H2 fica
  de fora): o sucessor é só "quem entrou primeiro", não "quem tem CPU
  sobrando". Se calhar de o sucessor ser justo quem está jogando pesado,
  o servidor de sinalização é leve (não é decodificador nem relay de
  mídia) — o custo extra é desprezível comparado ao ganho.
- **Sem verificação em 2+ PCs reais** nesta entrega — só o teste automatizado
  com clientes `ws` em loopback (mesmo padrão de `signaling-e2e.test.js`).
  Roteiro de teste manual no relatório final.

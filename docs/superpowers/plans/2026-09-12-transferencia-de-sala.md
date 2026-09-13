# Plano — transferência de sala quando o host cai (F3)

Spec: `docs/superpowers/specs/2026-09-12-transferencia-de-sala-design.md`.
Ler antes de mexer em qualquer arquivo.

Regras do brief comum que valem aqui (não repetir em cada fase): mudanças
mínimas e localizadas nos arquivos disputados (`server/signaling-core.js`,
`src/main.js`, `src/renderer/app.js`, `src/preload.js`), lógica nova em
módulo novo com teste ao lado (`node --test`), comentário de código em
português sem acento, texto de UI com acento, nenhuma dependência nova,
mensagens novas validadas por tipo/campo no servidor.

## Fase 1 — módulo puro de sucessão + teste

Arquivo novo: `src/renderer/succession.js` (padrão IIFE + `module.exports`
de `resume.js`/`reconnect.js`). Exporta `chooseSuccessor`, `chooseNewOwner`,
`successorRank`, `successorTimeoutMs`, e a constante `SUCCESSOR_TIMEOUT_MS`.
Teste: `src/renderer/succession.test.js`, casos de borda (host é o único id,
lista vazia, ids fora de ordem, dono atual ausente/presente, meu id não
está na lista).

## Fase 2 — servidor: migração na saída graciosa

Em `server/signaling-core.js`:

1. `createSignalingServer` ganha três parâmetros novos opcionais:
   `roomId` (repassado como está, default `randomUUID()` se ausente —
   nunca deixa a sala sem um), `initialTransferredTo` (semeia a variável
   `transferredTo` já existente, no lugar de começar sempre `null`),
   `initialBans` (array `[{key,name}]`, semeia o `Map bans` existente —
   validar forma item a item, descartar item inválido em vez de lançar) e
   `initialChatHistory` (array, semeia `chatHistory`, mesmo corte de 50 +
   `CHAT_IMAGE_HISTORY_MAX` já aplicado por `pushChatEntry` — reaproveitar
   a função, não duplicar a regra).
2. `welcome` ganha `roomId` e `hostId`. `hostId` é o `id` do peer cujo
   `address` normalizado é loopback (127.0.0.1/::1) — reusar
   `normalizeAddress`/`isLoopback` que já existem pra ban. Calculado sob
   demanda (não guardado em variável separada — um único loopback por sala,
   procurar na hora é O(peers), sala é pequena).
3. `close()` ganha parâmetro `{ migrate = false } = {}`. Quando `migrate` e
   sobra gente além do host: calcula `successor`/`newOwnerClientId` com
   `succession.js` (`require('../src/renderer/succession.js')`), manda
   `room-migrating` (campos da spec §3.1) pra sala ANTES do loop de
   `room-closed`/`close(1001)` que já existe — não mexer nesse loop, só
   inserir o broadcast novo antes dele.
4. Chamadores de `close()`: `room:unhost`, `window-all-closed` e
   `session-end` em `src/main.js` passam `{ migrate: true }`; o `close()`
   que `room:host` já chama pra derrubar um servidor anterior antes de
   criar outro fica sem mudança (`migrate` default `false`).

Teste: estender `server/signaling-core.test.js` (unidade, sem socket) pros
parâmetros novos de `createSignalingServer`, e
`server/signaling-e2e.test.js` (ou arquivo novo ao lado, mesmo padrão) pro
handshake `close({migrate:true})` → `room-migrating` chega pros
sobreviventes com os campos certos, e NÃO chega pra quem está saindo.

## Fase 3 — beacon de migração

Em `src/main/discovery.js`: NÃO reaproveitar `startAdvertising`/
`formatBeacon`/`parseBeacon` (são do beacon de descoberta de sala, e
misturar os dois tipos preserva menos as garantias de cada um). Funções
novas, mesmo arquivo: `formatMigrationBeacon`, `parseMigrationBeacon` (tipo
`golive-room-migrate`), e no objeto devolvido por `createDiscovery`:
`startAdvertisingMigration({ roomId, address, port, protected, windowMs })`
(broadcast a cada ~1,5 s por até `windowMs`, default 45000, e para sozinho),
`stopAdvertisingMigration()`, `onMigrationBeacon(roomId, callback)` (registra
um único ouvinte por `roomId` — o socket já está com `bindSocket` recebendo
tudo; só precisa rotear pro callback certo por tipo+roomId, sem novo
socket). Teste: `src/main/discovery.test.js` já existe (conferir) — estender
com os casos de format/parse da migração e da janela de tempo (usar
`deps.dgram` injetável, mesmo padrão do arquivo).

## Fase 4 — main.js: virar host novo, seedado

Em `src/main.js`:

1. `room:host` (handler existente) ganha campos opcionais no payload:
   `roomId`, `pin` (força um PIN específico em vez de gerar, pra preservar o
   da sala antiga), `initialTransferredTo`, `initialBans`,
   `initialChatHistory`. Todos opcionais — a criação normal de sala (lobby,
   "Criar sala") não muda em nada.
2. IPC novo `room:migrate-beacon:start` / `...:stop` chamando
   `discovery.startAdvertisingMigration`/`stopAdvertisingMigration`.
   `room:migrate-beacon:listen` (ou reaproveitar `rooms:discovered` com um
   canal separado `room-migrate:discovered`) pra empurrar pro renderer
   quando um beacon do `roomId` esperado chega.
3. `hostedRoomId`/`hostedRoomPin` (variável já existe pro pin) passam a
   também guardar o `roomId` ativo, pro `advertiseHostedRoom` beacon de
   descoberta normal incluir o campo cosmético opcional (spec §3.2).

`preload.js`: expor os IPCs novos com comentário no mesmo estilo dos
existentes (o que faz, quando é chamado). Mudança pequena e localizada —
não reordenar nem tocar nas entradas existentes.

## Fase 5 — renderer: reagir a `room-migrating` e à queda

Em `src/renderer/app.js` (arquivo disputado — mudança mínima e localizada,
lógica de decisão vai pro módulo puro, aqui só orquestra):

1. Guardar `joinedPin` (o PIN usado no `join` atual) e manter acessível a
   cauda de chat já renderizada (conferir se já existe uma estrutura local
   antes de criar uma nova).
2. `case 'room-migrating'`: novo estado de UI ("anfitrião saiu — migrando
   para X"), sem voltar pro lobby, sem tocar nos tiles/mesh. Se
   `successor === myId`, dispara o fluxo de virar host (novo, ver 4). Senão
   arma o timeout escalonado (`successorTimeoutMs` do módulo puro) ouvindo
   `room-migrate:discovered` pro `roomId` da sala.
3. Ponto onde a reconexão hoje desiste (`reconnect.js`/`MAX_RECONNECT`
   esgotado) sem ter recebido `welcome`: em vez de só voltar pro lobby,
   roda o mesmo cálculo local (`succession.js`) com o roster que já tinha e
   segue o mesmo caminho do passo 2 (sucessor vs. esperando beacon).
4. Fluxo "virar host" (função nova, não reescrever `hostRoomFlow` — extrair
   o miolo comum se fizer sentido, sem tocar no comportamento do botão
   "Criar sala"): chama `room:host` com `roomId`/`pin`/seeds, sobe o beacon
   de migração local, reconecta a si mesmo (igual host normal faz hoje),
   pra pelo beacon depois do primeiro sinal de vida (ou de um timeout curto
   de segurança).
5. Fluxo "esperando o sucessor": ao ouvir o beacon certo, `joinRoom` pro
   endereço novo com o `joinedPin` guardado. Sessão P2P (mesh) intocada.

Não criar teste de DOM/Electron pra isso (fora do padrão do repo — `app.js`
não tem teste, orquestração fica sem cobertura direta, como já é hoje;
mitigar com o e2e de sinalização da Fase 2 e teste manual).

## Fase 6 — teste ponta a ponta de migração

Arquivo novo `server/signaling-migration-e2e.test.js`, mesmo padrão de
`signaling-e2e.test.js` (clientes `ws` reais, sem timer de sincronização).
Cenário mínimo: 3 clientes conectados, host chama
`close({migrate:true})`, sobreviventes recebem `room-migrating` com
sucessor/dono corretos, sobem um SEGUNDO `createSignalingServer` (simulando
o sucessor) semeado com os campos recebidos, terceiro cliente reconecta nele
e chega como dono certo / bans certos / PIN certo.

## Fase 7 — validação e relatório

`npm test` e `npm run lint` no worktree (números exatos, ler a saída antes
de afirmar). Relatório final no formato do brief comum, com o roteiro de
teste manual em 2+ PCs (queda simulada = matar o processo do host;
graciosa = "Sair da sala"/fechar o app) e a lista completa de mudanças de
protocolo (mensagens novas, campos novos em mensagens existentes, beacon
novo).

## Ordem de execução com Codex

Fases 1–2 num prompt terra **high** (risco: sinalização/sessão). Fase 3 pode
ir de luna medium (mecânico, contido em discovery.js) depois que a Fase 2
estiver revisada. Fases 4–5 terra high (sessão/reconexão, ainda risco).
Fase 6 terra high (é o teste que prova a Fase 2 e a 4/5 batem uma com a
outra). Revisar `git diff` entre cada fase antes de prosseguir pra próxima —
não empilhar fases sem revisão no meio.

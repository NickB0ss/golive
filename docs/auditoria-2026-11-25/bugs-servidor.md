# Auditoria 2026-11-25: bugs do servidor de sinalização

Escopo: `server/signaling-core.js`, `server/signaling.js`, `src/shared/`
(`succession.js`, `comunidade.js`) e o que fica exposto na origem HTTP
(`src/main/origem.js`). Commit auditado: `c6142ce`. Não alterei código de produção.

Testes de reprodução (`node --test`, importam o repositório pelo caminho
absoluto) ficam em
`/tmp/claude-0/-home-user-golive/55573a2c-39b7-58ae-bbac-ac37f25f7d3b/scratchpad/bugs-servidor/`.
Rodar todos: `node --test *.test.js` dentro dessa pasta. Os 15 casos passam,
e cada caso passando significa que o defeito existe. O S-10 leva cerca de 30 s.
Os nomes dos arquivos não seguem os ids deste relatório. A coluna "Teste"
diz qual arquivo reproduz cada achado.

Ameaça considerada: qualquer pessoa que alcança a porta na LAN virtual
(Radmin/Tailscale). Numa sala sem PIN, isso é "qualquer um na rede". Numa sala
com PIN, é qualquer pessoa que conhece o PIN, e o PIN vai para toda a sala no
`room-migrating`.

| Id | Gravidade | Teste |
|----|-----------|-------|
| S-01 | alta | `s04-watchers-amplifica.test.js` |
| S-02 | alta | `s02-coroa-por-clientid.test.js` |
| S-03 | alta | `s01-sala-escondida.test.js` |
| S-04 | média | `s03-pendentes.test.js` |
| S-05 | média | `s08-duas-coroas.test.js` |
| S-06 | média | `s06-sucessor-suspenso.test.js` |
| S-07 | média | `s05-aninhamento.test.js` |
| S-08 | baixa | `s10-sem-listener-error.test.js` |
| S-09 | baixa | `s09-retomada-sala-cheia.test.js` |
| S-10 | baixa | `s07-close-preso.test.js` |

---

## S-01: `watchers` multiplica cada mensagem por dezenas de milhares e o servidor não limita o buffer de envio (OOM no PC do host)

- **Gravidade:** alta
- **Onde:** `server/signaling-core.js:2089` (cada item da lista vira `{name, avatar}` com avatar de até 64 KB, mandado para a sala inteira) e `server/signaling-core.js:525` (`send` não olha `ws.bufferedAmount`)
- **Defeito:** uma mensagem `watchers` de cerca de 230 bytes gera cerca de 1 MB de saída por destinatário. A cota de 20/s é por socket. Nenhum envio do servidor confere se o destinatário está lendo, então tudo o que não sai acumula na memória do processo do host.
- **Cenário:** o atacante entra com 16 sockets, cada um com um avatar de 64 KB (sala própria, ver S-03, ou vagas na `geral`). Quinze deles param de ler, e o 16º manda `watchers` com os 16 ids a 20/s. Medido no teste: **4,6 KB de entrada em 1 s deixaram 249,6 MB pendurados no host (cerca de 54.000x)**. O heartbeat só derruba quem não lê depois de 25 a 50 s, tempo para vários GB. O processo principal do Electron de quem hospeda morre por falta de memória e a sala acaba para todos. Mesmo com destinatários honestos, são cerca de 20 MB/s de upload do host para cada pessoa, o que satura a VPN. O mesmo vazamento sem teto existe, em escala menor, no `welcome` (histórico com até 8 imagens de 200 KB, cerca de 1,6 MB por join) e no `mesa-sync` (até cerca de 512 KB).
- **Evidência:** CONFIRMADO (`s04-watchers-amplifica.test.js`).
- **Correção:** no `send`, descartar a mensagem (ou derrubar o socket) quando `ws.bufferedAmount` passar de um teto (por exemplo 4 MB). Em `watchers`, mandar só ids e deixar o cliente buscar o avatar no roster que ele já tem, ou limitar a cota por sala e não por socket.

## S-02: depois de uma transferência ou migração, qualquer um que repita o `clientId` do líder vira líder também

- **Gravidade:** alta
- **Onde:** `server/signaling-core.js:1665` (`owner = transferredTo ? clientId === transferredTo : tokenHolder`), `server/signaling-core.js:2264` (`newOwnerClientId` vai para todos no `room-migrating`) e `src/renderer/app.js:1649` (o sucessor semeia `initialTransferredTo` com esse valor)
- **Defeito:** depois que a liderança é transferida, a coroa passa a depender só do `clientId`, que não é segredo. O `room-migrating` publica o `clientId` do novo líder para a sala inteira. O próprio código diz em `app.js:2546` que o cliente não deveria conhecer o `clientId` de terceiros.
- **Cenário:** o host sai com migração graciosa, e todo sobrevivente recebe `newOwnerClientId: "c-bia"` junto com o PIN. Mau entra no servidor do sucessor com `{clientId: "c-bia"}`, sem token, e o `welcome` chega com `owner: true`. Mau bane a Bia, a líder real (`moderated: ban`, close 1008). O mesmo vale no servidor original depois de um `transfer-owner` (S-02c).
- **Evidência:** CONFIRMADO (`s02-coroa-por-clientid.test.js`, três casos).
- **Correção:** gravar em `transferredTo` um segredo, não o `clientId`. Por exemplo, o `resumeToken` do alvo, ou um "token de líder" novo mandado só ao alvo e exigido no join. Tirar `newOwnerClientId` do `room-migrating` de todos e mandá-lo só ao sucessor.

## S-03: o campo `room` do join é livre, e cada nome cria uma sala paralela invisível que fura o teto, lê o chat e mexe na mesa da `geral`

- **Gravidade:** alta
- **Onde:** `server/signaling-core.js:1581` (`room = String(msg.room || 'geral')`), `server/signaling-core.js:1582` (o teto é por sala), `server/signaling-core.js:640` (`chatHistory` é um só para o servidor inteiro) e `server/signaling-core.js:686` (`mesaState` também é um só)
- **Defeito:** o app sempre usa `'geral'` (`app.js:2274`), mas o servidor aceita qualquer nome. O isolamento por sala só existe no roteamento de mensagens. Histórico, mesa e contagem são globais.
- **Cenário:**
  1. `join {room:"x0"}`, `{room:"x1"}` e assim por diante: com a `geral` cheia (16), 40 joins extras foram aceitos (S-01a). `getPeerCount`, `probe` e o beacon contam esses peers.
  2. Um espião em `room:"z"` recebe no `welcome` o histórico da `geral` (`"senha do wifi"`). O líder não vê o espião (sem `peer-joined`), e `moderate kick` é ignorado porque o alvo está "em outra sala" (S-01b).
  3. O intruso manda `mesa-sync` e vê a mesa da `geral`. Depois manda `mesa remove` e apaga a janela da Ana. A Ana não recebe o eco nem o `mesa-count`: o seq dela fica com buraco e a janela some sem autor visível (S-01c).
- **Evidência:** CONFIRMADO (`s01-sala-escondida.test.js`, três casos).
- **Correção:** aceitar só `'geral'` (ou só o `room` configurado) e recusar qualquer outro valor com `join-denied`. Opcionalmente, também um teto global de peers (`peers.size`).

## S-04: 32 sockets que conectam e nunca mandam `join` trancam a sala para sempre

- **Gravidade:** média
- **Onde:** `server/signaling-core.js:1469` (a contagem de pendentes não tem prazo)
- **Defeito:** não existe prazo para o `join`. O heartbeat só derruba quem não responde pong, e qualquer cliente WebSocket responde sozinho. 32 conexões ociosas ficam abertas para sempre, e a 33ª e todas as seguintes levam close 1013.
- **Cenário:** um script abre 32 WebSockets e não manda nada. Um amigo tenta entrar, ou alguém que caiu tenta reconectar, e leva close 1013 `too-many-pending` sem `welcome`. Nenhuma PIN é necessária. No teste, os ociosos sobreviveram a 6 ciclos de heartbeat.
- **Evidência:** CONFIRMADO (`s03-pendentes.test.js`).
- **Correção:** um timer por conexão (por exemplo 10 s) que fecha o socket se ele não tiver entrado. Opcionalmente, um teto de pendentes por IP.

## S-05: líder que volta com join novo dentro da janela de retomada fica com uma coroa escondida

- **Gravidade:** média
- **Onde:** `server/signaling-core.js:1665` combinado com `server/signaling-core.js:1387` e `server/signaling-core.js:1344` (`reclaimOwnership` dá a coroa ao host sem tirar a de mais ninguém)
- **Defeito:** quando o fantasma suspenso do líder expira, `removePeer` devolve a liderança ao host. O peer novo do mesmo líder, que já tinha entrado com `owner: true` por causa do `clientId`, continua com `owner: true` no servidor.
- **Cenário:** o host transfere a liderança para a Bia. O app da Bia trava (1006, suspensa) e ela reabre e entra de novo em menos de 20 s, sem `resumeToken`, porque o token vivia só em memória. O join novo vem com `owner: true`. O fantasma expira e a sala recebe `owner-changed` apontando o host, mas a Bia nova continua líder no servidor e expulsa o Caio sem que ninguém a veja como líder.
- **Evidência:** CONFIRMADO (`s08-duas-coroas.test.js`).
- **Correção:** em `reclaimOwnership`, zerar `owner` de todos os peers da sala antes de coroar. Em `removePeer`, só devolver a coroa se nenhum outro peer da sala tiver `clientId === transferredTo`. A correção de S-02 também ajuda.

## S-06: a migração graciosa escolhe sucessor e novo líder entre os peers suspensos

- **Gravidade:** média
- **Onde:** `server/signaling-core.js:2245` (`survivors` inclui peers com `_suspendedAt`)
- **Defeito:** quem está na janela de retomada não tem socket e não recebe o `room-migrating`, mas pode ser escolhido sucessor (`chooseSuccessor` pega o menor id) e novo líder (`newOwnerClientId`).
- **Cenário:** a rede da Bia cai com 1006 (ela fica suspensa) e logo depois o host fecha a sala. O `room-migrating` diz `successor: Bia` e `newOwnerClientId: "c-bia"`. O Caio espera a vez da Bia (15 s pelo `successorTimeoutMs`), sobe a sala nova com `initialTransferredTo: "c-bia"` e entra nela **sem ser líder**, mesmo tendo o `ownerToken`. Se a Bia não voltar, a sala nova fica sem líder para sempre: `reclaimOwnership` só roda quando um líder sai.
- **Evidência:** CONFIRMADO no servidor (`s06-sucessor-suspenso.test.js`). Os 15 s de espera no cliente são PLAUSÍVEIS, pela leitura de `migration.js`/`succession.js`, mas não foram executados.
- **Correção:** filtrar `peer._suspendedAt` de `survivors` em `close({migrate})`. Se só restarem suspensos, migrar sem `newOwnerClientId`.

## S-07: sinalização repassada crua: um campo com 100 mil níveis de aninhamento estoura a pilha no `send`

- **Gravidade:** média (o CLI morre; no app, só o socket do remetente trava)
- **Onde:** `server/signaling-core.js:1786` (`send(target.ws, { ...msg, from })` para offer/answer/ice/view-state/tree), a partir de `JSON.stringify` em `server/signaling-core.js:525`, sem try/catch no handler de `message`
- **Defeito:** o JSON de `[[[…]]]` com 100 mil níveis cabe em 200 KB (abaixo de `MAX_PAYLOAD_BYTES`) e o `JSON.parse` aceita. O `JSON.stringify` do repasse lança `RangeError: Maximum call stack size exceeded` dentro do handler.
- **Cenário:** um membro manda `{"type":"offer","to":"2","sdp":[[[...]]]}`. Com `node server/signaling.js` (CLI, sem handler), o processo morre e a sala acaba (S-05a). No app, `main.js:342` só registra o `uncaughtException`, e o parser do `ws` daquele socket fica preso no meio do frame, de modo que o remetente não é mais ouvido (S-05b).
- **Evidência:** CONFIRMADO (`s05-aninhamento.test.js` com `s05-servidor-filho.js`).
- **Correção:** reconstruir offer/answer/ice/view-state/tree campo a campo (`sdp` string limitada, `candidate` objeto raso, `epoch` numérico e assim por diante), como já é feito em `reoffer`. Também envolver o `switch` do handler num try/catch que derruba só aquele socket.

## S-08: socket recusado por excesso de pendentes não tem listener de `error`

- **Gravidade:** baixa (o CLI morre; no app vira `uncaughtException` registrado no log)
- **Onde:** `server/signaling-core.js:1470` (`ws.close(1013); return;` antes de `ws.on('error')` em `:2226`)
- **Defeito:** o `ws` emite `error` para um frame inválido recebido. Nesse socket ninguém escuta o evento, e o EventEmitter lança a exceção.
- **Cenário:** 32 sockets ociosos (S-04) e mais um que manda um frame com opcode reservado 3. Resultado: `Unhandled 'error' event … invalid opcode 3`, e o processo do CLI sai.
- **Evidência:** CONFIRMADO (`s10-sem-listener-error.test.js`).
- **Correção:** registrar `ws.on('error', () => {})` como primeira linha do handler de `connection`.

## S-09: retomada recusada como `full` numa sala cheia

- **Gravidade:** baixa
- **Onde:** `server/signaling-core.js:1582` (o teto é conferido antes da busca por retomada em `:1602`, e o próprio suspenso conta no teto)
- **Defeito:** com 16 peers, quem cai com 1006 não consegue retomar o próprio lugar, porque é recusado com `full` até o fantasma expirar.
- **Cenário:** sala com 16. O p5 cai e reconecta com `clientId` e `resumeToken` válidos, e recebe `join-denied {reason:"full"}`.
- **Evidência:** CONFIRMADO (`s09-retomada-sala-cheia.test.js`).
- **Correção:** procurar a retomada antes do teto, ou descontar do teto o peer que está sendo retomado.

## S-10: `close()` da sala fica preso cerca de 30 s com um peer que não responde

- **Gravidade:** baixa
- **Onde:** `server/signaling-core.js:2291` (`wss.close(cb)` espera o `http.Server` interno, que espera cada conexão terminar)
- **Defeito:** o servidor manda close 1001 mas nunca chama `terminate()`. Um peer com a rede caída sem RST, ou um cliente que parou de ler de propósito, segura o `close()` pelo `closeTimeout` do `ws` (30 s).
- **Cenário:** um peer parado e o host clica em Desconectar: `room:unhost` (`main.js`) só resolve depois de 30.002 ms. Um "Criar sala" nesse intervalo espera o mesmo fechamento (`room:host` chama `await closeEmbeddedServer()`).
- **Evidência:** CONFIRMADO (`s07-close-preso.test.js`).
- **Correção:** depois do broadcast de `room-closed`, agendar `client.terminate()` para quem ainda estiver aberto após cerca de 1 s.

---

## Verificado e descartado

- **Origem HTTP:** é `protocol.handle` sem porta aberta, então ninguém na LAN alcança. `resolverCaminho`/`responder` recusam travessia, `%2f`, `%5c`, links simbólicos para fora da raiz e qualquer `/shared/*` que não seja um dos dois módulos públicos. Os casos de `origem.test.js` cobrem isso.
- **`src/shared/comunidade.js`:** usa `Object.hasOwn` e não se deixa enganar por `__proto__`/`constructor`. **`succession.js`:** sem defeito alcançável a partir do servidor, que só passa ids numéricos.
- **Spoofing de `from`:** o servidor carimba `from` e `id` em todo repasse. `tree` e `annotate-sync` forjados são barrados pelo cliente (`app.js`, que compara `from` com a origem ou o dono da superfície).
- **XSS:** o servidor repassa nome e texto sem escapar, mas os pontos de `innerHTML` do renderer conferidos usam `escapeHtml`. As cores de anotação são validadas (`#rrggbb`) e emoji vem de uma lista fechada.
- **Prototype pollution no servidor:** todas as tabelas são `Map`. O spread `{...msg}` copia `__proto__` como propriedade própria, sem poluir nada.
- **PIN:** a força bruta é limitada por IP (5 por minuto). A trava de versão não é controle de segurança, porque a versão é pública no beacon.
- **Não auditado:** a lógica interna dos módulos da Mesa (`src/renderer/mesa-modules/*`, cerca de 17 mil linhas). O servidor os chama protegido por try/catch, mas o `reduce`/`validate` de cada jogo não foi revisado.

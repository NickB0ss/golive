# Relatório 1 — Arquitetura & Saúde do Código

Auditoria de leitura, 2026-09-17, sobre a 0.16.0 (`b20cb17`). Nada foi
alterado no repositório.

## Resumo executivo

A arquitetura está melhor do que o tamanho dos arquivos sugere. `src/main/*`,
`server/signaling-core.js` e os ~40 módulos puros de `src/renderer/` são
coesos, testados (98% de linha no que o teste enxerga) e disciplinados. O
problema não é falta de estrutura: é que **dois arquivos ficaram de fora
dela** — `app.js` (5341) e `ui.js` (3638) somam 47% do código de produção e
não têm um único teste.

Três coisas, em ordem:

1. **O CI está vermelho desde 05/09** — 30 execuções seguidas, 6 releases
   publicadas por cima. A causa é a que a suspeita apontava, e o comentário
   dentro do próprio `test.yml` afirma a invariante que `logger.js` quebra.
2. **A imagem do chat entra no HTML sem escape.** A validação do data URL é
   só de prefixo, nas três cópias dela. Hoje o CSP segura a execução de
   script; o que passa é injeção de HTML/CSS. É o único ponto do renderer
   em que dado de outra pessoa é interpolado cru.
3. **O D1 não é uma refatoração de 1–2 dias: é de 4 fases, e a primeira
   cabe numa tarde.** A orquestração de sessão/árvore em `app.js` são ~520
   linhas em 30 funções que **não tocam o DOM uma única vez** — só três
   portas nomeadas (`mesh`, `sig`, `ui`). Plano na seção 8.

---

## 1. O CI está vermelho desde 05/09 e nenhuma release foi barrada por isso

**Onde**: `src/main/logger.js:25`, `.github/workflows/test.yml:11-13,26`

**O que é e por que importa.** `logger.js:25` faz
`const { app } = require('electron')` no topo do módulo, sem try/catch. O
workflow roda `npm ci --ignore-scripts`, que pula o `install.js` do pacote
`electron` — sem ele o `node_modules/electron/path.txt` nunca é escrito, e
`require('electron')` lança `Electron failed to install correctly`. Isso não
depende de sistema operacional: vale no Linux desta máquina e no
`windows-latest` do runner.

Confirmado no log da execução 90 (`b20cb17`, 2026-09-15): `# tests 728 /
# pass 727 / # fail 1`, `Process completed with exit code 1` — os mesmos
números que `npm test` dá aqui. E confirmado o intervalo: execução **60**
(`b7f09b8`, 04/09) passou; a **61** (05/09) falhou, logo depois do commit
`a50b89f`, que criou `logger.js`. Da 61 à 90 são **30 execuções seguidas em
vermelho**, cobrindo as versões 0.11.0 a 0.16.0.

O custo real não é o teste que falha — é que o sinal morreu. Um CI que está
sempre vermelho não diz mais nada, e o próximo teste que quebrar de verdade
vai entrar sem ninguém notar. Pior: o comentário do `test.yml` afirma
literalmente que "nenhum deles importa o addon nativo nem o modulo
'electron' fora de um try/catch (ver updater.js)". `updater.js:36` de fato
protege (`try { return require('electron').app.isPackaged === true } catch`);
`logger.js` foi escrito depois e não seguiu o padrão. O comentário virou
documentação de uma invariante que o código não cumpre mais.

**Proposta.**
1. Em `logger.js`, mover a dependência de `electron` pra dentro de
   `logsDir()`, com o mesmo try/catch de `updater.js` — ou, mais simples,
   receber `dir` por parâmetro como o teste já faz e só chamar
   `app.getPath('userData')` quando `dir` não vier. O teste não muda.
2. Trocar o comentário do `test.yml` por algo que o CI verifique: um teste
   que dê `require()` em cada arquivo de `src/main/` num processo sem
   Electron e falhe com o nome do arquivo culpado. A invariante deixa de ser
   uma frase e passa a ser um teste.
3. Ligar proteção de branch na `main` exigindo o job `test` — senão a
   próxima regressão repete a história.

**Custo**: 1–2 h · **Risco de regressão**: baixo · **Prioridade**: **P0**
(não quebra pro usuário, mas desliga a única rede de segurança automática do
projeto, e já deixou passar 6 releases)

---

## 2. A imagem do chat é interpolada crua no HTML; a validação só olha o prefixo

**Onde**: `src/renderer/ui.js:2303-2308` (`chatImageHtml`),
`src/renderer/chatmedia.js:58-60` (`isImageDataUrl`),
`server/signaling-core.js:925-927` e `:279-281`

**O que é e por que importa.** `ui.js:2307` monta a linha do chat assim:

```js
return `<button class="chat-image" ...><img src="${entry.image}" alt="..." /></button>`;
```

`entry.image` vai **sem escape**, e o comentário logo acima (`ui.js:2298-2302`)
justifica: *"o atributo e montado com o valor cru de proposito: escapar um
data URL o quebraria, e a validacao ja garantiu que ele nao e outra coisa."*
A segunda metade da frase é falsa. A validação, nas três cópias
(`chatmedia.js:59`, `signaling-core.js:926`, `signaling-core.js:280`), é a
mesma regex **ancorada só no início**:

```js
/^data:image\/(png|jpeg|gif|webp);base64,/
```

Ela não diz nada sobre o resto da string. Verificado rodando o módulo:

```
payload  = 'data:image/png;base64,AAAA" onerror="alert(1)'
isImageDataUrl -> true   fitsBudget -> true   regex do servidor -> true
html gerado    -> <img src="data:image/png;base64,AAAA" onerror="alert(1)" alt="..." />
```

O caminho é inteiro: um cliente qualquer manda `{type:'chat', image: <payload>}`,
o servidor aceita (prefixo bate, ≤ 200 KB), `pushChatEntry` guarda no
histórico (então quem entrar depois também recebe) e `broadcastToRoom` manda
pra sala inteira. Cada cliente executa a interpolação acima.

**O que salva hoje**: o CSP de `index.html:5-6` não tem `script-src` próprio
e cai no `default-src 'self'` — sem `'unsafe-inline'`, então o `onerror`
injetado não roda. O que **passa** é injeção de HTML e de CSS (`style-src`
tem `'unsafe-inline'`): dá pra fechar o atributo, abrir uma `<style>` ou uma
`<div>` posicionada e cobrir a interface com o que se quiser — a fraude
óbvia é um falso "digite o PIN da sala". Numa sala entre amigos o risco é
baixo; o problema é que a única coisa entre a injeção e a execução de script
é uma diretiva de CSP que ninguém testa e que uma linha de `index.html` pode
apagar sem que nenhum teste reclame. E ela encadeia com o achado 3.

**Proposta.**
1. `ui.js`: parar de montar o `<img>` por string. Criar o elemento e atribuir
   `img.src = entry.image` — atribuição de propriedade não tem atributo pra
   fechar, e não quebra o data URL. É a mudança mínima e resolve o caso.
2. `chatmedia.js`: fechar a regex no formato inteiro
   (`/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/`) e
   exportar; o servidor passa a usar a mesma função em `signaling-core.js`
   nos dois pontos. Hoje são três cópias literais da mesma regex frouxa.
3. `css-rules.test.js` já faz guarda de CSS por leitura de arquivo: adicionar
   no mesmo espírito um teste que leia `index.html` e afirme que o CSP não
   tem `'unsafe-inline'` em `script-src`/`default-src`. O CSP passa a ser
   uma invariante testada, não uma linha de sorte.

**Custo**: 2–3 h (inclui o teste de CSP) · **Risco**: baixo ·
**Prioridade**: **P1**

---

## 3. Nenhuma janela tem guarda de navegação, e o `getDisplayMedia` é aprovado sem perguntar

**Onde**: `src/main.js:412` (`setWindowOpenHandler`, só na principal),
`src/main.js:840-863` (`setDisplayMediaRequestHandler`), `src/preload.js` inteiro

**O que é e por que importa.** As quatro janelas estão certas no básico:
`contextIsolation: true` e `nodeIntegration: false` em todas
(`main.js:376-378, 542-545, 407-409, 1198-1201`), `sandbox` no default (que
é ligado, já que nenhum preload usa Node além de `require('electron')`),
`webSecurity` nunca desligado, CSP nas quatro páginas, `setContentProtection`
no overlay, `setWindowOpenHandler` recusando tudo que não seja exatamente a
Espiar. Nada disso é acidental e está bem comentado.

Falta uma peça: **`will-navigate` não existe em lugar nenhum** — verificado
com grep em `src/` e `server/`, zero ocorrências. Nenhuma das quatro janelas
impede que o documento navegue pra fora. O CSP não cobre isso: `default-src`
não restringe navegação de topo (isso seria `navigate-to`/`form-action`, que
não estão no cabeçalho).

Por que importa **em conjunto** com o achado 2: um `<meta http-equiv="refresh">`
injetado pela linha do chat leva a janela principal pra uma URL remota. O
preload continua valendo depois da navegação — o `webContents` é o mesmo —
então a página remota ganha `window.golive` inteiro. O que esse objeto
oferece: `startProcessAudioCapture(pid, exclude)` (áudio de qualquer processo
da máquina, entregue por IPC ao renderer), `listProcessNames()` (inventário
de processos), `hostRoom(...)`, `openLogsFolder()`, `selectSource`/
`listSources`. E `setDisplayMediaRequestHandler` (`main.js:840`) **aprova a
fonte selecionada sem perguntar nada** — `useSystemPicker: false`, nenhum
diálogo, nenhuma checagem de qual `webContents` pediu. Um clique na página
remota basta pra satisfazer a exigência de ativação do Chromium e a captura
sai com `audio: 'loopback'` junto.

*[não verificado]* o elo do `meta refresh` — não rodei o Electron. Os dois
defeitos isolados (ausência de `will-navigate`; handler que aprova sem
verificar origem) estão verificados por leitura.

**Proposta.**
1. Em `createWindow`, `createSplashWindow`, `createOverlayWindow` e no
   `did-create-window` da Espiar, adicionar
   `wc.on('will-navigate', (e, url) => { if (url !== <a url própria>) e.preventDefault(); })`.
   Uma função `travarNavegacao(webContents, urlPermitida)` em `src/main/` com
   teste próprio, no mesmo formato de `src/main/overlay.js`.
2. `setWindowOpenHandler({action:'deny'})` também na splash, no overlay e na
   Espiar — hoje só a principal tem.
3. No `setDisplayMediaRequestHandler`, recusar quando
   `request.frame`/`event.sender` não for o `webContents` da janela principal
   (mesmo padrão que `ipcMain.on('room:active')` em `main.js:1143-1149` já
   usa e que nenhum outro handler usa).
4. `session.defaultSession.setPermissionRequestHandler` recusando tudo que
   não seja `media` vindo da janela principal. Hoje não existe handler
   nenhum, o que significa que o default do Electron decide.

**Custo**: meio dia (itens 1–3), + 1–2 h pro 4 · **Risco**: baixo (é só
recusar o que o app já não faz; o único cuidado é não barrar o `loadFile`
inicial, que não passa por `will-navigate`) · **Prioridade**: **P1**

---

## 4. Um broadcast UDP de qualquer máquina da LAN redireciona a sala pra um endereço arbitrário

**Onde**: `src/renderer/app.js:1074-1082` (`handleMigrationBeacon`),
`src/main/discovery.js:123-140` (`parseMigrationBeacon`),
`src/main/discovery.js:82-105` (`parseBeacon`)

**O que é e por que importa.** Quando o anfitrião cai, a sala migra: o
sucessor sobe um servidor novo e anuncia por beacon UDP onde ele está. Do
outro lado:

```js
function handleMigrationBeacon(beacon) {
  if (!migrationState || migrationState.becoming || beacon?.roomId !== migrationState.roomId) return;
  ...
  joinRoom(`ws://${beacon.address}`, cfg.name, beacon.address, undefined, 0, pin, true);
}
```

A única autenticação é `beacon.roomId === migrationState.roomId`. O `roomId`
viaja em todo `welcome` (`signaling-core.js:787`) e no próprio
`room-migrating` — ou seja, qualquer pessoa que tenha entrado na sala uma
vez o conhece. O beacon de migração não tem PIN, nem token, nem assinatura, e
chega por broadcast UDP de qualquer máquina do segmento.

E `beacon.address` **não é validado como endereço**. `parseMigrationBeacon`
exige só "string não vazia, ≤ 64 caracteres" (`discovery.js:132`). Então
`address: "meu-host.exemplo.net:8080"` passa, vira
`ws://meu-host.exemplo.net:8080`, e o app resolve DNS e conecta — fora da
LAN. Quem ganhar a corrida contra o sucessor legítimo fica sendo o servidor
da sala: vê o chat inteiro, escolhe o que devolver em `welcome` (inclusive o
`chat` histórico, que é o vetor do achado 2) e decide quem entra.

A janela é estreita — só existe entre o `room-migrating` e a reconexão — mas
é justamente o momento em que todo mundo da sala está esperando por um
beacon.

Dois detalhes que reforçam o padrão: `parseBeacon` (a descoberta normal,
`discovery.js:92`) aceita `address` sem nem o limite de 64 caracteres que a
irmã dela 40 linhas abaixo aplica; e o `pin` de `room-migrating` entra em
`becomeMigrationHost` (`app.js:1055`) e daí direto no `room:host` sem
checagem de tipo — um `pin` que não seja string vira um PIN que nenhuma
comparação casa (`signaling-core.js:713`), e a sala migrada não aceita mais
ninguém.

**Proposta.**
1. Validar o formato em `parseMigrationBeacon` e em `parseBeacon`: uma
   função `parseHostPort(s)` que só aceite IPv4 (ou IPv6 entre colchetes) +
   porta 1-65535, com teste. Recusar o resto. O app é de LAN virtual: nome
   de host nunca foi caso legítimo.
2. Exigir que o beacon prove que veio de dentro da sala. O mais barato sem
   inventar cripto: o `room-migrating` já carrega `successor` e
   `newOwnerClientId`; o beacon passa a carregar um `nonce` que o servidor
   distribuiu no `room-migrating`, e `handleMigrationBeacon` compara. Não é
   à prova de quem estava na sala (não precisa ser — a ameaça é o vizinho de
   LAN que nunca entrou), mas fecha o caso do estranho.
3. Validar tipo de `pin`/`roomId`/`bans`/`chat` em `becomeMigrationHost`
   antes de passar pro IPC. O servidor já sanitiza `chat` e `bans`
   (`sanitizeInitialChatEntry`, `sanitizeInitialBan`) — só `pin` e `roomId`
   ficaram de fora.

**Custo**: meio dia · **Risco**: médio (mexe no caminho de migração, que é
difícil de testar sem duas máquinas — mas `signaling-migration-e2e.test.js`
já existe e é onde o teste do item 2 mora) · **Prioridade**: **P1**

---

## 5. `tree` é a única mensagem de aplicação que o servidor repassa crua

**Onde**: `server/signaling-core.js:874-887`, `src/renderer/app.js:3066-3115`

**O que é e por que importa.** O servidor tem uma convenção explícita e bem
escrita para mensagens que viram chave no cliente — está no comentário do
`case 'reoffer'` (`signaling-core.js:891-893`): *"os dois campos que viram
chave no cliente precisam ter tipo e formato exatos antes de chegar la.
Reconstruir tambem nao deixa campo arbitrario viajar junto com o pedido."*
`chat`, `annotate`, `laser`, `reaction`, `watchers`, `broadcast-state`,
`camera-state` e `reoffer` seguem isso: cada um é reconstruído campo a campo.

`offer`/`answer`/`ice`/`view-state`/`tree` caem no encaminhamento genérico
`send(target.ws, { ...msg, from: peerId })`. Para SDP e ICE isso é inerente.
`view-state` se protege do lado do cliente (`normalizeEncodeHealth`,
`normalizeReceiveHealth`, `Boolean(msg.watching)`). **`tree` não.**

No `case 'tree'` do cliente, `msg.epoch` é usado sem checagem de tipo:

```js
if (msg.epoch < state.epoch) break;
...
state.epoch = msg.epoch;
```

Um peer hostil (ou com bug) manda `{type:'tree', to:<alvo>, kind:'screen',
epoch: 1e308, filhos: []}`. `1e308 < 0` é falso, então passa; a partir daí
todo `tree` legítimo daquela origem (`epoch` 1, 2, 3...) cai no `break` — e o
nó fica **permanentemente com o papel que tinha**, ignorando a origem pra
sempre naquela sessão. Se ele era relay, segue repassando pra filhos que a
origem já reassumiu; se era folha, nunca mais recebe reatribuição. O sintoma
pro usuário é tela preta que não se cura sozinha e que nenhuma reconexão
conserta — só sair e entrar da sala.

`msg.paiId` e cada item de `msg.filhos` também entram sem validação;
`filhos` só é checado como array (`app.js:3080`). Um array grande faz
`flushPendingRelay` iterar chamando `mesh.relayTo` item a item.

**Proposta.**
1. Servidor: reconstruir `tree` como o `reoffer` já faz —
   `epoch` com `Number.isInteger` e teto, `paiId` e cada `filhos[i]` contra
   `CONNECTION_ID_RE` (já existe, `signaling-core.js:71`), `filhos` cortado
   em, digamos, 8, e presença de todos na mesma sala.
2. Cliente: `if (!Number.isInteger(msg.epoch) || msg.epoch < 0) break;` antes
   da comparação — a defesa em profundidade que `view-state` já tem.
3. Teste em `signaling-core.test.js`: `tree` com `epoch` string, com `filhos`
   contendo id de outra sala, e com `filhos` gigante.

**Custo**: 3–4 h · **Risco**: baixo · **Prioridade**: **P2**

---

## 6. `startShare` não tem `catch`: uma falha depois de `localStream = stream` deixa você capturando pra ninguém

**Onde**: `src/renderer/app.js:3338` (assinatura), `:3460` (`localStream = stream`),
`:3526-3528` (laço de ofertas sem try/catch), `:3538-3540` (o `finally` solitário)

**O que é e por que importa.** A função é de 205 linhas e tem um único
`try { ... } finally { sharing = false; }`. Não tem `catch`. As saídas
antecipadas *dentro* do try são exemplares — cada uma para as tracks e chama
os `stop` das capturas nativas já iniciadas (`:3411-3414`, `:3447-3452`).
O problema é o que acontece depois de `:3460`, onde `localStream`,
`captureTrack`, `stopNativeAudioFns` e o tile `'me'` já foram atribuídos e
**nada depois disso está protegido**.

O ponto mais provável de falhar é logo ali:

```js
for (const peerId of session.mesh.peers.keys()) {
  await offerOwnStreamTo(session, peerId, localStream, quality, 'screen');
}
```

`offerOwnStreamTo` devolve `session.mesh.offerTo(...)`, que rejeita em glare,
em peer que acabou de sair, e no `InvalidAccessError` de ordem de m-line que
o próprio histórico do projeto registra (commit `aea96fa`). A primeira
rejeição aborta o laço e sai da função.

O que sobra: a captura de tela **rodando**, o áudio nativo **rodando**, o
tile de prévia na tela — e `broadcast-state {live:true}` nunca enviado,
`ui.setToggleState('share','on')` nunca executado, `startStatsLoop()` nunca
chamado, `recomputeTree` nunca chamado. Pro usuário: a prévia dele está lá,
o botão diz "Compartilhar tela", e ninguém na sala vê "AO VIVO". O erro é
registrado (`ui.js:3486-3488` faz `console.error('[picker] onGoLive falhou:')`,
que o main copia pro arquivo de log), e clicar no botão de novo cai em
`if (localStream) return stopShare()`, que desfaz tudo. Recuperável, portanto —
mas só por acidente, e sem nenhuma pista pro usuário.

A assimetria é o que dói na manutenção: **o mesmo laço, com o mesmo
`offerOwnStreamTo`, está protegido em `handleSignal`** — no `welcome`
(`app.js:2571-2577`) e no `peer-joined` (`app.js:2634-2641`), cada um com um
try/catch por peer e um comentário explicando exatamente por quê ("uma oferta
isolada que falha (peer que ja sumiu, glare) nao pode abortar as demais").
A regra existe, está escrita, e não foi aplicada aqui.

**Proposta.**
1. Envolver o laço de `:3526` no mesmo try/catch por peer dos outros dois
   pontos, com o mesmo `console.error`.
2. Dar um `catch` ao try externo que chame `stopShare()` e mostre um toast —
   ou seja, reusar o desmonte que já existe e é completo, em vez de escrever
   outro. `stopShare` é idempotente (`if (!localStream) return`).
3. Fazer o mesmo exame em `swapShare` (`:3544-3763`, 220 linhas): ela já tem
   um caminho de rollback explícito (`commit.audio`, `startedNativeStops`),
   mas vale conferir se a ausência de `catch` externo tem a mesma
   consequência. *[não verificado] — não li as 220 linhas da swapShare linha
   a linha.*

**Custo**: 2–3 h · **Risco**: baixo · **Prioridade**: **P1** (é o caminho
mais usado do app, e o estado que ele deixa é "você acha que está
transmitindo e não está")

---

## 7. O retângulo do overlay de rabisco é calculado uma vez e nunca revalidado

**Onde**: `src/main.js:1240-1252` (`overlay:start`), `src/main.js:1178-1196`
(`createOverlayWindow`), `src/main/overlay.js` (`boundsFor`)

**O que é e por que importa.** `overlay:start` faz
`boundsFor(selectedDisplayId, screen.getAllDisplays())` uma vez e cria a
janela com esses bounds. A janela é `resizable: false`, `movable: false`.
Depois disso, nada consulta o `screen` de novo: verificado com grep,
**nenhum listener de `display-metrics-changed`, `display-added` ou
`display-removed` existe no projeto**.

Consequências, todas no meio de uma transmissão:

- O jogo entra em tela cheia exclusiva numa resolução diferente da do
  desktop, ou a pessoa muda a escala de DPI: o overlay continua no retângulo
  velho. Os rabiscos param de cair no pixel certo — e a spec do recurso
  (`2026-09-05-rabisco-na-tela-real-design.md`) diz que "um overlay que erra
  o lugar é pior que overlay nenhum", que foi exatamente o argumento para
  não suportar compartilhamento de janela.
- O monitor compartilhado é desconectado: a janela fica com bounds de um
  display que não existe; o Electron a reposiciona em algum lugar, com
  `alwaysOnTop` + `screen-saver` + `setContentProtection`, invisível pra
  captura e por cima de tudo.

A troca de fonte ao vivo está coberta (`swapShare` reabre o overlay via
`plan.overlayShouldReopen`, `app.js:3747-3750`) — o que não está coberto é a
geometria mudar debaixo da fonte que continua a mesma. A janela Espiar, por
comparação, revalida (`loadSpyBounds` chama `clampBounds` contra
`getAllDisplays()`, `main.js:96-104`) — mas só ao abrir.

**Proposta.**
1. No `createOverlayWindow`, assinar `screen.on('display-metrics-changed')` e
   `screen.on('display-removed')`; no callback, recalcular `boundsFor` e
   chamar `overlayWin.setBounds(novo)`; se `boundsFor` devolver null (o
   display sumiu), destruir a janela e avisar o renderer pra mostrar o mesmo
   toast que já existe pro motivo `'display'` (`app.js:2160-2163`).
2. Remover os listeners em `destroyOverlayWindow` — `screen` é global e
   sobrevive à janela.
3. `src/main/overlay.js` já é puro e testado; a decisão ("mudou? pra onde?
   ainda existe?") entra lá, e o `main.js` só executa.

**Custo**: 3–4 h · **Risco**: baixo · **Prioridade**: **P2**

---

## 8. D1 — o plano concreto de extração (e o que `ui.js` não é)

**Onde**: `src/renderer/app.js` (5341 linhas, 1 IIFE),
`src/renderer/ui.js` (3638 linhas, 1 IIFE)

### 8.1 O mapa: o que de fato mora em cada um

**`app.js`** é uma IIFE única com **60 variáveis de estado mutável** e 55
constantes no escopo do módulo, e **142 funções de primeiro nível**. As
responsabilidades que convivem lá dentro, com as fronteiras onde elas se
tocam:

| bloco | linhas | o que é |
|---|---|---|
| bootstrap, config, tema, som | 1–320 | carrega `cfg`, aplica tema, versão do app |
| qualidade e audiência | 373–600 | `qualityFor`, `qualityForPeer`, escada por espectador, `meshFallback` |
| lobby: lista de salas, atualização, toasts | 606–1000 | 25 ids de DOM manipulados direto |
| hospedar / migrar sala | 1004–1120 | `hostRoomFlow`, `becomeMigrationHost`, beacons |
| aviso de firewall/endereço | 1122–1236 | monta texto e comando de PowerShell |
| desmonte de sessão | 1247–1310 | `teardownMedia` / `teardownPeers` / `teardownSession` |
| painel de membros, status da sala | 1311–1430 | |
| **`joinRoom`** | 1455–1979 | **525 linhas**: conexão, retry, orfanização, adoção |
| chat: imagem, redimensionamento | 1984–2130 | canvas + FileReader |
| overlay de rabisco (ponte) | 2134–2215 | |
| abas, desconectar | 2220–2325 | |
| autocura (stall, reoffer) | 2326–2465 | |
| **`handleSignal`** | 2467–3135 | **669 linhas, 24 cases** |
| áudio por processo (WASAPI) | 3137–3310 | AudioWorklet, árvore de PIDs |
| **`startShare` / `swapShare` / `stopShare`** | 3311–3830 | **~520 linhas** |
| câmera | 3951–4120 | |
| visibilidade da janela | 4111–4150 | |
| quem assiste o quê | 4154–4480 | `watchedScreens`, `lookingByViewer`, `watchers` |
| **árvore de retransmissão** | 4482–4780 | `recomputeTree` e amigos |
| estatísticas e telemetria | 4771–5341 | `updateStats` (235 linhas), `renderStats` |

**Quanto é lógica pura.** Medido por função: das 142 funções de primeiro
nível (4084 linhas cobertas), **58 (612 linhas) não tocam DOM, mídia, rede
nem timer**. Isso *subestima* o que é extraível, porque o critério conta
`mesh.` e `sig.send` como impureza — e é exatamente isso que um módulo de
orquestração transforma em porta.

O número que importa é este: no conjunto candidato do D1 (30 funções de
sessão/árvore/audiência, 518 linhas), **nenhuma toca `document` e nenhuma
toca `window.golive`**. As que tocam alguma coisa tocam só três nomes:

| porta | funções que usam |
|---|---|
| `mesh.*` | 12 (`recomputeTree`, `flushPendingRelay`, `recoverFromRelayLoss`, `applyOriginAssignments`, `reofferOne`, …) |
| `sig.send` | 4 (`applyOriginAssignments`, `broadcastWatchers`, `checkStalledTiles`, `requestResumeReoffer`) |
| `ui.*` | 4 (`teardownPeers`, `applyWatchers`, `dropWatchers`, `dropReporter`) |
| `setTimeout` | 2 (`recomputeTree`, `requestResumeReoffer`) |
| nenhuma | 18 |

**`ui.js`**, pela mesma medida, é o oposto: **97 das 148 funções (2226 de
2573 linhas, 87%) tocam DOM**. As 51 funções "puras" somam 347 linhas em
funções de 7 a 24 linhas cada. **`ui.js` não é alvo do D1**: extrair lógica
pura dali renderia um punhado de helpers minúsculos e deixaria o arquivo do
mesmo tamanho. O problema dela é coesão (22 seções: grade, canvas de
anotação, laser, reações, PiP, lobby, diálogos, membros, chat, emoji,
configurações, seletor de fonte, barra de controle), e o remédio é dividir
por seção em arquivos que exportam para o mesmo `GoLive.ui`, não extrair
lógica.

**A costura que já está torta.** A convenção declarada é "`ui.js` é dono do
DOM". `app.js` a quebra em **77 pontos**: 50 chamadas de `$()` cobrindo 25
ids distintos (`#toast`, `#lobby-error`, `#update-banner`, `#setup-error`,
`#user-panel-*`, `#stage-warning`, `#btn-pause-share`, `#btn-swap-share`,
`#room-side`, as abas…) e 27 `addEventListener`. Não é "orquestração vs.
DOM": é que `ui.js` ficou com os widgets difíceis e `app.js` ficou com os
fáceis. Qualquer plano que não decida isso primeiro só muda de lugar a
bagunça.

### 8.2 O plano, em quatro fases

O princípio: **portas nomeadas, não injeção genérica.** O módulo novo recebe
um objeto com as três portas que já existem (`mesh`, `sig`, `ui`) e um
relógio. Não recebe `document`, não recebe `window.golive`, não importa
nada de `src/main/`. É o mesmo formato de `discovery.js` (lógica pura +
socket por fora) que a auditoria original citou como modelo.

---

**Fase 0 — a fronteira do DOM (pré-requisito, não opcional).**

Mover os 25 ids que `app.js` manipula direto para métodos de `ui.js`, na
forma que ela já usa: `ui.toast.show(msg, ms)`, `ui.lobby.setError(txt)`,
`ui.update.showBanner({text, progress})`, `ui.stage.setWarning(parts)`,
`ui.userPanel.render(cfg)`, `ui.controls.setPauseVisible(bool)`. Nenhuma
lógica muda; é recorte e realocação.

*Por que primeiro*: enquanto `app.js` puder chamar `$()`, qualquer coisa
extraída dele vai levar uma chamada de DOM junto na primeira manutenção.

*Teste*: nenhum novo. O que garante a fase é o lint (`no-undef` pega `$`
fora de `app.js`) mais uma regra `no-restricted-globals` no
`eslint.config.js` proibindo `document` em `app.js` — que é a única forma de
a fronteira não voltar a vazar.

**Custo**: 1 dia · **Risco**: médio (77 pontos, muita chance de errar um id;
mitigado por ser mecânico) · **Ganho**: sem ela, as fases 1–3 não seguram.

---

**Fase 1 — `src/renderer/session-tree.js`: a árvore, primeiro.**

O alvo exato, já medido: `roleFor`, `resetTreeState`, `dropRelaysOf`,
`flushPendingRelay`, `isRelayOnCooldown`, `forgetOriginTree`, `hasActiveTree`,
`recomputeTree`, `recoverFromRelayLoss`, `applyOriginAssignments`,
`setMeshFallback`, e o `case 'tree'` de `handleSignal` (`app.js:3066-3115`).
**~370 linhas.** O estado que vai junto: `originTree`, `myRole`,
`recentRelayFailures`, `meshFallback`, `reelectionAt`, `deferredRecompute` —
6 das 60 variáveis de módulo, e nenhuma delas é lida fora desse conjunto
(verificado por grep).

Superfície proposta:

```js
createTreeOrchestrator({
  mesh,                       // { peers, closeOut, relayTo, isPeerSuspended }
  send,                       // (payload) => void   -- o sig.send da sessão
  ui: { onMeshFallback },     // (kind, ligado) => void  -- toast e retune
  tree,                       // o tree.js puro, injetado pra teste
  now: () => Date.now(),
  schedule: (fn, ms) => id,   // setTimeout injetável
  cancel: (id) => void,
  qualityFor, qualityForPeer, // por ora, callbacks pra app.js
}) => {
  recompute(kind, { force }),
  applyRemoteTree(kind, msg),       // o case 'tree' inteiro
  onRelayLost(kind, relayId),
  onPeerLeft(peerId),
  flushPending(kind, sourceId),
  reset(),
  roleOf(kind, origem),             // leitura, pro resto do app.js
  isRelaying(),
}
```

Em `app.js` sobram as chamadas: `treeOrch.recompute('screen')` onde hoje está
`recomputeTree('screen')`, etc.

*Testes desta fase* (o que a auditoria pedia e não existe): re-eleição com
histerese (recálculo dentro da janela adia e não descarta); `sameAssignments`
igual não sobe epoch; `force` passa reto pela histerese; `recoverFromRelayLoss`
fecha a out-conn **antes** de reofertar às órfãs; `flushPendingRelay` chamado
duas vezes com os mesmos argumentos só repassa uma vez (a corrida do commit
`aea96fa`, hoje sem teste); `tree` com epoch antigo é descartado, com epoch
novo aplica; filho que sai da lista tem o repasse fechado; `meshFallback` só
liga com 2+ espectadores. Fake de `mesh` é um objeto literal — o padrão que
`mesh.test.js:80-140` já usa.

**Custo**: 1,5 dia (0,5 de extração, 1 de teste) · **Risco**: médio-alto
(é o código mais sutil do app; mitigado pelo fato de que o teste **não
existe hoje**, então qualquer teste é lucro) · **Ganho**: fecha o D1 no
ponto que a auditoria nomeou ("quem chama `recomputeTree`, quando
`flushPendingRelay` roda, a ordem de `recoverFromRelayLoss`").

---

**Fase 2 — `src/renderer/audience.js`: quem assiste o quê.**

`app.js:4154-4480` (~330 linhas): `watchingCamera`, `syncWatchedCamera`,
`liveScreenIds`, `watchingScreen`, `syncWatchedScreens`, `unwatchScreen`,
`applyWatchIntent`, `broadcastViewState`, `lookingKey`, `isLooking`,
`ownerOfTile`, `applyWatchers`, `mergeWatchers`, `dropWatchers`,
`dropReporter`, `broadcastWatchers`, `broadcastAllWatchers`. Estado:
`watchedScreens`, `unwatchedCameras`, `watchersByTile`, `lookingByViewer`,
`autoWatchSuppressed`, `lastViewStateSent`.

É o bloco mais fácil dos três: quase tudo é manipulação de `Map` e derivação
de listas. As únicas saídas são `sig.send({type:'view-state'|'watchers'})` e
`ui.grid.setWatchers/setWatched`.

*Testes*: união de listas vindas de relays diferentes; `dropReporter` some
com o que aquele relay contava sem apagar o que os outros contam; um id
reaproveitado não herda estado; `broadcastViewState` não reenvia estado
idêntico (hoje `lastViewStateSent` faz isso sem teste).

**Custo**: 1 dia · **Risco**: baixo · **Prioridade dentro do plano**: depois
da fase 1, porque a fase 1 chama `broadcastWatchers`.

---

**Fase 3 — `handleSignal` partido em dois roteadores.**

Os 24 cases, 663 linhas, dividem-se limpo:

- **sessão/mídia** (466 linhas): `welcome` (147), `peer-joined` (59),
  `peer-left` (64), `peer-resumed` (12), `offer` (21), `answer` (8),
  `ice` (4), `tree` (70, já foi na fase 1), `view-state` (51),
  `reoffer` (21), `watchers` (9)
- **interface/sala** (197 linhas): `chat` (22), `moderated` (17),
  `annotate` (9), `laser` (8), `reaction` (8), `annotate-sync` (10),
  `owner-changed` (11), `banned-list` (9), `camera-state` (11),
  `broadcast-state` (43), `room-migrating` (30), `room-closed` (12),
  `join-denied` (7)

O segundo grupo é quase todo `ui.*` + `playSoundEvent` e pode virar
`handleRoomSignal(msg, {ui, sound, chat})` sem tocar em nada de mídia. O
primeiro grupo continua em `app.js` por enquanto — `welcome` sozinho tem 147
linhas e depende de captura local, `resume.planResume`, re-oferta e loop de
stats. Tentar extraí-lo na mesma passada é como o D1 virou "1–2 dias" e não
foi feito.

**Custo**: 1 dia (só o grupo de interface) · **Risco**: baixo ·
**Prioridade**: P3, faça só se as fases 0–2 tiverem corrido bem.

---

### 8.3 O que eu NÃO faria

- **Não** quebrar `app.js` por arquivo sem quebrar por responsabilidade
  primeiro. Os `<script>` de `index.html:400-433` são 30 tags numa ordem
  fixa, compartilhando `window.GoLive`; mais um arquivo é mais uma linha
  nessa lista e mais uma chance de ordem errada. Cada fase acima só se
  justifica porque leva um teste junto.
- **Não** transformar `ui.js` em "módulo puro". Os 87% de DOM são a razão de
  ela existir.
- **Não** fazer as quatro fases numa branch só. Fase 0 sozinha já é uma
  entrega, e é a que mais reduz risco das seguintes.

**Custo total**: 4–5 dias em 4 entregas independentes (a auditoria estimava
"1–2 dias" para tudo — era otimista por um fator de ~3) ·
**Risco de regressão**: médio na fase 1, baixo nas outras ·
**Prioridade**: **P2** (não corrige bug aberto; é o que faz o próximo bug de
árvore ter teste em vez de log)

---

## 9. A cobertura que o Node mede hoje diz 98% e não enxerga 58% do código

**Onde**: saída de `node --test --experimental-test-coverage` na raiz

**O que é e por que importa.** Rodei. O relatório termina com:

```
# all files                         |  98.00 |    91.84 |   91.44 |
```

E `src/renderer/app.js`, `src/renderer/ui.js` e `src/main.js` **não aparecem
em nenhuma linha do relatório**. O `--experimental-test-coverage` só reporta
arquivos que foram carregados durante a execução; o que nenhum teste importa
simplesmente não existe pra ele.

Contabilidade honesta: 19.122 linhas de produção (`src/` + `server/` +
`scripts/`, sem `*.test.js`). **11.164 delas (58%) nunca são carregadas
pelo `node --test`** — `app.js` (5341), `ui.js` (3638), `main.js` (1371),
`overlay.js` (229), `preload.js` (181), `sound.js` (174) e mais sete
arquivos pequenos.

Ou seja: ligar cobertura no CI hoje, do jeito que está, publicaria um número
de 98% que é verdade sobre a metade fácil e mentira sobre o projeto. Isso é
pior do que não ter número nenhum.

**Proposta.** Ligar, mas com o denominador honesto:
`node --test --experimental-test-coverage --test-coverage-include='src/**/*.js' --test-coverage-include='server/**/*.js'`
(o Node 22 tem essas flags). O número vai cair pra algo perto de 40% e vai
**subir** a cada fase do plano da seção 8 — que é exatamente o uso certo de
cobertura: medir progresso de uma refatoração, não pontuar.

**Custo**: 1 h · **Risco**: nenhum · **Prioridade**: **P2** (faça junto com
o achado 1, quando o CI voltar a ser verde)

---

## 10. Cinco `ipcMain.on` moram dentro de `createWindow`

**Onde**: `src/main.js:381, 384, 389, 392, 453` (dentro de `createWindow`,
350–521), contra `main.js:971-1367` (os outros 26, no nível do módulo),
`src/main.js:898-900` (`app.on('activate')`)

**O que é e por que importa.** `window:minimize`, `window:toggle-maximize`,
`window:close`, `window:show` e `spy:back` são registrados dentro de
`createWindow()`. Todos os outros 26 handlers são registrados uma vez, no
nível do módulo. `createWindow` é chamado por `releaseApp()` e por
`app.on('activate')` — numa segunda chamada, esses cinco canais ganham um
segundo ouvinte cada, para sempre (`ipcMain.on` acumula).

Hoje é latente: `activate` é evento de macOS, e `window-all-closed` chama
`app.quit()` fora do darwin (`main.js:934`), então na prática `createWindow`
roda uma vez por processo no Windows. Não estou reportando um bug ativo —
estou reportando que a convenção do arquivo ("handler de IPC é global e
registra uma vez") tem cinco exceções sem motivo declarado, e que a primeira
pessoa que implementar "reabrir a janela principal" vai receber dois
`window:close` por clique.

**Proposta.** Mover os cinco para o bloco `// --- IPC ---` junto dos outros,
lendo `win` da variável de módulo (que todos os outros já fazem). São cinco
recortes; os corpos não mudam, porque já começam com
`if (!win || win.isDestroyed()) return`.

**Custo**: 30 min · **Risco**: baixo · **Prioridade**: **P3**

---

## 11. Os tetos de anotação estão duplicados dos dois lados do fio sem a guarda que os de imagem têm

**Onde**: `src/renderer/annotate.js:39-41` (`MAX_ITEMS=400`,
`MAX_POINTS_PER_STROKE=2000`, `MAX_TEXT=120`),
`server/signaling-core.js:63-66` (`MAX_ANNOTATE_POINTS=200`,
`MAX_ANNOTATE_TEXT=120`, `MAX_ANNOTATE_SYNC_ITEMS=400`),
`src/renderer/chatmedia.test.js:13`

**O que é e por que importa.** O projeto tem uma solução boa pra constantes
que precisam bater dos dois lados da rede: `chatmedia.js:16-19` documenta a
duplicação ("*Se um dos dois mudar, o teste de ponta a ponta reclama*") e
`chatmedia.test.js:13` a garante:

```js
assert.equal(MAX_IMAGE_CHARS, servidor.MAX_IMAGE_CHARS);
```

A anotação tem exatamente o mesmo problema — `MAX_TEXT` e `MAX_ITEMS` no
cliente contra `MAX_ANNOTATE_TEXT` e `MAX_ANNOTATE_SYNC_ITEMS` no servidor,
com os mesmos valores — e **não tem a guarda**. O servidor nem exporta as
duas constantes (`signaling-core.js:1203-1212` exporta só as de imagem), e
nenhum teste as compara (verificado por grep em todos os `*.test.js`).

Se alguém subir `MAX_TEXT` pra 200 no cliente, o texto passa a ser cortado
em silêncio pelo servidor em 120 — o mesmo tipo de falha muda que o item
0.10.2 do STATUS descreve (campo descartado sem erro, sem pista).

**Proposta.** Exportar `MAX_ANNOTATE_TEXT` e `MAX_ANNOTATE_SYNC_ITEMS` em
`signaling-core.js` e acrescentar duas linhas em `annotate.test.js` no
mesmo formato de `chatmedia.test.js:13`. Aproveitar e fazer o mesmo pelo
`MAX_POINTS_PER_STROKE` × `MAX_ANNOTATE_POINTS` — que **não** são o mesmo
número (2000 vs 200) porque medem coisas diferentes (traço inteiro vs. lote
de um quadro); vale um comentário dizendo isso, senão alguém vai "consertar".

**Custo**: 1 h · **Risco**: nenhum · **Prioridade**: **P3**

---

## Ferramentas: o que vale e o que não vale

Avaliado pro que o projeto é — um app desktop, mantido por uma pessoa, sem
nenhuma dependência npm no renderer, servido por `file://`.

### Vale

**1. Cobertura com denominador explícito** — ver achado 9. Zero instalação
(já está no Node), 1 h de trabalho, e é o único jeito de o plano da seção 8
ter placar. **Sim.**

**2. JSDoc + `checkJs`, mas só nos módulos puros.** Um `jsconfig.json` com
`checkJs: true` e `include` listando `src/renderer/{tree,mesh,annotate,
resume,succession,screenres,autoquality,peerquality,...}.js`,
`src/main/*.js` e `server/signaling-core.js` — explicitamente **fora**
`app.js` e `ui.js`. Esses módulos já têm JSDoc em prosa de altíssima
qualidade; anotar tipo é incremental e o retorno é imediato nos pontos que
mais doem hoje (`msg.epoch` do achado 5 seria `any`, e a primeira anotação
de `TreeMessage` já forçaria a pergunta). Adicionar `app.js` ao `include`
produziria centenas de erros de uma vez e a pessoa desligaria tudo. **Sim,
mas com `include` restrito, e só depois da fase 0 da seção 8.**

**3. TypeScript de verdade.** **Não.** Exigiria build no renderer (ver
abaixo), e o ganho sobre `checkJs` num projeto sem API pública e sem equipe
não paga a mudança no ciclo de edição.

### Não vale

**4. Bundler (esbuild/Vite) ou `electron-vite` no renderer.** **Não.**
O renderer não importa **nada** do npm: são 30 arquivos locais servidos por
`file://` com `<script>`. Um bundler resolveria um problema que o projeto
não tem (resolução de dependências de terceiros) e criaria três que ele não
tem hoje: um passo de build entre editar e ver, sourcemaps a configurar, e
`build.files` do `electron-builder` a reescrever. O único ganho real seria
a ordem dos `<script>` de `index.html:400-433` deixar de ser manual — e isso
se resolve muito mais barato com um teste que leia `index.html` e confira
que toda tag existe e está antes de quem a usa.

**5. `madge` / `dependency-cruiser`.** **Não** — e por um motivo técnico,
não de gosto: os módulos do renderer não têm `import` nem `require` entre si.
Eles se registram em `window.GoLive` e são lidos por desestruturação
(`app.js:5`). Um grafo estático desses arquivos sai praticamente **vazio**;
as únicas arestas que essas ferramentas veriam são os `require` dos arquivos
de teste. Investiriam tempo pra produzir um diagrama que não descreve o
sistema.

**6. `knip` (código morto).** **Não, pelo mesmo motivo.** `knip` trabalha
sobre o grafo de imports. Aqui ele veria cada módulo do renderer como
"exportado e nunca importado" (a não ser pelo teste) e reportaria quase tudo
como morto. Se a preocupação for código morto de verdade, o barato é o que
já está ligado: `eslint` com `no-unused-vars` (rodando, 0 erros) mais uma
varredura manual de `window.GoLive.*` de tempos em tempos.

**7. Formatador (Prettier).** **Não.** O estilo está consistente e o código
tem muito comentário alinhado à mão em prosa; um formatador reembaralharia
isso sem ganho.

### O que eu faria antes de qualquer ferramenta

Consertar o CI (achado 1) e ligar proteção de branch. Uma ferramenta a mais
num projeto cujo CI ninguém olha é uma ferramenta a menos.

---

## Itens do backlog existente que reavaliei

| Item | Onde estava | Situação hoje |
|---|---|---|
| **B4** (sem limite de payload nem taxa no WS) | "feito na 0.1.x" | **Continua feito, e melhor do que o pedido.** `signaling-core.js:19` tem `maxPayload: 512 KB`; há **oito** limitadores distintos (sinalização 300/s, chat 5/s, imagem 3/5s, anotação 60/s, laser 30/s, reação por balde de fichas, reoffer 2/s, watchers 20/s), cada um com justificativa numérica no comentário. Nada a fazer. |
| **B5** (destino em outra sala) | "feito na 0.1.x" | **Feito.** `signaling-core.js:882-884` exige `me.room === target.room` no encaminhamento genérico, e cada case reconstruído repete a checagem. Encontrei a exceção adjacente que vale abrir: a mensagem `tree` passa por essa checagem de sala mas **não** é reconstruída campo a campo como as outras — achado 5. |
| **D1** (extrair módulo puro de orquestração) | "Fora de escopo: 1–2 dias" | **Continua válido e continua não feito.** A estimativa estava otimista por ~3x: o plano honesto é 4–5 dias em 4 entregas (seção 8). A boa notícia que a auditoria não tinha: o conjunto-alvo **não toca DOM em lugar nenhum**, então a fase 1 (a árvore, ~370 linhas + testes) é 1,5 dia e já entrega o que o D1 pedia. |
| **D2** (sem teste ponta a ponta de sinalização) | listado em D | **Resolvido sem ninguém marcar.** `server/signaling-e2e.test.js` (434 linhas) e `signaling-migration-e2e.test.js` (182) existem desde `da3b6e8` (02/09) e sobem servidor com clientes `ws` reais. O STATUS não menciona; vale registrar como feito. |
| **C1** (não existe CI) | "feito" | **Existe e está quebrado há 12 dias.** Achado 1. O item deveria voltar ao backlog com redação nova: "o CI existe; falta ele ser verde e obrigatório". |
| **C7** (sem lint) | "feito" | **Feito e saudável.** `npm run lint` → 0 erros, 9 avisos `require-atomic-updates`, todos pré-existentes e documentados como falso positivo no commit `09dd353`. O passo roda no CI antes do teste e passa. |
| **F1** (acessibilidade) | Fora de escopo, "zero atributos ARIA, sem `:focus-visible`" | **As duas coisas que o item nomeia já foram feitas** — provavelmente de carona nos redesigns, sem ninguém marcar. ARIA: 24 ocorrências de `aria-label`/`role=` em `index.html` e 26 em `ui.js` (`role="status"` no véu de pausa, `role="menuitem"` no menu de membro, `aria-label` nos controles de janela e nos botões de tile). `:focus-visible`: 7 regras em `style.css`, inclusive um `:where(button, .icon-btn-inline, .room-row, .source-card, .picker-tab, .settings-cat, input, select, textarea):focus-visible` em `style.css:312` que cobre o grosso de uma vez. **O item, como está escrito, não descreve mais o código.** O que sobra de acessibilidade de verdade (ordem de foco nos modais, leitor de tela, contraste dos sete temas) é outro item, com outro texto — e aí sim continua fora de escopo. |
| **F3** (host cai, sala morre) | "confirmado, por desenho" | **Deixou de ser verdade.** A migração de sala (0.14.0) elege sucessor, transfere PIN/bans/chat e reanuncia por beacon. O item devia sair da tabela, como B3 saiu. Na troca, apareceu a superfície do achado 4: o beacon de migração não é autenticado e o endereço não é validado. |
| **G4** (`findFreeServer` deixa servidores pendurados) | "feito na 0.1.x" | **Feito.** `src/main/ports.js` tem 100% de cobertura de linha e branch. |
| **G6** (teto de ~4 pessoas) | "confirmado, por desenho" | **Continua verdade e continua por desenho.** Nada no código mudou o fanout 1/2 nem a profundidade 2 (`tree.js`). |
| **C5** (branches obsoletas) | aberto | **Fora do meu escopo de leitura** — não consultei o remoto. Sem opinião. |
| **B1** (Electron 32 → 44) | Fora de escopo | **Continua fora, e ganhou um argumento a mais**: o achado 3 (`will-navigate`) é o tipo de endurecimento que convém fazer **junto** com a subida de versão, já que os dois exigem verificação manual com o app rodando. Agrupar economiza uma rodada de teste manual. |

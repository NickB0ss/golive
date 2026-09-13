# Notificação nativa "ao vivo" + janela "Espiar" sempre no topo — design

Data: 2026-09-12. Escopo do time **espiar** (itens 2 e 3 do brief comum).

Cenário de uso guia as duas decisões: a pessoa está jogando, com o GoLive
atrás do jogo (janela ou tela cheia sem borda).

## 1. Notificação nativa "Fulano ficou ao vivo"

### Gatilho

`app.js`, `case 'broadcast-state'` (~linha 2454), no ramo em que `!wasLive`
já dispara `sound.playLiveSound()`. É o único lugar que já sabe, ao mesmo
tempo: quem (`peer.name`, `peer.avatar`), que a transição é
parou→ao vivo (não um `broadcast-state` repetido nem o estado inicial de
quem acabou de entrar), e que é TELA — câmera passa por `case 'camera-state'`,
um case totalmente separado que nunca chama `playLiveSound`. **Decisão:
câmera não notifica.** Ligar a câmera é um evento bem mais frequente e menos
"peça pra acontecer no jogo" do que começar a compartilhar tela; notificar
os dois multiplicaria o ruído pela metade dos casos sem ganho equivalente.

### Quando a janela "não está em foco/visível"

`sound.js` (`playChatSound`) já usa `document.hasFocus()` como sinal de
"o app está em segundo plano" — é o mesmo Chromium, a mesma noção de foco
de janela, e cobre os três casos do brief numa linha só: minimizada, oculta
e **atrás do jogo sem estar minimizada** (foco do SO foi para outra janela).
Reaproveitamos o mesmo sinal em vez de inventar um caminho novo por IPC
(`window:visibility-changed` cobre minimizar/ocultar, mas não perda de foco
sem minimizar — `document.hasFocus()` cobre os três com uma chamada síncrona
no processo certo, o renderer, que é quem decide se notifica).

### Anti-spam (módulo puro novo)

`src/renderer/livenotify.js` (IIFE, `GoLive.livenotify`, testado com
`node --test`):

```
createTracker() -> { lastNotifiedAt: Map<peerId, ms> }
shouldNotify(tracker, peerId, { enabled, appFocused, joinedAtMs, nowMs,
                                  graceMs = 5000, cooldownMs = 30000 }) -> bool
markNotified(tracker, peerId, nowMs)
```

Regras, todas puras e testáveis sem DOM:

- `enabled` falso (interruptor de Configurações) → nunca notifica.
- `appFocused` verdadeiro → nunca notifica (a pessoa já está olhando).
- **Silêncio de entrada:** `nowMs - joinedAtMs < graceMs` (5 s) → não
  notifica. `app.js` grava `joinedAtMs = Date.now()` no `case 'welcome'`.
  Cobre "nada ao entrar numa sala onde já tem gente ao vivo": os
  `broadcast-state` de quem já estava ao vivo chegam a cada peer logo depois
  do `welcome`, dentro da janela de silêncio. **Descartado:** esperar um
  sinal explícito de "sincronização terminou" — não existe hoje um evento
  assim no protocolo, e inventar um só para isto acopla o anti-spam a um
  detalhe frágil da sinalização. Um resumo agregado ("3 pessoas já estão ao
  vivo") também foi descartado: a barra de foto/nome de quem já está ao vivo
  já aparece nos tiles assim que a sala renderiza — um segundo aviso não
  soma informação.
- **Cooldown por pessoa:** `nowMs - lastNotifiedAt(peerId) < cooldownMs`
  (30 s) → não notifica. Cobre reconexão rápida, pausa/retomada (que não
  passa por aqui — pausa não muda `live`) e troca rápida de estado. O
  cooldown é por `peerId` (o id de conexão), não por nome: uma reconexão
  troca de id, então o cooldown por si só não cobriria isso — mas o
  `graceMs` do PRÓPRIO reconectante (ele também passa pelo `welcome` outra
  vez) cobre o caso em que é a PESSOA NOTIFICADA que reconectou. O caso
  restante — o transmissor reconecta e o `id` dele muda, então o cooldown
  "esqueceu" dele — é aceito como limitação conhecida (ver Fora de escopo):
  medir por nome exigiria confiar em nome como identidade, que a sala não
  trata como estável (duas pessoas podem usar o mesmo nome).

### Onde mostrar: `new Notification()` no renderer, não IPC pro main

Decisão e porquê:

- O Electron expõe `Notification` no renderer mapeando direto pra
  `node_modules/electron`/toast nativo do Windows — não precisa do main
  pra CRIAR a notificação.
- Toda a informação (peer, foco, anti-spam) já mora no renderer; mandar
  isso pro main por IPC só pra criar o toast e depois voltar o clique por
  IPC de novo é uma volta sem necessidade.
- O que o main PRECISA prover é o `app.setAppUserModelId` (ver abaixo) e um
  jeito de **focar a janela principal a partir de um clique que pode chegar
  com a janela minimizada** — isso já não existe hoje (só
  minimize/toggle-maximize/close) e vira um novo par IPC pequeno,
  `window:show` (`preload.js`: `win.show()`), espelhando exatamente o
  padrão dos três que já existem em `main.js`.

`app.setAppUserModelId('com.golive.lan')` **não existe hoje** (conferido:
nenhuma ocorrência no repo). É pré-requisito pro toast do Windows agrupar
corretamente sob o nome/ícone do app em vez de cair como genérico
"Electron". Entra em `main.js`, antes de `app.whenReady()` (o mais cedo
possível, mesmo padrão do `requestSingleInstanceLock` no topo do arquivo),
com o mesmo valor do `build.appId` do `package.json` (`com.golive.lan`).

### Conteúdo e clique

```js
new Notification(`${peer.name || 'Alguém'} ficou ao vivo`, {
  icon: peer.avatar || undefined, // data URL quando há foto; omitido gera o ícone padrão do SO
  silent: true, // o app já tem tom próprio (playLiveSound); o "ding" nativo dobraria o aviso
});
```

`silent: true` é deliberado: a sala já tem um som pensado pra "alguém foi
ao vivo" (`sound.playLiveSound`, que continua tocando igual, com foco ou
sem). Deixar o Windows tocar o dele também seria dois avisos sonoros pro
mesmo evento.

Clique (`notification.onclick`): `window.golive.win.show()` (foca e
restaura a janela principal) + o mesmo caminho que o botão "Assistir" do
tile já usa (`onWatchIntent(id, 'only')` — reaproveita a mesma lógica, ver
Plano Tarefa 1) + `scrollIntoView` no tile. "Assistir" só dispara de fato
se a tela ainda estiver ao vivo — se a pessoa parou de compartilhar entre a
notificação e o clique, o tile já não existe e a chamada é no-op silenciosa
(mesmo comportamento de clicar num tile que acabou de sumir).

### Interruptor em Configurações

Aba **Voz e Vídeo**, logo abaixo do grupo "Sons" existente (mesmo padrão
visual: `check-group` > `check` > `check-title`/`check-desc`), chave nova
`cfg.liveNotifyEnabled` (default `true`) em `config.js`, mesmo tratamento
de `soundsEnabled` (`DEFAULTS`, `load()`, callback `onLiveNotifyChange`
espelhando `onSoundsChange`). Fica junto de Sons porque é a mesma classe de
decisão ("como a sala me avisa quando não estou olhando"), não uma aba
nova — não há aba "Geral"/"Notificações" hoje e criar uma para um único
interruptor era exagero.

### Fora de escopo (feature 2)

- **Permissão do SO para notificações.** O Electron/Windows normalmente não
  pede permissão explícita para apps nativos (diferente de site web); não
  tratamos o caso de o usuário ter desligado notificações do app nas
  configurações do Windows — o toast simplesmente não aparece, sem erro
  visível para nós (a API não avisa). Documentado no roteiro de teste
  manual.
- **Cooldown por pessoa que sobrevive a uma reconexão do transmissor**
  (troca de `peerId`) — ver acima.
- **Notificação de câmera** — decisão, não esquecimento (ver Gatilho).
- **Agrupar notificações** quando várias pessoas ficam ao vivo quase juntas
  — cada uma dispara a sua; o cooldown por pessoa evita repetição da MESMA
  pessoa, não uma rajada de pessoas diferentes (cenário raro numa sala de
  até ~4).

## 2. Janela "Espiar" sempre no topo

### Ponto de partida: três famílias de solução, avaliadas

O `MediaStream` do peer vive no processo renderer da janela principal
(`tileRegistry.get(id).stream` em `ui.js`). Qualquer solução tem que levar
ESSE objeto — não uma cópia recodificada — até uma superfície sempre-no-topo,
sem inventar um segundo encoder/decoder.

**A — Document Picture-in-Picture (`documentPictureInPicture.requestWindow`).**
Descartada apesar de existir: o spike real em Electron 32.3.3 / Chromium 128
devolveu `typeof window.documentPictureInPicture === 'object'`. A janela
aberta pelo app continua sendo a escolha porque permite controlar moldura,
geometria persistida, arrasto, redimensionamento e nível always-on-top; PiP
deixa essas decisões com o navegador/SO.

**B — PiP nativo de vídeo (`video.requestPictureInPicture()`).** Existe em
Electron (é `//content`+`//media`, não `//chrome`) e dá sempre-no-topo de
graça, com dois botões nativos já embutidos pelo Chromium quando a mídia
tem áudio: play/pause, um "voltar pra aba" (que em Electron foca a
`BrowserWindow` de origem — o que cobriria "voltar pro app") e um "x"
(fecha o PiP). **Descartada mesmo assim:** a UI é do Chromium, não dá pra
estilizar — sem como aplicar os tokens do app (`--live`, `aria-label`
custom), sem "sem blur" ser sequer uma escolha nossa, e o brief pede
"controles mínimos... tokens no `:root`... aria-label" — que pressupõe HTML
nosso. PiP nativo também não lembra posição/tamanho entre sessões de forma
controlável pelo app (o SO decide).

**C — `window.open()` de mesma origem + `setAlwaysOnTop` via main.**
Escolhida. Único caminho que dá controle total de UI (HTML/CSS nosso,
tokens, aria-label, hover) E entrega o `MediaStream` real sem recodificar:
quando o popup é de mesma origem, o Chromium mantém o documento filho no
MESMO processo de renderer do `window.open` original (não é uma
`BrowserWindow`/processo separado até o Electron intervir), então o opener
consegue fazer `spyWin.document.querySelector('video').srcObject = stream`
como atribuição de objeto direto — sem serialização, sem `postMessage`,
sem transferir nada (que seria impossível: `MediaStream`/`MediaStreamTrack`
não estão na lista de Transferable do `postMessage`, e não sobrevivem a
`structuredClone`). **Ação:** o spike confirma que isso vale igual dentro
do Electron com páginas `file://` (a preocupação real: se o Electron tratar
cada documento `file://` como origem opaca própria, o acesso direto ao
`document` do filho falha e a solução cai).

O ganho de controle de janela (sempre-no-topo, sem moldura, redimensionável,
arrastável, memória de posição) vem de **interceptar** esse `window.open`
no main via `webContents.setWindowOpenHandler` — que HOJE NÃO EXISTE no
`main.js` (confirmado: nenhuma ocorrência) — devolvendo
`{ action: 'allow', overrideBrowserWindowOptions: {...} }` com
`frame:false, alwaysOnTop:true, resizable:true, movable:true`. Isto também
fecha uma lacuna que a auditoria de 07/09 apontou (P1, "faltam restrições
explícitas de... novas janelas"): qualquer `window.open` que NÃO seja o
marcador da janela de espiar cai no `else` e é negado
(`{ action: 'deny' }`) — hoje não havia handler nenhum, então (por padrão
do Electron) um `window.open` qualquer abriria uma `BrowserWindow` sem
restrição nenhuma. Não existe hoje nenhum outro `window.open` no app, então
negar por padrão não quebra nada existente.

### Spike (gate antes de implementar)

Rodado pelo Codex (`gpt-5.6-terra`, `high`) num script isolado ANTES da
implementação de verdade, dentro do próprio worktree, usando o Electron já
instalado (`node_modules` é junção da `main`, não precisa `npm install`):

1. Uma janela principal mínima (`BrowserWindow` comum) carrega uma página
   com um `<video>` alimentado por `canvas.captureStream()` (não precisa de
   permissão de captura de tela pra testar o mecanismo).
2. Um `webContents.setWindowOpenHandler` que devolve
   `overrideBrowserWindowOptions: { frame:false, alwaysOnTop:true,
   resizable:true, movable:true, width:320, height:200 }` para
   `window.open('spike-child.html', 'golive-espiar-spike')`.
3. No opener, depois do `open()`: espera o filho carregar e tenta
   `child.document.getElementById('v').srcObject = stream` — sucesso é o
   vídeo aparecer tocando na janela filha SEM re-negociar nada.
4. Confere `typeof window.documentPictureInPicture` (resultado real:
   `'object'`; a opção A segue descartada pelos controles de janela) e
   `child.frameElement`/
   `BrowserWindow.getAllWindows().length` confirma se virou uma segunda
   `BrowserWindow` (esperado) mantendo acesso síncrono ao `document`.
5. Reporta em texto simples: os três resultados, qualquer stack trace, e se
   `alwaysOnTop`/`frame:false`/resize funcionaram visualmente (Electron
   consegue rodar com janela real neste ambiente — não headless).

Se o passo 3 falhar (origem opaca, `document` inacessível), a alternativa
documentada aqui é cair pra opção B (PiP nativo) com UI mínima, avisando no
relatório final que a versão com controles customizados não foi possível
nesta rodada — mas dado o padrão confirmado por outros apps Electron reais
que fazem exatamente isto (popup de mesma origem com acesso direto ao
`document`), a expectativa é a opção C funcionar.

### `main.js`: janela da espiã

```js
function openSpyChildWindow(details) {
  // details.frameName === 'golive-espiar' é o marcador; qualquer outro
  // window.open (nenhum existe hoje) é negado.
}
```

- `webContents.setWindowOpenHandler` registrado em `createWindow()`, junto
  dos outros listeners de `win`.
- Geometria: lida de um arquivo pequeno em
  `path.join(app.getPath('userData'), 'espiar-janela.json')`
  (`{ x, y, width, height }`), escrito (debounce ~400 ms) nos eventos
  `move`/`resize` da `BrowserWindow` filha. Módulo novo puro
  `src/main/spywin.js` (mesmo padrão de `src/main/overlay.js`: sem
  `require('electron')`, testável com `node --test`) com
  `clampBounds(bounds, displays, fallback)` — garante que a janela não
  reabra fora de qualquer monitor conectado (ex: notebook desplugado do
  dock) — e `parseStoredBounds(json)` (parse defensivo, nunca lança).
  Persistência em si (leitura/escrita do arquivo) fica em `main.js`, que
  não é testável por `node --test` (já é a convenção do resto do arquivo).
- **Uma janela por vez**: se já existe uma espiã aberta e o usuário pede
  "Espiar" noutro tile, a mesma janela troca o `MediaStream` e o título. A
  geometria não muda; trocar de quem está espiando não pede reposicionar de
  novo.
- `ipcMain.on('window:show', ...)`: foca/restaura a janela principal (usado
  pelo clique na notificação E pelo botão "voltar" da janela de espiar).

### Preload dedicado da janela filha

`src/espiar-preload.js` (novo arquivo, ao lado de `src/preload.js`, não
dentro de `renderer/`): a janela de espiar não precisa de 95% do que
`window.golive` expõe (captura de áudio, hospedar sala, atualização...) —
expor a API inteira a uma janelinha de vídeo é superfície de ataque sem
motivo. Expõe só:

```js
contextBridge.exposeInMainWorld('golive', {
  back: () => ipcRenderer.send('window:show'),
});
```

Fechar é `window.close()` nativo (não precisa de IPC: é uma `BrowserWindow`
de verdade, `window.close()` do documento filho fecha ela).

### `src/renderer/espiar.html` (novo)

Documento mínimo, sem framework, com seu próprio `<style>` inline (não
mexe em `style.css`, que é arquivo disputado — esta página nunca é
carregada dentro da janela principal):

- `<video id="v" autoplay playsinline muted></video>` — sempre mudo (ver
  Áudio, abaixo) ocupando 100% da janela, `object-fit: contain`.
- Barra de controles (`.spy-bar`), `opacity:0` por padrão,
  `opacity:1` no `:hover`/`:focus-within` do `body` — mesmo padrão de
  "aparece só com o mouse por perto" que o resto do app usa nos botões de
  tile (nunca `backdrop-filter`: fundo sólido semi-opaco, `--s1` com
  alpha).
- Dois botões: **voltar** (`window.golive.back()`) e **fechar**
  (`window.close()`), `aria-label` nos dois (só ícone).
- Um `<p id="estado">` escondido por padrão, mostrado quando a transmissão
  pausa (ver abaixo) ou quando a pessoa sai — texto claro
  ("Transmissão pausada" / "A pessoa saiu — fechando"), sem
  `backdrop-filter`, mesma paleta escura fixa do app (não segue tema
  custom: é uma janela utilitária de vida curta, tema não é o problema que
  resolve — ver Fora de escopo).
- Tokens de cor copiados (valores, não `@import` de `style.css`) do preset
  padrão do app: `--bg:#0e1116`, `--tx:#e8eaed`, `--live:#ff4d4f`. Usados
  só no texto de estado (`--live` quando a transmissão para/pausa, textão
  do brief: "`--live` só para 'ao vivo'" — aqui o vermelho não é "ao vivo",
  é o aviso, então na real usamos `--warn`/`--danger`, não `--live`, pra
  não violar a regra do token).

### `ui.js`: ciclo de vida (sem módulo novo — mesmo precedente do PiP de fullscreen)

Estado module-level, ao lado de `pinnedPip`/`fullscreenTileId` (mesmo
arquivo, mesma seção — é o mesmo tipo de estado: "o que está fora do fluxo
normal de tile agora"):

```js
let spyTileId = null;   // id do tile espiado agora, ou null
let spyWin = null;      // referencia da Window (window.open), ou null
```

- **Abrir** (chamado por `openTileMenu`, botão "Espiar"): se `spyWin` já
  existe, fecha primeiro (`spyWin.close()` — o listener de `unload`/`pagehide`
  cuida da limpeza de estado, o mesmo caminho de fechar manualmente). Abre
  `window.open('espiar.html', 'golive-espiar')`; quando carrega
  (`spyWin.addEventListener('load', ...)`), atribui `srcObject` a partir de
  `tileRegistry.get(id).stream` e roda `spyWin.document.title = entry.displayName`.
  Guarda `spyTileId = id`.
- **Fechar pelo X da janela / Alt+F4 / botão fechar:** o próprio documento
  filho, no `pagehide`, chama uma função exposta pelo opener
  (`window.opener.GoLive.__espiarClosed?.(id)` — mesmo truque de acesso
  direto de mesma origem, não precisa de IPC) que zera `spyTileId`/`spyWin`
  no lado do opener. **Decisão:** usar acesso direto em vez de `postMessage`
  porque já estamos comprometidos com mesma-origem/mesmo-processo para o
  `srcObject` funcionar — inventar `postMessage` só para o sinal de
  fechamento seria dois mecanismos para a mesma premissa.
- **`removeTile(id)`** (peer saiu / parou tela): se `id === spyTileId`,
  fecha a janela de espiar (`spyWin?.close()`). Decisão do brief: "fecha ou
  mostra estado claro" — **fecha**, não deixa a janela viva mostrando o
  último quadro congelado sem contexto por cima do jogo (uma janela
  sempre-no-topo travada seria pior que ela sumir).
- **`setPaused(tileId, paused, opts)`**: se `tileId === spyTileId`, chama
  `spyWin.__setPaused?.(paused, opts)` (função exposta pelo documento
  filho) pra mostrar o mesmo aviso de pausa que o tile principal mostra —
  sem isso a janela de espiar ficaria com o vídeo congelado sem dizer por
  quê (o `<video>` recebe a MESMA track que para de produzir quadros
  durante a pausa).
- **Menu do tile (`openTileMenu`)**: botão "Espiar" só aparece quando a
  tela/câmera está sendo assistida (`watched` — mesma variável que já
  decide o item "Parar de assistir"). Não faz sentido oferecer espiar algo
  que ainda não se está nem vendo no tile principal — o cartão de opt-in
  (`tile-gate`, "Assistir") já é o primeiro passo natural.

### Áudio: sempre mudo na janela de espiar

**Decisão, não simplificação preguiçosa:** o `<video>` de cada tile remoto
já é `muted = true` HOJE (`showTile`, linha ~601) — o áudio de verdade
passa por um grafo de Web Audio separado (`ensureTileAudio`,
`MediaStreamSource -> GainNode -> destination`) que continua rodando
enquanto a janela principal existe, independente de fullscreen ou de
espiar. Se a janela de espiar tocasse o MESMO `MediaStream` com áudio
ligado, o som sairia DUAS vezes (uma vez pelo grafo da janela principal,
outra pelo elemento `<video>` da janela filha) — o mesmo tipo de bug de eco
que a captura por processo já teve que evitar do lado de quem transmite.
Silenciar de propósito e documentar aqui evita reabrir essa classe de bug
do lado de quem assiste. **Fora de escopo, por causa disso:** o "mudo/volume
se barato" do brief não entra — não é barato (exigiria desligar o
`GainNode` da janela principal enquanto a espiã está aberta e religar ao
fechar, acoplando dois sistemas de áudio por um ganho pequeno: quem quer
ouvir já ouve pela janela principal, atrás do jogo, sem precisar que o som
saia da janelinha).

### Persistência de posição/tamanho

Só em `main.js`/`spywin.js` (arquivo JSON em `userData`), não em
`cfg`/`localStorage` do renderer — é estado de janela do SO, não preferência
de conta/perfil, e `config.js` não é hoje o lugar de nada parecido (a
janela principal em si também não persiste tamanho). Sobrevive a fechar e
reabrir o app (arquivo em disco); começa com um padrão razoável
(320×200, canto inferior direito do display principal) na primeira vez.

### Jogo em fullscreen exclusivo

Documentado, não corrigido (não há correção possível do lado do app):
fullscreen EXCLUSIVO (a maioria dos jogos DirectX mais antigos, ou quem
liga a opção explicitamente) toma o monitor inteiro no nível do driver de
vídeo, abaixo do compositor do Windows (DWM) — nenhuma janela
`alwaysOnTop`, de nenhum processo, aparece por cima, o mesmo motivo por que
o overlay de rabisco já documenta essa limitação
(`docs/superpowers/specs/2026-09-05-rabisco-na-tela-real-design.md`).
**Funciona** em fullscreen "sem borda" (borderless windowed, o padrão hoje
na maioria dos jogos e o que o próprio overlay de rabisco já assume que
funciona) e em janela normal — que é o caso comum. Vai pro roteiro de teste
manual como uma checagem explícita, não uma promessa.

### Fora de escopo (feature 3)

- Redimensionar/travar proporção (16:9) — puramente livre, como qualquer
  janela; sem trava de aspecto.
- Mudo/volume na janela de espiar — ver Áudio acima.
- Múltiplas janelas de espiar ao mesmo tempo — decidido "uma é suficiente"
  pelo brief.
- Espiar sobreviver a fechar e reabrir o app (reabrir automaticamente
  espiando quem quer que estivesse antes) — a pessoa decide de novo cada
  sessão; só a GEOMETRIA (posição/tamanho) sobrevive.
- Tema customizado dentro da janela de espiar — só os tokens fixos do
  preset padrão (ver `espiar.html` acima).
- Botão dedicado no tile "ao lado de tela cheia" (o brief oferece isso como
  opção "e/ou"): só o item do menu de botão direito foi feito. Motivo:
  `showTile`, em `ui.js`, monta o HTML do tile inteiro numa string
  (`tile.innerHTML = ...`) que É um dos trechos mais disputados do arquivo
  mais disputado do repo — acrescentar um botão ali é o tipo de mudança que
  colide fácil com o que os outros times estão fazendo no mesmo tile
  (avatares, badges, watchers). O menu de botão direito já é o padrão
  documentado no brief comum ("botão direito do tile = aquela tela") e
  cobre o caso sem tocar no template.

## Testes

Puros, com `node --test`:

- `src/renderer/livenotify.test.js` — `shouldNotify`/`markNotified`:
  desligado não notifica, focado não notifica, dentro do `graceMs` não
  notifica, dentro do `cooldownMs` por peer não notifica, fora das três
  janelas notifica, `markNotified` reinicia o cooldown daquele peer (e só
  daquele).
- `src/main/spywin.test.js` — `clampBounds`: dentro de um display não
  mexe, fora de todos os displays cai no fallback, parcialmente fora é
  empurrada pra dentro do display mais próximo; `parseStoredBounds`: JSON
  válido passa, JSON inválido/campos faltando/tipos errados devolve `null`
  sem lançar.

Sem framework de teste de renderer no projeto (mesma situação dos specs
anteriores de UI) — o resto (toast aparecendo, clique focando/assistindo,
janela sempre no topo, arrastar/redimensionar, fechar ao parar de
transmitir, pausa refletida) é só verificável rodando o app de verdade.
Roteiro no relatório final.

# Tela de carregamento na abertura, com atualização automática — design

Data: 2026-09-12

## Contexto

Pedido do usuário (literal): "uma tela de carregamento no início, assim como
no Discord, para checar atualizações; se tiver, ele atualiza automaticamente,
sem nem perguntar para o usuário se quer atualizar, e depois ele libera o
aplicativo". E: "Fora da sala, teria um botão de atualização com uma cor
chamativa indicando que tem atualização, daí ele pode atualizar pelo botão,
ou na próxima vez que abrir o aplicativo".

Hoje (`src/main/updater.js`, `src/renderer/app.js`) a checagem roda no boot
mas é 100% passiva: `autoDownload = false`, nada baixa sozinho, e o único
sinal é um `#update-banner` discreto com um botão "Reiniciar e instalar" —
que quase ninguém nota, porque a janela principal já abriu e a atenção da
pessoa está em criar/entrar numa sala.

## Decisões

1. **Janela de carregamento separada, criada ANTES da janela principal**
   (abordagem já escolhida pelo usuário/coordenador — não reaberta aqui). A
   alternativa (checar dentro da janela principal, atrasando `createWindow`)
   foi descartada: ela exigiria desenhar um estado de "carregando" dentro do
   `index.html` de 2000+ linhas de CSS disputadas por outros times, e a
   janela principal só pode aparecer pronta (requisito 4) — nascer invisível
   e mostrar depois é mais frágil que nunca chegar a nascer.
2. **Isto substitui a decisão de 2026-08-26 (PR #14)** — registrada em
   `docs/superpowers/specs/2026-08-26-atualizacao-com-botao-e-busca-manual-design.md` —
   de "nada é instalado sem o usuário mandar". O motivo daquela decisão era
   que o fluxo *anterior* a ela (`autoDownload = true` +
   `autoInstallOnAppQuit = true`) baixava em segredo com o app já em uso e
   instalava ao fechar sem a pessoa nunca ver nada acontecer — uma cirurgia
   silenciosa no meio do uso. O fluxo novo é o oposto nisso que importava: a
   instalação automática só acontece **antes de existir janela alguma**, com
   uma tela dedicada mostrando "baixando"/"instalando" na cara da pessoa.
   Ninguém perde uma sessão em andamento, ninguém vê o app fechar sozinho no
   meio de algo. O *resultado* (instala sem perguntar) é o que o usuário
   pediu agora, então a razão da reversão antiga (instalação invisível,
   inesperada, no meio do uso) não se aplica mais.
3. **`autoDownload` continua `false`.** Em vez de deixar o `electron-updater`
   decidir quando baixar, a máquina de estados nova (`src/main/boot.js`)
   chama `downloadUpdate()` explicitamente ao ver `'available'`. Isso mantém
   `updater.js` testável do jeito que já é (o teste que verifica
   `autoDownload === false` continua válido e não muda) e centraliza a
   decisão de "quando baixar" num módulo com timeout, em vez de depender do
   comportameto interno do electron-updater.
4. **`autoInstallOnAppQuit` continua `false`.** A instalação nunca é "ao
   fechar o app por qualquer motivo" — é sempre um `quitAndInstall()`
   explícito, disparado (a) pelo boot quando o download termina, ou (b) pelo
   clique em "Atualizar"/"Reiniciar e instalar" com o app já aberto. Mesmo
   raciocínio do item 3: menos comportamento implícito do electron-updater,
   mais decisão explícita e testável no código do projeto.
5. **`quitAndInstall(true, true)`** (silencioso + força reabrir) em vez de
   `quitAndInstall()` sem argumentos. `nsis.oneClick: true` já torna a
   instalação silenciosa por padrão, mas `isForceRunAfter` é o que garante
   reabrir mesmo se a preferência do instalador estivesse diferente — sem
   isso um "atualiza sozinho" que não reabre é pior que não ter mexido: a
   pessoa acha que o app crashou. Mudança de uma linha em `updater.js`,
   sem mudar `autoDownload`/`autoInstallOnAppQuit`.
6. **Timeout de checagem (~5s) e timeout de download travado (~30s sem
   progresso novo) liberam o app em vez de prender a pessoa numa tela de
   carregamento infinita.** Rede lenta ou GitHub fora do ar não podem virar
   "o GoLive não abre". Em ambos os casos o app libera normalmente e, se já
   se sabia de uma versão disponível antes do timeout, o botão "Atualizar"
   do lobby continua aceso — a pessoa não perde a informação, só não trava
   esperando por ela.
7. **Sem piso de exibição em build empacotado; ~0,6s em dev.** Em produção a
   tela some assim que o resultado chega (rápido, honesto, ao estilo
   Discord). Em `npm start` (sem instalador, checagem sempre cai no stub
   "não há atualização" quase instantâneo) um piso de exibição evita um
   flash de tela que ninguém consegue ler — só existe pra não atrapalhar
   quem está desenvolvendo, não é comportamento de produção.
8. **A checagem periódica em segundo plano (60 min) nunca baixa nada.** Só
   acende o botão do lobby. Baixar automaticamente de novo, já com o app em
   uso, seria repetir exatamente o padrão que o PR #14 corrigiu (decisão 2).
   A única instalação sem clique é a da abertura, antes de existir janela.
9. **O botão "Atualizar" mora no `#lobby-view`, não em elemento novo
   controlado por JS de visibilidade.** `#lobby-view`/`#room-view` já se
   alternam via `.hidden` (ver `ui.js`); colocar o botão dentro da faixa do
   lobby faz "não aparece dentro da sala" ser verdade **de graça**, sem
   nenhuma lógica nova de "está numa sala? esconde". Reaparecer ao sair da
   sala é a mesma troca de view que já existe.
10. **`#update-banner` perde o botão "Reiniciar e instalar" e o estado
    "disponível".** Essa função passa para o botão novo do topbar — ter dois
    lugares pedindo pra clicar em "atualizar" (banner flutuante E botão do
    header) seria redundante e o banner, por ficar no canto inferior
    direito, é fácil de não notar (motivo original de pedir isto agora). O
    banner continua existindo só para os estados que têm progresso real pra
    mostrar: baixando (barra) e instalando (indeterminada) — tanto quando
    disparado pelo botão do topbar quanto pela busca manual
    (`#btn-check-update`).
11. **Janela de carregamento com preload mínimo e `contextIsolation: true`**,
    mesmo padrão de segurança da janela principal e do overlay de rabisco —
    nenhuma superfície nova de risco. A página só recebe eventos
    (`boot:phase`); não chama nada de volta.

## Fluxo

### Build empacotado (`app.isPackaged`)

```
app.whenReady
  -> cria a janela de carregamento (oculta até 'ready-to-show', sem flash)
  -> bootController.start()
       onPhase('checking')                -> splash: "Procurando atualizações…"
       driver.checkForUpdates(false)
         5s sem resposta                  -> release('timeout-checagem')
         'not-available' / 'error'        -> release(reason)
         'available'                      -> onPhase('downloading', {version, progress:0})
                                              driver.downloadUpdate()
           'downloading' (progress)       -> onPhase('downloading', {version, progress})
             30s sem progresso novo       -> release('download-travado')
           'downloaded'                   -> onPhase('installing', {version})
                                              driver.quitAndInstall(true, true)
                                              (processo fecha; nada mais roda)
  -> phase 'release' (qualquer um dos releases acima)
       fecha a janela de carregamento
       cria a janela principal (só agora ela existe)
       liga a descoberta UDP
       registra o atalho global Ctrl+Alt+P
       se uma versão nova tinha sido vista antes do timeout/erro, manda um
         'available' sintético pra janela principal assim que ela carrega
         (o botão do lobby já nasce aceso)
       liga a checagem periódica de 60 em 60 min (sem baixar)
```

### Dev (`npm start`, não empacotado)

`setupAutoUpdater` sem `deps.autoUpdater` injetado cai no stub existente:
`checkForUpdates` emite `'not-available'` na hora. O boot aplica o piso de
~0,6s (decisão 7) e libera — a tela aparece por um instante e some, nada é
baixado.

### Com o app já aberto

- Timer de 60 min chama `updater.checkForUpdates(false)` (não-manual, não
  baixa). Se vier `'available'`, o botão "Atualizar" do lobby acende.
- Clique no botão "Atualizar": chama `downloadUpdate()`, banner mostra
  progresso, e ao terminar `quitAndInstall(true, true)` fecha/reabre — igual
  ao caminho do boot, só que disparado por um clique em vez de automático.
- `#btn-check-update` (busca manual) continua igual: `checkForUpdates(true)`.
  Se vier `'available'`, acende o mesmo botão "Atualizar" e mostra um toast
  avisando a versão (em vez do banner com ação, que saiu — decisão 10).
  `'not-available'`/`'error'` continuam só toast, como hoje.
- Dentro de uma sala (`#room-view` visível), o botão não aparece porque mora
  no `#lobby-view` (decisão 9). Sair da sala mostra o `#lobby-view` de novo,
  e o botão volta se ainda houver atualização pendente.

## 1. `src/main/boot.js` (módulo puro novo)

Máquina de estados da abertura. Sem Electron, sem `require` de timer direto
— tudo injetável, pro teste rodar sem esperar segundo nenhum.

```js
createBootUpdater({
  driver,        // { checkForUpdates(manual), downloadUpdate(), quitAndInstall() }
                 // -- exatamente o objeto que setupAutoUpdater() devolve
  onPhase,       // (phase, extra) => void
                 // phase: 'checking' | 'downloading' | 'installing' | 'release'
                 // extra: {version?, progress?, reason?}
  scheduler,     // { setTimeout, clearTimeout } -- default: os globais
  now,           // () => ms -- default: Date.now
  checkTimeoutMs,   // default 5000
  stallTimeoutMs,   // default 30000
  minDisplayMs,     // default 0 -- main.js passa ~600 fora de app.isPackaged
}) -> { start, handleStatus }
```

- `start()`: emite `onPhase('checking', {})`, arma o timeout de checagem e
  chama `driver.checkForUpdates(false)`.
- `handleStatus(payload)`: mesmo shape que `setupAutoUpdater` já emite
  (`{status, version?, progress?, reason?, message?}`). Depois que a `phase`
  final (`'release'`) foi decidida, ignora qualquer evento posterior (a
  janela principal, quando existir, é quem trata os próximos).
- `release(reason)` respeita `minDisplayMs`: se o resultado chegou antes do
  piso, agenda a liberação pro tempo que falta; nunca atrasa
  `'downloading'`/`'installing'`, que já têm progresso real pra mostrar.
- `'downloaded'` nunca chama `onPhase('release', …)` — o processo vai
  fechar sozinho pelo `quitAndInstall`, então criar a janela principal
  não faz sentido nesse caminho (requisito 2 do brief).

Teste `src/main/boot.test.js`, `node --test`, com um `driver` falso
(espiões) e um `scheduler` falso (`Map` de timers pendentes + `now`
controlado manualmente por `advance(ms)`), cobrindo: libera na hora sem
atualização; piso de exibição em dev; timeout de checagem; `available`
dispara download; download travado por 30s sem progresso libera; progresso
novo reseta o timer de travamento; `downloaded` aciona instalação e NUNCA
libera; erro carrega o motivo; nada acontece depois de liberado (idempotência).

## 2. `src/main/updater.js` (ajuste mínimo)

Única mudança: `quitAndInstall: () => autoUpdater.quitAndInstall(true, true)`
(decisão 5). `autoDownload`/`autoInstallOnAppQuit` continuam `false` —
nenhum teste existente que os verifica muda. Comentário de cabeçalho ganha
uma frase citando esta spec pro "nada é instalado sem o usuário mandar" não
parecer contradito sem explicação.

## 3. `src/splash/` (janela nova)

- `splash.html` — CSP própria (`default-src 'none'; script-src 'self';
  style-src 'self'`), sem imagem externa nem rede. Marca do app copiada do
  `app-brand-mark` de `index.html` (mesmo SVG inline — não há mecanismo de
  include em HTML puro; comentário no arquivo aponta a origem pra não
  divergir sem querer se a marca mudar).
- `splash.css` — paleta mínima copiada dos tokens de `style.css`
  (`--bg`, `--tx`, `--act`, `--live`, `--line`) só pra não puxar a folha de
  2000+ linhas numa janela de 300×360. Comentário de cabeçalho explica a
  duplicação. Respeita `prefers-reduced-motion`: sem a barra indeterminada
  deslizando, e a animação de pulso do texto vira estática.
- `splash.js` — recebe `{phase, version, progress, reason}` via
  `window.goliveBoot.onPhase`, escreve o texto em português (só aqui existe
  texto de UI — `src/main/` nunca teve, e continua não tendo) e a barra:
  - `checking` → "Procurando atualizações…" (barra indeterminada)
  - `downloading` → `Baixando atualização — NN%` (barra determinada)
  - `installing` → "Instalando…" (barra indeterminada)
  - `release` → "Abrindo…" (a janela fecha em seguida; texto só evita um
    último frame em branco)
- `preload-splash.js` — só `onPhase`, no mesmo padrão minimalista do
  `preload-overlay.js` (nenhuma função de volta pro main).

Janela: 300×360, `frame: false`, `resizable: false`, `center: true`,
`show: false` até `'ready-to-show'` (sem flash), `backgroundColor` igual ao
fundo de `splash.css` (zero flash de cor entre a janela nua e a página
carregada), ícone reaproveitado de `src/renderer/assets/icon.ico`.

## 4. `src/main.js` (mudança localizada)

- `second-instance`: se a janela principal ainda não existe, foca a de
  carregamento em vez de não fazer nada.
- `createSplashWindow()` / `sendSplashPhase(phase, extra)` — funções novas,
  mesmo estilo de `createOverlayWindow`/`sendToOverlay`.
- `releaseApp()` — o que `app.whenReady().then()` fazia direto hoje
  (`createWindow()`, `ensureDiscoveryStarted()`, registro do atalho global)
  vira esta função, chamada só quando `onPhase` recebe `'release'`. Ganha o
  encaminhamento do `'available'` visto durante o boot (se houver) pra
  janela principal assim que ela carrega, e liga o `setInterval` de 60 min
  da checagem periódica.
- `dispatchUpdateStatus(payload)` — substitui o corpo inline que hoje só
  loga e manda pro `win`; agora também loga, repassa pro `bootController`
  (que ignora sozinho se já liberou) e guarda a última versão vista
  `'available'` pra decisão acima.
- `app.whenReady().then()`: em vez de `createWindow()` direto, cria a janela
  de carregamento e só então `bootController.start()`. Se a janela de
  carregamento falhar ao carregar (erro raríssimo), `releaseApp()` roda
  direto — nunca deixar o app preso atrás de uma tela que não teve como
  abrir.
- `will-quit`: limpa o timer de checagem periódica junto do resto.

Nenhuma mudança de `package.json`, `nsis` ou versão do protocolo de
sinalização.

## 5. `src/renderer/index.html` / `style.css` / `app.js` (lobby)

- **`index.html`**: novo botão no `.lobby-topbar-inner`, ao lado de
  `#btn-check-update`:
  ```html
  <button id="btn-update-available" class="primary small update-available-btn hidden"
          type="button" title="Atualização disponível — clique para atualizar agora">
    <span class="update-dot" aria-hidden="true"></span>Atualizar
  </button>
  ```
  `#update-banner-action` ("Reiniciar e instalar") sai do banner (decisão
  10); o banner (`#update-banner-text` + `#update-progress`) fica só com
  texto e barra.
- **`style.css`**: bloco novo no fim do arquivo, cabeçalho "abertura com
  atualização automática". `.update-available-btn` reaproveita `.primary` +
  `.small` (cor `--act`, nunca `--live` — regra do vault); `.update-dot` é
  um círculo pequeno com leve pulso (`--live`? não — é aviso de ação
  disponível, não "ao vivo": usa `--warn`, que já é o token pra "algo
  precisa de atenção"). Pulso desligado sob `prefers-reduced-motion`
  (bloco global já existente no topo do arquivo cobre isso, ou uma regra
  local se o seletor não bater — verificar ao implementar).
- **`app.js`**: estado local `updateAvailableVersion` (`string | null`).
  `onUpdateStatus`: `'available'` guarda a versão e mostra
  `#btn-update-available` (em vez de abrir o banner); se `manual`, toast
  extra avisando a versão. Clique no botão novo: esconde o botão, mostra o
  banner com progresso e chama `downloadUpdate()` — igual ao que o botão do
  banner fazia antes. `'downloading'`/`'downloaded'`/`'not-available'`/
  `'error'` continuam quase iguais, só sem a referência ao
  `update-banner-action` removido.

Nenhuma mudança de protocolo de sinalização, nenhum campo novo em nenhuma
mensagem — isto é só a UI do processo principal e do lobby.

## Fora de escopo

Herdado do brief: assinatura de código, canal de release, rollback,
changelog no app. Também fora: mudar `nsis`/`package.json` (o coordenador
cuida da versão), qualquer coisa em `server/signaling-core.js` (não há
mensagem de sinalização nova aqui), e revisar a trava de versão de sala em
si (`version.js`) — só o texto que já existe continua apontando pro botão
de atualizar do topo, sem mudança de comportamento.

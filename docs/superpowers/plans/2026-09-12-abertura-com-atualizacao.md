# Abertura com atualização automática — plano de implementação

Spec: `docs/superpowers/specs/2026-09-12-abertura-com-atualizacao-design.md`.

## Regras globais (do brief comum, valem para todas as tarefas)

Comentário de código em português sem acentos; texto visível na UI com
acentos. Testes com `node --test` ao lado do módulo. Módulo novo do renderer
usa o IIFE padrão + tag `<script>` antes de `app.js`. `app.js` não ganha
teste — lógica nova testável fica em módulo puro. Nenhuma dependência nova.
Mudança mínima e localizada nos arquivos disputados
(`src/main.js`, `src/renderer/app.js`, `src/renderer/index.html`,
`src/renderer/style.css`); nada de reformatar/renomear/mover código
existente. Não mexer em `package.json`/`STATUS.md`/`README.md`.

## Tarefa 1 — `src/main/boot.js` + teste

- [ ] Criar `src/main/boot.js` com `createBootUpdater({ driver, onPhase,
      scheduler, now, checkTimeoutMs, stallTimeoutMs, minDisplayMs })`
      devolvendo `{ start, handleStatus }`, conforme a seção 1 da spec.
- [ ] Criar `src/main/boot.test.js` cobrindo (driver falso com espiões,
      scheduler falso com `advance(ms)`, sem `Date.now`/timer reais):
  - libera na hora quando `minDisplayMs` é 0 e chega `not-available`;
  - respeita o piso de exibição (`minDisplayMs`) antes de liberar;
  - timeout de checagem libera sozinho sem resposta nenhuma;
  - `available` dispara `downloadUpdate()` e `onPhase('downloading', …)`;
  - download sem progresso novo por `stallTimeoutMs` libera com o motivo
    `'download-travado'`;
  - progresso novo reseta o timer de travamento (não libera antes da hora);
  - `downloaded` chama `quitAndInstall()`, emite `onPhase('installing', …)`
    e **nunca** chega a emitir `'release'`;
  - `error` libera carregando o `reason` (ou `'erro'` sem reason);
  - depois de liberado, `handleStatus` novo não chama `onPhase` de novo nem
    aciona `driver` de novo (idempotência).
- [ ] `node --test src/main/boot.test.js` passando isolado antes de seguir.

## Tarefa 2 — `src/main/updater.js` (ajuste de uma linha)

- [ ] `quitAndInstall: () => autoUpdater.quitAndInstall()` vira
      `autoUpdater.quitAndInstall(true, true)`.
- [ ] Comentário de cabeçalho do arquivo ganha uma frase citando a spec
      2026-09-12 pra explicar por que "nada instala sem o usuário mandar"
      mudou de sentido (decisão 2 da spec) sem reabrir a decisão de
      `autoDownload`/`autoInstallOnAppQuit` (que continuam `false`).
- [ ] Em `updater.test.js`, o teste `'downloadUpdate e quitAndInstall
      delegam pro autoUpdater'` (ou um novo, ao lado dele) passa a checar
      que `quitAndInstall` foi chamado com `(true, true)` — hoje só checa
      que `au.calls` contém `'quitAndInstall'`, sem olhar argumentos.
      **Único teste existente tocado**, e só porque o comportamento mudou
      de verdade (explicado acima) — nenhum outro teste de `updater.test.js`
      muda.
- [ ] `node --test src/main/updater.test.js` passando.

## Tarefa 3 — `src/splash/` (janela e página novas)

- [ ] `src/splash/splash.html`: CSP própria, marca do app (SVG copiado de
      `app-brand-mark`), frase de estado, barra de progresso. `<script
      src="splash.js">`.
- [ ] `src/splash/splash.css`: paleta mínima duplicada dos tokens de
      `style.css` (comentário explicando a duplicação e por quê). Sem
      `backdrop-filter`. Bloco `@media (prefers-reduced-motion: reduce)`
      cortando a barra indeterminada e qualquer pulso.
- [ ] `src/splash/splash.js`: `window.goliveBoot.onPhase(({phase, version,
      progress, reason}) => …)` — traduz phase pra texto em português (só
      aqui, main/ nunca tem texto de UI) e atualiza a barra. IIFE não é
      necessário aqui (script de página isolada, não módulo do `GoLive.*`).
- [ ] `src/splash/preload-splash.js`: só `contextBridge.exposeInMainWorld`
      com `onPhase`, `contextIsolation: true`, `nodeIntegration: false` —
      mesmo padrão de `preload-overlay.js`.

## Tarefa 4 — `src/main.js` (orquestração da abertura)

- [ ] `require('./main/boot')` (`createBootUpdater`).
- [ ] Variáveis de módulo novas: `splashWin`, `bootController`,
      `periodicUpdateTimer`, `sawUpdateAvailable`.
- [ ] `second-instance`: foca `win` se existir, senão `splashWin`.
- [ ] `createSplashWindow()` (300×360, `frame:false`, `resizable:false`,
      `center:true`, `show:false` → `show()` em `ready-to-show`,
      `backgroundColor` igual ao fundo de `splash.css`, ícone existente) e
      `sendSplashPhase(phase, extra)`.
- [ ] `dispatchUpdateStatus(payload)`: loga (igual hoje), atualiza
      `sawUpdateAvailable` em `'available'`/`'downloaded'`, repassa pro
      `bootController?.handleStatus`, e manda pro `win` se ele já existir
      (igual hoje).
- [ ] `releaseApp()`: fecha `splashWin`; chama `createWindow()`;
      `ensureDiscoveryStarted()`; se `sawUpdateAvailable`, manda um
      `'available'` sintético pro `win` no `did-finish-load`; registra o
      atalho global (código movido, sem mudar comportamento); liga
      `periodicUpdateTimer` (`setInterval` de 60 min chamando
      `updater?.checkForUpdates(false)`).
- [ ] `app.whenReady().then()`: troca a chamada direta de `createWindow()` +
      `ensureDiscoveryStarted()` + registro do atalho pela sequência:
      `updater = setupAutoUpdater(dispatchUpdateStatus)` →
      `createSplashWindow().then(() => { bootController =
      createBootUpdater({ driver: updater, onPhase: (phase, extra) => {
      sendSplashPhase(phase, extra); if (phase === 'release') releaseApp();
      }, minDisplayMs: app.isPackaged ? 0 : 600 }); bootController.start();
      }).catch(() => releaseApp())`.
- [ ] `will-quit`: soma `if (periodicUpdateTimer) clearInterval(...)` à
      limpeza existente.
- [ ] Nenhuma outra linha de `app.whenReady` (GPU logging, powerMonitor,
      `setDisplayMediaRequestHandler`, IPC handlers) muda de lugar nem de
      comportamento.

## Tarefa 5 — Lobby: botão "Atualizar" e banner só-progresso

- [ ] `index.html`: adiciona `#btn-update-available` (hidden por padrão) no
      `.lobby-topbar-inner`, perto de `#btn-check-update`. Remove
      `#update-banner-action` do `#update-banner`.
- [ ] `style.css`: bloco novo no fim do arquivo (cabeçalho "abertura com
      atualização automática — botão de atualizar do lobby"). Botão usa
      `--act` (via `.primary`); ponto de aviso usa `--warn` (nunca `--live`
      — regra do vault). Pulso do ponto desligado sob
      `prefers-reduced-motion`.
- [ ] `app.js`: estado `updateAvailableVersion`; `onUpdateStatus` mostra o
      botão em `'available'` em vez do banner-com-ação; toast extra quando
      `manual`; clique no botão esconde-se, mostra o banner (progresso) e
      chama `downloadUpdate()`; remove a referência ao
      `update-banner-action` removido; mantém `'downloading'` /
      `'downloaded'` / `'not-available'` / `'error'` como hoje (só texto e
      fiação, sem função nova).
- [ ] Confirma visualmente/por leitura de código que o botão só existe
      dentro de `#lobby-view` (nenhuma lógica JS de "esconder dentro da
      sala" precisa ser escrita — `.hidden` do `#lobby-view`/`#room-view`
      já cobre).

## Tarefa 6 — Validação

- [ ] `npm test` inteiro, ler a contagem final (base: 581 passando).
- [ ] `npm run lint` inteiro, ler erros/avisos (base: 0 erros, 9 avisos).
- [ ] `git diff` dos arquivos disputados tocados — confirmar que as mudanças
      são mínimas e localizadas, nada reformatado.
- [ ] Escrever o relatório final (formato do brief comum): o que foi feito,
      arquivos tocados (disputados destacados), números de teste/lint,
      roteiro de teste manual (checagem real de update precisa de duas
      releases publicadas — não dá pra automatizar; roteiro do
      `npm start` dá pra rodar agora), riscos e limitações.

## Fora deste plano

Assinatura de código, canal de release, rollback, changelog no app, mudar
`server/signaling-core.js`, mudar `version.js`, mudar `package.json`/nsis.

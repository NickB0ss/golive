# Notificação "ao vivo" + janela "Espiar" — plano de implementação

Spec: `docs/superpowers/specs/2026-09-12-notificacao-e-espiar-design.md`
(leia primeiro — as decisões e o porquê de cada uma estão lá, aqui só a
sequência de execução).

**Branch:** `feat/notificacao-e-espiar`, worktree isolado. **Base:** `main`
`d356223`. Não commitar (o coordenador integra pelos diffs).

## Regras (do brief comum, valem pra toda tarefa)

1. Comentário de código em português SEM acentos; texto visível na UI COM
   acentos.
2. Teste com `node --test`, arquivo ao lado do módulo (`x.js` → `x.test.js`).
3. Módulo novo em `src/renderer/`: IIFE
   `(function (root) { ... root.GoLive.<nome> = api; if (typeof module !== 'undefined') module.exports = api; })(typeof window !== 'undefined' ? window : global);`
   + tag `<script>` em `index.html` ANTES de `app.js`.
4. Módulo novo em `src/main/`: `module.exports = {...}` direto (sem IIFE,
   sem `window.GoLive`) — mesmo padrão de `src/main/overlay.js`. NUNCA
   `require('electron')` num módulo que precisa ser testável por
   `node --test`.
5. `app.js` e `ui.js` não ganham teste novo (DOM/WebRTC/Electron puro, sem
   harness) — lógica testável fica nos módulos novos.
6. Zero dependência nova (nem dev). `node_modules` é junção da `main` —
   não rodar `npm install`.
7. Não tocar `package.json`, `STATUS.md`, `README.md`, `.github/`.
8. Mudança mínima e localizada nos arquivos disputados
   (`app.js`, `ui.js`, `index.html`, `style.css`, `main.js`, `preload.js`,
   `server/signaling-core.js`) — nada de reformatar/renomear/mover código
   existente. Bloco novo de CSS no fim de `style.css`, com comentário de
   cabeçalho "espiar"/"notificação".
9. `npm test` inteiro tem que passar (base: 581 passando). `npm run lint`
   sem novo erro (base: 0 erros, 9 avisos pré-existentes de
   `require-atomic-updates`).

## Tarefa 0 — Spike (gate antes de implementar)

**Só depois deste resultado é que a Tarefa 3 (janela de espiar) começa.**
A Tarefa 1 (notificação) não depende do spike e pode rodar em paralelo/antes.

Script isolado, FORA de `src/` (ex: `scratchpad`/pasta temporária do
Codex, nunca commitado, apagar ao final), usando o Electron já instalado
em `node_modules` (junção da `main` — não precisa instalar nada):

1. Uma `BrowserWindow` comum carrega uma página local com
   `<video>` + `canvas.captureStream()` (sem precisar de permissão de
   captura de tela real).
2. `webContents.setWindowOpenHandler` devolvendo
   `{ action: 'allow', overrideBrowserWindowOptions: { frame:false,
   alwaysOnTop:true, resizable:true, movable:true, width:320, height:200 } }`
   quando `details.frameName === 'golive-espiar-spike'`.
3. No opener: `const child = window.open('child.html', 'golive-espiar-spike')`,
   espera carregar, tenta
   `child.document.getElementById('v').srcObject = stream` e confere se o
   vídeo aparece tocando na janela filha.
4. Confere `typeof window.documentPictureInPicture` (resultado do spike:
   `'object'`; ainda descartado porque não dá o controle de janela exigido).
5. Confere visualmente: janela sem moldura, sempre no topo (sobrepõe outra
   janela do SO), redimensionável, arrastável.

**Critério de pronto:** um arquivo de texto com os 3 resultados
(srcObject funcionou sim/não + stack trace se falhou, valor de
`documentPictureInPicture`, always-on-top/frame/resize funcionaram
sim/não) entregue ANTES de tocar em `src/`.

- **Se o passo 3 funcionar:** segue pra Tarefa 3 como especificado.
- **Se falhar:** para, não improvisa — volta pra revisão (ver spec, seção
  "Opção B" como alternativa registrada) antes de escrever qualquer linha
  de `ui.js`/`main.js` pra isso.

Codex `gpt-5.6-terra`, `model_reasoning_effort=high`.

## Tarefa 1 — Notificação: módulo puro + wiring

`gpt-5.6-terra`, `medium`. Pode rodar independente da Tarefa 0.

1. `src/renderer/livenotify.js` (novo) — `createTracker`, `shouldNotify`,
   `markNotified` conforme a spec. `src/renderer/livenotify.test.js` com
   os casos listados na spec (seção Testes).
2. Tag `<script src="livenotify.js"></script>` em `index.html`, antes de
   `app.js` (depois de `sound.js`, por proximidade de assunto — não é
   obrigatório, só organização).
3. `config.js`: `DEFAULTS.liveNotifyEnabled = true`; em `load()`,
   `liveNotifyEnabled: typeof parsed.liveNotifyEnabled === 'boolean' ? parsed.liveNotifyEnabled : DEFAULTS.liveNotifyEnabled`.
   Mesmo padrão exato de `soundsEnabled` logo acima/abaixo no arquivo.
4. `main.js`:
   - `app.setAppUserModelId('com.golive.lan')` o mais cedo possível (antes
     de `app.whenReady()`; junto do bloco de `commandLine.appendSwitch` no
     topo do arquivo é um bom lugar — mesma vizinhança de "coisas que têm
     que rodar cedo").
   - `ipcMain.on('window:show', () => { if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); })`
     — mesmo padrão dos handlers de `window:minimize`/`window:toggle-maximize`/`window:close`
     já existentes em `createWindow()`.
5. `preload.js`: `win.show: () => ipcRenderer.send('window:show')` dentro
   do objeto `win` existente (ao lado de `minimize`/`toggleMaximize`/`close`).
6. `app.js`:
   - `case 'welcome'`: gravar `joinedAtMs = Date.now()` (variável de sessão,
     mesmo escopo de `myId`/`ownerId` — reinicia a cada `welcome`, inclusive
     em reconexão, de propósito: a spec já cobre o motivo).
   - Um `notifyTracker = livenotify.createTracker()` por sessão (reseta ao
     trocar de sala — mesmo ciclo de vida de `watchedScreens`/`autoWatchSuppressed`).
   - `case 'broadcast-state'`, no ramo `if (!wasLive) { sound.playLiveSound(); ... }`:
     chamar uma função nova `maybeNotifyLive(peer, msg.id)` (local a
     `app.js`) que: monta `shouldNotify(...)` com
     `enabled: cfg.liveNotifyEnabled`, `appFocused: document.hasFocus()`,
     `joinedAtMs`, `nowMs: Date.now()`; se `true`, chama `markNotified` e
     cria a `Notification` (conteúdo e `onclick` conforme a spec —
     `window.golive.win.show()` + reusar a lógica de "assistir" da tela).
   - **Extrair a lógica de `ui.grid.onWatchIntent` numa função nomeada**
     (`function applyWatchIntent(tileId, mode) { ... }` com o MESMO corpo
     que hoje está inline em `ui.grid.onWatchIntent((tileId, mode) => {...})`,
     ~linha 3425) e registrar `ui.grid.onWatchIntent(applyWatchIntent)`. O
     clique da notificação chama `applyWatchIntent(msg.id, 'only')`
     diretamente — sem essa extração não há como reusar a mesma regra
     (auto-escolha, `autoWatchSuppressed`, etc.) sem duplicar código.
     Mudança mecânica (só embrulha o corpo existente numa função nomeada,
     comportamento idêntico) — não é refatoração de escopo maior.
7. `ui.js`: no `settingsPanes.voice.innerHTML`, logo depois do bloco
   `<h3>Sons</h3>` existente, novo bloco:
   ```html
   <h3>Notificações</h3>
   <div class="check-group">
     <label class="check">
       <input id="settings-live-notify" type="checkbox" />
       <span class="check-box">...</span>
       <span class="check-text">
         <span class="check-title">Avisar quando alguém ficar ao vivo</span>
         <span class="check-desc">Notificação do Windows quando a janela do GoLive não está em foco.</span>
       </span>
     </label>
   </div>
   ```
   (copiar o SVG do `check-mark` já usado em `settings-sounds`, não
   reinventar). `$('settings-live-notify').checked = config.liveNotifyEnabled;`
   junto de `$('settings-sounds').checked = ...`; listener `change` chamando
   `deps.onLiveNotifyChange(...)`, espelhando o de `settings-sounds`.
8. `app.js`: no objeto passado pra `ui.settings.render`/`openSettings` (o
   mesmo que já tem `onSoundsChange`), adicionar
   `onLiveNotifyChange: (enabled) => { cfg = { ...cfg, liveNotifyEnabled: enabled }; persist(); }`.

**Critério de pronto:** `livenotify.test.js` passando; `npm test`/`npm run
lint` inteiros sem regressão; diff de `app.js`/`ui.js`/`main.js`/`preload.js`
localizado nos pontos acima, nada mais tocado nesses arquivos.

## Tarefa 2 — Revisão da Tarefa 1

Eu (Claude) reviso o diff (`git diff` no worktree), rodo `npm test` e
`npm run lint`, confiro que os arquivos disputados só mudaram nos pontos
do plano. Ajusto o que for preciso antes de seguir pra Tarefa 3.

## Tarefa 3 — Janela de espiar (só depois do resultado da Tarefa 0)

`gpt-5.6-terra`, `medium`.

1. `src/main/spywin.js` (novo, sem `require('electron')`) —
   `clampBounds(bounds, displays, fallback)`, `parseStoredBounds(json)`
   conforme a spec. `src/main/spywin.test.js` com os casos da spec.
2. `src/espiar-preload.js` (novo, fora de `renderer/`, ao lado de
   `src/preload.js`) — só `back()`, conforme a spec. Sem teste (é preload
   puro Electron, mesmo padrão de `src/preload.js`, que também não tem
   teste).
3. `src/renderer/espiar.html` (novo) — shell da janela filha conforme a
   spec: `<video>` mudo, barra de controles no hover, texto de estado,
   `<style>` inline com os tokens fixos listados na spec. Expõe no `window`
   do documento filho (não `contextBridge`, é a própria página, sem
   `nodeIntegration`): uma função que o opener chama pra setar
   `srcObject`/pausa/título, e chama `window.opener.GoLive.__espiarClosed?.(id)`
   no `pagehide`.
4. `main.js`:
   - `webContents.setWindowOpenHandler` em `createWindow()`, junto dos
     outros listeners de `win`: reconhece `details.frameName === 'golive-espiar'`,
     lê bounds persistidos via `spywin.parseStoredBounds` +
     `spywin.clampBounds` (contra `screen.getAllDisplays()`), devolve
     `overrideBrowserWindowOptions` com `frame:false, alwaysOnTop:true,
     resizable:true, movable:true, minimizable:false, maximizable:false,
     backgroundColor:'#0e1116', webPreferences: { preload:
     path.join(__dirname, 'espiar-preload.js'), contextIsolation:true,
     nodeIntegration:false }`. Qualquer outro `window.open`:
     `{ action: 'deny' }`.
   - Rastrear a `BrowserWindow` filha criada (evento `did-create-window` do
     `webContents`, ou o retorno do handler conforme a versão do Electron —
     confirmar qual API o Electron 32 oferece) pra ligar `move`/`resize`
     (debounce ~400 ms) escrevendo bounds em
     `path.join(app.getPath('userData'), 'espiar-janela.json')`.
5. `ui.js` (junto de `pinnedPip`/`fullscreenTileId`, mesma seção de
   estado): `spyTileId`, `spyWin`, funções `openSpyWindow(id)`/fechamento
   conforme a spec. Ganchos em `removeTile` e `setPaused` (condicionados a
   `id === spyTileId`).
6. `ui.js`, `openTileMenu`: novo botão "Espiar" (`data-` novo, mesmo
   padrão do botão de watch) condicionado a `watched` (mesma variável que
   já decide "Parar de assistir"), chamando `openSpyWindow(id)`.
7. `style.css`: SE precisar de alguma classe no menu do tile pro item
   "Espiar" (ex: ícone), bloco novo no FIM do arquivo com comentário de
   cabeçalho "espiar" — `espiar.html` tem seu próprio `<style>` inline e
   não entra aqui.

**Critério de pronto:** `spywin.test.js` passando; `npm test`/`npm run
lint` inteiros sem regressão; diff dos arquivos disputados localizado nos
pontos acima.

## Tarefa 4 — Revisão da Tarefa 3 + validação final

Eu (Claude) reviso o diff inteiro (`git diff` no worktree, arquivos novos
inclusive), rodo `npm test` e `npm run lint` uma última vez com tudo junto,
confiro a lista de arquivos tocados contra este plano, e escrevo o
relatório final do brief comum (o que foi feito, números de teste/lint, o
que precisa de teste manual com roteiro, riscos, o que ficou de fora, e que
não há mudança de protocolo de sinalização — nem a notificação nem a
espiã trocam mensagem nova com `server/signaling-core.js`).

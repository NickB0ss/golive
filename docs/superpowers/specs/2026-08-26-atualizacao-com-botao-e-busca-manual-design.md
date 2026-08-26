# Atualização com botão e busca manual — design

Data: 2026-08-26

## Contexto

O GoLive LAN se atualiza via GitHub Releases com `electron-updater`
([updater.js](../../../src/main/updater.js)). Hoje o fluxo é 100% passivo:
`autoDownload = true` baixa o pacote em segundo plano assim que o app abre e
encontra versão nova, e `autoInstallOnAppQuit = true` aplica a instalação
sozinha quando o app fecha. O renderer só mostra um aviso discreto no
`#update-banner` ([app.js:326](../../../src/renderer/app.js)). Não há como
buscar atualização sem reabrir o app.

O dono do app não gosta desse comportamento. Ele quer:

1. Ao abrir e existir atualização: um botão **"Reiniciar e instalar
   atualização"**. Nada é baixado antes do clique.
2. Ao clicar: barra de progresso do download e, ao terminar, instala e
   **reinicia sozinho** no app atualizado.
3. Um botão para **buscar atualizações** dentro do app, com ícone, ao lado
   do nome "GoLive LAN".
4. Busca manual sem resultado / erro: **toast** no canto.

## Decisões

- `autoDownload = false` e `autoInstallOnAppQuit = false`. Nenhuma
  instalação silenciosa; tudo passa pelo botão.
- O check automático no start **continua** — só não baixa. Ele é o que
  popula o estado `available` que faz o banner aparecer.
- Instalação = `autoUpdater.quitAndInstall()`. No Windows/NSIS `oneClick`
  isso fecha o app, roda o instalador em silêncio e reabre — que é
  exatamente "reinicia sozinho no app atualizado".

## 1. Núcleo do updater (`src/main/updater.js`)

`setupAutoUpdater(onStatus, deps = {})` — `deps.autoUpdater` injetável pra
teste, no mesmo padrão do `deps.dgram` do
[discovery.js](../../../src/main/discovery.js). Sem `deps`, usa o
`require('electron-updater').autoUpdater` real (import tardio, como hoje).

Config: `autoDownload = false`, `autoInstallOnAppQuit = false`.

Flag `manual`: `let lastCheckManual = false`. `checkForUpdates(manual)`
guarda `lastCheckManual = !!manual` e chama `autoUpdater.checkForUpdates()`.
Todo evento repassado para `onStatus` carrega `manual: lastCheckManual`
junto do `status`. O renderer usa isso pra decidir se mostra o toast de
"está em dia" (só quando `manual`).

Eventos repassados (shape `{ status, manual, ... }`), sem mudança de nome:

| evento electron-updater | status emitido | extra |
|---|---|---|
| `checking-for-update` | `checking` | — |
| `update-available` | `available` | `version` (de `info.version`) |
| `update-not-available` | `not-available` | — |
| `download-progress` | `downloading` | `progress` (0–100, `Math.round(p.percent)`) |
| `update-downloaded` | `downloaded` | `version` |
| `error` | `error` | `message` |

Objeto retornado:

```
{
  checkForUpdates: (manual) => { lastCheckManual = !!manual; autoUpdater.checkForUpdates().catch(() => {}); },
  downloadUpdate:  () => autoUpdater.downloadUpdate().catch(() => {}),
  quitAndInstall:  () => autoUpdater.quitAndInstall(),
}
```

Stub de dev (`!app.isPackaged`): mesma forma, mas `checkForUpdates(manual)`
emite um `onStatus({ status: 'not-available', manual })` sintético (pra o
botão dar feedback fora de build empacotado) e `downloadUpdate` /
`quitAndInstall` são no-op.

## 2. IPC (`src/main.js`)

`updater = setupAutoUpdater(cb)` onde `cb` repassa o payload inteiro pro
renderer via `win.webContents.send('update:status', payload)` (só adiciona o
log, como já faz). Startup: `updater.checkForUpdates(false)`.

Handlers novos:

- `ipcMain.handle('update:check', () => { updater.checkForUpdates(true); return true; })`
- `ipcMain.handle('update:download', () => { updater.downloadUpdate(); return true; })`
- `ipcMain.handle('update:install', () => { updater.quitAndInstall(); return true; })`

`quitAndInstall()` dispara o quit normal do app, então
`app.on('window-all-closed')` roda a limpeza que já existe
(`closeEmbeddedServer`, `discovery.stop`, parada das capturas).

## 3. Preload (`src/preload.js`)

```
checkForUpdates: () => ipcRenderer.invoke('update:check'),
downloadUpdate:  () => ipcRenderer.invoke('update:download'),
installUpdate:   () => ipcRenderer.invoke('update:install'),
```

`onUpdateStatus` fica como está.

## 4. Botão de busca no header (`index.html`, `style.css`)

Em `.app-brand`, depois de `.app-brand-name`:

```html
<button id="btn-check-update" class="icon-btn-inline" title="Buscar atualizações" type="button">
  <!-- mesmo SVG de seta-refresh circular do #btn-refresh-discovery, por consistência -->
</button>
```

CSS: `.app-brand` ganha `justify-content: space-between` (ou o botão ganha
`margin-left: auto`) pra empurrar o ícone à direita. Reaproveita
`.icon-btn-inline` e a animação `spin` (600ms) que o
`#btn-refresh-discovery` já usa.

## 5. Fluxo no renderer (`src/renderer/app.js`)

Substitui o handler passivo de `onUpdateStatus` por uma máquina de estados
que dirige `#update-banner` e o `#btn-check-update`.

Estado local: `let updateState = 'idle'` e `let updateVersion = null`.

`window.golive.onUpdateStatus(({ status, manual, version, progress, message }) => …)`:

| status | ação |
|---|---|
| `checking` | `#btn-check-update` ganha classe `spin`; banner escondido |
| `not-available` | tira `spin`; se `manual` → `showToast('Você já está na versão mais recente (' + versão atual + ').')` |
| `available` | guarda `updateVersion`; banner visível: texto `Atualização <version> disponível.` + botão **"Reiniciar e instalar"**; tira `spin` |
| `downloading` | banner: barra de progresso em `progress%` + `Baixando atualização… NN%`; botão do banner escondido |
| `downloaded` | banner: `Instalando atualização…` + barra indeterminada; chama `window.golive.installUpdate()` na hora |
| `error` | tira `spin`; se `manual` → `showToast('Não consegui verificar a atualização.')` |

Botão "Reiniciar e instalar" do banner → `window.golive.downloadUpdate()`
(o próximo evento `downloading` assume a UI).

Clique em `#btn-check-update` → adiciona `spin` na hora e chama
`window.golive.checkForUpdates()` (não espera o IPC; o evento `checking`
mantém o `spin`).

A versão atual pro toast vem de um IPC trivial já existente ou novo
`app:version` → `app.getVersion()` (o main já usa `app.getVersion()` no
log de boot). Se já não houver, adiciona `ipcMain.handle('app:version', () => app.getVersion())`
e `getVersion: () => ipcRenderer.invoke('app:version')` no preload.

### Bug latente corrigido junto

[app.js:692](../../../src/renderer/app.js) chama `renderUpdateBanner()`
dentro de `leaveRoom()`, mas essa função **nunca foi definida** — hoje
lança `ReferenceError` toda vez que alguém desconecta (depois que
`renderRoomList()` e `markCooldown()` já rodaram, então o efeito visível é
só um erro no console). Remove a chamada órfã. O banner passa a ser gerido
só pelo handler de update, sem relação com entrar/sair de sala.

## 6. Barra de progresso e toast (`index.html`, `style.css`)

Dentro de `#update-banner`, além do `#update-banner-text`:

```html
<button id="update-banner-action" class="primary small hidden" type="button">Reiniciar e instalar</button>
<div id="update-progress" class="update-progress hidden"><div id="update-progress-fill" class="update-progress-fill"></div></div>
```

`.update-progress`: trilho fino (4px), `border-radius`, `background: var(--surface-3)`,
`overflow: hidden`. `.update-progress-fill`: `height: 100%`, `background: var(--accent)`
(ou `--text-1`, seguindo a regra de "marca não é sinal" — usar cor neutra),
`width` setada via `style.width` em JS, `transition: width 120ms linear`.
Variante `.indeterminate` no fill: `@keyframes` de faixa deslizando, pro
passo `downloaded`.

Toast — elemento próprio, mesmo visual do banner:

```html
<div id="toast" class="toast hidden"><span id="toast-text"></span></div>
```

`.toast`: clona `.update-banner` (fixed, canto inferior direito,
`@starting-style` pra entrada). Pra não colidir com o banner quando os dois
aparecem, `.toast` fica em `bottom: 16px` e `#update-banner` sobe pra
`bottom: 72px` quando `#toast` está visível (classe `.toast-open` no
`body`), ou — mais simples — como `available` mostra banner e nunca toast ao
mesmo tempo, aceitar a sobreposição rara e deixar ambos em `bottom: 16px`.
**Decisão:** ambos em `bottom: 16px`; o toast tem `z-index` maior. Casos em
que coexistem (ex.: erro de download com banner ainda visível) são de
segundos e o toast some sozinho.

`showToast(msg, ms = 4000)` em `app.js`: seta o texto, tira `hidden`, e
depois de `ms` recoloca. Um `setTimeout` guardado em variável pra reiniciar
se chamado de novo.

## Testes

`updater.js` ganha `src/main/updater.test.js` com um `autoUpdater` falso
(EventEmitter + espiões):

- `autoDownload` e `autoInstallOnAppQuit` são setados como `false`.
- `checkForUpdates(true)` seguido de emitir `update-not-available` →
  `onStatus` recebe `{ status: 'not-available', manual: true }`.
- `checkForUpdates(false)` → o mesmo evento chega com `manual: false`.
- `download-progress` com `{ percent: 42.6 }` → `{ status: 'downloading', progress: 43 }`.
- `update-available` com `{ version: '9.9.9' }` → `{ status: 'available', version: '9.9.9' }`.
- `downloadUpdate()` e `quitAndInstall()` delegam pro `autoUpdater`.

Como `setupAutoUpdater` hoje faz `if (!app.isPackaged) return stub`, o teste
injeta `deps.autoUpdater` e força o caminho "real" independente de
`app.isPackaged` (o guard passa a ser: usa stub só quando `!app.isPackaged`
**e** não há `deps.autoUpdater`).

QA manual (precisa de duas releases de verdade, não dá pra automatizar):

1. Build 0.1.6 instalado, publica 0.1.7. Abre o app → banner "Atualização
   0.1.7 disponível" + botão. Nada baixado (checar logs/rede).
2. Clica → barra de progresso anda → app fecha, instala, reabre em 0.1.7.
3. Já em 0.1.7, clica no ícone do header → spin → toast "Você já está na
   versão mais recente (0.1.7)".
4. Desconecta de uma sala → sem `ReferenceError` no console.
5. Sem rede → clica no ícone → toast de erro.

## Fora de escopo

- Mudar o canal de release, assinatura de código, ou o `latest.yml`.
- Histórico/changelog dentro do app.
- Rollback de versão.

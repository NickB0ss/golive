# Controles de janela próprios (estilo Discord) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a barra de título nativa do Windows por uma faixa própria no topo do app, no estilo do Discord, com botões de minimizar, maximizar/restaurar e fechar.

**Architecture:** No Windows, a `BrowserWindow` usa `titleBarStyle: 'hidden'` e um novo namespace IPC (`window:minimize` / `window:toggle-maximize` / `window:close` + evento `window:maximize-changed`). O renderer ganha uma faixa `#titlebar` fixa de 32px (arrasto via `-webkit-app-region`), ligada por um módulo novo `titlebar.js` no padrão IIFE do projeto. macOS/Linux ficam com a barra nativa e a faixa some.

**Tech Stack:** Electron (`BrowserWindow`, `ipcMain`/`ipcRenderer`, `contextBridge`), CSS custom properties do tema do app, `node --test` com `document` falso injetado.

## Global Constraints

- **Só Windows.** Tudo que muda comportamento de janela é condicional a `process.platform === 'win32'` (main) / `win.platform !== 'win32'` (renderer). macOS/Linux: barra nativa, `#titlebar` continua `hidden`.
- Vale igual para `npm start` e para o app empacotado.
- Não tocar em `overlay.html` / janela de rabisco nem na janela de diagnóstico de GPU.
- Módulos do renderer seguem o padrão IIFE: `(function(root){ ... root.GoLive.X = api; if (typeof module !== 'undefined') module.exports = api; })(typeof window !== 'undefined' ? window : global)`. Sem ESM.
- Testes rodam sob `node --test` (script `npm test`). Não há jsdom — `document` entra por injeção, como em `src/renderer/screenrelay.test.js`.
- Fonte da verdade do design: `docs/superpowers/specs/2026-09-07-controles-de-janela-estilo-discord-design.md`.

---

### Task 1: IPC de janela no processo principal

**Files:**
- Modify: `src/main.js` — dentro de `createWindow()` (a partir de `src/main.js:214`) e a seção de `ipcMain.handle(...)` já existente (perto de `src/main.js:653`).

**Interfaces:**
- Consumes: nada (primeira task).
- Produces:
  - `BrowserWindow` criada com `titleBarStyle: 'hidden'` quando `process.platform === 'win32'`.
  - Canais `ipcMain.on`: `'window:minimize'`, `'window:toggle-maximize'`, `'window:close'`.
  - Evento enviado ao renderer: `win.webContents.send('window:maximize-changed', <boolean>)` em `maximize` e `unmaximize`.
  - F11 é bloqueado via `webContents.on('before-input-event')`.

- [ ] **Step 1: Adicionar `titleBarStyle` condicional na config da janela**

Em `createWindow()`, no objeto passado a `new BrowserWindow({...})` (`src/main.js:214`), acrescentar depois de `icon:`:

```js
    // Windows: sem barra de titulo nativa -- o app desenha a propria faixa
    // de controles (ver spec 2026-09-07). macOS/Linux ficam com a nativa.
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' } : {}),
```

- [ ] **Step 2: Registrar os handlers IPC e a sincronização do maximizado**

Logo depois de `win.setMenuBarVisibility(false);` (`src/main.js:237`), adicionar:

```js
  // Controles de janela proprios (Windows). fire-and-forget: nada a devolver.
  ipcMain.on('window:minimize', () => {
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('window:toggle-maximize', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => {
    if (win && !win.isDestroyed()) win.close();
  });
  const sendMaxState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:maximize-changed', win.isMaximized());
    }
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);
  // F11 nao alterna fullscreen nativo: o app tem o proprio (tile em tela
  // cheia, via win.setFullScreen no renderer).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') event.preventDefault();
  });
```

- [ ] **Step 3: Verificação manual rápida**

Run: `npm start`
Expected: o app abre **sem** a barra de título do Windows; a área do topo ainda não tem botões (vêm na Task 4), mas a janela abre, arrasta pela borda e redimensiona normalmente. Nenhum erro no console do processo principal.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "feat(janela): titleBarStyle hidden e IPC de controles no Windows"
```

---

### Task 2: Expor `window.golive.win` no preload

**Files:**
- Modify: `src/preload.js` — dentro do objeto passado a `contextBridge.exposeInMainWorld('golive', { ... })`.

**Interfaces:**
- Consumes: canais IPC da Task 1 (`window:minimize`, `window:toggle-maximize`, `window:close`, evento `window:maximize-changed`).
- Produces: `window.golive.win = { platform, minimize(), toggleMaximize(), close(), onMaximizeChange(cb) }`.
  - `platform`: string, `process.platform` (`'win32' | 'darwin' | 'linux'`).
  - `minimize()`, `toggleMaximize()`, `close()`: `void`, disparam `ipcRenderer.send`.
  - `onMaximizeChange(cb)`: registra `cb(isMaximized: boolean)`.

- [ ] **Step 1: Adicionar o namespace `win` ao bridge**

No fim do objeto `golive` em `src/preload.js` (depois de `sendAnnotOverlayLoad`), antes do `});` que fecha o `exposeInMainWorld`:

```js
  /** Controles da janela sem moldura (Windows). `platform` deixa o renderer
   * decidir se mostra a faixa propria ou deixa a barra nativa (macOS/Linux).
   * `onMaximizeChange` troca o icone do botao maximizar/restaurar. */
  win: {
    platform: process.platform,
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    onMaximizeChange: (callback) =>
      ipcRenderer.on('window:maximize-changed', (_event, isMax) => callback(isMax)),
  },
```

- [ ] **Step 2: Verificação manual**

Run: `npm start`, abrir o DevTools do renderer (Ctrl+Shift+I) e no console:
```js
window.golive.win
```
Expected: objeto com `platform: "win32"` e as quatro funções. `window.golive.win.minimize()` minimiza a janela.

- [ ] **Step 3: Commit**

```bash
git add src/preload.js
git commit -m "feat(janela): expor window.golive.win no preload"
```

---

### Task 3: Markup e estilo da faixa `#titlebar`

**Files:**
- Modify: `src/renderer/index.html` — primeiro filho de `<body>` (antes de `#update-banner`, ~linha 11) e a lista de `<script>` no fim do body (~`src/renderer/index.html:364-383`).
- Modify: `src/renderer/style.css` — nova seção; ajuste no `padding-top` do container do lobby/sala.

**Interfaces:**
- Consumes: nada em runtime (a lógica vem na Task 4).
- Produces:
  - Elemento `#titlebar.titlebar[hidden]` com filhos `#tb-min`, `#tb-max` (com dois `<svg>`: `.icon-maximize` e `.icon-restore`), `#tb-close`.
  - Classe de body `has-titlebar` (aplicada na Task 4) → `padding-top: 32px` no container raiz da UI.
  - `<script src="titlebar.js">` carregado antes de `app.js`.

- [ ] **Step 1: Inserir o markup da faixa**

Em `src/renderer/index.html`, imediatamente depois de `<body>` e antes de `<div id="update-banner" ...>`:

```html
<!-- Faixa de titulo propria (Windows, janela sem moldura). Fica hidden por
     padrao; titlebar.js remove o hidden so no win32. Ver spec 2026-09-07. -->
<div id="titlebar" class="titlebar" hidden>
  <div class="titlebar-brand">
    <svg class="titlebar-mark" viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M20.71 14.20 L11.35 9.06" />
        <path d="M20.71 17.80 L11.35 22.94" />
        <circle cx="8.5" cy="7.5" r="3.25" />
        <circle cx="8.5" cy="24.5" r="3.25" />
      </g>
      <circle cx="24" cy="16" r="3.75" fill="currentColor" />
    </svg>
    <span class="titlebar-name">GoLive LAN</span>
  </div>
  <div class="titlebar-drag"></div>
  <div class="titlebar-controls">
    <button id="tb-min" class="titlebar-btn" type="button" aria-label="Minimizar">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 H13" stroke="currentColor" stroke-width="1.2" /></svg>
    </button>
    <button id="tb-max" class="titlebar-btn" type="button" aria-label="Maximizar">
      <svg class="icon-maximize" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
      <svg class="icon-restore" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6 H10 V12 H4 Z M6 6 V4 H12 V10 H10" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
    </button>
    <button id="tb-close" class="titlebar-btn titlebar-btn-close" type="button" aria-label="Fechar">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.2" /></svg>
    </button>
  </div>
</div>
```

- [ ] **Step 2: Registrar o script**

Em `src/renderer/index.html`, na lista de `<script>` no fim do body, adicionar **antes** de `<script src="app.js"></script>`:

```html
<script src="titlebar.js"></script>
```

- [ ] **Step 3: Adicionar o CSS da faixa**

No fim de `src/renderer/style.css`:

```css
/* ============ Faixa de titulo propria (Windows) ============
   Janela sem moldura no win32: esta faixa e a area de arrasto + os tres
   botoes de janela. hidden por padrao (macOS/Linux e antes de titlebar.js
   rodar). Ver spec 2026-09-07. */
.titlebar {
  position: fixed;
  inset: 0 0 auto 0;
  height: 32px;
  z-index: 9999;
  display: flex;
  align-items: stretch;
  background: var(--s1);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
  user-select: none;
}
.titlebar-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 12px;
  color: var(--tx2);
  pointer-events: none;
}
.titlebar-mark { width: 16px; height: 16px; flex: none; }
.titlebar-name { font-size: 12px; font-weight: 550; }
.titlebar-drag { flex: 1; }
.titlebar-controls {
  display: flex;
  -webkit-app-region: no-drag;
}
.titlebar-btn {
  width: 46px;
  height: 100%;
  min-height: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--tx2);
  display: grid;
  place-items: center;
}
.titlebar-btn svg { width: 16px; height: 16px; }
.titlebar-btn:hover { background: var(--s3); color: var(--tx); }
.titlebar-btn:active { background: var(--s4); }
.titlebar-btn-close:hover { background: #e81123; color: #fff; }
.titlebar-btn-close:active { background: #f1707a; color: #fff; }
/* O botao maximizar mostra so um dos dois icones conforme o estado. */
.titlebar-btn .icon-restore { display: none; }
.titlebar-btn.is-maximized .icon-maximize { display: none; }
.titlebar-btn.is-maximized .icon-restore { display: block; }
/* Empurra o conteudo pra baixo da faixa (so quando ela existe). */
body.has-titlebar .lobby,
body.has-titlebar #room-view {
  padding-top: 32px;
}
/* Tile em tela cheia (win.setFullScreen): a faixa some. */
body:has(.tile.fullscreen) .titlebar { display: none; }
```

Nota: `#lobby-view` (`class="lobby"`) e `#room-view` (`class="room hidden"`) são irmãos, filhos diretos de `<body>` — confirmado em `src/renderer/index.html:27` e `:163`. Os seletores acima cobrem os dois.

- [ ] **Step 4: Verificação manual**

Run: `npm start`
Expected: ainda **sem** faixa visível (continua `hidden` até a Task 4). Nenhuma regressão visual no lobby nem quebra de layout. `npm test` continua passando (nada de renderer mudou em lógica).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css
git commit -m "feat(janela): markup e estilo da faixa de titulo propria"
```

---

### Task 4: Módulo `titlebar.js` + fio no bootstrap

**Files:**
- Create: `src/renderer/titlebar.js`
- Modify: `src/renderer/app.js` — no topo da IIFE, logo após o destructure de `window.GoLive` (`src/renderer/app.js:5`).

**Interfaces:**
- Consumes:
  - `window.golive.win` (Task 2): `{ platform, minimize(), toggleMaximize(), close(), onMaximizeChange(cb) }`.
  - Elementos do DOM da Task 3: `#titlebar`, `#tb-min`, `#tb-max`, `#tb-close`; `document.body`.
- Produces: `window.GoLive.titlebar = { init(win, doc) }`.
  - `init(win, doc)`: se `win.platform !== 'win32'`, no-op. Senão: `#titlebar.hidden = false`, `doc.body.classList.add('has-titlebar')`, liga os cliques dos 3 botões e assina `win.onMaximizeChange` (alterna `is-maximized` e `aria-label` do `#tb-max`).

- [ ] **Step 1: Escrever o teste que falha**

Create `src/renderer/titlebar.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('./titlebar');

function fakeEl() {
  const listeners = {};
  return {
    hidden: true,
    _attrs: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = v; },
    addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
    _fire(ev) { (listeners[ev] || []).forEach((fn) => fn()); },
  };
}

function fakeDoc() {
  const els = {
    titlebar: fakeEl(),
    'tb-min': fakeEl(),
    'tb-max': fakeEl(),
    'tb-close': fakeEl(),
  };
  return {
    els,
    body: fakeEl(),
    getElementById(id) { return els[id]; },
  };
}

function fakeWin(platform) {
  let maxCb = null;
  return {
    platform,
    calls: { minimize: 0, toggleMaximize: 0, close: 0 },
    minimize() { this.calls.minimize++; },
    toggleMaximize() { this.calls.toggleMaximize++; },
    close() { this.calls.close++; },
    onMaximizeChange(cb) { maxCb = cb; },
    _emitMax(v) { maxCb(v); },
  };
}

test('nao-win32: faixa continua escondida e sem listeners', () => {
  const doc = fakeDoc();
  const win = fakeWin('darwin');
  init(win, doc);
  assert.equal(doc.els.titlebar.hidden, true);
  assert.equal(doc.body.classList.contains('has-titlebar'), false);
  doc.els['tb-min']._fire('click');
  assert.equal(win.calls.minimize, 0);
});

test('win32: mostra a faixa e marca o body', () => {
  const doc = fakeDoc();
  init(fakeWin('win32'), doc);
  assert.equal(doc.els.titlebar.hidden, false);
  assert.equal(doc.body.classList.contains('has-titlebar'), true);
});

test('win32: cada botao chama o metodo certo', () => {
  const doc = fakeDoc();
  const win = fakeWin('win32');
  init(win, doc);
  doc.els['tb-min']._fire('click');
  doc.els['tb-max']._fire('click');
  doc.els['tb-close']._fire('click');
  assert.deepEqual(win.calls, { minimize: 1, toggleMaximize: 1, close: 1 });
});

test('win32: onMaximizeChange alterna classe e aria-label', () => {
  const doc = fakeDoc();
  const win = fakeWin('win32');
  init(win, doc);
  win._emitMax(true);
  assert.equal(doc.els['tb-max'].classList.contains('is-maximized'), true);
  assert.equal(doc.els['tb-max']._attrs['aria-label'], 'Restaurar');
  win._emitMax(false);
  assert.equal(doc.els['tb-max'].classList.contains('is-maximized'), false);
  assert.equal(doc.els['tb-max']._attrs['aria-label'], 'Maximizar');
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --test src/renderer/titlebar.test.js`
Expected: FAIL — `Cannot find module './titlebar'`.

- [ ] **Step 3: Escrever o módulo**

Create `src/renderer/titlebar.js`:

```js
'use strict';

// Liga a faixa de titulo propria (#titlebar) aos controles de janela do
// processo principal. So faz algo no Windows -- macOS/Linux ficam com a
// barra nativa e a faixa segue hidden. Modulo puro: nao toca em DOM fora
// de init(), e o document entra por injecao (sem jsdom no projeto).
// Ver spec docs/superpowers/specs/2026-09-07-controles-de-janela-estilo-discord-design.md
(function (root) {
  function init(win, doc) {
    if (!win || win.platform !== 'win32') return;

    doc.getElementById('titlebar').hidden = false;
    doc.body.classList.add('has-titlebar');

    doc.getElementById('tb-min').addEventListener('click', () => win.minimize());
    doc.getElementById('tb-max').addEventListener('click', () => win.toggleMaximize());
    doc.getElementById('tb-close').addEventListener('click', () => win.close());

    const maxBtn = doc.getElementById('tb-max');
    win.onMaximizeChange((isMax) => {
      maxBtn.classList.toggle('is-maximized', isMax);
      maxBtn.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
    });
  }

  const api = { init };
  root.GoLive = root.GoLive || {};
  root.GoLive.titlebar = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test src/renderer/titlebar.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Chamar `init` no bootstrap do renderer**

Em `src/renderer/app.js`, logo após a linha do destructure (`const { config, theme, ... } = window.GoLive;`, `src/renderer/app.js:5`):

```js
  // Faixa de titulo propria (Windows). Antes de qualquer render pra nao
  // haver salto de layout quando o padding-top entra.
  window.GoLive.titlebar.init(window.golive.win, document);
```

- [ ] **Step 6: Suite completa + verificação manual**

Run: `npm test`
Expected: PASS (incluindo os 4 novos).

Run: `npm start` e conferir o checklist:
- faixa de 32px no topo, marca à esquerda, 3 botões à direita;
- minimizar minimiza; fechar fecha;
- maximizar maximiza e o ícone vira "dois quadrados"; clicar de novo restaura e o ícone volta;
- duplo-clique na área vazia da faixa maximiza/restaura;
- arrastar pela faixa move a janela;
- F11 não faz nada;
- tema Papel (Configurações → aparência): a faixa fica clara, texto/ícones legíveis;
- entrar numa sala e pôr um tile em tela cheia: a faixa some; sair: volta.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/titlebar.js src/renderer/titlebar.test.js src/renderer/app.js
git commit -m "feat(janela): faixa de titulo propria estilo Discord no Windows"
```

---

## Self-Review

**1. Spec coverage:**
- `titleBarStyle: 'hidden'` só win32 → Task 1 Step 1. ✓
- IPC minimize/toggle-maximize/close → Task 1 Step 2. ✓
- `window:maximize-changed` em maximize/unmaximize → Task 1 Step 2. ✓
- F11 engolido → Task 1 Step 2. ✓
- `window.golive.win` namespace → Task 2. ✓
- Markup `#titlebar` + ícones + troca maximize/restore → Task 3 Step 1 + CSS Step 3. ✓
- `<script src="titlebar.js">` antes de app.js → Task 3 Step 2. ✓
- CSS: faixa 32px fixa, drag/no-drag, hover, close vermelho `#e81123`/`#f1707a`, `has-titlebar` padding, fullscreen esconde → Task 3 Step 3. ✓
- `titlebar.js` IIFE + `root.GoLive.titlebar` + `module.exports` → Task 4 Step 3. ✓
- `init(win, doc)` no bootstrap → Task 4 Step 5. ✓
- Testes: 4 casos (não-win32, win32 mostra, cliques, onMaximizeChange) → Task 4 Step 1. ✓
- overlay / diag GPU intocados → nenhuma task os menciona. ✓

**2. Placeholder scan:** Sem TBD/TODO. Única condicional aberta: o seletor `#room-view` na Task 3 Step 3, com instrução explícita de como resolver (achar o irmão de `#lobby-view` no index.html). O implementador deve confirmar esse id ao executar a task.

**3. Type consistency:** `win.platform`, `win.minimize/toggleMaximize/close`, `win.onMaximizeChange(cb)` idênticos entre Task 2 (produz), Task 4 módulo e Task 4 teste. Ids `tb-min`/`tb-max`/`tb-close`/`titlebar` idênticos entre Task 3 (HTML), Task 4 (módulo) e teste. Classe `has-titlebar` e `is-maximized` idênticas entre CSS e módulo. Evento `window:maximize-changed` idêntico entre main e preload. ✓

# Controles de janela próprios (estilo Discord)

## Problema

A janela principal usa a barra de título nativa do Windows. Queremos uma barra
própria, no estilo do Discord: janela sem moldura, com uma faixa fina no topo
que serve de área de arrasto e traz os botões de minimizar, maximizar/restaurar
e fechar no canto superior direito — o fechar fica vermelho no hover.

## Escopo

- **Só Windows.** No macOS/Linux (rodados via `npm start` durante o
  desenvolvimento) a janela mantém a barra nativa e a faixa do renderer não
  aparece.
- Vale para `npm start` e para o app empacotado por igual.
- Fora de escopo: janela de rabisco (`overlay.html`, já `frame:false`) e a
  janela efêmera de diagnóstico de GPU — nenhuma das duas muda.

## Decisão técnica

`BrowserWindow` recebe `titleBarStyle: 'hidden'` (não `frame: false`). Mantém de
graça a sombra da janela, os cantos arredondados do Win11, as bordas de
redimensionar e o duplo-clique-para-maximizar sobre a área de arrasto.

Trade-off aceito: o flyout de Snap Layout do Win11 ao **passar o mouse** sobre o
botão de maximizar pode não aparecer. Arrastar-para-encostar e `Win+Z` seguem
funcionando.

## Processo principal — `src/main.js`

### `createWindow()`

- Adicionar à config do `BrowserWindow`, condicional a `process.platform === 'win32'`:
  `titleBarStyle: 'hidden'`.
- Nenhuma outra opção de janela muda.

### IPC (fire-and-forget, `ipcMain.on`, não `handle`)

| Canal                    | Ação                                                        |
|--------------------------|------------------------------------------------------------|
| `window:minimize`        | `win.minimize()`                                            |
| `window:toggle-maximize` | `win.isMaximized() ? win.unmaximize() : win.maximize()`     |
| `window:close`           | `win.close()`                                               |

Cada handler valida `win && !win.isDestroyed()` antes de agir.

### Sincronização do estado maximizado

```js
const sendMax = () => win?.webContents.send('window:maximize-changed', win.isMaximized());
win.on('maximize', sendMax);
win.on('unmaximize', sendMax);
```

### F11

Registrar um atalho local que engole o toggle de fullscreen nativo:

```js
win.webContents.on('before-input-event', (event, input) => {
  if (input.type === 'keyDown' && input.key === 'F11') event.preventDefault();
});
```

O fullscreen próprio do app (tile em tela cheia, `ui.js` → `win.setFullScreen()`)
não passa por F11 e continua intacto.

## Ponte — `src/preload.js`

Novo namespace exposto em `window.golive.win`:

```js
win: {
  platform: process.platform,                    // 'win32' | 'darwin' | 'linux'
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizeChange: (cb) =>
    ipcRenderer.on('window:maximize-changed', (_e, isMax) => cb(isMax)),
}
```

## Renderer

### Markup — `src/renderer/index.html`

Primeiro filho de `<body>`, antes do `#update-banner`:

```html
<div id="titlebar" class="titlebar" hidden>
  <div class="titlebar-brand">
    <svg class="titlebar-mark" viewBox="0 0 32 32" aria-hidden="true"><!-- mesma marca do lobby --></svg>
    <span class="titlebar-name">GoLive LAN</span>
  </div>
  <div class="titlebar-drag"></div>
  <div class="titlebar-controls">
    <button id="tb-min" class="titlebar-btn" type="button" aria-label="Minimizar"><!-- svg — --></button>
    <button id="tb-max" class="titlebar-btn" type="button" aria-label="Maximizar"><!-- svg quadrado --></button>
    <button id="tb-close" class="titlebar-btn titlebar-btn-close" type="button" aria-label="Fechar"><!-- svg ✕ --></button>
  </div>
</div>
```

Ícones: SVG de traço, 10×10, `stroke="currentColor"`.
- minimizar: `M2,8 H14` (traço centralizado)
- maximizar (janela normal): `rect x=2 y=2 width=12 height=12`
- restaurar (janela maximizada): dois quadrados sobrepostos —
  `M4,6 H12 V14 H4 Z` + `M6,4 H14 V12` (o traço do de trás)
- fechar: `M3,3 L13,13 M13,3 L3,13`

### Estilo — `src/renderer/style.css`

- `.titlebar`: `position: fixed; inset: 0 0 auto 0; height: 32px; z-index`
  acima de tudo (maior que `#toast` e `#update-banner`); `display: flex`;
  `-webkit-app-region: drag`; fundo herda o tema (usar as custom props já
  existentes de superfície do topo).
- `.titlebar[hidden]` continua escondida (default para não-Windows; `titlebar.js`
  remove o `hidden` só no `win32`).
- `.titlebar-brand`: gap pequeno, opacidade ~0.7, `padding-left: 12px`,
  `pointer-events: none`.
- `.titlebar-drag`: `flex: 1`.
- `.titlebar-controls`: `-webkit-app-region: no-drag`; `display: flex`.
- `.titlebar-btn`: `46px × 32px`; sem fundo; ícone `currentColor` com opacidade
  ~0.8; hover → fundo `rgba(255,255,255,.08)` no tema escuro,
  `rgba(0,0,0,.06)` no tema Papel (via a mesma custom prop/seletor de tema que
  o resto do app usa); `:active` um pouco mais forte.
- `.titlebar-btn-close:hover`: fundo `#e81123`, ícone `#fff`.
  `.titlebar-btn-close:active`: fundo `#f1707a`.
- **Empurrar o conteúdo:** o container raiz da UI (o wrapper que contém
  `#lobby-view` e a view de sala) ganha `padding-top: 32px` quando
  `body.has-titlebar` está presente. `titlebar.js` adiciona `has-titlebar` ao
  `<body>` no `win32`. Assim macOS/Linux não ganham o respiro.
- **Dentro da sala:** a faixa continua visível no idle. Nenhuma regra de
  `.room-idle` a esconde.
- **Tile em tela cheia:** adicionar regra explícita
  `body:has(.tile.fullscreen) .titlebar { display: none; }` (o `.tile.fullscreen`
  já cobre a tela via `position: fixed; inset: 0`, isto só evita qualquer
  chance de ela vazar por cima).

### Lógica — `src/renderer/titlebar.js` (novo módulo)

Segue o padrão do projeto: IIFE que expõe em `root.GoLive.titlebar` e
`module.exports`, sem tocar em DOM fora de `init()`. O `document` entra por
injeção (como em `screenrelay.js`), porque não há jsdom no projeto.

```js
'use strict';
(function (root) {
  function init(win, doc) {
    if (!win || win.platform !== 'win32') return;   // barra nativa nos outros SOs
    const bar = doc.getElementById('titlebar');
    bar.hidden = false;
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

O SVG do maximizar troca via CSS: `.titlebar-btn:not(.is-maximized) .icon-restore { display: none }`
e o inverso para `.icon-maximize` — os dois paths ficam no HTML.

`<script src="titlebar.js"></script>` entra no `index.html` antes de `app.js`.
Chamada no bootstrap do renderer (onde `ui.js`/`app.js` inicializam):
`window.GoLive.titlebar.init(window.golive.win, document)`.

## Testes

### `src/renderer/titlebar.test.js` (`node --test`, `document` falso injetado)

- `fakeDoc()`: mapa de elementos falsos (`{ hidden, classList, listeners,
  setAttribute, addEventListener }`), `getElementById` devolve do mapa,
  `body` com `classList`. Mesmo estilo de duble do `screenrelay.test.js`.
- `win` falso com `minimize`/`toggleMaximize`/`close` como contadores e
  `onMaximizeChange` que guarda o callback.
- Casos:
  1. `platform !== 'win32'` → `#titlebar` `hidden` continua `true`, body sem
     `has-titlebar`, nenhum listener registrado.
  2. `platform === 'win32'` → `#titlebar` `hidden === false`, body com
     `has-titlebar`.
  3. disparar o listener de `click` de `#tb-min` → `win.minimize` chamado uma
     vez (idem `#tb-max`→`toggleMaximize`, `#tb-close`→`close`).
  4. callback de `onMaximizeChange(true)` → `#tb-max` com classe `is-maximized`
     e `aria-label="Restaurar"`; `(false)` desfaz.

### Main

Fino demais para teste unitário sem Electron. Validação por `npm start`:
minimizar, maximizar/restaurar (ícone troca), fechar, arrastar pela faixa,
duplo-clique na faixa maximiza, F11 não faz nada, tema Papel pinta a barra
clara, tile em tela cheia esconde a barra.

## Ordem de implementação

1. `main.js`: `titleBarStyle`, IPC, `maximize-changed`, F11.
2. `preload.js`: namespace `win`.
3. `index.html`: markup da titlebar.
4. `style.css`: barra, botões, `has-titlebar`, regra de fullscreen.
5. `titlebar.js` + fio no bootstrap.
6. `titlebar.test.js`.
7. `npm test` e checklist do `npm start`.

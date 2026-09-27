# Redesign fase 1 — fundação e Mesa: plano de implementação

> **Para quem executa:** SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans.
> Passos com `- [ ]`. Aqui a execução é por **jobs do Codex** despachados pela sessão principal (seção "Jobs"),
> e não por subagentes Claude.

**Objetivo:** janelas da Mesa com barra de título que nunca cobre o conteúdo, nascendo inteiras, controles da
Mesa com lugar fixo, camadas nomeadas e a forma "Macio".

**Arquitetura:** o registro compartilhado (`mesa-modules/index.js`) passa a devolver em `mod.size` o retângulo
**externo** (conteúdo + barra de 36 px) e guarda o que o módulo declarou em `mod.content`. Servidor e vista
continuam lendo `mod.size` sem mudança. A moldura é DOM de `mesa-view.js`, e a área segura entra como opção
`safe` das funções puras de `mesa-vista.js`.

**Tecnologia:** Electron 44 (Chromium 152), JS sem build, `node --test`, ESLint, bancadas Playwright em `tools/`.

**Spec:** `docs/superpowers/specs/2026-09-26-redesign-fundacao-e-mesa-design.md`.

## Restrições globais (valem para toda tarefa)

- Português em código, comentários e textos. Assunto de commit sem acento.
- Linhas com no máximo 120 colunas, uma instrução por linha, um teste por regra.
- Cor só por token de `style.css`. Nenhum hex fora dos blocos de tema.
- `--live` (vermelho) só para "alguém está ao vivo". "Sua vez" usa `--act`/`--on-text`.
- Nada de `filter` nem `backdrop-filter`. Só `transform` e `opacity` animam. Animação usa o `transform`, nunca a
  propriedade `scale` avulsa.
- Nenhum `id` do `index.html` renomeado ou removido.
- Glossário (`docs/glossario.md`) é testado: termo novo visível na interface entra nele.
- Todo diff em `src/renderer/` só entra depois do boot no Electron real (tarefa 8).
- Comandos: `npm test` (`node --test`) e `npm run lint` (`eslint .`). Base de hoje: `npm test` verde, lint com
  0 erros.

## Mapa de arquivos

| Arquivo | Responsabilidade nesta fase |
|---|---|
| `src/renderer/style.css` | tokens `--elev-*` e `--z-*`; moldura `.mesa-bar`; pílula de navegação; posição dos avisos |
| `src/renderer/css-rules.test.js` | teste da escala de camadas |
| `src/renderer/mesa-modules/index.js` | `BAR_H`, `size` externo e `content` |
| `src/renderer/mesa-modules/index.test.js` | testes do tamanho externo |
| `src/renderer/mesa-vista.js` (+ `.test.js`) | `chromeH` em `resizeRect`/`keyRect`; `safe` em `centerOn`, `viewCenter`, `fitRect`, `fitAll`, `focusRect` |
| `src/renderer/mesa-view.js` | `makeWin` com barra, arrasto pela barra, `setStatus`/`setTurn`, janela ativa, zoom distante, área segura, pílula, avatares no cabeçalho |
| `src/renderer/index.html` | `#stage-mesa-people` no cabeçalho do palco |
| `src/renderer/app.js` | passa `peopleSlot` para `mesaView.create` |
| `tools/bancada-janelas/bancada.js`, `index.html` | página de bancada sem a alça de 28 px, com a barra |
| `tools/bancada-janelas/caber.js` | teste "caber" (novo) |
| `src/renderer/mesa-modules/<tipo>.js` | `size` de conteúdo revisado quando o "caber" acusar |
| `src/renderer/mesa-janelas/<tipo>.js`, `mesa-janelas.css` | conteúdo cabendo; jogos chamando `setStatus`/`setTurn` |
| `STATUS.md`, `docs/glossario.md`, `docs/prints/2026-09-2x-redesign/` | documentação |

---

### Tarefa 1: Tokens de profundidade e escala de camadas

**Arquivos:**
- Modificar: `src/renderer/style.css` (bloco `:root` perto da linha 107; os 43 `z-index`; blocos de tema com sombra)
- Modificar: `src/renderer/mesa-janelas.css` (6 `z-index`)
- Teste: `src/renderer/css-rules.test.js`

**Interfaces produzidas:** `--elev-1`, `--elev-2`, `--elev-3`; `--z-canvas`, `--z-win`, `--z-win-drag`,
`--z-mesa-hud`, `--z-dock`, `--z-toast`, `--z-popover`, `--z-modal`, `--z-modal-popover`, `--z-dialog`,
`--z-titlebar`. As tarefas 3 e 5 usam esses nomes.

- [ ] **Passo 1: escrever o teste que falha**, no fim de `css-rules.test.js`:

```js
test('z-index so por token da escala, ou 0 a 2 local', () => {
  for (const arquivo of ['style.css', 'mesa-janelas.css']) {
    const css = fs.readFileSync(path.join(__dirname, arquivo), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/z-index\s*:\s*([^;}]+)/g)) {
      const valor = m[1].trim();
      const ok = /^var\(--z-[a-z-]+\)$/.test(valor) || /^-?[0-2]$/.test(valor);
      assert.ok(ok, `${arquivo}: z-index "${valor}" fora da escala`);
    }
  }
});

test('a escala de camadas esta em ordem e todo --z-* usado existe', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const ordem = ['canvas', 'win', 'win-drag', 'mesa-hud', 'dock', 'toast', 'popover', 'modal', 'modal-popover',
    'dialog', 'titlebar'];
  const valor = (n) => Number((css.match(new RegExp(`--z-${n}:\\s*(\\d+)`)) || [])[1]);
  for (let i = 1; i < ordem.length; i += 1) {
    assert.ok(valor(ordem[i]) > valor(ordem[i - 1]), `--z-${ordem[i]} tem de ficar acima de --z-${ordem[i - 1]}`);
  }
  const usados = new Set([...css.matchAll(/var\(--z-([a-z-]+)\)/g)].map((m) => m[1]));
  for (const n of usados) assert.ok(ordem.includes(n) || n === 'stage', `--z-${n} usado sem estar na escala`);
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test src/renderer/css-rules.test.js`. Esperado: FAIL com
  `z-index "4" fora da escala` (e a ordem falha porque `--z-titlebar` é 50 e `--z-toast` é 10000).

- [ ] **Passo 3: implementar.** No `:root`, trocar as linhas 114–120 por:

```css
  /* Camadas, do fundo para a frente. Dentro de um componente com
   * isolation: isolate vale 0 a 2 local; fora disso, so estes tokens. */
  --z-stage: 1;
  --z-canvas: 1;
  --z-win: 2;
  --z-win-drag: 3;
  --z-mesa-hud: 10;
  --z-dock: 20;
  --z-toast: 30;
  --z-popover: 50;
  --z-modal: 1000;
  --z-modal-popover: 1001; /* menu aberto a partir de dentro de um modal */
  --z-dialog: 1002; /* confirmacoes e campos acima do menu do modal */
  --z-titlebar: 1003; /* a faixa de titulo do app fica acima de tudo */
```

  Atenção: `--z-toast` desce de 10000 para 30 e `--z-titlebar` sobe de 50 para 1003. Conferir os dois usos
  (linhas ~479 e ~2857) e o comentário da linha ~3036 (tile em tela cheia empatado com `--z-popover`). Se o aviso
  da linha 479 precisa ficar acima de modal, ele passa a usar `--z-dialog` e o comentário diz o porquê.
  Cada `z-index` numérico acima de 2 vira o token do papel dele: janela arrastada vira `--z-win-drag`, controles da
  Mesa `--z-mesa-hud`, dock `--z-dock`, e menus e dicas `--z-popover`. O que for empilhamento interno de um
  componente ganha `isolation: isolate` no pai e fica em 0 a 2.
  Tokens de sombra no `:root` (tema escuro padrão) e nos blocos de tema:

```css
  --elev-1: inset 0 1px 0 rgb(255 255 255 / .05), 0 2px 8px rgb(0 0 0 / .35);
  --elev-2: inset 0 1px 0 rgb(255 255 255 / .06), 0 10px 24px rgb(0 0 0 / .45);
  --elev-3: inset 0 1px 0 rgb(255 255 255 / .08), 0 18px 40px rgb(0 0 0 / .55);
```

  No tema Papel (bloco `[data-theme="papel"]` ou equivalente em `theme.js`, conferir onde os tokens do Papel
  vivem):

```css
  --elev-1: 0 0 0 1px var(--line2), 0 1px 3px rgb(20 20 40 / .08);
  --elev-2: 0 0 0 1px var(--line2), 0 6px 16px rgb(20 20 40 / .10);
  --elev-3: 0 0 0 1px var(--line2), 0 12px 28px rgb(20 20 40 / .14);
```

  Se os temas vivem em `theme.js` (presets com lista de tokens), acrescentar os três tokens aos presets, sem
  entrar na trava de contraste, e ajustar `theme.test.js` se ele conferir a lista exata de tokens.

- [ ] **Passo 4: rodar.** `node --test src/renderer/css-rules.test.js src/renderer/theme.test.js`, depois `npm test`
  e `npm run lint`. Esperado: PASS.

- [ ] **Passo 5: commit** (feito pela sessão principal): `style(tokens): escala de camadas --z-* e sombras --elev-*`.

---

### Tarefa 2: `size` externo no registro e a barra na conta do redimensionamento

**Arquivos:**
- Modificar: `src/renderer/mesa-modules/index.js` (`checkModule`, exporta `BAR_H`)
- Modificar: `src/renderer/mesa-vista.js` (`resizeRect`, `keyRect`)
- Teste: `src/renderer/mesa-modules/index.test.js`, `src/renderer/mesa-vista.test.js`

**Interfaces produzidas:**
- `registry.BAR_H === 36`.
- `registry.get(tipo).size` → `{ w, h, minW, minH, aspect, chromeH }` **externo** (`h` e `minH` já com a barra;
  `chromeH === BAR_H`).
- `registry.get(tipo).content` → o `size` do módulo como foi declarado (congelado).
- `V.resizeRect(orig, edge, dx, dy, { aspect, minW, minH, chromeH = 0 })` e
  `V.keyRect(rect, key, { shift, alt, aspect, minW, minH, chromeH = 0 })`: com `aspect`, a proporção vale para
  `(w) : (h - chromeH)`.

- [ ] **Passo 1: testes que falham**, no fim de `index.test.js`:

```js
test('size do registro e o retangulo externo: conteudo + barra', () => {
  const r = registry.checkModule(modulo());
  assert.equal(r.ok, true);
  assert.equal(registry.BAR_H, 36);
  assert.deepEqual({ ...r.module.content }, { w: 200, h: 100, minW: 100, minH: 50, aspect: null });
  assert.deepEqual({ ...r.module.size }, { w: 200, h: 136, minW: 100, minH: 86, aspect: null, chromeH: 36 });
});

test('a proporcao do modulo continua sendo a do conteudo', () => {
  const tela = registry.get('tela');
  assert.equal(tela.size.aspect, 16 / 9);
  assert.equal(tela.size.h - tela.size.chromeH, tela.size.w / tela.size.aspect);
});
```

  No fim de `mesa-vista.test.js` (use o mesmo `v` que o arquivo já importa):

```js
test('resizeRect com chromeH: a proporcao vale so para o corpo', () => {
  const orig = { x: 0, y: 0, w: 640, h: 396 };
  const opts = { aspect: 16 / 9, minW: 160, minH: 126, chromeH: 36 };
  assert.deepEqual(v.resizeRect(orig, 'r', 160, 0, opts), { x: 0, y: 0, w: 800, h: 486 });
  assert.deepEqual(v.resizeRect(orig, 'b', 0, 90, opts), { x: 0, y: 0, w: 800, h: 486 });
  const min = v.resizeRect(orig, 'br', -9999, -9999, opts);
  assert.deepEqual({ w: min.w, h: min.h }, { w: 160, h: 126 });
});

test('keyRect repassa chromeH', () => {
  const r = v.keyRect({ x: 0, y: 0, w: 640, h: 396 }, 'ArrowRight', { alt: true, aspect: 16 / 9, chromeH: 36 });
  assert.deepEqual(r, { x: 0, y: 0, w: 650, h: 402 });
});
```

- [ ] **Passo 2: rodar e ver falhar.** `node --test src/renderer/mesa-modules/index.test.js src/renderer/mesa-vista.test.js`.
  Esperado: FAIL (`BAR_H` undefined; `h` 360 em vez de 486).

- [ ] **Passo 3: implementar.** Em `index.js`, perto de `MIN_STATE_BYTES`:

```js
  // Altura da barra de titulo da janela (spec do redesign, 4.1). O `size`
  // que o modulo declara e o do CONTEUDO; o registro devolve o externo.
  const BAR_H = 36;
```

  E em `checkModule`, no `Object.freeze({...})`, trocar a linha do `size` por:

```js
      content: Object.freeze({ ...size, aspect: size.aspect == null ? null : size.aspect }),
      size: Object.freeze({
        w: size.w,
        h: size.h + BAR_H,
        minW: size.minW,
        minH: size.minH + BAR_H,
        aspect: size.aspect == null ? null : size.aspect,
        chromeH: BAR_H,
      }),
```

  Exportar `BAR_H` no objeto `api`. Em `mesa-vista.js`, `resizeRect` ganha `chromeH = 0` nas opções, e o bloco
  `if (aspect)` passa a trabalhar com a altura do corpo:

```js
    if (aspect) {
      const minWa = Math.max(minW, (minH - chromeH) * aspect);
      if (bottom && !left && !right) {
        const body = Math.max(minWa / aspect, h - chromeH);
        w = body * aspect;
        h = body + chromeH;
      } else {
        w = Math.max(minWa, w);
        h = w / aspect + chromeH;
      }
    }
```

  `keyRect` ganha `chromeH = 0` e o repassa nas duas chamadas de `resizeRect`.
  `mesa-view.js` já passa `mod.size` inteiro (`startDrag` linha ~1348 e `onWinKey` linha ~1543), então o
  `chromeH` chega sem mudança ali. Conferir com `grep -n "resizeRect\|keyRect" src/renderer/mesa-view.js`.

- [ ] **Passo 4: rodar tudo.** `npm test`. Os testes de servidor que postam retângulos (`w: 640, h: 360` para tela e
  `360×360` para velha) continuam válidos porque só o mínimo é conferido. Se algum falhar por tamanho,
  corrigir o valor do teste para o externo e explicar no relatório.

- [ ] **Passo 5: commit:** `feat(mesa): size do registro e externo, com a barra de 36 px`.

---

### Tarefa 3: Moldura com barra de título

**Arquivos:**
- Modificar: `src/renderer/mesa-view.js` (`makeWin`, `syncControls`, `onWinDown`, `makeApi`, `setFullButton`, estado
  `.is-active`, `applyView` para o zoom distante)
- Modificar: `src/renderer/style.css` (seção da Mesa, linhas ~3425–3620: sai `.mesa-handle` e `.mesa-ctrls`,
  entra `.mesa-bar`)
- Modificar: `tools/bancada-janelas/bancada.js` e `tools/bancada-janelas/index.html` (sai a `.alca`)
- Teste: `tools/mesa-prints/harness.js checar` e `mesa.test.js`, se houver teste de DOM da vista

**Interfaces consumidas:** `--elev-2`, `--elev-3`, `--z-win`, `--z-win-drag` (tarefa 1); `mod.size.chromeH` (tarefa 2).

**Interfaces produzidas** (as tarefas 6 e 7 usam):
- `api.setStatus(texto: string)`: texto ≤ 60 caracteres (corta o resto), vai para `textContent` de
  `.mesa-bar-status`. `''` limpa.
- `api.setTurn(on: boolean)`: mostra ou esconde `.mesa-bar-turn` ("Sua vez") e anuncia em `S.liveEl`
  "Sua vez: <título>" só na passagem de `false` para `true`.
- Classes: `.mesa-bar`, `.mesa-bar-title`, `.mesa-bar-status`, `.mesa-bar-turn`, `.mesa-bar-btn`,
  `.mesa-win.is-active`, `.mesa[data-far]`.

- [ ] **Passo 1: novo `makeWin`.** Trocar o `el.innerHTML` por:

```js
      el.innerHTML = `
        <div class="mesa-bar">
          ${media ? '<span class="mesa-live-slot"></span>' : ''}
          <span class="mesa-bar-title"></span>
          <span class="mesa-bar-status"></span>
          <span class="mesa-bar-turn" hidden>Sua vez</span>
          <span class="mesa-moving" hidden></span>
          <span class="mesa-avatar"></span>
          <button type="button" class="mesa-bar-btn" data-act="menu" aria-label="Mais ações da janela"
            title="Mais ações (Shift+F10)" aria-haspopup="menu">${ICON.more}</button>
          <button type="button" class="mesa-bar-btn" data-act="full" aria-label="Tela cheia"
            title="Tela cheia (F)">${ICON.fs}</button>
          <button type="button" class="mesa-bar-btn" data-act="remove" aria-label="Tirar da mesa"
            title="Tirar da mesa (Delete)">${ICON.x}</button>
        </div>
        <div class="mesa-win-body"></div>
        <div class="mesa-resize" data-edge="l" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="r" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="b" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="bl" aria-hidden="true"></div>
        <div class="mesa-resize" data-edge="br" aria-hidden="true"></div>`;
```

  Acrescentar `ICON.more` (três pontos, SVG de 24 com traço 1,75, no mesmo formato dos outros ícones de `ICON`).
  O botão `menu` chama `openMenuAt(r.left, r.bottom + 4, rec.id, { keyboard: e.detail === 0 })`, com `r` sendo o
  `getBoundingClientRect()` do botão.
  Em `syncControls`, o título vai para `.mesa-bar-title` (`labelOf(win)`); a pílula AO VIVO vai para
  `.mesa-live-slot` (mesma lógica da `.mesa-live-pill` de hoje); o `.mesa-win-label` sai; e o `.mesa-moving`
  passa a ser o texto "<nome> está movendo" dentro da barra.
  Ainda em `syncControls`, com travas: o `full` e o `menu` continuam ativos. O `remove` continua escondido quando
  `!canRemove(win)` (como hoje). Com `!canEdit()`, a barra recebe `title = lockReason()`.
  Em `setFullButton(rec, on)`, o botão `full` troca o ícone (`ICON.fs` ↔ um `ICON.fsExit` novo), o `aria-label`
  e o `title` ("Tela cheia (F)" ↔ "Sair da tela cheia (F)"). A barra fica visível em tela cheia: conferir que
  `.mesa-win.is-full` não esconde `.mesa-bar`, e apagar a regra `.mesa-win.is-full .mesa-handle`.

- [ ] **Passo 2: arrasto só pela barra.** Novo começo de `onWinDown`:

```js
    function onWinDown(e, rec) {
      if (e.button !== 0) return;
      setActive(rec.id);
      if (!e.target.closest('.mesa-bar') || e.target.closest('.mesa-bar-btn, .mesa-resize')) return;
      const win = findWin(rec.id);
      if (!win || S.fullId) return;
```

  O resto (travas, `holderOf`, `startDrag`) fica igual. Saem as variáveis `media` e `onHandle` e o desvio dos
  controles do tile.
  `setActive(id)` tira `.is-active` da janela anterior e põe na nova (guardar `S.activeId`); chamar também no
  `focus` da janela.

- [ ] **Passo 3: `setStatus` e `setTurn` em `makeApi`:**

```js
        setStatus(texto) {
          const el = rec.el.querySelector('.mesa-bar-status');
          el.textContent = String(texto ?? '').slice(0, 60);
        },
        setTurn(on) {
          const el = rec.el.querySelector('.mesa-bar-turn');
          const antes = !el.hidden;
          el.hidden = !on;
          if (on && !antes) announce(`Sua vez: ${labelOf(findWin(rec.id) || { type: rec.type })}`);
        },
```

  (`announce` já existe perto de `toast`; conferir a assinatura e passar `null` como `who` se precisar.)

- [ ] **Passo 4: zoom distante.** Em `applyView`: `S.section.toggleAttribute('data-far', S.view.z < 0.6)`.

- [ ] **Passo 5: CSS.** Apagar `.mesa-handle`, `.mesa-handle::after`, `.mesa-ctrls` e as regras de hover e
  `.room-idle` que mexem neles, além de `.mesa-win-label` e `.mesa-win-name` se ficarem sem uso. `.mesa-win-body`
  deixa de ser `inset: 0`. Novo bloco:

```css
/* Janela: moldura com barra de titulo (spec do redesign, 4.1). */
.mesa-win {
  position: absolute; left: 0; top: 0;
  z-index: var(--z-win);
  display: flex; flex-direction: column;
  border-radius: var(--r-lg);
  background: var(--s1);
  box-shadow: var(--elev-2);
  overflow: hidden;
  outline: 0;
}
.mesa-win.is-active { box-shadow: var(--elev-3); }
.mesa-win:focus-visible { box-shadow: var(--elev-3), 0 0 0 2px var(--on-text); }
.mesa-win.is-dragging { z-index: var(--z-win-drag); box-shadow: var(--elev-3); will-change: transform; }
.mesa-bar {
  flex: none; height: 36px;
  display: flex; align-items: center; gap: var(--s-2);
  padding: 0 var(--s-1) 0 var(--s-3);
  background: var(--s2);
  cursor: grab; user-select: none;
}
.mesa-win.is-dragging .mesa-bar { cursor: grabbing; }
.mesa.no-edit .mesa-bar { cursor: not-allowed; }
.mesa-bar-title { font: 600 var(--fs-body) 'Outfit', system-ui, sans-serif; color: var(--tx2); white-space: nowrap; }
.mesa-win.is-active .mesa-bar-title { color: var(--tx); }
.mesa-bar-status {
  flex: 1; min-width: 0;
  color: var(--tx2); font-size: var(--fs-small);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mesa-bar-turn {
  flex: none; padding: 2px var(--s-2); border-radius: var(--r-full);
  background: var(--act); color: var(--on-act, #fff); font-weight: 600; font-size: var(--fs-small);
}
.mesa-bar-btn {
  flex: none; width: 28px; height: 28px; min-height: 28px; border-radius: 50%;
  display: grid; place-items: center; color: var(--tx2); background: transparent;
}
.mesa-bar-btn:hover { background: var(--s3); color: var(--tx); }
.mesa-bar-btn:focus-visible { box-shadow: 0 0 0 2px var(--ring); }
.mesa-bar-btn:disabled { opacity: .4; cursor: not-allowed; }
.mesa[data-far] .mesa-bar-btn,
.mesa[data-far] .mesa-bar-status,
.mesa[data-far] .mesa-avatar { display: none; }
.mesa-win-body { position: relative; flex: 1; min-height: 0; }
```

  Conferir três coisas no CSS:
  - `--on-act` existe? Se não existir, usar o token que o botão primário usa para o texto sobre `--act`. Hex solto
    é proibido; o `#fff` acima é só o fallback do `var()` e deve sair se o token existir.
  - `button { min-height: 44px }` global ganha de `height: 28px`. Por isso `min-height: 28px` está explícito
    (lição de 2026-09-16).
  - As regras de `.mesa-win .tile-annot-bar` e `.tile-react-bar` continuam valendo dentro do corpo.

- [ ] **Passo 6: bancada.** Em `tools/bancada-janelas/bancada.js`, remover a `.alca` e o comentário dela. A
  `.janela` passa a ter uma `.barra` de 36 px (título do módulo) acima do `.conteudo`, e `dims` continua sendo o
  **conteúdo** (usa o `size` do módulo cru, `GoLive.mesaModules[tipo].size`, que é o do conteúdo). Ajustar
  `index.html` da bancada para `.janela` virar coluna flex com a barra e o conteúdo com `flex: 1`.

- [ ] **Passo 7: rodar.** `npm test`, `npm run lint` e `node tools/mesa-prints/harness.js checar` (precisa de
  `PLAYWRIGHT_DIR`; o harness procura os controles antigos? Se procurar `.mesa-ctrls`/`.mesa-handle`, atualizar
  os seletores para `.mesa-bar`/`.mesa-bar-btn`, sem afrouxar nenhuma conferência).
  Depois `node tools/bancada-janelas/rodar.js --sem-prints`, `mesa-real.js`, `festa-real.js` e `leva2-real.js`:
  0 falhas.

- [ ] **Passo 8: commit:** `feat(mesa): barra de titulo na janela; controles nunca cobrem o conteudo`.

---

### Tarefa 4: Teste "caber"

**Arquivos:**
- Criar: `tools/bancada-janelas/caber.js`

**Interfaces consumidas:** página de bancada da tarefa 3 (`?tipo=<t>&tam=<min|padrao>&tema=<padrao|papel>`,
`window.bancada.impor(estado)`, `window.bancada.conteudoEl(id)`). Conferir em `rodar.js` o nome exato dos
parâmetros da URL e reutilizar.

- [ ] **Passo 1: escrever o roteiro.** Estrutura igual à de `rodar.js` (cabeçalho explicando, `PLAYWRIGHT_DIR`,
  `conferir(cond, msg)`, código de saída 1 com falha). Tipos: todos de `GoLive.mesaModules` que a bancada monta
  (os 30 de `MODULE_NAMES`). Tela e câmera ficam para a passada visual no app real (tarefa 8). Para cada tipo ×
  `['padrao', 'min']` × `['padrao', 'papel']`, com o estado inicial e com o estado cheio de `CHEIOS[tipo]` quando
  existir, rodar no navegador:

```js
function medir() {
  const corpo = window.bancada.conteudoEl('1');
  const caixa = corpo.getBoundingClientRect();
  const problemas = [];
  const tam = new URLSearchParams(location.search).get('tam');
  if (corpo.scrollHeight > corpo.clientHeight + 1) problemas.push(`rola na altura (${corpo.scrollHeight}>${corpo.clientHeight})`);
  if (corpo.scrollWidth > corpo.clientWidth + 1) problemas.push(`rola na largura (${corpo.scrollWidth}>${corpo.clientWidth})`);
  for (const el of corpo.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const fora = r.left < caixa.left - 1 || r.top < caixa.top - 1 || r.right > caixa.right + 1 || r.bottom > caixa.bottom + 1;
    if (fora && !el.closest('[data-caber-rola]')) problemas.push(`fora da caixa: ${rotulo(el)}`);
    const rola = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (rola && tam === 'padrao') problemas.push(`rolagem escondida no padrao: ${rotulo(el)}`);
  }
  for (const el of corpo.querySelectorAll('button, input, select, textarea, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
    const alvo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!alvo || (alvo !== el && !el.contains(alvo))) problemas.push(`coberto: ${rotulo(el)} por ${alvo ? rotulo(alvo) : 'nada'}`);
  }
  return problemas;
}
function rotulo(el) {
  return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` + (el.textContent ? ` "${el.textContent.trim().slice(0, 20)}"` : '');
}
```

  A regra 2 (fora da caixa) tolera o que estiver dentro de um contêiner marcado com `data-caber-rola`. No mínimo,
  lista rolável é permitida, e o conteúdo tem de marcar esse contêiner. A rolagem só reprova no tamanho padrão.
  Também confere o teto: `mod.size.w <= 1000 && mod.size.h + 36 <= 620` (Node, sem navegador).
  `CHEIOS` começa com a roleta (8 opções de 12 letras), pôquer (5 lugares ocupados, mão no flop), blackjack
  (5 lugares), lista (12 itens), enquete (6 opções), stop (6 categorias), quiz (pergunta longa com 4 respostas) e
  truco (4 jogadores). Montar cada estado com as ações públicas do módulo (`init` + `reduce`) no próprio roteiro,
  nunca com JSON escrito à mão que o `validate` recusaria.
  Com falha, grava o print da página em `docs/prints/2026-09-27-caber/<tipo>-<tam>-<tema>.png` e imprime a lista de
  problemas. Uso: `node tools/bancada-janelas/caber.js [tipos...]`.

- [ ] **Passo 2: rodar para registrar a linha de base.** `node tools/bancada-janelas/caber.js`. Esperado:
  **falha**, com a roleta em "coberto" no padrão (o painel sobre a roda). Guardar a saída em
  `logs/agentes/caber-base.txt` (não commitar); é a lista de trabalho das tarefas 6 e 7.

- [ ] **Passo 3: commit** (só o roteiro): `test(bancada): roteiro caber mede conteudo, caixa e botoes cobertos`.

---

### Tarefa 5: Área segura, pílula de navegação, avatares no cabeçalho e avisos

**Arquivos:**
- Modificar: `src/renderer/mesa-vista.js` (+ `.test.js`)
- Modificar: `src/renderer/mesa-view.js` (`build`, `measure`, `renderPeople`, `toast`, usos de `fitAll`,
  `focusRect`, `viewCenter`)
- Modificar: `src/renderer/index.html` (`#stage-mesa-people`), `src/renderer/app.js` (`peopleSlot`)
- Modificar: `src/renderer/style.css` (`.mesa-nav`, `.mesa-map`, `.mesa-zoom`, `.mesa-toast`, `.mesa-lock-note`,
  `.mesa-people`, `.stage-mesa-people`)

**Interfaces produzidas:**
- `safe = { top, right, bottom, left }` em pixels da tela, opcional em `centerOn`, `viewCenter`, `fitRect`,
  `fitAll` e `focusRect` (sem `safe`, o resultado é igual ao de hoje).
- `deps.peopleSlot` (opcional) em `mesaView.create`.

- [ ] **Passo 1: testes que falham** em `mesa-vista.test.js`:

```js
test('viewCenter com safe: o centro e o da area segura', () => {
  const view = { x: 0, y: 0, z: 1 };
  assert.deepEqual(v.viewCenter(view, 1000, 600), { x: 500, y: 300 });
  assert.deepEqual(v.viewCenter(view, 1000, 600, { top: 0, right: 0, bottom: 100, left: 200 }), { x: 600, y: 250 });
});

test('centerOn com safe poe o ponto no centro da area segura', () => {
  const safe = { top: 0, right: 0, bottom: 100, left: 200 };
  const view = v.centerOn(2000, 1000, 1, 1000, 600, { safe });
  assert.deepEqual(v.viewCenter(view, 1000, 600, safe), { x: 2000, y: 1000 });
});

test('fitRect com safe cabe dentro da area segura', () => {
  const safe = { top: 40, right: 0, bottom: 120, left: 0 };
  const rect = { x: 1000, y: 1000, w: 800, h: 800 };
  const view = v.fitRect(rect, 1000, 800, { pad: 0, safe });
  const s = v.screenRect(view, rect);
  assert.ok(s.y >= 40 - 0.5 && s.y + s.h <= 800 - 120 + 0.5, 'a janela cabe entre o topo e a pilula');
});
```

  Conferir em `mesa-vista.test.js` se `screenRect` já é exportado (é usado em `mesa-view.js`). O `clampView`
  pode segurar a vista na borda do mundo: usar pontos longe da borda, como nos testes acima.

- [ ] **Passo 2: rodar e ver falhar.** `node --test src/renderer/mesa-vista.test.js`.

- [ ] **Passo 3: implementar em `mesa-vista.js`:**

```js
  const SAFE0 = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Centro (em px da tela) da area segura: o que sobra de `vw`x`vh` sem
   * as bordas ocupadas por controles (spec do redesign, 4.4). */
  function safeCenter(vw, vh, safe = SAFE0) {
    return { sx: safe.left + (vw - safe.left - safe.right) / 2, sy: safe.top + (vh - safe.top - safe.bottom) / 2 };
  }

  function centerOn(cx, cy, z, vw, vh, opts = {}) {
    const zz = clampZoom(z);
    const { sx, sy } = safeCenter(vw, vh, opts.safe);
    return clampView({ x: cx - sx / zz, y: cy - sy / zz, z: zz }, vw, vh, opts);
  }

  function viewCenter(view, vw, vh, safe) {
    const { sx, sy } = safeCenter(vw, vh, safe);
    return { x: view.x + sx / view.z, y: view.y + sy / view.z };
  }
```

  Em `fitRect`: `aw = Math.max(1, vw - safe.left - safe.right - pad * 2)`, e o mesmo na altura, com
  `const safe = opts.safe || SAFE0;`. `fitAll` e `focusRect` já repassam `opts`. Conferir se `clampView` aceita e
  ignora a chave `safe` nas opções.

- [ ] **Passo 4: `mesa-view.js`.**
  - Em `build()`, a `.mesa-nav` vira a pílula
    `− · % · + · Ver tudo · Mapa`. O `.mesa-map` passa a ser popover (`hidden` por padrão) acima da pílula, e um
    botão novo `data-zoom="map"` com `aria-expanded` o alterna. O estado fica em `localStorage`
    (`golive.mesa.mapa`), lido e gravado dentro de `try/catch` que registra o erro no `console.warn`, nunca
    `catch` vazio. `renderMap` só desenha com o mapa aberto.
  - Em `measure()`, calcular `S.safe`:

```js
      const sec = S.section.getBoundingClientRect();
      const nav = S.section.querySelector('.mesa-nav').getBoundingClientRect();
      const dock = deps.dockEl?.()?.getBoundingClientRect();
      const margem = 12;
      S.safe = {
        top: margem,
        right: margem,
        bottom: Math.max(sec.bottom - nav.top, dock ? sec.bottom - dock.top : 0) + margem,
        left: margem,
      };
```

    `deps.dockEl` é opcional. Em `app.js`, passar `dockEl: () => document.querySelector('.control-bar')`,
    conferindo o seletor real do dock no `index.html`.
  - Todo `V.fitAll(windows(), S.vw, S.vh)` vira `V.fitAll(windows(), S.vw, S.vh, { safe: S.safe })`; o mesmo para
    `focusRect` e para os dois `V.viewCenter(S.view, S.vw, S.vh)` (`addWindow` e `spot`), e para o `centerOn` do
    voo do foco em `makeWin`.
  - `renderPeople` escreve em `deps.peopleSlot || S.peopleEl`. Quando `peopleSlot` existe, `S.peopleEl` sai do
    DOM da seção, e `close()` limpa o slot e põe `hidden` nele.
  - `.mesa-toast` e `.mesa-lock-note` ficam centralizados embaixo, acima do dock
    (`bottom: calc(var(--dock-h, 72px) + var(--s-3))`), com `z-index: var(--z-toast)`. É um aviso por vez: o novo
    substitui o anterior, como hoje. A nota de trava fica logo acima do aviso.
- [ ] **Passo 5: `index.html` e `app.js`.** Logo depois de `#view-switch`:
  `<div id="stage-mesa-people" class="stage-mesa-people hidden" role="group" aria-label="Quem está na mesa"></div>`.
  Em `mesaView.create`, passar `peopleSlot: $('stage-mesa-people')`. Em `onOpenChange`, alternar `hidden` do slot.
  Avatares de 24 px, sobrepostos em −6 px, no máximo 5 visíveis e um "+N" depois.

- [ ] **Passo 6: rodar.** `npm test`, `npm run lint`, `harness.js checar`, `mesa-real.js` e `leva2-real.js`: 0 falhas.

- [ ] **Passo 7: commit:** `feat(mesa): area segura, pilula de navegacao, avatares no cabecalho`.

---

### Tarefa 6: Janelas de cartas e jogos cabendo, com estado na barra

**Arquivos:** `src/renderer/mesa-modules/{velha,lig4,damas,xadrez,batalha,poquer,blackjack,truco,oito,domino}.js`
(só o `size`), `src/renderer/mesa-janelas/<mesmos>.js`, `src/renderer/mesa-janelas/cartas.js`, e as seções
correspondentes de `src/renderer/mesa-janelas.css`.

**Interfaces consumidas:** `api.setStatus`, `api.setTurn` (tarefa 3); `caber.js` (tarefa 4).

- [ ] **Passo 1:** `node tools/bancada-janelas/caber.js velha lig4 damas xadrez batalha poquer blackjack truco oito domino`
  e anotar as falhas.
- [ ] **Passo 2: estado na barra.** Em cada janela de jogo, no `update`, chamar
  `api.setStatus(<placar e vez em uma linha>)` e `api.setTurn(<é a minha vez e o jogo está andando>)`.
  O placar e a vez que hoje ficam no topo do conteúdo saem de lá, desde que a barra mostre a mesma informação.
  Exemplos de texto:

  | Jogo | Status |
  |---|---|
  | Truco | `1 × 0 · vez de Bia` |
  | Oito | `Bia tem 3 cartas · vez de Caio` |
  | Pôquer | `Pote 40 · flop` |
  | Blackjack | `Apostas` / `Vez de Ana` |
  | Velha | `Vez de Bia (O)` |
  | Batalha | `Posicionando` / `Vez de Ana` |

  No `destroy` do conteúdo, `api.setStatus('')` e `api.setTurn(false)`. As janelas têm de funcionar na bancada
  antiga, onde a `api` não tem os dois métodos: usar `api.setStatus?.(...)`.
- [ ] **Passo 3:** corrigir o conteúdo até o `caber` passar para esses tipos. A ordem de preferência é:
  1. container query escondendo o secundário;
  2. cartas `p` de `cartas.js` no tamanho pequeno;
  3. só então aumentar o `size` do módulo, sem passar do teto de 1000×584 de conteúdo.

  Mudou `size`? Rodar o teste do módulo e ajustar asserção de tamanho exato (`blackjack.test.js` linhas 17–18).
  Nunca usar `overflow: hidden` para esconder o que não cabe: o `caber` mede caixa, mas a revisão vai procurar.
- [ ] **Passo 4:** `npm test`, lint, `caber.js` com esses tipos, `poquer-rodar.js`, `rodar-blackjack.js`,
  `leva2-real.js` e `mesa-real.js`: 0 falhas.
- [ ] **Passo 5: commit:** `fix(mesa-janelas): cartas e jogos cabem e mostram vez na barra`.

---

### Tarefa 7: Janelas de noite, ferramentas e assistir cabendo (inclui a roleta)

**Arquivos:** `mesa-modules/` e `mesa-janelas/` de `youtube, radio, aovivo, jam, nota, lista, imagem, galeria,
link, enquete, placar, cronometro, sorteio, dados, roleta, sons, stop, quiz, quadro, desenha`, mais as seções
deles em `mesa-janelas.css`.

- [ ] **Passo 1: roleta.** Em `mesa-modules/roleta.js`: `size: { w: 640, h: 440, minW: 360, minH: 420, aspect: null }`.
  Em `mesa-janelas.css`, trocar o bloco `@container mj (max-width: 559px)` por:

```css
/* Estreita: a roda em cima, as opcoes numa lista rolavel embaixo. Nada cobre a roda. */
@container mj (max-width: 559px) {
  .mj-roleta { flex-direction: column; }
  .mj-rol-painel { width: auto; max-width: none; flex: 0 1 40%; min-height: 0; overflow-y: auto; }
}
```

  Apagar o bloco `@container mj (min-width: 560px)`, o botão `.mj-rol-alternar` em `mesa-janelas/roleta.js` e a
  classe `is-painel`. O `.mj-rol-painel` recebe `data-caber-rola`.
- [ ] **Passo 2: jogos de festa com vez** (`stop`, `quiz`, `desenha`): `setStatus` e `setTurn` como na tarefa 6
  (Desenha: `setTurn(true)` para quem desenha; Stop: status com a letra e a rodada).
- [ ] **Passo 3:** `node tools/bancada-janelas/caber.js` para esses tipos, corrigindo na mesma ordem de preferência
  da tarefa 6 até 0 falhas. Depois, o `caber.js` completo: **30 tipos, 0 falhas**.
- [ ] **Passo 4:** `npm test`, lint, `rodar.js --sem-prints`, `festa-real.js`, `leva2-real.js`, `mesa-real.js` e
  `harness.js checar`: 0 falhas.
- [ ] **Passo 5: commit:** `fix(mesa-janelas): roleta inteira e ferramentas cabendo no tamanho padrao`.

---

### Tarefa 8: Boot no app real, passada visual e prints (sessão principal)

- [ ] **Passo 1: boot.** Hook `--require` como em `golive-screenshots-automatizados` (memória): escutar
  `console-message` e `did-fail-load` só na janela de `index.html`, esperar 3 s depois do `did-finish-load` e gravar
  JSON. Rodar na branch e na `origin/main` (worktree destacado). Esperado: nenhum erro novo.
- [ ] **Passo 2: prints do app real** em 1440×900 e 1366×768, nos temas padrão e Papel, montando os estados por
  `window.GoLive.ui` e `mesaView`:
  - Mesa vazia.
  - Mesa com tela, câmera e cinco janelas.
  - Roleta recém-posta.
  - Truco com "Sua vez".
  - "Ver tudo" (conferir que nada fica sob a pílula ou o dock).
  - Menu ⋯ aberto.
  - Trava do líder ativa.
  - Tela cheia.
  - Zoom em 40% (barra só com o título).

  Medir no DOM, por `getBoundingClientRect`, que nenhuma janela de "Ver tudo" cruza a caixa da pílula ou do dock.
  Salvar em `docs/prints/2026-09-27-redesign/`.
- [ ] **Passo 3: teclado.** Tab chega em cada `.mesa-bar-btn`; o `:focus-visible` aparece; Shift+F10 e ⋯ abrem o
  mesmo menu; Esc fecha.
- [ ] **Passo 4:** corrigir o que aparecer. Defeito grande volta para um job terra medium com o print e a medida.

### Tarefa 9: Revisão final (Codex terra high, somente leitura)

- [ ] Prompt: revisar o diff `origin/main...HEAD` contra a spec e este plano. Procurar:
  - controle que ainda cubra conteúdo;
  - `size` que não cabe;
  - `z-index` solto;
  - hex fora de token;
  - `overflow: hidden` escondendo conteúdo;
  - regressão de trava do líder, arrasto, teclado ou segredo (`view` por pessoa não pode vazar pelo `setStatus`:
    o status sai do estado que a pessoa já recebe).

  Pedir as saídas em lista com arquivo:linha e gravidade. A sessão principal confere cada achado antes de corrigir
  (skill receiving-code-review).

### Tarefa 10: Documentação (Codex luna medium)

- [ ] `STATUS.md`: seção do redesign fase 1 (o que mudou, bancadas e números).
- [ ] `docs/glossario.md`: "Sua vez", "barra da janela" e o que mais a interface nova mostrar; rodar
  `node --test src/renderer/glossario.test.js`.
- [ ] Spec: marcar a seção 4.3 com o resultado do `caber` (30/30).
- [ ] Commit: `docs: redesign fase 1 no STATUS, glossario e prints`.

---

## Jobs (quem executa o quê)

Todos com `codex exec -m <modelo> -c model_reasoning_effort=<e> -c service_tier=default -s workspace-write
-C <worktree> -o logs/agentes/<nome>-last.txt - < <prompt.md>`, em background. Os logs ficam em
`logs/agentes/` do repo principal. No máximo dois ao mesmo tempo. Todo prompt começa com:
"implemente direto, sem pedir confirmação; não commite; preserve <lista de arquivos com trabalho não commitado>".
Depois vêm as restrições globais e a tarefa copiada inteira deste plano.

| Job | Tarefas | Modelo | Effort | Em paralelo com |
|---|---|---|---|---|
| J1 | 1 | `gpt-5.6-terra` | medium | — |
| J2 | 2 + 3 | `gpt-5.6-terra` | high | J3 |
| J3 | 4 | `gpt-5.6-terra` | medium | J2 (só mexe em `tools/bancada-janelas/caber.js`) |
| J4 | 5 | `gpt-5.6-terra` | medium | — |
| J5 | 6 | `gpt-5.6-terra` | medium | — |
| J6 | 7 | `gpt-5.6-terra` | medium | — |
| — | 8 | sessão principal (Claude) | — | — |
| J7 | 9 | `gpt-5.6-terra` | high, `-s read-only` | — |
| J8 | 10 | `gpt-5.6-luna` | medium | — |

Observações:
- O J3 depende da página de bancada nova da tarefa 3 (passo 6). O J3 escreve o roteiro contra o contrato da URL
  e do `window.bancada`, e a linha de base (tarefa 4, passo 2) só roda depois do J2 integrado.
- Depois de cada job, a sessão principal faz quatro coisas:
  1. `git status`;
  2. confere que o `-last.txt` existe e lê o fim do `.log` (sem cota, o `codex exec` sai com código 0 ou 1);
  3. roda os comandos do passo de verificação da tarefa;
  4. commita com a mensagem da tarefa, com a linha `Co-Authored-By` da sessão.
- Bancadas precisam de `PLAYWRIGHT_DIR="$(npm root -g)/playwright"` e rodam fora da sandbox do Codex quando ela
  não abrir o Chromium.
- Um job interrompido volta com `codex exec resume <id>`, rodado de dentro do worktree, com
  `-c sandbox_mode="workspace-write"`.

# Chat, aviso de atualização e limpeza da tela cheia — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arrumar o chat (lista e caixa de escrever), trocar o aviso de atualização por uma faixa única no lobby, recolher as reações num botão, e limpar o que vaza ou se amontoa na tela cheia e na tira de miniaturas.

**Architecture:** Tudo no renderer. Sem módulo novo, sem mudança de protocolo, sem tocar em `server/`. As mudanças de comportamento moram em `src/renderer/ui.js` e `src/renderer/app.js`; as de aparência em `src/renderer/style.css`; a marcação em `src/renderer/index.html`. Regras de design que precisam sobreviver a passadas futuras viram teste em `src/renderer/css-rules.test.js`, que lê o CSS como texto — é o padrão que o projeto já usa.

**Tech Stack:** Electron 32, JavaScript sem build nem framework, CSS puro com tokens em `:root`, `node --test` (Node ≥18).

**Spec:** `docs/superpowers/specs/2026-09-15-chat-atualizacao-e-tela-cheia-design.md` (frentes 1 a 7). A frente 8 tem plano próprio em `docs/superpowers/plans/2026-09-15-tema-personalizado-compartilhavel.md`.

## Global Constraints

- **Comando de teste:** `npm test` (= `node --test`). Linha de base antes de começar: **733 testes passando, 0 falhas**. Nenhuma tarefa pode reduzir esse número.
- **Lint:** `npm run lint` (eslint) precisa passar ao fim de cada tarefa.
- **Contrato de ids:** todo `id` do `index.html` é usado pelo JS (~130). **Mover pode, renomear não.** Remover só quando o elemento inteiro sai e todas as referências em JS saem junto, na mesma tarefa.
- **O acento é reservado:** `--live` só significa "alguém está ao vivo". Botão de ação usa `--act`. Nunca introduza cor saturada nova para decoração.
- **Tokens semânticos travados:** `--live`, `--warn`, `--danger` e os três `-dim` existem só no `:root` base. Nenhuma regra nova os redefine.
- **Sem `backdrop-filter`** em lugar nenhum — o app disputa GPU com o encoder de vídeo.
- **Piso de 11px** em `font-size`, verificado por teste existente.
- **Cores literais** (`#rrggbb`, `rgba(...)`) só dentro de blocos `:root` — fora deles, use token. Verificado por teste existente.
- **`prefers-reduced-motion`** já é cortado por um bloco global no topo do `style.css` (~linha 224). Animações novas que usem só `opacity`/`transform` são cobertas de graça.
- **Idioma:** todo texto de interface em português do Brasil. `src/main/` nunca tem texto de UI; ele mora no renderer.
- **Commits:** um por tarefa, mensagem em português, prefixo `fix:` ou `feat:`. Não fazer push.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade nesta passada |
|---|---|
| `src/renderer/index.html` | marcação: botão de enviar, dica do Shift+Enter, botão "novas mensagens", faixa de atualização; remoção do `#update-banner` |
| `src/renderer/style.css` | alinhamento do campo, ritmo da lista, faixa de atualização, barra de reação recolhida, ocultação da casca em tela cheia, toast à esquerda, limpeza da tira |
| `src/renderer/ui.js` | auto-resize, envio, autoscroll condicional, separador de dia, hora nas agrupadas, abre/fecha da reação, tamanho do emoji, fechar painel de emoji ao entrar em tela cheia |
| `src/renderer/app.js` | `renderUpdateBar` substituindo `showUpdateBanner` + `showUpdateAvailable`/`hideUpdateAvailable` |
| `src/renderer/css-rules.test.js` | três regras novas: overlay do tile some no ocioso, casca escondida em tela cheia, banner do canto não voltou |

---

### Task 1: Alinhamento do campo do chat e auto-resize

Resolve o pedido literal ("o texto não está centralizado") e a regra morta do `max-height`.

**Files:**
- Modify: `src/renderer/style.css` (bloco `.chat-compose`, ~linhas 994-1007)
- Modify: `src/renderer/ui.js` (handler de `input`, ~linha 2433; `sendCurrentInput`, ~linha 2403)
- Test: `src/renderer/css-rules.test.js`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: função `autoResizeInput()` em `ui.js`, chamada por `sendCurrentInput` e pelo handler de `input`. A Task 2 e a Task 3 a chamam também.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente em `src/renderer/css-rules.test.js`, depois do teste `'estrutura moderna mantem dock no fluxo e camadas por tokens'`:

```js
test('o campo do chat tem a mesma altura dos botoes da caixa', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules = declarations(css).filter(({ stack }) => stack.at(-1) === '.chat-compose textarea');
  const byProp = Object.fromEntries(rules.map(({ property, value }) => [property, value]));
  // Os .chat-compose-btn tem 28px. Coladas pela base (align-items: flex-end),
  // duas caixas de MESMA altura centralizam o texto contra os icones; com
  // alturas diferentes o placeholder fica ~3px abaixo -- o bug relatado.
  assert.equal(byProp['min-height'], '28px', 'o textarea precisa casar com os 28px do botao');
  assert.equal(byProp.padding, '5px 0', '17.5px de linha + 10 de padding = 27.5 ~ 28');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -A5 "mesma altura dos botoes"`
Expected: FAIL — `min-height` vem `undefined`.

- [ ] **Step 3: Corrigir o CSS**

Em `src/renderer/style.css`, substitua o bloco `.chat-compose textarea`:

```css
.chat-compose textarea {
  flex: 1; resize: none; background: transparent; border: none; color: var(--tx);
  font-family: inherit; font-size: 12.5px; line-height: 1.4; max-height: 88px;
  /* Casa com os 28px do .chat-compose-btn: 17,5px de linha + 5+5 de padding.
     A caixa alinha pela base (align-items: flex-end) pra crescer pra cima --
     com alturas diferentes o texto ficava ~3px abaixo do centro dos icones. */
  padding: 5px 0; min-height: 28px;
  overflow-y: auto;
}
```

E acrescente, logo abaixo de `.chat-compose textarea:focus`:

```css
/* A pilula da sala (--r-full) vira capsula quando a caixa cresce e os
   cantos comem o texto. Passa de uma linha, o raio cai. */
.chat-compose.is-multiline { border-radius: var(--r-md); }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test 2>&1 | grep -A3 "mesma altura dos botoes"`
Expected: PASS

- [ ] **Step 5: Ligar o auto-resize**

Em `src/renderer/ui.js`, **acima** de `sendCurrentInput` (~linha 2403), acrescente:

```js
  /** O campo nasce com rows="1" e nada ajustava a altura: o `max-height: 88px`
   * do CSS era regra morta e uma mensagem longa virava uma fresta que rolava
   * por dentro. Zerar pra `auto` antes de ler `scrollHeight` e o que permite
   * a caixa ENCOLHER de volta ao apagar texto -- sem isso ela so cresce. */
  function autoResizeInput() {
    chatInputEl.style.height = 'auto';
    chatInputEl.style.height = `${chatInputEl.scrollHeight}px`;
    chatComposeEl.classList.toggle('is-multiline', chatInputEl.scrollHeight > 30);
  }
```

Dentro de `sendCurrentInput`, depois de `chatInputEl.value = '';`, acrescente:

```js
    autoResizeInput();
```

E no handler de `input` (~linha 2433), como primeira linha do corpo:

```js
      autoResizeInput();
```

- [ ] **Step 6: Conferir lint e suíte**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo; `pass 734`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/style.css src/renderer/ui.js src/renderer/css-rules.test.js
git commit -m "fix(chat): centraliza o texto do campo e faz a caixa crescer

O textarea media ~21px contra 28px dos botoes: colados pela base, o
placeholder ficava ~3px abaixo do centro dos icones. Junto, liga o
auto-resize que faltava -- o max-height: 88px do CSS era regra morta,
porque nada ajustava a altura de um campo rows=1."
```

---

### Task 2: Botão de enviar, contador fora do fluxo e dica do Shift+Enter

**Files:**
- Modify: `src/renderer/index.html:258-268` (bloco `#chat-compose`)
- Modify: `src/renderer/style.css` (`.chat-input-count`, ~linha 1006; `.chat-compose-btn`, ~linha 2464)
- Modify: `src/renderer/ui.js` (`sendCurrentInput` e o handler de `input`)

**Interfaces:**
- Consumes: `autoResizeInput()` da Task 1.
- Produces: `syncComposeState()` em `ui.js` — liga/desliga `#btn-chat-send` a partir de `chatInputEl.value` e de `pendingAttachment`. A Task 3 não depende dela.

- [ ] **Step 1: Marcação**

Em `src/renderer/index.html`, dentro do `<form id="chat-compose">`, **depois** do `<button id="btn-chat-emoji">` e **antes** do `<input id="chat-file">`, acrescente:

```html
        <button id="btn-chat-send" class="chat-compose-btn chat-send-btn" type="button" title="Enviar mensagem" aria-label="Enviar mensagem" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg>
        </button>
```

E troque a linha do `<textarea>` por (só acrescenta `aria-describedby`):

```html
        <textarea id="chat-input" rows="1" placeholder="Escreva pra sala…" maxlength="500" aria-describedby="chat-input-hint"></textarea>
        <span id="chat-input-hint" class="visually-hidden">Enter envia, Shift+Enter quebra linha.</span>
```

- [ ] **Step 2: CSS do botão e do contador**

Em `src/renderer/style.css`, substitua a regra `.chat-input-count` (~linha 1006):

```css
/* Fora do fluxo: como item flex ele roubava largura do textarea ao
   aparecer, e a caixa inteira pulava enquanto a pessoa digitava. */
.chat-input-count {
  position: absolute; right: 12px; bottom: calc(100% + 4px);
  font-size: 11px; color: var(--tx3);
}
.chat-input-count.near-limit { color: var(--warn); }
```

E acrescente `position: relative;` ao bloco `.chat-compose` (a âncora do contador). Depois, junto de `.chat-compose-btn:hover` (~linha 2474):

```css
/* Apagado ate haver o que mandar: um botao de enviar sempre aceso promete
   uma acao que nao acontece. */
.chat-send-btn { color: var(--tx3); }
.chat-send-btn:not(:disabled) { color: var(--act); }
.chat-send-btn:disabled { cursor: default; }
.chat-send-btn:not(:disabled):hover { background: var(--s3); }
```

- [ ] **Step 3: Ligar o botão em `ui.js`**

Acrescente, logo abaixo de `autoResizeInput`:

```js
  /** O botao de enviar so acende quando ha o que mandar -- texto aparado ou
   * anexo. Mesma condicao que `sendCurrentInput` ja usa pra decidir se sai
   * alguma coisa, pra as duas nunca discordarem. */
  function syncComposeState() {
    const temTexto = chatInputEl.value.trim().length > 0;
    $('btn-chat-send').disabled = !temTexto && !pendingAttachment;
  }
```

No handler de `input` (~linha 2433), substitua o corpo inteiro por:

```js
    chatInputEl.addEventListener('input', () => {
      autoResizeInput();
      syncComposeState();
      const len = chatInputEl.value.length;
      chatCountEl.textContent = `${len}/500`;
      chatCountEl.classList.toggle('hidden', len < 450);
      chatCountEl.classList.toggle('near-limit', len >= 500);
    });
```

Dentro de `render(...)`, junto dos outros listeners, acrescente:

```js
    $('btn-chat-send').addEventListener('click', sendCurrentInput);
```

Em `sendCurrentInput`, depois de `autoResizeInput();`, acrescente `syncComposeState();`. Em `setAttachment` e `clearAttachment`, acrescente `syncComposeState();` como última linha — é o que faz o botão acender quando só há imagem.

- [ ] **Step 4: Aviso ao chegar no limite**

O `maxlength="500"` corta calado ao colar. O aviso é o próprio contador virando `--warn`, que o Step 3 já liga (`near-limit` em `len >= 500`) — e ele fica logo acima do campo, exatamente onde a pessoa está olhando.

Nada a escrever aqui além do que o Step 3 já fez. **Não** acrescente um toast: `showToast` mora em `app.js`, não em `ui.js`, e puxar uma dependência nova entre os dois módulos por um aviso deste tamanho não se paga.

Confirme que o Step 3 ficou certo:

```bash
grep -n "near-limit" src/renderer/ui.js src/renderer/style.css
```

Expected: uma linha em cada arquivo.

- [ ] **Step 5: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual (`npm start`): entrar numa sala, o botão de enviar nasce apagado; digitar acende; enviar apaga de novo; anexar imagem sem texto acende; digitar 460 caracteres mostra o contador **sem** a caixa pular.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/ui.js
git commit -m "feat(chat): botao de enviar, contador fora do fluxo e dica do Shift+Enter

Mandar mensagem so tinha um caminho (Enter) e nenhuma afordancia. O
contador era item flex: ao aparecer roubava largura do textarea e a
caixa pulava no meio da digitacao."
```

---

### Task 3: Autoscroll que respeita quem está lendo

**Files:**
- Modify: `src/renderer/ui.js` (`appendEntry`, ~linha 2351; `setHistory`, ~linha 2363; `render`)
- Modify: `src/renderer/index.html` (botão novo dentro de `#chat-panel`)
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: nada.
- Produces: `estaNoFim()` e `descerParaOFim()` em `ui.js`. A Task 4 chama `descerParaOFim()` de dentro de `setHistory`.

- [ ] **Step 1: Marcação do botão**

Em `src/renderer/index.html`, dentro de `<div id="chat-panel">`, logo **depois** de `<div id="chat-messages">`:

```html
      <button id="chat-jump-new" class="chat-jump-new hidden" type="button">↓ Novas mensagens</button>
```

- [ ] **Step 2: CSS**

Acrescente ao `style.css`, junto do bloco `/* ---- Chat ---- */`:

```css
.chat-jump-new {
  position: absolute; left: 50%; bottom: 68px; transform: translateX(-50%);
  z-index: 2; min-height: 0; padding: 5px 12px;
  border: 1px solid var(--line2); border-radius: var(--r-full);
  background: var(--s3); color: var(--tx); font-size: 11.5px;
  box-shadow: var(--shadow-2);
}
.chat-jump-new:hover { background: var(--s4); }
```

E acrescente `position: relative;` ao bloco `.chat-section` (a âncora do botão).

- [ ] **Step 3: Trocar o autoscroll**

Em `src/renderer/ui.js`, substitua `appendEntry` inteira:

```js
  // Tolerancia pra "ja estava no fim". Zero seria frágil: subpixel de
  // zoom e a altura fracionaria da ultima linha fazem scrollTop quase
  // nunca bater exatamente no fundo.
  const FIM_TOLERANCIA_PX = 48;

  function estaNoFim() {
    const el = chatMessagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= FIM_TOLERANCIA_PX;
  }

  function descerParaOFim() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    $('chat-jump-new').classList.add('hidden');
  }

  function appendEntry(entry) {
    // Decide ANTES de inserir: depois da insercao a lista ja cresceu e
    // "estava no fim" viraria sempre falso.
    const seguir = estaNoFim();
    if (entry.system) appendSystemLine(entry);
    else appendMessage(entry);
    if (seguir) descerParaOFim();
    else $('chat-jump-new').classList.remove('hidden');
  }
```

Em `setHistory`, substitua o corpo do laço final por:

```js
    for (const entry of entries || []) {
      if (entry.system) appendSystemLine(entry);
      else appendMessage(entry);
    }
    descerParaOFim();
```

(Montagem do zero sempre desce — ali não há ninguém lendo para atrapalhar.)

Dentro de `render(...)`:

```js
    $('chat-jump-new').addEventListener('click', descerParaOFim);
    chatMessagesEl.addEventListener('scroll', () => {
      if (estaNoFim()) $('chat-jump-new').classList.add('hidden');
    });
```

- [ ] **Step 4: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: com histórico longo, rolar para o meio e pedir a um segundo cliente que mande mensagem — a lista **não** pode pular, e o botão "↓ Novas mensagens" precisa aparecer. Clicar desce e some.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/ui.js
git commit -m "fix(chat): nao arrancar de volta pro fim quem esta lendo historico

appendEntry descia a lista em TODA entrada. Agora so desce se a pessoa
ja estava no fim; se nao estava, oferece 'Novas mensagens'."
```

---

### Task 4: Ritmo, hora nas agrupadas, separador de dia e estado vazio

**Files:**
- Modify: `src/renderer/ui.js` (`appendMessage`, `setHistory`, `formatTime`)
- Modify: `src/renderer/style.css` (bloco do chat)

**Interfaces:**
- Consumes: `descerParaOFim()` da Task 3.
- Produces: nada que outra tarefa use.

- [ ] **Step 1: Separador de dia e hora agrupada em `ui.js`**

Junto de `formatTime` (~linha 2282), acrescente:

```js
  let lastChatDayKey = null;

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** "Hoje" / "Ontem" / "14 de setembro". Sem ano: o historico de uma sala
   * nao atravessa anos, e escrever 2026 em toda linha so faz ruido. */
  function dayLabel(ts) {
    const d = new Date(ts);
    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 86400000);
    if (dayKey(ts) === dayKey(hoje.getTime())) return 'Hoje';
    if (dayKey(ts) === dayKey(ontem.getTime())) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }

  function appendDaySeparatorIfNeeded(ts) {
    const key = dayKey(ts);
    if (key === lastChatDayKey) return;
    lastChatDayKey = key;
    const div = document.createElement('div');
    div.className = 'chat-day';
    div.textContent = dayLabel(ts);
    chatMessagesEl.appendChild(div);
  }
```

Em `appendEntry` (Task 3), como primeira linha **depois** de `const seguir = estaNoFim();`:

```js
    if (entry.ts) appendDaySeparatorIfNeeded(entry.ts);
```

Em `setHistory`, junto de `lastChatAuthorId = null;`, acrescente `lastChatDayKey = null;` — e o laço passa a chamar `appendDaySeparatorIfNeeded(entry.ts)` antes de cada entrada.

Em `appendMessage`, substitua a linha do `chat-avatar-slot` por:

```js
      <span class="chat-avatar-slot">${grouped
        ? `<span class="chat-grouped-time">${formatTime(entry.ts)}</span>`
        : `<span class="chat-avatar" style="background:${avatarColorFor(entry.from)}">${avatarInnerHtml(entry.from, entry.name, entry.avatar || null)}</span>`}</span>
```

- [ ] **Step 2: CSS**

Substitua a regra `.chat-line` e acrescente as novas:

```css
.chat-line { display: flex; gap: 9px; padding: 3px var(--s-2); }
/* Bloco de autor novo respira; linha do mesmo autor cola. O gap: 2px
   uniforme da lista nao distinguia os dois casos. */
.chat-line:not(.grouped) { margin-top: 6px; }
.chat-line:first-child { margin-top: 0; }
.chat-line.grouped { padding-top: 0; }

/* A calha do avatar (28px) fica vazia nas agrupadas -- e onde a hora cabe
   sem custo de layout nenhum. So no hover: em toda linha viraria ruido. */
.chat-grouped-time {
  display: block; width: 28px; text-align: right;
  font-size: 11px; line-height: 1.5; color: var(--tx3);
  opacity: 0; transition: opacity var(--dur-fast) var(--ease-in-out);
}
.chat-line:hover .chat-grouped-time,
.chat-line:focus-within .chat-grouped-time { opacity: 1; }

.chat-day {
  display: flex; align-items: center; gap: var(--s-2);
  margin: var(--s-2) var(--s-2) 4px;
  font-size: 11px; color: var(--tx3);
}
.chat-day::before, .chat-day::after {
  content: ''; flex: 1; height: 1px; background: var(--line);
}

.chat-messages:empty::before {
  content: 'Ninguém falou ainda.';
  margin: auto; font-size: 12px; color: var(--tx3);
}
```

Nota: `.chat-messages` já é `display: flex; flex-direction: column`, então `margin: auto` centraliza o estado vazio nos dois eixos.

- [ ] **Step 3: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`. O teste `'cores literais ficam restritas aos tokens'` precisa continuar passando — nenhuma cor literal foi acrescentada.

Conferência manual: entrar numa sala vazia e ver "Ninguém falou ainda."; mandar duas mensagens seguidas e passar o mouse na segunda para a hora aparecer na calha.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/style.css src/renderer/ui.js
git commit -m "feat(chat): ritmo por bloco, hora nas agrupadas, separador de dia e estado vazio"
```

---

### Task 5: Faixa de atualização no lobby (marcação e estilo)

**Files:**
- Modify: `src/renderer/index.html` (remove `#update-banner` das linhas 31-37; remove `#btn-update-available` do `.user-panel`, linhas 84-90; cria `#update-bar` em `.lobby-main`)
- Modify: `src/renderer/style.css` (remove o bloco `.update-banner`/`.update-progress`; cria `.update-bar`; remove `.update-available-btn`/`.update-dot`)

**Interfaces:**
- Consumes: nada.
- Produces: os ids `#update-bar`, `#update-bar-title`, `#update-bar-sub`, `#update-bar-progress`, `#update-bar-fill` e `#btn-update-available` (mantido). A Task 6 escreve neles.

- [ ] **Step 1: Escrever o teste que falha**

Em `src/renderer/css-rules.test.js`:

```js
test('o banner de atualizacao do canto nao voltou', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  // Um so lugar pede pra atualizar: a faixa do lobby. O banner do canto
  // inferior direito era justamente o que ninguem via (spec 2026-09-15,
  // decisao 1).
  assert.ok(!css.includes('.update-banner'), 'o CSS do banner do canto tem de sair');
  assert.ok(!html.includes('update-banner'), 'a marcacao do banner do canto tem de sair');
  assert.match(html, /id="update-bar"/, 'a faixa do lobby tem de existir');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -A5 "banner de atualizacao do canto"`
Expected: FAIL — `.update-banner` ainda está no CSS.

- [ ] **Step 3: Remover o banner e o botão pequeno**

Em `src/renderer/index.html`, apague o comentário e o bloco das linhas 31-37 (`<div id="update-banner">` inteiro) e o `<button id="btn-update-available">` com seu comentário (linhas 84-90).

- [ ] **Step 4: Criar a faixa**

Em `src/renderer/index.html`, como **primeiro filho** de `<main class="lobby-main">`, antes de `<section class="lobby-rooms">`:

```html
    <!-- Um lugar so pede pra atualizar (spec 2026-09-15, decisao 1). Mora
         DENTRO do #lobby-view: "nao aparece na sala" sai de graca da troca
         de view que ja existe, sem logica nova. -->
    <section id="update-bar" class="update-bar hidden" role="status">
      <svg class="update-bar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 17l4 4 4-4M12 12v9"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/></svg>
      <div class="update-bar-text">
        <strong id="update-bar-title"></strong>
        <span id="update-bar-sub"></span>
      </div>
      <div id="update-bar-progress" class="update-bar-progress hidden">
        <div id="update-bar-fill" class="update-bar-fill"></div>
      </div>
      <button id="btn-update-available" class="primary update-bar-action" type="button">Atualizar agora</button>
    </section>
```

- [ ] **Step 5: CSS**

Em `src/renderer/style.css`, apague os blocos `.update-banner, .toast { ... }` **só na parte do banner** (o `.toast` continua — extraia as regras compartilhadas para `.toast` sozinho), `.update-banner { ... }`, `.update-progress`, `.update-progress-fill`, `.update-progress-fill.indeterminate`, `@keyframes update-progress-slide`, `.update-available-btn`, `.update-dot`, `@keyframes update-dot-pulse` e a regra `.user-panel .update-available-btn`. Deixe o `@starting-style` só com `.toast`.

Acrescente, no fim do arquivo, com cabeçalho:

```css
/* ============ Faixa de atualizacao do lobby (2026-09-15) ============
 * Substitui o botao de 32px do painel de usuario E o banner do canto
 * inferior direito: tres lugares diziam a mesma coisa e o do canto era o
 * que ninguem via. Cor de acao em --act, nunca --live. */
.update-bar {
  display: flex; align-items: center; gap: var(--s-2);
  margin-bottom: var(--s-3); padding: var(--s-2) var(--s-3);
  border: 1px solid var(--line2); border-radius: var(--r-md);
  background: var(--s2);
}
.update-bar-icon { width: 20px; height: 20px; flex: none; color: var(--tx2); }
.update-bar-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; margin-right: auto; }
.update-bar-text strong { font-size: 13px; color: var(--tx); }
.update-bar-text span { font-size: 12px; color: var(--tx2); }
.update-bar-progress {
  width: 140px; height: 4px; flex: none;
  border-radius: var(--r-full); background: var(--s3); overflow: hidden;
}
.update-bar-fill {
  height: 100%; width: 0%;
  /* A marca nao e sinal: barra em cor neutra. */
  background: var(--tx); border-radius: inherit;
  transition: width 120ms linear;
}
.update-bar-action { flex: none; }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test 2>&1 | grep -A3 "banner de atualizacao do canto"`
Expected: PASS

- [ ] **Step 7: Commit**

Não commitar ainda — `app.js` ainda referencia os ids removidos e o app quebra no boot. A Task 6 fecha e commita as duas juntas.

---

### Task 6: `app.js` escreve na faixa

**Files:**
- Modify: `src/renderer/app.js:866-935` (bloco de atualização)

**Interfaces:**
- Consumes: os ids criados na Task 5.
- Produces: nada.

- [ ] **Step 1: Substituir as três funções por uma**

Em `src/renderer/app.js`, apague `showUpdateBanner`, `showUpdateAvailable` e `hideUpdateAvailable`, e ponha no lugar:

```js
  // Um lugar so, trocando de estado (spec 2026-09-15, decisao 1). O banner
  // do canto inferior direito saiu: dentro da sala nada de atualizacao
  // aparece (decisao 3), e a faixa mora no #lobby-view, entao isso vale de
  // graca -- a view inteira some ao entrar numa sala.
  const updateBarEl = $('update-bar');

  function renderUpdateBar(estado, { version = null, progress = null } = {}) {
    if (!estado) {
      updateBarEl.classList.add('hidden');
      return;
    }
    const v = version || 'nova';
    const textos = {
      disponivel: [`Atualização ${v} disponível`, 'Reinicia rápido e volta sozinho.', 'Atualizar agora'],
      baixando:   ['Baixando atualização…', `${v} — ${progress ?? 0}%`, 'Atualizar agora'],
      pronta:     ['Atualização pronta', `${v} — instala ao reiniciar.`, 'Reiniciar e instalar'],
    };
    const [titulo, sub, rotulo] = textos[estado];
    $('update-bar-title').textContent = titulo;
    $('update-bar-sub').textContent = sub;
    btnUpdateAvailable.textContent = rotulo;
    btnUpdateAvailable.disabled = estado === 'baixando';
    $('update-bar-progress').classList.toggle('hidden', estado !== 'baixando');
    if (estado === 'baixando') {
      $('update-bar-fill').style.width = `${Math.max(0, Math.min(100, progress ?? 0))}%`;
    }
    updateBarEl.classList.remove('hidden');
  }
```

- [ ] **Step 2: Trocar o `switch`**

No `window.golive.onUpdateStatus?.((payload) => {`, substitua os `case` afetados:

```js
      case 'available':
        spinCheck(false);
        renderUpdateBar('disponivel', { version });
        if (manual) showToast(`Atualização ${version || 'nova'} disponível.`);
        break;
      case 'downloading':
        renderUpdateBar('baixando', { version, progress: progress ?? 0 });
        break;
      case 'downloaded':
      case 'installing':
        renderUpdateBar('pronta', { version });
        break;
      case 'not-available':
        spinCheck(false);
        renderUpdateBar(null);
        if (manual) showToast(`Você já está na versão mais recente${appVersion ? ` (${appVersion})` : ''}.`);
        break;
```

Os `case 'checking'`, `'error'` e `'busy'` não mudam.

- [ ] **Step 3: Conferir que nenhum id morto sobrou**

Run: `grep -n "update-banner\|update-progress\|showUpdateBanner\|showUpdateAvailable\|hideUpdateAvailable\|update-dot" src/renderer/app.js src/renderer/index.html src/renderer/style.css`
Expected: **nenhuma saída.** Qualquer linha aqui é uma referência órfã que quebra o app no boot.

- [ ] **Step 4: Conferir suíte e app**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: `npm start`, abrir o console do renderer (Ctrl+Shift+I) e confirmar **zero** erro de `null` no boot. Como em dev a checagem sempre responde "não há atualização", force os estados no console:

```js
// no console do renderer
document.getElementById('update-bar').classList.remove('hidden');
```

e confira os três estados chamando o handler à mão se quiser ir além.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.html src/renderer/style.css src/renderer/app.js src/renderer/css-rules.test.js
git commit -m "feat(update): uma faixa no lobby no lugar do botao pequeno e do banner do canto

Havia tres lugares dizendo 'ha atualizacao': um botao de 32px espremido
no painel de usuario, um toast, e um banner no canto inferior direito
que ninguem via. Agora e uma faixa so, que troca de estado no lugar.
Dentro da sala continua sem nada: a faixa mora no #lobby-view."
```

---

### Task 7: Reações recolhidas num botão

**Files:**
- Modify: `src/renderer/ui.js` (`showTile` ~linha 646, `wireTileReactions` ~linha 1092)
- Modify: `src/renderer/style.css` (`.tile-react-bar`, ~linha 2842)

**Interfaces:**
- Consumes: nada.
- Produces: a classe `.is-open` em `.tile-react-bar`. A Task 9 escreve a regra de ociosidade em cima de `.tile-react-bar` (o elemento inteiro), não de `.is-open`.

- [ ] **Step 1: Marcação do tile**

Em `src/renderer/ui.js`, dentro de `tile.innerHTML`, substitua a linha da `tile-react-bar`:

```js
        <div class="tile-react-bar" role="group" aria-label="Reagir a esta tela">
          <button class="tile-react-toggle" type="button" aria-expanded="false" aria-label="Reagir" title="Reagir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </button>
          <span class="tile-react-list" inert>${reactionBarButtonsHtml()}</span>
        </div>
```

- [ ] **Step 2: Abrir e fechar em `wireTileReactions`**

Substitua `wireTileReactions` inteira:

```js
  /** Amarra a barra de reacao de UM tile, uma vez, na criacao dele -- sem
   * gate de permissao nenhum (reacao no tile e sempre livre, ver spec de
   * 2026-09-12, secao 2).
   *
   * A barra nasce FECHADA: seis emojis parados sobre o video sao cromo
   * demais, ainda mais na tira de miniaturas. Nao fecha no primeiro emoji
   * de proposito -- o limitador de rajada de reactions.js existe porque
   * mandar varios seguidos e o uso normal. */
  function wireTileReactions(tile, tileId) {
    const bar = tile.querySelector('.tile-react-bar');
    if (!bar) return;
    const toggle = bar.querySelector('.tile-react-toggle');
    const list = bar.querySelector('.tile-react-list');
    let fecharTimer = null;

    function fechar() {
      clearTimeout(fecharTimer);
      fecharTimer = null;
      bar.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      list.inert = true;
    }
    function adiarFechamento() {
      clearTimeout(fecharTimer);
      fecharTimer = setTimeout(fechar, 3000);
    }
    function abrir() {
      bar.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      list.inert = false;
      adiarFechamento();
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (bar.classList.contains('is-open')) fechar();
      else abrir();
    });
    list.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('.tile-react-btn');
      if (!btn) return;
      emitReactionOp(tileId, btn.dataset.emoji);
      adiarFechamento();
    });
    bar.addEventListener('mouseenter', () => { if (bar.classList.contains('is-open')) clearTimeout(fecharTimer); });
    bar.addEventListener('mouseleave', () => { if (bar.classList.contains('is-open')) adiarFechamento(); });
    document.addEventListener('click', (e) => { if (!bar.contains(e.target)) fechar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

    // Mesma razao do annot-bar: a barra fica por cima do video, um clique
    // nela nao pode disparar o duplo clique do fullscreen nem o arrasto do PiP.
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('dblclick', (e) => e.stopPropagation());
  }
```

- [ ] **Step 3: CSS**

Substitua o bloco `.tile-react-bar` e acrescente:

```css
.tile-react-bar {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--line2);
  border-radius: var(--r-full);
  background: var(--scrim-tint-2);
  box-shadow: var(--shadow-2);
}
.tile-react-toggle {
  width: 28px; height: 28px; min-height: 0; flex: none; padding: 0;
  display: grid; place-items: center;
  border: none; border-radius: var(--r-full);
  background: transparent; color: var(--tx);
}
.tile-react-toggle svg { width: 17px; height: 17px; }
.tile-react-toggle:hover { background: var(--s3); }
/* Fechada nao ocupa largura nenhuma. `transform`/`opacity` e nao `width`:
   animar largura forca layout a cada quadro, na mesma GPU do encoder. */
.tile-react-list {
  display: flex; align-items: center; gap: 2px;
  max-width: 0; opacity: 0; overflow: hidden;
  transform: translateX(8px);
  transition: max-width var(--dur-fast) var(--ease-in-out),
              opacity var(--dur-fast) var(--ease-in-out),
              transform var(--dur-fast) var(--ease-in-out);
}
.tile-react-bar.is-open .tile-react-list {
  max-width: 220px; opacity: 1; transform: translateX(0);
}
```

- [ ] **Step 4: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`. `reactions.test.js` não muda.

Conferência manual: com dois clientes, abrir a barra, mandar três emojis seguidos (não pode fechar entre eles), esperar 3s parado (fecha), abrir e apertar Escape (fecha). Com Tab, os seis emojis **não** podem receber foco enquanto fechada.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/style.css src/renderer/ui.js
git commit -m "feat(reacoes): barra recolhida num botao

Seis emojis parados sobre o video eram cromo demais. Nao fecha no
primeiro emoji: o limitador de rajada existe porque mandar varios
seguidos e o uso normal."
```

---

### Task 8: Reações proporcionais ao tile

**Files:**
- Modify: `src/renderer/ui.js` (`spawnReactionPop`, ~linha 1112)
- Modify: `src/renderer/style.css` (`.tile-react-pop`, ~linha 2883)

- [ ] **Step 1: Medir o tile**

Em `spawnReactionPop`, depois da linha `el.style.left = ...`, acrescente:

```js
    // 5vw era a largura da JANELA, nao a do tile: numa grade de seis o
    // emoji saia desproporcional, e na tira ficava maior que a miniatura
    // inteira. O clamp() do CSS fica de rede pra quando a medida vier 0
    // (tile ainda nao medido). Redimensionar a janela no meio da animacao
    // nao reajusta -- irrelevante: o emoji vive 1,4s.
    const larguraTile = tile.clientWidth || 0;
    if (larguraTile) {
      el.style.fontSize = `${Math.round(Math.min(72, Math.max(14, larguraTile * 0.12)))}px`;
    }
```

- [ ] **Step 2: Comentar a rede de segurança no CSS**

Em `.tile-react-pop`, troque a linha do `font-size` por:

```css
  /* Rede de seguranca: o tamanho de verdade vem de spawnReactionPop, que
     mede o tile. Isto so vale enquanto a medida nao existe. */
  font-size: clamp(14px, 5vw, 48px);
```

- [ ] **Step 3: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: reagir com um tile só na grade (emoji grande), com seis tiles (emoji pequeno), e com o tile em tela cheia (emoji no teto de 72px).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/style.css src/renderer/ui.js
git commit -m "fix(reacoes): dimensionar o emoji pelo tile, nao pela janela"
```

---

### Task 9: Tela cheia — esconder a casca e fazer a reação sumir no ocioso

**Files:**
- Modify: `src/renderer/style.css`
- Modify: `src/renderer/ui.js` (`toggleTileFullscreen`, ~linha 1527)
- Test: `src/renderer/css-rules.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
test('a casca da sala fica escondida com um tile em tela cheia', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  // visibility (e nao display): mata pintura e clique de TODOS os
  // descendentes, qualquer que seja o z-index deles, e preserva o layout --
  // tirar o dock do fluxo faria a grade atras recalcular tamanho de tile
  // pra um layout que ninguem esta vendo.
  for (const alvo of ['.stage-header', '.control-bar', '.room-side']) {
    const re = new RegExp(`body:has\\(\\.tile\\.fullscreen\\)[^{]*${alvo.replace('.', '\\.')}[^{]*\\{[^}]*visibility:\\s*hidden`, 's');
    assert.match(css, re, `${alvo} precisa ser escondido em tela cheia`);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -A5 "casca da sala"`
Expected: FAIL nos três alvos.

- [ ] **Step 3: CSS**

Junto de `body:has(.tile.fullscreen) .titlebar` (~linha 2710):

```css
/* O tile em tela cheia tem z-index 50 -- empatado com --z-popover (os
   rotulos do dock, que vem depois no DOM e ganham o empate) e abaixo do
   painel de emoji (70) e do toast (1001). Subir o tile so moveria a fila:
   o proximo elemento de camada alta voltaria a vazar. A casca some de
   verdade. Ver spec 2026-09-15, decisoes 4 e 5. */
body:has(.tile.fullscreen) .stage-header,
body:has(.tile.fullscreen) .control-bar,
body:has(.tile.fullscreen) .room-side { visibility: hidden; }

/* A barra de reacao nasceu sem regra de ociosidade. O BOTAO some (e cromo);
   os emojis que chegam (.tile-react-pops) ficam, porque sao conteudo --
   uma reacao que chega com o mouse parado precisa aparecer. */
.tile.fullscreen.idle .tile-react-bar { opacity: 0; pointer-events: none; transition: opacity 0.25s; }
```

- [ ] **Step 4: Fechar o painel de emoji ao entrar**

Em `ui.js`, dentro de `toggleTileFullscreen`, logo depois de a classe `fullscreen` ser adicionada, acrescente:

```js
    // O painel de emoji e position: fixed no body (z-index 70), fora do
    // alcance do seletor que esconde a casca -- ele vazaria por cima do
    // video se ficasse aberto. `closeEmojiPanel` ja existe (ui.js, ~2503)
    // e tambem devolve o aria-expanded do botao; nao mexa na classe a mao.
    closeEmojiPanel();
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test 2>&1 | grep -A3 "casca da sala"`
Expected: PASS

- [ ] **Step 6: Conferência manual — é o pedido literal**

`npm start`, entrar numa sala com alguém transmitindo, abrir a tela cheia. **Nenhum** texto do dock pode aparecer, em especial "Compartilhar tela". Parar o mouse 3s: some tudo menos vídeo, miniaturas PiP e véu de pausa. Mexer: volta.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/style.css src/renderer/ui.js src/renderer/css-rules.test.js
git commit -m "fix(tela cheia): esconder a casca da sala em vez de disputar z-index

O rotulo 'Compartilhar tela' aparecia por cima do video: a sala inteira
continuava desenhada embaixo e o tile tem z-index 50, empatado com os
rotulos do dock. Junto, a barra de reacao passa a sumir no ocioso."
```

---

### Task 10: Notificações no canto inferior esquerdo dentro da sala

**Files:**
- Modify: `src/renderer/style.css` (`.toast`)

- [ ] **Step 1: CSS**

Junto das regras do `.toast`:

```css
/* Dentro da sala o canto inferior DIREITO e a caixa de escrever do chat --
   "Transmissao pausada" e "Transmissao retomada" caiam em cima dela. Na
   tela cheia a esquerda tambem e o canto mais vazio: o dock e central, o
   selo de audiencia fica em cima a esquerda e os botoes em cima a direita.
   No lobby continua a direita. */
body:has(#room-view:not(.hidden)) .toast { left: 16px; right: auto; }
```

- [ ] **Step 2: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: compartilhar a tela, pausar (Ctrl+Alt+P) e retomar — o aviso precisa nascer à esquerda, longe do chat. Sair da sala e forçar um toast no lobby (busca manual de atualização) — precisa nascer à direita.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "fix(sala): avisos no canto inferior esquerdo, fora da caixa do chat"
```

---

### Task 11: Tira de miniaturas limpa

**Files:**
- Modify: `src/renderer/style.css` (junto do bloco `.grid-strip`, ~linha 1195)

- [ ] **Step 1: CSS**

```css
/* Miniatura da tira tem 104-148px de altura: quatro overlays disputam a
   area de um selo so. Fica o rotulo do nome e o botao de tela cheia.
   `:not(.fullscreen)` e obrigatorio -- a camera da tira TAMBEM vira tela
   cheia, e ao maximizar tudo isto volta, que e exatamente o pedido.
   `display` e nao `visibility`: nao ha layout a preservar, sao overlays
   absolutos sobre o video. O que sai e o BOTAO de reagir, nao a reacao:
   .tile-react-pops fica, entao um emoji mandado por outra pessoa ainda
   sobe ali -- em tamanho proporcional (ver spawnReactionPop). */
.grid-strip .tile:not(.fullscreen) .tile-react-bar,
.grid-strip .tile:not(.fullscreen) .tile-watchers,
.grid-strip .tile:not(.fullscreen) .tile-annot-bar,
.grid-strip .tile:not(.fullscreen) .tile-unwatch-btn { display: none; }
```

- [ ] **Step 2: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: sala com uma tela compartilhada e câmeras (layout `spotlight`, a tira aparece embaixo). A miniatura não pode ter barra de reação nem selo de audiência. Duplo clique na miniatura → tela cheia → tudo volta.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/style.css
git commit -m "fix(tira): tirar reacao, selo de audiencia e rabisco das miniaturas de 104px"
```

---

### Task 12: Teste que impede o próximo overlay de nascer sem sumiço

Última tarefa de propósito: ela varre o CSS final, então precisa das regras de todas as anteriores.

**Files:**
- Test: `src/renderer/css-rules.test.js`

- [ ] **Step 1: Escrever o teste**

```js
test('todo overlay do tile some com o mouse parado', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Exceções declaradas, em três grupos, cada um dispensado por um motivo
  // diferente (spec 2026-09-15, frente 4.2):
  //   conteúdo -- um rabisco ou uma reação que chega com o mouse parado
  //               PRECISA aparecer, senão o recurso só funciona pra quem
  //               está mexendo no mouse;
  //   estado   -- esconder deixaria uma tela preta sem explicação;
  //   herdado  -- descendente de quem já tem a regra, some junto.
  const EXCECOES = new Set([
    '.tile-annot-canvas', '.tile-react-pops', '.tile-react-pop', '.pip-strip', // conteúdo
    '.tile-paused', '.tile-paused-shot', '.tile-gate',                         // estado
    '.tile-watchers-panel',                                                    // herdado
  ]);

  const rules = declarations(css);
  const overlays = new Set(
    rules
      .filter(({ property, value, stack }) =>
        property === 'position' && value === 'absolute'
        && /^\.tile-[\w-]+$/.test(stack.at(-1) || ''))
      .map(({ stack }) => stack.at(-1)),
  );

  const semSumico = [...overlays].filter((sel) => {
    if (EXCECOES.has(sel)) return false;
    const nome = sel.replace('.', '\\.');
    // As duas são alcances do MESMO timer (ui.js, IDLE_MS): .tile.fullscreen.idle
    // cobre o que é só do tile, body.room-idle cobre o que também some em janela.
    const idle = new RegExp(`\\.tile\\.fullscreen\\.idle[^{,]*${nome}\\b`);
    const room = new RegExp(`\\.room-idle[^{,]*${nome}\\b`);
    return !idle.test(css) && !room.test(css);
  });

  assert.deepEqual(semSumico, [], `overlay do tile sem regra de ociosidade: ${semSumico.join(', ')}`);
});
```

- [ ] **Step 2: Rodar**

Run: `npm test 2>&1 | grep -A8 "overlay do tile"`
Expected: PASS. Se falhar, a saída nomeia o seletor — decida conscientemente: ou ele ganha regra de ociosidade, ou entra nas exceções **com o motivo escrito**. Nunca acrescente à lista só para o teste passar.

- [ ] **Step 3: Conferir a suíte inteira**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`, total ≥ 737.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/css-rules.test.js
git commit -m "test(css): exigir regra de ociosidade pra todo overlay novo do tile

Regra de design que nenhum teste mede volta a ser quebrada: a barra de
reacao nasceu sem sumico e ninguem notou ate o relato."
```

---

## Conferência final antes de fechar a branch

- [ ] `npm run lint` limpo
- [ ] `npm test` — `fail 0`, total ≥ 737
- [ ] `grep -rn "update-banner\|showUpdateBanner\|update-dot" src/` sem saída
- [ ] `npm start`: console do renderer sem erro no boot
- [ ] Tela cheia sem nenhum rótulo do dock; 3s parado esconde o cromo e mantém vídeo, PiP e véu de pausa
- [ ] Pausar/retomar mostra o aviso à esquerda; toast do lobby continua à direita
- [ ] Chat: placeholder centralizado, caixa cresce, botão de enviar acende e apaga, rolar para o meio e receber mensagem não arranca a lista
- [ ] Tira de miniaturas sem barra de reação; maximizar devolve tudo

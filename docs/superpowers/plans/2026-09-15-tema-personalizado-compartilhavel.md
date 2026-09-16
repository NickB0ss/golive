# Tema personalizado, salvo e compartilhável — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar a pessoa montar um tema próprio, guardar vários com nome, e mandar um código curto para um amigo colar e adotar o mesmo tema.

**Architecture:** O motor já existe e está testado — `deriveSurfaces({temp, level})` em `theme.js`, a forma `{preset:'custom', base, act}` que `tokensFor` e `config.loadTheme` já leem, e `validate()` com o aviso "usar #xxxxxx" que a interface já desenha. O que foi removido numa passada anterior foram os **controles**, não a capacidade. Esta passada acrescenta: um módulo puro novo para o código compartilhável, uma lista no config, e a interface. Nenhuma migração de config e nenhuma mudança de protocolo — o código é copiado e colado por fora do app.

**Tech Stack:** Electron 32, JavaScript sem build, módulos no padrão IIFE `(function (root) { … })(typeof window !== 'undefined' ? window : global)` que roda igual no renderer e sob `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-15-chat-atualizacao-e-tela-cheia-design.md`, frente 8.

**Ordem:** este plano é independente do de frentes 1–7 (`2026-09-15-chat-atualizacao-e-tela-cheia.md`). Os dois tocam `style.css` e `ui.js`, mas em blocos diferentes; se rodarem em paralelo, espere conflito só no fim do `style.css`.

## Global Constraints

- **Comando de teste:** `npm test` (= `node --test`). Linha de base: **733 testes passando, 0 falhas**.
- **Lint:** `npm run lint` precisa passar ao fim de cada tarefa.
- **Tokens semânticos travados:** `--live` (`#FF4D4F`), `--warn` (`#F5B544`) e `--danger` (`#C92A33`) existem só no `:root` base. **Nenhum caminho desta frente pode escrevê-los.** O código compartilhável carrega três campos — temperatura, claridade e cor de ação — e ponto. A trava vale por construção, não por checagem.
- **`theme.js` não ganha dependência nova.** Ele é puro e `config.js` deliberadamente não o importa; quem cruza os dois é `app.js`. Mantenha assim.
- **Entrada de fora é não confiável.** O código colado passa por validação estrita de alfabeto, tamanho, versão e checksum antes de virar tema. `decode` nunca lança e nunca devolve meio tema.
- **Cores literais** só dentro de blocos `:root` — fora deles, token. Verificado por teste existente.
- **Piso de 11px** em `font-size`, verificado por teste existente.
- **Idioma:** interface em português do Brasil.
- **Commits:** um por tarefa, mensagem em português. Não fazer push.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/renderer/themecode.js` | **novo.** Módulo puro: `encode(tema) → string`, `decode(texto) → tema \| null`. Sem DOM, sem rede, sem `theme.js`. |
| `src/renderer/themecode.test.js` | **novo.** `node --test`. |
| `src/renderer/config.js` | seção `themes` com validação item a item e teto |
| `src/renderer/config.test.js` | casos da seção nova |
| `src/renderer/ui.js` | seção "Meus temas" na aba Aparência: controles de superfície, salvar, renomear, apagar, copiar código, colar código |
| `src/renderer/app.js` | persistir `cfg.themes` junto do resto |
| `src/renderer/style.css` | estilo da seção nova |
| `src/renderer/index.html` | `<script src="themecode.js">` e o diálogo `#dialog-text`. O painel de Aparência em si é montado por `ui.js` via `innerHTML`, não fica aqui. |

---

### Task 1: Módulo `themecode.js`

Módulo puro, testado isoladamente. Nada de DOM nesta tarefa.

**Files:**
- Create: `src/renderer/themecode.js`
- Test: `src/renderer/themecode.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `encode({ base: { temp: number, level: number }, act: string }) → string` — devolve `'GL-XXXX-XXXX-XXXX'`. `temp` e `level` são clampados em 0–1; `act` é `#rrggbb`.
  - `decode(texto: string) → { base: { temp, level }, act } | null`
  - `PREFIX` (`'GL'`), `VERSION` (`1`), `ALPHABET` (string de 32 caracteres) — exportados para o teste.
  As Tasks 3 e 4 consomem `encode` e `decode`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/renderer/themecode.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const themecode = require('./themecode.js');

const TEMA = { base: { temp: 0.25, level: 0.8 }, act: '#5B4BE8' };

test('ida e volta preserva a cor de acao exatamente', () => {
  const voltou = themecode.decode(themecode.encode(TEMA));
  assert.equal(voltou.act, '#5B4BE8');
});

test('ida e volta preserva temp e level dentro do erro de quantizacao', () => {
  const voltou = themecode.decode(themecode.encode(TEMA));
  // 1 byte por campo: o erro maximo e meio passo de 1/255.
  assert.ok(Math.abs(voltou.base.temp - 0.25) <= 1 / 255);
  assert.ok(Math.abs(voltou.base.level - 0.8) <= 1 / 255);
});

test('o codigo tem prefixo, 12 caracteres e tres grupos', () => {
  assert.match(themecode.encode(TEMA), /^GL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test('checksum quebrado devolve null', () => {
  const bom = themecode.encode(TEMA);
  // Troca o ULTIMO caractere, que carrega o checksum.
  const ruim = bom.slice(0, -1) + (bom.at(-1) === '0' ? '1' : '0');
  assert.equal(themecode.decode(ruim), null);
});

test('tamanho errado devolve null', () => {
  assert.equal(themecode.decode('GL-ABCD-EFGH'), null);
  assert.equal(themecode.decode('GL-ABCD-EFGH-JKMN-PQRS'), null);
  assert.equal(themecode.decode(''), null);
});

test('caractere fora do alfabeto devolve null', () => {
  // 'U' nao existe no alfabeto de Crockford e nao tem mapeamento de
  // confusao -- diferente de I/L/O, que sao lidos como 1/1/0.
  assert.equal(themecode.decode('GL-UUUU-UUUU-UUUU'), null);
});

test('nao e objeto, nao e string, nao quebra', () => {
  for (const entrada of [null, undefined, 42, {}, [], '   ']) {
    assert.equal(themecode.decode(entrada), null);
  }
});

test('I e L viram 1, O vira 0 -- confusao visual de quem digita', () => {
  const bom = themecode.encode(TEMA);
  const comZeros = bom.replace(/1/g, 'I').replace(/0/g, 'O');
  assert.deepEqual(themecode.decode(comZeros), themecode.decode(bom));
});

test('minusculas e hifens em posicao diferente decodificam igual', () => {
  const bom = themecode.encode(TEMA);
  const bagunçado = bom.toLowerCase().replace(/-/g, '');
  assert.deepEqual(themecode.decode(bagunçado), themecode.decode(bom));
});

test('versao desconhecida devolve null', () => {
  // Byte 0 e a versao. Forja um codigo com versao 9 refazendo a conta:
  // o teste so precisa provar que a checagem existe, entao usa a via
  // publica -- codifica, decodifica e confirma que a versao atual e 1.
  assert.equal(themecode.VERSION, 1);
  const forjado = themecode.encodeRaw([9, 0, 0, 0, 0, 0]);
  assert.equal(themecode.decode(forjado), null);
});

test('valores fora de faixa sao clampados, nao lancam', () => {
  const codigo = themecode.encode({ base: { temp: -5, level: 99 }, act: '#000000' });
  const voltou = themecode.decode(codigo);
  assert.equal(voltou.base.temp, 0);
  assert.equal(voltou.base.level, 1);
});

test('act invalido cai no preto em vez de lancar', () => {
  const voltou = themecode.decode(themecode.encode({ base: { temp: 0.5, level: 0.5 }, act: 'azul' }));
  assert.equal(voltou.act, '#000000');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -c "themecode"`
Expected: FAIL — `Cannot find module './themecode.js'`.

- [ ] **Step 3: Escrever o módulo**

Crie `src/renderer/themecode.js`:

```js
'use strict';

/*
 * Codigo curto de tema, pra mandar pro amigo pelo Discord. Modulo puro --
 * sem DOM, sem rede, e sem importar theme.js (que continua desacoplado).
 *
 * A carga util e de 7 bytes:
 *
 *   0    versao do formato
 *   1    temp  (0-1 quantizado em 0-255)
 *   2    level (0-1 quantizado em 0-255)
 *   3-5  cor de acao (r, g, b)
 *   6    checksum dos seis anteriores
 *
 * O que ele NAO carrega e o ponto principal: nao ha campo pra --live,
 * --warn nem --danger. A trava semantica da spec de 2026-09-03 sobrevive
 * POR CONSTRUCAO, nao por uma checagem que alguem possa esquecer de rodar.
 *
 * Alfabeto base32 de Crockford e nao base64 porque o codigo vai ser colado
 * no Discord e as vezes DITADO: nao diferencia maiuscula de minuscula, nao
 * usa +, / nem =, e tira I, L, O e U pra nao confundir com 1 e 0. Na
 * leitura, I e L viram 1 e O vira 0 -- quem errou por confusao visual
 * ainda acerta.
 *
 * O checksum nao e seguranca, e ergonomia: rejeita um caractere trocado
 * antes de a pessoa ver um tema aleatorio e achar que o amigo tem pessimo
 * gosto. A versao permite mudar o formato depois sem aplicar um codigo
 * velho com significado novo.
 */

(function (root) {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const PREFIX = 'GL';
  const VERSION = 1;
  const CHARS = 12; // 7 bytes = 56 bits -> ceil(56/5) = 12 caracteres

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  function quantizar(v) {
    return Math.round(clamp01(v) * 255);
  }

  function checksum(bytes) {
    let soma = 0;
    for (const b of bytes) soma = (soma + b) & 255;
    return soma;
  }

  /** Bytes -> base32. `value` nunca passa de 12 bits (drenamos 5 a cada
   * volta antes de somar 8), entao nao ha risco de estourar o inteiro de
   * 32 bits dos operadores bit a bit do JS. */
  function bytesParaBase32(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  function base32ParaBytes(texto) {
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of texto) {
      const idx = ALPHABET.indexOf(ch);
      if (idx < 0) return null;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return out;
  }

  function agrupar(texto) {
    return `${PREFIX}-${texto.slice(0, 4)}-${texto.slice(4, 8)}-${texto.slice(8, 12)}`;
  }

  /** Normaliza o que a pessoa colou: tira o prefixo, tira tudo que nao e
   * do alfabeto (hifen, espaco, quebra de linha de um copiar torto), e
   * desfaz as confusoes visuais. */
  function normalizar(texto) {
    if (typeof texto !== 'string') return null;
    const cru = texto
      .trim()
      .toUpperCase()
      .replace(/^GL[-\s]*/, '')
      .replace(/[\s-]/g, '')
      .replace(/[IL]/g, '1')
      .replace(/O/g, '0');
    return cru.length === CHARS ? cru : null;
  }

  function rgbDe(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0];
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexDe(r, g, b) {
    const p = (c) => c.toString(16).padStart(2, '0');
    return `#${p(r)}${p(g)}${p(b)}`;
  }

  /** So pro teste forjar uma versao desconhecida sem reimplementar a conta.
   * Recebe os SEIS primeiros bytes e acrescenta o checksum. */
  function encodeRaw(seisBytes) {
    const bytes = [...seisBytes];
    bytes.push(checksum(bytes));
    return agrupar(bytesParaBase32(bytes));
  }

  function encode(tema) {
    const base = (tema && tema.base) || {};
    const [r, g, b] = rgbDe(tema && tema.act);
    return encodeRaw([VERSION, quantizar(base.temp), quantizar(base.level), r, g, b]);
  }

  function decode(texto) {
    const limpo = normalizar(texto);
    if (!limpo) return null;
    const bytes = base32ParaBytes(limpo);
    if (!bytes || bytes.length !== 7) return null;
    if (bytes[0] !== VERSION) return null;
    if (checksum(bytes.slice(0, 6)) !== bytes[6]) return null;
    return {
      base: { temp: bytes[1] / 255, level: bytes[2] / 255 },
      act: hexDe(bytes[3], bytes[4], bytes[5]),
    };
  }

  const api = { encode, decode, encodeRaw, PREFIX, VERSION, ALPHABET };

  root.GoLive = root.GoLive || {};
  root.GoLive.themecode = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test 2>&1 | tail -6`
Expected: `fail 0`, total 745 (733 + 12 novos).

- [ ] **Step 5: Ligar no `index.html`**

Em `src/renderer/index.html`, junto dos outros `<script src="…">` (perto de `reactions.js`, ~linha 405), **antes** de `ui.js`:

```html
<script src="themecode.js"></script>
```

Confira a ordem: `ui.js` vai ler `window.GoLive.themecode`, então o `<script>` novo precisa vir antes dele.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/themecode.js src/renderer/themecode.test.js src/renderer/index.html
git commit -m "feat(tema): modulo do codigo compartilhavel de tema

7 bytes em base32 de Crockford: versao, temperatura, claridade, cor de
acao e checksum. Crockford e nao base64 porque o codigo vai ser colado
no Discord e as vezes ditado. Nao ha campo pra --live/--warn/--danger:
a trava semantica sobrevive por construcao."
```

---

### Task 2: Lista de temas salvos no `config.js`

**Files:**
- Modify: `src/renderer/config.js` (`DEFAULTS` ~linha 204; junto de `loadTheme` ~linha 253; `load()` ~linha 330)
- Test: `src/renderer/config.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `config.DEFAULTS.themes` (`[]`) e a chave `themes` no objeto devolvido por `load()`, no formato `[{ id: string, name: string, base: { temp: number, level: number }, act: string }]`. A Task 3 lê e escreve essa lista.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `src/renderer/config.test.js`:

```js
test('themes ausente ou torto vira lista vazia', () => {
  assert.deepEqual(config.load('{}').themes, []);
  assert.deepEqual(config.load('{"themes":"nao e lista"}').themes, []);
  assert.deepEqual(config.load('{"themes":{}}').themes, []);
});

test('themes descarta entrada torta SEM derrubar as boas', () => {
  const raw = JSON.stringify({
    themes: [
      { id: 'a', name: 'Bom', base: { temp: 0.2, level: 0.7 }, act: '#5B4BE8' },
      { id: 'b', name: 'Sem base', act: '#5B4BE8' },
      { id: 'c', name: 'Hex torto', base: { temp: 0.2, level: 0.7 }, act: 'azul' },
      { id: 'd', name: 'Fora de faixa', base: { temp: 5, level: 0.7 }, act: '#5B4BE8' },
      { id: 'e', name: 'Outro bom', base: { temp: 0.9, level: 0.1 }, act: '#FFFFFF' },
    ],
  });
  // Uma entrada corrompida nao pode custar a lista inteira -- e o tema que
  // a pessoa montou a mao que estaria sendo jogado fora.
  assert.deepEqual(config.load(raw).themes.map((t) => t.id), ['a', 'e']);
});

test('themes corta no teto de 12', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => ({
    id: `t${i}`, name: `Tema ${i}`, base: { temp: 0.5, level: 0.5 }, act: '#5B4BE8',
  }));
  assert.equal(config.load(JSON.stringify({ themes: muitos })).themes.length, 12);
});

test('nome de tema fora de 1-24 caracteres e rejeitado', () => {
  const nomes = ['', '   ', 'x'.repeat(25)];
  for (const name of nomes) {
    const raw = JSON.stringify({ themes: [{ id: 'a', name, base: { temp: 0.2, level: 0.7 }, act: '#5B4BE8' }] });
    assert.deepEqual(config.load(raw).themes, [], `nome ${JSON.stringify(name)} deveria cair`);
  }
});

test('nome de tema e aparado ao carregar', () => {
  const raw = JSON.stringify({ themes: [{ id: 'a', name: '  Meu tema  ', base: { temp: 0.2, level: 0.7 }, act: '#5B4BE8' }] });
  assert.equal(config.load(raw).themes[0].name, 'Meu tema');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test 2>&1 | grep -A5 "themes ausente"`
Expected: FAIL — `themes` vem `undefined`.

- [ ] **Step 3: Implementar**

Em `src/renderer/config.js`, acrescente a `DEFAULTS`, logo depois de `theme: { preset: 'marca' },`:

```js
    // Temas montados pela pessoa (spec 2026-09-15, frente 8). Lista, ao
    // lado de `theme`, que continua sendo "qual esta em uso". Nenhuma
    // migracao: usar um destes grava a forma {preset:'custom', base, act}
    // em `theme`, que loadTheme ja aceita desde 2026-09-03.
    themes: [],
```

E, logo depois de `loadTheme`:

```js
  // Teto de temas salvos. Um arquivo de config precisa ter tamanho
  // limitado, e doze cartoes ja enchem a aba.
  const MAX_CUSTOM_THEMES = 12;

  /** Le a lista `themes`. Valida ITEM A ITEM e descarta so o que estiver
   * torto -- uma entrada corrompida nao pode custar os outros temas, que
   * a pessoa montou a mao. Lista ausente, de outro tipo, ou toda torta,
   * vira `[]` sem lancar. */
  function loadCustomThemes(incoming) {
    if (!Array.isArray(incoming)) return [];
    const out = [];
    for (const item of incoming) {
      if (out.length >= MAX_CUSTOM_THEMES) break;
      if (!isObject(item)) continue;
      if (typeof item.id !== 'string' || item.id === '') continue;
      if (typeof item.name !== 'string') continue;
      const name = item.name.trim();
      if (name.length < 1 || name.length > 24) continue;
      if (!isValidThemeBase(item.base)) continue;
      if (!isValidHexColor(item.act)) continue;
      out.push({
        id: item.id,
        name,
        base: { temp: item.base.temp, level: item.base.level },
        act: item.act,
      });
    }
    return out;
  }
```

E em `load()`, junto de `theme: …`:

```js
      themes: loadCustomThemes(parsed.themes),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test 2>&1 | tail -6`
Expected: `fail 0`, total 750.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/config.js src/renderer/config.test.js
git commit -m "feat(config): guardar varios temas montados pela pessoa

Validacao item a item: uma entrada corrompida nao derruba a lista
inteira. Teto de 12 pra o arquivo nao crescer sem limite."
```

---

### Task 3: Montar, salvar e usar temas próprios

**Files:**
- Modify: `src/renderer/ui.js` (painel de Aparência ~linhas 2955-2968; `initThemeControls` ~linha 2893; `render` de configurações ~linha 3076)
- Modify: `src/renderer/app.js` (`onThemeChange` ~linha 741)
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `config.DEFAULTS.themes` (Task 2), `theme.deriveSurfaces`, `theme.validate`, `theme.tokensFor`, `theme.PRESETS`.
- Produces: `renderMyThemes(lista, ativoId)` e o callback `deps.onThemesChange(lista)`. A Task 4 acrescenta os botões de código dentro da mesma seção.

- [ ] **Step 1: Marcação da seção nova**

Em `ui.js`, no template do painel de Aparência, **depois** do bloco `<h3>Personalizar</h3>` e do `#theme-act`, e **antes** do `<p id="theme-warning">`, acrescente os dois controles de superfície que tinham sido removidos:

```html
      <div class="settings-field">
        <label for="theme-temp">Temperatura das superfícies</label>
        <input id="theme-temp" type="range" min="0" max="100" value="50" />
      </div>
      <div class="settings-field">
        <label for="theme-level">Claridade das superfícies</label>
        <input id="theme-level" type="range" min="0" max="100" value="20" />
      </div>
```

E **depois** do `<div class="settings-actions">` que tem o `#btn-theme-reset`:

```html
      <h3>Meus temas</h3>
      <p class="settings-hint">Guarde a combinação que você montou e mande o código pra quem quiser usar igual.</p>
      <div id="my-themes" class="theme-presets"></div>
      <div class="settings-actions">
        <button id="btn-theme-save" type="button" class="secondary small">Salvar tema atual</button>
      </div>
```

- [ ] **Step 2: Render da lista**

Em `ui.js`, junto de `renderThemePresets` (~linha 2838):

```js
  let myThemes = [];
  let onThemesChange = null;

  /** Cartao de tema proprio. Reaproveita o desenho de .theme-preset-card
   * dos fixos -- sao a mesma coisa pra quem olha, a diferenca e so quem
   * desenhou. O menu fica num botao separado pra o clique no cartao
   * continuar significando "usar este". */
  function renderMyThemes(ativoId) {
    const host = $('my-themes');
    if (!host) return;
    if (!myThemes.length) {
      host.innerHTML = '<p class="settings-hint">Nenhum tema salvo ainda.</p>';
      return;
    }
    host.innerHTML = myThemes.map((t) => {
      const tokens = { surfaces: theme.deriveSurfaces(t.base), ...theme.deriveAction(t.act) };
      const s = tokens.surfaces;
      return `
        <div class="my-theme-slot">
          <button class="theme-preset-card${t.id === ativoId ? ' active' : ''}" type="button"
                  data-theme-id="${escapeHtml(t.id)}" aria-pressed="${t.id === ativoId}">
            <span class="theme-preset-mini" style="background:${s.bg}">
              <span class="tpm-panel" style="background:${s.s2}">
                <span class="tpm-cta" style="background:${tokens.act}"></span>
              </span>
            </span>
            <span class="theme-preset-label">${escapeHtml(t.name)}</span>
          </button>
          <button class="my-theme-menu-btn" type="button" data-theme-menu="${escapeHtml(t.id)}"
                  title="Opções de ${escapeHtml(t.name)}" aria-label="Opções de ${escapeHtml(t.name)}">⋮</button>
        </div>`;
    }).join('');
  }
```

Confirme com `grep -n "theme-preset-mini\|tpm-panel\|tpm-cta" src/renderer/ui.js` que os nomes de classe batem com os do cartão fixo; se o desenho do cartão tiver mudado, copie a estrutura de `renderThemePresetCard` em vez desta, trocando só a origem dos tokens.

- [ ] **Step 3: Ler os controles de superfície**

Substitua `applyCustomThemeFromControls` por:

```js
  /** Le os controles e aplica ao vivo. Chamada a cada `input` (nunca so
   * `change`): arrastar e ver o app mudar e o unico jeito de avaliar um
   * tema (spec 2026-09-03, secao 5.6). Aplica MESMO quando a validacao
   * reprova -- o aviso abaixo do controle carrega a reprovacao, a
   * aplicacao ao vivo continua sendo o feedback principal.
   *
   * Mexer nas superficies SAI da predefinicao fixa: as superficies dela
   * sao desenhadas a mao e derivar por cima entregaria uma combinacao que
   * ninguem escolheu. Mexer so no acento continua dentro dela. */
  function themeCfgFromControls({ comSuperficies = false } = {}) {
    const act = $('theme-act').value;
    if (!comSuperficies) return { preset: selectedThemePreset(), act };
    return {
      preset: 'custom',
      base: { temp: Number($('theme-temp').value) / 100, level: Number($('theme-level').value) / 100 },
      act,
    };
  }

  function applyCustomThemeFromControls(deps, opcoes) {
    const themeCfg = themeCfgFromControls(opcoes);
    const result = theme.validate(theme.tokensFor(themeCfg));
    deps.onThemeChange(themeCfg);

    const warningEl = $('theme-warning');
    warningEl.textContent = '';
    if (result.ok) return;

    warningEl.append(result.failures[0]);
    if (result.nearestAct) {
      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'theme-warning-fix';
      fixBtn.textContent = `usar ${result.nearestAct}`;
      fixBtn.addEventListener('click', () => {
        $('theme-act').value = result.nearestAct;
        applyCustomThemeFromControls(deps, opcoes);
      });
      warningEl.append(' ', fixBtn);
    }
  }
```

- [ ] **Step 4: Ligar os eventos**

Em `render(...)` das configurações, junto do listener de `#theme-act`:

```js
    for (const id of ['theme-temp', 'theme-level']) {
      $(id).addEventListener('input', () => {
        // Sair pra 'custom' desmarca os cartoes fixos: nao se esta mais
        // dentro de nenhum deles.
        Array.from($('theme-presets').children).forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        applyCustomThemeFromControls(deps, { comSuperficies: true });
      });
    }

    $('btn-theme-save').addEventListener('click', () => {
      // O teto e conferido ANTES de abrir o dialogo: pedir o nome pra
      // depois dizer "nao deu" e desperdicar o trabalho da pessoa.
      if (myThemes.length >= 12) {
        deps.onToast('Você já tem 12 temas salvos. Apague um pra guardar outro.');
        return;
      }
      const cfg = themeCfgFromControls({ comSuperficies: true });
      openText({
        title: 'Nome do tema',
        value: 'Meu tema',
        onAccept: (nome) => {
          const novo = { id: `t${Date.now()}`, name: nome.slice(0, 24), base: cfg.base, act: cfg.act };
          myThemes = [...myThemes, novo];
          onThemesChange?.(myThemes);
          renderMyThemes(novo.id);
        },
      });
    });

    $('my-themes').addEventListener('click', (event) => {
      const card = event.target.closest('[data-theme-id]');
      if (card) {
        const t = myThemes.find((x) => x.id === card.dataset.themeId);
        if (!t) return;
        Array.from($('theme-presets').children).forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        $('theme-act').value = t.act;
        $('theme-temp').value = String(Math.round(t.base.temp * 100));
        $('theme-level').value = String(Math.round(t.base.level * 100));
        deps.onThemeChange({ preset: 'custom', base: t.base, act: t.act });
        renderMyThemes(t.id);
        return;
      }
      const menuBtn = event.target.closest('[data-theme-menu]');
      if (menuBtn) openMyThemeMenu(menuBtn.dataset.themeMenu, menuBtn, deps);
    });
```

Em `initThemeControls`, depois de `$('theme-warning').textContent = '';`:

```js
    myThemes = (config && Array.isArray(config.themes)) ? config.themes : [];
    const base = themeCfg.preset === 'custom' && themeCfg.base ? themeCfg.base : { temp: 0.5, level: 0.2 };
    $('theme-temp').value = String(Math.round(base.temp * 100));
    $('theme-level').value = String(Math.round(base.level * 100));
    renderMyThemes(null);
```

- [ ] **Step 5: Menu do cartão (renomear / apagar)**

Junto de `renderMyThemes`:

```js
  /** Menu do cartao. Reaproveita o #member-menu flutuante que ja existe --
   * um segundo menu flutuante so pra isto seria a mesma coisa duas vezes.
   * Confira o nome real do helper com:
   *   grep -n "function openMemberMenu\|member-menu" src/renderer/ui.js
   * e use o mesmo caminho de posicionamento que ele usa. */
  function openMyThemeMenu(id, anchorEl, deps) {
    const t = myThemes.find((x) => x.id === id);
    if (!t) return;
    const itens = [
      { rotulo: 'Renomear', acao: () => {
        openText({
          title: 'Renomear tema',
          value: t.name,
          onAccept: (nome) => {
            t.name = nome.slice(0, 24);
            onThemesChange?.(myThemes);
            renderMyThemes(id);
          },
        });
      } },
      { rotulo: 'Copiar código', acao: () => copiarCodigoDoTema(t, anchorEl) },
      { rotulo: 'Apagar', tom: 'danger', acao: () => {
        // `openConfirm` ja existe (ui.js, ~3510) e e o UNICO dialogo de
        // confirmacao do app -- o mesmo de banir e de passar a lideranca.
        // Ele e por callback, nao por Promise, e o foco nasce no Cancelar.
        openConfirm({
          title: 'Apagar tema',
          text: `"${t.name}" some da lista. Quem já tem o código continua podendo usar.`,
          confirmLabel: 'Apagar',
          onConfirm: () => {
            myThemes = myThemes.filter((x) => x.id !== id);
            onThemesChange?.(myThemes);
            renderMyThemes(null);
          },
        });
      } },
    ];
    renderThemeMenu(itens, anchorEl);
  }
```

`copiarCodigoDoTema` fecha na Task 4.

Para `renderThemeMenu`, **não escreva um posicionador novo**: `ui.js` já tem o `#member-menu` flutuante (`memberMenuEl`, ~linha 2107) com o cálculo de posição e o fechamento por clique fora, e as classes `.member-menu`, `.member-menu-item` e `.member-menu-item.danger` já estão estilizadas. Copie a estrutura de `openMemberMenu` (~linha 2137), trocando só os itens: cada `rotulo` vira um `<div class="member-menu-item" role="menuitem" data-action="…">` e o `tom: 'danger'` vira a classe `danger`.

- [ ] **Step 6: Persistir em `app.js`**

Em `src/renderer/app.js`, junto de `onThemeChange` (~linha 741):

```js
      onThemesChange: (lista) => {
        cfg = { ...cfg, themes: lista };
        persist();
      },
      onToast: showToast,
```

`onConfirm` **não** é necessário: `openConfirm` já mora dentro de `ui.js` e é chamada direto de lá (ver Step 5).

Para pedir o nome do tema, **não existe diálogo de texto no app**. Confirmado com:

```bash
grep -n "dialog-confirm\|askText\|prompt(" src/renderer/app.js src/renderer/ui.js
```

O único diálogo genérico é o `#dialog-confirm` (título, texto, dois botões). Acrescente um irmão dele em `index.html`, no mesmo molde, logo depois:

```html
<!-- Segundo dialogo generico: mesma casca do #dialog-confirm, com um campo.
     O foco nasce NO CAMPO (e nao no Cancelar, como no de confirmar): aqui a
     acao esperada e digitar, nao desistir. -->
<div id="dialog-text" class="modal hidden">
  <div class="modal-box dialog-box">
    <h2 id="dialog-text-title"></h2>
    <label for="dialog-text-input" class="visually-hidden">Valor</label>
    <input id="dialog-text-input" type="text" maxlength="24" autocomplete="off" />
    <div class="dialog-actions">
      <button id="btn-text-cancel" class="ghost" type="button">Cancelar</button>
      <button id="btn-text-ok" class="primary" type="button">Salvar</button>
    </div>
  </div>
</div>
```

E em `ui.js`, junto de `openConfirm` (~linha 3510), no **mesmo estilo por callback** que ela usa — não por Promise, para os dois diálogos não divergirem:

```js
  const dlgTextEl = $('dialog-text');
  let onTextAccept = null;

  function openText({ title, value = '', confirmLabel = 'Salvar', onAccept }) {
    $('dialog-text-title').textContent = title;
    $('dialog-text-input').value = value;
    $('btn-text-ok').textContent = confirmLabel;
    onTextAccept = onAccept;
    dlgTextEl.classList.remove('hidden');
    $('dialog-text-input').focus();
    $('dialog-text-input').select();
  }
  function closeText() {
    dlgTextEl.classList.add('hidden');
    onTextAccept = null;
  }
  $('btn-text-cancel').addEventListener('click', closeText);
  $('btn-text-ok').addEventListener('click', () => {
    const valor = $('dialog-text-input').value.trim();
    const aceitar = onTextAccept;
    closeText();
    if (valor) aceitar?.(valor);
  });
```

Copie de `openConfirm` o que ela fizer de guarda de foco (`lastFocusedBeforeModal` / `restoreFocusAfterModal`) e de tecla Escape — leia o corpo dela antes de escrever este bloco e espelhe, para os dois diálogos se comportarem igual.

Salvar (Step 4), renomear (Step 5) e importar (Task 4) já chamam `openText` nessa forma.

- [ ] **Step 7: CSS**

No fim de `style.css`:

```css
/* ============ Meus temas (2026-09-15) ============ */
.my-theme-slot { position: relative; }
.my-theme-menu-btn {
  position: absolute; top: 4px; right: 4px;
  width: 22px; height: 22px; min-height: 0; padding: 0;
  display: grid; place-items: center;
  border: none; border-radius: var(--r-xs);
  background: var(--scrim-tint-2); color: var(--tx2);
  font-size: 13px; line-height: 1;
  opacity: 0; transition: opacity var(--dur-fast) var(--ease-in-out);
}
.my-theme-slot:hover .my-theme-menu-btn,
.my-theme-slot:focus-within .my-theme-menu-btn { opacity: 1; }
.my-theme-menu-btn:hover { background: var(--s3); color: var(--tx); }
```

- [ ] **Step 8: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual: abrir Configurações → Aparência, arrastar os dois controles e ver o app mudar **enquanto arrasta**; salvar com nome; fechar e reabrir o app e o tema continuar na lista; clicar no cartão e o tema voltar; renomear; apagar com confirmação.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/ui.js src/renderer/app.js src/renderer/style.css
git commit -m "feat(tema): montar, salvar, renomear e apagar temas proprios

Os controles de superficie tinham sido removidos, mas deriveSurfaces e a
forma {preset:'custom', base, act} continuavam vivos em theme.js e
config.js -- isto religa o caminho e acrescenta a lista."
```

---

### Task 4: Copiar e colar o código

**Files:**
- Modify: `src/renderer/ui.js`
- Modify: `src/renderer/style.css`

**Interfaces:**
- Consumes: `themecode.encode` / `themecode.decode` (Task 1), `renderMyThemes` e `onThemesChange` (Task 3).
- Produces: nada.

- [ ] **Step 1: Marcação do campo de importar**

Em `ui.js`, dentro da seção "Meus temas", depois do `<div class="settings-actions">` do `#btn-theme-save`, acrescente ao mesmo bloco:

```html
      <div class="settings-field">
        <label for="theme-code-input">Usar um código</label>
        <p class="settings-hint">Cole aqui o código que um amigo te mandou.</p>
        <div class="theme-code-row">
          <input id="theme-code-input" type="text" placeholder="GL-XXXX-XXXX-XXXX" spellcheck="false" autocomplete="off" />
          <button id="btn-theme-code-use" type="button" class="secondary small" disabled>Ver tema</button>
        </div>
        <p id="theme-code-status" class="hint" role="status"></p>
      </div>
```

- [ ] **Step 2: Copiar**

Em `ui.js`, junto de `openMyThemeMenu`:

```js
  /** Confirmacao NO LUGAR (motion #4): o botao vira "Copiado" onde o dedo
   * ja esta, em vez de um toast num canto que ninguem esta olhando --
   * mesmo caminho que o endereco da sala usa. */
  function copiarCodigoDoTema(t, anchorEl) {
    const codigo = themecode.encode({ base: t.base, act: t.act });
    void navigator.clipboard.writeText(codigo).then(() => {
      anchorEl.classList.add('copied-flash');
      setTimeout(() => anchorEl.classList.remove('copied-flash'), 1200);
    }).catch(() => {});
  }
```

A chamada na Task 3 já é `copiarCodigoDoTema(t, anchorEl)` — duas coisas, sem `deps`.

- [ ] **Step 3: Colar**

Em `render(...)` das configurações:

```js
    let temaColado = null;

    $('theme-code-input').addEventListener('input', () => {
      const status = $('theme-code-status');
      temaColado = themecode.decode($('theme-code-input').value);
      $('btn-theme-code-use').disabled = !temaColado;
      if (!$('theme-code-input').value.trim()) {
        status.textContent = '';
        return;
      }
      // Codigo invalido nao muda NADA na tela: a pessoa colou errado, nao
      // pediu tema novo.
      status.textContent = temaColado ? 'Código válido. Veja como fica antes de salvar.' : 'Esse código não parece certo.';
    });

    $('btn-theme-code-use').addEventListener('click', () => {
      if (!temaColado) return;
      const importado = temaColado;

      // Previa ao vivo, e o mesmo aviso de contraste que os controles ja
      // mostram. Nao recusa: o app inteiro e aplica-e-avisa, e recusar o
      // tema de um amigo sem oferecer o conserto seria pior.
      $('theme-act').value = importado.act;
      $('theme-temp').value = String(Math.round(importado.base.temp * 100));
      $('theme-level').value = String(Math.round(importado.base.level * 100));
      applyCustomThemeFromControls(deps, { comSuperficies: true });

      if (myThemes.length >= 12) {
        // A previa ja esta no ar e continua valendo -- so nao da pra
        // guardar. Nada se perde: o codigo continua no campo.
        deps.onToast('Você já tem 12 temas salvos. Apague um pra guardar este.');
        return;
      }
      openText({
        title: 'Nome do tema',
        value: 'Tema importado',
        onAccept: (nome) => {
          const novo = { id: `t${Date.now()}`, name: nome.slice(0, 24), base: importado.base, act: importado.act };
          myThemes = [...myThemes, novo];
          onThemesChange?.(myThemes);
          renderMyThemes(novo.id);
          $('theme-code-input').value = '';
          $('theme-code-status').textContent = '';
          $('btn-theme-code-use').disabled = true;
          temaColado = null;
        },
      });
    });
```

E no topo de `ui.js`, junto das outras dependências de módulo (`const reactions = …`), acrescente:

```js
  const themecode = root.GoLive.themecode;
```

Confira o padrão exato com `grep -n "GoLive.reactions\|const reactions" src/renderer/ui.js` e siga o que estiver lá.

- [ ] **Step 4: CSS**

```css
.theme-code-row { display: flex; gap: var(--s-2); align-items: center; }
.theme-code-row input {
  flex: 1; min-width: 0;
  font-family: ui-monospace, monospace; letter-spacing: .06em; text-transform: uppercase;
}
```

- [ ] **Step 5: Conferir**

Run: `npm run lint && npm test 2>&1 | tail -6`
Expected: lint limpo, `fail 0`.

Conferência manual — **é o pedido literal**: salvar um tema, copiar o código pelo menu `⋮` (o botão precisa virar "Copiado" no lugar), colar num editor de texto e conferir o formato `GL-XXXX-XXXX-XXXX`. Apagar o tema, colar o código de volta no campo: o status precisa dizer que é válido, "Ver tema" aplica a prévia, e salvar devolve o tema idêntico. Colar `GL-AAAA-AAAA-AAAA` (checksum quebrado): status de erro e **nada** muda na tela.

Teste de ponta a ponta com duas máquinas: mandar o código pelo Discord, o amigo cola e adota — é o cenário que o recurso existe pra atender.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/ui.js src/renderer/style.css
git commit -m "feat(tema): copiar e colar o codigo do tema

Copiar confirma no lugar (o botao vira Copiado), como o endereco da
sala. Codigo invalido nao muda nada na tela: a pessoa colou errado,
nao pediu tema novo."
```

---

## Conferência final antes de fechar a branch

- [ ] `npm run lint` limpo
- [ ] `npm test` — `fail 0`, total ≥ 750
- [ ] `grep -rn "live\|warn\|danger" src/renderer/themecode.js` sem saída — o código compartilhável não tem como tocar em token semântico
- [ ] Apagar o `config.json` e abrir o app: nasce sem tema salvo, sem erro no console
- [ ] Editar o `config.json` à mão com uma entrada de `themes` corrompida no meio de duas boas: as boas sobrevivem
- [ ] Ida e volta real do código entre duas máquinas

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'sinal');
// Toda folha do Sinal entra: um arquivo novo nao pode escapar das regras.
const FILES = fs.readdirSync(DIR).filter((file) => file.endsWith('.css')).sort();
const cssByFile = new Map(FILES.map((file) => [file, fs.readFileSync(path.join(DIR, file), 'utf8')]));
const CSS_MESA_DIR = path.join(__dirname, 'mesa-janelas', 'css');
const entradaMesaJanelas = fs.readFileSync(path.join(__dirname, 'mesa-janelas.css'), 'utf8');
const folhasMesaJanelas = [...entradaMesaJanelas
  .matchAll(/@import url\('mesa-janelas\/css\/([\w-]+\.css)'\);/g)]
  .map((match) => match[1]);
const mesaJanelas = fs.existsSync(CSS_MESA_DIR)
  ? folhasMesaJanelas.map((file) => fs.readFileSync(path.join(CSS_MESA_DIR, file), 'utf8')).join('\n')
  : entradaMesaJanelas;
const baseMesaJanelas = fs.existsSync(CSS_MESA_DIR)
  ? fs.readFileSync(path.join(CSS_MESA_DIR, 'base.css'), 'utf8')
  : '';

function declarations(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const stack = [];
  const blocks = [];
  let nextBlock = 0;
  let segment = '';
  let line = 1;

  const flush = () => {
    const match = segment.match(/^\s*([\w-]+)\s*:\s*([^;{}]+)$/);
    if (match) {
      found.push({
        property: match[1], value: match[2].trim(), stack: [...stack], block: blocks.at(-1), line,
      });
    }
    segment = '';
  };

  for (const char of source) {
    if (char === '\n') line += 1;
    if (char === '{') {
      stack.push(segment.trim());
      blocks.push(nextBlock++);
      segment = '';
    } else if (char === '}') {
      flush();
      stack.pop();
      blocks.pop();
    } else if (char === ';') {
      flush();
    } else {
      segment += char;
    }
  }
  return found;
}

function selectorParts(selector) {
  const parts = [];
  let part = '';
  let parentheses = 0;
  for (const char of selector) {
    if (char === '(') parentheses += 1;
    if (char === ')') parentheses -= 1;
    if (char === ',' && parentheses === 0) {
      parts.push(part.trim());
      part = '';
    } else {
      part += char;
    }
  }
  parts.push(part.trim());
  return parts;
}

function isRootBlock(stack) {
  return stack.some((entry) => /^:root(?:\[data-(?:theme|tone)=(?:"[^"]+"|'[^']+'|[^\]]+)\])?$/.test(entry));
}

test('mesa-janelas.css so importa, e importa toda folha de mesa-janelas/css', () => {
  const entrada = fs.readFileSync(path.join(__dirname, 'mesa-janelas.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const importados = [...entrada.matchAll(/@import url\('mesa-janelas\/css\/([\w-]+\.css)'\);/g)]
    .map((match) => match[1]);
  const semImport = entrada.replace(/@import url\('[^']+'\);/g, '').trim();
  assert.equal(semImport, '', 'mesa-janelas.css so pode ter @import');
  const folhas = fs.readdirSync(CSS_MESA_DIR).filter((file) => file.endsWith('.css')).sort();
  assert.deepEqual([...importados].sort(), folhas);
});

test('as fontes Sinal apontam para arquivos locais existentes', () => {
  const fonts = [...cssByFile.get('tokens.css').matchAll(/@font-face\s*\{([\s\S]*?)\}/g)];
  assert.ok(fonts.length > 0);
  for (const [, block] of fonts) {
    const url = /src:\s*url\('([^']+)'\)/.exec(block)?.[1];
    assert.ok(url, 'cada fonte precisa de URL local');
    assert.ok(fs.existsSync(path.join(DIR, url)), `fonte ausente: ${url}`);
  }
});

test('hidden vence os displays dos componentes', () => {
  assert.match(cssByFile.get('base.css'), /\[hidden\],\s*\.hidden\s*\{\s*display:\s*none\s*!important/);
});

test('folhas Sinal nao usam cores literais fora dos arquivos de tema', () => {
  for (const file of FILES.filter((f) => !['tokens.css', 'themes.css'].includes(f))) {
    const source = cssByFile.get(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\brgba?\(/i, `${file} contem cor literal`);
  }
});

test('important fica restrito a hidden e movimento reduzido', () => {
  for (const [file, source] of cssByFile) {
    if (file === 'base.css') continue;
    assert.doesNotMatch(source, /!important/, `${file} nao pode usar !important`);
  }
  const base = cssByFile.get('base.css');
  const stripped = base
    .replace(/\[hidden\],\s*\.hidden\s*\{[^}]*!important[^}]*\}/g, '')
    .replace(/\.sr-only\s*\{[^}]*!important[^}]*\}/g, '')
    .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\}/g, '');
  assert.doesNotMatch(stripped, /!important/);
});

test('live so marca estados ao vivo e a marca', () => {
  const allowed = /(?:\.node\[data-state=['"](?:live|paused)['"]\]|\.tag--live|\.me__live|\.src\[data-paused\]|\.btn--live|\.brand(?:__mark)?|\.app-brand|\.theme-mini__live|\.mesa-map > i\.is-live)/;
  for (const source of cssByFile.values()) {
    for (const match of source.matchAll(/([^{}]+)\{[^{}]*var\(--live\)[^{}]*\}/g)) {
      assert.match(match[1], allowed, `uso indevido de --live em ${match[1].trim()}`);
    }
  }
});

test('z-index usa apenas a escala de tokens', () => {
  for (const [file, source] of cssByFile) {
    if (file === 'tokens.css') continue;
    for (const match of source.matchAll(/z-index\s*:\s*([^;}]*)/g)) {
      assert.match(match[1], /^(?:var\(--z-[\w-]+\)|calc\(var\(--z-[\w-]+\)[^)]+\))\s*$/,
        `${file}: z-index fora da escala: ${match[1]}`);
    }
  }
});

test('conteudos da Mesa tambem so usam tokens de cor, fonte e profundidade', () => {
  const source = mesaJanelas.replace(/\/\*[\s\S]*?\*\//g, '');
  // Cor literal so como valor de custom property na base (materiais --mj-mat-* e a ilha escura);
  // toda propriedade de verdade usa var().
  const COR = /#[0-9a-f]{3,8}\b|\brgba?\(/i;
  const semBase = source.replace(baseMesaJanelas.replace(/\/\*[\s\S]*?\*\//g, ''), '');
  assert.doesNotMatch(semBase, COR);
  for (const decl of declarations(baseMesaJanelas)) {
    if (!COR.test(decl.value)) continue;
    assert.ok(decl.property.startsWith('--'), `base.css: cor literal fora de custom property: ${decl.property}`);
  }
  assert.doesNotMatch(source, /var\(--live\)/);
  assert.doesNotMatch(source, /(?:font|font-size)\s*:[^;}]*\b\d+(?:px|rem)\b/);
  for (const match of source.matchAll(/z-index\s*:\s*([^;}]*)/g)) {
    assert.match(match[1], /^var\(--z-[\w-]+\)\s*$/, `mesa-janelas.css: z-index fora da escala: ${match[1]}`);
  }
});

test('a página carrega a pilha Sinal e nao a folha removida', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const file of FILES) assert.match(html, new RegExp(`href="sinal/${file}"`));
  assert.match(html, /href="mesa-janelas\.css"/);
  assert.doesNotMatch(html, /href="style\.css"/);
});

test('Sinal respeita o piso tipografico e nao usa backdrop-filter', () => {
  for (const [file, source] of cssByFile) {
    const rules = declarations(source);
    const small = rules.filter(({ property, value }) => (
      property === 'font-size' && /^\d+(?:\.\d+)?px(?:\s*!important)?$/.test(value)
        && Number.parseFloat(value) < 11
    ));
    assert.deepEqual(small, [], `${file}: font-size abaixo de 11px: ${small.map((r) => r.line).join(', ')}`);
    assert.deepEqual(rules.filter(({ property }) => property === 'backdrop-filter'), [],
      `${file}: backdrop-filter e proibido`);
  }
});

test('font-size do Sinal usa tokens ou valores da escala tipografica', () => {
  const tokenRules = declarations(cssByFile.get('tokens.css'));
  const scale = new Set(tokenRules
    .filter(({ property, stack }) => (/^--(?:t|fs)-/.test(property) && isRootBlock(stack)))
    .flatMap(({ value }) => [...value.matchAll(/\b(\d+)px\b/g)].map((match) => `${match[1]}px`)));
  assert.ok(scale.size > 0, 'tokens.css precisa declarar a escala tipografica');

  for (const [file, source] of cssByFile) {
    const outsideScale = declarations(source).filter(({ property, value, stack }) => (
      property === 'font-size' && !isRootBlock(stack)
        && !/^var\(--(?:t|fs)-[\w-]+\)$/.test(value) && !scale.has(value)
    ));
    assert.deepEqual(outsideScale, [], `${file}: font-size fora da escala: ${outsideScale
      .map((rule) => `${rule.line}: ${rule.value}`).join('; ')}`);
  }
});

test('cada seletor do Sinal aparece uma vez por contexto', () => {
  for (const [file, source] of cssByFile) {
    const seen = new Map();
    for (const { stack, block, line } of declarations(source)) {
      const selector = stack.at(-1);
      if (!selector || selector.startsWith('@') || /^(?:from|to|\d+%)$/.test(selector)) continue;
      const context = stack.slice(0, -1).join(' > ');
      for (const part of selectorParts(selector)) {
        const key = `${context} || ${part.replace(/\s+/g, ' ')}`;
        if (!seen.has(key)) seen.set(key, new Map());
        if (!seen.get(key).has(block)) seen.get(key).set(block, line);
      }
    }
    const repeated = [...seen].filter(([, blocks]) => blocks.size > 1)
      .map(([key, blocks]) => `${key.split(' || ')[1]} (${[...blocks.values()].join(', ')})`);
    assert.deepEqual(repeated, [], `${file}: seletor repetido: ${repeated.join('; ')}`);
  }
});

test('a escala z e crescente e todo token z usado existe', () => {
  const tokens = declarations(cssByFile.get('tokens.css')).filter(({ property, stack }) => (
    /^--z-/.test(property) && isRootBlock(stack)
  ));
  const values = tokens.map(({ property, value }) => ({ property, value: Number(value) }));
  assert.ok(values.length > 0, 'tokens.css precisa declarar a escala --z-*');
  assert.ok(values.every(({ value }) => Number.isFinite(value)), '--z-* precisa ter valor numerico');
  assert.ok(values.every(({ value }, index) => index === 0 || value > values[index - 1].value),
    '--z-* precisa estar em ordem crescente');
  const names = new Set(values.map(({ property }) => property));
  for (const [file, source] of cssByFile) {
    const missing = [...source.matchAll(/var\((--z-[\w-]+)\)/g)]
      .map((match) => match[1]).filter((name) => !names.has(name));
    assert.deepEqual(missing, [], `${file}: --z-* sem token: ${missing.join(', ')}`);
  }
});

test('todo CSS Sinal fecha cada chave que abre', () => {
  for (const [file, source] of cssByFile) {
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    let level = 0;
    for (const char of clean) {
      if (char === '{') level += 1;
      if (char === '}') level -= 1;
      assert.ok(level >= 0, `${file}: fecha chave sem abertura`);
    }
    assert.equal(level, 0, `${file}: chave sem fechamento`);
  }
});

test('a Sala preserva os contratos de compositor, HUD, tela cheia e h1', () => {
  const shell = cssByFile.get('shell.css');
  const compose = declarations(shell).filter(({ stack }) => stack.at(-1) === '.compose__box');
  const minHeight = compose.find(({ property }) => property === 'min-height')?.value;
  assert.ok(minHeight && Number.parseFloat(minHeight) >= 28,
    '.compose__box precisa de alvo minimo de 28px');
  assert.match(shell, /body\.room-idle[^{}]*\.tile__hud\s*\{[^}]*opacity:\s*0/s,
    'body.room-idle precisa esconder o HUD do tile');

  const tokens = new Map(declarations(cssByFile.get('tokens.css'))
    .filter(({ property, stack }) => /^--z-/.test(property) && isRootBlock(stack))
    .map(({ property, value }) => [property, Number(value)]));
  const z = declarations(shell)
    .find(({ stack, property }) => stack.at(-1) === '.tile.fullscreen' && property === 'z-index')?.value;
  const zToken = z?.match(/^var\((--z-[\w-]+)\)$/)?.[1];
  assert.ok(zToken && tokens.get(zToken) > tokens.get('--z-chrome'),
    '.tile.fullscreen precisa ficar acima de --z-chrome');

  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /<h1\b[^>]*id="room-screen-title"[^>]*>/,
    'a tela da sala precisa de #room-screen-title em h1');
});

const lerRenderer = (nome) => fs.readFileSync(path.join(__dirname, nome), 'utf8').split('\r\n').join('\n');

test('a barra de baixo agrupa transmitir, camera e Pôr na Mesa; a Conversa fica sozinha no fim', () => {
  const html = lerRenderer('index.html');
  const rodape = html.slice(html.indexOf('<footer class="bus"'), html.indexOf('</footer>', html.indexOf('<footer class="bus"')));
  const grupo = rodape.slice(rodape.indexOf('<div class="bus__acts">'), rodape.indexOf('<div class="bus__end">'));
  for (const id of ['me-source', 'btn-toggle-share', 'btn-toggle-camera', 'btn-mesa-add']) {
    assert.ok(grupo.includes(`id="${id}"`), `#${id} precisa morar em .bus__acts`);
  }
  assert.ok(!grupo.includes('btn-conv-toggle'), 'a Conversa fica fora do grupo');
  assert.match(rodape, /<span class="bus__sep"><\/span>\s*<div class="bus__acts">/, 'separador antes do grupo');
  assert.match(rodape, /<\/div>\s*<span class="bus__sep"><\/span>\s*<div class="bus__end">/, 'separador depois');
  const fim = rodape.slice(rodape.indexOf('<div class="bus__end">'));
  assert.ok(fim.includes('id="btn-conv-toggle"') && !fim.includes('btn-toggle-camera'));
  const gap = declarations(cssByFile.get('shell.css'))
    .find(({ stack, property }) => stack.at(-1) === '.bus__acts' && property === 'gap')?.value;
  assert.match(gap, /^var\(--s-\d+\)$/, '.bus__acts usa token de espaco');
});

test('Pessoas e Sair da sala na cabeca usam os componentes do Sinal', () => {
  const html = lerRenderer('index.html');
  const pessoas = html.match(/<button id="btn-room-presence"[\s\S]*?<\/button>/)[0];
  assert.match(pessoas, /class="btn btn--quiet btn--sm"/);
  assert.match(pessoas, /href="#i-users"/);
  assert.match(pessoas, /title="Pessoas"/);
  assert.ok(!/Pessoas na sala|'NA SALA'/.test(html + lerRenderer('ui.js')), 'so "Pessoas", sem "na sala"');
  assert.ok(!html.includes('presence-nodes'), 'sem o aglomerado de bolinhas');
  assert.ok(html.includes('<span class="tx-tag">Pessoas · '), 'cabecalho do popover sem repetir "Na sala"');
  const sair = html.match(/<button id="btn-disconnect"[\s\S]*?<\/button>/)[0];
  assert.match(sair, /class="btn btn--danger btn--sm"/);
  assert.match(sair, /href="#i-log-out"/);
  assert.match(sair, />Sair da sala</);
  assert.ok(!/--live/.test(sair));
});

test('os menus da Mesa moram no body, fora da secao que isola o empilhamento', () => {
  const fonte = lerRenderer('mesa-view.js');
  assert.ok(!/<div class="mesa-menu pop"/.test(fonte), 'menu nao pode nascer dentro do template da secao');
  assert.match(fonte, /document\.body\.appendChild\(el\)/);
  assert.match(fonte, /s\.menuEl\.remove\(\);\s*s\.subEl\.remove\(\);/, 'sair da Mesa remove os menus');
  const z = declarations(cssByFile.get('mesa.css'))
    .find(({ stack, property }) => stack.at(-1) === '.mesa-menu' && property === 'z-index')?.value;
  assert.equal(z, 'var(--z-popover)');
});

test('espiar mostra as ultimas mensagens na hora e explica quando nao ha nenhuma', () => {
  const ui = lerRenderer('ui.js');
  const app = lerRenderer('app.js');
  assert.match(ui, /function espiarRecentes\(\)/);
  assert.match(ui, /Espiando: mensagens novas aparecem aqui\./);
  assert.match(app, /setConversation\('peek', \{ persist: true \}\);\s*[^]*?ui\.chat\.espiarRecentes\(\);/);
  const html = lerRenderer('index.html');
  const botao = html.match(/<button id="btn-conv-peek"[\s\S]*?<\/button>/)[0];
  const rotulo = 'Espiar: esconder a coluna e mostrar só as mensagens novas';
  assert.ok(botao.includes(`aria-label="${rotulo}"`) && botao.includes(`title="${rotulo}"`));
});

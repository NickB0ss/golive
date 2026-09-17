'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, 'style.css');

test('botao de novas mensagens nao fica dentro da lista limpa pelo historico', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const chatMessages = html.match(/<div id="chat-messages"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(chatMessages, 'a lista de mensagens do chat precisa existir');
  // setHistory limpa #chat-messages com innerHTML; o botao perderia o DOM
  // junto com o historico se voltasse a ser filho direto da lista.
  assert.ok(!chatMessages[1].includes('chat-jump-new'), 'o botao de novas mensagens precisa ficar fora da lista');
});

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

function declarations(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const stack = [];
  let segment = '';
  let line = 1;

  // A ultima declaracao de um bloco pode vir sem ';' (`.x { color: #fff }`):
  // fechar o bloco tambem conta como fim de declaracao, senao ela escapava.
  const flush = () => {
    const match = segment.match(/^\s*([\w-]+)\s*:\s*([^;{}]+)$/);
    if (match) found.push({ property: match[1], value: match[2].trim(), stack: [...stack], line });
    segment = '';
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\n') line += 1;
    if (char === '{') {
      stack.push(segment.trim());
      segment = '';
    } else if (char === '}') {
      flush();
      stack.pop();
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
  return stack.some((entry) => /^:root(?:\[data-theme=(?:"[^"]+"|'[^']+'|[^\]]+)\])?$/.test(entry));
}

// Excecao legada documentada: o botao nativo de fechar ainda usa as cores
// do Windows, e esta frente nao reescreve sua aparencia.
const ALLOWED_LITERAL_SELECTORS = new Set([
  '.titlebar-btn-close:hover',
  '.titlebar-btn-close:active',
]);

test('style.css respeita piso de 11px e nao usa backdrop-filter', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules = declarations(css);
  // `!important` nao muda o tamanho -- sem aceita-lo, `10px !important` passava.
  const small = rules.filter(({ property, value }) => property === 'font-size' && /^\d+(?:\.\d+)?px(?:\s*!important)?$/.test(value) && Number.parseFloat(value) < 11);
  assert.deepEqual(small, [], `font-size abaixo de 11px: ${small.map((rule) => `${rule.line}: ${rule.value}`).join(', ')}`);
  assert.deepEqual(rules.filter(({ property }) => property === 'backdrop-filter'), [], 'backdrop-filter e proibido');
});

test('cores literais ficam restritas aos tokens dos blocos de tema', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl)\(/i;
  const violations = declarations(css).filter(({ value, stack }) => (
    literal.test(value) && !isRootBlock(stack) && !ALLOWED_LITERAL_SELECTORS.has(stack.at(-1))
  ));
  assert.deepEqual(violations, [], `cor literal fora de bloco de tema: ${violations.map((rule) => `${rule.line}: ${rule.stack.at(-1)} -> ${rule.value}`).join('; ')}`);
});

test('estrutura moderna mantem dock no fluxo e camadas por tokens', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.match(css, /--z-stage:\s*\d+;/, 'falta token da camada do palco');
  assert.match(css, /--z-popover:\s*\d+;/, 'falta token da camada de popovers');
  assert.match(css, /--z-modal:\s*\d+;/, 'falta token da camada de dialogos');
  assert.match(css, /--z-toast:\s*\d+;/, 'falta token da camada de toasts');
  assert.match(css, /--z-titlebar:\s*\d+;/, 'falta token da camada da faixa de titulo');
  assert.match(css, /\.control-bar\s*\{[^}]*position:\s*static;/s, 'o dock deve permanecer no fluxo');
  assert.match(css, /\.room-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(260px, 1fr\)\)/s, 'a lista de salas deve ser uma grade de cards');
});

test('a casca da sala fica escondida com um tile em tela cheia', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  // visibility (e nao display): mata pintura e clique de TODOS os
  // descendentes, qualquer que seja o z-index deles, e preserva o layout --
  // tirar o dock do fluxo faria a grade atras recalcular tamanho de tile
  // pra um layout que ninguem esta vendo.
  for (const alvo of ['.stage-header', '.control-bar', '.room-side']) {
    const re = new RegExp(`body:has\\(\\.tile\\.fullscreen\\)[^{]*${alvo.replace('.', '\\.')}` + `[^{]*\\{[^}]*visibility:\\s*hidden`, 's');
    assert.match(css, re, `${alvo} precisa ser escondido em tela cheia`);
  }
});

test('o campo do chat tem a mesma altura dos botoes da caixa', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rules = declarations(css).filter(({ stack }) => stack.at(-1) === '.chat-compose textarea');
  const byProp = Object.fromEntries(rules.map(({ property, value }) => [property, value]));
  const buttonRules = declarations(css).filter(({ stack }) => stack.at(-1) === '.chat-compose-btn');
  const buttonByProp = Object.fromEntries(buttonRules.map(({ property, value }) => [property, value]));
  // Os .chat-compose-btn tem 28px. Coladas pela base (align-items: flex-end),
  // duas caixas de MESMA altura centralizam o texto contra os icones; com
  // alturas diferentes o placeholder fica ~3px abaixo -- o bug relatado.
  assert.equal(byProp['min-height'], '28px', 'o textarea precisa casar com os 28px do botao');
  assert.equal(byProp.padding, '5px 0', '17.5px de linha + 10 de padding = 27.5 ~ 28');
  assert.equal(buttonByProp.height, '28px', 'o botao da caixa precisa ter 28px de altura');
  assert.equal(buttonByProp['min-height'], '0', 'o minimo global de 44px nao pode esticar o botao da caixa');
});

test('estado vazio da grade nao vaza para outros elementos', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const unscoped = declarations(css).filter(({ stack }) => /^\.empty(?:::?(?:before|after))?$/.test(stack.at(-1)));
  assert.deepEqual(unscoped, [], `seletor .empty sem escopo: ${unscoped.map((rule) => rule.line).join(', ')}`);
});

test('todo overlay do tile some com o mouse parado', () => {
  const css = fs.readFileSync(cssPath, 'utf8');

  // Excecoes declaradas, em tres grupos, cada um dispensado por um motivo
  // diferente (spec 2026-09-15, frente 4.2):
  //   conteudo -- um rabisco ou uma reacao que chega com o mouse parado
  //               PRECISA aparecer, senao o recurso so funciona pra quem
  //               esta mexendo no mouse;
  //   estado   -- esconder deixaria uma tela preta sem explicacao;
  //   herdado  -- descendente de quem ja tem a regra, some junto.
  const EXCECOES = new Set([
    '.tile-annot-canvas', '.tile-react-pops', '.tile-react-pop', '.pip-strip', // conteudo
    '.tile-paused', '.tile-paused-shot', '.tile-gate',                         // estado
    '.tile-watchers-panel',                                                    // herdado
  ]);

  const rules = declarations(css);
  const overlays = new Set(
    rules
      .filter(({ property, value, stack }) =>
        property === 'position' && value === 'absolute'
        && selectorParts(stack.at(-1) || '').some((selector) => /^\.tile-[\w-]+$/.test(selector)))
      .flatMap(({ stack }) => selectorParts(stack.at(-1) || '').filter((selector) => /^\.tile-[\w-]+$/.test(selector))),
  );

  const semSumico = [...overlays].filter((sel) => {
    if (EXCECOES.has(sel)) return false;
    // As duas sao alcances do MESMO timer (ui.js, IDLE_MS): .tile.fullscreen.idle
    // cobre o que e so do tile, body.room-idle cobre o que tambem some em janela.
    // O limite nao aceita hifen: `\\b` tambem aceitaria .tile-watchers-eye.
    return !rules.some(({ property, value, stack }) => {
      if (stack.length !== 1 || !(
        (property === 'opacity' && value === '0')
        || (property === 'visibility' && value === 'hidden')
        || (property === 'display' && value === 'none')
      )) return false;
      return selectorParts(stack[0]).some((selector) => (
        (selector.includes('.tile.fullscreen.idle') || selector.includes('.room-idle'))
        && new RegExp(`${sel.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?![\\w-])$`).test(selector)
      ));
    });
  });

  assert.deepEqual(semSumico, [], `overlay do tile sem regra de ociosidade: ${semSumico.join(', ')}`);
});

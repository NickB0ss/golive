'use strict';

// Config flat do ESLint. O projeto nao tem bundler nem transpilador: cada
// arquivo e carregado direto pelo Node (processo principal e server/), pelo
// preload do Electron ou por uma <script> classica no index.html. Por isso a
// config e dividida por AMBIENTE em vez de valer uma unica lista de globais
// pro repositorio inteiro -- errar o ambiente faria o no-undef acusar
// `window` no main e `require` no renderer.
const globals = require('globals');

// Aproximacao sintatica do no-floating-promises do typescript-eslint, que
// aqui nao da pra usar: aquela regra depende de type info pra saber se uma
// expressao qualquer e Thenable, e este projeto e JS puro sem tsconfig.
// Entao a regra local so acusa os dois casos em que a promessa esta VISIVEL
// no proprio arquivo:
//   1. cadeia `.then(...)` usada como statement, sem `.catch()` e sem o
//      segundo argumento de `.then()` em nenhum elo da cadeia;
//   2. chamada de funcao `async` declarada e resolvida NESTE arquivo, usada
//      como statement, sem await, sem void e sem tratamento encadeado.
// Chamada a funcao vinda de fora do arquivo (require, window.GoLive.*, API
// do DOM) fica de fora de proposito: sem type info nao da pra distinguir
// `fetch(url)` de `console.log(x)`, e chutar viraria falso positivo em
// massa. E rede de seguranca, nao garantia -- ver item C7 da auditoria.
const noFloatingPromise = {
  meta: {
    type: 'problem',
    docs: { description: 'promessa usada como statement sem tratamento de rejeicao' },
    schema: [],
    messages: {
      floating: 'Promessa solta: nada trata a rejeicao. Encadeie .catch(), use await dentro de try/catch, ou marque como deliberada com `void`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    // O relatorio so pode sair no fim: `foo()` pode aparecer antes da
    // declaracao de `async function foo`, e o escopo so esta completo com o
    // Program inteiro percorrido.
    const candidates = [];

    // Anda pra tras na cadeia (a().b().c()) procurando quem trata rejeicao.
    // `.finally()` NAO conta: ele repassa a rejeicao adiante.
    function handlesRejection(node) {
      for (let cur = node; cur && cur.type === 'CallExpression'; ) {
        const callee = cur.callee;
        if (callee.type !== 'MemberExpression') break;
        const name = callee.property.type === 'Identifier' ? callee.property.name : null;
        if (name === 'catch') return true;
        if (name === 'then' && cur.arguments.length > 1) return true;
        cur = callee.object;
      }
      return false;
    }

    function isThenChain(node) {
      for (let cur = node; cur && cur.type === 'CallExpression'; ) {
        const callee = cur.callee;
        if (callee.type !== 'MemberExpression') break;
        if (callee.property.type === 'Identifier' && callee.property.name === 'then') return true;
        cur = callee.object;
      }
      return false;
    }

    // So o identificador na RAIZ da cadeia: `foo().then(...)` -> "foo".
    // `obj.metodo()` devolve null (nao da pra resolver o metodo sem type info).
    function rootCalleeName(node) {
      for (let cur = node; cur && cur.type === 'CallExpression'; ) {
        const callee = cur.callee;
        if (callee.type === 'Identifier') return callee.name;
        if (callee.type !== 'MemberExpression') return null;
        cur = callee.object;
      }
      return null;
    }

    function lookup(scope, name) {
      for (let s = scope; s; s = s.upper) {
        const variable = s.set.get(name);
        if (variable) return variable;
      }
      return null;
    }

    function isLocalAsyncFunction(variable) {
      if (!variable) return false;
      return variable.defs.some((def) => {
        const node = def.node;
        if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') return node.async === true;
        if (node.type === 'VariableDeclarator' && node.init) {
          const init = node.init;
          return (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') && init.async === true;
        }
        return false;
      });
    }

    return {
      'ExpressionStatement > CallExpression'(node) {
        if (handlesRejection(node)) return;
        if (isThenChain(node)) {
          candidates.push({ node, name: null });
          return;
        }
        const name = rootCalleeName(node);
        if (name) candidates.push({ node, name, scope: sourceCode.getScope(node) });
      },
      'Program:exit'() {
        for (const { node, name, scope } of candidates) {
          if (name !== null && !isLocalAsyncFunction(lookup(scope, name))) continue;
          context.report({ node, messageId: 'floating' });
        }
      },
    };
  },
};

// Regras de CORRECAO, nao de estilo: a auditoria (item C7) pediu lint pra
// pegar defeito, e o projeto nao tem formatador -- ligar regra estetica aqui
// so geraria ruido e diff sem valor de revisao.
const correctness = {
  // O alvo do item C7: promessa que ninguem observa. Fica em 'warn' porque
  // os 10 pontos que ela acha hoje sao reais mas nao tem correcao mecanica
  // (mudar `f()` pra `await f()` muda a ordem de execucao do app, e engolir
  // com .catch(() => {}) esconde defeito) -- transformar em 'error' agora
  // travaria o CI numa divida que a auditoria quer VER, nao mascarar.
  'local/no-floating-promise': 'warn',
  'no-async-promise-executor': 'error',
  'no-promise-executor-return': 'error',
  // Tambem em 'warn': em JS single-thread o padrao "flag de reentrancia"
  // (`sharing = true` ... `finally { sharing = false }`) e os caches
  // `if (x === null) x = await ...` sao indistinguiveis de uma corrida de
  // verdade pra regra, e o codigo usa os dois de proposito. allowProperties
  // corta os casos `obj.prop = await ...`, que sao os mais ruidosos.
  'require-atomic-updates': ['warn', { allowProperties: true }],

  // Defeitos que so aparecem em runtime, e sempre no pior momento.
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-fallthrough': 'error',
  'no-constant-condition': 'error',
  'no-constant-binary-expression': 'error',
  'no-unreachable': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-unsafe-finally': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-func-assign': 'error',
  'no-class-assign': 'error',
  'no-const-assign': 'error',
  'no-global-assign': 'error',
  'no-shadow-restricted-names': 'error',
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-compare-neg-zero': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-sparse-arrays': 'error',
  'no-ex-assign': 'error',
  'no-invalid-regexp': 'error',
  'no-control-regex': 'error',
  'no-misleading-character-class': 'error',
  'no-useless-backreference': 'error',
  'no-octal': 'error',
  'no-loss-of-precision': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-obj-calls': 'error',
  'no-setter-return': 'error',
  'getter-return': 'error',
  'constructor-super': 'error',
  'no-this-before-super': 'error',
  'use-isnan': 'error',
  'valid-typeof': ['error', { requireStringLiterals: true }],
  'no-debugger': 'error',
  'no-with': 'error',
  'no-useless-catch': 'error',
  'no-unused-labels': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'error',
  'no-irregular-whitespace': 'error',
};

const localPlugin = { rules: { 'no-floating-promise': noFloatingPromise } };

module.exports = [
  {
    ignores: ['build/**', 'dist/**', 'native/**'],
  },

  {
    files: ['**/*.js'],
    plugins: { local: localPlugin },
    languageOptions: { ecmaVersion: 2022 },
    // Um `eslint-disable` que nao silencia mais nada e comentario mentindo
    // sobre o codigo -- quebra o build pra ser removido.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: correctness,
  },

  // Processo principal, server/ e os scripts de build: CommonJS puro no Node.
  {
    files: ['src/main.js', 'src/main/**/*.js', 'server/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },

  // Os preloads rodam no processo de renderizacao mas com require() do
  // Electron: sao os unicos arquivos que enxergam os dois mundos ao mesmo
  // tempo. Sao dois -- o do app e o da janela de rabisco.
  {
    files: ['src/preload.js', 'src/preload-overlay.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },

  // Renderer: <script> classicas que compartilham o escopo global via
  // window.GoLive.*, NAO modulos ES nem CommonJS. `module` e `global` sao os
  // dois unicos nomes de Node que aparecem, e so no rodape
  // `if (typeof module !== 'undefined') module.exports = api;` / no
  // `(typeof window !== 'undefined' ? window : global)` da IIFE, que existem
  // pra estes mesmos arquivos serem carregaveis pelo `node --test`. Entram
  // como somente-leitura: qualquer outro nome de Node aqui e engano, e o
  // no-undef deve acusar.
  {
    files: ['src/renderer/*.js'],
    ignores: ['src/renderer/*.test.js', 'src/renderer/pcm-injector-worklet.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        module: 'readonly',
        global: 'readonly',
      },
    },
  },

  // O worklet roda no AudioWorkletGlobalScope: sem window, sem DOM.
  {
    files: ['src/renderer/pcm-injector-worklet.js'],
    languageOptions: { sourceType: 'script', globals: globals.audioWorklet },
  },

  // Os *.test.js rodam no `node --test`: CommonJS + os globais de teste do Node.
  {
    files: ['**/*.test.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: {
      // Os testes esperam evento com `await new Promise((r) => ws.once('open', r))`
      // e `(r) => setTimeout(r, 10)`. O valor devolvido ai e o id do timer /
      // o proprio emitter, que ninguem le -- a regra vale pro codigo de
      // producao, onde um `return` dentro do executor costuma ser engano.
      'no-promise-executor-return': 'off',
    },
  },
];

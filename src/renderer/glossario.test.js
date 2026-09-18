'use strict';

// Trava a regressao do glossario (docs/glossario.md): um termo por conceito,
// depois que a auditoria de 2026-09-18 achou QUATRO nomes pro mesmo papel
// ("dono", "lider", "host", "anfitriao") espalhados pela interface, tres
// deles em mensagem de erro.
//
// Heuristica (deliberadamente simples, documentada aqui em vez de escondida):
//
// 1. Um tokenizador de string minimo varre app.js/ui.js caractere a
//    caractere e devolve so os TRECHOS LITERAIS de aspas simples, aspas
//    duplas e template strings -- pulando comentarios (// e /* */) e o
//    CONTEUDO das interpolacoes ${...} de um template (ali mora codigo,
//    tipo `${espectador}` como chave de Map, nao texto pra pessoa ler).
//    Sem isso, um "//" dentro de uma string de verdade (`ws://...`) seria
//    lido como inicio de comentario e corrompia tudo depois na mesma linha
//    -- bug real, achado rodando contra o proprio app.js (linha com
//    `addr.startsWith('ws://')`) na primeira versao deste teste.
// 2. Nem todo literal de string e texto pra pessoa ler: `'host-left'` (razao
//    de fechamento do WebSocket), nomes de classe CSS, chaves de objeto etc
//    tambem sao strings JS. Filtro: só vira candidato quem tem ESPACO ou uma
//    letra acentuada -- identificador de codigo neste projeto e sempre
//    ASCII e sem espaco; frase em portugues visivel praticamente sempre tem
//    um dos dois ("Sair da sala", "líder", "assistindo").
// 3. `console.*(...)` e excluido à parte: sao logs de depuracao (devtools),
//    nao texto que a pessoa usando o app ve -- e usam o mesmo vocabulario
//    tecnico interno ("host", "peer") que o resto do arquivo evita na UI de
//    proposito (ver app.js:2737).
//
// index.html e mais simples: texto entre tags e os atributos que a pessoa
// le (title/aria-label/placeholder/alt).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;

// Termo -> explicacao. So o papel de "quem manda na sala" tem varios
// sinonimos proibidos; os demais conceitos tem um so termo permitido. Ver
// docs/glossario.md pro porque de "líder da sala" ter vencido "dono da sala"
// na contagem.
const PROHIBITED = [
  [/\bhost\b/i, 'use "líder da sala" (nunca "host")'],
  [/\banfitri[ãa]o\b/i, 'use "líder da sala" (nunca "anfitrião")'],
  [/\bdono\b/i, 'use "líder da sala" (nunca "dono" -- ver docs/glossario.md)'],
  [/\bespectador(a|es)?\b/i, 'use "pessoa assistindo" / "quem está assistindo" (nunca "espectador")'],
  [/\banota[çc][ãa]o(es)?\b/i, 'use "rabisco" (nunca "anotação")'],
  [/\bdesconectar\b/i, 'use "Sair da sala" (nunca "desconectar")'],
  [/\bmembro(s)?\b/i, 'use "pessoa" (nunca "membro")'],
  [/\bparticipante(s)?\b/i, 'use "pessoa" (nunca "participante")'],
  [/\bpeer(s)?\b/i, 'use "pessoa" (nunca "peer")'],
];

// Contextos depois dos quais um '/' e INICIO DE REGEX, nao divisao -- o
// mesmo dilema classico de qualquer tokenizador de JS de verdade. Sem isso,
// `/[&<>"']/g` (o escapeHtml do proprio ui.js) tinha um '"' e um '\'' DENTRO
// da classe de caracteres, e o tokenizador entrava em modo "string" no meio
// do regex e so resincronizava varias linhas depois -- achado rodando
// contra o proprio arquivo na segunda versao deste teste. Cobre todo regex
// literal hoje existente em app.js/ui.js (conferido a mao: todos vem logo
// depois de `(`, `!` ou `&&`).
const REGEX_STARTS_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^', '',
]);

/** Tokenizador minimo: devolve so os trechos literais de string/template de
 * um arquivo JS, pulando comentarios, regex literais, o codigo fora de
 * string e o conteudo de ${...} dentro de template. Rastreia aspas/backtick/
 * regex char a char (em vez de regex line-based) porque uma primeira versao
 * baseada em `$` por linha quebrava com final de linha CRLF -- o `$` sem
 * `/m` nunca casava antes do `\r` residual, entao nenhum comentario era
 * removido de verdade. */
function extractStringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let buf = '';
  let lastSignificant = ''; // ultimo char nao-espaco fora de string/comentario
  const flush = () => { if (buf) out.push(buf); buf = ''; };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '/' && REGEX_STARTS_AFTER.has(lastSignificant)) {
      i += 1;
      let inClass = false;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i += 1; break; }
        else if (src[i] === '\n') break; // regex nao atravessa linha -- seguranca
        i += 1;
      }
      while (i < n && /[a-z]/i.test(src[i])) i += 1; // flags (g, i, ...)
      lastSignificant = '/';
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { i += 2; continue; }
        buf += src[i];
        i += 1;
      }
      i += 1; // fecha aspas
      flush();
      lastSignificant = quote;
      continue;
    }
    if (c === '`') {
      i += 1;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          flush();
          i += 2;
          let depth = 1;
          // O conteudo de ${...} e codigo (variavel, chamada, ate outro
          // template aninhado) -- pulado inteiro, so a profundidade de
          // chaves importa pra achar o fim certo.
          while (i < n && depth > 0) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') depth -= 1;
            i += 1;
          }
          continue;
        }
        buf += src[i];
        i += 1;
      }
      i += 1; // fecha backtick
      flush();
      lastSignificant = '`';
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i += 1;
  }
  return out;
}

const HAS_SPACE_OR_ACCENT = /[ À-ÿ]/; // espaco, ou acento/cedilha latino-1

function isVisibleText(literal) {
  return HAS_SPACE_OR_ACCENT.test(literal);
}

// Muitos literais extraidos sao pedacos de HTML inteiros (innerHTML gerado
// em ui.js), nao texto corrido -- e a marcacao tem nome de classe kebab-case
// que pode conter um termo proibido como SUBSTRING de identificador
// (`class="peer-avatar"` tem "peer" com fronteira de palavra valida pro
// regex, mas nao e a palavra "peer" pra pessoa ler). Por isso, quando o
// literal parece HTML (tem '<'), so os NOS DE TEXTO e os atributos que a
// pessoa realmente le (title/aria-label/placeholder/alt) viram candidato --
// igual index.html. Fora isso (mensagem de texto corrido, sem HTML), o
// literal inteiro e o candidato.
function visibleFragments(literal) {
  if (!literal.includes('<')) return [literal];
  const texts = [...literal.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  const attrs = [...literal.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  return [...texts, ...attrs];
}

function checkTexts(texts, label, violations) {
  for (const raw of texts) {
    for (const text of visibleFragments(raw)) {
      if (!isVisibleText(text)) continue;
      for (const [re, hint] of PROHIBITED) {
        if (re.test(text)) violations.push(`${label}: "${text.trim().slice(0, 80)}" -- ${hint}`);
      }
    }
  }
}

// Remove so as CHAMADAS console.foo(...) (balanceando parenteses), pra nao
// varrer log de depuracao -- que usa de proposito o vocabulario tecnico
// interno ("host", "peer") que a UI evita. O resto da linha (efeitos depois
// da chamada) fica.
function stripConsoleCalls(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const CONSOLE_RE = /console\.(?:log|info|warn|error|debug)\s*\(/y;
  while (i < n) {
    CONSOLE_RE.lastIndex = i;
    const m = CONSOLE_RE.exec(src);
    if (m && m.index === i) {
      i += m[0].length;
      let depth = 1;
      while (i < n && depth > 0) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') depth -= 1;
        i += 1;
      }
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

function checkJsFile(file, violations) {
  const src = stripConsoleCalls(fs.readFileSync(path.join(DIR, file), 'utf8'));
  checkTexts(extractStringLiterals(src), file, violations);
}

// HTML: texto entre tags (">texto<") e os atributos que a pessoa le
// (title, aria-label, placeholder, alt). O innerHTML gerado via JS ja foi
// coberto pelo extractStringLiterals de app.js/ui.js -- aqui e so o HTML
// estatico do index.html.
function checkHtmlFile(file, violations) {
  const html = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
  const texts = [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]);
  const attrs = [...html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  checkTexts([...texts, ...attrs], file, violations);
}

test('nenhum termo proibido do glossario aparece em texto visivel', () => {
  const violations = [];
  checkJsFile('app.js', violations);
  checkJsFile('ui.js', violations);
  checkHtmlFile('index.html', violations);
  assert.deepEqual(violations, [], `termos proibidos (ver docs/glossario.md):\n${violations.join('\n')}`);
});

// Controle de sanidade: se a heuristica de extracao quebrar (ex: o
// tokenizador parar de achar string nenhuma), o teste acima passaria vazio
// sem checar nada de verdade. Isto garante que ela acha texto visivel de
// verdade nos tres arquivos, e que um caso conhecido de risco (`//` DENTRO
// de uma string de verdade) continua sendo tratado certo.
test('a extracao de texto visivel realmente encontra strings (controle de sanidade)', () => {
  const appSrc = stripConsoleCalls(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
  const appTexts = extractStringLiterals(appSrc);
  assert.ok(appTexts.some((t) => t.includes('sala')), 'app.js precisa ter strings visiveis com "sala"');
  // 'ws://' tem "//" dentro da propria string -- se o tokenizador tratasse
  // isso como comentario, o resto da linha desapareceria e este literal
  // nunca apareceria inteiro na lista.
  assert.ok(appTexts.some((t) => t === 'ws://'), 'uma string com "//" dentro (ws://) precisa sobreviver inteira');

  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(html, />Sair da sala</, 'o rotulo do botao de sair precisa existir no HTML');
});

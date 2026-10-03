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
const { extrairLiterais, fragmentosVisiveis } = require('../../tools/i18n/literais');

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
  // Mesa (2026-09-24). So o que nao tem outro sentido no app: "card" e
  // "item" viram nome de classe CSS, "fechar"/"remover"/"câmera" sao
  // palavras legitimas em outros lugares -- ai so a combinacao com a
  // janela/mesa e cobrada.
  [/\btipo da sala\b/i, 'use "vista" (Transmissão / Mesa) -- cada pessoa escolhe a sua, nao e tipo da sala'],
  [/\bmodo (mesa|transmiss[ãa]o)\b/i, 'use "vista Mesa" / "vista Transmissão" (nunca "modo")'],
  [/\blayout\b/i, 'use "vista" (nunca "layout")'],
  [/\bcanvas\b/i, 'use "Mesa" (nunca "canvas")'],
  [/\bwidgets?\b/i, 'use "janela" (nunca "widget")'],
  [/\b(inserir|fechar|remover) (a |uma |esta |essa )?janela\b/i, 'use "Adicionar janela" / "Tirar da mesa"'],
  [/\bremover da mesa\b/i, 'use "Tirar da mesa" (nunca "remover")'],
  [/\bmaximizar\b/i, 'use "Tela cheia" (nunca "maximizar")'],
  [/\bviewport\b/i, 'use "Ver tudo" / "Ir até" (nunca "viewport")'],
];

const HAS_SPACE_OR_ACCENT = /[ À-ÿ]/; // espaco, ou acento/cedilha latino-1

function isVisibleText(literal) {
  return HAS_SPACE_OR_ACCENT.test(literal);
}

function checkTexts(texts, label, violations) {
  for (const raw of texts) {
    for (const text of fragmentosVisiveis(raw)) {
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
  checkTexts(extrairLiterais(src).map((literal) => literal.texto), file, violations);
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
  // A casca da Mesa (fase 1 da spec) entra na varredura assim que existir.
  if (fs.existsSync(path.join(DIR, 'mesa-view.js'))) checkJsFile('mesa-view.js', violations);
  checkHtmlFile('index.html', violations);
  assert.deepEqual(violations, [], `termos proibidos (ver docs/glossario.md):\n${violations.join('\n')}`);
});

// Os nomes do menu "Adicionar janela" vem dos modulos (title), nao do
// app.js/ui.js -- entao sao conferidos aqui, direto do registro.
test('os nomes dos tipos de janela da Mesa seguem o glossario', () => {
  const registry = require('./mesa-modules/index');
  const violations = [];
  checkTexts(registry.list().map((m) => ` ${m.title} `), 'mesa-modules', violations);
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('os termos da Mesa reprovam o que o glossario proibe e deixam passar o certo', () => {
  const reprova = ['Mudar o tipo da sala', 'modo Mesa', 'Fechar janela', 'Remover da mesa', 'Maximizar a janela', 'Novo widget'];
  const passa = ['Adicionar janela', 'Tirar da mesa', 'Tela cheia', 'Ver tudo', 'Ir até Bia', 'vista Mesa', 'Escolha uma tela ou janela'];
  for (const text of reprova) {
    const v = [];
    checkTexts([text], 'amostra', v);
    assert.ok(v.length > 0, `devia reprovar: ${text}`);
  }
  for (const text of passa) {
    const v = [];
    checkTexts([text], 'amostra', v);
    assert.deepEqual(v, [], `devia passar: ${text}`);
  }
});

// Controle de sanidade: se a heuristica de extracao quebrar (ex: o
// tokenizador parar de achar string nenhuma), o teste acima passaria vazio
// sem checar nada de verdade. Isto garante que ela acha texto visivel de
// verdade nos tres arquivos, e que um caso conhecido de risco (`//` DENTRO
// de uma string de verdade) continua sendo tratado certo.
test('a extracao de texto visivel realmente encontra strings (controle de sanidade)', () => {
  const appSrc = stripConsoleCalls(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
  const appTexts = extrairLiterais(appSrc).map((literal) => literal.texto);
  assert.ok(appTexts.some((t) => t.includes('sala')), 'app.js precisa ter strings visiveis com "sala"');
  // 'ws://' tem "//" dentro da propria string -- se o tokenizador tratasse
  // isso como comentario, o resto da linha desapareceria e este literal
  // nunca apareceria inteiro na lista.
  assert.ok(appTexts.some((t) => t === 'ws://'), 'uma string com "//" dentro (ws://) precisa sobreviver inteira');

  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  assert.match(html, /id="btn-disconnect"[\s\S]*?>Sair da sala</, 'o botao principal de sair precisa existir no HTML');
});

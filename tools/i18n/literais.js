'use strict';

// Contextos depois dos quais um '/' e inicio de regex, nao divisao. Sem isso,
// uma classe de caracteres pode fazer o tokenizador ler aspas como string.
const REGEX_STARTS_AFTER = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^', '',
]);

/**
 * Devolve trechos literais de aspas simples, duplas e templates, ignorando
 * comentarios, regex e o codigo dentro de ${...}. A linha e a do inicio do
 * literal, para a catraca apontar o local que precisa de traducao.
 */
function extrairLiterais(src) {
  const out = [];
  let i = 0;
  let linha = 1;
  let ultimo = '';

  function avancar(quantidade = 1) {
    for (let indice = 0; indice < quantidade && i < src.length; indice += 1) {
      if (src[i] === '\n') linha += 1;
      i += 1;
    }
  }

  function salvar(texto, linhaInicio) {
    if (texto) out.push({ texto, linha: linhaInicio });
  }

  while (i < src.length) {
    const atual = src[i];
    const proximo = src[i + 1];

    if (atual === '/' && proximo === '/') {
      while (i < src.length && src[i] !== '\n') avancar();
      continue;
    }
    if (atual === '/' && proximo === '*') {
      avancar(2);
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) avancar();
      avancar(2);
      continue;
    }
    if (atual === '/' && REGEX_STARTS_AFTER.has(ultimo)) {
      avancar();
      let emClasse = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        if (src[i] === '[') emClasse = true;
        else if (src[i] === ']') emClasse = false;
        else if (src[i] === '/' && !emClasse) {
          avancar();
          break;
        } else if (src[i] === '\n') {
          break;
        }
        avancar();
      }
      while (i < src.length && /[a-z]/i.test(src[i])) avancar();
      ultimo = '/';
      continue;
    }
    if (atual === "'" || atual === '"') {
      const aspas = atual;
      const linhaInicio = linha;
      let texto = '';
      avancar();
      while (i < src.length && src[i] !== aspas) {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        texto += src[i];
        avancar();
      }
      avancar();
      salvar(texto, linhaInicio);
      ultimo = aspas;
      continue;
    }
    if (atual === '`') {
      const linhaInicio = linha;
      let texto = '';
      avancar();
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          avancar(2);
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          salvar(texto, linhaInicio);
          texto = '';
          avancar(2);
          let profundidade = 1;
          while (i < src.length && profundidade > 0) {
            if (src[i] === '{') profundidade += 1;
            else if (src[i] === '}') profundidade -= 1;
            avancar();
          }
          continue;
        }
        texto += src[i];
        avancar();
      }
      avancar();
      salvar(texto, linhaInicio);
      ultimo = '`';
      continue;
    }
    if (!/\s/.test(atual)) ultimo = atual;
    avancar();
  }
  return out;
}

function fragmentosVisiveis(literal) {
  if (!literal.includes('<')) return [literal];
  const textos = [...literal.matchAll(/>([^<]+)</g)].map((resultado) => resultado[1]);
  const atributos = [...literal.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)]
    .map((resultado) => resultado[1]);
  return [...textos, ...atributos];
}

const ACENTO = /[À-ÿ]/;
const DUAS_PALAVRAS = /[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}/;
const TOKEN_CSS = /^[a-z0-9]+(?:[-_]{1,2}[a-z0-9]+)*$/;
const FORMA_CHAVE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+(\?.*)?$/;

const EXCECOES = new Set([
  'GoLive LAN', // marca
  'Português', // nome da lingua na propria lingua (spec 2.2)
  'English', // nome da lingua na propria lingua (spec 2.2)
  'Español', // nome da lingua na propria lingua (spec 2.2)
  'use strict', // diretiva JavaScript, nao texto de tela
]);

function ehListaDeClasses(texto) {
  const tokens = texto.trim().split(/\s+/);
  return tokens.every((token) => TOKEN_CSS.test(token)) && tokens.some((token) => /[-_]/.test(token));
}

// Valores de CSS e seletores aparecem em templates junto com o DOM. Sao
// recorrentes em ui.js, mas nunca chegam como frase para a pessoa ler.
function ehTrechoDeCss(texto) {
  if (/\b(?:system-ui|sans-serif|monospace)\b/.test(texto)) return true;
  return /(?:^|[\s,])[#.][a-z][\w-]*(?:[\s,]|$)/i.test(texto);
}

function ehTextoVisivel(fragmento) {
  const texto = String(fragmento).trim();
  if (!texto || !/[A-Za-zÀ-ÿ]/.test(texto)) return false;
  if (EXCECOES.has(texto) || FORMA_CHAVE.test(texto) || ehListaDeClasses(texto)) return false;
  if (ehTrechoDeCss(texto)) return false;
  return ACENTO.test(texto) || DUAS_PALAVRAS.test(texto);
}

function literaisDoHtml(html) {
  const out = [];
  const linhaDe = (posicao) => html.slice(0, posicao).split('\n').length;
  const semScripts = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, (trecho) => trecho.replace(/[^\n]/g, ' '));
  for (const resultado of semScripts.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>([^<]+)/g)) {
    if (/\bdata-i18n="/.test(resultado[2])) continue;
    if (ehTextoVisivel(resultado[3])) {
      out.push({ texto: resultado[3].trim(), linha: linhaDe(resultado.index) });
    }
  }
  for (const resultado of semScripts.matchAll(/<[a-zA-Z][\w-]*([^>]*)>/g)) {
    const atributoI18n = resultado[1].match(/data-i18n-attr="([^"]*)"/);
    const valorI18n = atributoI18n ? atributoI18n[1] : '';
    const traduzidos = valorI18n
      .split(';')
      .map((par) => par.split(':')[0].trim());
    for (const atributo of resultado[1].matchAll(/\b(title|aria-label|placeholder|alt)="([^"]*)"/g)) {
      if (!traduzidos.includes(atributo[1]) && ehTextoVisivel(atributo[2])) {
        out.push({ texto: atributo[2], linha: linhaDe(resultado.index) });
      }
    }
  }
  return out;
}

function textosSoltos(arquivo, conteudo) {
  if (arquivo.endsWith('.html')) return literaisDoHtml(conteudo);
  const linhasDeLog = new Set();
  conteudo.split('\n').forEach((linha, indice) => {
    if (/\b(console|logger)\.\w+\(/.test(linha)) linhasDeLog.add(indice + 1);
  });
  const out = [];
  for (const literal of extrairLiterais(conteudo)) {
    if (linhasDeLog.has(literal.linha)) continue;
    for (const fragmento of fragmentosVisiveis(literal.texto)) {
      if (ehTextoVisivel(fragmento)) out.push({ texto: fragmento.trim(), linha: literal.linha });
    }
  }
  return out;
}

const PASTAS = [
  'src/renderer',
  'src/renderer/mesa-janelas',
  'src/renderer/mesa-modules',
  'src/main',
  'src/splash',
];
const FORA = /(\.test\.js$|dom-falso|[\\/]vendor[\\/]|[\\/]i18n[\\/]|quiz-banco|pcm-injector-worklet)/;

function ARQUIVOS_VARRIDOS(raizRepo) {
  const lista = ['src/main.js'];
  for (const pasta of PASTAS) {
    for (const arquivo of fs.readdirSync(path.join(raizRepo, pasta))) {
      const relativo = `${pasta}/${arquivo}`;
      if (/\.(js|html)$/.test(arquivo) && !FORA.test(relativo)) lista.push(relativo);
    }
  }
  return [...new Set(lista)].sort();
}

const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  REGEX_STARTS_AFTER,
  extrairLiterais,
  fragmentosVisiveis,
  ehTextoVisivel,
  literaisDoHtml,
  textosSoltos,
  ARQUIVOS_VARRIDOS,
  EXCECOES,
};

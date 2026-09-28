'use strict';

/*
 * Origem local da janela principal: `http://localhost`, servida pelo proprio
 * processo (protocol.handle), sem socket nenhum.
 *
 * Por que: desde o fim de 2025 o YouTube recusa embed sem Referer (erro 153)
 * e a Twitch exige `parent=<dominio>`. Pagina `file://` nao manda Referer e
 * nao tem dominio. Medido no Electron 44 (docs/2026-09-24-spike-origem-local.md):
 * uma pagina em `http://localhost` interceptada aqui manda para o iframe
 * exatamente o mesmo que um servidor HTTP de verdade em localhost -- Referer,
 * document.referrer, location.ancestorOrigins e origem dos postMessage --, e
 * continua contexto seguro (captura, AudioWorklet e ws:// seguem iguais).
 *
 * Por que interceptar em vez de abrir um servidor em 127.0.0.1:<porta>:
 *   - a origem (e com ela o localStorage) fica FIXA: porta aleatoria mudaria
 *     a origem a cada abertura, e porta fixa ocupada por outro programa
 *     obrigaria a trocar de origem sem ter como ler a antiga;
 *   - nenhum outro processo nem pagina da internet (DNS rebinding) alcanca os
 *     arquivos, porque nao ha porta aberta;
 *   - funciona igual dentro do asar (le por fs, que o Electron ja entende).
 *
 * `GOLIVE_ORIGEM=file` volta ao `file://` de antes (reserva, sem YouTube).
 *
 * Este arquivo nao importa `electron`: recebe `protocol`, `net`,
 * `BrowserWindow` e `session` de quem chama, pra rodar no node:test.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/** Origem nova da janela principal. Sem porta: nada escuta nela. */
const ORIGEM_LOCAL = 'http://localhost';
/** Origem de antes (todas as paginas file:// dividem o mesmo localStorage). */
const ORIGEM_ARQUIVO = 'file://';
/** Pagina sem nada, usada so pra ler/gravar o localStorage de uma origem. */
const PAGINA_VAZIA = 'vazia.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** HTMLs que podem ser abertos na origem local. O overlay e a splash ficam em
 * file://: nao precisam de YouTube e nao guardam nada no localStorage. */
const PAGINAS = new Set(['index.html', 'espiar.html', PAGINA_VAZIA]);

/** 'local' (padrao) ou 'file'. Qualquer outro valor cai no padrao. */
function escolherModo(env = process.env) {
  const v = String(env?.GOLIVE_ORIGEM || '').trim().toLowerCase();
  return v === 'file' ? 'file' : 'local';
}

/** Origem que a janela principal usa em cada modo. */
function origemDoModo(modo) {
  return modo === 'file' ? ORIGEM_ARQUIVO : ORIGEM_LOCAL;
}

/** URL de uma pagina do renderer (`nome` relativo a src/renderer) numa origem. */
function urlDaPagina(origem, raiz, nome) {
  if (origem === ORIGEM_ARQUIVO) return pathToFileURL(path.join(raiz, nome)).href;
  return `${origem}/${nome}`;
}

function tipoMime(caminho) {
  return MIME[path.extname(caminho).toLowerCase()] || null;
}

/**
 * Caminho absoluto do arquivo pedido, ou null se o pedido nao pode ser
 * servido. Recusa: travessia (`..`, inclusive codificado), barra invertida,
 * `%2f`, byte nulo, letra de unidade, arquivo oculto, teste, extensao fora da
 * lista, HTML fora de PAGINAS. Nao olha o disco (ver `dentroDaRaiz`).
 * @param {string} raiz pasta servida (src/renderer), absoluta
 * @param {string} pathname `URL.pathname` cru (ainda codificado)
 */
function resolverCaminho(raiz, pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  if (/%2f|%5c|%00/i.test(pathname)) return null;
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(1));
  } catch {
    return null;
  }
  if (rel === '') rel = 'index.html';
  if (/[\\\0:]/.test(rel)) return null;
  const partes = rel.split('/');
  if (partes.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) return null;
  const nome = partes[partes.length - 1];
  if (/\.test\.js$/i.test(nome)) return null;
  const ext = path.extname(nome).toLowerCase();
  if (!MIME[ext]) return null;
  if (ext === '.html' && (partes.length !== 1 || !PAGINAS.has(nome))) return null;
  const abs = path.resolve(raiz, ...partes);
  if (!abs.startsWith(path.resolve(raiz) + path.sep)) return null;
  return abs;
}

/**
 * Confere no disco que `abs` e um arquivo comum e que, seguindo links
 * simbolicos, continua dentro da raiz. Dentro do asar o realpath devolve o
 * proprio caminho (nao ha link), entao a regra vale igual.
 */
async function dentroDaRaiz(raiz, abs, fsp = fs.promises) {
  try {
    const [raizReal, real] = await Promise.all([fsp.realpath(raiz), fsp.realpath(abs)]);
    if (!real.startsWith(raizReal + path.sep)) return false;
    const st = await fsp.stat(real);
    return st.isFile();
  } catch {
    return false;
  }
}

/** Cabecalhos de toda resposta que sai da origem local. */
function cabecalhos(caminho) {
  const h = {
    'Content-Type': tipoMime(caminho),
    'X-Content-Type-Options': 'nosniff',
    // Os arquivos mudam a cada atualizacao e a origem nao muda mais: nada de cache.
    'Cache-Control': 'no-store',
    // O padrao do Chromium, explicito: o YouTube precisa do Referer (origem).
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (path.extname(caminho).toLowerCase() === '.html') {
    // So restringe: a CSP do <meta> de cada pagina continua valendo inteira.
    // frame-ancestors nao funciona em <meta>, por isso vai no cabecalho.
    h['Content-Security-Policy'] = "frame-ancestors 'none'";
    h['X-Frame-Options'] = 'DENY';
  }
  return h;
}

function erro(status, texto) {
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
    corpo: texto,
  };
}

/**
 * Resposta para um pedido a origem local. Pura a menos de `fsp`.
 * @returns {Promise<{status: number, headers: object, corpo: Buffer|string|null}>}
 */
async function responder({ raiz, metodo, url, fsp = fs.promises }) {
  if (metodo !== 'GET' && metodo !== 'HEAD') return erro(405, 'metodo nao permitido');
  let u;
  try {
    u = new URL(url);
  } catch {
    return erro(400, 'url invalida');
  }
  if (u.origin !== ORIGEM_LOCAL) return erro(404, 'nao encontrado');
  const abs = resolverCaminho(raiz, u.pathname);
  if (!abs || !(await dentroDaRaiz(raiz, abs, fsp))) return erro(404, 'nao encontrado');
  const corpo = metodo === 'HEAD' ? null : await fsp.readFile(abs);
  return { status: 200, headers: cabecalhos(abs), corpo };
}

/**
 * Liga a origem local na sessao: pedidos a `http://localhost` (sem porta)
 * viram arquivos de `raiz`; qualquer outro http segue para a rede como antes.
 * Fica ligada mesmo com GOLIVE_ORIGEM=file: a migracao de volta precisa ler
 * a origem local.
 */
function instalarOrigemLocal({ protocol, net, raiz, logger }) {
  protocol.handle('http', async (req) => {
    let origem = null;
    try {
      origem = new URL(req.url).origin;
    } catch {
      /* cai na rede, que recusa sozinha */
    }
    if (origem !== ORIGEM_LOCAL) return net.fetch(req, { bypassCustomProtocolHandlers: true });
    try {
      const r = await responder({ raiz, metodo: req.method, url: req.url });
      if (r.status !== 200) logger?.log(`origem local: ${r.status} ${req.method} ${req.url}`);
      return new Response(r.corpo, { status: r.status, headers: r.headers });
    } catch (err) {
      logger?.error('origem local: falha servindo', req.url, err?.message || err);
      const r = erro(500, 'erro interno');
      return new Response(r.corpo, { status: r.status, headers: r.headers });
    }
  });
}

// --- Migracao do localStorage -------------------------------------------
//
// localStorage e por origem. Na primeira abertura com a origem nova, o que
// estava em file:// (nome, tema, configuracoes, clientId) e copiado para
// http://localhost. `origem.json` em userData guarda a ultima origem usada
// pela janela principal: a copia so acontece quando ela muda, e sempre DA
// ultima usada (a mais nova) PARA a atual. A origem antiga nao e apagada:
// voltar a uma versao anterior do app ainda encontra os dados dela.

/** @returns {{ copiar: boolean, de: string, para: string }} */
function planejarMigracao({ anterior, atual }) {
  const de = anterior || ORIGEM_ARQUIVO; // sem registro = versao que abria por file://
  return { copiar: de !== atual, de, para: atual };
}

function lerEstado(arquivo, fsx = fs) {
  try {
    const obj = JSON.parse(fsx.readFileSync(arquivo, 'utf8'));
    return typeof obj?.origem === 'string' ? obj.origem : null;
  } catch {
    return null;
  }
}

function gravarEstado(arquivo, origem, fsx = fs) {
  fsx.writeFileSync(arquivo, JSON.stringify({ origem }), 'utf8');
}

/** Codigo que roda na pagina vazia de destino: substitui tudo pelo que veio
 * da origem anterior e devolve o que ficou, pra conferir. */
function scriptDeGravacao(entradas) {
  return `(() => {
    const e = ${JSON.stringify(entradas)};
    localStorage.clear();
    for (const [k, v] of e) localStorage.setItem(k, v);
    return JSON.stringify(Object.entries(localStorage).sort());
  })()`;
}

const SCRIPT_DE_LEITURA = 'JSON.stringify(Object.entries(localStorage).sort())';

/**
 * Copia o localStorage inteiro de `urlDe` para `urlPara` numa janela escondida
 * (mesma sessao, sem preload). Origem de onde nada ha pra copiar nao apaga o
 * destino. Devolve quantas chaves foram copiadas.
 */
async function copiarLocalStorage({ BrowserWindow, urlDe, urlPara, prazoMs = 8000 }) {
  const w = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const trabalho = (async () => {
    await w.loadURL(urlDe);
    const entradas = JSON.parse(await w.webContents.executeJavaScript(SCRIPT_DE_LEITURA));
    if (!entradas.length) return 0;
    await w.loadURL(urlPara);
    const gravado = await w.webContents.executeJavaScript(scriptDeGravacao(entradas));
    if (gravado !== JSON.stringify(entradas)) throw new Error('conferencia do destino nao bateu');
    return entradas.length;
  })();
  // Depois do prazo a janela e destruida e o trabalho rejeita sozinho; o
  // erro dele ja foi contado pelo prazo.
  trabalho.catch(() => {});
  let timer;
  const prazo = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`copia passou de ${prazoMs} ms`)), prazoMs);
  });
  try {
    return await Promise.race([trabalho, prazo]);
  } finally {
    clearTimeout(timer);
    if (!w.isDestroyed()) w.destroy();
  }
}

/**
 * Deixa a origem do modo pronta para a janela principal: migra o
 * localStorage se a origem mudou desde a ultima abertura. Nunca rejeita: se
 * a copia falhar, a janela abre mesmo assim, o registro NAO avanca e a copia
 * e tentada de novo na proxima abertura (a origem anterior segue intacta).
 * @returns {Promise<{ origem: string, migrou: boolean, chaves: number, erro?: string }>}
 */
async function prepararOrigem({ modo, raiz, arquivoEstado, BrowserWindow, session, logger, prazoMs = 8000, fsx = fs }) {
  const atual = origemDoModo(modo);
  const plano = planejarMigracao({ anterior: lerEstado(arquivoEstado, fsx), atual });
  if (!plano.copiar) return { origem: atual, migrou: false, chaves: 0 };
  try {
    const chaves = await copiarLocalStorage({
      BrowserWindow,
      urlDe: urlDaPagina(plano.de, raiz, PAGINA_VAZIA),
      urlPara: urlDaPagina(plano.para, raiz, PAGINA_VAZIA),
      prazoMs,
    });
    await session?.flushStorageData?.();
    gravarEstado(arquivoEstado, atual, fsx);
    logger?.log(`origem: ${plano.de} -> ${plano.para}, ${chaves} chave(s) copiada(s)`);
    return { origem: atual, migrou: true, chaves };
  } catch (err) {
    const msg = err?.message || String(err);
    logger?.error(`origem: migracao ${plano.de} -> ${plano.para} falhou (tenta de novo na proxima abertura): ${msg}`);
    return { origem: atual, migrou: false, chaves: 0, erro: msg };
  }
}

module.exports = {
  ORIGEM_LOCAL,
  ORIGEM_ARQUIVO,
  PAGINA_VAZIA,
  escolherModo,
  origemDoModo,
  urlDaPagina,
  tipoMime,
  resolverCaminho,
  dentroDaRaiz,
  cabecalhos,
  responder,
  instalarOrigemLocal,
  planejarMigracao,
  lerEstado,
  gravarEstado,
  scriptDeGravacao,
  copiarLocalStorage,
  prepararOrigem,
};

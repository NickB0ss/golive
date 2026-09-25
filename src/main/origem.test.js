'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ORIGEM_LOCAL,
  ORIGEM_ARQUIVO,
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
} = require('./origem');

const RENDERER = path.join(__dirname, '..', 'renderer');

/** Pasta temporaria com um "renderer" pequeno e, do lado de fora, um segredo. */
function montarRaiz() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-origem-'));
  const raiz = path.join(base, 'renderer');
  fs.mkdirSync(path.join(raiz, 'assets', 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(raiz, 'overlay.html'), '<!doctype html>');
  fs.writeFileSync(path.join(raiz, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(raiz, 'app.test.js'), 'teste');
  fs.writeFileSync(path.join(raiz, 'style.css'), 'body{}');
  fs.writeFileSync(path.join(raiz, 'assets', 'fonts', 'a.woff2'), 'woff');
  fs.writeFileSync(path.join(base, 'segredo.js'), 'segredo');
  let temLink = true;
  try {
    fs.symlinkSync(path.join(base, 'segredo.js'), path.join(raiz, 'link.js'));
  } catch {
    temLink = false; // Windows sem permissao de symlink
  }
  return { base, raiz, temLink };
}

test('escolherModo: padrao e a origem local; GOLIVE_ORIGEM=file volta ao file://', () => {
  assert.equal(escolherModo({}), 'local');
  assert.equal(escolherModo({ GOLIVE_ORIGEM: 'file' }), 'file');
  assert.equal(escolherModo({ GOLIVE_ORIGEM: ' FILE ' }), 'file');
  assert.equal(escolherModo({ GOLIVE_ORIGEM: 'qualquer' }), 'local');
  assert.equal(origemDoModo('local'), 'http://localhost');
  assert.equal(origemDoModo('file'), 'file://');
});

test('urlDaPagina monta a URL de cada origem', () => {
  assert.equal(urlDaPagina(ORIGEM_LOCAL, '/x/renderer', 'index.html'), 'http://localhost/index.html');
  const f = urlDaPagina(ORIGEM_ARQUIVO, path.resolve('/x/renderer'), 'index.html');
  assert.match(f, /^file:\/\/\/(.*\/)?x\/renderer\/index\.html$/);
});

test('tipoMime cobre o que o renderer usa e recusa o resto', () => {
  assert.equal(tipoMime('a/index.html'), 'text/html; charset=utf-8');
  assert.equal(tipoMime('a/app.js'), 'text/javascript; charset=utf-8');
  assert.equal(tipoMime('a/style.css'), 'text/css; charset=utf-8');
  assert.equal(tipoMime('a/f.woff2'), 'font/woff2');
  assert.equal(tipoMime('a/icon.svg'), 'image/svg+xml');
  assert.equal(tipoMime('a/icon.png'), 'image/png');
  assert.equal(tipoMime('a/icon.ico'), 'image/x-icon');
  assert.equal(tipoMime('a/LICENSE.txt'), null);
  assert.equal(tipoMime('a/pacote.json'), null);
});

test('resolverCaminho aceita arquivos da raiz e subpastas', () => {
  const raiz = path.resolve('/r/renderer');
  assert.equal(resolverCaminho(raiz, '/'), path.join(raiz, 'index.html'));
  assert.equal(resolverCaminho(raiz, '/index.html'), path.join(raiz, 'index.html'));
  assert.equal(resolverCaminho(raiz, '/espiar.html'), path.join(raiz, 'espiar.html'));
  assert.equal(resolverCaminho(raiz, '/vazia.html'), path.join(raiz, 'vazia.html'));
  assert.equal(resolverCaminho(raiz, '/pcm-injector-worklet.js'), path.join(raiz, 'pcm-injector-worklet.js'));
  assert.equal(resolverCaminho(raiz, '/assets/fonts/outfit-latin.woff2'), path.join(raiz, 'assets', 'fonts', 'outfit-latin.woff2'));
  assert.equal(resolverCaminho(raiz, '/nome%20com%20espaco.js'), path.join(raiz, 'nome com espaco.js'));
});

test('resolverCaminho recusa travessia, barras invertidas e codificacoes', () => {
  const raiz = path.resolve('/r/renderer');
  const ruins = [
    '/../main.js',
    '/assets/../../main.js',
    '/%2e%2e/main.js',
    '/%2E%2E/%2E%2E/package.json',
    '/assets/%2e%2e/%2e%2e/main.js',
    '/..%2fmain.js',
    '/..%2Fmain.js',
    '/..%5cmain.js',
    '/assets\\..\\..\\main.js',
    '/%5c..%5cmain.js',
    '/C:/Windows/win.ini',
    '/C%3a/Windows/x.js',
    '//etc/passwd',
    '/assets//fonts/a.woff2',
    '/./app.js',
    '/app.js%00.png',
    '/%E0%A4%A.js', // percent-encoding quebrado
    '/.git/config',
    '/assets/.escondido.js',
    'relativo.js',
    '',
  ];
  for (const p of ruins) assert.equal(resolverCaminho(raiz, p), null, p);
});

test('resolverCaminho so serve extensoes conhecidas, sem testes e so os HTMLs da lista', () => {
  const raiz = path.resolve('/r/renderer');
  assert.equal(resolverCaminho(raiz, '/app.test.js'), null);
  assert.equal(resolverCaminho(raiz, '/APP.TEST.JS'), null);
  assert.equal(resolverCaminho(raiz, '/assets/fonts/LICENSE-FONTS.txt'), null);
  assert.equal(resolverCaminho(raiz, '/assets'), null);
  assert.equal(resolverCaminho(raiz, '/assets/'), null);
  assert.equal(resolverCaminho(raiz, '/overlay.html'), null);
  assert.equal(resolverCaminho(raiz, '/assets/index.html'), null);
});

test('dentroDaRaiz: arquivo comum sim; pasta, inexistente e symlink para fora nao', async () => {
  const { raiz, temLink } = montarRaiz();
  assert.equal(await dentroDaRaiz(raiz, path.join(raiz, 'app.js')), true);
  assert.equal(await dentroDaRaiz(raiz, path.join(raiz, 'assets')), false);
  assert.equal(await dentroDaRaiz(raiz, path.join(raiz, 'nao-existe.js')), false);
  if (temLink) assert.equal(await dentroDaRaiz(raiz, path.join(raiz, 'link.js')), false);
});

test('cabecalhos: MIME, nosniff, sem cache e frame-ancestors so no HTML', () => {
  const js = cabecalhos('/r/app.js');
  assert.equal(js['Content-Type'], 'text/javascript; charset=utf-8');
  assert.equal(js['X-Content-Type-Options'], 'nosniff');
  assert.equal(js['Cache-Control'], 'no-store');
  assert.equal(js['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(js['Content-Security-Policy'], undefined);
  const html = cabecalhos('/r/index.html');
  assert.equal(html['Content-Security-Policy'], "frame-ancestors 'none'");
  assert.equal(html['X-Frame-Options'], 'DENY');
});

test('responder serve o arquivo com os cabecalhos certos', async () => {
  const { raiz } = montarRaiz();
  const r = await responder({ raiz, metodo: 'GET', url: 'http://localhost/app.js?v=1#x' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.toString(), 'console.log(1)');
  assert.equal(r.headers['Content-Type'], 'text/javascript; charset=utf-8');
  const raizHtml = await responder({ raiz, metodo: 'GET', url: 'http://localhost/' });
  assert.equal(raizHtml.status, 200);
  assert.match(raizHtml.corpo.toString(), /<title>x<\/title>/);
  const head = await responder({ raiz, metodo: 'HEAD', url: 'http://localhost/style.css' });
  assert.equal(head.status, 200);
  assert.equal(head.corpo, null);
  assert.equal(head.headers['Content-Type'], 'text/css; charset=utf-8');
});

test('responder recusa metodo, outra origem, travessia, pasta, teste e symlink', async () => {
  const { raiz, temLink } = montarRaiz();
  assert.equal((await responder({ raiz, metodo: 'POST', url: 'http://localhost/app.js' })).status, 405);
  assert.equal((await responder({ raiz, metodo: 'PUT', url: 'http://localhost/app.js' })).status, 405);
  assert.equal((await responder({ raiz, metodo: 'GET', url: 'nao e url' })).status, 400);
  const nao = [
    'http://localhost:8080/app.js',
    'http://127.0.0.1/app.js',
    'https://localhost/app.js',
    'http://localhost/../segredo.js',
    'http://localhost/%2e%2e/segredo.js',
    'http://localhost/..%2fsegredo.js',
    'http://localhost/assets',
    'http://localhost/assets/',
    'http://localhost/app.test.js',
    'http://localhost/overlay.html',
    'http://localhost/nao-existe.js',
  ];
  if (temLink) nao.push('http://localhost/link.js');
  for (const url of nao) {
    const r = await responder({ raiz, metodo: 'GET', url });
    assert.equal(r.status, 404, url);
    assert.doesNotMatch(String(r.corpo), /segredo/, url);
    assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  }
  // O parser de URL ja resolve a barra invertida e o ".." antes de chegar
  // aqui: o pedido vira /segredo.js, que nao existe dentro da raiz.
  const invertida = await responder({ raiz, metodo: 'GET', url: 'http://localhost/assets\\..\\..\\segredo.js' });
  assert.equal(invertida.status, 404);
});

test('responder serve os arquivos de verdade do renderer que as janelas pedem', async () => {
  for (const nome of ['index.html', 'espiar.html', 'vazia.html', 'app.js', 'style.css', 'espiar-page.js', 'pcm-injector-worklet.js', 'assets/fonts/outfit-latin.woff2', 'assets/icon.svg']) {
    const r = await responder({ raiz: RENDERER, metodo: 'HEAD', url: `http://localhost/${nome}` });
    assert.equal(r.status, 200, nome);
  }
});

test('todo arquivo que index.html e espiar.html referenciam e servido', async () => {
  for (const pagina of ['index.html', 'espiar.html']) {
    const html = fs.readFileSync(path.join(RENDERER, pagina), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
    const css = [...html.matchAll(/url\('([^')]+)'\)/g)].map((m) => m[1]);
    assert.ok(refs.length > 0, pagina);
    for (const ref of [...refs, ...css]) {
      const r = await responder({ raiz: RENDERER, metodo: 'HEAD', url: new URL(ref, 'http://localhost/').href });
      assert.equal(r.status, 200, `${pagina} -> ${ref}`);
    }
  }
});

test('instalarOrigemLocal: localhost vira arquivo, o resto vai para a rede sem o handler', async () => {
  const { raiz } = montarRaiz();
  let handler = null;
  const protocolo = { handle: (esquema, fn) => { assert.equal(esquema, 'http'); handler = fn; } };
  const redes = [];
  const net = { fetch: (req, opts) => { redes.push({ url: req.url, opts }); return 'da-rede'; } };
  instalarOrigemLocal({ protocol: protocolo, net, raiz });
  const ok = await handler(new Request('http://localhost/app.js'));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'console.log(1)');
  assert.equal(ok.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const fora = await handler(new Request('http://localhost/../segredo.js'));
  assert.equal(fora.status, 404);
  assert.equal(await handler(new Request('http://192.168.0.10:9000/x')), 'da-rede');
  assert.equal(await handler(new Request('http://localhost:3000/x')), 'da-rede');
  assert.deepEqual(redes.map((r) => r.url), ['http://192.168.0.10:9000/x', 'http://localhost:3000/x']);
  assert.deepEqual(redes[0].opts, { bypassCustomProtocolHandlers: true });
});

test('planejarMigracao: sem registro vem do file://; mesma origem nao copia', () => {
  assert.deepEqual(planejarMigracao({ anterior: null, atual: ORIGEM_LOCAL }), { copiar: true, de: 'file://', para: 'http://localhost' });
  assert.deepEqual(planejarMigracao({ anterior: ORIGEM_LOCAL, atual: ORIGEM_LOCAL }), { copiar: false, de: 'http://localhost', para: 'http://localhost' });
  assert.deepEqual(planejarMigracao({ anterior: null, atual: ORIGEM_ARQUIVO }), { copiar: false, de: 'file://', para: 'file://' });
  assert.deepEqual(planejarMigracao({ anterior: ORIGEM_LOCAL, atual: ORIGEM_ARQUIVO }), { copiar: true, de: 'http://localhost', para: 'file://' });
});

test('lerEstado / gravarEstado: arquivo ausente ou torto vira null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-estado-'));
  const arq = path.join(dir, 'origem.json');
  assert.equal(lerEstado(arq), null);
  fs.writeFileSync(arq, '{torto');
  assert.equal(lerEstado(arq), null);
  fs.writeFileSync(arq, JSON.stringify({ origem: 42 }));
  assert.equal(lerEstado(arq), null);
  gravarEstado(arq, ORIGEM_LOCAL);
  assert.equal(lerEstado(arq), 'http://localhost');
});

/** localStorage de mentira por origem + BrowserWindow falso que roda os
 * scripts de migracao de verdade contra ele. */
function navegadorFalso({ travar = false } = {}) {
  const lojas = new Map();
  const loja = (origem) => {
    if (!lojas.has(origem)) lojas.set(origem, new Map());
    return lojas.get(origem);
  };
  const janelas = [];
  class BrowserWindowFalso {
    constructor(opts) {
      this.opts = opts;
      this.destruida = false;
      this.origem = null;
      janelas.push(this);
      this.webContents = {
        executeJavaScript: async (codigo) => {
          const m = loja(this.origem);
          const localStorage = {
            clear: () => m.clear(),
            setItem: (k, v) => m.set(String(k), String(v)),
          };
          const Object_ = { entries: (alvo) => (alvo === localStorage ? [...m.entries()] : Object.entries(alvo)) };
          return new Function('localStorage', 'Object', `return ${codigo}`)(localStorage, Object_);
        },
      };
    }
    loadURL(url) {
      if (travar) return new Promise(() => {});
      this.origem = url.startsWith('file:') ? 'file://' : new URL(url).origin;
      return Promise.resolve();
    }
    isDestroyed() { return this.destruida; }
    destroy() { this.destruida = true; }
  }
  return { BrowserWindow: BrowserWindowFalso, loja, janelas };
}

test('scriptDeGravacao aguenta aspas, barras, quebras e </script> nos valores', async () => {
  const nav = navegadorFalso();
  const entradas = [['golive', '{"name":"Ana \\"A\\"","theme":"papel"}'], ['x', 'linha1\nlinha2 \u2028 </script> `$' + '{1}`']];
  const w = new nav.BrowserWindow({});
  await w.loadURL('http://localhost/vazia.html');
  const gravado = await w.webContents.executeJavaScript(scriptDeGravacao(entradas));
  assert.equal(gravado, JSON.stringify([...entradas].sort()));
});

test('copiarLocalStorage copia tudo, substitui o destino e fecha a janela', async () => {
  const nav = navegadorFalso();
  nav.loja('file://').set('golive', '{"name":"Ana","theme":"papel","clientId":"c1"}');
  nav.loja('file://').set('outra', '1');
  nav.loja('http://localhost').set('velha', 'sai');
  const n = await copiarLocalStorage({ BrowserWindow: nav.BrowserWindow, urlDe: 'file:///r/vazia.html', urlPara: 'http://localhost/vazia.html' });
  assert.equal(n, 2);
  assert.deepEqual([...nav.loja('http://localhost').entries()].sort(), [['golive', '{"name":"Ana","theme":"papel","clientId":"c1"}'], ['outra', '1']]);
  assert.equal(nav.loja('file://').get('golive'), '{"name":"Ana","theme":"papel","clientId":"c1"}', 'a origem antiga fica intacta');
  assert.equal(nav.janelas[0].opts.show, false);
  assert.equal(nav.janelas[0].opts.webPreferences.preload, undefined);
  assert.equal(nav.janelas[0].destruida, true);
});

test('copiarLocalStorage: origem vazia nao apaga o destino', async () => {
  const nav = navegadorFalso();
  nav.loja('http://localhost').set('golive', 'fica');
  assert.equal(await copiarLocalStorage({ BrowserWindow: nav.BrowserWindow, urlDe: 'file:///r/vazia.html', urlPara: 'http://localhost/vazia.html' }), 0);
  assert.equal(nav.loja('http://localhost').get('golive'), 'fica');
});

test('copiarLocalStorage: janela travada estoura o prazo e e destruida', async () => {
  const nav = navegadorFalso({ travar: true });
  await assert.rejects(
    copiarLocalStorage({ BrowserWindow: nav.BrowserWindow, urlDe: 'file:///r/vazia.html', urlPara: 'http://localhost/vazia.html', prazoMs: 30 }),
    /passou de 30 ms/
  );
  assert.equal(nav.janelas[0].destruida, true);
});

test('prepararOrigem migra uma vez so e grava o registro', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-prep-'));
  const arquivoEstado = path.join(dir, 'origem.json');
  const nav = navegadorFalso();
  nav.loja('file://').set('golive', '{"theme":"papel"}');
  let flush = 0;
  const session = { flushStorageData: () => { flush++; } };
  const r1 = await prepararOrigem({ modo: 'local', raiz: RENDERER, arquivoEstado, BrowserWindow: nav.BrowserWindow, session });
  assert.deepEqual(r1, { origem: 'http://localhost', migrou: true, chaves: 1 });
  assert.equal(nav.loja('http://localhost').get('golive'), '{"theme":"papel"}');
  assert.equal(lerEstado(arquivoEstado), 'http://localhost');
  assert.equal(flush, 1);

  // Depois da migracao o usuario muda o tema na origem nova; reabrir nao
  // pode trazer o valor velho do file:// de volta.
  nav.loja('http://localhost').set('golive', '{"theme":"marca"}');
  const r2 = await prepararOrigem({ modo: 'local', raiz: RENDERER, arquivoEstado, BrowserWindow: nav.BrowserWindow, session });
  assert.deepEqual(r2, { origem: 'http://localhost', migrou: false, chaves: 0 });
  assert.equal(nav.janelas.length, 1, 'nenhuma janela escondida a mais');
  assert.equal(nav.loja('http://localhost').get('golive'), '{"theme":"marca"}');

  // GOLIVE_ORIGEM=file: volta com o que ha de mais novo.
  const r3 = await prepararOrigem({ modo: 'file', raiz: RENDERER, arquivoEstado, BrowserWindow: nav.BrowserWindow, session });
  assert.equal(r3.migrou, true);
  assert.equal(nav.loja('file://').get('golive'), '{"theme":"marca"}');
  assert.equal(lerEstado(arquivoEstado), 'file://');
});

test('prepararOrigem: falha na copia nao rejeita, nao grava registro e tenta de novo depois', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-prep-'));
  const arquivoEstado = path.join(dir, 'origem.json');
  const erros = [];
  const logger = { log() {}, error: (...a) => erros.push(a.join(' ')) };
  const travado = navegadorFalso({ travar: true });
  const r = await prepararOrigem({ modo: 'local', raiz: RENDERER, arquivoEstado, BrowserWindow: travado.BrowserWindow, logger, prazoMs: 20 });
  assert.equal(r.migrou, false);
  assert.match(r.erro, /passou de 20 ms/);
  assert.equal(lerEstado(arquivoEstado), null);
  assert.match(erros[0], /tenta de novo/);

  const nav = navegadorFalso();
  nav.loja('file://').set('golive', 'x');
  const r2 = await prepararOrigem({ modo: 'local', raiz: RENDERER, arquivoEstado, BrowserWindow: nav.BrowserWindow });
  assert.equal(r2.migrou, true);
  assert.equal(nav.loja('http://localhost').get('golive'), 'x');
});

test('CSP do index.html: a de antes, mais so o frame-src do YouTube e da Twitch', () => {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const diretivas = Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
  assert.deepEqual(diretivas, {
    'default-src': "'self'",
    'img-src': "'self' data: blob:",
    'media-src': "'self' blob: mediastream:",
    'style-src': "'self' 'unsafe-inline'",
    'connect-src': "'self' ws: wss:",
    'frame-src': 'https://www.youtube-nocookie.com https://player.twitch.tv',
  });
  assert.doesNotMatch(csp, /script-src/, 'script continua so do proprio app (default-src)');
});

test('CSP das outras paginas nao abre iframe nenhum', () => {
  for (const nome of ['espiar.html', 'overlay.html', 'vazia.html']) {
    const html = fs.readFileSync(path.join(RENDERER, nome), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
    assert.match(csp, /default-src 'none'/, nome);
    assert.doesNotMatch(csp, /frame-src/, nome);
  }
});

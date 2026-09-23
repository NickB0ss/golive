'use strict';
const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, CONNECT_TIMEOUT_MS, SILENCE_TIMEOUT_MS } = require('./signaling');

// WebSocket falso: so o que connect() usa. O `close()` imita o navegador --
// fechar um socket ainda CONNECTING "falha a conexao" (spec WHATWG) e sai
// error + close 1006 nao limpo, que e o que faz o app.js cair no retry.
// Aqui os eventos saem sincronos; no navegador saem na proxima volta do
// loop, o que nao muda nada do que estes testes afirmam.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.closeCalls = 0;
    this.sent = [];
    FakeWebSocket.last = this;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    if (this.readyState === FakeWebSocket.CONNECTING) {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit('error');
      this.emit('close', { code: 1006, reason: '', wasClean: false });
    } else if (this.readyState === FakeWebSocket.OPEN) {
      this.readyState = FakeWebSocket.CLOSED;
      this.emit('close', { code: 1005, reason: '', wasClean: true });
    }
  }

  // O servidor completou o handshake.
  serverOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open');
  }
}

/** Abre uma conexao com o socket falso e registra tudo o que os handlers
 * receberam, pra cada teste so afirmar sobre o que importa. */
function abrir(opts = {}) {
  const seen = { opens: 0, errors: 0, closes: [], messages: [] };
  const handle = connect('ws://sala.invalid:9000', {
    onOpen: () => { seen.opens += 1; },
    onMessage: (msg) => { seen.messages.push(msg); },
    onError: () => { seen.errors += 1; },
    onClose: (detail) => { seen.closes.push(detail); },
  }, { WebSocket: FakeWebSocket, ...opts });
  return { handle, ws: FakeWebSocket.last, seen };
}

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  // O aviso do timeout e esperado aqui; silencia pra nao sujar a saida.
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('prazo padrao do handshake e 8 s', () => {
  assert.equal(CONNECT_TIMEOUT_MS, 8000);
});

test('handshake que nao completa no prazo e fechado e sai como queda 1006', () => {
  const { ws, seen } = abrir();
  mock.timers.tick(CONNECT_TIMEOUT_MS - 1);
  assert.equal(ws.closeCalls, 0, 'um ms antes do prazo nada acontece');

  mock.timers.tick(1);
  assert.equal(ws.closeCalls, 1);
  assert.equal(seen.errors, 1);
  assert.deepEqual(seen.closes, [{ code: 1006, reason: '', wasClean: false }]);
  assert.equal(console.warn.mock.callCount(), 1);
  assert.match(console.warn.mock.calls[0].arguments[0], /^\[signaling\] sem handshake em 8000 ms/);
});

test('connectTimeoutMs troca o prazo', () => {
  const { ws } = abrir({ connectTimeoutMs: 50 });
  mock.timers.tick(49);
  assert.equal(ws.closeCalls, 0);
  mock.timers.tick(1);
  assert.equal(ws.closeCalls, 1);
});

test('open antes do prazo cancela o timeout', () => {
  // Vigia de silencio fora do caminho: aqui so interessa o do handshake.
  const { ws, seen } = abrir({ silenceTimeoutMs: CONNECT_TIMEOUT_MS * 100 });
  mock.timers.tick(5000);
  ws.serverOpen();
  mock.timers.tick(CONNECT_TIMEOUT_MS * 10);
  assert.equal(ws.closeCalls, 0);
  assert.equal(ws.readyState, FakeWebSocket.OPEN);
  assert.equal(seen.opens, 1);
  assert.equal(seen.closes.length, 0);
});

test('close antes do prazo cancela o timeout', () => {
  const { ws, seen } = abrir();
  mock.timers.tick(3000);
  // Conexao recusada/caida antes de abrir: o close veio do navegador, nao do timer.
  ws.readyState = FakeWebSocket.CLOSED;
  ws.emit('close', { code: 1006, reason: '', wasClean: false });
  mock.timers.tick(CONNECT_TIMEOUT_MS * 10);
  assert.equal(ws.closeCalls, 0);
  assert.equal(seen.closes.length, 1);
});

test('error antes do prazo tambem cancela o timeout', () => {
  const { ws, seen } = abrir();
  mock.timers.tick(1000);
  ws.emit('error');
  mock.timers.tick(CONNECT_TIMEOUT_MS * 10);
  assert.equal(ws.closeCalls, 0);
  assert.equal(seen.errors, 1);
});

test('send so sai com o socket aberto (constantes vem do WebSocket injetado)', () => {
  const { handle, ws } = abrir();
  handle.send({ type: 'join' });
  assert.equal(handle.isOpen(), false);
  assert.deepEqual(ws.sent, []);

  ws.serverOpen();
  handle.send({ type: 'join' });
  assert.equal(handle.isOpen(), true);
  assert.deepEqual(ws.sent, ['{"type":"join"}']);
});

// ---------- Vigia de vida (C2 da analise de 2026-09-23) ----------

/** O servidor mandou um frame. */
function serverSays(ws, payload) {
  ws.emit('message', { data: JSON.stringify(payload) });
}

test('prazo padrao do vigia de silencio e 15 s (tres hb de 5 s perdidos)', () => {
  assert.equal(SILENCE_TIMEOUT_MS, 15000);
});

test('conexao aberta sem nenhuma mensagem no prazo sai na hora como queda 1006', () => {
  const { handle, ws, seen } = abrir();
  ws.serverOpen();
  mock.timers.tick(SILENCE_TIMEOUT_MS - 1);
  assert.equal(seen.closes.length, 0, 'um ms antes do prazo nada acontece');

  mock.timers.tick(1);
  // Entregue sem esperar o close do navegador (numa rede morta ele demora).
  assert.deepEqual(seen.closes, [{ code: 1006, reason: 'silence', wasClean: false }]);
  assert.equal(ws.closeCalls, 1, 'o socket e fechado de qualquer jeito');
  assert.equal(handle.isOpen(), false);
  assert.match(console.warn.mock.calls.at(-1).arguments[0], /^\[signaling\] sem nenhuma mensagem em 15000 ms/);
});

test('cada mensagem rearma o vigia, e o hb nao chega ao app', () => {
  const { ws, seen } = abrir({ silenceTimeoutMs: 100 });
  ws.serverOpen();
  for (let i = 0; i < 5; i += 1) {
    mock.timers.tick(90);
    serverSays(ws, { type: 'hb' });
  }
  mock.timers.tick(90);
  serverSays(ws, { type: 'chat', text: 'oi' });
  mock.timers.tick(99);
  assert.equal(seen.closes.length, 0);
  assert.deepEqual(seen.messages, [{ type: 'chat', text: 'oi' }], 'hb e consumido aqui');

  mock.timers.tick(1);
  assert.equal(seen.closes.length, 1);
});

test('frame malformado tambem e sinal de vida', () => {
  const { ws, seen } = abrir({ silenceTimeoutMs: 100 });
  ws.serverOpen();
  mock.timers.tick(90);
  ws.emit('message', { data: '{nao e json' });
  mock.timers.tick(90);
  assert.equal(seen.closes.length, 0);
  assert.deepEqual(seen.messages, []);
});

test('depois que o vigia desistiu, o close tardio do navegador nao vira segunda queda', () => {
  const { ws, seen } = abrir({ silenceTimeoutMs: 100 });
  ws.serverOpen();
  // O close() de um socket aberto no navegador real so sai depois do
  // handshake de close; aqui o socket falso fecharia na hora, entao ele e
  // trocado por um que nao faz nada, como numa rede morta.
  ws.close = () => { ws.closeCalls += 1; ws.readyState = FakeWebSocket.CLOSING; };
  mock.timers.tick(100);
  assert.equal(seen.closes.length, 1);

  serverSays(ws, { type: 'chat', text: 'atrasada' });
  ws.emit('error');
  ws.readyState = FakeWebSocket.CLOSED;
  ws.emit('close', { code: 1006, reason: '', wasClean: false });
  assert.equal(seen.closes.length, 1);
  assert.equal(seen.errors, 0);
  assert.deepEqual(seen.messages, []);
});

test('o vigia nao roda antes de abrir, e sai de cena com close deliberado ou do servidor', () => {
  const antes = abrir({ silenceTimeoutMs: 100, connectTimeoutMs: 1000 });
  mock.timers.tick(500);
  assert.equal(antes.seen.closes.length, 0, 'antes do open quem vigia e o prazo do handshake');

  const deliberado = abrir({ silenceTimeoutMs: 100 });
  deliberado.ws.serverOpen();
  deliberado.handle.close();
  assert.equal(deliberado.seen.closes.length, 1, 'o close limpo do proprio app');
  mock.timers.tick(1000);
  assert.equal(deliberado.seen.closes.length, 1, 'e nenhuma queda inventada depois');

  const servidor = abrir({ silenceTimeoutMs: 100 });
  servidor.ws.serverOpen();
  servidor.ws.readyState = FakeWebSocket.CLOSED;
  servidor.ws.emit('close', { code: 1001, reason: 'host-left', wasClean: true });
  mock.timers.tick(1000);
  assert.deepEqual(servidor.seen.closes, [{ code: 1001, reason: 'host-left', wasClean: true }]);
});

'use strict';
const { test, mock, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { connect, CONNECT_TIMEOUT_MS } = require('./signaling');

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
  const seen = { opens: 0, errors: 0, closes: [] };
  const handle = connect('ws://sala.invalid:9000', {
    onOpen: () => { seen.opens += 1; },
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
  const { ws, seen } = abrir();
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

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./mesa-por');
const registry = require('./mesa-modules/index');

function palco({ open = false, spot = null, sendOk = true } = {}) {
  const sent = [];
  const toasts = [];
  let t = 1000;
  const view = { open, spot };
  const por = lib.create({
    send: (m) => {
      sent.push(m);
      return sendOk;
    },
    me: () => '7',
    view: { isOpen: () => view.open, spot: () => view.spot },
    toast: (s) => toasts.push(s),
    registry: () => registry,
    now: () => t,
  });
  return { por, sent, toasts, view, avanca: (ms) => { t += ms; } };
}

test('na Transmissao: add no meio da mesa, e o mesa-ack leva o act com o conteudo', () => {
  const p = palco();
  assert.equal(p.por.put('youtube', { kind: 'load', url: 'https://youtu.be/dQw4w9WgXcQ' }), true);
  assert.deepEqual(p.sent[0], { type: 'mesa', op: 'add', win: { type: 'youtube', x: 2080, y: 1320, w: 640, h: 360 } });
  assert.equal(p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w1', seq: 3 }), true);
  assert.deepEqual(p.sent[1], { type: 'mesa', op: 'act', id: 'w1', action: { kind: 'load', url: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.deepEqual(p.toasts, ['Vídeo do YouTube foi para a mesa.']);
  assert.equal(p.por.pending(), null);
  // Outro ack (de um remove qualquer) nao manda nada de novo.
  assert.equal(p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w2', seq: 4 }), false);
  assert.equal(p.sent.length, 2);
});

test('na Mesa: nasce no lugar que a vista escolheu e o eco do add (by = eu) leva o act', () => {
  const p = palco({ open: true, spot: { x: 100, y: 200, w: 480, h: 360 } });
  p.por.put('imagem', { kind: 'set', msgId: '42' });
  assert.deepEqual(p.sent[0].win, { type: 'imagem', x: 100, y: 200, w: 480, h: 360 });
  // Eco de outra pessoa, ou de outro tipo: nao e o meu.
  assert.equal(p.por.handle({ type: 'mesa', op: 'add', by: '8', win: { id: 'x', type: 'imagem' } }), false);
  assert.equal(p.por.handle({ type: 'mesa', op: 'add', by: '7', win: { id: 'y', type: 'nota' } }), false);
  assert.equal(p.sent.length, 1);
  // O meu: manda o act, e deixa a vista desenhar (nao consome).
  assert.equal(p.por.handle({ type: 'mesa', op: 'add', by: '7', win: { id: 'w9', type: 'imagem' } }), false);
  assert.deepEqual(p.sent[1], { type: 'mesa', op: 'act', id: 'w9', action: { kind: 'set', msgId: '42' } });
  assert.deepEqual(p.toasts, [], 'na Mesa a janela aparece; sem aviso');
});

test('na Mesa sem retrato ainda: cai no meio da mesa', () => {
  const p = palco({ open: true, spot: null });
  p.por.put('imagem', { kind: 'set', msgId: '1' });
  assert.deepEqual(p.sent[0].win, { type: 'imagem', x: 2160, y: 1320, w: 480, h: 360 });
});

test('sobreposicao: tenta de novo no lugar livre que o servidor mandou, ate 3 vezes', () => {
  const p = palco();
  p.por.put('imagem', { kind: 'set', msgId: '1' });
  const fix = { x: 10, y: 20, w: 480, h: 360 };
  for (let i = 0; i < 3; i += 1) {
    assert.equal(p.por.handle({ type: 'mesa-denied', op: 'add', id: null, reason: 'overlap', fix }), true);
    assert.deepEqual(p.sent.at(-1), { type: 'mesa', op: 'add', win: { type: 'imagem', ...fix } });
  }
  assert.equal(p.por.handle({ type: 'mesa-denied', op: 'add', id: null, reason: 'overlap', fix }), true);
  assert.equal(p.sent.length, 4, 'a quarta recusa nao tenta mais');
  assert.equal(p.toasts.length, 1);
  assert.equal(p.por.pending(), null);
});

test('recusa de verdade (trava do lider) vira aviso e esquece o pedido', () => {
  const p = palco();
  p.por.put('youtube', { kind: 'load', url: 'x' });
  assert.equal(p.por.handle({ type: 'mesa-denied', op: 'add', id: null, reason: 'locked' }), true);
  assert.deepEqual(p.toasts, ['Só o líder mexe na mesa agora.']);
  assert.equal(p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w1' }), false, 'sem pedido, o ack nao e dele');
});

test('recusa do act na Transmissao vira aviso com o motivo do modulo; na Mesa fica com a janela', () => {
  const p = palco();
  p.por.put('youtube', { kind: 'load', url: 'lixo' });
  p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w1' });
  assert.equal(p.por.handle({ type: 'mesa-denied', op: 'act', id: 'w1', reason: 'invalid', detail: 'Link do YouTube não reconhecido' }), true);
  assert.equal(p.toasts.at(-1), 'Vídeo do YouTube: Link do YouTube não reconhecido');

  const q = palco({ open: true, spot: { x: 0, y: 0, w: 640, h: 360 } });
  q.por.put('youtube', { kind: 'load', url: 'lixo' });
  q.por.handle({ type: 'mesa', op: 'add', by: '7', win: { id: 'w1', type: 'youtube' } });
  assert.equal(q.por.handle({ type: 'mesa-denied', op: 'act', id: 'w1', reason: 'invalid', detail: 'x' }), false);
});

test('recusa do add de outra origem (menu da vista) nao e deste modulo', () => {
  const p = palco({ open: true });
  assert.equal(p.por.handle({ type: 'mesa-denied', op: 'add', reason: 'overlap', fix: { x: 0, y: 0, w: 1, h: 1 } }), false);
});

test('pedido velho (sem resposta em 8 s) e esquecido', () => {
  const p = palco();
  p.por.put('imagem', { kind: 'set', msgId: '1' });
  p.avanca(lib.PENDING_MS + 1);
  assert.equal(p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w1' }), false);
  assert.equal(p.sent.length, 1);
});

test('sem conexao, tipo desconhecido ou de midia: nao pede', () => {
  const p = palco({ sendOk: false });
  assert.equal(p.por.put('imagem', { kind: 'set', msgId: '1' }), false);
  assert.deepEqual(p.toasts, ['Sem conexão com a sala agora.']);
  assert.equal(p.por.pending(), null);
  const q = palco();
  assert.equal(q.por.put('naoexiste', {}), false);
  assert.equal(q.por.put('tela', {}), false);
  assert.deepEqual(q.sent, []);
});

test('reset esquece o que estava pendente (a sala acabou)', () => {
  const p = palco();
  p.por.put('imagem', { kind: 'set', msgId: '1' });
  p.por.reset();
  assert.equal(p.por.handle({ type: 'mesa-ack', op: 'add', id: 'w1' }), false);
});

test('centered poe o meio no ponto', () => {
  assert.deepEqual(lib.centered({ w: 100, h: 50 }, 200, 100), { x: 150, y: 75, w: 100, h: 50 });
});

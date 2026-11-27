'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const C = require('./constantes');
const P = require('./pacote');
const { BufferReenvio, NACK_MAX_POR_S } = require('./reenvio');

const { TIPO, FLAG } = C;
const FARTO = 1e9; // bitrate que nao limita

function cenario() {
  const c = { t: 0 };
  c.buf = new BufferReenvio({ agora: () => c.t });
  c.mandar = (quadro, tam, keyframe = false) => {
    const ps = P.fragmentarQuadro(Buffer.alloc(tam, quadro & 0xff), { quadro, keyframe, fecN: 4 });
    ps.forEach((p) => c.buf.guardar(p));
    return ps;
  };
  return c;
}

test('reenvio: devolve os fragmentos pedidos com RETRANSMISSAO e sem FEC', () => {
  const c = cenario();
  const ps = c.mandar(5, 1152 * 6, true);
  const r = c.buf.atender([{ quadro: 5, primeiro: 1, quantidade: 2 }], FARTO);
  assert.deepEqual(r.map((p) => p.indice), [1, 2]);
  for (const p of r) {
    assert.equal(p.tipo, TIPO.VIDEO);
    assert.equal(p.flags & FLAG.RETRANSMISSAO, FLAG.RETRANSMISSAO);
    assert.equal(p.flags & FLAG.KEYFRAME, FLAG.KEYFRAME);
    assert.deepEqual(p.payload, ps.find((x) => x.tipo === TIPO.VIDEO && x.indice === p.indice).payload);
  }
  const inteiro = c.buf.atender([{ quadro: 5, primeiro: 0, quantidade: C.NACK_QUADRO_INTEIRO }], FARTO);
  assert.deepEqual(inteiro.map((p) => p.indice), [0, 3, 4, 5], 'quadro inteiro, menos o que ja foi reenviado');
  assert.equal(c.buf.contadores.repetidos, 2);
});

test('reenvio: cada fragmento uma vez so; o que saiu do buffer (300 ms) e ignorado', () => {
  const c = cenario();
  c.mandar(1, 1152 * 2);
  assert.equal(c.buf.atender([{ quadro: 1, primeiro: 0, quantidade: 1 }], FARTO).length, 1);
  assert.equal(c.buf.atender([{ quadro: 1, primeiro: 0, quantidade: 1 }], FARTO).length, 0);
  c.t += C.BUFFER_REENVIO_MS;
  c.mandar(2, 100);
  assert.equal(c.buf.atender([{ quadro: 1, primeiro: 1, quantidade: 1 }], FARTO).length, 0);
  assert.equal(c.buf.contadores.ausentes, 1);
  assert.equal(c.buf.atender([{ quadro: 2, primeiro: 0, quantidade: 1 }], FARTO).length, 1);
  // Indice alem do n do quadro: ausente, sem lancar.
  assert.equal(c.buf.atender([{ quadro: 2, primeiro: 3, quantidade: 2 }], FARTO).length, 0);
});

test('reenvio: no maximo 250 NACKs por segundo', () => {
  const c = cenario();
  c.mandar(1, 1152 * 300);
  for (let i = 0; i < NACK_MAX_POR_S; i++) {
    assert.equal(c.buf.atender([{ quadro: 1, primeiro: i, quantidade: 1 }], FARTO).length, 1);
  }
  assert.equal(c.buf.atender([{ quadro: 1, primeiro: 299, quantidade: 1 }], FARTO).length, 0);
  assert.equal(c.buf.contadores.nack_excesso, 1);
  c.t += 1000;
  c.mandar(2, 100);
  assert.equal(c.buf.atender([{ quadro: 2, primeiro: 0, quantidade: 1 }], FARTO).length, 1);
});

test('reenvio: bytes reenviados em 1 s ficam em 25 % do bitrate alvo', () => {
  const c = cenario();
  c.mandar(1, 1152 * 40);
  const bitrate = 8 * 1196 * 10 * 4; // 25 % disso = 10 datagramas cheios por segundo
  const r = c.buf.atender([{ quadro: 1, primeiro: 0, quantidade: 40 }], bitrate);
  assert.equal(r.length, 10);
  assert.equal(c.buf.contadores.pulados_banda, 30);
  assert.equal(c.buf.contadores.bytes_reenviados, 10 * 1196);
  c.t += 1000; // a janela anda; o quadro 1 ja saiu do buffer, um novo entra
  c.mandar(2, 1152 * 2);
  assert.equal(c.buf.atender([{ quadro: 2, primeiro: 0, quantidade: 2 }], bitrate).length, 2);
});

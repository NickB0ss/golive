'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_IMAGE_CHARS, ENCODE_LADDER,
  isAcceptedType, needsCanvas, isImageDataUrl, dataUrlBytes, fitsBudget, fitBox, thumbBox,
} = require('./chatmedia');
const servidor = require('../../server/signaling-core');

test('o teto de imagem do cliente e o mesmo que o servidor aplica', () => {
  // Duplicado nos dois lados de proposito (o servidor nao pode confiar no
  // cliente); este teste e quem impede que eles divirjam em silencio.
  assert.equal(MAX_IMAGE_CHARS, servidor.MAX_IMAGE_CHARS);
});

test('so tipo de imagem conhecido e aceito', () => {
  assert.ok(isAcceptedType('image/png'));
  assert.ok(isAcceptedType('IMAGE/JPEG'));
  assert.ok(!isAcceptedType('application/pdf'));
  assert.ok(!isAcceptedType('image/svg+xml')); // SVG carrega script -- fica de fora
  assert.ok(!isAcceptedType(undefined));
});

test('GIF nao passa por canvas (senao perde a animacao)', () => {
  assert.ok(needsCanvas('image/png'));
  assert.ok(!needsCanvas('image/gif'));
  assert.ok(!needsCanvas('text/plain'));
});

test('isImageDataUrl aceita data URL de imagem e recusa endereco remoto', () => {
  assert.ok(isImageDataUrl('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(!isImageDataUrl('https://exemplo.invalido/foto.png'));
  assert.ok(!isImageDataUrl('data:text/html;base64,PHNjcmlwdD4='));
  assert.ok(!isImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(!isImageDataUrl(null));
});

test('dataUrlBytes estima o payload descontando o padding do base64', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/png;base64,AA=='), 1);
  assert.equal(dataUrlBytes('sem virgula'), 0);
  assert.equal(dataUrlBytes(null), 0);
});

test('fitsBudget corta exatamente no teto', () => {
  const cabe = 'd'.repeat(MAX_IMAGE_CHARS);
  assert.ok(fitsBudget(cabe));
  assert.ok(!fitsBudget(cabe + 'x'));
  assert.ok(!fitsBudget(''));
});

test('fitBox encolhe pelo maior lado e nunca amplia', () => {
  assert.deepEqual(fitBox(2560, 1440, 1280), { w: 1280, h: 720 });
  assert.deepEqual(fitBox(600, 3000, 1280), { w: 256, h: 1280 });
  assert.deepEqual(fitBox(320, 240, 1280), { w: 320, h: 240 }); // ja cabe -- fica
  assert.deepEqual(fitBox(0, 100, 1280), { w: 0, h: 0 });
});

test('a escada de reencode desce qualidade antes de resolucao', () => {
  const dims = ENCODE_LADDER.map((d) => d.maxDim);
  const quals = ENCODE_LADDER.map((d) => d.quality);
  // Nunca sobe de novo, em nenhum dos dois eixos.
  for (let i = 1; i < ENCODE_LADDER.length; i++) {
    assert.ok(dims[i] <= dims[i - 1], `degrau ${i}: resolucao subiu`);
    assert.ok(quals[i] <= quals[i - 1] || dims[i] < dims[i - 1], `degrau ${i}: nada ficou mais barato`);
  }
  // O primeiro degrau que muda de resolucao so vem depois de a qualidade
  // ja ter caido -- e a decisao da spec (print legivel importa mais).
  const primeiraQueda = dims.findIndex((d) => d < dims[0]);
  assert.ok(primeiraQueda > 1, 'a resolucao caiu antes da qualidade');
});

test('thumbBox cabe na caixa preservando a proporcao', () => {
  assert.deepEqual(thumbBox(1280, 720, 240, 240), { w: 240, h: 135 });
  assert.deepEqual(thumbBox(400, 1600, 240, 240), { w: 60, h: 240 });
  assert.deepEqual(thumbBox(100, 80, 240, 240), { w: 100, h: 80 }); // pequena fica
  assert.equal(thumbBox(null, 80), null);
});

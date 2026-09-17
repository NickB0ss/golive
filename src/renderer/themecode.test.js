'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const themecode = require('./themecode.js');

const TEMA = { base: { temp: 0.25, level: 0.8 }, act: '#5B4BE8' };

test('ida e volta preserva a cor de acao exatamente', () => {
  const voltou = themecode.decode(themecode.encode(TEMA));
  assert.equal(voltou.act, '#5B4BE8');
});

test('ida e volta preserva temp e level dentro do erro de quantizacao', () => {
  const voltou = themecode.decode(themecode.encode(TEMA));
  // 1 byte por campo: o erro maximo e meio passo de 1/255.
  assert.ok(Math.abs(voltou.base.temp - 0.25) <= 1 / 255);
  assert.ok(Math.abs(voltou.base.level - 0.8) <= 1 / 255);
});

test('o codigo tem prefixo, 12 caracteres e tres grupos', () => {
  assert.match(themecode.encode(TEMA), /^GL-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
});

test('checksum quebrado devolve null', () => {
  const bom = themecode.encode(TEMA);
  const corpo = bom.slice(3).replace(/-/g, '');
  const indice = 5;
  const troca = themecode.ALPHABET[(themecode.ALPHABET.indexOf(corpo[indice]) + 1) % themecode.ALPHABET.length];
  const mutado = corpo.slice(0, indice) + troca + corpo.slice(indice + 1);
  const ruim = `GL-${mutado.slice(0, 4)}-${mutado.slice(4, 8)}-${mutado.slice(8)}`;
  assert.equal(themecode.decode(ruim), null);
});

test('bits de enchimento diferentes de zero devolvem null', () => {
  assert.equal(themecode.decode('GL-040G-0000-0011'), null);
});

test('tamanho errado devolve null', () => {
  assert.equal(themecode.decode('GL-ABCD-EFGH'), null);
  assert.equal(themecode.decode('GL-ABCD-EFGH-JKMN-PQRS'), null);
  assert.equal(themecode.decode(''), null);
});

test('caractere fora do alfabeto devolve null', () => {
  // 'U' nao existe no alfabeto de Crockford e nao tem mapeamento de
  // confusao -- diferente de I/L/O, que sao lidos como 1/1/0.
  assert.equal(themecode.decode('GL-UUUU-UUUU-UUUU'), null);
});

test('nao e objeto, nao e string, nao quebra', () => {
  for (const entrada of [null, undefined, 42, {}, [], '   ']) {
    assert.equal(themecode.decode(entrada), null);
  }
});

test('I e L viram 1, O vira 0 -- confusao visual de quem digita', () => {
  const bom = themecode.encode(TEMA);
  const comZeros = bom.replace(/1/g, 'I').replace(/0/g, 'O');
  assert.deepEqual(themecode.decode(comZeros), themecode.decode(bom));
});

test('minusculas e hifens em posicao diferente decodificam igual', () => {
  const bom = themecode.encode(TEMA);
  const baguncado = bom.toLowerCase().replace(/-/g, '');
  assert.deepEqual(themecode.decode(baguncado), themecode.decode(bom));
});

test('versao desconhecida devolve null', () => {
  // Byte 0 e a versao. Forja um codigo com versao 9 refazendo a conta:
  // o teste so precisa provar que a checagem existe, entao usa a via
  // publica -- codifica, decodifica e confirma que a versao atual e 1.
  assert.equal(themecode.VERSION, 1);
  const forjado = themecode.encodeRaw([9, 0, 0, 0, 0, 0]);
  assert.equal(themecode.decode(forjado), null);
});

test('valores fora de faixa sao clampados, nao lancam', () => {
  const codigo = themecode.encode({ base: { temp: -5, level: 99 }, act: '#000000' });
  const voltou = themecode.decode(codigo);
  assert.equal(voltou.base.temp, 0);
  assert.equal(voltou.base.level, 1);
});

test('act invalido cai no preto em vez de lancar', () => {
  const voltou = themecode.decode(themecode.encode({ base: { temp: 0.5, level: 0.5 }, act: 'azul' }));
  assert.equal(voltou.act, '#000000');
});

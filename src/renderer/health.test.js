'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const health = require('./health');

const OK = null; // receiveHealth "sem problema"
function rh(freezeRate, lossPct) {
  return { freezeRate, lossPct };
}

test('estado inicial e ok, sem culpado nem texto', () => {
  const s = health.initialState();
  assert.equal(s.level, 'ok');
  assert.equal(s.blame, null);
  assert.equal(s.text, '');
});

test('isTravando: freeze acima do limite ou perda acima do limite', () => {
  assert.equal(health.isTravando(rh(7, 0)), true);
  assert.equal(health.isTravando(rh(0, 3)), true);
  assert.equal(health.isTravando(rh(6, 2)), false); // no limiar, nao acima
  assert.equal(health.isTravando(null), false);
  assert.equal(health.isTravando(undefined), false);
});

test('uma unica amostra ruim nao muda nada -- histerese exige tempo continuo', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), null, 1000);
  assert.equal(s.level, 'ok');
});

test('travando por ATTENTION_MS seguidos vira atencao, sem culpado quando limit e null', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), null, 0);
  s = health.next(s, rh(10, 0), null, health.LIMITS.ATTENTION_MS);
  assert.equal(s.level, 'atencao');
  assert.equal(s.blame, null);
  assert.match(s.text, /rede entre voc/);
});

test('travando por BAD_MS seguidos vira ruim e nomeia o culpado quando ha limit', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), 'cpu', 0);
  s = health.next(s, rh(10, 0), 'cpu', health.LIMITS.ATTENTION_MS);
  assert.equal(s.level, 'atencao');
  s = health.next(s, rh(10, 0), 'cpu', health.LIMITS.BAD_MS);
  assert.equal(s.level, 'ruim');
  assert.equal(s.blame, 'cpu');
  assert.match(s.text, /máquina de quem está transmitindo/);
});

test('culpado: bandwidth e other tem texto proprio', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), 'bandwidth', 0);
  s = health.next(s, rh(10, 0), 'bandwidth', health.LIMITS.ATTENTION_MS);
  assert.equal(s.blame, 'bandwidth');
  assert.match(s.text, /rede de quem está transmitindo/);

  let s2 = health.initialState();
  s2 = health.next(s2, rh(10, 0), 'other', 0);
  s2 = health.next(s2, rh(10, 0), 'other', health.LIMITS.ATTENTION_MS);
  assert.equal(s2.blame, 'other');
  assert.match(s2.text, /encoder de quem está transmitindo/);
});

test('limit invalido (lixo de cliente hostil) nao vira culpado -- mesmo tratamento de null', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), 'sql-injection', 0);
  s = health.next(s, rh(10, 0), 'sql-injection', health.LIMITS.ATTENTION_MS);
  assert.equal(s.blame, null);
});

test('recuperar exige RECOVER_MS de folga continua, um degrau por vez', () => {
  let s = health.initialState();
  // Sobe ate "ruim".
  s = health.next(s, rh(10, 0), 'cpu', 0);
  s = health.next(s, rh(10, 0), 'cpu', health.LIMITS.BAD_MS);
  assert.equal(s.level, 'ruim');

  // Uma amostra boa isolada nao desce nada.
  s = health.next(s, OK, 'cpu', health.LIMITS.BAD_MS + 1000);
  assert.equal(s.level, 'ruim');

  // RECOVER_MS de folga continua desce so UM degrau.
  const t1 = health.LIMITS.BAD_MS + 1000 + health.LIMITS.RECOVER_MS;
  s = health.next(s, OK, 'cpu', t1);
  assert.equal(s.level, 'atencao');

  // O degrau seguinte exige OUTRO RECOVER_MS inteiro -- nao ganha de graca
  // so porque a folga anterior ja tinha passado de 10s.
  const t2 = t1 + 1000;
  s = health.next(s, OK, 'cpu', t2);
  assert.equal(s.level, 'atencao');

  const t3 = t1 + health.LIMITS.RECOVER_MS;
  s = health.next(s, OK, 'cpu', t3);
  assert.equal(s.level, 'ok');
  assert.equal(s.blame, null);
  assert.equal(s.text, '');
});

test('uma amostra ruim isolada durante a recuperacao reinicia a folga', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), null, 0);
  s = health.next(s, rh(10, 0), null, health.LIMITS.ATTENTION_MS);
  assert.equal(s.level, 'atencao');

  // Quase recuperado...
  s = health.next(s, OK, null, health.LIMITS.ATTENTION_MS + health.LIMITS.RECOVER_MS - 1);
  assert.equal(s.level, 'atencao');

  // ...mas uma amostra ruim no meio reinicia a contagem de folga.
  s = health.next(s, rh(10, 0), null, health.LIMITS.ATTENTION_MS + health.LIMITS.RECOVER_MS);
  assert.equal(s.level, 'atencao'); // ainda nao completou BAD_MS de novo

  s = health.next(s, OK, null, health.LIMITS.ATTENTION_MS + health.LIMITS.RECOVER_MS + 1000);
  // a folga comecou de novo neste instante -- nao esta recuperada ainda
  assert.equal(s.level, 'atencao');
});

test('receiveHealth ausente (null) conta como folga, nao como travando', () => {
  let s = health.initialState();
  s = health.next(s, null, null, 0);
  assert.equal(s.level, 'ok');
});

test('entradas ausentes: sem receiveHealth e sem limit devolve ok neutro', () => {
  const s = health.next(undefined, undefined, undefined, undefined);
  assert.equal(s.level, 'ok');
  assert.equal(s.blame, null);
  assert.equal(s.text, '');
});

test('blameFor: so o enum fechado vira culpado', () => {
  assert.equal(health.blameFor('bandwidth'), 'bandwidth');
  assert.equal(health.blameFor('cpu'), 'cpu');
  assert.equal(health.blameFor('other'), 'other');
  assert.equal(health.blameFor(null), null);
  assert.equal(health.blameFor(undefined), null);
  assert.equal(health.blameFor('lixo'), null);
});

test('culpado atualiza mesmo sem trocar de nivel', () => {
  let s = health.initialState();
  s = health.next(s, rh(10, 0), null, 0);
  s = health.next(s, rh(10, 0), null, health.LIMITS.ATTENTION_MS);
  assert.equal(s.level, 'atencao');
  assert.equal(s.blame, null);

  // A origem descobre e anuncia a propria limitacao no meio da mesma
  // corrida ruim -- o texto tem de nomear o culpado sem esperar o proximo
  // degrau de nivel.
  s = health.next(s, rh(10, 0), 'cpu', health.LIMITS.ATTENTION_MS + 500);
  assert.equal(s.level, 'atencao');
  assert.equal(s.blame, 'cpu');
});

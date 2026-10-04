'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const KEYWORDS_EN = require('./emoji-en');
const KEYWORDS_ES = require('./emoji-es');
const { GROUPS, MAX_RECENTS, normalize, search, labelFor, isKnown, pushRecent, loadRecents } = require('./emoji');

test('a lista tem grupos com id, rotulo, icone e itens', () => {
  assert.ok(GROUPS.length >= 6);
  for (const g of GROUPS) {
    assert.equal(typeof g.id, 'string');
    assert.ok(g.label);
    assert.ok(g.icon);
    assert.ok(Array.isArray(g.items) && g.items.length > 0, `grupo ${g.id} vazio`);
  }
});

test('nenhum emoji aparece em dois grupos', () => {
  const vistos = new Set();
  for (const g of GROUPS) {
    for (const [char] of g.items) {
      assert.ok(!vistos.has(char), `${char} duplicado (grupo ${g.id})`);
      vistos.add(char);
    }
  }
  assert.ok(vistos.size > 300, `so ${vistos.size} emoji na lista`);
});

test('toda entrada tem palavras-chave sem acento', () => {
  // A busca normaliza a CONSULTA; se a lista tivesse acento, "cao" nao
  // acharia "coração" e o autor da lista nunca saberia.
  for (const g of GROUPS) {
    for (const [char, keywords] of g.items) {
      assert.ok(keywords && keywords.trim(), `${char} sem palavra-chave`);
      assert.equal(keywords, normalize(keywords), `${char}: "${keywords}" tem acento ou maiuscula`);
    }
  }
});

test('o icone do grupo e um emoji do proprio grupo', () => {
  for (const g of GROUPS) {
    assert.ok(g.items.some(([char]) => char === g.icon), `icone de ${g.id} nao esta no grupo`);
  }
});

test('normalize tira acento e caixa', () => {
  assert.equal(normalize('CORAÇÃO'), 'coracao');
  assert.equal(normalize('  Não  '), 'nao');
  assert.equal(normalize(null), '');
});

test('busca acha com e sem acento', () => {
  assert.deepEqual(search('coração').slice(0, 1), search('coracao').slice(0, 1));
  assert.ok(search('pizza').includes('🍕'));
  assert.ok(search('cachorro').includes('🐶'));
});

test('busca acha em ingles e espanhol, alem do portugues', () => {
  const coracao = '❤️';
  for (const termo of ['coracao', 'heart', 'corazon']) {
    assert.ok(search(termo).includes(coracao), termo);
  }
});

test('todo emoji tem palavras en e es e o rotulo acompanha o idioma', () => {
  for (const g of GROUPS) {
    for (const [char] of g.items) {
      assert.ok(KEYWORDS_EN[char], `${char} sem palavra en`);
      assert.ok(KEYWORDS_ES[char], `${char} sem palavra es`);
    }
  }
  const anterior = global.GoLive.i18n;
  const idioma = 'pt-BR';
  const ativo = { idioma };
  global.GoLive.i18n = {
    idiomaAtivo: () => ativo.idioma,
    definirIdioma: (codigo) => { ativo.idioma = codigo; },
  };
  const i18n = global.GoLive.i18n;
  i18n.definirIdioma('en');
  assert.equal(labelFor('❤️'), 'heart');
  i18n.definirIdioma('es');
  assert.equal(labelFor('❤️'), 'corazon');
  i18n.definirIdioma('pt-BR');
  global.GoLive.i18n = anterior;
});

test('busca e por prefixo de palavra, nao por pedaco no meio', () => {
  // "car" acha "carro"/"carta"; nao pode achar "placar".
  const r = search('car');
  assert.ok(r.includes('🚗'));
  assert.ok(!r.includes('🏆')); // trofeu ('trofeu campeao vitoria') nao casa "car"
});

test('busca casa TODOS os termos digitados', () => {
  assert.ok(search('bolo aniversario').includes('🎂'));
  assert.equal(search('pizza unicornio').length, 0);
});

test('o peso desempata a favor do obvio', () => {
  assert.equal(search('coracao')[0], '❤️');
  assert.equal(search('festa')[0], '🎉');
  assert.equal(search('carro')[0], '🚗');
});

test('busca vazia devolve nada (nao a lista inteira)', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
});

test('busca respeita o limite pedido', () => {
  assert.ok(search('a', 5).length <= 5);
});

test('busca sem resultado devolve lista vazia', () => {
  assert.deepEqual(search('xyzzynaoexiste'), []);
});

test('labelFor devolve a primeira palavra-chave', () => {
  assert.equal(labelFor('🍕'), 'pizza');
  assert.equal(labelFor('não é emoji'), '');
});

test('isKnown so aceita emoji da lista', () => {
  assert.ok(isKnown('🍕'));
  assert.ok(!isKnown('🫥'));
  assert.ok(!isKnown(''));
});

test('pushRecent poe na frente sem repetir', () => {
  let r = [];
  r = pushRecent(r, '🍕');
  r = pushRecent(r, '🎉');
  r = pushRecent(r, '🍕');
  assert.deepEqual(r, ['🍕', '🎉']);
});

test('pushRecent respeita o teto', () => {
  let r = [];
  for (const g of GROUPS) for (const [char] of g.items) r = pushRecent(r, char);
  assert.equal(r.length, MAX_RECENTS);
});

test('pushRecent ignora emoji que nao esta na lista', () => {
  assert.deepEqual(pushRecent(['🍕'], 'nao-emoji'), ['🍕']);
});

test('loadRecents limpa lixo vindo do config', () => {
  assert.deepEqual(loadRecents(['🍕', '🍕', 'lixo', 42, '🎉']), ['🍕', '🎉']);
  assert.deepEqual(loadRecents('nao e lista'), []);
  assert.deepEqual(loadRecents(undefined), []);
});

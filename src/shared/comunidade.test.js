'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linkDeApoio } = require('./comunidade');

test('sugestoes e PayPal abrem somente os destinos oficiais por identificador', () => {
  assert.equal(linkDeApoio('sugestoes'), 'https://forms.gle/ym5yB2bbbwip9ypm7');
  const paypal = new URL(linkDeApoio('paypal'));
  assert.equal(paypal.origin, 'https://www.paypal.com');
  assert.equal(paypal.searchParams.get('business'), 'ZZM3JAT2YKVVC');
  assert.equal(paypal.searchParams.get('currency_code'), 'BRL');
});

test('nao aceita URLs arbitrarias, propriedades herdadas ou entradas malformadas', () => {
  for (const id of ['https://example.com', 'file:///C:/', '__proto__', 'constructor', null, {}, ['paypal']]) {
    assert.equal(linkDeApoio(id), null);
  }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SCREEN_HEIGHTS,
  MIN_SCREEN_BITRATE_BPS,
  bitrateCap,
  scaleDownByForHeight,
  nearestAcceptableScale,
  initialState,
  next,
} = require('./screenres');

test('scaleDownByForHeight so aceita saida H.264 par e com 360px ou mais', () => {
  for (const [width, height] of [
    [1920, 1080], [1280, 720], [1366, 768], [1600, 900], [2560, 1440], [3440, 1440],
  ]) {
    for (const targetHeight of SCREEN_HEIGHTS) {
      const scale = scaleDownByForHeight(width, height, targetHeight);
      if (targetHeight > height) {
        assert.equal(scale, null, `${width}x${height} nao sobe para ${targetHeight}p`);
        continue;
      }
      assert.notEqual(scale, null, `${width}x${height} tem fator para ${targetHeight}p`);
      const outWidth = Math.trunc(width / scale);
      const outHeight = Math.trunc(height / scale);
      assert.equal(outWidth % 2, 0, `${width}x${height} -> ${outWidth} tem largura par`);
      assert.equal(outHeight % 2, 0, `${width}x${height} -> ${outHeight} tem altura par`);
      assert.ok(outHeight >= 360, `${width}x${height} -> ${outHeight} nao cai abaixo de 360`);
    }
  }
});

test('nearestAcceptableScale sobe ao proximo degrau seguro quando o pedido nao fecha par', () => {
  const chosen = nearestAcceptableScale(1364, 1080, 720);
  assert.deepEqual(chosen, { height: 1080, scaleDownBy: 1 });
});

test('teto acima da captura preserva a resolucao nativa par do notebook', () => {
  for (const [width, height] of [[1600, 900], [1366, 768], [1440, 900]]) {
    assert.deepEqual(
      nearestAcceptableScale(width, height, 1080, 1080, 1),
      { height, scaleDownBy: 1 },
      `${width}x${height} fica nativo com teto 1080p`
    );
  }
});

test('degraus baixos reduzem notebook para alturas H.264 seguras', () => {
  for (const [width, height] of [[1600, 900], [1366, 768], [1440, 900]]) {
    for (const target of [720, 540, 360]) {
      const chosen = nearestAcceptableScale(width, height, target, 1080, 1);
      assert.equal(chosen.height, target, `${width}x${height} chega em ${target}p`);
      assert.equal(Math.trunc(width / chosen.scaleDownBy) % 2, 0);
      assert.equal(Math.trunc(height / chosen.scaleDownBy) % 2, 0);
    }
  }
});

test('ultrawide limitado a 1080p fica nativo quando a altura e segura', () => {
  assert.deepEqual(
    nearestAcceptableScale(1920, 804, 1080, 1080, 1),
    { height: 804, scaleDownBy: 1 }
  );
});

test('sem degrau seguro usa o fator P1 em vez de deixar o encoding vazio', () => {
  // 1203x805: 720 da largura impar, /2 da 601 (impar) e /4 fica abaixo de
  // 360 -- nenhuma saida serve, e o P1 ainda precisa levar bitrate/fps.
  assert.deepEqual(
    nearestAcceptableScale(1203, 805, 720, 720, 2),
    { height: 402, scaleDownBy: 2, fallback: true }
  );
  // Ja o 1920x804 com P1=2 tem saida segura na divisao inteira: nao e
  // fallback, e 960x402 (antes da busca por escala inteira este caso caia
  // no fallback por acaso -- ver o teste do ultrawide abaixo).
  assert.deepEqual(nearestAcceptableScale(1920, 804, 720, 720, 2), { height: 402, scaleDownBy: 2 });
});

test('ultrawide sem degrau exato desce por escala inteira segura dentro do teto', () => {
  for (const ceiling of [360, 540, 720]) {
    assert.deepEqual(
      nearestAcceptableScale(1920, 804, ceiling, ceiling, 1),
      { height: 402, scaleDownBy: 2 },
      `1920x804 desce para 960x402 com teto ${ceiling}p`
    );
  }
});

test('subida para achar par nao ultrapassa a altura da captura', () => {
  assert.deepEqual(
    nearestAcceptableScale(1002, 722, 360, 1080, 1),
    { height: 722, scaleDownBy: 1, fallback: true }
  );
});

test('nenhuma escolha normal entrega dimensao impar ou altura menor que 360', () => {
  for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1440, 900], [1920, 804], [1202, 846]]) {
    for (const ceiling of SCREEN_HEIGHTS) {
      for (const target of SCREEN_HEIGHTS.filter((step) => step <= ceiling)) {
        const chosen = nearestAcceptableScale(width, height, target, ceiling, 1);
        if (chosen.fallback) continue;
        assert.equal(Math.trunc(width / chosen.scaleDownBy) % 2, 0, `${width}x${height} -> largura par`);
        assert.equal(Math.trunc(height / chosen.scaleDownBy) % 2, 0, `${width}x${height} -> altura par`);
        assert.ok(chosen.height >= 360, `${width}x${height} nao fica abaixo de 360`);
      }
    }
  }
});

test('BWE desce depois de 5s e so sobe apos 15s sustentados com folga', () => {
  let state = initialState(1080);
  state = next(state, 4_000_000, 0, 1080);
  state = next(state, 4_000_000, 4_999, 1080);
  assert.equal(state.height, 1080);
  state = next(state, 4_000_000, 5_000, 1080);
  assert.equal(state.height, 720);

  state = next(state, 20_000_000, 5_001, 1080);
  state = next(state, 20_000_000, 20_000, 1080);
  assert.equal(state.height, 720);
  state = next(state, 20_000_000, 35_000, 1080);
  assert.equal(state.height, 1080);
});

test('BWE nunca sobe alem do teto da escada por espectador', () => {
  let state = initialState(720);
  state = next(state, 20_000_000, 0, 720);
  state = next(state, 20_000_000, 20_000, 720);
  assert.equal(state.height, 720);
});

test('bitrateCap nunca fica abaixo do piso e cresce com a BWE', () => {
  assert.equal(bitrateCap(6_000_000, 100_000), MIN_SCREEN_BITRATE_BPS);
  assert.equal(bitrateCap(6_000_000, null), 6_000_000);
  assert.ok(bitrateCap(6_000_000, 2_000_000) > bitrateCap(6_000_000, 1_000_000));
  assert.equal(bitrateCap(2_500_000, 10_000_000), 2_500_000);
});

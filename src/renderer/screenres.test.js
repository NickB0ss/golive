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

test('bitrateCap nunca fica abaixo do piso e cresce com a BWE', () => {
  assert.equal(bitrateCap(6_000_000, 100_000), MIN_SCREEN_BITRATE_BPS);
  assert.equal(bitrateCap(6_000_000, null), 6_000_000);
  assert.ok(bitrateCap(6_000_000, 2_000_000) > bitrateCap(6_000_000, 1_000_000));
  assert.equal(bitrateCap(2_500_000, 10_000_000), 2_500_000);
});

// ---------- Escada por congestao (plano 2026-10-25-escada-de-resolucao-por-congestao) ----------
const sr = require('./screenres');
const { observacao, RECUO_INICIAL_MS, RECUO_MAX_MS } = sr;

/** Estado de uma PC ja aquecida, no degrau `height`, com media `bwe`. */
const aquecido = (height, bwe) => ({ ...initialState(1080, -60_000), height, bweBps: bwe });
/** Observacao de um tick; por padrao 1000 pacotes enviados e nenhum perdido. */
const obs = (bwe, real, extra = {}) => ({
  availableBps: bwe, realBps: real, perdidos: 0, enviados: 1000, rttMs: 30, limitacao: null, enviando: true, ...extra,
});

/** Roda ticks de `tick` s a partir de `t0` s. `f(t)` devolve a obs. */
function rodar(st, { t0 = 0, segundos, tick = 1, f, maxHeight = 1080 }) {
  const trocas = [];
  for (let t = t0; t < t0 + segundos; t += tick) {
    const antes = st.height;
    st = next(st, f(t), t * 1000, maxHeight);
    if (st.height !== antes) trocas.push({ t, de: antes, para: st.height, motivo: st.motivo });
  }
  return { st, trocas };
}

/** PRNG com semente, para o ruido ser o mesmo em toda execucao. */
function sorteio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

test('aquecimento: nos primeiros 10 s nada decide e a BWE segue a amostra crua', () => {
  let st = initialState(1080, 0);
  for (let t = 0; t < 9; t += 1) st = next(st, obs(300_000, 300_000), t * 1000, 1080);
  st = next(st, obs(8_000_000, 5_000_000), 9000, 1080);
  assert.equal(st.height, 1080);
  assert.equal(st.bweBps, 8_000_000, 'a media comeca do ultimo valor do aquecimento, nao dos 300 kbps');
});

test('encoder com folga nao desce, por mais baixa que a BWE esteja', () => {
  const { st } = rodar(aquecido(1080, 1_000_000), { segundos: 60, f: () => obs(1_000_000, 200_000) });
  assert.equal(st.height, 1080);
});

test('BWE limitando com o encoder pressionando desce em 5 s, com o motivo', () => {
  const { trocas } = rodar(aquecido(720, 1_500_000), { segundos: 10, f: () => obs(1_500_000, 1_400_000) });
  assert.equal(trocas[0].t, 5);
  assert.equal(trocas[0].para, 540);
  assert.match(trocas[0].motivo, /bwe 1500 kbps com o encoder usando 93% dela/);
});

test('serrote da BWE nao segura a descida (N1)', () => {
  // GCC classico: sobe devagar (2 %/s por 7 s) e cai de uma vez, perto de 2 Mbps.
  const serra = (t) => 2_000_000 * (0.87 + 0.02 * (t % 8));
  const { trocas } = rodar(aquecido(1080, 2_000_000), { segundos: 30, f: (t) => obs(serra(t), 0.95 * serra(t)) });
  assert.ok(trocas.length && trocas[0].t <= 6, `desceu aos ${trocas[0]?.t}s`);
});

test('ruido de +-15 % na BWE atrasa pouco a descida (N1)', () => {
  const rnd = sorteio(7);
  const { trocas } = rodar(aquecido(1080, 2_000_000), {
    segundos: 40, f: () => obs(2_000_000 * (0.85 + 0.3 * rnd()), 1_900_000),
  });
  assert.ok(trocas.length && trocas[0].t <= 15, `desceu aos ${trocas[0]?.t}s`);
});

test('com tentativa aberta, a BWE subindo pausa a descida (I3)', () => {
  // Saindo de um valor congelado, o GCC cresce ~5%/s com o encoder cheio.
  const st = { ...aquecido(720, 1_000_000), tentativa: { desdeMs: 0, pressaoMs: 0 } };
  const { trocas } = rodar(st, {
    segundos: 20, f: (t) => obs(1_000_000 * 1.06 ** (t + 1), 0.95 * 1_000_000 * 1.06 ** (t + 1)),
  });
  assert.equal(trocas.filter((x) => x.para < 720).length, 0);
});

test('perda na janela: 2 a 5 % trava a subida, abaixo de 2 % sobe, e nunca desce sozinha (M1)', () => {
  const travado = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 300_000, { perdidos: 30 }) });
  assert.equal(travado.st.height, 540);
  assert.equal(travado.st.perda, 0.03);
  const livre = rodar(aquecido(540, 1_500_000), { segundos: 20, f: () => obs(1_500_000, 300_000, { perdidos: 10 }) });
  assert.equal(livre.st.height, 720);
  const muita = rodar(aquecido(720, 1_500_000), { segundos: 30, f: () => obs(1_500_000, 300_000, { perdidos: 200 }) });
  assert.equal(muita.st.height, 720, 'perda com o encoder ocioso nao desce: o GCC ja cortou a BWE');
});

test('tela parada com poucos pacotes: uma perda isolada nao trava a subida (N3)', () => {
  // ~30 pacotes/s e um perdido a cada 3 s: 1 em 30 num tick (3,3 %), ~1,1 % na janela.
  const { st, trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 20, f: (t) => obs(1_500_000, 150_000, { enviados: 30, perdidos: t % 3 === 0 ? 1 : 0 }),
  });
  assert.equal(trocas[0]?.t, 15);
  assert.ok(st.perda < 0.02);
  // Menos de 200 pacotes na janela: a perda nao e medida, nao trava nada.
  const pouco = rodar(aquecido(540, 1_500_000), { segundos: 20, f: () => obs(1_500_000, 150_000, { enviados: 10, perdidos: 1 }) });
  assert.equal(pouco.st.perda, null);
  assert.equal(pouco.st.height, 720);
});

test('RTT inflado trava a subida, e a janela de 60 s absorve um patamar novo (I4)', () => {
  const { trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 200, f: (t) => obs(1_500_000, 300_000, { rttMs: t < 20 ? 30 : 230 }),
  });
  // Folga desde t=0; o RTT infla aos 20 s e zera a folga. A base de 30 ms
  // sai da janela entre 70 e 80 s, e a folga recomeca a contar dali.
  assert.ok(trocas[0].t < 20, 'subiu antes do RTT inflar');
  const depois = trocas.filter((x) => x.t >= 20);
  assert.ok(depois.length && depois[0].t >= 80 && depois[0].t <= 100, `voltou a subir aos ${depois[0]?.t}s`);
});

test('RTT zero ou negativo nao entra na base (I4)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), {
    segundos: 20, f: (t) => obs(1_500_000, 300_000, { rttMs: t === 0 ? 0 : 40 }),
  });
  assert.equal(st.height, 720);
});

test('tentativa: 15 s de folga sobem um degrau e abrem a tentativa', () => {
  const { st, trocas } = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  assert.deepEqual(trocas.map((x) => [x.t, x.para]), [[15, 720]]);
  assert.match(trocas[0].motivo, /^tentativa: encoder usando 30% da bwe/);
  assert.ok(st.tentativa);
});

test('tick pressionando pausa a folga em vez de zerar (B1)', () => {
  // uso alternando 0,3 e 0,9, BWE acima do limiar de descida: sem zona morta.
  const { trocas } = rodar(aquecido(540, 1_500_000), {
    segundos: 40, f: (t) => obs(1_500_000, t % 2 ? 1_350_000 : 450_000),
  });
  assert.equal(trocas[0].para, 720);
  assert.ok(trocas[0].t >= 29 && trocas[0].t <= 31, `subiu aos ${trocas[0].t}s`);
});

test('tentativa que falha dobra o recuo e a proxima espera o recuo novo', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  const desc = r.trocas.find((x) => x.para === 540);
  // Limitando a partir do tick dos 16 s: 5 s acumulados no tick dos 20 s.
  assert.equal(desc.t, 20);
  assert.equal(r.st.recuoMs, 2 * RECUO_INICIAL_MS);
  assert.match(desc.motivo, /tentativa falhou, proxima em 30s/);
  // Dos 21 aos 25 s o encoder segue pressionando em 540p: a folga fica
  // parada. Ela anda de 1 s em 1 s a partir do tick dos 26 s e chega aos
  // 30 s de recuo no tick dos 55 s.
  const volta = rodar(r.st, { t0: 26, segundos: 40, f: () => obs(1_500_000, 450_000) });
  assert.equal(volta.trocas[0].t, 55);
});

test('tela parada nao prova a tentativa (B2)', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 120, f: () => obs(1_500_000, 150_000), maxHeight: 720 });
  assert.ok(r.st.tentativa, '2 min de folga nao provam banda nenhuma');
  r = rodar(r.st, { t0: 136, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.st.recuoMs, 2 * RECUO_INICIAL_MS, 'a falha depois da folga ainda conta como falha');
});

test('tentativa se prova com 10 s de encoder pressionando sem limitar, sem subir junto (M4)', () => {
  let st = { ...aquecido(540, 1_500_000), recuoMs: 2 * RECUO_INICIAL_MS };
  let r = rodar(st, { segundos: 31, f: () => obs(1_500_000, 450_000) });
  assert.equal(r.st.height, 720);
  // Em 720p com BWE de 2,5 Mbps (acima do limiar de descida, 1,8 Mbps).
  r = rodar(r.st, { t0: 31, segundos: 11, f: () => obs(2_500_000, 2_300_000), maxHeight: 1080 });
  st = r.st;
  assert.equal(st.tentativa, null);
  assert.equal(st.recuoMs, RECUO_INICIAL_MS);
  assert.equal(st.height, 720, 'zerar o recuo nao dispara outra subida na mesma amostra');
  assert.equal(st.folgaMs, 0);
});

test('o recuo tem teto', () => {
  let st = aquecido(540, 1_500_000);
  let t = 0;
  const recuos = [];
  for (let ciclo = 0; ciclo < 5; ciclo += 1) {
    let r = rodar(st, { t0: t, segundos: st.recuoMs / 1000 + 1, f: () => obs(1_500_000, 450_000) });
    t += st.recuoMs / 1000 + 1;
    r = rodar(r.st, { t0: t, segundos: 6, f: () => obs(1_500_000, 1_450_000) });
    t += 6;
    st = r.st;
    recuos.push(st.recuoMs / 1000);
  }
  assert.deepEqual(recuos, [30, 60, 120, 120, 120]);
  assert.equal(RECUO_MAX_MS, 120_000);
});

test('tentativa empilhada sobre outra sem prova espera o dobro (N5)', () => {
  const { trocas } = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 150_000) });
  assert.deepEqual(trocas.map((x) => [x.t, x.para]), [[15, 720], [45, 1080]]);
});

test('sem amostra de BWE nada anda, mesmo com media antiga alta (I7)', () => {
  const { st } = rodar(aquecido(720, 20_000_000), {
    segundos: 60, f: () => ({ availableBps: null, realBps: 100_000, enviando: true }),
  });
  assert.equal(st.height, 720);
  assert.equal(st.aboveSinceMs, null);
  assert.equal(st.bweBps, 20_000_000);
});

test('sem quadros saindo (pausa, demanda suspensa) nada anda (I2)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 120, f: () => obs(1_500_000, 0, { enviando: false }) });
  assert.equal(st.height, 540);
  assert.equal(st.folgaMs, 0);
});

test('voltar a enviar depois de 10 s parado reabre o aquecimento (N12)', () => {
  let r = rodar(aquecido(720, 1_500_000), { segundos: 30, f: () => obs(1_500_000, 0, { enviando: false }) });
  // Na volta, a BWE limitando (encoder cheio): no aquecimento nada decide.
  r = rodar(r.st, { t0: 30, segundos: 9, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas.length, 0);
  r = rodar(r.st, { t0: 39, segundos: 10, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas[0]?.para, 540, 'depois do aquecimento a regra volta a valer');
  // Parada curta (menos de 10 s) nao reabre.
  let c = rodar(aquecido(720, 1_500_000), { segundos: 3, f: () => obs(1_500_000, 0, { enviando: false }) });
  c = rodar(c.st, { t0: 3, segundos: 8, f: () => obs(1_500_000, 1_450_000) });
  // O relogio andou nos ticks parados: o tick dos 3 s ja soma 1 s limitando,
  // e os 5 s fecham no tick dos 7 s.
  assert.equal(c.trocas[0]?.t, 7);
});

test('um tick atrasado vale no maximo 10 s (N2)', () => {
  let st = { ...aquecido(540, 1_500_000), ultimoMs: 0 };
  st = next(st, obs(1_500_000, 150_000), 90_000, 1080);
  assert.equal(st.height, 540, '90 s sem linha nao viram 90 s de folga');
  assert.equal(st.folgaMs, 10_000);
});

test('com tick de 5 s, uma amostra limitando sozinha nao derruba o degrau', () => {
  const st = { ...aquecido(1080, 2_000_000), ultimoMs: -5000 };
  const limitando = obs(2_000_000, 1_900_000);
  const folga = obs(2_000_000, 300_000);
  const uma = rodar(st, { segundos: 30, tick: 5, f: (t) => (t === 0 ? limitando : folga) });
  assert.equal(uma.trocas.length, 0);
  const duas = rodar(st, { segundos: 30, tick: 5, f: (t) => (t <= 5 ? limitando : folga) });
  assert.equal(duas.trocas[0]?.t, 5);
});

test('tentativa se prova com o encoder mandando o limiar de descida do degrau, sem pressionar', () => {
  // Conteudo que cabe folgado: 2 Mbps em 720p (limiar 1,8 Mbps) com BWE de 8 Mbps.
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  r = rodar(r.st, { t0: 16, segundos: 11, f: () => obs(8_000_000, 2_000_000), maxHeight: 720 });
  assert.equal(r.st.tentativa, null);
  assert.equal(r.st.recuoMs, RECUO_INICIAL_MS);
});

test('encoder limitado por CPU nao tenta subir (M7)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 60, f: () => obs(1_500_000, 450_000, { limitacao: 'cpu' }) });
  assert.equal(st.height, 540);
});

test('tick de 5 s desce no mesmo tempo de relogio que o de 1 s (I1)', () => {
  for (const tick of [1, 5]) {
    // ultimoMs: no app sempre houve um tick antes, `tick` segundos atras.
    const st = { ...aquecido(1080, 7_000_000), ultimoMs: -tick * 1000 };
    const { trocas } = rodar(st, { segundos: 30, tick, f: () => obs(1_275_000, 1_500_000) });
    assert.ok(trocas[0].t <= 7, `tick ${tick}s: desceu aos ${trocas[0].t}s`);
  }
});

test('subida comprovada pela BWE zera tentativa e recuo', () => {
  let st = { ...aquecido(540, 1_500_000), tentativa: { desdeMs: 0, pressaoMs: 0 }, recuoMs: 60_000 };
  const r = rodar(st, { segundos: 20, f: () => obs(4_000_000, 3_900_000) });
  st = r.st;
  assert.equal(r.trocas[0].para, 720);
  assert.match(r.trocas[0].motivo, /^bwe /);
  assert.equal(st.tentativa, null);
  assert.equal(st.recuoMs, RECUO_INICIAL_MS);
});

test('360p e o piso: nao desce mais', () => {
  const { st } = rodar(aquecido(360, 300_000), { segundos: 30, f: () => obs(300_000, 300_000) });
  assert.equal(st.height, 360);
});

test('nunca sobe alem do teto da escada por espectador', () => {
  const { st } = rodar(aquecido(720, 20_000_000), { segundos: 60, f: () => obs(20_000_000, 300_000), maxHeight: 720 });
  assert.equal(st.height, 720);
});

test('motivoRecente explica a linha [diag] por 30 s e depois some (M2, N7)', () => {
  const { st } = rodar(aquecido(540, 1_500_000), { segundos: 18, f: () => obs(1_500_000, 450_000), maxHeight: 720 });
  assert.equal(st.motivo, null, 'motivo so na amostra da troca');
  assert.match(sr.motivoRecente(st, 45_000), /^tentativa/);
  assert.equal(sr.motivoRecente(st, 45_001), null);
  assert.equal(sr.motivoRecente(aquecido(540, 1_500_000), 0), null);
});

test('carencia do peerquality: 10 s depois da tentativa e 10 s depois da descida que a desfaz (I3, N8)', () => {
  let r = rodar(aquecido(540, 1_500_000), { segundos: 16, f: () => obs(1_500_000, 450_000) });
  assert.equal(sr.emCarencia(r.st, 24_999), true);
  assert.equal(sr.emCarencia(r.st, 25_000), false);
  r = rodar(r.st, { t0: 16, segundos: 5, f: () => obs(1_500_000, 1_450_000) });
  assert.equal(r.trocas[0].t, 20);
  assert.equal(sr.emCarencia(r.st, 29_999), true, 'a descida que desfaz a tentativa renova a carencia');
  assert.equal(sr.emCarencia(r.st, 30_000), false);
  assert.equal(sr.emCarencia(aquecido(540, 1_500_000), 0), false);
});

test('regressao: a serie real do log de 18/10 (540p, 04:06:56-04:12:46) sai de 540p', () => {
  // Valores literais das linhas [diag] de golive log meu.log (bwe = media
  // impressa, real = realKbps). Cada linha e um instantaneo de ~1 s tratado
  // como constante ate a seguinte (15-20 s). Depois que a escada sai de
  // 540p, os valores do log ja nao valem (o encoder estaria noutro degrau):
  // o teste so cobre a saida de 540p. NAO e fonte de constantes.
  const serie = [[0, 1606, 854], [15, 1606, 1297], [30, 1849, 1439], [50, 1604, 921], [70, 1604, 825],
    [85, 1394, 813], [105, 1394, 996], [120, 1394, 1066], [140, 1394, 686], [155, 1394, 1280], [175, 1548, 853],
    [190, 1548, 1090], [205, 1705, 1454], [225, 1940, 2032], [245, 2054, 911], [265, 1537, 822], [280, 1322, 828],
    [295, 1625, 1851], [315, 3253, 1786], [330, 3407, 3918], [350, 3402, 2256]];
  const valor = (t) => serie.filter(([s]) => s <= t).at(-1);
  const { trocas } = rodar(aquecido(540, 1_606_000), {
    segundos: 360, f: (t) => { const [, b, r] = valor(t); return obs(b * 1000, r * 1000); }, maxHeight: 720,
  });
  assert.ok(trocas.length && trocas[0].para === 720 && trocas[0].t <= 20, JSON.stringify(trocas[0]));
});

test('observacao: unidades e quem conta como enviando (M6)', () => {
  const row = { availableBps: 2_000_000, mbps: 1.5, lostDelta: 3, sentDelta: 400, rttRtcp: 42, rtt: 30, limitation: 'bandwidth', fps: 30 };
  assert.deepEqual(observacao(row, { ativo: true }), {
    availableBps: 2_000_000, realBps: 1_500_000, perdidos: 3, enviados: 400, rttMs: 42, limitacao: 'bandwidth', enviando: true,
  });
  assert.equal(observacao({ ...row, rttRtcp: null }, { ativo: true }).rttMs, 30, 'sem RTT do RTCP usa o do par');
  assert.equal(observacao({ ...row, fps: 0 }, { ativo: true }).enviando, false);
  assert.equal(observacao({ ...row, fps: null }, { ativo: true }).enviando, false);
  assert.equal(observacao(row, { ativo: false }).enviando, false);
  assert.equal(observacao({ ...row, mbps: null }, { ativo: true }).realBps, null);
});

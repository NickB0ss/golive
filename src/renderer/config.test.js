'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS,
  QUALITY_PRESETS,
  QUALITY_PRESET_ORDER,
  load,
  serialize,
  videoConstraints,
  cameraConstraints,
  degradePreset,
  audienceSteps,
  qualityForAudience,
  QUALITY_RESOLUTIONS,
  QUALITY_FPS,
  presetFor,
  presetAxes,
} = require('./config');

test('load com null devolve os defaults', () => {
  const cfg = load(null);
  const { clientId, ...resto } = cfg;
  assert.deepEqual(resto, DEFAULTS);
  assert.match(clientId, /^[0-9a-f-]{36}$/);
});

test('load com JSON invalido devolve os defaults', () => {
  const cfg = load('{ nao é json');
  const { clientId, ...resto } = cfg;
  assert.deepEqual(resto, DEFAULTS);
  assert.match(clientId, /^[0-9a-f-]{36}$/);
});

test('load sem clientId gera um novo; load com clientId existente preserva', () => {
  const fresh = load(null);
  assert.match(fresh.clientId, /^[0-9a-f-]{36}$/);

  const saved = serialize({ ...fresh, clientId: 'ja-existia' });
  assert.equal(load(saved).clientId, 'ja-existia');
});

test('soundsEnabled: default true, e preserva false quando salvo', () => {
  assert.equal(load(null).soundsEnabled, true);
  const saved = serialize({ ...DEFAULTS, soundsEnabled: false });
  assert.equal(load(saved).soundsEnabled, false);
});

test('config antigo sem soundsEnabled nem clientId carrega com os defaults novos, sem quebrar', () => {
  const antigo = JSON.stringify({ v: 1, name: 'Nicolas' });
  const cfg = load(antigo);
  assert.equal(cfg.name, 'Nicolas');
  assert.equal(cfg.soundsEnabled, true);
  assert.match(cfg.clientId, /^[0-9a-f-]{36}$/);
});

test('load preenche campos ausentes de uma config antiga', () => {
  const old = JSON.stringify({ server: 'ws://26.0.0.1:9000', name: 'Nicolas', hostName: 'Nicolas' });
  const cfg = load(old);
  assert.equal(cfg.name, 'Nicolas');
  assert.equal(cfg.v, 1);
  assert.deepEqual(cfg.quality, DEFAULTS.quality);
  assert.deepEqual(cfg.camera, DEFAULTS.camera);
});

test('load preserva campos de uma config na v1 completa', () => {
  const full = serialize({
    ...DEFAULTS,
    name: 'Ana',
    quality: QUALITY_PRESETS['1080p30'],
  });
  const cfg = load(full);
  assert.equal(cfg.name, 'Ana');
  assert.equal(cfg.quality.fps, 30);
  assert.equal(cfg.quality.width, DEFAULTS.quality.width);
});

test('load migra config antigo (pre-preset) pro preset mais proximo', () => {
  const old = serialize({ ...DEFAULTS, quality: { width: 1280, height: 720, fps: 30, bitrate: 3_000_000, codec: 'video/H264' } });
  const cfg = load(old);
  assert.equal(cfg.quality.preset, '720p30');
  assert.deepEqual(cfg.quality, { ...QUALITY_PRESETS['720p30'], preset: '720p30', codec: 'video/H264' });
});

test('load com preset desconhecido cai no padrao', () => {
  const old = serialize({ ...DEFAULTS, quality: { preset: 'inexistente' } });
  const cfg = load(old);
  assert.equal(cfg.quality.preset, '1080p60');
});

test('serialize sempre grava v:1', () => {
  const json = serialize(DEFAULTS);
  assert.equal(JSON.parse(json).v, 1);
});

test('videoConstraints usa largura, altura e fps da qualidade', () => {
  const c = videoConstraints({ width: 1920, height: 1080, fps: 60 });
  assert.deepEqual(c, {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 60, max: 60 },
  });
});

test('cameraConstraints usa a config de camera', () => {
  const c = cameraConstraints({ width: 1280, height: 720, fps: 30 });
  assert.deepEqual(c, {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 30, max: 30 },
  });
});

test('network.tree comeca ligado e config antigo migra pra true', () => {
  const fresh = load(null);
  assert.equal(fresh.network.tree, true);

  const old = serialize({ ...DEFAULTS, network: { advertise: true } }); // sem 'tree'
  const cfg = load(old);
  assert.equal(cfg.network.tree, true);
  assert.equal(cfg.network.advertise, true);
});

test('network.tree ignora false salvo por uma versao antiga (nao e mais opcional)', () => {
  const saved = serialize({ ...DEFAULTS, network: { advertise: true, tree: false } });
  const cfg = load(saved);
  assert.equal(cfg.network.tree, true);
});

test('a cadeia de degradacao leva todo preset ao piso sem ciclo', () => {
  for (const preset of QUALITY_PRESET_ORDER) {
    const seen = new Set([preset]);
    let current = preset;
    for (let i = 0; i < QUALITY_PRESET_ORDER.length + 1; i += 1) {
      const next = degradePreset(current, 1);
      if (next === current) break;
      assert.equal(seen.has(next), false, `ciclo na cadeia em ${next}`);
      seen.add(next);
      current = next;
    }
    assert.equal(current, '720p30', `${preset} nao chegou no piso`);
  }
});

test('degradePreset derruba fps antes de resolucao', () => {
  assert.equal(degradePreset('1080p60', 1), '1080p30');
  assert.equal(degradePreset('1440p60', 1), '1440p30');
  assert.equal(degradePreset('720p60', 1), '720p30');
  // 1440p30 (10 Mbps) e mais barato que 1080p60 (12 Mbps): descer por
  // bitrate subiria a resolucao, a cadeia nao faz isso.
  assert.equal(degradePreset('1440p30', 1), '1080p30');
  assert.equal(degradePreset('1080p30', 1), '720p30');
});

test('degradePreset anda varios passos e para no piso', () => {
  assert.equal(degradePreset('1440p60', 2), '1080p30');
  assert.equal(degradePreset('1440p60', 3), '720p30');
  assert.equal(degradePreset('1440p60', 99), '720p30');
  assert.equal(degradePreset('720p30', 1), '720p30');
  assert.equal(degradePreset('720p30', 99), '720p30');
});

test('degradePreset devolve a entrada com steps zero/negativo ou preset desconhecido', () => {
  assert.equal(degradePreset('1080p60', 0), '1080p60');
  assert.equal(degradePreset('1080p60', -3), '1080p60');
  assert.equal(degradePreset('inexistente', 1), 'inexistente');
  assert.equal(degradePreset(undefined, 1), undefined);
});

test('audienceSteps degrada so a partir de 3 espectadores', () => {
  assert.equal(audienceSteps(0), 0);
  assert.equal(audienceSteps(1), 0);
  assert.equal(audienceSteps(2), 0);
  assert.equal(audienceSteps(3), 1);
  assert.equal(audienceSteps(4), 1);
});

test('qualityForAudience mantem 1080p60 com 2 e cai pra 1080p30 com 3', () => {
  const dois = qualityForAudience('1080p60', 2);
  assert.equal(dois.preset, '1080p60');
  assert.deepEqual(dois, { ...QUALITY_PRESETS['1080p60'], preset: '1080p60', codec: 'video/H264' });

  const tres = qualityForAudience('1080p60', 3);
  assert.equal(tres.preset, '1080p30');
  assert.deepEqual(tres, { ...QUALITY_PRESETS['1080p30'], preset: '1080p30', codec: 'video/H264' });
});

test('qualityForAudience no piso e com preset invalido nao explode', () => {
  assert.equal(qualityForAudience('720p30', 8).preset, '720p30');
  // Preset invalido cai no padrao e degrada a partir dele, em vez de
  // escapar da degradacao.
  assert.equal(qualityForAudience('inexistente', 3).preset, '1080p30');
  assert.equal(qualityForAudience(undefined, 0).preset, '1080p60');
});

// ---------- scaleFactorFor ----------
const { scaleFactorFor } = require('./config');

test('scaleFactorFor: alvo igual a captura nao escala', () => {
  assert.equal(scaleFactorFor(1920, 1920), 1);
});

test('scaleFactorFor: alvo maior que a captura nao escala (nunca aumenta)', () => {
  assert.equal(scaleFactorFor(1280, 1920), 1);
});

test('scaleFactorFor: 1920 -> 1280 e 1.5', () => {
  assert.equal(scaleFactorFor(1920, 1280), 1.5);
});

test('scaleFactorFor: 1920 -> 720 arredonda pro degrau mais proximo (3 -> 2.67)', () => {
  assert.equal(scaleFactorFor(1920, 720), 3);
});

test('scaleFactorFor: nunca passa de 4', () => {
  assert.equal(scaleFactorFor(4000, 200), 4);
});

test('scaleFactorFor: entrada invalida devolve 1, nao lanca', () => {
  for (const [c, t] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], ['x', 'y']]) {
    assert.equal(scaleFactorFor(c, t), 1);
  }
});

// ---------- qualityForRelay ----------
const { qualityForRelay } = require('./config');

test('qualityForRelay: sem filhos devolve o preset da origem', () => {
  assert.equal(qualityForRelay('1080p60', 0).preset, '1080p60');
});

test('qualityForRelay: sem banda medida, divide o bitrate do preset pelos filhos', () => {
  // 1080p60 = 12 Mbps; 2 filhos -> orcamento 6 Mbps/filho -> 1080p30 (6 Mbps)
  assert.equal(qualityForRelay('1080p60', 2).preset, '1080p30');
  // 3 filhos -> 4 Mbps/filho -> nao cabe 1080p30, desce a cadeia -> 720p30
  assert.equal(qualityForRelay('1080p60', 3).preset, '720p30');
});

test('qualityForRelay: com banda medida, usa 80% dela dividida pelos filhos', () => {
  // 10 Mbps medidos * 0.8 = 8 Mbps; 2 filhos -> 4 Mbps/filho -> 720p30 (2.5 Mbps cabe, 1080p30 nao)
  assert.equal(qualityForRelay('1080p60', 2, 10_000_000).preset, '720p30');
  // banda de sobra: 100 Mbps, 2 filhos -> 40 Mbps/filho -> nao passa do preset da origem
  assert.equal(qualityForRelay('1080p60', 2, 100_000_000).preset, '1080p60');
});

test('qualityForRelay: nunca sobe acima do preset da origem', () => {
  assert.equal(qualityForRelay('720p30', 1, 100_000_000).preset, '720p30');
});

test('qualityForRelay: banda invalida cai na regra deterministica', () => {
  for (const bad of [0, -1, NaN, Infinity, 'x', null, undefined]) {
    assert.equal(qualityForRelay('1080p60', 2, bad).preset, '1080p30');
  }
});

test('qualityForRelay: para no piso da cadeia mesmo com orcamento minusculo', () => {
  assert.equal(qualityForRelay('1080p60', 2, 1000).preset, '720p30');
});

// ---------- Eixos do seletor de qualidade ----------

test('os dois eixos cobrem exatamente QUALITY_PRESET_ORDER, sem celula morta nem preset orfao', () => {
  const combinacoes = [];
  for (const resolution of QUALITY_RESOLUTIONS) {
    for (const fps of QUALITY_FPS) combinacoes.push(presetFor(resolution, fps));
  }
  // Ordenado dos dois lados: o que importa aqui e o CONJUNTO ser igual --
  // a ordem de exibicao de cada eixo e testada logo abaixo.
  assert.deepEqual([...combinacoes].sort(), [...QUALITY_PRESET_ORDER].sort());
  assert.equal(new Set(combinacoes).size, QUALITY_PRESET_ORDER.length);
});

test('os eixos vao do mais barato pro mais caro, que e a ordem que o controle mostra', () => {
  assert.deepEqual(QUALITY_RESOLUTIONS, ['720p', '1080p', '1440p']);
  assert.deepEqual(QUALITY_FPS, [30, 60]);
  // Dentro de um mesmo fps, subir na lista de resolucao sempre custa mais.
  for (const fps of QUALITY_FPS) {
    for (let i = 1; i < QUALITY_RESOLUTIONS.length; i += 1) {
      const antes = QUALITY_PRESETS[presetFor(QUALITY_RESOLUTIONS[i - 1], fps)].bitrate;
      const depois = QUALITY_PRESETS[presetFor(QUALITY_RESOLUTIONS[i], fps)].bitrate;
      assert.ok(depois > antes, `${QUALITY_RESOLUTIONS[i]}@${fps} nao custa mais que ${QUALITY_RESOLUTIONS[i - 1]}@${fps}`);
    }
  }
  // E dentro de uma mesma resolucao, 60 fps sempre custa mais que 30.
  for (const resolution of QUALITY_RESOLUTIONS) {
    const trinta = QUALITY_PRESETS[presetFor(resolution, 30)].bitrate;
    const sessenta = QUALITY_PRESETS[presetFor(resolution, 60)].bitrate;
    assert.ok(sessenta > trinta, `${resolution}@60 nao custa mais que ${resolution}@30`);
  }
});

test('presetAxes e presetFor sao ida e volta pra todo preset', () => {
  for (const preset of QUALITY_PRESET_ORDER) {
    const { resolution, fps } = presetAxes(preset);
    assert.equal(presetFor(resolution, fps), preset);
    assert.ok(QUALITY_RESOLUTIONS.includes(resolution), `${resolution} fora do eixo de resolucao`);
    assert.ok(QUALITY_FPS.includes(fps), `${fps} fora do eixo de fps`);
  }
});

test('presetAxes le a altura da tabela, entao o rotulo nunca diverge do que e codificado', () => {
  assert.deepEqual(presetAxes('1440p30'), { resolution: '1440p', fps: 30 });
  assert.equal(presetAxes('1080p60').resolution, `${QUALITY_PRESETS['1080p60'].height}p`);
});

test('eixo desconhecido cai no padrao em vez de lancar', () => {
  assert.equal(presetFor('2160p', 60), '1080p60');
  assert.equal(presetFor('1080p', 144), '1080p60');
  assert.equal(presetFor(undefined, undefined), '1080p60');
  assert.deepEqual(presetAxes('inexistente'), { resolution: '1080p', fps: 60 });
  assert.deepEqual(presetAxes(undefined), { resolution: '1080p', fps: 60 });
});

// ---------- cfg.theme (spec 2026-09-03, secao 5) ----------

test('theme: default e o preset "signal", config antigo sem theme cai nele', () => {
  assert.deepEqual(DEFAULTS.theme, { preset: 'signal' });
  assert.deepEqual(load(null).theme, { preset: 'signal' });

  const antigo = JSON.stringify({ v: 1, name: 'Nicolas' }); // de antes do theme existir
  assert.deepEqual(load(antigo).theme, { preset: 'signal' });
});

test('theme: round-trip preserva um preset conhecido', () => {
  const saved = serialize({ ...DEFAULTS, theme: { preset: 'midnight' } });
  assert.deepEqual(load(saved).theme, { preset: 'midnight' });
});

test('theme: round-trip preserva um custom valido', () => {
  const custom = { preset: 'custom', base: { temp: 0.3, level: 0.8 }, act: '#4F8EF7' };
  const saved = serialize({ ...DEFAULTS, theme: custom });
  assert.deepEqual(load(saved).theme, custom);
});

test('theme: preset desconhecido cai no padrao', () => {
  const saved = serialize({ ...DEFAULTS, theme: { preset: 'roxo-brilhante' } });
  assert.deepEqual(load(saved).theme, DEFAULTS.theme);
});

test('theme: custom sem act cai no padrao', () => {
  const saved = serialize({ ...DEFAULTS, theme: { preset: 'custom', base: { temp: 0.5, level: 0.5 } } });
  assert.deepEqual(load(saved).theme, DEFAULTS.theme);
});

test('theme: custom com act em formato invalido cai no padrao', () => {
  for (const act of ['azul', '#fff', '#gggggg', 123, null]) {
    const saved = serialize({ ...DEFAULTS, theme: { preset: 'custom', base: { temp: 0.5, level: 0.5 }, act } });
    assert.deepEqual(load(saved).theme, DEFAULTS.theme, `act=${JSON.stringify(act)} deveria cair no padrao`);
  }
});

test('theme: custom com base fora de 0-1 ou faltando cai no padrao', () => {
  const base_invalidos = [
    { temp: 1.5, level: 0.5 },
    { temp: -0.1, level: 0.5 },
    { temp: 0.5, level: 'claro' },
    { temp: 0.5 },
    null,
    'string',
  ];
  for (const base of base_invalidos) {
    const saved = serialize({ ...DEFAULTS, theme: { preset: 'custom', base, act: '#4F46E5' } });
    assert.deepEqual(load(saved).theme, DEFAULTS.theme, `base=${JSON.stringify(base)} deveria cair no padrao`);
  }
});

test('theme: valor solto (nao objeto) cai no padrao', () => {
  for (const theme of [null, 'signal', 42, undefined]) {
    const saved = serialize({ ...DEFAULTS, theme });
    assert.deepEqual(load(saved).theme, DEFAULTS.theme);
  }
});

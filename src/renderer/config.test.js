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
} = require('./config');

test('load com null devolve os defaults', () => {
  const cfg = load(null);
  assert.deepEqual(cfg, DEFAULTS);
});

test('load com JSON invalido devolve os defaults', () => {
  const cfg = load('{ nao é json');
  assert.deepEqual(cfg, DEFAULTS);
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

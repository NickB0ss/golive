'use strict';

(function (root) {
  // Presets de qualidade pro select simples de Configuracoes > Transmissao.
  // Cada opcao e um pacote fechado de resolucao+fps+bitrate escolhido pra
  // ser uma combinacao razoavel -- sem controles soltos que exigem saber o
  // que e bitrate. 1080p60 = 12 Mbps e o mesmo numero que o app sempre usou
  // como padrao (ver tabela de upload no README).
  const QUALITY_PRESETS = {
    '720p30': { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
    '720p60': { width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
    '1080p30': { width: 1920, height: 1080, fps: 30, bitrate: 6_000_000 },
    '1080p60': { width: 1920, height: 1080, fps: 60, bitrate: 12_000_000 },
    '1440p30': { width: 2560, height: 1440, fps: 30, bitrate: 10_000_000 },
    '1440p60': { width: 2560, height: 1440, fps: 60, bitrate: 18_000_000 },
  };
  const DEFAULT_QUALITY_PRESET = '1080p60';
  // Ordem de exibicao no select -- QUALITY_PRESETS e um objeto, entao a
  // ordem de insercao ja bateria com isso, mas manter explicito evita
  // depender de ordem implicita de chaves.
  const QUALITY_PRESET_ORDER = ['720p30', '720p60', '1080p30', '1080p60', '1440p30', '1440p60'];

  function qualityFromPreset(preset) {
    const dims = QUALITY_PRESETS[preset] || QUALITY_PRESETS[DEFAULT_QUALITY_PRESET];
    return { ...dims, preset: QUALITY_PRESETS[preset] ? preset : DEFAULT_QUALITY_PRESET, codec: 'video/H264' };
  }

  // Config antigo (do slider de bitrate/select de resolucao/fps solto) pode
  // ter uma combinacao que nao bate exatamente com nenhum preset -- acha o
  // preset mais proximo pela resolucao+fps (bitrate salvo e descartado, o
  // preset dita o bitrate dai pra frente).
  function closestPreset(width, height, fps) {
    let best = DEFAULT_QUALITY_PRESET;
    let bestScore = Infinity;
    for (const [name, dims] of Object.entries(QUALITY_PRESETS)) {
      const score = Math.abs(dims.width - width) + Math.abs(dims.height - height) + Math.abs(dims.fps - fps) * 10;
      if (score < bestScore) {
        bestScore = score;
        best = name;
      }
    }
    return best;
  }

  const DEFAULTS = {
    v: 1,
    name: '',
    avatar: null,
    quality: qualityFromPreset(DEFAULT_QUALITY_PRESET),
    camera: {
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 2_000_000,
      deviceId: null,
    },
    network: {
      advertise: true,
      tree: false,
    },
  };

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function mergeSection(defaults, incoming) {
    if (!isObject(incoming)) return { ...defaults };
    return { ...defaults, ...incoming };
  }

  // Le a secao `quality` de um config salvo e sempre devolve um preset
  // valido -- migra config de antes do preset existir (tinha width/height/
  // fps/bitrate soltos, sem `preset`) escolhendo o preset mais proximo do
  // que estava salvo, e ignora width/height/bitrate/codec incoerentes com
  // o preset (o preset e a fonte da verdade a partir daqui).
  function loadQuality(incoming) {
    if (!isObject(incoming)) return qualityFromPreset(DEFAULT_QUALITY_PRESET);
    if (typeof incoming.preset === 'string' && QUALITY_PRESETS[incoming.preset]) {
      return qualityFromPreset(incoming.preset);
    }
    const width = Number(incoming.width) || DEFAULTS.quality.width;
    const height = Number(incoming.height) || DEFAULTS.quality.height;
    const fps = Number(incoming.fps) || DEFAULTS.quality.fps;
    return qualityFromPreset(closestPreset(width, height, fps));
  }

  function load(rawJson) {
    let parsed = {};
    if (typeof rawJson === 'string') {
      try {
        parsed = JSON.parse(rawJson);
        if (!isObject(parsed)) parsed = {};
      } catch {
        parsed = {};
      }
    }

    return {
      v: 1,
      name: typeof parsed.name === 'string' ? parsed.name : DEFAULTS.name,
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : DEFAULTS.avatar,
      quality: loadQuality(parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: mergeSection(DEFAULTS.network, parsed.network),
    };
  }

  function serialize(config) {
    return JSON.stringify({ ...config, v: 1 });
  }

  function toConstraints(section) {
    return {
      width: { ideal: section.width, max: section.width },
      height: { ideal: section.height, max: section.height },
      frameRate: { ideal: section.fps, max: section.fps },
    };
  }

  function videoConstraints(quality) {
    return toConstraints(quality);
  }

  function cameraConstraints(camera) {
    return toConstraints(camera);
  }

  const api = {
    DEFAULTS,
    QUALITY_PRESETS,
    QUALITY_PRESET_ORDER,
    DEFAULT_QUALITY_PRESET,
    qualityFromPreset,
    load,
    serialize,
    videoConstraints,
    cameraConstraints,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.config = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

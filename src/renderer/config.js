'use strict';

(function (root) {
  // UUID de instalacao. Funciona tanto no renderer (crypto global do
  // browser) quanto sob `node --test` (crypto do core). Gerado dentro de
  // load() quando ausente/invalido -- nunca um valor fixo em DEFAULTS, que
  // seria igual pra toda instalacao sem config salvo.
  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // `module.require` em vez de `require` solto: no renderer o unico nome de
    // Node visivel e `module` (rodape da IIFE), e este ramo so roda sob
    // `node --test` -- no browser/Electron o `crypto.randomUUID` acima ja
    // resolveu.
    return module.require('crypto').randomUUID();
  }

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

  // Os presets nao sao uma lista de seis: sao uma matriz 3x2 (resolucao x
  // fps), sem celula morta -- toda combinacao existe. A UI escolhe um eixo
  // por vez (ver a spec de 2026-09-03), entao os dois eixos vivem aqui, ao
  // lado da tabela que eles indexam, e nao no render.
  //
  // Explicitos de proposito, pela mesma razao do QUALITY_PRESET_ORDER: dava
  // pra derivar as duas listas das chaves de QUALITY_PRESETS, mas ai a
  // ordem dos controles passaria a depender de ordem implicita de chaves.
  // O teste do produto cartesiano em config.test.js e quem garante que as
  // duas listas e a tabela nao saem de sincronia.
  const QUALITY_RESOLUTIONS = ['720p', '1080p', '1440p'];
  const QUALITY_FPS = [30, 60];

  /** Preset da celula (resolucao, fps). Combinacao desconhecida cai no
   * padrao em vez de lancar -- esta funcao roda no clique da UI. */
  function presetFor(resolution, fps) {
    const nome = `${resolution}${fps}`;
    return QUALITY_PRESETS[nome] ? nome : DEFAULT_QUALITY_PRESET;
  }

  /** Eixos de um preset. A resolucao sai da ALTURA da propria tabela, nao
   * de um segundo mapa preset->rotulo: assim nao existe lugar onde o rotulo
   * possa divergir do que vai ser codificado de verdade. */
  function presetAxes(preset) {
    const dims = QUALITY_PRESETS[preset] || QUALITY_PRESETS[DEFAULT_QUALITY_PRESET];
    return { resolution: `${dims.height}p`, fps: dims.fps };
  }

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

  // Cadeia de degradacao: preset -> proximo preset mais barato, `null` no
  // piso. Derruba FPS antes de resolucao, porque a resolucao e o que a
  // pessoa escolheu ver -- 1080p30 ainda parece "a tela dela"; 720p60 nao.
  //
  // ARMADILHA: ordenar por bitrate NAO serve como cadeia. 1440p30 (10 Mbps)
  // e mais barato que 1080p60 (12 Mbps), entao "descer um degrau de
  // bitrate" a partir de 1080p60 AUMENTARIA a resolucao. Por isso a cadeia
  // e escrita a mao, e nao derivada da tabela acima.
  const QUALITY_DEGRADE_CHAIN = {
    '1440p60': '1440p30',
    '1440p30': '1080p30',
    '1080p60': '1080p30',
    '1080p30': '720p30',
    '720p60': '720p30',
    '720p30': null,
  };

  // Anda `steps` passos na cadeia e para no piso. Preset desconhecido ou
  // `steps <= 0` devolve a entrada -- esta funcao roda no caminho de
  // transmitir, entao ela nunca lanca.
  function degradePreset(preset, steps) {
    if (!QUALITY_PRESETS[preset]) return preset;
    let current = preset;
    for (let i = 0; i < steps; i += 1) {
      const next = QUALITY_DEGRADE_CHAIN[current];
      if (!next) break;
      current = next;
    }
    return current;
  }

  // Quantos degraus a sala custa. A medicao do proprio projeto (ver
  // docs/2026-08-27-auditoria-de-fragilidade.md, H4) mostrou 4 espectadores
  // a 1080p60 quebrando o NVENC SEM jogo aberto -- entao a partir de 3 a
  // sala ja nao cabe no preset de topo. Um degrau so, de proposito: e o que
  // a auditoria pede, e cada degrau a mais e uma piora que o usuario ve sem
  // ter pedido nada.
  function audienceSteps(viewers) {
    return Number(viewers) >= 3 ? 1 : 0;
  }

  // Qualidade efetiva pra uma sala daquele tamanho. Devolve o mesmo formato
  // de qualityFromPreset, com `preset` sendo o preset EFETIVO (o degradado),
  // nao o que o usuario escolheu -- quem le esse campo quer saber o que esta
  // sendo codificado de verdade.
  function qualityForAudience(preset, viewers) {
    // Normaliza antes de degradar pra que um preset invalido caia no padrao
    // e degrade a partir DELE, em vez de escapar da degradacao.
    const base = qualityFromPreset(preset).preset;
    return qualityFromPreset(degradePreset(base, audienceSteps(viewers)));
  }

  // Folga sobre a banda medida. Mirar 100% do que o congestion control diz
  // que cabe e pedir pra saturar: sobra zero pro audio, pro RTCP, pro
  // trafego do resto da maquina e pra qualquer variacao do link -- e link
  // saturado vira fila, que vira atraso, que faz o proprio GCC desabar.
  const RELAY_BANDWIDTH_HEADROOM = 0.8;

  /** Qualidade que um RELAY deve usar pra re-codificar pra CADA filho.
   *
   * Duas regras, nesta ordem:
   *  - com banda medida (availableBps, do availableOutgoingBitrate), o
   *    orcamento por filho e a banda com folga dividida pelo numero de
   *    filhos;
   *  - sem medida (primeiro repasse, antes de existir amostra), o orcamento
   *    e o bitrate do proprio preset dividido pelos filhos: "ninguem na
   *    arvore sobe, no total, mais do que a origem sobe".
   *
   * Nunca devolve preset ACIMA do que a origem mandou, e para no piso da
   * cadeia mesmo quando nem o piso cabe (abaixo dele quem trata e o
   * congestion control). */
  function qualityForRelay(preset, childCount, availableBps) {
    const base = qualityFromPreset(preset);
    const filhos = Number(childCount) || 0;
    if (filhos <= 0) return base;

    const medida = typeof availableBps === 'number' && Number.isFinite(availableBps) && availableBps > 0
      ? availableBps * RELAY_BANDWIDTH_HEADROOM
      : null;
    const orcamento = (medida ?? base.bitrate) / filhos;

    let atual = base.preset;
    while (qualityFromPreset(atual).bitrate > orcamento) {
      const proximo = degradePreset(atual, 1);
      if (proximo === atual) break; // piso da cadeia
      atual = proximo;
    }
    return qualityFromPreset(atual);
  }

  const DEFAULTS = {
    v: 1,
    name: '',
    avatar: null,
    soundsEnabled: true,
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
      // Retransmissao em cadeia (F2): sem opcao de desligar na UI -- a
      // medida no PC real (ver spec de 2026-08-23) mostrou que a malha
      // direta derruba o encoder pra software com poucos espectadores, e
      // isso nao e algo que uma pessoa comum deveria precisar entender ou
      // escolher. Forcado em `load()` abaixo, independente do que estiver
      // salvo (config antigo pode ter `tree: false` de quando isto ainda
      // era experimental).
      tree: true,
    },
    // Preset de tema (spec de 2026-09-03, secao 5). So a FORMA e validada
    // aqui -- chaves e tipos -- nunca os valores de cor (isso e trabalho de
    // theme.js, que este arquivo deliberadamente nao importa, pra manter os
    // dois modulos desacoplados; quem cruza os dois e o app.js).
    theme: { preset: 'signal' },
    // Anotacao na tela (spec de 2026-09-04, secao 5.1). NAO e uma
    // configuracao global: e a ULTIMA ESCOLHA feita no dialogo de
    // compartilhar, lembrada pra proxima vez -- exatamente como
    // `network.advertise` guarda a ultima escolha do dialogo de criar sala.
    // Desmarcada por padrao: deixar a sala escrever na sua tela e opt-in.
    annotations: { allow: false },
    // Emoji usados por ultimo, do mais recente pro mais antigo. Validado
    // aqui so como "lista de strings" -- quais emoji existem e assunto do
    // emoji.js, que este arquivo tambem nao importa.
    emojiRecents: [],
  };

  // As seis predefinicoes conhecidas pelo config -- so os NOMES, pra validar
  // a forma de `theme.preset` sem depender de theme.js (ver o comentario
  // acima de DEFAULTS.theme). Se um preset novo entrar em theme.js, ele
  // precisa entrar aqui tambem, senao um config salvo com ele cai no padrao.
  const THEME_PRESETS = ['signal', 'midnight', 'carvao', 'amber', 'forest', 'paper'];

  function isValidThemeBase(base) {
    return isObject(base)
      && typeof base.temp === 'number' && Number.isFinite(base.temp) && base.temp >= 0 && base.temp <= 1
      && typeof base.level === 'number' && Number.isFinite(base.level) && base.level >= 0 && base.level <= 1;
  }

  // `#rrggbb` de 6 digitos -- o mesmo formato que theme.js espera; nao
  // aceita atalho de 3 digitos nem nome de cor, pra o valor salvo bater
  // direto com o que deriveAction() consome sem conversao extra.
  function isValidHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  // Le a secao `theme` de um config salvo. Tres formas validas:
  //
  //   { preset: <conhecido> }                      -- predefinicao pura
  //   { preset: <conhecido>, act: '#rrggbb' }      -- predefinicao com acento
  //                                                   proprio (o que a
  //                                                   interface produz hoje)
  //   { preset:'custom', base:{temp,level}, act }  -- legado: config salvo
  //                                                   quando ainda dava pra
  //                                                   mexer nas superficies
  //
  // Qualquer outra coisa (ausente, chave errada, numero fora de 0-1, hex mal
  // formado, preset desconhecido) cai no padrao -- config antigo sem `theme`
  // abre no tema de hoje, sem excecao. Um `act` torto derruba SO o acento: a
  // predefinicao escolhida sobrevive, que e o dano menor.
  function loadTheme(incoming) {
    if (!isObject(incoming)) return DEFAULTS.theme;
    if (incoming.preset === 'custom') {
      if (isValidThemeBase(incoming.base) && isValidHexColor(incoming.act)) {
        return { preset: 'custom', base: { temp: incoming.base.temp, level: incoming.base.level }, act: incoming.act };
      }
      return DEFAULTS.theme;
    }
    if (typeof incoming.preset === 'string' && THEME_PRESETS.includes(incoming.preset)) {
      if (isValidHexColor(incoming.act)) return { preset: incoming.preset, act: incoming.act };
      return { preset: incoming.preset };
    }
    return DEFAULTS.theme;
  }

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** Lista de strings curtas vinda de um config salvo, sem repetido e com
   * teto. Usada pelos emoji recentes -- o que NAO e string (numero, objeto,
   * null de uma versao futura) some em silencio, igual ao resto do load. */
  function loadStringList(incoming, max) {
    if (!Array.isArray(incoming)) return [];
    const out = [];
    for (const v of incoming) {
      if (typeof v !== 'string' || !v || out.includes(v)) continue;
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
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
      clientId: typeof parsed.clientId === 'string' && parsed.clientId ? parsed.clientId : randomId(),
      soundsEnabled: typeof parsed.soundsEnabled === 'boolean' ? parsed.soundsEnabled : DEFAULTS.soundsEnabled,
      quality: loadQuality(parsed.quality),
      camera: mergeSection(DEFAULTS.camera, parsed.camera),
      network: { ...mergeSection(DEFAULTS.network, parsed.network), tree: true },
      theme: loadTheme(parsed.theme),
      annotations: { allow: parsed.annotations?.allow === true },
      emojiRecents: loadStringList(parsed.emojiRecents, 24),
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

  // Degraus "redondos" pro scaleResolutionDownBy. O Chromium aceita
  // fracionario, mas valores redondos evitam artefato de reamostragem. O
  // encode escala DEPOIS da captura, entao a captura continua paga inteira
  // -- quem controla a captura e o piso global (via applyConstraints).
  const SCALE_STEPS = [1, 1.5, 2, 3, 4];

  function scaleFactorFor(captureWidth, targetWidth) {
    const cap = Number(captureWidth);
    const tgt = Number(targetWidth);
    if (!(cap > 0) || !(tgt > 0) || tgt >= cap) return 1;
    const raw = cap / tgt;
    let chosen = SCALE_STEPS[0];
    let best = Infinity;
    for (const s of SCALE_STEPS) {
      const d = Math.abs(s - raw);
      if (d < best) { best = d; chosen = s; }
    }
    return chosen;
  }

  const api = {
    DEFAULTS,
    QUALITY_PRESETS,
    QUALITY_PRESET_ORDER,
    QUALITY_RESOLUTIONS,
    QUALITY_FPS,
    presetFor,
    presetAxes,
    DEFAULT_QUALITY_PRESET,
    qualityFromPreset,
    degradePreset,
    audienceSteps,
    qualityForAudience,
    qualityForRelay,
    load,
    serialize,
    videoConstraints,
    cameraConstraints,
    scaleFactorFor,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.config = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

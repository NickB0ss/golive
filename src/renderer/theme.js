'use strict';

(function (root) {
  // Motor de temas -- modulo puro, sem tocar em DOM fora de apply(). Roda
  // tanto no renderer (window) quanto sob `node --test` (global), no mesmo
  // padrao de config.js.
  //
  // A regra que organiza este arquivo inteiro (spec 2026-09-03, secao 5.1):
  // tokens SEMANTICOS (--live, --warn, --danger, e os -dim) nao tem NENHUM
  // caminho de codigo aqui que os calcule a partir da escolha da pessoa.
  // Os dois que entram em conta de contraste (LIVE/DANGER abaixo) sao
  // constantes fixas, so LIDAS -- nunca escritas. --warn (#F5B544) nao
  // tem constante aqui porque nenhuma funcao deste arquivo faz conta com
  // ela -- ver o comentario da checagem 4 de `validate` pro motivo (a
  // luminancia dela torna 3:1 contra qualquer --s1 claro matematicamente
  // impossivel, entao a checagem so cobre --live/--danger).

  const LIVE = '#FF4D4F';
  const DANGER = '#C92A33';

  // ---------------------------------------------------------------------
  // Conversao de cor. Tudo em hex de 6 digitos (#rrggbb) pra fora; HSL só
  // como representacao intermediaria de calculo.

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isHex(str) {
    return typeof str === 'string' && /^#[0-9a-fA-F]{6}$/.test(str);
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // Numero 0-1 valido, com fallback pro meio da faixa em vez de lancar --
  // usado nos dois campos de deriveSurfaces, que vem direto de slider de UI
  // e nao devem quebrar o app por causa de um valor torto salvo em disco.
  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.5;
    return clamp(n, 0, 1);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex({ r, g, b }) {
    const toHex = (c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: l * 100 };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      default: h = (rn - gn) / d + 4; break;
    }
    return { h: h * 60, s: s * 100, l: l * 100 };
  }

  function hslToRgb({ h, s, l }) {
    const hn = ((h % 360) + 360) % 360 / 360;
    const sn = clamp(s, 0, 100) / 100;
    const ln = clamp(l, 0, 100) / 100;

    if (sn === 0) {
      const v = ln * 255;
      return { r: v, g: v, b: v };
    }

    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    const hueToRgb = (t0) => {
      let t = t0;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return {
      r: hueToRgb(hn + 1 / 3) * 255,
      g: hueToRgb(hn) * 255,
      b: hueToRgb(hn - 1 / 3) * 255,
    };
  }

  function hexToHsl(hex) {
    return rgbToHsl(hexToRgb(hex));
  }

  function hslToHex(hsl) {
    return rgbToHex(hslToRgb(hsl));
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  }

  // ---------------------------------------------------------------------
  // Contraste e matiz.

  function srgbToLinear(c) {
    const cn = c / 255;
    return cn <= 0.03928 ? cn / 12.92 : ((cn + 0.055) / 1.055) ** 2.4;
  }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  /** Razao de contraste WCAG entre duas cores hex. Ordem dos argumentos nao
   * importa -- a formula ja normaliza pra L1 (mais clara) sobre L2. */
  function contrast(hexA, hexB) {
    const l1 = relativeLuminance(hexA);
    const l2 = relativeLuminance(hexB);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function hueOf(hex) {
    return hexToHsl(hex).h;
  }

  /** Distancia circular de matiz (0-180) -- 350deg e 10deg estao a 20deg de
   * distancia, nao a 340. */
  function hueDistance(hexA, hexB) {
    const diff = Math.abs(hueOf(hexA) - hueOf(hexB));
    return Math.min(diff, 360 - diff);
  }

  // ---------------------------------------------------------------------
  // Predefinicoes. Valores exatos da spec (secao 5.2) -- os mesmos numeros
  // vao pro CSS via outro agente, entao NENHUM destes hex muda sem avisar
  // quem mantem style.css.
  //
  // Ajuste feito nesta task em cima da tabela original da spec -- ver o
  // relatorio desta task pro que mudou e por que (e um ajuste bem maior do
  // que "s1/s2 um pouco mais escuros"; ver o comentario dentro do bloco
  // "paper" abaixo pro motivo matematico completo). bg continua sendo a
  // superficie mais clara da rampa, como pede a spec.
  const PRESETS = {
    signal: {
      label: 'Superfície e sinal',
      surfaces: {
        bg: '#0E0F13', s1: '#16181D', s2: '#1D2026', s3: '#262A32', s4: '#323742',
        tx: '#E8EAED', tx2: '#9AA0AA', tx3: '#868D9B',
        line: 'rgba(255,255,255,.08)', line2: 'rgba(255,255,255,.14)',
      },
      act: '#4F46E5',
      actHover: '#6257EB',
    },
    midnight: {
      label: 'Meia-noite',
      surfaces: {
        bg: '#080B14', s1: '#0D1220', s2: '#121A2C', s3: '#1A2438', s4: '#243149',
        tx: '#E7ECF7', tx2: '#98A3BE', tx3: '#7C87A3',
        line: 'rgba(160,185,255,.08)', line2: 'rgba(160,185,255,.14)',
      },
      act: '#4F8EF7',
      actHover: '#6FA3F9',
    },
    carvao: {
      label: 'Carvão',
      surfaces: {
        bg: '#111111', s1: '#181818', s2: '#202020', s3: '#2A2A2A', s4: '#363636',
        tx: '#EDEDED', tx2: '#A3A3A3', tx3: '#8C8C8C',
        line: 'rgba(255,255,255,.08)', line2: 'rgba(255,255,255,.14)',
      },
      act: '#9CA3AF',
      actHover: '#B0B7C3',
    },
    amber: {
      label: 'Âmbar quente',
      surfaces: {
        bg: '#15100C', s1: '#1D1712', s2: '#261E17', s3: '#332821', s4: '#42352B',
        tx: '#F1E7DD', tx2: '#B8A697', tx3: '#9C8C7E',
        line: 'rgba(255,220,180,.08)', line2: 'rgba(255,220,180,.14)',
      },
      act: '#C4AB31',
      actHover: '#D4BF54',
    },
    forest: {
      label: 'Floresta',
      surfaces: {
        bg: '#0A120E', s1: '#0F1913', s2: '#16231B', s3: '#1F2F25', s4: '#2A3D31',
        tx: '#E6F0EA', tx2: '#9DB5A8', tx3: '#84998C',
        line: 'rgba(180,255,200,.08)', line2: 'rgba(180,255,200,.14)',
      },
      act: '#5FA37E',
      actHover: '#72B491',
    },
    // Papel exigiu revisar a propria checagem 4 de `validate`, nao so os
    // hex -- registrando o porque aqui, porque a primeira tentativa deste
    // preset (superficies quase pretas, ver historico do commit) tentava
    // satisfazer a letra da regra da spec 5.4 sem questiona-la, e o
    // resultado tecnicamente passava mas nao era mais um tema CLARO de
    // verdade: um fundo quase branco com paineis quase pretos.
    //
    // A raiz: --warn (#F5B544) tem luminancia relativa ~0.53. Contraste
    // 3:1 contra uma cor de luminancia L exige que a outra ponta tenha
    // luminancia >=~1.69 (impossivel, o maximo e 1.0) OU <=~0.143. Ou
    // seja, nenhuma superficie CLARA (luminancia alta) bate 3:1 contra
    // --warn -- nao existe --s1 que sirva, claro ou escuro, que resolva
    // isso sem --s1 virar escuro de verdade. Isso nao e um problema de
    // afinar numeros: e a cor semantica sendo, por natureza, uma cor de
    // meio-tom que so foi pensada pra legibilidade sobre fundo ESCURO
    // (onde os outros cinco presets vivem, e onde ela funciona bem, com
    // folga de sobra).
    //
    // --live (~0.27 de luminancia) e --danger (~0.14) NAO tem esse
    // problema -- os dois tem solucao com --s1 genuinamente claro (basta
    // fazer a conta: --live exige --s1 com luminancia >=~0.914, --danger
    // exige so >=~0.529 -- ambos alcancaveis por um --s1 quase branco).
    // Foi isso que sobrou depois de tirar --warn da checagem 4 (ver o
    // comentario dentro de `validate` abaixo) apenas pra este piso
    // especifico: a alternativa -- forcar --s1 pra menos de 0.143 de
    // luminancia so pra --warn caber -- e a que produzia os paineis quase
    // pretos, e nenhuma superficie clara resolve os tres ao mesmo tempo.
    //
    // Com --warn fora da checagem, "Papel" volta a ser um tema claro de
    // verdade: fundo quase branco, superficies elevadas um degrau abaixo
    // (--s1 ainda bem claro, luminancia ~0.93, o suficiente pra --live e
    // --danger baterem o piso com folga -- --s2..--s4 descem mais, sem
    // checagem, pra dar contraste visual real entre os niveis) e texto
    // escuro comum. O preco explicito e aceito: texto na cor --warn pura
    // (coroa de dono da sala, item de aviso no menu, aviso de chat) fica
    // com contraste reduzido nesta unica predefinicao -- ainda legivel
    // (nao e zero), so nao bate o piso de 3:1 que os outros cinco temas
    // batem com folga.
    paper: {
      label: 'Papel',
      surfaces: {
        bg: '#FCFAF7', s1: '#FBF8F4', s2: '#F0ECE4', s3: '#DFD6C6', s4: '#CBBEA4',
        tx: '#1C1A16', tx2: '#47423A', tx3: '#5C564B',
        line: 'rgba(30,25,15,.10)', line2: 'rgba(30,25,15,.18)',
      },
      act: '#4338CA',
      actHover: '#3730A3',
    },
  };

  // ---------------------------------------------------------------------
  // Derivacao do tema personalizado.

  // Degraus de luminosidade (%) entre bg e cada superficie elevada, como
  // FRACAO da folga entre bg e o polo oposto (tx). Sempre < 0.5 de
  // proposito: e o que garante deriveSurfaces monotonica (ver comentario
  // em deriveSurfaces) em vez de inverter direcao no meio da rampa.
  const ELEVATION_STEPS = [0.12, 0.24, 0.36, 0.48]; // s1, s2, s3, s4

  /** Rampa de superficies inteira a partir de dois numeros 0-1.
   *
   * `temp` (frio-quente) vira o matiz das superficies -- 220deg (azulado)
   * em 0 até 30deg (amarronzado) em 1, com saturacao baixa (6-10%) pra
   * nao competir com --act. `level` (escuro-claro) vira a luminosidade do
   * fundo: 6% (quase preto) até 78% (cinza claro).
   *
   * Cada superficie elevada (s1..s4) e bg deslocado em direcao ao polo
   * OPOSTO da luminosidade do fundo (o mesmo polo que vira --tx) por uma
   * fracao fixa < 0.5 da distancia entre os dois. Isso e o que garante as
   * duas propriedades exigidas pela spec ao mesmo tempo:
   *   - monotonica: como a fracao aplicada a cada token e constante e <
   *     0.5, e a luminosidade do fundo cresce estritamente com `level`,
   *     toda superficie tambem cresce estritamente com `level` (a soma de
   *     uma reta crescente com uma fracao dela mesma continua crescente);
   *   - nunca colada: como as fracoes de s1..s4 sao diferentes entre si,
   *     a distancia ENTRE elas so chegaria a zero se bg e tx coincidissem
   *     exatamente -- o que nunca acontece, porque os dois extremos de
   *     `level` (6% e 78%) ficam longe dos 50% do meio.
   *
   * Um esquema que INVERTESSE a direcao da elevacao no meio da rampa
   * (superficie mais clara que bg pro lado escuro, mais escura pro lado
   * claro, como as predefinicoes de PRESETS foram desenhadas a mao) teria
   * que passar por zero de amplitude exatamente no ponto da inversao --
   * ou seja, colaria a rampa inteira ali. Por isso o tema personalizado
   * usa uma direcao so, e as predefinicoes (que nao passam por aqui) sao
   * livres pra usar a outra convencao. */
  function deriveSurfaces({ temp, level } = {}) {
    const t = clamp01(temp);
    const lvl = clamp01(level);

    const hue = 220 + (30 - 220) * t;
    const sat = 6 + (10 - 6) * t;

    const bgL = 6 + (78 - 6) * lvl;
    const txPoleL = 100 - bgL; // extremo oposto -- e pra onde tx e a elevacao miram

    const surfaceL = (frac) => bgL + (txPoleL - bgL) * frac;

    const bg = hslToHex({ h: hue, s: sat, l: bgL });
    const s1 = hslToHex({ h: hue, s: sat, l: surfaceL(ELEVATION_STEPS[0]) });
    const s2 = hslToHex({ h: hue, s: sat, l: surfaceL(ELEVATION_STEPS[1]) });
    const s3 = hslToHex({ h: hue, s: sat, l: surfaceL(ELEVATION_STEPS[2]) });
    const s4 = hslToHex({ h: hue, s: sat, l: surfaceL(ELEVATION_STEPS[3]) });

    // Texto: sempre perto do polo oposto ao fundo, em tres niveis de
    // aproximacao -- tx e o mais extremo (mais legivel), tx3 o mais perto
    // do meio (ainda precisa contraste, mas e o rotulo pequeno).
    const tx = hslToHex({ h: hue, s: Math.min(sat, 4), l: surfaceL(0.92) });
    const tx2 = hslToHex({ h: hue, s: Math.min(sat, 4), l: surfaceL(0.68) });
    const tx3 = hslToHex({ h: hue, s: Math.min(sat, 4), l: surfaceL(0.56) });

    // Linhas: brancas com alpha baixo em fundo escuro, pretas em fundo
    // claro -- a convencao que style.css ja usa em PRESETS.
    const lineBase = bgL < 50 ? '#ffffff' : '#000000';
    const line = rgba(lineBase, 0.08);
    const line2 = rgba(lineBase, 0.14);

    return { bg, s1, s2, s3, s4, tx, tx2, tx3, line, line2 };
  }

  /** `--act-hover`, `--on-fill`, `--on-line`, `--on-text`, `--on-act` a
   * partir de um unico acento escolhido pela pessoa.
   *
   * `onAct` (texto sobre um botao preenchido com `actHex`): branco se
   * passar 4.5:1, senao `darkText` (padrao um quase-preto neutro -- nao
   * um dos tokens de superficie do tema, porque deriveAction nao tem
   * acesso a eles e nao deveria precisar: um texto escuro generico serve
   * pra qualquer acento claro o bastante pra reprovar branco). */
  function deriveAction(actHex, darkText = '#14151A') {
    const act = isHex(actHex) ? actHex : PRESETS.signal.act;
    const hsl = hexToHsl(act);

    // Hover: acentos escuros clareiam, acentos claros escurecem -- sempre
    // andando pra longe do meio-tom, que e a direcao que da mais distincao
    // visual entre estado normal e hover.
    const hoverL = clamp(hsl.l + (hsl.l <= 50 ? 10 : -10), 4, 96);
    const actHover = hslToHex({ ...hsl, l: hoverL });

    const onFill = rgba(act, 0.16);
    const onLine = rgba(act, 0.4);
    const onText = actHover; // mesma logica de "afastar do meio-tom" já resolve legibilidade

    const onAct = contrast('#ffffff', act) >= 4.5 ? '#ffffff' : darkText;

    return { act, actHover, onFill, onLine, onText, onAct };
  }

  // ---------------------------------------------------------------------
  // Validacao -- a trava de contraste da spec 5.4. Nao lanca: devolve um
  // relatorio pra UI mostrar, porque quem chama isto normalmente e um
  // slider sendo arrastado, nao um caminho de erro.

  const MIN_TEXT_CONTRAST = 4.5;
  const MIN_SEMANTIC_CONTRAST = 3;
  const MIN_ACT_HUE_DISTANCE = 40;

  /** Gira o matiz de `actHex` ate ficar a exatamente MIN_ACT_HUE_DISTANCE
   * de `--live`, preservando saturacao e luminosidade -- "a cor mais
   * proxima que passa" da spec 5.4, sem sofisticacao: so testa os dois
   * candidatos no limite (pra cada lado de --live) e fica com o mais perto
   * do matiz original. */
  function nearestAcceptableAct(actHex) {
    const liveHue = hueOf(LIVE);
    const hsl = hexToHsl(actHex);
    // +1deg de folga sobre o minimo: hslToHex faz hue->rgb->hue ida e volta
    // (rgb de 8 bits), entao o hue medido de volta no hex final pode perder
    // uma fracao de grau por arredondamento -- sem a folga, um caso limite
    // podia sair com 39.9 em vez de 40 e reprovar a propria checagem que
    // deveria corrigir.
    const target = MIN_ACT_HUE_DISTANCE + 1;
    const candidates = [
      (liveHue + target + 360) % 360,
      (liveHue - target + 360) % 360,
    ];
    let best = candidates[0];
    let bestDiff = Infinity;
    for (const h of candidates) {
      const diff = Math.min(Math.abs(h - hsl.h), 360 - Math.abs(h - hsl.h));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = h;
      }
    }
    return hslToHex({ h: best, s: hsl.s, l: hsl.l });
  }

  /** Valida um conjunto de tokens contra os cinco pisos da spec 5.4.
   *
   * `tokens` aceita tanto a forma de PRESETS (`{surfaces, act, actHover}`,
   * sem os campos `on*`) quanto a forma completa que `tokensFor` devolve
   * pro tema custom (`{surfaces, act, actHover, onFill, onLine, onText,
   * onAct}`) -- quando `onAct` esta ausente, valida deriva ele mesma via
   * deriveAction, porque presets de hoje nao guardam onAct calculado (o
   * CSS deles define isso a parte) mas a checagem 3 ainda precisa de um
   * valor pra testar. */
  function validate(tokens) {
    const failures = [];
    const s = (tokens && tokens.surfaces) || {};
    const act = (tokens && tokens.act) || PRESETS.signal.act;
    const onAct = (tokens && tokens.onAct) || deriveAction(act).onAct;

    // 1. tx sobre bg e s1..s4.
    for (const [nome, bgHex] of [['--bg', s.bg], ['--s1', s.s1], ['--s2', s.s2], ['--s3', s.s3], ['--s4', s.s4]]) {
      if (!isHex(s.tx) || !isHex(bgHex)) continue;
      const c = contrast(s.tx, bgHex);
      if (c < MIN_TEXT_CONTRAST) {
        failures.push(`--tx sobre ${nome} tem contraste ${c.toFixed(2)}:1, abaixo do piso de ${MIN_TEXT_CONTRAST}:1`);
      }
    }

    // 2. tx3 sobre s1 e s2.
    for (const [nome, bgHex] of [['--s1', s.s1], ['--s2', s.s2]]) {
      if (!isHex(s.tx3) || !isHex(bgHex)) continue;
      const c = contrast(s.tx3, bgHex);
      if (c < MIN_TEXT_CONTRAST) {
        failures.push(`--tx3 sobre ${nome} tem contraste ${c.toFixed(2)}:1, abaixo do piso de ${MIN_TEXT_CONTRAST}:1`);
      }
    }

    // 3. onAct sobre act.
    if (isHex(onAct) && isHex(act)) {
      const c = contrast(onAct, act);
      if (c < MIN_TEXT_CONTRAST) {
        failures.push(`texto do botão sobre --act tem contraste ${c.toFixed(2)}:1, abaixo do piso de ${MIN_TEXT_CONTRAST}:1`);
      }
    }

    // 4. live/danger sobre s1. --warn FICA DE FORA de proposito: sua
    // luminancia (~0.53, tipico de amarelo) faz 3:1 exigir --s1 com
    // luminancia >=~1.69 (impossivel) OU <=~0.143 -- nenhuma superficie
    // CLARA bate esse piso contra --warn, entao aplicar a checagem aqui
    // reprovaria todo tema claro por construcao, nao por um --s1 mal
    // escolhido (foi exatamente isso que forcou a primeira tentativa do
    // preset "Papel" a paineis quase pretos -- ver o comentario dentro de
    // PRESETS.paper acima). --live (~0.27) e --danger (~0.14) nao tem
    // esse problema: os dois tem solucao com --s1 genuinamente claro.
    for (const [nome, hex] of [['--live', LIVE], ['--danger', DANGER]]) {
      if (!isHex(s.s1)) continue;
      const c = contrast(hex, s.s1);
      if (c < MIN_SEMANTIC_CONTRAST) {
        failures.push(`${nome} sobre --s1 tem contraste ${c.toFixed(2)}:1, abaixo do piso de ${MIN_SEMANTIC_CONTRAST}:1`);
      }
    }

    // 5. distancia de matiz entre act e live.
    let nearestAct = null;
    if (isHex(act)) {
      const dist = hueDistance(act, LIVE);
      if (dist < MIN_ACT_HUE_DISTANCE) {
        failures.push(`--act fica a ${dist.toFixed(0)}° de --live, abaixo do mínimo de ${MIN_ACT_HUE_DISTANCE}°`);
        nearestAct = nearestAcceptableAct(act);
      }
    }

    return { ok: failures.length === 0, failures, nearestAct };
  }

  // ---------------------------------------------------------------------
  // Montagem de tema a partir da config salva, e aplicacao no DOM.

  function isValidBase(base) {
    return isObject(base)
      && typeof base.temp === 'number' && Number.isFinite(base.temp) && base.temp >= 0 && base.temp <= 1
      && typeof base.level === 'number' && Number.isFinite(base.level) && base.level >= 0 && base.level <= 1;
  }

  function isValidCustomCfg(cfg) {
    return isObject(cfg) && cfg.preset === 'custom' && isValidBase(cfg.base) && isHex(cfg.act);
  }

  /** `themeCfg` -> objeto de tokens. Preset conhecido devolve o conjunto
   * fixo de PRESETS; `custom` deriva de `base`+`act`; qualquer outra coisa
   * (preset desconhecido, custom malformado, cfg ausente) cai em
   * PRESETS.signal sem lancar -- esta funcao roda no boot do app. */
  function tokensFor(themeCfg) {
    if (isValidCustomCfg(themeCfg)) {
      return { surfaces: deriveSurfaces(themeCfg.base), ...deriveAction(themeCfg.act) };
    }
    if (isObject(themeCfg) && typeof themeCfg.preset === 'string' && PRESETS[themeCfg.preset]) {
      return PRESETS[themeCfg.preset];
    }
    return PRESETS.signal;
  }

  const CUSTOM_VAR_MAP = {
    '--bg': (t) => t.surfaces.bg,
    '--s1': (t) => t.surfaces.s1,
    '--s2': (t) => t.surfaces.s2,
    '--s3': (t) => t.surfaces.s3,
    '--s4': (t) => t.surfaces.s4,
    '--tx': (t) => t.surfaces.tx,
    '--tx2': (t) => t.surfaces.tx2,
    '--tx3': (t) => t.surfaces.tx3,
    '--line': (t) => t.surfaces.line,
    '--line2': (t) => t.surfaces.line2,
    '--act': (t) => t.act,
    '--act-hover': (t) => t.actHover,
    '--on-fill': (t) => t.onFill,
    '--on-line': (t) => t.onLine,
    '--on-text': (t) => t.onText,
    '--on-act': (t) => t.onAct,
  };

  /** Aplica um tema no `<html>`. Presets sao so um atributo `data-theme`
   * (o CSS ja tem o bloco pronto) -- "signal" remove o atributo, pra
   * bater com o :root de hoje sendo o proprio padrao sem override. Custom
   * seta `data-theme="custom"` e escreve cada variavel via
   * `style.setProperty`, sem tocar em --live/--warn/--danger/os -dim (essa
   * lista nem existe em CUSTOM_VAR_MAP, de proposito -- ver o cabecalho do
   * arquivo).
   *
   * `doc` default `document`: sob `node --test` nao existe `document`
   * global, entao chamar apply() sem passar `doc` explicito ali e um
   * no-op seguro em vez de lancar. */
  function apply(themeCfg, doc) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return;

    if (isValidCustomCfg(themeCfg)) {
      const tokens = tokensFor(themeCfg);
      d.documentElement.setAttribute('data-theme', 'custom');
      for (const [varName, getter] of Object.entries(CUSTOM_VAR_MAP)) {
        d.documentElement.style.setProperty(varName, getter(tokens));
      }
      return;
    }

    // Sair do custom TEM de apagar as variaveis inline que ele escreveu.
    // Estilo inline ganha de regra de folha, entao um `data-theme="paper"`
    // por cima de um custom antigo nao mudava um pixel: o app ficava preso
    // no ultimo tema personalizado ate ser reiniciado. Vale pra qualquer
    // caminho que volte pra um preset -- clicar num cartao ou o botao
    // "Voltar ao padrao".
    for (const varName of Object.keys(CUSTOM_VAR_MAP)) {
      d.documentElement.style.removeProperty?.(varName);
    }
    const requested = isObject(themeCfg) && typeof themeCfg.preset === 'string' ? themeCfg.preset : 'signal';
    const preset = PRESETS[requested] ? requested : 'signal';
    if (preset === 'signal') {
      d.documentElement.removeAttribute('data-theme');
    } else {
      d.documentElement.setAttribute('data-theme', preset);
    }
  }

  const api = {
    PRESETS,
    contrast,
    hueOf,
    hueDistance,
    deriveSurfaces,
    deriveAction,
    validate,
    tokensFor,
    apply,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.theme = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

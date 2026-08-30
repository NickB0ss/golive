'use strict';

(function (root) {
  // Nomes que o Chromium usa quando quem codifica e a CPU. Qualquer outro
  // valor ('ExternalEncoder', 'NvCodec...', 'MediaFoundationVideo...') e
  // hardware. A comparacao e por substring porque com simulcast o nome vem
  // embrulhado: 'SimulcastEncoderAdapter (libvpx, libvpx)'.
  const SOFTWARE_ENCODERS = ['openh264', 'libvpx', 'libaom', 'ffmpeg', 'x264'];

  function isSoftwareEncoder(impl) {
    if (!impl) return false;
    const name = String(impl).toLowerCase();
    return SOFTWARE_ENCODERS.some((needle) => name.includes(needle));
  }

  // baseKind de uma chave de sender ('screen', 'camera', ou o composto de
  // repasse 'screen@<origem>'). Mesmo criterio de parseKind em mesh.js.
  function baseKindOf(kind) {
    return String(kind ?? '').split('@')[0];
  }

  // Deriva o resumo de saude de encode da TELA das linhas que updateStats
  // ja montou. So linhas de tela (diretas ou de repasse 'screen@origem') --
  // a camera e SEMPRE VP8/libvpx (qualityFor a forca em app.js), entao
  // incluir a camera fixaria softwareEncoder em true pra sempre e
  // contaminaria os dois consumidores deste resumo: a escada global
  // (autoquality, que so regula a tela) e a eleicao de relay (tree.js veta
  // encoder de software). Um relay re-codifica a TELA que repassamos; a
  // camera dele nao diz nada sobre isso.
  //
  // `cpuLimited` = o proprio Chromium marcou qualityLimitationReason='cpu'
  // em algum sender: e o sinal AUTORITATIVO de "o encode nao acompanha".
  // `msPerFrame` e o MAX entre os senders, NAO a soma: com N espectadores
  // em encoder de software cada encode roda no proprio thread (paralelo),
  // entao somar dava ~Nx o custo real e derrubava a qualidade de uma
  // maquina que estava dando conta -- ver o log de 2026-08-29 (4 senders a
  // ~9 ms, fps de saida colado em 30, e a soma prendia a sala em 720p por
  // 18 min). Lista de tela vazia === "nao estamos codificando tela" ===
  // null (o caso NEUTRO de tree.js/autoquality).
  function summarizeScreenEncodeHealth(rows) {
    const screen = (rows || []).filter((r) => baseKindOf(r.kind) === 'screen');
    if (!screen.length) return null;
    const comMs = screen.filter((r) => r.msPerFrame != null);
    return {
      softwareEncoder: screen.some((r) => isSoftwareEncoder(r.encoder)),
      cpuLimited: screen.some((r) => r.limitation === 'cpu'),
      msPerFrame: comMs.length ? Math.max(...comMs.map((r) => r.msPerFrame)) : null,
    };
  }

  const api = { SOFTWARE_ENCODERS, isSoftwareEncoder, baseKindOf, summarizeScreenEncodeHealth };

  root.GoLive = root.GoLive || {};
  root.GoLive.encodehealth = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

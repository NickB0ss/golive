'use strict';

/*
 * Janela "Ao vivo (Twitch)" da Mesa -- modulo PURO (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1; pesquisa
 * docs/2026-09-24-pesquisa-janelas-da-mesa.md, secao 2).
 *
 * So o canal. Nao ha sincronia: e ao vivo, cada PC abre o mesmo canal no
 * player da Twitch (`parent=localhost`, a origem local do app).
 *
 * Acoes:
 *   { kind: 'set', url | channel }   troca o canal (aceita twitch.tv/<canal>)
 *   { kind: 'clear' }                volta para o campo vazio
 *
 * Kick ficou de fora: o embed dele (player.kick.com) nao tem documentacao
 * nem API de postMessage, pediria outro host no frame-src e nao deu para
 * medir daqui (o proxy recusa). Ver docs/2026-09-24-midia-na-mesa.md.
 */

(function (root) {
  const L = (root.GoLive && root.GoLive.mesaMidiaLinks)
    || (typeof module !== 'undefined' && typeof module.require === 'function' ? module.require('./midialinks') : null);

  const TYPE = 'aovivo';

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function init() {
    return { channel: null };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    if (action.kind === 'clear') return { kind: 'clear' };
    if (action.kind !== 'set') return 'Ação desconhecida';
    const channel = L.parseTwitch(typeof action.channel === 'string' ? action.channel : action.url);
    return channel ? { kind: 'set', channel } : 'Canal da Twitch não reconhecido';
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    if (a.kind === 'set' && a.channel === state.channel) return 'Já é esse canal';
    if (a.kind === 'clear' && !state.channel) return 'Nenhum canal';
    return true;
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    if (a.kind === 'clear') return state.channel ? { channel: null } : state;
    return a.channel === state.channel ? state : { channel: a.channel };
  }

  function summary(state) {
    return state && state.channel ? `twitch.tv/${state.channel}` : 'Nenhum canal';
  }

  /** Endereco do player da Twitch para um canal, com o `parent` da pagina. */
  function playerUrl(channel, parent) {
    const p = typeof parent === 'string' && /^[a-z0-9.-]{1,253}$/i.test(parent) ? parent : 'localhost';
    return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(p)}&autoplay=true&muted=false`;
  }

  const api = {
    type: TYPE,
    title: 'Ao vivo (Twitch)',
    group: 'assistir',
    size: { w: 640, h: 360, minW: 320, minH: 180, aspect: 16 / 9 },
    maxStateBytes: 128,
    init,
    validate,
    reduce,
    summary,
    playerUrl,
    parseLink: L.parseTwitch,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

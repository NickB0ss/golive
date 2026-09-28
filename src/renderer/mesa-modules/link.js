'use strict';

/*
 * Janela "Link" da Mesa -- modulo PURO (sem DOM, sem relogio, sem sorte).
 * Pesquisa: docs/2026-09-24-pesquisa-janelas-da-mesa.md, secao 5.
 *
 * Alguem cola um endereco `https://` e, se quiser, um titulo; a janela
 * mostra titulo, dominio e "Abrir no navegador" (no navegador de cada um,
 * depois de a pessoa confirmar o dominio). Nao e navegar junto, e nada
 * busca a pagina: sem previa, sem rede.
 *
 * O endereco e conferido aqui e de novo no processo principal antes de
 * abrir (src/main/linksexternos.js, `linkDaMesa('link', url)`): so https,
 * sem usuario/senha, sem porta, com nome de dominio de verdade (nada de IP,
 * localhost ou nome da rede local).
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'link';
  const MAX_URL = 2048;
  const MAX_TITLE = 80;
  const ROTULO = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  const TLD_LOCAIS = ['localhost', 'local', 'internal', 'lan', 'home', 'arpa'];

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  /** Nome de dominio de verdade (o mesmo `dominioPublico` do processo
   * principal): rotulos DNS, pelo menos um ponto, ultimo rotulo com letra. */
  function dominioPublico(host) {
    if (typeof host !== 'string' || !host || host.length > 253 || host.endsWith('.')) return false;
    const partes = host.split('.');
    if (partes.length < 2 || !partes.every((p) => ROTULO.test(p))) return false;
    const tld = partes[partes.length - 1];
    return /[a-z]/.test(tld) && !TLD_LOCAIS.includes(tld);
  }

  /** Texto colado -> `{ url, host }` (URL normalizada, dominio em
   * minusculas/punycode), ou `null`. */
  function parseLink(input) {
    if (typeof input !== 'string' || input.length > MAX_URL + 64) return null;
    const raw = input.trim();
    if (raw.length > MAX_URL || !/^https:\/\//i.test(raw) || /[\s\p{Cc}\\]/u.test(raw)) return null;
    let u;
    try {
      u = new URL(raw);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (!dominioPublico(u.hostname) || u.href.length > MAX_URL) return null;
    return { url: u.href, host: u.hostname };
  }

  /** Titulo: uma linha, sem controle, ate 80 caracteres; vazio -> null. */
  function cleanTitle(v) {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string' || v.length > MAX_TITLE * 4) return undefined;
    const t = v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
    if (Array.from(t).length > MAX_TITLE) return undefined;
    return t || null;
  }

  function init() {
    return { url: null, host: null, title: null, by: null, rev: 0 };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'set': {
        const l = parseLink(action.url);
        if (!l) return 'Cole um endereço https:// de um site (sem usuário, senha ou porta)';
        const title = cleanTitle(action.title);
        if (title === undefined) return `Título longo demais (máx. ${MAX_TITLE})`;
        return { kind: 'set', url: l.url, host: l.host, title };
      }
      case 'clear':
        return { kind: 'clear' };
      default:
        return 'Ação desconhecida';
    }
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    if (a.kind === 'set' && a.url === state.url && a.title === state.title) return 'Este link já está na janela';
    if (a.kind === 'clear' && !state.url) return 'Não há link para tirar';
    return true;
  }

  function reduce(state, action, ctx) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    const by = ctx && ctx.from != null ? String(ctx.from).slice(0, 16) : null;
    if (a.kind === 'set') return { url: a.url, host: a.host, title: a.title, by, rev: state.rev + 1 };
    if (a.kind === 'clear') return { url: null, host: null, title: null, by: null, rev: state.rev + 1 };
    return state;
  }

  function summary(state) {
    if (!state.url) return 'Nenhum link ainda';
    return state.title ? `${state.title} (${state.host})` : state.host;
  }

  const api = {
    type: TYPE,
    title: 'Link',
    group: 'ferramentas',
    size: { w: 360, h: 200, minW: 240, minH: 150, aspect: null },
    // 2 048 do endereco (ja em %XX, ASCII) + 80 caracteres de titulo (ate 6
    // bytes cada no JSON) + dominio + envelope.
    maxStateBytes: 4096,
    MAX_URL, MAX_TITLE,
    dominioPublico,
    parseLink,
    init,
    validate,
    reduce,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

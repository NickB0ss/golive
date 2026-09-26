'use strict';

/*
 * Nota: texto compartilhado na Mesa (spec 2026-09-24, secao 4.4). O ultimo
 * que salva vence; teto de 1 000 caracteres.
 *
 * E tambem o modulo de exemplo do contrato
 * (docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1): o menor
 * caminho de ponta a ponta -- `add` cria a nota vazia, `act` com
 * `{ kind: 'set', text }` troca o texto para a sala inteira.
 */

(function (root) {
  const MAX_CHARS = 1000;

  const nota = {
    type: 'nota',
    title: 'Nota',
    group: 'ferramentas',
    size: { w: 320, h: 240, minW: 160, minH: 120, aspect: null },
    // 1 000 caracteres de ate 4 bytes, ou de escape JSON (\u0000 = 6), mais
    // o envelope: 8 KB cobre o pior texto que o validate deixa passar.
    maxStateBytes: 8192,

    init() {
      return { text: '', by: null, rev: 0 };
    },

    validate(state, action) {
      if (!action || typeof action !== 'object' || action.kind !== 'set') return 'ação desconhecida';
      if (typeof action.text !== 'string') return 'texto inválido';
      // Caracteres, nao unidades UTF-16: um emoji conta como um.
      if (Array.from(action.text).length > MAX_CHARS) return `a nota passa de ${MAX_CHARS} caracteres`;
      return true;
    },

    reduce(state, action, ctx) {
      const rev = state && Number.isSafeInteger(state.rev) ? state.rev : 0;
      return { text: action.text, by: ctx && ctx.from != null ? String(ctx.from) : null, rev: rev + 1 };
    },
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[nota.type] = nota;

  if (typeof module !== 'undefined') module.exports = nota;
})(typeof window !== 'undefined' ? window : global);

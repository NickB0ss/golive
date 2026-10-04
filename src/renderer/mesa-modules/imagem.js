'use strict';

/*
 * Imagem: uma imagem do chat posta na Mesa ("Pôr na mesa" na imagem do
 * chat, ou na Galeria).
 *
 * O estado guarda so o id da mensagem do chat, NUNCA a imagem: o data URL
 * (ate 200 KB) ja esta no historico do chat de todo mundo, e o estado de
 * janela tem teto de bytes (contrato da Mesa, secao 1). Cada PC acha a
 * imagem pelo id no proprio historico (chatimagens.js); se ela saiu do
 * historico (so 8 imagens ficam), a janela diz isso.
 *
 * Acao: `{ kind: 'set', msgId }` troca a imagem (o ultimo vence).
 */

(function (root) {
  const { codigo } = (root.GoLive && root.GoLive.i18n)
    || (typeof module !== 'undefined' ? require('../i18n') : { codigo: (chave) => chave });
  const TYPE = 'imagem';
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

  const imagem = {
    type: TYPE,
    title: 'mesa.titulo.imagem',
    group: 'ferramentas',
    size: { w: 480, h: 360, minW: 160, minH: 160, aspect: null },
    maxStateBytes: 256,

    init() {
      return { msgId: null, by: null, rev: 0 };
    },

    validate(state, action) {
      if (!action || typeof action !== 'object' || action.kind !== 'set') return codigo('mesa.imagem.acaoDesconhecida');
      if (typeof action.msgId !== 'string' || !ID_RE.test(action.msgId)) return codigo('mesa.imagem.imagemInvalida');
      return true;
    },

    reduce(state, action, ctx) {
      const rev = state && Number.isSafeInteger(state.rev) ? state.rev : 0;
      return { msgId: action.msgId, by: ctx && ctx.from != null ? String(ctx.from).slice(0, 32) : null, rev: rev + 1 };
    },

    summary(state) {
      return { chave: state && state.msgId ? 'mesa.resumo.imagemChat' : 'mesa.imagem.nenhuma' };
    },
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = imagem;

  if (typeof module !== 'undefined') module.exports = imagem;
})(typeof window !== 'undefined' ? window : global);

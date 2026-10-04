'use strict';

/*
 * Quadro -- janela de ferramenta da Mesa (contrato,
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 10, "Quadro").
 * Folha em branco onde todo mundo rabisca com as MESMAS ferramentas do
 * rabisco sobre a tela (`annotate.js`: caneta, texto, desfazer os seus, cor
 * de cada um).
 *
 * O traco NAO mora no estado desta janela: ele vai pelo canal do rabisco do
 * servidor ('annotate'/'annotate-sync', superficie 'mesa:<id da janela>'),
 * porque o estado da janela tem teto de 16 KB e uma folha cheia de tracos
 * estoura isso na primeira pincelada. O estado aqui guarda quem criou a
 * janela (`owner`, carimbado pelo servidor no `init`, ctx.by) e se ela esta
 * escondida dos outros (`hidden`). So quem criou troca essa visibilidade.
 *
 * `annotate`/`canAnnotateClear` sao a extensao do contrato pro canal do
 * rabisco em janela da Mesa (server/signaling-core.js, casos
 * 'annotate'/'annotate-sync'): `annotate: true` liga o canal pra este tipo;
 * `canAnnotateDraw`/`canAnnotateClear` decidem quem desenha ou limpa; e
 * `canAnnotateSee` decide quem recebe o rabisco. Quando escondido, so a
 * pessoa que criou ve e desenha; visivel, o Quadro segue colaborativo.
 */

(function (root) {
  function init(ctx) {
    return { owner: ctx && ctx.by != null ? String(ctx.by) : null, hidden: false };
  }

  function validate(state, action, ctx) {
    if (!action || action.kind !== 'visibility' || typeof action.hidden !== 'boolean') {
      return 'Visibilidade inválida';
    }
    const owner = state && state.owner;
    if (!ctx || ctx.from !== owner) return 'Só quem criou o quadro pode escondê-lo';
    return true;
  }

  function reduce(state, action) {
    if (!action || action.kind !== 'visibility' || typeof action.hidden !== 'boolean') return state;
    return { ...state, hidden: action.hidden };
  }

  function estaEscondido(state) {
    return state && state.hidden === true;
  }

  function isPrivate(state) {
    return estaEscondido(state);
  }

  function canAnnotateDraw(state, from) {
    return !estaEscondido(state) || String(from) === String(state && state.owner);
  }

  function canAnnotateClear(state, from, ctx) {
    if (estaEscondido(state)) return String(from) === String(state && state.owner);
    return String(from) === String(state && state.owner) || (ctx && ctx.isLeader === true);
  }

  function canAnnotateSee(state, peerId) {
    return !estaEscondido(state) || String(peerId) === String(state && state.owner);
  }

  function dropPeer(state, peerId) {
    if (estaEscondido(state) && String(peerId) === String(state && state.owner)) {
      return { ...state, hidden: false };
    }
    return state;
  }

  function summary(state) {
    return { chave: estaEscondido(state) ? 'mesa.resumo.quadroEscondido' : 'mesa.resumo.quadroGrupo' };
  }

  const mod = {
    type: 'quadro',
    title: 'mesa.titulo.quadro',
    group: 'ferramentas',
    size: { w: 640, h: 480, minW: 320, minH: 240, aspect: null },
    maxStateBytes: 256,
    annotate: true,
    init,
    validate,
    reduce,
    canAnnotateDraw,
    canAnnotateClear,
    canAnnotateSee,
    isPrivate,
    dropPeer,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.quadro = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);

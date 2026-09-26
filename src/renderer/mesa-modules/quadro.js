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
 * estoura isso na primeira pincelada. O estado aqui guarda so quem criou a
 * janela (`owner`, carimbado pelo servidor no `init`, ctx.by): e o que o
 * conteudo (`mesa-janelas/quadro.js`) usa pra saber se "Limpar" aparece
 * ligado. Nenhuma acao (`act`) existe -- nada muda este estado depois de
 * criado.
 *
 * `annotate`/`canAnnotateClear` sao a extensao do contrato pro canal do
 * rabisco em janela da Mesa (server/signaling-core.js, casos
 * 'annotate'/'annotate-sync'): `annotate: true` liga o canal pra este tipo;
 * sem `canAnnotateDraw` (nao declarado aqui) qualquer pessoa na vista Mesa
 * pode desenhar -- e a regra do Quadro ("todo mundo rabisca"); so
 * `canAnnotateClear` decide quem pode apagar tudo, o servidor confere
 * antes de repassar o `clear` (o lider ou quem pos a janela).
 */

(function (root) {
  function init(ctx) {
    return { owner: ctx && ctx.by != null ? String(ctx.by) : null };
  }

  // Nenhuma acao existe: o botao "Limpar" e o resto do desenho passam pelo
  // canal do rabisco, nao por `act`. `validate` so precisa devolver um
  // motivo (nunca `true`) para o registro aceitar o modulo.
  function validate() {
    return 'Esta janela não tem ação';
  }

  function reduce(state) {
    return state;
  }

  function canAnnotateClear(state, from, ctx) {
    return String(from) === String(state && state.owner) || (ctx && ctx.isLeader === true);
  }

  function summary() {
    return 'Rabisco em grupo';
  }

  const mod = {
    type: 'quadro',
    title: 'Quadro',
    group: 'ferramentas',
    size: { w: 640, h: 480, minW: 320, minH: 240, aspect: null },
    maxStateBytes: 256,
    annotate: true,
    init,
    validate,
    reduce,
    canAnnotateClear,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules.quadro = mod;

  if (typeof module !== 'undefined') module.exports = mod;
})(typeof window !== 'undefined' ? window : global);

'use strict';

/*
 * Carencia da visibilidade da janela (log de 2026-09-19).
 *
 * `isAppVisible()` governa duas coisas caras: o `watching` do view-state --
 * que do outro lado vira replaceTrack(null) no sender (mesh.js, F1.3) -- e o
 * `watched` do stallwatch. Ate aqui as duas seguiam o sinal cru, sem nenhuma
 * histerese, e este app roda com o jogo por cima: alternar e o uso NORMAL,
 * nao a excecao.
 *
 * O que a sessao de 2026-09-19 registrou em 90 minutos: 70 mudancas de
 * visibilidade, 27 delas a menos de 2 s uma da outra, com janelas de
 * `watching=true` de 0,40 / 0,48 / 0,52 / 0,63 / 0,72 s. Um keyframe de tela
 * 1080p depois do replaceTrack demora mais que isso pra chegar e decodificar
 * -- entao cada olhada religava a track e a arrancava antes do primeiro
 * quadro pintar. O tile ficava preto PARA SEMPRE, e a autocura que existe
 * exatamente pra esse caso (stallwatch.js) nunca disparava, porque
 * `observe({watched:false})` zera o cronometro de 6 s a cada piscada. O log
 * inteiro nao tem um unico 'reoffer'.
 *
 * A carencia e ASSIMETRICA de proposito:
 *
 *   visivel  -> vale na hora. Segurar aqui seria segurar imagem de quem esta
 *               olhando, que e o oposto do que se quer.
 *   oculto   -> so vale depois de `graceMs`. Uma piscada mais curta que isso
 *               nunca chega a virar watching=false, e as dezenas de
 *               suspende/religa viram um periodo continuo.
 *
 * `graceMs` precisa ser maior que keyframe + decode de 1080p depois de um
 * replaceTrack (meio a dois segundos na pratica); 2,5 s deixa margem. O preco
 * e ate 2,5 s de encode a mais quando a pessoa minimiza de verdade -- contra
 * os 394 s de transmissao parada que o mesmo log mostrou, nao se discute.
 *
 * Isto NAO cobre um peer em versao antiga: o flapping dele continua chegando
 * aqui como view-state e o nosso sender continua obedecendo na hora. O
 * conserto dos dois lados moraria em setPeerDemand, e e outra mudanca.
 *
 * Nao segura a PINTURA (ui.grid.setPainting) nem o intervalo de stats: parar
 * de desenhar com a janela oculta na hora e a economia de GPU da F1.4, e essa
 * continua valendo no sinal cru.
 */
(function (root) {
  const DEFAULTS = { graceMs: 2500 };

  /** Decide so com numeros e o relogio que quem chama passa, pra regra ficar
   * coberta sem DOM, sem timer e sem janela de verdade.
   *
   * `observe({ visible, now })` devolve:
   *   - `visible`: o valor EFETIVO, ja com a carencia aplicada;
   *   - `changed`: se ele mudou nesta observacao (quem chama so precisa
   *     reagir quando isto e true);
   *   - `recheckInMs`: quanto falta pra pendencia vencer, ou null quando nao
   *     ha nenhuma. Sem observar de novo ao fim desse prazo o `false` nunca
   *     sai, porque a origem do sinal (o evento de visibilidade) ja passou. */
  function createVisibilityHold(opts = {}) {
    const graceMs = opts.graceMs ?? DEFAULTS.graceMs;
    // "Assistindo" e o padrao seguro em toda a cadeia de view-state: na
    // duvida, paga-se encode em vez de entregar tela preta.
    let held = true;
    let pendingSince = null;

    function observe({ visible, now }) {
      if (visible) {
        pendingSince = null;
        const changed = !held;
        held = true;
        return { visible: true, changed, recheckInMs: null };
      }
      if (!held) return { visible: false, changed: false, recheckInMs: null };
      // Só a PRIMEIRA observacao de oculto abre a pendencia: reabrir a cada
      // chamada faria um observe periodico adiar a carencia pra sempre.
      if (pendingSince === null) pendingSince = now;
      const waited = now - pendingSince;
      if (waited < graceMs) return { visible: true, changed: false, recheckInMs: graceMs - waited };
      pendingSince = null;
      held = false;
      return { visible: false, changed: true, recheckInMs: null };
    }

    function current() {
      return held;
    }

    // Sem reset de proposito: a carencia acompanha a JANELA, que sobrevive a
    // sessao. Zera-la no teardown faria uma janela minimizada voltar a se
    // declarar "assistindo" ate o proximo evento de visibilidade -- que pode
    // nao vir, porque nada mudou.
    return { observe, current };
  }

  const api = { createVisibilityHold, DEFAULTS };
  root.GoLive = root.GoLive || {};
  root.GoLive.viewhold = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

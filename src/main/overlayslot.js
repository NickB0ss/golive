/*
 * Dono da janela de rabisco (overlay) do main. Logica pura, sem electron --
 * por isso fica separada de main.js, que o node:test nao importa.
 *
 * O `overlay:start` e assincrono (espera a pagina carregar), entao dois
 * pedidos podem se sobrepor: o segundo destroi a janela do primeiro ao abrir a
 * dele. Se a falha do primeiro (a janela dele foi destruida, o `loadFile`
 * rejeita) derrubasse "a janela do overlay" pela variavel global, derrubaria a
 * do SEGUNDO, e os dois pedidos voltariam "monitor sumiu" (auditoria
 * 2026-11-25, M-09). Aqui cada pedido so mexe na janela que ele mesmo criou.
 */

'use strict';

/**
 * @template W
 * @param {{ destruir: (janela: W) => void }} deps  `destruir` ja deve tolerar
 *   janela destruida.
 */
function criarSlotOverlay({ destruir }) {
  /** @type {W | null} */
  let atual = null;

  function fechar() {
    const janela = atual;
    atual = null;
    if (janela) destruir(janela);
  }

  /**
   * Abre uma janela nova no lugar da atual. `criar()` devolve a janela (ja
   * criada, ainda carregando) e a promessa do carregamento.
   * @param {() => { janela: W, carregou: Promise<unknown> }} criar
   * @returns {Promise<{ ok: true } | { ok: false, reason: 'display' | 'superseded', erro?: unknown }>}
   *   'display': a janela deste pedido nao carregou. 'superseded': outro
   *   pedido (ou um stop) tomou o lugar dela antes -- nao e erro do monitor.
   */
  async function abrir(criar) {
    fechar();
    let janela;
    let carregou;
    try {
      ({ janela, carregou } = criar());
    } catch (erro) {
      return { ok: false, reason: 'display', erro }; // nem chegou a criar a janela
    }
    atual = janela;
    try {
      await carregou;
    } catch (erro) {
      if (atual === janela) {
        fechar();
        return { ok: false, reason: 'display', erro };
      }
      destruir(janela); // idempotente; a que o outro pedido abriu fica intacta
      return { ok: false, reason: 'superseded', erro };
    }
    // Carregou, mas um stop/outro start pode ter tomado o lugar durante a espera.
    if (atual !== janela) return { ok: false, reason: 'superseded' };
    return { ok: true };
  }

  /** O evento 'closed' de uma janela: so solta o slot se ainda for a dela. */
  function fechada(janela) {
    if (atual === janela) atual = null;
  }

  return {
    abrir,
    fechar,
    fechada,
    get janela() {
      return atual;
    },
  };
}

module.exports = { criarSlotOverlay };

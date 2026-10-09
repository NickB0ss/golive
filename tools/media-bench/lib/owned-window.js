'use strict';

/*
 * Tamanho da janela PROPRIA do modo owned-window. Puro (sem Electron): recebe
 * a area de trabalho e o fator de escala e devolve o tamanho efetivo em DIP.
 *
 * A captura de janela entrega PIXELS FISICOS (DIP x scaleFactor). Para a fonte
 * medida bater com o cenario pedido, a janela (de conteudo, sem moldura) e
 * criada com pedido/scaleFactor DIP e limitada a area de trabalho. Se o
 * monitor nao comporta o pedido, `clamped` fica true e o relatorio avisa.
 */

/**
 * @param {{width:number,height:number,fps:number}} cfg  cenario pedido (pixels)
 * @param {{width:number,height:number}} workArea         area de trabalho em DIP
 * @param {number} [scaleFactor=1]
 * @returns {{width:number,height:number,fps:number,scaleFactor:number,clamped:boolean,
 *            expectedPixels:{width:number,height:number}}}
 */
function fitOwnedWindow(cfg, workArea, scaleFactor = 1) {
  const sf = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const maxW = Math.max(1, Math.floor(workArea?.width) || 1);
  const maxH = Math.max(1, Math.floor(workArea?.height) || 1);
  const wantW = Math.max(1, Math.round(cfg.width / sf));
  const wantH = Math.max(1, Math.round(cfg.height / sf));
  const width = Math.min(wantW, maxW);
  const height = Math.min(wantH, maxH);
  return {
    width, height, fps: cfg.fps, scaleFactor: sf,
    clamped: width !== wantW || height !== wantH,
    expectedPixels: { width: Math.round(width * sf), height: Math.round(height * sf) },
  };
}

module.exports = { fitOwnedWindow };

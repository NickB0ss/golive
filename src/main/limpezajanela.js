/*
 * Limpeza do que o main guarda em nome da pagina principal quando ela some
 * (recarrega ou cai). Logica pura, sem electron -- por isso fica separada de
 * main.js, que o node:test nao importa.
 *
 * O estado que o main segura pelo renderer (capturas de audio nativas, janela
 * de rabisco, sala hospedada, "sala ativa" do atualizador) nao se desfaz
 * sozinho: a pagina nova nasce no lobby sem saber que ele existe. Sem esta
 * limpeza a thread WASAPI continuava mandando `audio:chunk` pra uma pagina que
 * descarta tudo, a janela de rabisco ficava sobre o monitor e o servidor
 * embutido seguia anunciado sem o dono (auditoria 2026-11-25, M-02).
 */

'use strict';

/**
 * Para as capturas nativas que pertencem a `sender` (o webContents que as
 * pediu) e tira do mapa. Devolve quantas parou.
 * @param {Map<number, { stop: () => void }>} capturas
 * @param {WeakMap<object, unknown>} donos captura -> webContents que a pediu
 * @param {unknown} sender
 */
function pararCapturasDe(capturas, donos, sender) {
  let paradas = 0;
  for (const [id, captura] of Array.from(capturas)) {
    if (donos.get(captura) !== sender) continue;
    capturas.delete(id);
    paradas += 1;
    try {
      captura.stop();
    } catch {
      /* ja parada */
    }
  }
  return paradas;
}

/**
 * Monta a rotina de limpeza. Cada passo roda mesmo que o anterior falhe.
 * @param {{ passos: Array<[string, () => unknown]>, log?: (msg: string) => void }} opts
 * @returns {() => void}
 */
function criarLimpezaDaPagina({ passos, log = () => {} }) {
  return () => {
    for (const [nome, passo] of passos) {
      try {
        const resultado = passo();
        // Passo assincrono (fechar o servidor): a falha vira log, nunca excecao solta.
        if (resultado && typeof resultado.catch === 'function') {
          resultado.catch((err) => log(`limpeza da pagina: ${nome} falhou: ${err?.message || err}`));
        }
      } catch (err) {
        log(`limpeza da pagina: ${nome} falhou: ${err?.message || err}`);
      }
    }
  };
}

/**
 * Decide, no `did-start-navigation` do quadro principal, se e uma carga que
 * descarta o estado da pagina: so navegacao do quadro principal (nao iframe,
 * nao `#hash`/pushState) e so depois da primeira carga terminar.
 * @param {{ isMainFrame?: boolean, isSameDocument?: boolean }} detalhes
 * @param {boolean} jaCarregou
 */
function navegacaoDescartaPagina(detalhes, jaCarregou) {
  if (!jaCarregou || !detalhes) return false;
  return detalhes.isMainFrame === true && detalhes.isSameDocument !== true;
}

module.exports = { pararCapturasDe, criarLimpezaDaPagina, navegacaoDescartaPagina };

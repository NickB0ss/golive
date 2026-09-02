/*
 * Data URL da thumbnail de cada fonte do seletor de tela/janela.
 *
 * Vive fora de main.js porque main.js importa `electron` e nao pode ser
 * carregado pelo node:test -- aqui o nativeImage entra como argumento, entao
 * a decisao fica testavel com um duble.
 *
 * G5 da auditoria de 2026-08-27: `thumbnail.toDataURL()` codifica PNG, e a
 * lista de janelas codifica UMA por janela no processo principal, justo no
 * clique em que a pessoa vai comecar a transmitir. Com a maquina cheia de
 * janelas abertas isso e um pico de CPU visivel. JPEG resolve porque o custo
 * de compressao nao depende de achar padroes exatos como o PNG sem perda --
 * e thumbnail de 224x126 num card nao tem o que perder de qualidade.
 */

'use strict';

// Sugerido pela auditoria (G5). Acima disso o arquivo cresce sem que o card
// de 190px mostre diferenca; abaixo, o artefato de bloco comeca a aparecer em
// janela com texto (que e o conteudo tipico de uma thumbnail de janela).
const QUALIDADE_JPEG = 70;

// PNG 1x1 transparente. Serve de resposta pra thumbnail que o Chromium
// devolveu vazia (acontece com janela minimizada ou que sumiu entre o
// getSources e a leitura). O campo continua sendo uma data URL valida, entao
// o <img> do card fica em branco em vez de pedir a propria pagina de volta --
// que e o que um src="" faz.
const PIXEL_VAZIO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * @param {{ isEmpty?: () => boolean, toJPEG?: (q: number) => Buffer, toDataURL?: () => string }} image
 * @returns {string} data URL sempre -- nunca lanca, nunca devolve vazio.
 */
function thumbnailDataUrl(image) {
  if (!image) return PIXEL_VAZIO;

  // Uma imagem vazia codifica pra "data:image/jpeg;base64," (payload zero),
  // que o <img> so descobre que e invalida depois de tentar decodificar.
  try {
    if (typeof image.isEmpty === 'function' && image.isEmpty()) return PIXEL_VAZIO;
  } catch {
    // isEmpty quebrado nao e motivo pra desistir da imagem -- segue.
  }

  // Caminho preferido. Cada `catch` aqui e uma versao de Electron ou um
  // nativeImage falso em que toJPEG nao existe ou nao produz nada: melhor
  // pagar o PNG de novo do que devolver a lista de fontes sem thumbnail.
  if (typeof image.toJPEG === 'function') {
    try {
      const buf = image.toJPEG(QUALIDADE_JPEG);
      if (buf && buf.length) return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch {
      // cai no PNG abaixo
    }
  }

  if (typeof image.toDataURL === 'function') {
    try {
      const url = image.toDataURL();
      // "data:image/png;base64," sozinho e a forma que a imagem vazia toma
      // quando isEmpty nao denunciou -- nao vale a pena repassar.
      if (typeof url === 'string' && /base64,.+/.test(url)) return url;
    } catch {
      // cai no pixel vazio
    }
  }

  return PIXEL_VAZIO;
}

const api = { thumbnailDataUrl, QUALIDADE_JPEG, PIXEL_VAZIO };

if (typeof module !== 'undefined') module.exports = api;

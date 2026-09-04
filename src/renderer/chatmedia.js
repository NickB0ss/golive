// src/renderer/chatmedia.js
'use strict';

/*
 * Imagem no chat -- a parte PURA: o que e aceito, quanto pode pesar e por
 * qual escada de reencode a imagem desce ate caber.
 *
 * O redimensionamento em si (canvas, FileReader) mora no app.js, que tem
 * DOM. Aqui fica a decisao, que e o que da pra testar e o que nao pode
 * divergir do teto que o servidor aplica.
 *
 * Ver docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md, secao 6.
 */

(function (root) {
  // Teto de UMA imagem, em caracteres do data URL (~3/4 disso em bytes).
  // DUPLICADO de proposito em server/signaling-core.js: o servidor nao
  // pode confiar que o cliente e o nosso, e o cliente nao deve mandar algo
  // que ele sabe que vai ser recusado. Se um dos dois mudar, o teste de
  // ponta a ponta da sinalizacao reclama.
  const MAX_IMAGE_CHARS = 200 * 1024;

  // Tipos que o app aceita anexar. GIF esta aqui, mas com um caminho
  // proprio (ver `needsCanvas`): passar GIF por canvas captura UM quadro e
  // mata a animacao -- o mesmo motivo pelo qual o avatar ja abre excecao
  // pra ele.
  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  // Escada de reencode, do melhor pro mais barato. A primeira combinacao
  // que couber no teto ganha; se nenhuma couber, a imagem e recusada com
  // aviso (em vez de sair irreconhecivel).
  //
  // Desce QUALIDADE antes de RESOLUCAO de proposito: um print de tela a
  // 1280px com JPEG 0,6 ainda da pra ler o texto; o mesmo print a 800px
  // com qualidade alta, nao.
  const ENCODE_LADDER = [
    { maxDim: 1280, quality: 0.82 },
    { maxDim: 1280, quality: 0.7 },
    { maxDim: 1280, quality: 0.6 },
    { maxDim: 1024, quality: 0.6 },
    { maxDim: 800, quality: 0.55 },
  ];

  function isAcceptedType(type) {
    return ACCEPTED_TYPES.includes(String(type || '').toLowerCase());
  }

  /** GIF vai como esta (senao perde a animacao); o resto passa pelo canvas. */
  function needsCanvas(type) {
    return isAcceptedType(type) && String(type).toLowerCase() !== 'image/gif';
  }

  /** Data URL de imagem que o chat aceita exibir. Recusa `http(s)://` de
   * proposito: uma URL remota faria o renderer buscar de um endereco
   * escolhido por quem mandou a mensagem (e o CSP so permite `data:` e
   * `blob:` em img-src, entao nem carregaria -- ficaria um quadrado
   * quebrado sem explicacao). */
  function isImageDataUrl(value) {
    return typeof value === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(value);
  }

  /** Tamanho aproximado, em bytes, do que um data URL base64 carrega. Pro
   * aviso ao usuario ("máx. 200 KB"), nao pra decisao -- a decisao usa o
   * comprimento em caracteres, que e exatamente o que o servidor mede. */
  function dataUrlBytes(dataUrl) {
    if (typeof dataUrl !== 'string') return 0;
    const i = dataUrl.indexOf(',');
    if (i < 0) return 0;
    const base64 = dataUrl.length - i - 1;
    const padding = dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((base64 * 3) / 4) - padding);
  }

  function fitsBudget(dataUrl) {
    return typeof dataUrl === 'string' && dataUrl.length > 0 && dataUrl.length <= MAX_IMAGE_CHARS;
  }

  /** Caixa de destino de uma imagem `w x h` cabendo em `maxDim` no maior
   * lado. Imagem que ja e menor NAO e ampliada -- reencodar pra cima so
   * gasta bytes. */
  function fitBox(w, h, maxDim) {
    const width = Number(w);
    const height = Number(h);
    const max = Number(maxDim);
    if (!(width > 0) || !(height > 0) || !(max > 0)) return { w: 0, h: 0 };
    const scale = Math.min(1, max / Math.max(width, height));
    return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
  }

  /** Tamanho de exibicao da miniatura na linha do chat, preservando a
   * proporcao. Recebe as dimensoes que viajaram na mensagem; sem elas,
   * devolve `null` e quem desenha deixa a imagem no tamanho natural. */
  function thumbBox(w, h, maxW = 240, maxH = 240) {
    const width = Number(w);
    const height = Number(h);
    if (!(width > 0) || !(height > 0)) return null;
    const scale = Math.min(1, maxW / width, maxH / height);
    return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
  }

  const api = {
    MAX_IMAGE_CHARS,
    ACCEPTED_TYPES,
    ENCODE_LADDER,
    isAcceptedType,
    needsCanvas,
    isImageDataUrl,
    dataUrlBytes,
    fitsBudget,
    fitBox,
    thumbBox,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.chatmedia = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

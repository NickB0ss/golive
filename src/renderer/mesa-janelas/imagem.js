'use strict';

/*
 * Conteudo da janela "Imagem" (contrato da Mesa, secao 6). O modulo puro e
 * `mesa-modules/imagem.js`: o estado so tem o id da mensagem do chat.
 *
 * A imagem vem do historico do chat deste PC (`GoLive.chatImagens`, que o
 * app.js alimenta e que espelha as regras do servidor). Ajustada a janela
 * (`object-fit: contain`), inclusive na tela cheia da janela, que so faz o
 * `el` crescer. Se a imagem saiu do historico, a janela diz isso -- e volta
 * sozinha a mostrar se o historico mudar (nova entrada na sala com ela).
 */

(function (root) {
  const TYPE = 'imagem';

  // ---------- Puras ----------

  /** O que dizer no lugar da imagem, ou null quando ha imagem. */
  function textoFalta(state, img) {
    if (!state || !state.msgId) return 'Nenhuma imagem. Use “Pôr na mesa” numa imagem do chat ou na Galeria.';
    if (!img) return 'Esta imagem saiu do histórico do chat, que guarda só as 8 mais recentes.';
    return null;
  }

  /** "Enviada por Bia" (ou vazio sem nome). */
  function legenda(img) {
    return img && img.name ? `Enviada por ${img.name}` : '';
  }

  // ---------- DOM ----------

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function mount(el) {
    const store = () => root.GoLive.chatImagens || null;
    const raiz = h('div', 'mj mj-imagem');
    const quadro = h('div', 'mj-img-quadro');
    const foto = h('img', 'mj-img-foto');
    foto.draggable = false;
    foto.decoding = 'async';
    const falta = h('p', 'mj-img-falta');
    const rodape = h('p', 'mj-img-legenda');
    quadro.append(foto, falta);
    raiz.append(quadro, rodape);
    el.append(raiz);

    let state = null;

    function render() {
      const img = state && state.msgId ? store()?.get(state.msgId) || null : null;
      const msg = textoFalta(state, img);
      falta.hidden = !msg;
      falta.textContent = msg || '';
      foto.hidden = Boolean(msg);
      if (msg) {
        if (foto.getAttribute('src')) foto.removeAttribute('src');
      } else if (foto.getAttribute('src') !== img.image) {
        foto.src = img.image;
      }
      foto.alt = img ? `Imagem do chat enviada por ${img.name || 'alguém'}` : '';
      rodape.textContent = legenda(img);
      rodape.hidden = !rodape.textContent;
    }

    const off = store()?.onChange(render) || (() => {});

    return {
      update(novo) {
        state = novo || null;
        render();
      },
      destroy() {
        off();
        // Soltar o bitmap: a imagem pode ter ate 200 KB decodificada.
        foto.removeAttribute('src');
        raiz.remove();
      },
    };
  }

  const api = { type: TYPE, mount, textoFalta, legenda };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

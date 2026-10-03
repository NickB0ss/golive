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
 * Sem imagem, o vazio (`C.vazio`) ensina o caminho: "Pôr na Mesa" no chat.
 */

(function (root) {
  const TYPE = 'imagem';

  // ---------- Puras ----------

  /** O vazio que ocupa o lugar da imagem (titulo e uma frase), ou null quando ha imagem. */
  function faltaDaImagem(state, img) {
    if (!state || !state.msgId) {
      return { titulo: 'Nenhuma imagem', texto: 'Use “Pôr na Mesa” numa imagem do chat ou na Galeria.' };
    }
    if (!img) {
      return {
        titulo: 'Imagem fora do chat',
        texto: 'Esta imagem saiu do histórico do chat, que guarda só as 8 mais recentes.',
      };
    }
    return null;
  }

  // O comum.js ainda nao tem o quadro de imagem.
  const TRACO_IMAGEM = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/>'
    + '<path d="M21 16l-5-5-8 8"/>';

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
    const C = root.GoLive.mesaJanelasComum;
    const store = () => root.GoLive.chatImagens || null;
    const raiz = h('div', 'mj mj-imagem');
    raiz.dataset.superficie = C.SUPERFICIES[TYPE];
    const quadro = h('div', 'mj-img-quadro');
    const foto = h('img', 'mj-img-foto');
    foto.draggable = false;
    foto.decoding = 'async';
    const semImagem = faltaDaImagem(null, null);
    const falta = C.vazio({ icone: 'imagem', titulo: semImagem.titulo, texto: semImagem.texto });
    falta.classList.add('mj-img-falta');
    const faltaGlifo = falta.querySelector('.mj-vazio-glifo .mj-i');
    if (!faltaGlifo.innerHTML) faltaGlifo.innerHTML = TRACO_IMAGEM;
    const faltaTitulo = falta.querySelector('.mj-vazio-titulo');
    const faltaTexto = falta.querySelector('.mj-vazio-texto');
    const rodape = h('p', 'mj-img-legenda');
    quadro.append(foto, falta);
    raiz.append(quadro, rodape);
    el.append(raiz);

    let state = null;

    function render() {
      const img = state && state.msgId ? store()?.get(state.msgId) || null : null;
      const msg = faltaDaImagem(state, img);
      falta.hidden = !msg;
      faltaTitulo.textContent = msg ? msg.titulo : '';
      faltaTexto.textContent = msg ? msg.texto : '';
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

  // ---------- Registro ----------
  // Igual aos outros conteudos: a Vista carrega so `mesa-janelas/imagem.js`;
  // o apoio (comum.js) vem daqui, uma vez, da mesma pasta.
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum', 'tabuleiro.js': 'mesaJanelasTabuleiro' };
    const doc = root.document;
    const falta = () => arquivos.filter((a) => !G[GLOBAIS[a]]);
    const esperas = [];
    if (doc && falta().length) {
      const base = (doc.currentScript && doc.currentScript.src) || doc.baseURI;
      G.mesaJanelasApoio = G.mesaJanelasApoio || {};
      for (const a of falta()) {
        if (G.mesaJanelasApoio[a]) continue;
        const s = doc.createElement('script');
        s.src = new root.URL(a, base).href;
        s.async = false;
        G.mesaJanelasApoio[a] = s;
        doc.head.appendChild(s);
      }
      for (const a of falta()) {
        esperas.push(new Promise((ok) => {
          G.mesaJanelasApoio[a].addEventListener('load', ok, { once: true });
        }));
      }
    }
    const montar = api.mount;
    const pronto = esperas.length ? Promise.all(esperas) : null;
    api.mount = function (el, vistaApi) {
      if (!falta().length) return montar(el, vistaApi);
      let inst = null;
      let ultimo = null;
      let morto = false;
      pronto.then(() => {
        if (morto) return;
        inst = montar(el, vistaApi);
        if (ultimo) inst.update(ultimo[0], ultimo[1]);
      }, () => {});
      return {
        update(s, meta) { if (inst) inst.update(s, meta); else ultimo = [s, meta]; },
        destroy() { morto = true; if (inst) inst.destroy(); },
        focus() { if (inst && inst.focus) inst.focus(); },
      };
    };
    G.mesaJanelas[api.type] = api;
  }

  const api = { type: TYPE, mount, faltaDaImagem, legenda };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

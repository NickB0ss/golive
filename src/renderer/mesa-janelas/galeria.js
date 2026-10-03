'use strict';

/*
 * Conteudo da janela "Galeria" (contrato da Mesa, secao 6): as imagens que
 * o historico do chat ainda guarda, em grade, da mais nova para a mais
 * antiga, cada uma com "Pôr na mesa" (uma janela `imagem` nova, pelo mesmo
 * caminho do botao do chat: `GoLive.mesaPor`).
 *
 * Le o historico deste PC (`GoLive.chatImagens`) e se refaz quando ele
 * muda, sem recriar as miniaturas que continuam.
 */

(function (root) {
  const TYPE = 'galeria';

  // ---------- Puras ----------

  /** Da mais nova para a mais antiga (a lista do deposito vem ao contrario). */
  function itens(list) {
    return Array.isArray(list) ? list.filter((i) => i && i.id && i.image).slice().reverse() : [];
  }

  function contagem(n) {
    if (!n) return 'Nenhuma imagem';
    return n === 1 ? '1 imagem' : `${n} imagens`;
  }

  // ---------- DOM ----------

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // O comum.js ainda nao tem o quadro de imagem.
  const TRACO_IMAGEM = '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/>'
    + '<path d="M21 16l-5-5-8 8"/>';

  function mount(el) {
    const C = root.GoLive.mesaJanelasComum;
    const store = () => root.GoLive.chatImagens || null;
    const raiz = h('div', 'mj mj-galeria');
    raiz.dataset.superficie = C.SUPERFICIES[TYPE];
    const cabeca = h('div', 'mj-barra');
    const titulo = h('p', 'mj-rotulo', 'Imagens do chat');
    const conta = h('span', 'mj-gal-conta');
    cabeca.append(titulo, h('span', 'mj-mola'), conta);
    const grade = h('ul', 'mj-gal-grade mj-rola');
    grade.setAttribute('aria-label', 'Imagens do chat');
    const vazio = C.vazio({
      icone: 'imagem',
      titulo: 'Nenhuma imagem no chat',
      texto: 'Mande uma imagem no chat e ela aparece aqui, pronta para pôr na Mesa.',
    });
    const vazioGlifo = vazio.querySelector('.mj-vazio-glifo .mj-i');
    if (!vazioGlifo.innerHTML) vazioGlifo.innerHTML = TRACO_IMAGEM;
    const dica = h('p', 'mj-dica mj-gal-dica', 'O chat guarda as 8 imagens mais recentes.');
    raiz.append(cabeca, grade, vazio, dica);
    el.append(raiz);

    const nos = new Map(); // id -> <li>

    function item(img) {
      const li = h('li', 'mj-gal-item');
      const foto = h('img', 'mj-gal-foto');
      foto.draggable = false;
      foto.decoding = 'async';
      foto.loading = 'lazy';
      foto.src = img.image;
      foto.alt = `Imagem enviada por ${img.name || 'alguém'}`;
      const btn = h('button', 'mj-btn mj-gal-por');
      btn.type = 'button';
      btn.textContent = 'Pôr na Mesa';
      btn.title = `Pôr na Mesa a imagem de ${img.name || 'alguém'}`;
      btn.addEventListener('click', () => {
        root.GoLive.mesaPor?.put('imagem', { kind: 'set', msgId: img.id });
      });
      li.append(foto, btn);
      return li;
    }

    function render() {
      const lista = itens(store()?.list() || []);
      const ids = new Set(lista.map((i) => i.id));
      for (const [id, li] of [...nos]) {
        if (!ids.has(id)) {
          li.querySelector('img')?.removeAttribute('src');
          li.remove();
          nos.delete(id);
        }
      }
      lista.forEach((img, i) => {
        let li = nos.get(img.id);
        if (!li) {
          li = item(img);
          nos.set(img.id, li);
        }
        if (grade.children[i] !== li) grade.insertBefore(li, grade.children[i] || null);
      });
      conta.textContent = contagem(lista.length);
      // Sem imagem a frase e uma so: o vazio diz tudo e o cabecalho (rotulo e contagem) sai.
      cabeca.hidden = lista.length === 0;
      vazio.hidden = lista.length > 0;
      grade.hidden = lista.length === 0;
    }

    const off = store()?.onChange(render) || (() => {});

    return {
      update() {
        render();
      },
      destroy() {
        off();
        for (const li of nos.values()) li.querySelector('img')?.removeAttribute('src');
        nos.clear();
        raiz.remove();
      },
    };
  }

  // ---------- Registro ----------
  // Igual aos outros conteudos: a Vista carrega so `mesa-janelas/galeria.js`;
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

  const api = { type: TYPE, mount, itens, contagem };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

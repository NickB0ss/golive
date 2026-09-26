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

  function mount(el) {
    const store = () => root.GoLive.chatImagens || null;
    const raiz = h('div', 'mj mj-galeria');
    const cabeca = h('div', 'mj-barra');
    const titulo = h('p', 'mj-rotulo', 'Imagens do chat');
    const conta = h('span', 'mj-gal-conta');
    cabeca.append(titulo, h('span', 'mj-mola'), conta);
    const grade = h('ul', 'mj-gal-grade mj-rola');
    grade.setAttribute('aria-label', 'Imagens do chat');
    const vazio = h('p', 'mj-dica mj-gal-vazio', 'Nenhuma imagem no chat ainda. Mande uma pelo chat e ela aparece aqui.');
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
      btn.textContent = 'Pôr na mesa';
      btn.title = `Pôr na mesa a imagem de ${img.name || 'alguém'}`;
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

  const api = { type: TYPE, mount, itens, contagem };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

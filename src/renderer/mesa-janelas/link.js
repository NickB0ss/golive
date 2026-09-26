'use strict';

/*
 * Conteudo da janela "Link" (contrato da Mesa, secao 6). O modulo puro e
 * `mesa-modules/link.js`.
 *
 * - Sem link: campo do endereco (https://) e do titulo opcional.
 * - Com link: titulo, dominio e "Abrir no navegador". Abrir sempre pergunta
 *   antes, mostrando o dominio ("Abrir example.com no seu navegador?"); so
 *   depois do "Abrir" o pedido vai pela ponte do app
 *   (`golive.abrirLinkDaMesa('link', url)`), que confere de novo no
 *   processo principal. Se o link mudar com a pergunta aberta, a pergunta
 *   some: o que a pessoa confirmou e o que abre.
 *
 * Nada busca a pagina (sem previa, sem rede no renderer).
 */

(function (root) {
  const TYPE = 'link';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  // Os mesmos motivos da janela Spotify Jam (mesa-janelas/jam.js).
  const MOTIVOS_ABRIR = {
    recusado: 'O app não abre este link',
    rapido: 'Espere um instante e clique de novo',
    falhou: 'O navegador não abriu; tente de novo',
    origem: 'Não deu para abrir daqui',
    'sem-ponte': 'Abrir no navegador só funciona no app',
  };

  function motivoAbrir(reason) {
    return MOTIVOS_ABRIR[reason] || 'Não deu para abrir; tente de novo';
  }

  /** Abre pela ponte do app. `true` ou o motivo (frase). Nunca lanca. */
  async function abrirNoNavegador(ponte, tipo, url) {
    const abrir = ponte && ponte.abrirLinkDaMesa;
    if (typeof abrir !== 'function') return motivoAbrir('sem-ponte');
    try {
      const r = await abrir(tipo, url);
      return r && r.ok === true ? true : motivoAbrir(r && r.reason);
    } catch {
      return motivoAbrir('falhou');
    }
  }

  /** O que a janela mostra: titulo (ou o dominio, sem titulo), o dominio
   * e o resto do endereco (caminho, sem o esquema) para quem quer saber
   * aonde vai. */
  function apresentar(state) {
    if (!state.url) return null;
    let resto = '';
    try {
      const u = new URL(state.url);
      resto = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
    } catch {
      resto = '';
    }
    return { titulo: state.title || state.host, dominio: state.host, resto, temTitulo: !!state.title };
  }

  /** A pergunta antes de abrir. */
  function pergunta(host) {
    return `Abrir ${host} no seu navegador?`;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let trocando = false;
    let pendente = null; // o endereco que a pergunta aberta vai abrir
    let abrindo = false;

    // Sem link (ou trocando).
    const campoUrl = el('input', {
      class: 'mj-campo',
      attrs: {
        type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
        placeholder: 'https://…', 'aria-label': 'Endereço (https://)', maxlength: String(m.MAX_URL),
      },
    });
    const campoTitulo = el('input', {
      class: 'mj-campo',
      attrs: { type: 'text', autocomplete: 'off', placeholder: 'Título (opcional)', 'aria-label': 'Título do link (opcional)', maxlength: String(m.MAX_TITLE) },
    });
    const por = C.botao({ text: 'Pôr', class: 'mj-pri' });
    por.type = 'submit';
    const cancelar = C.botao({ text: 'Cancelar', class: 'mj-fantasma' });
    const form = el('form', { class: 'mj-link-form' }, campoUrl, el('div', { class: 'mj-form' }, campoTitulo, por, cancelar));
    const vazio = el('div', { class: 'mj-link-vazio' },
      el('p', { class: 'mj-dica mj-sec', text: 'Um link para cada um abrir no próprio navegador.' }), form);

    // Com link.
    const titulo = el('p', { class: 'mj-link-titulo' });
    const dominio = el('span', { class: 'mj-link-dominio' });
    const autor = el('span', { class: 'mj-link-autor' });
    const resto = el('p', { class: 'mj-link-resto mj-sec' });
    const abrir = C.botao({ text: 'Abrir no navegador', class: 'mj-pri mj-link-abrir' });
    const trocar = C.botao({ icone: 'lapis', text: 'Trocar', class: 'mj-fantasma', label: 'Trocar o link' });
    const tirar = C.botao({ icone: 'x', text: 'Tirar', class: 'mj-fantasma', label: 'Tirar o link da janela' });
    const acoes = el('div', { class: 'mj-barra mj-link-acoes' }, abrir, el('span', { class: 'mj-mola' }), trocar, tirar);

    const textoPergunta = el('p', { class: 'mj-link-pergunta', attrs: { role: 'alert' } });
    const sim = C.botao({ text: 'Abrir', class: 'mj-pri' });
    const nao = C.botao({ text: 'Cancelar', class: 'mj-fantasma' });
    const confirma = el('div', { class: 'mj-link-confirma' }, textoPergunta, el('div', { class: 'mj-barra' }, sim, nao));

    const cheio = el('div', { class: 'mj-link-cheio' },
      el('div', { class: 'mj-link-cabeca' }, titulo, el('div', { class: 'mj-link-meta' }, dominio, autor), resto),
      acoes, confirma);

    b.raiz.append(vazio, cheio);
    b.aviso.em(b.raiz);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (b.acao(form, { kind: 'set', url: campoUrl.value, title: campoTitulo.value })) {
        campoUrl.value = '';
        campoTitulo.value = '';
        trocando = false;
      }
    });
    cancelar.addEventListener('click', () => {
      trocando = false;
      desenhar();
      trocar.focus();
    });

    function fecharPergunta(foco) {
      pendente = null;
      confirma.hidden = true;
      cheio.classList.remove('is-confirmando');
      acoes.hidden = false;
      if (foco) abrir.focus();
    }

    b.clique(abrir, acoes, () => {
      if (!state.url) return;
      pendente = state.url;
      // O dominio em destaque: e ele que a pessoa confirma.
      textoPergunta.replaceChildren('Abrir ', el('strong', { text: state.host }), ' no seu navegador?');
      textoPergunta.setAttribute('aria-label', pergunta(state.host));
      acoes.hidden = true;
      confirma.hidden = false;
      cheio.classList.add('is-confirmando');
      sim.focus();
    });
    nao.addEventListener('click', () => fecharPergunta(true));
    confirma.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fecharPergunta(true);
      }
    });
    sim.addEventListener('click', () => {
      const url = pendente;
      fecharPergunta(true);
      if (!url || abrindo) return;
      if (!state || state.url !== url) {
        b.aviso.mostrar('O link mudou; confira antes de abrir', acoes);
        return;
      }
      abrindo = true;
      void abrirNoNavegador(root.golive, 'link', url).then((r) => {
        abrindo = false;
        if (r !== true) b.aviso.mostrar(r, acoes);
      });
    });
    b.clique(trocar, acoes, () => {
      trocando = true;
      campoUrl.value = state.url || '';
      campoTitulo.value = state.title || '';
      desenhar();
      campoUrl.focus();
      campoUrl.select();
    });
    b.clique(tirar, acoes, () => b.acao(acoes, { kind: 'clear' }));

    function desenhar() {
      const v = apresentar(state);
      const formAberto = !v || trocando;
      vazio.hidden = !formAberto;
      cheio.hidden = formAberto;
      cancelar.hidden = !v;
      if (!v) return;
      titulo.textContent = v.titulo;
      titulo.title = v.titulo;
      titulo.classList.toggle('is-dominio', !v.temTitulo);
      dominio.textContent = v.dominio;
      dominio.hidden = !v.temTitulo;
      autor.textContent = state.by ? `${v.temTitulo ? '· ' : ''}colado por ${C.nomeDe(api, state.by)}` : '';
      resto.textContent = v.resto;
      resto.title = v.resto;
      resto.hidden = !v.resto;
      abrir.title = `Abre ${v.dominio} no seu navegador`;
    }

    function update(novo) {
      const antes = state;
      state = novo;
      // A pergunta vale para o endereco de quando foi feita.
      if (pendente && (!antes || antes.url !== state.url)) fecharPergunta(false);
      if (!state.url) trocando = false;
      desenhar();
    }

    fecharPergunta(false);

    return {
      update,
      destroy: b.destruir,
      focus() { (state && state.url && !trocando ? abrir : campoUrl).focus(); },
    };
  }

  // ---------- Registro ----------
  // Igual aos outros conteudos: a Vista carrega so `mesa-janelas/link.js`;
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

  const api = { type: TYPE, mount, motivoAbrir, abrirNoNavegador, apresentar, pergunta, MOTIVOS_ABRIR };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

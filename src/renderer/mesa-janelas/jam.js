'use strict';

/*
 * Conteudo da janela "Spotify Jam" (contrato da Mesa, secao 6). O modulo
 * puro e `mesa-modules/jam.js`.
 *
 * - Sem Jam: como criar um (so quem tem Premium cria) e o campo do link.
 * - Com Jam: "Entrar no Jam" abre o link no Spotify/navegador DESTE PC,
 *   pela ponte do app (`golive.abrirLinkDaMesa('jam', url)`; o processo
 *   principal confere o formato de novo). "Entrei"/"Sai" marca a pessoa na
 *   lista, que mostra o nome de cada um na cor dela.
 *
 * Nada toca dentro do app: a musica e do Spotify de cada um.
 */

(function (root) {
  const TYPE = 'jam';

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  /** Motivo de recusa da ponte (`abrirLinkDaMesa`) -> frase curta. */
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

  /** "spotify.link" / "open.spotify.com" do link guardado ('' sem link). */
  function hostDoLink(link) {
    try {
      return link ? new URL(link).hostname : '';
    } catch {
      return '';
    }
  }

  function estouNoJam(state, me) {
    return !!state.link && state.joined.includes(String(me));
  }

  /** Quem entrou, na ordem em que entrou: `[{ id, nome }]`. */
  function pessoas(state, nomeDe) {
    return state.joined.map((id) => ({ id, nome: nomeDe(id) }));
  }

  /** Texto de cima da lista: "Ninguém marcou ainda" / "3 pessoas no Jam". */
  function contagem(n) {
    if (n === 0) return 'Ninguém marcou ainda';
    return n === 1 ? '1 pessoa no Jam' : `${n} pessoas no Jam`;
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let trocando = false;
    let listaChave = null;
    let abrindo = false;

    // Sem Jam (ou trocando): o passo a passo e o campo.
    const input = el('input', {
      class: 'mj-campo',
      attrs: {
        type: 'text', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
        placeholder: 'https://spotify.link/…', 'aria-label': 'Link do Jam', maxlength: String(m.MAX_INPUT),
      },
    });
    const por = C.botao({ text: 'Pôr', class: 'mj-pri' });
    por.type = 'submit';
    const cancelar = C.botao({ text: 'Cancelar', class: 'mj-fantasma' });
    const form = el('form', { class: 'mj-form' }, input, por, cancelar);
    const dica = el('p', { class: 'mj-dica', text: 'Quem tem Premium cria o Jam no Spotify (Conectar → Iniciar um Jam), copia o link de convite e cola aqui.' });
    const vazio = el('div', { class: 'mj-jam-vazio' }, el('p', { class: 'mj-jam-titulo', text: 'Ouvir junto no Spotify' }), dica, form);

    // Com Jam.
    const titulo = el('p', { class: 'mj-jam-titulo', text: 'Jam aberto' });
    const host = el('span', { class: 'mj-jam-host' });
    const autor = el('span', { class: 'mj-jam-autor' });
    const cabeca = el('div', { class: 'mj-jam-cabeca' }, titulo, el('div', { class: 'mj-jam-meta' }, host, autor));
    const entrar = C.botao({ text: 'Entrar no Jam', class: 'mj-pri mj-jam-entrar', title: 'Abre o link no Spotify deste PC' });
    const marcar = C.botao({ icone: 'check', text: 'Entrei' });
    const acoes = el('div', { class: 'mj-barra mj-jam-acoes' }, entrar, marcar);
    const conta = el('p', { class: 'mj-rotulo' });
    const lista = el('ul', { class: 'mj-jam-lista mj-rola', attrs: { 'aria-label': 'Quem entrou no Jam' } });
    const trocar = C.botao({ text: 'Trocar', class: 'mj-fantasma', label: 'Trocar o link do Jam' });
    const tirar = C.botao({ text: 'Tirar', class: 'mj-fantasma', label: 'Tirar o Jam da janela' });
    const rodape = el('div', { class: 'mj-barra mj-jam-rodape' }, el('span', { class: 'mj-mola' }), trocar, tirar);
    const cheio = el('div', { class: 'mj-jam-cheio' }, cabeca, acoes, conta, lista, rodape);

    b.raiz.append(vazio, cheio);
    b.aviso.em(b.raiz);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (b.acao(form, { kind: 'set', url: input.value })) {
        input.value = '';
        trocando = false;
      }
    });
    cancelar.addEventListener('click', () => {
      trocando = false;
      input.value = '';
      desenhar();
      trocar.focus();
    });
    b.clique(entrar, acoes, () => {
      if (abrindo || !state.link) return;
      abrindo = true;
      void abrirNoNavegador(root.golive, 'jam', state.link).then((r) => {
        abrindo = false;
        if (r !== true) b.aviso.mostrar(r, acoes);
        else if (!estouNoJam(state, api.me())) b.aviso.mostrar('Entrou? Marque “Entrei” para a sala ver', acoes);
      });
    });
    b.clique(marcar, acoes, () => {
      b.acao(acoes, { kind: estouNoJam(state, api.me()) ? 'leave' : 'join' });
    });
    b.clique(trocar, rodape, () => {
      trocando = true;
      desenhar();
      input.focus();
    });
    b.clique(tirar, rodape, () => b.acao(rodape, { kind: 'clear' }));

    function desenharLista() {
      const chave = state.joined.join(',');
      if (chave === listaChave) return;
      listaChave = chave;
      const ps = pessoas(state, (id) => C.nomeDe(api, id));
      lista.replaceChildren(...ps.map((p) => {
        const cor = C.corDe(api, p.id);
        const li = el('li', { class: cor ? 'is-pessoa' : '' }, C.bolinha(cor), el('span', { text: p.nome }));
        if (cor) li.style.setProperty('--mj-cor', cor);
        return li;
      }));
      if (!ps.length) lista.append(el('li', { class: 'mj-dica', text: 'Quem entrar clica em “Entrei”.' }));
      conta.textContent = contagem(ps.length);
    }

    function desenhar() {
      const temJam = !!state.link;
      const formAberto = !temJam || trocando;
      vazio.hidden = !formAberto;
      cheio.hidden = formAberto;
      cancelar.hidden = !temJam;
      if (!temJam) return;
      host.textContent = hostDoLink(state.link);
      autor.textContent = state.by ? `· colado por ${C.nomeDe(api, state.by)}` : '';
      const dentro = estouNoJam(state, api.me());
      marcar.querySelector('span').textContent = dentro ? 'Saí' : 'Entrei';
      marcar.classList.toggle('is-on', dentro);
      marcar.setAttribute('aria-pressed', dentro ? 'true' : 'false');
      C.ligado(marcar, C.podeFazer(api, { kind: dentro ? 'leave' : 'join' }), dentro ? 'Sair da lista' : 'Marcar que entrou no Jam');
      desenharLista();
    }

    function update(novo) {
      const antes = state;
      state = novo;
      // Jam trocado por outra pessoa enquanto este PC digitava: o campo fica.
      if (antes && antes.link !== state.link && !state.link) trocando = false;
      desenhar();
    }

    return {
      update,
      destroy: b.destruir,
      focus() { (state && state.link && !trocando ? entrar : input).focus(); },
    };
  }

  // ---------- Registro ----------
  // Igual aos outros conteudos: a Vista carrega so `mesa-janelas/jam.js`; o
  // apoio (comum.js) vem daqui, uma vez, da mesma pasta.
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

  const api = { type: TYPE, mount, motivoAbrir, abrirNoNavegador, hostDoLink, estouNoJam, pessoas, contagem, MOTIVOS_ABRIR };

  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

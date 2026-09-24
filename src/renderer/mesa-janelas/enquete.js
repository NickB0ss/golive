'use strict';
/* global module */

/*
 * Conteudo da janela "Enquete" (contrato da Mesa, secao 6). O modulo puro
 * e `mesa-modules/enquete.js`: um voto por pessoa, quem criou ou o lider
 * edita (so antes do primeiro voto), encerra e zera.
 *
 * Cada opcao e um botao: clicar vota; clicar de novo no proprio voto tira.
 * A barra atras do texto e a fatia dos votos (anima so por transform), e
 * as bolinhas sao de quem votou, na cor de cada pessoa.
 *
 * Editar e local ate "Publicar": o formulario e um rascunho que nenhuma
 * versao nova apaga enquanto a pessoa esta nele.
 */

(function (root) {
  const TYPE = 'enquete';
  const MAX_BOLINHAS = 6;

  function mod() {
    return root.GoLive.mesaModules[TYPE];
  }

  // ---------- Puras ----------

  /** Uma linha por opcao: contagem, fatia do total, se e o meu voto, se
   * esta na frente, e quem votou nela (na ordem dos votos). */
  function barras(m, state, me) {
    const counts = m.tally(state);
    const total = counts.reduce((s, n) => s + n, 0);
    const max = Math.max(0, ...counts);
    const meu = me === null || me === undefined ? null : m.voteOf(state, me);
    return state.options.map((texto, i) => ({
      texto,
      n: counts[i],
      frac: total ? counts[i] / total : 0,
      meu: meu === i,
      frente: max > 0 && counts[i] === max,
      votantes: state.votes.filter((v) => v.option === i).map((v) => v.by),
    }));
  }

  function rotuloOpcao(b, fechada) {
    const votos = `${b.n} ${b.n === 1 ? 'voto' : 'votos'}`;
    let s = `${b.texto}: ${votos}`;
    if (b.meu) s += fechada ? '. Seu voto' : '. Seu voto; clique para tirar';
    return s;
  }

  /** Clicar numa opcao: vota, ou tira o voto se ja era a minha. */
  function acaoVoto(m, state, me, i) {
    return m.voteOf(state, me) === i ? { kind: 'unvote' } : { kind: 'vote', option: i };
  }

  function textoTotal(state) {
    const n = state.votes.length;
    const base = n === 0 ? 'Ninguém votou ainda' : `${n} ${n === 1 ? 'voto' : 'votos'}`;
    return state.closed ? `${base} · encerrada` : base;
  }

  /** Bolinhas visiveis e o "+N" do resto. */
  function bolinhas(votantes, max) {
    const lim = max || MAX_BOLINHAS;
    if (votantes.length <= lim) return { mostrar: votantes.slice(), resto: 0 };
    return { mostrar: votantes.slice(0, lim - 1), resto: votantes.length - (lim - 1) };
  }

  // ---------- DOM ----------

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const m = mod();
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let editando = false;
    let mexeu = false; // digitou no rascunho desde que abriu

    // ----- Vista de votar -----
    const votar = el('div', { class: 'mj-enq-votar' });
    const pergunta = el('h3', { class: 'mj-enq-pergunta' });
    const lista = el('ul', { class: 'mj-enq-opcoes mj-rola', attrs: { 'aria-label': 'Opções' } });
    const total = el('span', { class: 'mj-enq-total' });
    const editar = C.botao({ icone: 'lapis', class: 'mj-ic mj-fantasma', label: 'Editar a enquete' });
    const encerrar = C.botao({ text: 'Encerrar', class: 'mj-fantasma' });
    const zerar = C.botao({ icone: 'zerar', class: 'mj-ic mj-fantasma', label: 'Zerar os votos' });
    const gestao = el('span', { class: 'mj-enq-gestao' }, editar, encerrar, zerar);
    const rodape = el('div', { class: 'mj-barra mj-enq-rodape' }, total, el('span', { class: 'mj-mola' }), gestao);
    votar.append(pergunta, lista, rodape);

    b.clique(editar, rodape, () => {
      const ok = C.podeFazer(api, { kind: 'edit', question: state.question || 'x', options: state.options });
      if (ok !== true) return b.aviso.mostrar(ok, rodape);
      abrirEdicao();
    });
    b.clique(encerrar, rodape, () => b.acao(rodape, { kind: 'close' }));
    b.clique(zerar, rodape, () => b.acao(rodape, { kind: 'reset' }));

    const nosOpcao = []; // { li, btn, fundo, texto, conta, quem }

    function criarOpcao(i) {
      const fundo = el('span', { class: 'mj-enq-fundo', attrs: { 'aria-hidden': 'true' } });
      const texto = el('span', { class: 'mj-enq-texto' });
      const quem = el('span', { class: 'mj-enq-quem', attrs: { 'aria-hidden': 'true' } });
      const conta = el('span', { class: 'mj-enq-conta', attrs: { 'aria-hidden': 'true' } });
      const marca = el('span', { class: 'mj-enq-marca', attrs: { 'aria-hidden': 'true' } }, C.icone('check'));
      const btn = el('button', { class: 'mj-enq-opcao', attrs: { type: 'button', 'aria-pressed': 'false' } }, fundo, marca, texto, quem, conta);
      const li = el('li', null, btn);
      const no = { li, btn, fundo, texto, conta, quem, i, chaveQuem: '' };
      btn.addEventListener('click', () => {
        if (C.estaDesligado(btn)) return b.aviso.mostrar(btn.title || 'Indisponível', li);
        b.acao(li, acaoVoto(m, state, api.me(), no.i));
      });
      return no;
    }

    function desenharOpcoes() {
      const bs = barras(m, state, api.me());
      while (nosOpcao.length < bs.length) {
        const no = criarOpcao(nosOpcao.length);
        nosOpcao.push(no);
        lista.append(no.li);
      }
      while (nosOpcao.length > bs.length) nosOpcao.pop().li.remove();
      bs.forEach((x, i) => {
        const no = nosOpcao[i];
        if (no.texto.textContent !== x.texto) no.texto.textContent = x.texto;
        no.conta.textContent = String(x.n);
        no.fundo.style.transform = `scaleX(${x.frac})`;
        no.btn.setAttribute('aria-pressed', String(x.meu));
        no.btn.setAttribute('aria-label', rotuloOpcao(x, state.closed));
        no.btn.classList.toggle('is-frente', x.frente && (state.closed || state.votes.length > 0));
        const acao = acaoVoto(m, state, api.me(), i);
        C.ligado(no.btn, C.podeFazer(api, acao), '');
        const chave = x.votantes.join(',');
        if (chave !== no.chaveQuem) {
          no.chaveQuem = chave;
          const bl = bolinhas(x.votantes);
          no.quem.replaceChildren(...bl.mostrar.map((id) => C.bolinha(C.corDe(api, id), C.nomeDe(api, id))));
          if (bl.resto) no.quem.append(el('span', { class: 'mj-enq-mais', text: `+${bl.resto}` }));
        }
      });
    }

    // ----- Vista de editar (rascunho local) -----
    const form = el('form', { class: 'mj-enq-form mj-rola' });
    const campoPergunta = el('input', {
      class: 'mj-campo',
      attrs: { type: 'text', maxlength: String(m.MAX_QUESTION), placeholder: 'Pergunta', 'aria-label': 'Pergunta', spellcheck: 'false' },
    });
    const listaEd = el('ol', { class: 'mj-enq-ed' });
    const addOpcao = C.botao({ icone: 'mais', text: 'Opção', class: 'mj-fantasma', label: 'Adicionar opção' });
    const cancelar = C.botao({ text: 'Cancelar', class: 'mj-fantasma' });
    const publicar = el('button', { class: 'mj-btn mj-pri', text: 'Publicar', attrs: { type: 'submit' } });
    const barraForm = el('div', { class: 'mj-barra' }, addOpcao, el('span', { class: 'mj-mola' }), cancelar, publicar);
    const esperando = el('p', { class: 'mj-dica mj-enq-espera' });
    form.append(el('p', { class: 'mj-rotulo', text: 'Nova enquete' }), campoPergunta, listaEd, barraForm);

    function linhaOpcao(valor) {
      const inp = el('input', {
        class: 'mj-campo',
        attrs: { type: 'text', maxlength: String(m.MAX_OPTION), placeholder: 'Opção', spellcheck: 'false' },
      });
      inp.value = valor;
      const x = C.botao({ icone: 'x', class: 'mj-ic mj-fantasma', label: 'Tirar esta opção' });
      const li = el('li', { class: 'mj-form' }, inp, x);
      x.addEventListener('click', () => {
        if (listaEd.children.length <= m.MIN_OPTIONS) return;
        const prox = li.nextElementSibling || li.previousElementSibling;
        li.remove();
        renumerar();
        if (prox) prox.querySelector('input').focus();
      });
      return li;
    }

    function renumerar() {
      [...listaEd.children].forEach((li, i) => {
        li.querySelector('input').setAttribute('aria-label', `Opção ${i + 1}`);
        C.ligado(li.querySelector('button'), listaEd.children.length > m.MIN_OPTIONS ? true : `Pelo menos ${m.MIN_OPTIONS} opções`, 'Tirar esta opção');
      });
      C.ligado(addOpcao, listaEd.children.length < m.MAX_OPTIONS ? true : `No máximo ${m.MAX_OPTIONS} opções`, 'Adicionar opção');
    }

    b.clique(addOpcao, barraForm, () => {
      const li = linhaOpcao('');
      listaEd.append(li);
      renumerar();
      li.querySelector('input').focus();
    });
    cancelar.addEventListener('click', () => fecharEdicao());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const action = {
        kind: 'edit',
        question: campoPergunta.value,
        options: [...listaEd.querySelectorAll('input')].map((i) => i.value),
      };
      if (b.acao(barraForm, action)) fecharEdicao(true);
    });

    form.addEventListener('input', () => { mexeu = true; });

    function abrirEdicao() {
      editando = true;
      mexeu = false;
      campoPergunta.value = state.question;
      listaEd.replaceChildren(...state.options.map((o) => linhaOpcao(o)));
      renumerar();
      mostrar();
      campoPergunta.focus();
    }

    function fecharEdicao(publicou) {
      editando = false;
      mostrar();
      if (!publicou && state.question) editar.focus();
    }

    b.raiz.append(votar, form, esperando);

    function podeGerir() {
      return C.podeFazer(api, { kind: 'reset' }) === true;
    }

    function mostrar() {
      const semPergunta = !state.question;
      const gerir = podeGerir();
      // Sem pergunta, quem pode ja cai no formulario (rascunho novo).
      if (semPergunta && gerir && !editando) {
        editando = true;
        mexeu = false;
        campoPergunta.value = '';
        listaEd.replaceChildren(...state.options.map((o) => linhaOpcao(o)));
        renumerar();
      }
      form.hidden = !editando;
      cancelar.hidden = semPergunta;
      votar.hidden = editando || semPergunta;
      esperando.hidden = editando || !semPergunta;
      if (!esperando.hidden) {
        const quem = state.createdBy ? C.nomeDe(api, state.createdBy) : 'o líder da sala';
        esperando.textContent = `Esperando ${quem} escrever a pergunta.`;
      }
    }

    function update(novo) {
      state = novo;
      pergunta.textContent = state.question;
      desenharOpcoes();
      total.textContent = textoTotal(state);
      const gerir = podeGerir();
      gestao.hidden = !gerir;
      if (gerir) {
        C.ligado(editar, C.podeFazer(api, { kind: 'edit', question: state.question || 'x', options: state.options }), 'Editar a enquete');
        C.ligado(encerrar, C.podeFazer(api, { kind: 'close' }), 'Encerrar a votação');
        C.ligado(zerar, state.votes.length || state.closed ? true : 'Não há votos', 'Zerar os votos');
      }
      b.raiz.classList.toggle('is-fechada', state.closed);
      // Outra pessoa publicou enquanto o rascunho estava aberto e intocado:
      // fecha. Se eu ja tinha digitado, o rascunho fica e o aviso explica.
      if (editando && state.question && !mexeu && !form.contains(root.document.activeElement)) {
        editando = false;
      } else if (editando && state.votes.length > 0 && state.question) {
        b.aviso.mostrar('Já tem voto; zere para editar', barraForm);
      }
      mostrar();
    }

    return { update, destroy: b.destruir, focus() { (editando ? campoPergunta : nosOpcao[0] && nosOpcao[0].btn)?.focus(); } };
  }

  const api = { type: TYPE, mount, barras, rotuloOpcao, acaoVoto, textoTotal, bolinhas, MAX_BOLINHAS };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaJanelas = root.GoLive.mesaJanelas || {};
  root.GoLive.mesaJanelas[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

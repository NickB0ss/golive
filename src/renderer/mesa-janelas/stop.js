'use strict';

/* Conteudo da janela Stop. Durante a escrita so monta os campos da propria
 * pessoa: as respostas alheias nunca chegam nesta vista secret. Na correcao
 * mostra respostas, pontos e os votos de anulacao em tempo real. */
(function (root) {
  const TYPE = 'stop';

  function tempo(deadline, now) {
    const seconds = Math.max(0, Math.ceil((Number(deadline) - Number(now)) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function linhas(state) {
    const votes = new Map((state.votes || []).map((v) => [`${v.player}:${v.category}`, v]));
    const points = new Map((state.points || []).map((p) => [`${p.player}:${p.category}`, p.points]));
    const out = [];
    for (const player of state.players || []) {
      for (let category = 0; category < (state.categories || []).length; category++) {
        const vote = votes.get(`${player}:${category}`) || { yes: 0, no: 0 };
        out.push({
          player,
          name: state.names?.[player] || player,
          category,
          answer: state.answers?.[player]?.[category] || '—',
          yes: vote.yes,
          no: vote.no,
          points: points.get(`${player}:${category}`) || 0,
        });
      }
    }
    return out;
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let timer = null;
    let page = 0;
    const head = el('div', { class: 'mj-stop-head' });
    const letter = el('strong', { class: 'mj-stop-letter' });
    const clock = el('span', { class: 'mj-stop-clock' });
    const body = el('div', { class: 'mj-stop-body' });
    const footer = el('div', { class: 'mj-barra mj-stop-footer' });
    b.raiz.append(head, body, footer);

    function action(where, a) { b.acao(where, a); }
    function button(text, a, cls = 'mj-fantasma') {
      const btn = C.botao({ text, class: cls });
      btn.addEventListener('click', () => action(footer, a));
      return btn;
    }

    function drawSetup() {
      const form = el('form', { class: 'mj-stop-categories' });
      const title = el('p', { class: 'mj-dica', text: 'Categorias da próxima rodada' });
      const list = el('div', { class: 'mj-stop-category-list' });
      state.categories.forEach((value, i) => {
        const input = el('input', {
          class: 'mj-campo',
          attrs: { maxlength: '32', type: 'text', 'aria-label': `Categoria ${i + 1}` },
        });
        input.value = value;
        list.append(input);
      });
      const start = el('button', { class: 'mj-btn mj-pri', text: 'Começar rodada', attrs: { type: 'submit' } });
      form.append(title, list, start);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (state.me?.canManage || api.isLeader()) {
          action(form, { kind: 'categories', categories: [...list.querySelectorAll('input')].map((i) => i.value) });
          action(form, { kind: 'start' });
        }
      });
      body.replaceChildren(form);
      footer.replaceChildren();
      C.ligado(start, state.me?.canManage || api.isLeader() ? true : 'Só quem gere a janela começa');
    }

    function drawWriting() {
      const form = el('form', { class: 'mj-stop-answers' });
      const title = el('p', { class: 'mj-dica', text: 'Suas respostas ficam escondidas até o STOP.' });
      const inputs = state.categories.map((category, i) => {
        const input = el('input', {
          class: 'mj-campo',
          attrs: { maxlength: '40', type: 'text', placeholder: category, 'aria-label': category },
        });
        input.value = state.myAnswers?.[i] || '';
        return input;
      });
      const save = el('button', { class: 'mj-btn', text: 'Guardar respostas', attrs: { type: 'submit' } });
      form.append(title, ...inputs, save);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        action(form, { kind: 'answer', answers: inputs.map((i) => i.value) });
      });
      body.replaceChildren(form);
      const stop = button('STOP', { kind: 'stop' }, 'mj-pri');
      const count = Object.values(state.answered || {}).filter(Boolean).length;
      footer.replaceChildren(
        el('span', { class: 'mj-dica', text: `${count}/${state.players.length} responderam` }),
        el('span', { class: 'mj-mola' }),
        stop,
      );
      C.ligado(stop, Array.isArray(state.myAnswers) && state.myAnswers.length === state.categories.length
        && state.myAnswers.every(Boolean) ? true : 'Preencha todas as respostas');
    }

    function drawReview() {
      const table = el('div', { class: 'mj-stop-review', attrs: { role: 'table' } });
      const allRows = linhas(state);
      const perPage = 6;
      const pages = Math.max(1, Math.ceil(allRows.length / perPage));
      page = Math.min(page, pages - 1);
      for (const row of allRows.slice(page * perPage, (page + 1) * perPage)) {
        const yes = C.botao({ text: `Anular ${row.yes}`, class: 'mj-fantasma' });
        const no = C.botao({ text: `Manter ${row.no}`, class: 'mj-fantasma' });
        yes.addEventListener('click', () => {
          action(table, { kind: 'vote', player: row.player, category: row.category, annul: true });
        });
        no.addEventListener('click', () => {
          action(table, { kind: 'vote', player: row.player, category: row.category, annul: false });
        });
        table.append(el('div', { class: 'mj-stop-row' },
          el('span', { class: 'mj-stop-name', text: `${row.name} · ${state.categories[row.category]}` }),
          el('span', { class: 'mj-stop-answer', text: row.answer }), yes, no,
          el('strong', { text: `${row.points} pts` })));
      }
      body.replaceChildren(table);
      const finish = button('Somar e próxima rodada', { kind: 'finish' }, 'mj-pri');
      const previous = C.botao({ text: '‹', class: 'mj-fantasma', label: 'Página anterior' });
      const next = C.botao({ text: '›', class: 'mj-fantasma', label: 'Próxima página' });
      previous.addEventListener('click', () => { page = Math.max(0, page - 1); drawReview(); });
      next.addEventListener('click', () => { page = Math.min(pages - 1, page + 1); drawReview(); });
      footer.replaceChildren(previous, el('span', { class: 'mj-dica', text: `${page + 1}/${pages}` }), next,
        el('span', { class: 'mj-mola' }), finish);
      C.ligado(previous, page > 0 ? true : 'Primeira página');
      C.ligado(next, page < pages - 1 ? true : 'Última página');
      C.ligado(finish, state.me?.canManage || api.isLeader() ? true : 'Só quem gere a janela encerra a correção');
    }

    function render() {
      head.replaceChildren(
        el('span', { class: 'mj-dica', text: state.phase === 'setup' ? 'Stop' : 'Letra' }),
        letter,
        el('span', { class: 'mj-mola' }),
        clock);
      letter.textContent = state.letter || '—';
      clock.textContent = state.deadline ? tempo(state.deadline, api.serverNow()) : '';
      if (state.phase === 'setup') drawSetup();
      else if (state.phase === 'writing') drawWriting();
      else drawReview();
    }

    function update(next) {
      state = next;
      if (state.phase !== 'review') page = 0;
      render();
      if (timer) root.clearInterval(timer);
      if (state.deadline) {
        timer = root.setInterval(() => {
          if (api.serverNow() >= state.deadline) api.act({ kind: 'timeout' });
          else clock.textContent = tempo(state.deadline, api.serverNow());
        }, 500);
      }
    }
    return { update, destroy() { if (timer) root.clearInterval(timer); b.destruir(); } };
  }

  const api = { type: TYPE, mount, tempo, linhas };
  function registrar() {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    if (G.mesaJanelasComum || !root.document) {
      G.mesaJanelas[TYPE] = api;
      return;
    }
    const base = (root.document.currentScript && root.document.currentScript.src) || root.document.baseURI;
    const script = root.document.createElement('script');
    script.src = new root.URL('comum.js', base).href;
    script.async = false;
    script.addEventListener('load', () => { G.mesaJanelas[TYPE] = api; }, { once: true });
    root.document.head.appendChild(script);
  }
  registrar();
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

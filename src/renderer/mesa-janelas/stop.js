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

  function textoBarra(state) {
    if (state.phase === 'writing') return `Letra ${state.letter || '—'} · escrevendo`;
    if (state.phase === 'review') return 'Corrigindo respostas';
    return 'Prepare as categorias';
  }

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const b = C.base(elRoot, api, TYPE);
    const { el } = C;
    let state = null;
    let timer = null;
    let saveTimer = null;
    let roundKey = null;
    let timeoutSent = false;
    let lastTimeoutAt = null;
    let inputs = [];
    let lastSent = null;
    const drafts = new Map();
    let page = 0;
    const head = el('div', { class: 'mj-stop-head' });
    const letter = el('strong', { class: 'mj-stop-letter' });
    const clock = el('span', { class: 'mj-stop-clock' });
    const body = el('div', { class: 'mj-stop-body' });
    const footer = el('div', { class: 'mj-barra mj-stop-footer' });
    const count = el('span', { class: 'mj-dica' });
    const status = el('span', { class: 'mj-dica' });
    const stop = C.botao({ text: 'STOP', class: 'mj-pri' });
    b.raiz.append(head, body, footer);

    function action(where, a) { b.acao(where, a); }
    function button(text, a, cls = 'mj-fantasma') {
      const btn = C.botao({ text, class: cls });
      btn.addEventListener('click', () => action(footer, a));
      return btn;
    }

    stop.addEventListener('click', () => {
      cancelarSalvamento();
      // makeApi encaminha deps.send sincronicamente; estas acoes preservam a ordem no canal.
      if (salvarAgora() || JSON.stringify(respostasLocais()) === lastSent) action(footer, { kind: 'stop' });
    });

    if (typeof api.onDenied === 'function') {
      const offDenied = api.onDenied((d) => {
        if (d?.reason !== 'rate' || state?.phase !== 'writing') return;
        lastSent = null;
        agendarSalvamento();
      });
      if (typeof offDenied === 'function') b.faxina.push(offDenied);
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
      // "Começar rodada" e a acao principal e mora no rodape (C.acoes), fora do form:
      // o Enter nos campos faz o mesmo que o clique.
      const start = C.botao({ text: 'Começar rodada' });
      function comecar() {
        if (state.me?.canManage || api.isLeader()) {
          action(form, { kind: 'categories', categories: [...list.querySelectorAll('input')].map((i) => i.value) });
          action(form, { kind: 'start' });
        }
      }
      for (const input of list.querySelectorAll('input')) {
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          comecar();
        });
      }
      start.addEventListener('click', comecar);
      form.append(title, list);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        comecar();
      });
      body.replaceChildren(form);
      footer.replaceChildren(C.acoes({ principal: start }));
      C.ligado(start, state.me?.canManage || api.isLeader() ? true : 'Só quem gere a janela começa');
    }

    function chaveRodada(next) {
      return JSON.stringify([next.letter || '', next.deadline || null, next.categories || []]);
    }

    function respostasLocais() {
      return inputs.map((input) => input.value);
    }

    function guardarRascunho() {
      if (roundKey) drafts.set(roundKey, respostasLocais());
    }

    function cancelarSalvamento() {
      if (saveTimer) root.clearTimeout(saveTimer);
      saveTimer = null;
    }

    // O servidor guarda a resposta ja limpa (mesa-modules/stop.js#text: espacos juntados e aparados);
    // comparar cru deixaria "Salvando…" para sempre em "Ana ".
    function limpa(answer) {
      return String(answer || '').replace(/\s+/gu, ' ').trim();
    }

    function confirmadas() {
      const local = respostasLocais();
      const remoto = state.myAnswers || [];
      return local.length === remoto.length && local.every((answer, i) => limpa(answer) === limpa(remoto[i]));
    }

    function salvarAgora() {
      cancelarSalvamento();
      if (state.phase !== 'writing') return false;
      const answers = respostasLocais();
      guardarRascunho();
      const serial = JSON.stringify(answers);
      if (serial === lastSent) {
        atualizarRodape();
        return false;
      }
      lastSent = serial;
      action(footer, { kind: 'answer', answers });
      atualizarRodape();
      return true;
    }

    function agendarSalvamento() {
      cancelarSalvamento();
      guardarRascunho();
      // Mesa aceita 20 acoes/s; 400 ms limita este autosave a no maximo 2,5/s.
      saveTimer = root.setTimeout(() => {
        saveTimer = null;
        salvarAgora();
      }, 400);
      atualizarRodape();
    }

    function atualizarRodape() {
      if (state.phase !== 'writing') return;
      const responded = Object.values(state.answered || {}).filter(Boolean).length;
      count.textContent = `${responded}/${state.players.length} responderam`;
      status.textContent = confirmadas() ? 'Salvo' : 'Salvando…';
      const allFilled = respostasLocais().every((answer) => answer.trim());
      C.ligado(stop, allFilled ? true : 'Preencha todas as respostas');
    }

    function drawWriting() {
      const form = el('form', { class: 'mj-stop-answers' });
      const title = el('p', {
        class: 'mj-dica',
        text: 'Suas respostas ficam escondidas até o STOP e são salvas sozinhas.',
      });
      const draft = drafts.get(roundKey) || state.myAnswers || [];
      inputs = state.categories.map((category, i) => {
        const input = el('input', {
          class: 'mj-campo',
          attrs: { maxlength: '40', type: 'text', placeholder: category, 'aria-label': category },
        });
        input.value = draft[i] || '';
        input.addEventListener('input', agendarSalvamento);
        input.addEventListener('blur', salvarAgora);
        input.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          salvarAgora();
          inputs[i + 1]?.focus();
        });
        return input;
      });
      // Cada categoria e uma linha de caderno: o nome a esquerda e o traco para escrever.
      const linhas = inputs.map((input, i) => el('label', { class: 'mj-stop-linha' },
        el('span', { class: 'mj-stop-rotulo', text: state.categories[i] }), input));
      form.append(title, ...linhas);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        salvarAgora();
      });
      body.replaceChildren(form);
      footer.replaceChildren(count, status, el('span', { class: 'mj-mola' }), stop);
      atualizarRodape();
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
      // Na preparacao nao ha letra: o alto some (o nome do jogo ja esta na barra da janela).
      head.hidden = state.phase === 'setup';
      head.replaceChildren(
        el('span', { class: 'mj-dica', text: 'Letra' }),
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
      const nextRound = next.phase === 'writing' ? chaveRodada(next) : null;
      const remount = state === null || state.phase !== next.phase || nextRound !== roundKey;
      if (state?.phase === 'writing' && (next.phase !== 'writing' || nextRound !== roundKey)) {
        cancelarSalvamento();
      }
      state = next;
      atualizarBarra(api, textoBarra(state), Boolean(state.phase === 'writing' && state.me?.canStop));
      if (state.phase !== 'review') page = 0;
      if (state.phase === 'writing') {
        if (remount) {
          roundKey = nextRound;
          lastSent = null;
          timeoutSent = false;
          lastTimeoutAt = null;
          render();
        } else {
          letter.textContent = state.letter || '—';
          clock.textContent = state.deadline ? tempo(state.deadline, api.serverNow()) : '';
          atualizarRodape();
        }
      } else {
        roundKey = null;
        inputs = [];
        timeoutSent = false;
        lastTimeoutAt = null;
        render();
      }
      if (timer) root.clearInterval(timer);
      if (state.deadline) {
        timer = root.setInterval(() => {
          const agora = api.serverNow();
          if (state.phase === 'writing' && agora >= state.deadline) {
            if (!timeoutSent) {
              timeoutSent = true;
              salvarAgora();
            }
            if (lastTimeoutAt === null || agora - lastTimeoutAt >= 1000) {
              lastTimeoutAt = agora;
              action(footer, { kind: 'timeout' });
            }
          } else clock.textContent = tempo(state.deadline, agora);
        }, 500);
      }
    }
    return {
      update,
      destroy() {
        if (timer) root.clearInterval(timer);
        if (state?.phase === 'writing' && saveTimer) salvarAgora();
        cancelarSalvamento();
        atualizarBarra(api, '', false);
        b.destruir();
      },
    };
  }

  const api = { type: TYPE, mount, tempo, linhas, textoBarra, atualizarBarra };
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

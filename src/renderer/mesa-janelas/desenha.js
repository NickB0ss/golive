'use strict';

/*
 * Conteudo da janela "Desenha e adivinha" (contrato da Mesa, secoes 6, 7,
 * 8 e 10). Jogo `secret`: este conteudo so recebe a `view` do servidor
 * (mesa-modules/desenha.js) -- a palavra e os palpites certos de quem
 * ainda nao acertou nunca chegam aqui.
 *
 * O desenho em si e o MESMO canal do rabisco das janelas Quadro
 * (`api.sendAnnotate`/`api.annotateSurface`, `annotateOp`/`annotateSync`/
 * `annotateSnapshot`): so muda que o servidor so aceita traco de quem esta
 * desenhando (`canAnnotateDraw` no modulo), entao aqui a caneta so aparece
 * pra quem tem `state.me.isDrawer`. A troca de rodada nao manda `clear`
 * nenhum: o campo `state.round` muda, e e ISSO que diz ao conteudo "comeca
 * uma folha em branco" (cada cliente limpa o proprio deposito local
 * sozinho, sem nada no fio).
 */

(function (root) {
  const TYPE = 'desenha';
  const LOCAL = 'desenha-local';
  const PEN_WIDTH = 4;
  const FOLGA_NAO_DESENHISTA_MS = 0; // quem adivinha manda o timeout na hora
  const FOLGA_DESENHISTA_MS = 3000; // o desenhista espera, dando chance ao resto
  const REPETE_MS = 2000;

  function atualizarBarra(api, texto, vez) {
    api.setStatus?.(texto);
    api.setTurn?.(vez);
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const A = root.GoLive.annotate;
    const { el } = C;
    const b = C.base(elRoot, api, TYPE);
    const store = A.createStore();

    let state = null;
    let rodadaLocal = -1; // ultima `state.round` que ja limpou o proprio desenho
    let ultimoEventoSeq = -1; // ultimo `lastEvent.seq` ja mostrado no aviso

    // ---------- topo: fase, relogio, placar compacto ----------

    const status = el('p', { class: 'mj-ds-status', attrs: { role: 'status' } });
    const relogio = el('span', { class: 'mj-ds-relogio', attrs: { 'aria-hidden': 'true' } });
    const topo = el('div', { class: 'mj-ds-topo' }, status, el('span', { class: 'mj-mola' }), relogio);
    b.raiz.append(topo);

    const placar = el('ul', { class: 'mj-ds-placar', attrs: { 'aria-label': 'Placar' } });
    b.raiz.append(placar);

    // ---------- lobby ----------

    const btEntrar = C.botao({ text: 'Entrar na rodada', class: 'mj-pri' });
    const btSair = C.botao({ text: 'Sair da rodada' });
    const btComecar = C.botao({ text: 'Começar', class: 'mj-pri' });
    const secLobby = el('div', { class: 'mj-ds-lobby' },
      el('p', { class: 'mj-dica', text: 'Quem entrar participa do rodízio de quem desenha.' }),
      el('div', { class: 'mj-barra' }, btEntrar, btSair, el('span', { class: 'mj-mola' }), btComecar));
    b.raiz.append(secLobby);
    b.clique(btEntrar, secLobby, () => b.acao(secLobby, { kind: 'join' }));
    b.clique(btSair, secLobby, () => b.acao(secLobby, { kind: 'leave' }));
    b.clique(btComecar, secLobby, () => b.acao(secLobby, { kind: 'start' }));

    // ---------- escolhendo a palavra ----------

    const opcoesBtns = [0, 1, 2].map(() => el('button', { class: 'mj-btn mj-ds-opcao', attrs: { type: 'button' } }));
    const secEscolhendo = el('div', { class: 'mj-ds-escolhendo' },
      el('p', { class: 'mj-rotulo', text: 'Escolha uma palavra' }),
      el('div', { class: 'mj-ds-opcoes' }, ...opcoesBtns));
    b.raiz.append(secEscolhendo);
    opcoesBtns.forEach((btn, i) => b.clique(btn, secEscolhendo, () => b.acao(secEscolhendo, { kind: 'choose', index: i })));

    // ---------- desenhando: palavra/dica + tela + palpite ----------

    const palavraLinha = el('p', { class: 'mj-ds-palavra', attrs: { 'aria-live': 'polite' } });
    const palco = el('div', { class: 'mj-ds-palco' });
    const canvas = el('canvas', { class: 'mj-ds-canvas' });
    palco.append(canvas);
    palco.addEventListener('pointerdown', (e) => e.stopPropagation());

    const campoPalpite = el('input', { class: 'mj-campo mj-ds-campo', attrs: { type: 'text', placeholder: 'seu palpite...', maxlength: '40' } });
    // C.botao() poe type="button" por padrao (o objeto do meio, sem isto o
    // clique nao confirma o form nenhum -- so o Enter no campo submetia).
    const btPalpite = C.botao({ text: 'Enviar', class: 'mj-pri', attrs: { type: 'submit' } });
    const formPalpite = el('form', { class: 'mj-form mj-ds-palpite' }, campoPalpite, btPalpite);
    const secDesenhando = el('div', { class: 'mj-ds-desenhando' }, palavraLinha, palco, formPalpite);
    b.raiz.append(secDesenhando);
    formPalpite.addEventListener('submit', (e) => {
      e.preventDefault();
      const texto = campoPalpite.value.trim();
      if (!texto) return;
      const ok = b.acao(formPalpite, { kind: 'guess', text: texto });
      if (ok) campoPalpite.value = '';
    });

    // ---------- fim de jogo ----------

    const secFim = el('div', { class: 'mj-ds-fim' }, el('p', { class: 'mj-rotulo', text: 'Fim de jogo' }));
    b.raiz.append(secFim);

    // ---------- desenho: canvas local + rede (mesmo molde do Quadro) ----------

    function localRect() {
      return { left: 0, top: 0, width: canvas.width, height: canvas.height };
    }

    function pointOf(e) {
      const r = canvas.getBoundingClientRect();
      return A.toNorm(e.clientX - r.left, e.clientY - r.top, { left: 0, top: 0, width: r.width, height: r.height });
    }

    function redesenhar() {
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      const rect = localRect();
      for (const item of store.items(LOCAL)) {
        const cor = A.colorOf(item);
        ctx2d.strokeStyle = cor;
        ctx2d.fillStyle = cor;
        if (item.kind !== 'stroke') continue; // desenha nao tem ferramenta de texto
        const largura = (item.width || PEN_WIDTH) * (rect.width / Math.max(1, canvas.offsetWidth || rect.width));
        if (item.points.length < 2) {
          const p = A.toPx(item.points[0][0], item.points[0][1], rect);
          ctx2d.beginPath();
          ctx2d.arc(p.x, p.y, largura / 2, 0, Math.PI * 2);
          ctx2d.fill();
          continue;
        }
        ctx2d.lineWidth = largura;
        ctx2d.lineJoin = 'round';
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        item.points.forEach((pt, i) => {
          const p = A.toPx(pt[0], pt[1], rect);
          if (i === 0) ctx2d.moveTo(p.x, p.y);
          else ctx2d.lineTo(p.x, p.y);
        });
        ctx2d.stroke();
      }
    }

    function redimensionar() {
      const r = canvas.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      redesenhar();
    }
    const ro = new root.ResizeObserver(redimensionar);
    ro.observe(palco);
    b.faxina.push(() => ro.disconnect());

    function souDesenhistaAgora() {
      return Boolean(state && state.me && state.me.isDrawer);
    }

    function aplicarLocal(op) {
      if (store.apply(LOCAL, api.me(), op)) redesenhar();
    }

    function desenhar(op) {
      aplicarLocal(op);
      api.sendAnnotate(op);
    }

    let traco = null;
    let pendente = [];
    let flushId = null;
    function flush() {
      flushId = null;
      if (!traco || !pendente.length) return;
      const points = pendente;
      pendente = [];
      api.sendAnnotate({ op: 'points', id: traco, points });
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !souDesenhistaAgora()) return;
      const p = pointOf(e);
      traco = `${api.me()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      canvas.setPointerCapture(e.pointerId);
      desenhar({ op: 'begin', id: traco, x: p.x, y: p.y, width: PEN_WIDTH, color: A.colorFor(api.me()) });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!traco) return;
      const p = pointOf(e);
      aplicarLocal({ op: 'points', id: traco, points: [[p.x, p.y]] });
      pendente.push([p.x, p.y]);
      if (flushId === null) flushId = root.requestAnimationFrame(flush);
    });
    const finalizarTraco = () => {
      if (!traco) return;
      if (flushId !== null) {
        root.cancelAnimationFrame(flushId);
        flushId = null;
      }
      if (pendente.length) {
        api.sendAnnotate({ op: 'points', id: traco, points: pendente });
        pendente = [];
      }
      api.sendAnnotate({ op: 'end', id: traco });
      traco = null;
    };
    canvas.addEventListener('pointerup', finalizarTraco);
    canvas.addEventListener('pointercancel', finalizarTraco);
    canvas.addEventListener('pointerleave', finalizarTraco);

    // ---------- render por fase ----------

    function nomeDe(id) {
      if (id == null) return 'Alguém';
      return C.nomeDe(api, id);
    }

    function renderPlacar() {
      if (!state) {
        placar.innerHTML = '';
        return;
      }
      placar.innerHTML = '';
      for (const p of state.players) {
        const li = el('li', { class: 'mj-ds-jogador' });
        if (p.id === state.drawerId) li.classList.add('is-vez');
        if (!p.naSala) li.classList.add('is-fora');
        li.append(C.bolinha(api.colorFor(p.id), nomeDe(p.id)));
        li.append(el('span', { class: 'mj-ds-nome', text: p.id === api.me() ? 'Você' : nomeDe(p.id) }));
        li.append(el('span', { class: 'mj-ds-pontos', text: C.milhar(p.score) }));
        placar.append(li);
      }
    }

    function renderStatus() {
      if (!state) {
        status.textContent = '';
        return;
      }
      let texto;
      if (state.phase === 'lobby') texto = state.players.length ? `${state.players.length} na rodada` : 'Esperando gente entrar';
      else if (state.phase === 'gameend') texto = 'Fim de jogo';
      else if (state.phase === 'choosing') texto = state.me.isDrawer ? 'Escolha uma palavra' : `${nomeDe(state.drawerId)} está escolhendo a palavra`;
      else texto = state.me.isDrawer ? 'Sua vez de desenhar' : `${nomeDe(state.drawerId)} está desenhando`;
      if (status.textContent !== texto) status.textContent = texto;
    }

    function renderPalavra() {
      if (!state || state.phase !== 'drawing') return;
      let texto;
      if (state.me.isDrawer || state.iGuessed) texto = state.word || '';
      else texto = typeof state.wordLen === 'number' ? '_ '.repeat(state.wordLen).trim() : '';
      if (palavraLinha.textContent !== texto) palavraLinha.textContent = texto;
    }

    // O aviso mora sempre na barra do topo (nunca escondida, ao contrario
    // das secoes por fase/papel: quem desenha tambem precisa ver "Fulano
    // acertou!", mesmo com o formulario de palpite escondido pra ele).
    function mostrarEvento() {
      if (!state || !state.event || state.event.seq === ultimoEventoSeq) return;
      ultimoEventoSeq = state.event.seq;
      const { kind, by } = state.event;
      if (kind === 'correct') b.aviso.mostrar(`${nomeDe(by)} acertou!`, topo);
      else if (kind === 'close') b.aviso.mostrar('Quase! Uma letra de diferença.', topo);
      else if (kind === 'wrong' && by !== api.me()) b.aviso.mostrar(`${nomeDe(by)} chutou "${state.event.text}"`, topo);
    }

    function mostrarRevelacao() {
      if (!state || !state.lastRound) return;
      if (state.lastRound.round === rodadaRevelada) return;
      rodadaRevelada = state.lastRound.round;
      b.aviso.mostrar(`A palavra era "${state.lastRound.word}" (${nomeDe(state.lastRound.drawerId)})`, topo);
    }
    let rodadaRevelada = -1;

    function update(novo) {
      state = novo && typeof novo === 'object' ? novo : null;
      renderPlacar();
      renderStatus();
      atualizarBarra(
        api,
        status.textContent,
        Boolean((state?.phase === 'choosing' || state?.phase === 'drawing') && state?.me?.isDrawer),
      );
      renderPalavra();
      mostrarEvento();
      mostrarRevelacao();

      const me = (state && state.me) || {};
      const fase = state ? state.phase : 'lobby';
      secLobby.hidden = fase !== 'lobby';
      secEscolhendo.hidden = fase !== 'choosing' || !me.isDrawer;
      secDesenhando.hidden = fase !== 'drawing';
      secFim.hidden = fase !== 'gameend';

      if (state) {
        C.ligado(btEntrar, C.podeFazer(api, { kind: 'join' }) === true);
        C.ligado(btSair, C.podeFazer(api, { kind: 'leave' }) === true);
        C.ligado(btComecar, C.podeFazer(api, { kind: 'start' }) === true);
        btEntrar.hidden = Boolean(me.joined);
        btSair.hidden = !me.joined;
      }

      if (fase === 'choosing' && me.isDrawer && Array.isArray(state.options)) {
        state.options.forEach((palavra, i) => {
          if (opcoesBtns[i].textContent !== palavra) opcoesBtns[i].textContent = palavra;
        });
      }

      const podePalpitar = fase === 'drawing' && !me.isDrawer && !(state && state.iGuessed);
      formPalpite.hidden = !podePalpitar;
      campoPalpite.disabled = !podePalpitar;
      C.ligado(btPalpite, podePalpitar);

      // Nova rodada (contrato, secao 10): sem `clear` nenhum no fio -- e o
      // numero da rodada mudando que diz "comeca uma folha em branco".
      if (state && state.round !== rodadaLocal) {
        rodadaLocal = state.round;
        store.load(LOCAL, []);
        redesenhar();
      }

      b.raiz.classList.toggle('is-minha-vez', souDesenhistaAgora());
      tique();
    }

    // ---------- relogio e tempo esgotado ----------

    let pedidoPara = null;
    let pedidoEm = 0;
    function tique() {
      const s = state;
      const correndo = s
        && (s.phase === 'choosing' || s.phase === 'drawing')
        && Number.isFinite(s.deadline);
      if (!correndo) {
        relogio.textContent = '';
        relogio.hidden = true;
        return;
      }
      const agora = api.serverNow();
      const falta = Math.max(0, Math.ceil((s.deadline - agora) / 1000));
      relogio.hidden = false;
      const txt = `${falta} s`;
      if (relogio.textContent !== txt) relogio.textContent = txt;
      relogio.classList.toggle('is-pouco', falta <= 10);
      const folga = s.me.isDrawer ? FOLGA_DESENHISTA_MS : FOLGA_NAO_DESENHISTA_MS;
      if (agora >= s.deadline + folga && (pedidoPara !== s.deadline || Date.now() - pedidoEm > REPETE_MS)) {
        pedidoPara = s.deadline;
        pedidoEm = Date.now();
        api.act({ kind: 'timeout' });
      }
    }
    const timer = root.setInterval(tique, 500);
    b.faxina.push(() => root.clearInterval(timer));

    // ---------- rabisco: chegada da rede ----------

    function annotateOp(msg) {
      if (store.apply(LOCAL, msg && msg.from, msg)) redesenhar();
    }
    function annotateSync(items) {
      store.load(LOCAL, items);
      redesenhar();
    }
    function annotateSnapshot() {
      return store.snapshot(LOCAL);
    }

    return {
      update,
      annotateOp,
      annotateSync,
      annotateSnapshot,
      destroy() {
        ro.disconnect();
        store.drop(LOCAL);
        atualizarBarra(api, '', false);
        b.destruir();
      },
      focus() {
        if (!secEscolhendo.hidden) opcoesBtns[0].focus();
        else if (!secDesenhando.hidden && !formPalpite.hidden) campoPalpite.focus();
        else btEntrar.focus();
      },
    };
  }

  // ---------- Registro (mesmo molde de mesa-janelas/quadro.js) ----------
  function registrar(api, arquivos) {
    const G = (root.GoLive = root.GoLive || {});
    G.mesaJanelas = G.mesaJanelas || {};
    const GLOBAIS = { 'comum.js': 'mesaJanelasComum' };
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
    api.mount = function (elemento, vistaApi) {
      if (!falta().length) return montar(elemento, vistaApi);
      let inst = null;
      let ultimo = null;
      let morto = false;
      pronto.then(() => {
        if (morto) return;
        inst = montar(elemento, vistaApi);
        if (ultimo) inst.update(ultimo[0], ultimo[1]);
      }, () => {});
      return {
        update(s, meta) { if (inst) inst.update(s, meta); else ultimo = [s, meta]; },
        annotateOp(msg) { inst?.annotateOp?.(msg); },
        annotateSync(items) { inst?.annotateSync?.(items); },
        annotateSnapshot() { return inst?.annotateSnapshot?.() || []; },
        destroy() { morto = true; if (inst) inst.destroy(); },
        focus() { if (inst && inst.focus) inst.focus(); },
      };
    };
    G.mesaJanelas[api.type] = api;
  }

  const api = { type: TYPE, mount, atualizarBarra };
  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

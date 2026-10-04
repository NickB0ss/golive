'use strict';

/*
 * Conteudo da janela "Quadro" (contrato da Mesa, secoes 6 e 10). Folha em
 * branco onde todo mundo rabisca com as MESMAS ferramentas do rabisco sobre
 * a tela (`annotate.js`): caneta, texto, desfazer os seus, cor de cada um.
 *
 * O traco NAO vai pelo `act` desta janela (nao existe acao nenhuma aqui):
 * ele vai pelo canal do rabisco do servidor, endereco 'mesa:<id da
 * janela>' (`api.sendAnnotate`/`api.annotateSurface`, que a Vista
 * acrescentou em `makeApi` so pra isso). Um deposito local
 * (`annotate.createStore()`) guarda os itens desta janela; a chave usada
 * nele e so uma chave de Map interna (nunca vai pro fio) escolhida pra
 * nunca bater com o id de uma pessoa -- assim `annotate.opAllowed`
 * (a regra "o dono da SUPERFICIE nao desenha nela", pensada pra tela)
 * nunca se aplica aqui: no Quadro todo mundo desenha, sempre. Quem pode
 * limpar tudo (`canAnnotateClear` no modulo) e conferido pelo SERVIDOR;
 * aqui so decide se o botao "Limpar" aparece ligado.
 *
 * `mount()` devolve, alem do trio padrao (update/destroy/focus), tres
 * ganchos que so esta janela usa (a Vista chama quando existem):
 *   - `annotateOp(msg)`      -- um traco/texto/desfazer/limpar chegou
 *   - `annotateSync(items)`  -- o retrato de quem ja estava desenhando
 *   - `annotateSnapshot()`   -- devolve o meu retrato, pra Vista mandar pra
 *                                quem ACABA de entrar na vista Mesa
 */

(function (root) {
  const { t } = root.GoLive.i18n;
  const TYPE = 'quadro';
  // Chave do deposito local: nunca e um id de pessoa (ids de conexao sao só
  // digitos -- CONNECTION_ID_RE no servidor), entao a regra de dono da
  // superficie do annotate.js nunca acha um "dono" aqui.
  const LOCAL = 'quadro-local';
  const PEN_WIDTH = 4;
  const TEXT_SIZE = 20;

  function visibilidadeQuadro(state, me, nameOf) {
    const dono = String(state && state.owner) === String(me);
    const escondido = state && state.hidden === true;
    const semAcesso = escondido && !dono;
    let nome = t('ui.pessoa.alguem');
    try {
      nome = nameOf(state && state.owner) || nome;
    } catch {
      /* nome ausente nao impede o aviso */
    }
    return {
      dono,
      escondido,
      semAcesso,
      mostraBotao: dono,
      textoBotao: escondido ? t('mesa.quadro.mostrar') : t('mesa.quadro.esconder'),
      aviso: semAcesso ? t('mesa.quadro.escondeu', { nome }) : '',
    };
  }

  function deveEnviarRetrato(antes, depois, me) {
    return String(depois && depois.owner) === String(me)
      && antes && antes.hidden === true
      && depois && depois.hidden !== true;
  }

  function perdeAcessoAoEsconder(antes, depois, dona) {
    return antes?.hidden !== true && depois?.hidden === true && !dona;
  }

  function mount(elRoot, api) {
    const C = root.GoLive.mesaJanelasComum;
    const A = root.GoLive.annotate;
    const { el } = C;
    const b = C.base(elRoot, api, TYPE);
    const store = A.createStore();

    let state = { owner: null, hidden: false };
    let tool = 'caneta'; // 'caneta' | 'texto'
    let corEscolhida = null; // null = a cor da propria pessoa

    function corAtual() {
      return corEscolhida || A.colorFor(api.me());
    }

    function souDona() {
      return visibilidadeQuadro(state, api.me(), api.nameOf).dono;
    }

    function podeLimpar() {
      if (state.hidden === true) return souDona();
      return souDona() || api.isLeader();
    }

    function escondidoParaMim() {
      return visibilidadeQuadro(state, api.me(), api.nameOf).semAcesso;
    }

    // ---------- barra de ferramentas ----------

    const btCaneta = C.botao({ text: t('ui.rabisco.caneta'), class: 'mj-qd-ferr' });
    const btTexto = C.botao({ text: t('mesa.quadro.texto'), class: 'mj-qd-ferr' });
    const paleta = el('div', { class: 'mj-qd-paleta', attrs: { role: 'group', 'aria-label': t('mesa.quadro.corTraco') } });
    const swatches = A.PALETTE.map((cor) => {
      const sw = el('button', {
        class: 'mj-qd-cor',
        attrs: { type: 'button', 'aria-label': t('mesa.quadro.usarCor', { cor }), title: t('mesa.quadro.cor') },
      });
      sw.style.setProperty('--mj-cor', cor);
      sw.addEventListener('click', () => {
        corEscolhida = cor;
        sincronizarBarra();
      });
      paleta.append(sw);
      return { cor, el: sw };
    });
    const btDesfazer = C.botao({ text: t('mesa.quadro.desfazer'), class: 'mj-qd-acao' });
    const btLimpar = C.botao({ text: t('mesa.quadro.limpar'), class: 'mj-qd-acao' });
    const btVisibilidade = C.botao({
      text: t('mesa.quadro.esconder'),
      class: 'mj-qd-acao mj-qd-visibilidade',
      attrs: { 'aria-pressed': 'false' },
    });
    const selo = el('span', { class: 'mj-qd-selo', text: t('mesa.quadro.soVoceVe'), attrs: { hidden: '' } });
    const barra = el(
      'div',
      { class: 'mj-qd-barra' },
      btCaneta,
      btTexto,
      paleta,
      selo,
      el('span', { class: 'mj-mola' }),
      btDesfazer,
      btLimpar,
      btVisibilidade,
    );
    b.raiz.append(barra);

    function escolherFerramenta(nova) {
      tool = nova;
      sincronizarBarra();
    }
    btCaneta.addEventListener('click', () => escolherFerramenta('caneta'));
    btTexto.addEventListener('click', () => escolherFerramenta('texto'));

    b.clique(btVisibilidade, barra, () => {
      api.act({ kind: 'visibility', hidden: state.hidden !== true });
    });

    b.clique(btDesfazer, barra, () => aplicarLocal({ op: 'undo' }));
    b.clique(btLimpar, barra, () => {
      if (!podeLimpar()) {
        b.aviso.mostrar(t('mesa.quadro.soQuemLimpa'), barra);
        return;
      }
      // O servidor nunca ecoa pra quem mandou (mesma regra do rabisco sobre
      // tela): limpa aqui, otimista, e manda pra rede.
      store.load(LOCAL, []);
      redesenhar();
      api.sendAnnotate({ op: 'clear', scope: 'all' });
    });

    function sincronizarBarra() {
      const visibilidade = visibilidadeQuadro(state, api.me(), api.nameOf);
      btCaneta.classList.toggle('is-on', tool === 'caneta');
      btTexto.classList.toggle('is-on', tool === 'texto');
      for (const sw of swatches) sw.el.classList.toggle('is-on', corEscolhida === sw.cor);
      btVisibilidade.hidden = !visibilidade.mostraBotao;
      btVisibilidade.textContent = visibilidade.textoBotao;
      btVisibilidade.setAttribute('aria-pressed', String(visibilidade.escondido));
      selo.hidden = !visibilidade.escondido || !visibilidade.dono;
      barra.classList.toggle('is-escondido', visibilidade.semAcesso);
      C.ligado(btDesfazer, store.hasFrom(LOCAL, api.me()) ? true : t('mesa.quadro.nadaSeu'));
      C.ligado(btLimpar, podeLimpar() ? true : t('mesa.quadro.soQuemLimpa'));
    }

    // ---------- tela de desenho ----------

    const palco = el('div', { class: 'mj-qd-palco' });
    const canvas = el('canvas', { class: 'mj-qd-canvas' });
    const avisoEscondido = el('p', {
      class: 'mj-qd-escondido',
      attrs: { role: 'status', 'aria-live': 'polite', tabindex: '-1', hidden: '' },
    });
    palco.append(canvas);
    palco.append(avisoEscondido);
    b.raiz.append(palco);
    // Nada que comeca no canvas pode arrastar a janela (a alca e a Vista
    // cuidam disso fora daqui, mas o pointerdown tambem sobe por padrao).
    palco.addEventListener('pointerdown', (e) => e.stopPropagation());

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
        if (item.kind === 'stroke') {
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
        } else if (item.kind === 'text') {
          const p = A.toPx(item.x, item.y, rect);
          const tam = (item.size || TEXT_SIZE) * (rect.height / Math.max(1, canvas.offsetHeight || rect.height));
          const familia = root.getComputedStyle(b.raiz).getPropertyValue('--font-body').trim()
            || 'system-ui, sans-serif';
          ctx2d.font = `${tam}px ${familia}`;
          ctx2d.textBaseline = 'top';
          ctx2d.fillText(item.text, p.x, p.y);
        }
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

    /** Aplica local (otimista) e sincroniza a barra (desfazer liga/desliga
     * pelo que sobrou meu). Devolve `changed`, igual `store.apply`. */
    function aplicarLocal(op) {
      const changed = store.apply(LOCAL, api.me(), op);
      if (changed) redesenhar();
      sincronizarBarra();
      return changed;
    }

    function desenhar(op) {
      aplicarLocal(op);
      api.sendAnnotate(op);
    }

    // ---------- ponteiro: caneta ----------

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
      if (e.button !== 0) return;
      const p = pointOf(e);
      if (tool === 'texto') {
        e.preventDefault();
        abrirTexto(p, e);
        return;
      }
      traco = `${api.me()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      canvas.setPointerCapture(e.pointerId);
      desenhar({ op: 'begin', id: traco, x: p.x, y: p.y, width: PEN_WIDTH, color: corAtual() });
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

    // ---------- texto ----------

    function fecharTexto() {
      palco.querySelector('.mj-qd-texto-input')?.remove();
    }

    function abrirTexto(ponto, e) {
      fecharTexto();
      const box = canvas.getBoundingClientRect();
      // O conteudo vive dentro do mundo com zoom (mesa-view.js): dividir
      // pela razao entre o retangulo renderizado e o tamanho de layout tira
      // a escala, senao o campo nasce deslocado (mesmo calculo de
      // mesa-janelas/batalha.js nao usa, mas ui.js#openAnnotTextInput sim).
      const escala = canvas.offsetWidth ? box.width / canvas.offsetWidth : 1;
      const input = el('input', {
        class: 'mj-qd-texto-input',
        attrs: { type: 'text', maxlength: String(A.MAX_TEXT), placeholder: t('mesa.quadro.escreva') },
      });
      input.style.left = `${(e.clientX - box.left) / escala}px`;
      input.style.top = `${(e.clientY - box.top) / escala}px`;
      input.style.color = corAtual();
      palco.append(input);
      root.requestAnimationFrame(() => input.focus());
      const commit = () => {
        const texto = input.value.trim();
        input.remove();
        if (!texto) return;
        desenhar({
          op: 'text', id: `${api.me()}-t-${Date.now().toString(36)}`, x: ponto.x, y: ponto.y,
          text: texto, size: TEXT_SIZE, color: corAtual(),
        });
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') input.remove();
      });
      input.addEventListener('focus', () => input.addEventListener('blur', commit, { once: true }), { once: true });
    }

    // ---------- ciclo de vida ----------

    function update(novo) {
      const antes = state;
      state = novo && typeof novo === 'object'
        ? { ...novo, hidden: novo.hidden === true }
        : { owner: null, hidden: false };
      const visibilidade = visibilidadeQuadro(state, api.me(), api.nameOf);
      if (visibilidade.semAcesso) {
        fecharTexto();
        store.load(LOCAL, []);
      }
      canvas.hidden = visibilidade.semAcesso;
      avisoEscondido.hidden = !visibilidade.semAcesso;
      avisoEscondido.textContent = visibilidade.aviso;
      const foco = root.document?.activeElement;
      if (perdeAcessoAoEsconder(antes, state, visibilidade.dono)
        && (barra.contains(foco) || canvas === foco)) {
        avisoEscondido.focus();
      }
      b.raiz.classList.toggle('is-dona', souDona());
      sincronizarBarra();
      redesenhar();
      if (deveEnviarRetrato(antes, state, api.me())) {
        api.sendAnnotateSyncAll(store.snapshot(LOCAL));
      }
    }

    function annotateOp(msg) {
      if (escondidoParaMim()) return;
      if (msg && msg.op === 'clear' && msg.scope === 'all') {
        // O servidor so repassa um clear:all de quem pode (o dono da
        // janela ou o lider da sala) -- store.apply recusaria por causa da
        // chave local fake, entao o clear entra direto pelo `load`.
        store.load(LOCAL, []);
        redesenhar();
        sincronizarBarra();
        return;
      }
      if (store.apply(LOCAL, msg && msg.from, msg)) redesenhar();
      sincronizarBarra();
    }

    function annotateSync(items) {
      if (escondidoParaMim()) return;
      store.load(LOCAL, items);
      redesenhar();
      sincronizarBarra();
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
        fecharTexto();
        ro.disconnect();
        store.drop(LOCAL);
        b.destruir();
      },
      focus() {
        btCaneta.focus();
      },
    };
  }

  // ---------- Registro ----------
  // Mesmo molde de mesa-janelas/batalha.js: a Vista so garante que este
  // arquivo carregue; `comum.js` (base/botao/el/ligado) e apoio que NAO
  // tem tag propria no index.html nem entra em MODULE_NAMES, entao pode
  // nao ter chegado ainda quando este <script> termina.
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

  const api = { type: TYPE, mount, visibilidadeQuadro, deveEnviarRetrato, perdeAcessoAoEsconder };
  registrar(api, ['comum.js']);

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

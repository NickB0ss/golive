'use strict';
/* global window, document, location */

// Pagina da bancada da midia (tools/midia/main.js). Cada janela do Electron
// e um "PC": entra na sala do servidor de sinalizacao REAL
// (server/signaling-core.js), pede a vista Mesa, acerta o relogio pela
// mensagem `time` (5 idas e voltas, fica a de menor atraso) e monta os
// conteudos reais de src/renderer/mesa-janelas/ com a `api` da secao 6 do
// contrato. O main comanda tudo por `window.bancada`.

(function () {
  const q = new URLSearchParams(location.search);
  const nome = q.get('nome') || 'PC';
  const ws = new WebSocket(`ws://127.0.0.1:${q.get('ws')}`);
  const G = window.GoLive;
  const janelas = new Map(); // id -> { win, content, el, denied: Set }
  const peers = new Map();
  let myId = null;
  let owner = false;
  let offset = 0;
  let melhorRtt = Infinity;
  const recusas = [];
  const acoes = []; // os `act` que chegaram, para o relatorio

  function send(obj) {
    ws.send(JSON.stringify(obj));
  }

  function serverNow() {
    return performance.now() + offset;
  }

  function pingTempo() {
    send({ type: 'time', t0: performance.now() });
  }

  function montar(win) {
    const conteudo = G.mesaJanelas[win.type];
    if (!conteudo) return;
    const caixa = document.createElement('section');
    caixa.className = `caixa caixa-${win.type}`;
    caixa.dataset.id = win.id;
    const titulo = document.createElement('h2');
    titulo.textContent = `${nome} · ${win.type} ${win.id}`;
    const el = document.createElement('div');
    el.className = 'conteudo';
    caixa.append(titulo, el);
    document.getElementById('mesa').appendChild(caixa);
    const mod = G.mesaRegistry.get(win.type);
    const denied = new Set();
    const api = {
      act: (action) => send({ type: 'mesa', op: 'act', id: win.id, action }),
      validate: (action) => mod.validate(janelas.get(win.id).win.state, action, { from: myId, isLeader: owner }),
      me: () => myId,
      isLeader: () => owner,
      peers: () => [...peers.values()],
      nameOf: (id) => (peers.get(id) || {}).name || '',
      colorFor: () => '#5B4BE8',
      serverNow,
      onDenied: (fn) => {
        denied.add(fn);
        return () => denied.delete(fn);
      },
    };
    const content = conteudo.mount(el, api);
    janelas.set(win.id, { win, content, el, denied });
    content.update(win.state, null);
  }

  ws.addEventListener('open', () => send({ type: 'join', room: 'geral', name: nome }));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    switch (m.type) {
      case 'welcome':
        myId = m.id;
        owner = m.owner === true;
        for (const p of m.peers || []) peers.set(p.id, { id: p.id, name: p.name });
        peers.set(myId, { id: myId, name: nome });
        send({ type: 'mesa-view', on: true });
        for (let i = 0; i < 5; i++) setTimeout(pingTempo, i * 120);
        setInterval(pingTempo, 5000);
        break;
      case 'peer-joined':
        if (m.id) peers.set(m.id, { id: m.id, name: m.name });
        break;
      case 'peer-left':
        peers.delete(m.id);
        break;
      case 'time': {
        const t1 = performance.now();
        const rtt = t1 - m.t0;
        if (rtt <= melhorRtt) {
          melhorRtt = rtt;
          offset = m.server - (m.t0 + rtt / 2);
        }
        break;
      }
      case 'mesa-sync':
        for (const w of m.mesa.windows) if (!janelas.has(w.id)) montar(w);
        break;
      case 'mesa':
        if (m.op === 'add') montar(m.win);
        else if (m.op === 'act') {
          const j = janelas.get(m.id);
          if (!j) break;
          const mod = G.mesaRegistry.get(j.win.type);
          acoes.push({ t: Math.round(performance.now()), janela: j.win.type, by: m.by === myId ? 'eu' : 'outro', action: m.action });
          if (acoes.length > 300) acoes.shift();
          j.win = { ...j.win, state: mod.reduce(j.win.state, m.action, { from: m.by, isLeader: m.isLeader }) };
          j.content.update(j.win.state, { by: m.by, isLeader: m.isLeader });
        } else if (m.op === 'remove') {
          const j = janelas.get(m.id);
          if (j) {
            j.content.destroy();
            j.el.parentElement.remove();
            janelas.delete(m.id);
          }
        }
        break;
      case 'mesa-denied': {
        recusas.push(m);
        const j = janelas.get(m.id);
        if (j) for (const fn of j.denied) fn(m);
        break;
      }
      default:
        break;
    }
  });

  window.bancada = {
    pronto: () => myId !== null && melhorRtt < Infinity,
    relogio: () => ({ offset, melhorRtt }),
    add: (type, x, y, w, h) => send({ type: 'mesa', op: 'add', win: { type, x, y, w, h } }),
    act: (id, action) => send({ type: 'mesa', op: 'act', id, action }),
    tirar: (id) => send({ type: 'mesa', op: 'remove', id }),
    ids: (type) => [...janelas.values()].filter((j) => !type || j.win.type === type).map((j) => j.win.id),
    estado: (id) => janelas.get(id) && janelas.get(id).win.state,
    recusas: () => recusas.slice(),
    acoes: (tipo) => acoes.filter((a) => !tipo || a.janela === tipo),
    /** Onde o player deste PC esta e onde deveria estar. */
    medir: (id) => {
      const j = janelas.get(id);
      if (!j || !j.content._debug) return null;
      const d = j.content._debug();
      const st = j.win.state;
      const alvo = G.mesaMidiaLinks.positionAt(st, serverNow());
      const p = d.player;
      return {
        ativo: d.active,
        erro: d.errorCode,
        pronto: !!(p && p.ready),
        estado: p ? p.playerState() : null,
        pos: p && p.ready ? p.currentTime() : null,
        alvo,
        rate: p ? p.rate() : null,
        corrigindo: d.sync ? d.sync.drift.state().correcting : null,
        tituloDaSala: st.current ? st.current.title : undefined,
        visivel: {
          capa: !!j.el.querySelector('.mjm-cover:not([hidden])'),
          msg: (j.el.querySelector('.mjm-msg:not([hidden]) .mjm-msg-text, .mjm-msg-text:not([hidden])') || {}).textContent || '',
        },
      };
    },
    clicar: (id, seletor) => {
      const j = janelas.get(id);
      const b = j && j.el.querySelector(seletor);
      if (!b) return false;
      b.click();
      return true;
    },
    preencher: (id, seletor, valor) => {
      const j = janelas.get(id);
      const i = j && j.el.querySelector(seletor);
      if (!i) return false;
      i.value = valor;
      i.form.requestSubmit();
      return true;
    },
    capaCarregou: (id) => {
      const j = janelas.get(id);
      const img = j && j.el.querySelector('img.mjm-radio-cover, img.mjm-cover-img');
      return img ? { src: img.src, largura: img.naturalWidth, completa: img.complete } : null;
    },
    /** Mede um iframe solto com outro sandbox (sem passar pelo ytplayer). */
    sandboxTeste: (sandbox, videoId) => new Promise((resolve) => {
      const f = document.createElement('iframe');
      if (sandbox !== null) f.setAttribute('sandbox', sandbox);
      f.setAttribute('allow', 'autoplay; encrypted-media');
      f.src = G.ytplayer.embedUrl(videoId, { origin: location.origin });
      f.style.cssText = 'width:160px;height:90px';
      const origens = new Set();
      const ouvir = (e) => {
        if (e.source === f.contentWindow) origens.add(e.origin);
      };
      window.addEventListener('message', ouvir);
      document.body.appendChild(f);
      const t = setInterval(() => {
        try {
          f.contentWindow.postMessage(G.ytplayer.listeningJson(1), '*');
        } catch {
          // sem janela ainda
        }
      }, 200);
      setTimeout(() => {
        clearInterval(t);
        window.removeEventListener('message', ouvir);
        resolve({ sandbox, origens: [...origens], nome: f.name || null });
        f.dataset.teste = sandbox === null ? 'sem-sandbox' : sandbox;
      }, 2500);
    }),
  };
})();

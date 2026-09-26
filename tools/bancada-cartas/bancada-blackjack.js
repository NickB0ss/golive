'use strict';
/* global document, window, location, GoLive */

/*
 * Bancada do Blackjack: tres pessoas lado a lado (Ana, Bia, Caio) na MESMA
 * janela, com uma sala simulada que faz o que o contrato manda para janela
 * secreta (secao 8): `validate` na acao como veio -> `prepare` (sorte e hora)
 * -> `reduce` no estado do servidor, e cada pessoa recebe so a
 * `view(state, id)` dela (nunca o estado inteiro). Recusa volta so para quem
 * mandou, por `onDenied`.
 *
 * O relogio da sala e `Date.now() + desvio`; `bancada.pular(ms)` adianta o
 * relogio (para ver o prazo estourar e a janela mandar `timeout`).
 *
 * Parametros: ?tam=min|padrao|grande&tema=paper&semente=7
 * O roteiro do Playwright (rodar-blackjack.js) mexe por `window.bancada`.
 */

(function () {
  const q = new URLSearchParams(location.search);
  const tam = q.get('tam') || 'padrao';
  if (q.get('tema')) document.documentElement.dataset.theme = q.get('tema');

  const PEERS = [
    { id: '1', name: 'Ana' },
    { id: '2', name: 'Bia' },
    { id: '3', name: 'Caio' },
  ];
  const LIDER = '1';

  const mod = GoLive.mesaModules.blackjack;
  const conteudo = GoLive.mesaJanelas.blackjack;

  let semente = Number(q.get('semente')) || 7;
  function random() {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  }

  let desvio = 0;
  const agora = () => Date.now() + desvio;

  let estado = mod.init({ now: agora(), peers: PEERS, by: LIDER, random });
  const clientes = new Map(); // id -> { tela, negados:Set, el, ultima }
  const log = [];

  function ctx(from) {
    return { from, by: from, isLeader: from === LIDER, now: agora(), peers: PEERS, random };
  }

  function entregar(meta) {
    setTimeout(() => {
      for (const [id, c] of clientes) {
        c.ultima = mod.view(estado, id);
        c.tela.update(JSON.parse(JSON.stringify(c.ultima)), meta);
      }
    }, 0);
  }

  function negar(from, reason, detail) {
    log.push({ from, negado: reason, detail });
    const c = clientes.get(from);
    if (c) setTimeout(() => { for (const fn of c.negados) fn({ reason, detail }); }, 0);
  }

  function receber(from, action) {
    const c = ctx(from);
    let ok;
    try { ok = mod.validate(estado, action, c); } catch { ok = 'error'; }
    if (ok !== true) return negar(from, ok === 'error' ? 'error' : 'invalid', ok);
    const pronta = mod.prepare(estado, action, c);
    const prox = mod.reduce(estado, pronta, { from, isLeader: from === LIDER });
    if (JSON.stringify(prox).length > mod.maxStateBytes) return negar(from, 'state-too-big');
    estado = prox;
    log.push({ from, kind: action.kind });
    return entregar({ by: from, isLeader: from === LIDER });
  }

  function criarApi(me) {
    return {
      act(action) { receber(me, JSON.parse(JSON.stringify(action))); },
      validate() { return true; }, // janela secreta: quem decide e o servidor
      me: () => me,
      isLeader: () => me === LIDER,
      peers: () => PEERS.slice(),
      nameOf: (id) => (PEERS.find((p) => p.id === id) || {}).name || null,
      colorFor: (id) => GoLive.annotate.colorFor(id),
      serverNow: agora,
      onDenied(fn) {
        const c = clientes.get(me);
        c.negados.add(fn);
        return () => c.negados.delete(fn);
      },
    };
  }

  const s = mod.size;
  const dims = tam === 'min'
    ? { w: s.minW, h: s.minH }
    : tam === 'grande'
      ? { w: Math.round(s.w * 1.4), h: Math.round(s.h * 1.4) }
      : { w: s.w, h: s.h };

  document.getElementById('titulo').textContent = `${mod.title} · ${dims.w}×${dims.h}`;
  const palco = document.getElementById('palco');

  for (const p of PEERS) {
    const coluna = document.createElement('section');
    coluna.className = 'pessoa';
    coluna.dataset.usuario = p.id;
    const rot = document.createElement('h2');
    rot.textContent = p.id === LIDER ? `${p.name} (líder da sala)` : p.name;
    const caixa = document.createElement('div');
    caixa.className = 'janela';
    caixa.style.width = `${dims.w}px`;
    caixa.style.height = `${dims.h}px`;
    const el = document.createElement('div');
    el.className = 'conteudo mesa-content';
    const alca = document.createElement('div');
    alca.className = 'alca';
    caixa.append(alca, el);
    coluna.append(rot, caixa);
    palco.append(coluna);
    const c = { tela: null, negados: new Set(), el, ultima: null };
    clientes.set(p.id, c);
    c.tela = conteudo.mount(el, criarApi(p.id));
    c.ultima = mod.view(estado, p.id);
    c.tela.update(JSON.parse(JSON.stringify(c.ultima)), null);
  }

  window.bancada = {
    dims,
    log,
    servidor: () => estado,
    view: (id) => clientes.get(id).ultima,
    act: (id, action) => receber(id, action),
    /** Poe estas cartas no topo do sapato (para montar a cena). */
    empilhar(cartas) {
      // Tira uma de cada do meio do sapato: o total continua o mesmo.
      const resto = estado.shoe.slice();
      for (const c of cartas) {
        const i = resto.indexOf(c);
        if (i >= 0) resto.splice(i, 1);
      }
      estado = Object.assign({}, estado, { shoe: cartas.concat(resto) });
    },
    pular(ms) { desvio += ms; },
    sair(id) {
      estado = mod.dropPeer(estado, id);
      entregar(null);
    },
    negados: () => log.filter((x) => x.negado),
    destruir(id) {
      const c = clientes.get(id);
      c.tela.destroy();
      return c.el.childElementCount;
    },
  };
  document.body.dataset.pronto = '1';
})();

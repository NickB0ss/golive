'use strict';
/* global document, window, location, GoLive */

/*
 * Bancada do conteudo das janelas da Mesa: carrega os modulos puros e os
 * conteudos (`mesa-janelas/<tipo>.js`) com uma `api` simulada e poe duas
 * pessoas lado a lado -- Ana (lider da sala) e Bia -- na MESMA janela.
 *
 * A "sala" aqui imita o servidor do jeito que o contrato descreve (secao 5):
 * `validate` na acao como veio -> `prepare` (sorte e hora) -> `reduce`, e o
 * eco vai para os dois com a acao ja preparada; cada um aplica o `reduce`
 * na propria copia do estado, como o cliente de verdade. Recusa volta so
 * para quem mandou, por `onDenied`.
 *
 * Parametros: ?tipo=placar&tam=min|padrao|grande&tema=paper&atraso=0
 * O roteiro do Playwright (rodar.js) mexe por `window.bancada`.
 */

(function () {
  const q = new URLSearchParams(location.search);
  const tipo = q.get('tipo') || 'placar';
  const tam = q.get('tam') || 'padrao';
  const atraso = Math.max(0, Number(q.get('atraso')) || 0);
  if (q.get('tema')) document.documentElement.dataset.theme = q.get('tema');

  const PEERS = [
    { id: '1', name: 'Ana' },
    { id: '2', name: 'Bia' },
    { id: '3', name: 'Caio' },
    { id: '4', name: 'Duda' },
  ];
  const LIDER = '1';
  const USUARIOS = ['1', '2'];

  const mod = GoLive.mesaModules[tipo];
  const conteudo = GoLive.mesaJanelas[tipo];
  if (!mod || !conteudo) {
    document.body.textContent = `Tipo sem módulo ou sem conteúdo: ${tipo}`;
    return;
  }

  // Sorte com semente, para os prints sairem iguais a cada rodada.
  let semente = Number(q.get('semente')) || 7;
  function random() {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  }

  const inicial = mod.init({ now: Date.now(), peers: PEERS, by: LIDER, random });
  const clientes = new Map(); // id -> { state, negados:Set, tela }
  const log = [];

  function ctxServidor(from) {
    return { from, isLeader: from === LIDER, now: Date.now(), peers: PEERS, random };
  }

  let estadoServidor = inicial;

  function entregar(fn) {
    if (atraso > 0) setTimeout(fn, atraso);
    else setTimeout(fn, 0);
  }

  function negar(from, reason, detail) {
    const c = clientes.get(from);
    log.push({ from, negado: reason, detail });
    for (const fn of c.negados) fn({ reason, detail });
  }

  function receber(from, action) {
    const ctx = ctxServidor(from);
    let ok;
    try { ok = mod.validate(estadoServidor, action, ctx); } catch { ok = 'error'; }
    if (ok !== true) return entregar(() => negar(from, ok === 'error' ? 'error' : 'invalid', ok));
    const pronta = mod.prepare ? mod.prepare(estadoServidor, action, ctx) : action;
    const meta = { from, isLeader: from === LIDER };
    const prox = mod.reduce(estadoServidor, pronta, meta);
    if (JSON.stringify(prox).length > mod.maxStateBytes) return entregar(() => negar(from, 'state-too-big'));
    estadoServidor = prox;
    log.push({ from, action: pronta });
    entregar(() => {
      for (const [, c] of clientes) {
        c.state = mod.reduce(c.state, pronta, meta);
        c.tela.update(c.state, { by: from, isLeader: from === LIDER });
      }
    });
  }

  function criarApi(me) {
    const c = clientes.get(me);
    return {
      act(action) { receber(me, JSON.parse(JSON.stringify(action))); },
      validate(action) { return mod.validate(c.state, action, { from: me, isLeader: me === LIDER, peers: PEERS }); },
      me: () => me,
      isLeader: () => me === LIDER,
      peers: () => PEERS.slice(),
      nameOf: (id) => (PEERS.find((p) => p.id === id) || {}).name || null,
      colorFor: (id) => GoLive.annotate.colorFor(id),
      serverNow: () => Date.now(),
      onDenied(fn) {
        c.negados.add(fn);
        return () => c.negados.delete(fn);
      },
    };
  }

  const s = mod.size;
  const dims = tam === 'min'
    ? { w: s.minW, h: s.minH }
    : tam === 'grande'
      ? { w: Math.round(s.w * 1.6), h: Math.round(s.h * 1.6) }
      : { w: s.w, h: s.h };

  const palco = document.getElementById('palco');
  document.getElementById('titulo').textContent = `${mod.title} · ${dims.w}×${dims.h}`;

  for (const id of USUARIOS) {
    const nome = PEERS.find((p) => p.id === id).name;
    const coluna = document.createElement('section');
    coluna.className = 'pessoa';
    coluna.dataset.usuario = id;
    const rot = document.createElement('h2');
    rot.textContent = id === LIDER ? `${nome} (líder da sala)` : nome;
    const caixa = document.createElement('div');
    caixa.className = 'janela';
    caixa.style.width = `${dims.w}px`;
    caixa.style.height = `${dims.h}px`;
    const el = document.createElement('div');
    el.className = 'conteudo';
    caixa.append(el);
    coluna.append(rot, caixa);
    palco.append(coluna);
    clientes.set(id, { state: JSON.parse(JSON.stringify(inicial)), negados: new Set(), tela: null, el });
    const c = clientes.get(id);
    c.tela = conteudo.mount(el, criarApi(id));
    c.tela.update(c.state, null);
  }

  window.bancada = {
    tipo,
    dims,
    log,
    estado: (id) => clientes.get(id || LIDER).state,
    servidor: () => estadoServidor,
    act: (id, action) => receber(id, action),
    // Estado imposto (para montar cenas de print): vale para os dois.
    impor(state) {
      estadoServidor = state;
      for (const [, c] of clientes) {
        c.state = JSON.parse(JSON.stringify(state));
        c.tela.update(c.state, null);
      }
    },
    destruir(id) {
      const c = clientes.get(id);
      c.tela.destroy();
      return c.el.childElementCount;
    },
    negados: () => log.filter((x) => x.negado),
  };
  document.body.dataset.pronto = '1';
})();

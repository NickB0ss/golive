'use strict';
/* global document, window, location, GoLive */

/*
 * Bancada do pôquer: uma "sala" simulada com tres pessoas lado a lado (Ana,
 * lider; Bia; Caio), cada uma com a SUA copia do conteudo da janela.
 *
 * Imita o servidor como o contrato descreve para modulos `secret` (secao 8):
 * `validate` na acao como veio -> `prepare` (sorte e hora) -> `reduce` no
 * estado inteiro, que so existe aqui; cada pessoa recebe
 * `update(view(estado, id), meta)`, nunca o estado. Recusa volta so para
 * quem mandou, por `onDenied`.
 *
 * Parametros: ?tam=padrao|min&tema=paper&semente=7
 * O roteiro do Playwright (poquer-rodar.js) mexe por `window.bancada`.
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
  const CORES = { 1: '#e0795b', 2: '#5b9be0', 3: '#7fc77a' };
  const LIDER = '1';

  const mod = GoLive.mesaModules.poquer;
  const conteudo = GoLive.mesaJanelas.poquer;
  const B = GoLive.mesaBaralho;

  let semente = Number(q.get('semente')) || 7;
  function random() {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  }

  // Relogio da sala: o de verdade mais um adiantamento que o roteiro controla.
  let adiantado = 0;
  const agora = () => Date.now() + adiantado;

  let estado = mod.init({ now: agora(), peers: PEERS, by: LIDER, random });
  let baralhoFixo = null;
  const telas = new Map(); // id -> { inst, negados: Set }
  const log = [];

  function entregar(meta) {
    for (const [id, t] of telas) t.inst.update(mod.view(estado, id), meta);
  }

  function negar(from, reason, detail) {
    log.push({ from, negado: reason, detail });
    const t = telas.get(from);
    if (t) for (const fn of t.negados) fn({ reason, detail });
  }

  function receber(from, action) {
    const ctx = { from, isLeader: from === LIDER, now: agora(), peers: PEERS, random };
    let ok;
    try { ok = mod.validate(estado, action, ctx); } catch { ok = 'error'; }
    if (ok !== true) {
      setTimeout(() => negar(from, ok === 'error' ? 'error' : 'invalid', ok), 0);
      return;
    }
    let pronta = mod.prepare(estado, action, ctx);
    if (pronta.kind === 'deal' && baralhoFixo) {
      pronta = Object.assign({}, pronta, { deck: baralhoFixo });
      baralhoFixo = null;
    }
    const meta = { by: from, isLeader: from === LIDER };
    const prox = mod.reduce(estado, pronta, { from, isLeader: meta.isLeader });
    if (JSON.stringify(prox).length > mod.maxStateBytes) {
      setTimeout(() => negar(from, 'state-too-big'), 0);
      return;
    }
    estado = prox;
    log.push({ from, kind: pronta.kind, to: pronta.to });
    setTimeout(() => entregar(meta), 0);
  }

  /** Arruma o baralho da proxima mao: `holes` = { cadeira: 'As Kd' },
   * `board` = 'Ac 7d 2s Kc 9h'. Descobre a ordem da distribuicao dando as
   * cartas uma vez num rascunho (o reduce e puro). */
  function arrumar(holes, board) {
    const from = estado.seats.find((x) => x);
    const h = mod.reduce(estado, { kind: 'deal', at: 0 }, { from }).hand;
    const ordem = [];
    for (let k = 0; k < 8; k += 1) {
      const s = (h.sbSeat + k) % 8;
      if (h.status[s]) ordem.push(s);
    }
    const hl = {};
    for (const [s, t] of Object.entries(holes)) hl[s] = t.split(' ');
    const quero = [];
    for (let r = 0; r < 2; r += 1) for (const s of ordem) quero.push(hl[s] ? hl[s][r] : null);
    const bd = board.split(' ');
    quero.push(null, bd[0], bd[1], bd[2], null, bd[3], null, bd[4]);
    const usadas = new Set(quero.filter(Boolean));
    const resto = B.newDeck().filter((c) => !usadas.has(c));
    baralhoFixo = quero.map((c) => c || resto.shift()).concat(resto);
  }

  const [w, h] = tam === 'min' ? [mod.size.minW, mod.size.minH] : [mod.size.w, mod.size.h];
  document.getElementById('titulo').textContent = `Pôquer · ${w}×${h}`;
  const palco = document.getElementById('palco');

  for (const p of PEERS) {
    const caixa = document.createElement('section');
    caixa.className = 'pessoa';
    caixa.dataset.usuario = p.id;
    const t = document.createElement('h2');
    t.textContent = `${p.name}${p.id === LIDER ? ' (líder)' : ''}`;
    const janela = document.createElement('div');
    janela.className = 'janela';
    janela.style.width = `${w}px`;
    janela.style.height = `${h}px`;
    const el = document.createElement('div');
    el.className = 'conteudo mesa-content';
    const alca = document.createElement('div');
    alca.className = 'alca';
    janela.append(el, alca);
    caixa.append(t, janela);
    palco.append(caixa);

    const negados = new Set();
    const api = {
      act: (a) => receber(p.id, a),
      validate: () => true,
      me: () => p.id,
      isLeader: () => p.id === LIDER,
      peers: () => PEERS,
      nameOf: (id) => (PEERS.find((x) => x.id === id) || {}).name || null,
      colorFor: (id) => CORES[id] || '#888888',
      serverNow: agora,
      onDenied(fn) { negados.add(fn); return () => negados.delete(fn); },
    };
    const inst = conteudo.mount(el, api);
    telas.set(p.id, { inst, negados });
    inst.update(mod.view(estado, p.id), null);
  }

  window.bancada = {
    estado: () => estado,
    view: (id) => mod.view(estado, id),
    act: (id, a) => receber(id, a),
    ajustar(fn) {
      estado = fn(JSON.parse(JSON.stringify(estado)));
      entregar(null);
    },
    arrumar,
    avancar(ms) { adiantado += ms; },
    log,
  };
  document.body.dataset.pronto = '1';
})();

// src/renderer/mesa-modules/lista.js
'use strict';

/*
 * Janela "Lista" da Mesa -- modulo PURO.
 *
 * Itens com caixa de marcar ("quem traz o que", "mapas para jogar"):
 * adicionar, marcar, editar, apagar, reordenar e apagar os marcados.
 *
 * Os itens sao enderecados por `id` e nao por posicao: duas pessoas mexendo
 * ao mesmo tempo nao marcam o item errado porque o outro reordenou antes. O
 * id nasce de `nextId` no proprio estado, entao todos os clientes geram o
 * mesmo. Marcar leva o valor (`done`) em vez de "inverter", para dois
 * cliques simultaneos nao se desfazerem.
 *
 * Contrato: docs/superpowers/plans/2026-09-24-mesa-contrato.md (secao 1).
 */

(function (root) {
  const TYPE = 'lista';
  const MAX_ITEMS = 40;
  const MAX_TEXT = 80;
  const MAX_TITLE = 40;

  function isObj(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isInt(v, min, max) {
    return Number.isInteger(v) && v >= min && v <= max;
  }

  function isId(v) {
    return isInt(v, 1, Number.MAX_SAFE_INTEGER);
  }

  function cleanText(v, max) {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    return v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function itemText(raw) {
    const t = cleanText(raw, MAX_TEXT);
    if (t === null) return { err: 'Texto inválido' };
    if (!t) return { err: 'O item não pode ficar vazio' };
    if (t.length > MAX_TEXT) return { err: `Item longo demais (máx. ${MAX_TEXT})` };
    return { text: t };
  }

  function indexOf(state, id) {
    return state.items.findIndex((it) => it.id === id);
  }

  function init() {
    return { title: '', items: [], nextId: 1 };
  }

  function parse(action) {
    if (!isObj(action) || typeof action.kind !== 'string') return 'Ação inválida';
    switch (action.kind) {
      case 'add': {
        const t = itemText(action.text);
        return t.err || { kind: 'add', text: t.text };
      }
      case 'check':
        if (!isId(action.id)) return 'Item inválido';
        if (typeof action.done !== 'boolean') return 'Marcação inválida';
        return { kind: 'check', id: action.id, done: action.done };
      case 'edit': {
        if (!isId(action.id)) return 'Item inválido';
        const t = itemText(action.text);
        return t.err || { kind: 'edit', id: action.id, text: t.text };
      }
      case 'remove':
        if (!isId(action.id)) return 'Item inválido';
        return { kind: 'remove', id: action.id };
      case 'move':
        if (!isId(action.id)) return 'Item inválido';
        if (!isInt(action.to, 0, MAX_ITEMS - 1)) return 'Posição inválida';
        return { kind: 'move', id: action.id, to: action.to };
      case 'clearDone':
        return { kind: 'clearDone' };
      case 'title': {
        const text = cleanText(action.text, MAX_TITLE);
        if (text === null) return 'Título inválido';
        if (text.length > MAX_TITLE) return `Título longo demais (máx. ${MAX_TITLE})`;
        return { kind: 'title', text };
      }
      default:
        return 'Ação desconhecida';
    }
  }

  function validate(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return a;
    switch (a.kind) {
      case 'add':
        return state.items.length >= MAX_ITEMS ? `A lista está cheia (máx. ${MAX_ITEMS})` : true;
      case 'check':
      case 'edit':
      case 'remove':
        return indexOf(state, a.id) === -1 ? 'Esse item não existe mais' : true;
      case 'move':
        if (indexOf(state, a.id) === -1) return 'Esse item não existe mais';
        return a.to < state.items.length ? true : 'Posição inválida';
      case 'clearDone':
        return state.items.some((it) => it.done) ? true : 'Nenhum item marcado';
      default:
        return true;
    }
  }

  function reduce(state, action) {
    const a = parse(action);
    if (typeof a === 'string') return state;
    switch (a.kind) {
      case 'add':
        if (state.items.length >= MAX_ITEMS || state.nextId >= Number.MAX_SAFE_INTEGER) return state;
        return {
          ...state,
          items: [...state.items, { id: state.nextId, text: a.text, done: false }],
          nextId: state.nextId + 1,
        };
      case 'check':
      case 'edit': {
        const i = indexOf(state, a.id);
        if (i === -1) return state;
        const patch = a.kind === 'check' ? { done: a.done } : { text: a.text };
        return { ...state, items: state.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) };
      }
      case 'remove': {
        if (indexOf(state, a.id) === -1) return state;
        return { ...state, items: state.items.filter((it) => it.id !== a.id) };
      }
      case 'move': {
        const i = indexOf(state, a.id);
        if (i === -1 || a.to >= state.items.length || a.to === i) return state;
        const items = state.items.slice();
        const [it] = items.splice(i, 1);
        items.splice(a.to, 0, it);
        return { ...state, items };
      }
      case 'clearDone':
        return { ...state, items: state.items.filter((it) => !it.done) };
      case 'title':
        return { ...state, title: a.text };
      default:
        return state;
    }
  }

  /** "Quem traz o quê: 3 de 7 feitos" ou "Lista: vazia". */
  function summary(state) {
    const n = state.items.length;
    const head = state.title || 'Lista';
    if (n === 0) return `${head}: vazia`;
    const done = state.items.filter((it) => it.done).length;
    return `${head}: ${done} de ${n} ${n === 1 ? 'feito' : 'feitos'}`;
  }

  const api = {
    type: TYPE,
    title: 'Lista',
    group: 'ferramentas',
    size: { w: 360, h: 440, minW: 260, minH: 240, aspect: null },
    maxStateBytes: 12288,
    MAX_ITEMS, MAX_TEXT, MAX_TITLE,
    init,
    validate,
    reduce,
    summary,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaModules = root.GoLive.mesaModules || {};
  root.GoLive.mesaModules[TYPE] = api;

  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

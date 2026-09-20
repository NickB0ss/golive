'use strict';

// Registro sem DOM para que a apresentacao possa mudar sem misturar estado,
// ordem e dispensa. A assinatura inclui tudo que a pessoa le ou aciona: se
// qualquer parte mudar, o aviso volta porque e uma informacao nova.
(function (root) {
  const PRIORIDADE = { grave: 0, atencao: 1, info: 2 };

  function signature(aviso) {
    return JSON.stringify({
      severidade: aviso.severidade,
      titulo: aviso.titulo,
      detalhe: aviso.detalhe,
      rotuloCurto: aviso.rotuloCurto || null,
      acao: aviso.acao || null,
      dispensavel: aviso.dispensavel === true,
    });
  }

  function create() {
    const entries = new Map();
    let nextOrder = 0;

    function visibleEntries() {
      return [...entries.values()]
        .filter((entry) => entry.dismissedSignature !== entry.signature)
        .sort((a, b) => PRIORIDADE[a.aviso.severidade] - PRIORIDADE[b.aviso.severidade] || a.order - b.order);
    }

    function set(id, aviso) {
      if (aviso === null) {
        entries.delete(id);
        return;
      }
      const previous = entries.get(id);
      entries.set(id, {
        aviso,
        id,
        order: previous ? previous.order : nextOrder++,
        signature: signature(aviso),
        dismissedSignature: previous ? previous.dismissedSignature : null,
      });
    }

    function list() {
      return visibleEntries().map(({ id, aviso }) => ({ id, ...aviso }));
    }

    function summary() {
      const visible = visibleEntries();
      const first = visible[0];
      return {
        total: visible.length,
        pior: first ? first.aviso.severidade : null,
        rotuloCurto: first?.aviso.rotuloCurto || null,
      };
    }

    function dismiss(id) {
      const entry = entries.get(id);
      if (!entry || !entry.aviso.dispensavel) return;
      entry.dismissedSignature = entry.signature;
    }

    return { set, list, summary, dismiss };
  }

  const api = { create };
  root.GoLive = root.GoLive || {};
  root.GoLive.warnings = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

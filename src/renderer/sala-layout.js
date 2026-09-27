'use strict';

(function (root) {
  function ordenarPresencas(pessoas) {
    const lista = Array.isArray(pessoas) ? pessoas.slice() : [];
    const porNome = (a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR');
    const aoVivo = lista.filter((pessoa) => pessoa.live).sort(porNome);
    const naSala = lista.filter((pessoa) => !pessoa.live).sort((a, b) => {
      if (a.isSelf) return 1;
      if (b.isSelf) return -1;
      return porNome(a, b);
    });
    return { aoVivo, naSala };
  }

  function recolhimentoAutomatico(largura, manual = {}) {
    const estreita = Number(largura) < 1280;
    const muitoEstreita = Number(largura) < 1100;
    return {
      pessoas: manual.pessoas || (estreita ? 'recolhido' : 'aberto'),
      chat: manual.chat || (muitoEstreita ? 'recolhido' : 'aberto'),
    };
  }

  const api = { ordenarPresencas, recolhimentoAutomatico };
  root.GoLive = root.GoLive || {};
  root.GoLive.salaLayout = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

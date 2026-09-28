'use strict';

(function (root) {
  function ordenarPresencas(pessoas) {
    const lista = Array.isArray(pessoas) ? pessoas.slice() : [];
    const porNome = (a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR');
    // `noAr` e o estado do no (tela, tela pausada ou camera); sem ele, so a tela conta.
    const noAr = (pessoa) => (pessoa.noAr ?? pessoa.live) === true;
    const aoVivo = lista.filter(noAr).sort(porNome);
    const naSala = lista.filter((pessoa) => !noAr(pessoa)).sort((a, b) => {
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

'use strict';

(function (root) {
  // A chave e `${peerId}:screen`, igual a origem e ao tipo do view-state.
  const OPCOES = [
    { id: 'auto', largura: null },
    { id: '1080p', largura: 1920 },
    { id: '720p', largura: 1280 },
    { id: '480p', largura: 854 },
  ];
  const escolhas = new Map();
  let consultarBloqueio = null;
  // O app republica o view-state por aqui: o transmissor so reage ao teto
  // quando ele sai no sinal.
  let avisarMudanca = null;

  function escolher(tileId, id) {
    if (!OPCOES.some((opcao) => opcao.id === id)) {
      throw new Error(`Qualidade desconhecida: ${id}`);
    }
    escolhas.set(String(tileId), id);
    avisarMudanca?.(String(tileId), id);
    return id;
  }

  function escolha(tileId) {
    return escolhas.get(String(tileId)) || 'auto';
  }

  function limpar(tileId) {
    escolhas.delete(String(tileId));
  }

  function combinar(escolhaLargura, larguraMesa) {
    if (escolhaLargura == null) return larguraMesa == null ? null : larguraMesa;
    if (larguraMesa == null) return escolhaLargura;
    return Math.min(escolhaLargura, larguraMesa);
  }

  function bloqueado(tileId) {
    return consultarBloqueio ? Boolean(consultarBloqueio(String(tileId))) : false;
  }

  function definirBloqueio(fn) {
    if (typeof fn !== 'function') throw new TypeError('A função de bloqueio é obrigatória.');
    consultarBloqueio = fn;
  }

  function definirAoMudar(fn) {
    if (typeof fn !== 'function') throw new TypeError('A função de aviso é obrigatória.');
    avisarMudanca = fn;
  }

  /** Largura em px da escolha daquele tile, ou null (auto). */
  function larguraEscolhida(tileId) {
    const id = escolha(tileId);
    return OPCOES.find((opcao) => opcao.id === id)?.largura ?? null;
  }

  const api = {
    OPCOES,
    escolher,
    escolha,
    larguraEscolhida,
    limpar,
    combinar,
    bloqueado,
    definirBloqueio,
    definirAoMudar,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.tetoRecebido = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

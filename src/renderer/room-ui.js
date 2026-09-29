'use strict';

(function (root) {
  function ordenarFontes(fontes) {
    const prioridade = { screen: 0, camera: 1 };
    return (Array.isArray(fontes) ? fontes : []).slice().sort((a, b) => {
      const tipo = (prioridade[a?.kind] ?? 2) - (prioridade[b?.kind] ?? 2);
      if (tipo) return tipo;
      return (Number(a?.startedAt) || 0) - (Number(b?.startedAt) || 0);
    });
  }

  function modoConversa(largura, preferencia = null) {
    if (['pinned', 'peek', 'closed'].includes(preferencia)) return preferencia;
    return Number(largura) >= 1180 ? 'pinned' : 'peek';
  }

  function estadoPessoa(pessoa = {}) {
    if (pessoa.live) return 'live';
    if (pessoa.mesa) return 'watching';
    return 'present';
  }

  // PIN escolhido por quem cria a sala (dialogo "Criar sala"): exatamente 6 digitos, como o servidor exige.
  const PIN_DA_SALA = /^\d{6}$/;

  /** Tira o que nao for digito e corta em 6 (digitacao e colagem no campo do PIN). */
  function soDigitosDoPin(texto) {
    return String(texto ?? '').replace(/\D/g, '').slice(0, 6);
  }

  function pinDaSalaValido(texto) {
    return PIN_DA_SALA.test(String(texto ?? ''));
  }

  /** Os tipos de sala sao exclusivos: sala "Mesa" so tem a Mesa, sala "Só transmissões" so tem o palco.
   * `vista` e 'mesa' ou qualquer outro nome ('tx', 'transmissao') para o palco. */
  function vistaPermitida(vista, temMesa) {
    return vista === 'mesa' ? Boolean(temMesa) : !temMesa;
  }

  /** Tile do barramento -> de quem e e se e tela ou camera ('cam-<id>' e camera; o resto e o id da tela). */
  function fonteDoTile(tileId) {
    const id = String(tileId ?? '');
    if (id.startsWith('cam-')) return { kind: 'camera', peerId: id.slice(4) };
    return { kind: 'screen', peerId: id };
  }

  /** O que o clique numa fonte do barramento faz: na Mesa leva a janela dela ('centralizar'); no palco escolhe
   * o que assistir ('assistir', ou 'somar' com Ctrl). O × de largar so existe no palco. */
  function cliqueDaFonte(temMesa, { ctrl = false } = {}) {
    if (temMesa) return 'centralizar';
    return ctrl ? 'somar' : 'assistir';
  }

  /** Controles que so fazem sentido escolhendo o que assistir no palco: "Ver junto", o × de largar e o
   * Modo teatro (o palco em tela cheia, sem barra). Numa sala Mesa as janelas visiveis decidem. */
  function controlesDoPalco(temMesa) {
    return !temMesa;
  }

  const api = {
    ordenarFontes,
    modoConversa,
    estadoPessoa,
    soDigitosDoPin,
    pinDaSalaValido,
    vistaPermitida,
    fonteDoTile,
    cliqueDaFonte,
    controlesDoPalco,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.roomUi = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

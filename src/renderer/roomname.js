'use strict';

// P1 (auditoria 2026-09-18, anexo 5-produto.md): normalizacao do nome da
// sala digitado no dialogo "Criar sala". Espelha a mesma disciplina do
// servidor (server/signaling-core.js normalizeRoomName) -- caracteres de
// controle viram espaco, espacos repetidos colapsam, as pontas sao
// aparadas, e o teto e o mesmo do campo `room` do protocolo. Duplicada (nao
// importada) de proposito: o servidor tambem roda sozinho via CLI
// (server/signaling.js), sem nenhum arquivo do renderer carregado.
(function (root) {
  const MAX_ROOM_NAME_CHARS = 40;

  // Loop em vez de regex com classe de controle: o eslint deste projeto
  // trava (no-control-regex) em qualquer intervalo de controle literal.
  function isControlChar(codePoint) {
    return codePoint <= 0x1f || codePoint === 0x7f;
  }

  /** @param {unknown} raw
   * @returns {string|null} nome limpo, ou null se ficou vazio depois de
   * limpo (quem chama decide o padrao -- "Sala de <nome de quem cria>"). */
  function normalizeRoomName(raw) {
    if (typeof raw !== 'string') return null;
    let semControle = '';
    for (const ch of raw) semControle += isControlChar(ch.codePointAt(0)) ? ' ' : ch;
    const colapsado = semControle.replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME_CHARS);
    return colapsado || null;
  }

  const api = { normalizeRoomName, MAX_ROOM_NAME_CHARS };
  root.GoLive = root.GoLive || {};
  root.GoLive.roomname = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

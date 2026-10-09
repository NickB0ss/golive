'use strict';

/*
 * Erro estruturado da SFU. O IPC do Electron perde a classe do erro, entao o
 * main converte para { code, message } antes de responder a pagina.
 */

class SfuError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SfuError';
    this.code = code;
  }
}

/** Forma serializavel de qualquer erro (nunca vaza stack para a pagina). */
function toErrorPayload(err) {
  if (err instanceof SfuError) return { code: err.code, message: err.message };
  // Erros do mediasoup (TypeError por parametro invalido, InvalidStateError...) viram um codigo unico.
  return { code: 'INTERNAL', message: String(err?.message || err).slice(0, 500) };
}

module.exports = { SfuError, toErrorPayload };

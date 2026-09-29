/*
 * Opcoes do `room:host` que vem do renderer, tratadas como entrada nao
 * confiavel: PIN escolhido por quem cria e tipo da sala. Logica pura, sem
 * electron -- por isso fica separada de main.js, que o node:test nao importa.
 */

'use strict';

const PIN_SEIS_DIGITOS = /^\d{6}$/;

/** Erro devolvido ao renderer quando o PIN escolhido nao tem 6 digitos. */
const ERRO_PIN_INVALIDO = 'PIN_INVALIDO';

/** Sorteio padrao: 6 digitos com zeros a esquerda. */
function sortearPin(randomInt) {
  return randomInt(0, 1000000).toString().padStart(6, '0');
}

/**
 * Decide o PIN da sala. O campo `pin` do payload tem dois donos que nunca
 * chegam juntos: quem cria a sala (PIN escolhido) e a migracao (o PIN da sala
 * que caiu, ja aceito pelo servidor antigo). Os dois valem so com `protect` e
 * so com 6 digitos; sem `pin` sorteia. Sem `protect` a sala e aberta.
 * @returns {{ ok: true, pin: string | null } | { ok: false, error: string }}
 */
function resolveRoomPin({ protect, pin, randomInt }) {
  if (!protect) return { ok: true, pin: null };
  if (pin === undefined || pin === null || pin === '') return { ok: true, pin: sortearPin(randomInt) };
  if (typeof pin !== 'string' || !PIN_SEIS_DIGITOS.test(pin)) return { ok: false, error: ERRO_PIN_INVALIDO };
  return { ok: true, pin };
}

/** Tipo da sala: so o `false` literal desliga a Mesa; o resto vale `true`. */
function resolveRoomMesa(mesa) {
  return mesa !== false;
}

module.exports = { ERRO_PIN_INVALIDO, resolveRoomPin, resolveRoomMesa };

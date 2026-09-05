'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialState, next, isBad, LIMITS } = require('./peerquality');

const OK = { atMs: 0, senderBandwidthLimited: false, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: false } };
const BW = { ...OK, senderBandwidthLimited: true };
// Decoder em software mas SEM travar -- decode dando conta (GPU do
// espectador desativada no Chromium, mas a CPU acompanha).
const SW = { ...OK, receiveHealth: { lossPct: 0, freezeRate: 0, softwareDecoder: true } };
const FREEZE = { ...OK, receiveHealth: { lossPct: 0.5, freezeRate: 30, softwareDecoder: false } };
const FREEZE_BY_LOSS = { ...OK, receiveHealth: { lossPct: 8, freezeRate: 30, softwareDecoder: false } };

// A carencia de sender novo (WARMUP_MS) tem bateria propria mais abaixo.
// Os testes da MECANICA da escada montam cenarios curtos a partir de
// atMs 0, entao dispensam a carencia explicitamente -- senao estariam
// medindo ela, e nao o que se propoem a medir.
const SEM_CARENCIA = { warmupMs: 0 };

// Aplica varias amostras, 1s entre elas.
function run(state, signals, startMs = 0) {
  let s = state;
  signals.forEach((sig, i) => { s = next(s, { ...sig, atMs: startMs + i * 1000 }, SEM_CARENCIA); });
  return s;
}

// Amostras a 1s de cadencia pra cruzar o tempo de sofrimento -- so pra
// montar cenarios de "ja degradado" sem depender de contagem magica.
const AMOSTRAS_ATE_DEGRADAR = Math.ceil(LIMITS.BAD_MS_TO_DEGRADE / 1000) + 1;

test('isBad: link limitado por banda e ruim', () => {
  assert.equal(isBad(BW, {}), true);
});

test('isBad: decoder em software que NAO trava nao e ruim sozinho', () => {
  assert.equal(isBad(SW, {}), false);
});

test('isBad: decoder em software QUE TRAVA e ruim -- pelo teste de freeze', () => {
  assert.equal(isBad({ ...OK, receiveHealth: { lossPct: 0.5, freezeRate: 30, softwareDecoder: true } }, {}), true);
});

test('isBad: travar MUITO com perda baixa e ruim (decode nao acompanha)', () => {
  assert.equal(isBad(FREEZE, {}), true);
});

test('isBad: travar com perda ALTA NAO e este caso -- o GCC ja trata banda', () => {
  assert.equal(isBad(FREEZE_BY_LOSS, {}), false);
});

test('isBad: receiveHealth ausente nao e ruim', () => {
  assert.equal(isBad({ ...OK, receiveHealth: null }, {}), false);
});

test('isBad: encoder saturado do peer (relay afogado) e ruim', () => {
  assert.equal(isBad({ ...OK, peerEncodeSaturated: true }, {}), true);
});

test('peerEncodeSaturated continuo desce um degrau', () => {
  let s = initialState();
  s = next(s, { atMs: 0, peerEncodeSaturated: true }, SEM_CARENCIA);
  s = next(s, { atMs: LIMITS.BAD_MS_TO_DEGRADE + 1, peerEncodeSaturated: true }, SEM_CARENCIA);
  assert.equal(s.steps, 1);
});

test('uma amostra ruim isolada nao degrada', () => {
  assert.equal(run(initialState(), [BW]).steps, 0);
});

test('sofrimento continuo por BAD_MS_TO_DEGRADE desce um degrau', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 }, SEM_CARENCIA);
  s = next(s, { ...BW, atMs: LIMITS.BAD_MS_TO_DEGRADE - 1 }, SEM_CARENCIA);
  assert.equal(s.steps, 0);
  s = next(s, { ...BW, atMs: LIMITS.BAD_MS_TO_DEGRADE + 1 }, SEM_CARENCIA);
  assert.equal(s.steps, 1);
  assert.equal(s.badSinceMs, LIMITS.BAD_MS_TO_DEGRADE + 1, 'relogio de sofrimento reinicia no degrau');
});

test('uma amostra boa no meio reinicia o relogio de sofrimento', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 }, SEM_CARENCIA);
  s = next(s, { ...OK, atMs: 2000 }, SEM_CARENCIA);
  s = next(s, { ...BW, atMs: 3000 }, SEM_CARENCIA);
  s = next(s, { ...BW, atMs: 3000 + LIMITS.BAD_MS_TO_DEGRADE - 1 }, SEM_CARENCIA);
  assert.equal(s.steps, 0);
});

test('poll lento (5s) ainda desce em ~BAD_MS_TO_DEGRADE, nao em 3 amostras', () => {
  let s = initialState();
  s = next(s, { ...BW, atMs: 0 }, SEM_CARENCIA);
  s = next(s, { ...BW, atMs: 5000 }, SEM_CARENCIA);
  assert.equal(s.steps, 1);
});

test('a escada por peer tem teto', () => {
  const muitas = Array(AMOSTRAS_ATE_DEGRADAR * (LIMITS.MAX_PEER_STEPS + 3)).fill(FREEZE);
  assert.equal(run(initialState(), muitas).steps, LIMITS.MAX_PEER_STEPS);
});

test('so sobe de volta depois da folga continua observada', () => {
  const degradado = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(BW));
  assert.equal(degradado.steps, 1);
  const t0 = AMOSTRAS_ATE_DEGRADAR * 1000;
  // primeira boa ancora o relogio
  const inicio = next(degradado, { ...OK, atMs: t0 }, SEM_CARENCIA);
  assert.equal(inicio.steps, 1);
  const cedo = next(inicio, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER - 1 }, SEM_CARENCIA);
  assert.equal(cedo.steps, 1);
  const naHora = next(cedo, { ...OK, atMs: t0 + LIMITS.GOOD_MS_TO_RECOVER + 1 }, SEM_CARENCIA);
  assert.equal(naHora.steps, 0);
});

test('uma ruim durante a espera cancela a recuperacao', () => {
  const degradado = run(initialState(), Array(AMOSTRAS_ATE_DEGRADAR).fill(BW));
  const t0 = AMOSTRAS_ATE_DEGRADAR * 1000;
  let s = next(degradado, { ...OK, atMs: t0 }, SEM_CARENCIA);
  s = next(s, { ...BW, atMs: t0 + 1000 }, SEM_CARENCIA);
  s = next(s, { ...OK, atMs: t0 + 2000 }, SEM_CARENCIA);
  s = next(s, { ...OK, atMs: t0 + 2000 + LIMITS.GOOD_MS_TO_RECOVER - 1 }, SEM_CARENCIA);
  assert.equal(s.steps, 1);
});

test('dois peers com estados separados nao se contaminam', () => {
  let a = initialState();
  let b = initialState();
  a = run(a, Array(AMOSTRAS_ATE_DEGRADAR).fill(BW));
  b = run(b, [OK, OK, OK]);
  assert.equal(a.steps, 1);
  assert.equal(b.steps, 0);
});

test('entrada indefinida nao lanca', () => {
  assert.equal(next(undefined, undefined).steps, 0);
});

// --- Carencia do sender recem-criado ---
//
// Uma conexao que acabou de nascer ainda nao mandou pacote nenhum: o
// estimador de banda do WebRTC comeca no piso e sobe. `limite=bandwidth`
// nos primeiros segundos e o ESTADO NORMAL de um sender novo, nao sinal de
// link ruim -- mas a escada lia como sofrimento e derrubava dois degraus
// antes de o primeiro quadro chegar do outro lado.
//
// Caso limpo, log de 2026-09-05, maquina do nicol:
//   04:58:09 tela->gg out=960x540@0fps limite=bandwidth realKbps=0   p0  <- nasceu agora
//   04:58:12 MUDOU                                                   p1  <- 3s depois, desce
//   04:58:19 MUDOU out=853x480                                       p2  <- 10s, no piso
//   04:58:22 MUDOU out=1280x720 limite=nenhum realKbps=565           p2  <- 13s, estava tudo bem
// Depois disso sao 40s de folga CONTINUA pra voltar ao topo. Toda conexao
// nova comecava estrangulada.

test('sender recem-criado nao desce durante a carencia, mesmo com banda limitada', () => {
  const amostras = Math.ceil(LIMITS.WARMUP_MS / 1000);
  let s = initialState();
  for (let i = 0; i < amostras; i += 1) s = next(s, { ...BW, atMs: i * 1000 });
  assert.equal(s.steps, 0);
});

test('passada a carencia, banda limitada volta a derrubar normalmente', () => {
  let s = initialState();
  const fim = LIMITS.WARMUP_MS + LIMITS.BAD_MS_TO_DEGRADE + 2000;
  for (let t = 0; t <= fim; t += 1000) s = next(s, { ...BW, atMs: t });
  assert.ok(s.steps > 0, 'a carencia adia, nao desliga a escada');
});

test('a carencia nao conta como folga: nao sobe degrau de graca', () => {
  // Estado ja degradado (peer que sofreu antes) com o relogio zerado: a
  // carencia nao pode virar GOOD_MS_TO_RECOVER de presente.
  let s = { steps: 2, badSinceMs: null, goodSinceMs: null };
  for (let t = 0; t < LIMITS.WARMUP_MS; t += 1000) s = next(s, { ...OK, atMs: t });
  assert.equal(s.steps, 2);
});

test('o relogio da carencia ancora na PRIMEIRA amostra, nao no zero', () => {
  // updateStats roda desde que a sala abriu; o sender pode nascer minutos
  // depois. A carencia tem de contar a partir da primeira amostra DELE.
  const t0 = 3_600_000;
  let s = initialState();
  for (let t = t0; t < t0 + LIMITS.WARMUP_MS; t += 1000) s = next(s, { ...BW, atMs: t });
  assert.equal(s.steps, 0);
});

test('o caso do log: 13s de banda limitada num sender novo nao degrada nada', () => {
  let s = initialState();
  // 04:58:09 -> 04:58:22, cadencia de 1s, tudo com limite=bandwidth.
  for (let t = 0; t <= 13_000; t += 1000) s = next(s, { ...BW, atMs: t });
  assert.equal(s.steps, 0, 'antes desta correcao terminava em 2 degraus');
});

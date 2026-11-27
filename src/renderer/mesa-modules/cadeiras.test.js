'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('./cadeiras');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS }, extra);
// Como o servidor aplica: prepare com peers, reduce com o ctx dos clientes.
const sit = (state, seat, from) =>
  C.reduceSeat(state, C.prepareSeat(state, { kind: 'sit', seat }, ctx(from)), { from, isLeader: false });

test('sit guarda o id e o nome de quem sentou', () => {
  const s = sit(C.emptySeats(), 1, 'leo');
  assert.deepEqual(s, { seats: [null, 'leo'], names: [null, 'Leo'] });
});

test('o nome vem da acao preparada: servidor e clientes chegam ao mesmo estado', () => {
  const acao = C.prepareSeat(C.emptySeats(), { kind: 'sit', seat: 0, name: 'Forjado' }, ctx('bia'));
  assert.deepEqual(acao, { kind: 'sit', seat: 0, name: 'Bia' });
  const servidor = C.reduceSeat(C.emptySeats(), acao, ctx('bia'));
  const cliente = C.reduceSeat(C.emptySeats(), acao, { from: 'bia', isLeader: false });
  assert.deepEqual(cliente, servidor);
  // Sem prepare (acao crua), o reduce nao inventa nome a partir de peers.
  assert.deepEqual(C.reduceSeat(C.emptySeats(), { kind: 'sit', seat: 0 }, ctx('bia')).names, [null, null]);
});

test('sit recusa cadeira ocupada, cadeira invalida e quem ja esta sentado', () => {
  const s = sit(C.emptySeats(), 0, 'bia');
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 0 }, ctx('leo')), 'mesa.cadeiras.ocupada');
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 1 }, ctx('bia')), 'mesa.jogo.jaEstaSentado');
  for (const seat of [2, -1, '0', 0.5, null, undefined]) {
    assert.equal(C.validateSeat(s, { kind: 'sit', seat }, ctx('leo')), 'mesa.cadeiras.invalida');
  }
  assert.equal(C.validateSeat(s, { kind: 'sit', seat: 1 }, {}), 'mesa.jogo.quemMandou');
});

test('stand so vale para quem esta sentado e libera a cadeira', () => {
  const s = sit(C.emptySeats(), 0, 'bia');
  assert.equal(C.validateSeat(s, { kind: 'stand' }, ctx('leo')), 'mesa.cadeiras.naoEstaSentado');
  assert.equal(C.validateSeat(s, { kind: 'stand' }, ctx('bia')), true);
  assert.deepEqual(C.reduceSeat(s, { kind: 'stand' }, ctx('bia')), C.emptySeats());
});

test('sit sem nome na lista de peers guarda nome nulo', () => {
  const s = sit(C.emptySeats(), 0, 'zeca');
  assert.deepEqual(s.names, [null, null]);
  assert.equal(C.nameOf(s, 0, ['Brancas', 'Pretas']), 'Brancas');
});

test('dropPeer libera a cadeira e devolve o mesmo estado se a pessoa assistia', () => {
  const s = { seats: ['bia', 'leo'], names: ['Bia', 'Leo'], outro: 1 };
  assert.deepEqual(C.dropPeer(s, 'leo'), { seats: ['bia', null], names: ['Bia', null], outro: 1 });
  assert.equal(C.dropPeer(s, 'ana'), s);
});

test('canReset aceita sentado ou lider e recusa quem so assiste', () => {
  const s = { seats: ['bia', null], names: ['Bia', null] };
  assert.equal(C.canReset(s, ctx('bia')), true);
  assert.equal(C.canReset(s, ctx('ana', { isLeader: true })), true);
  assert.equal(C.canReset(s, ctx('ana')), 'mesa.cadeiras.soSentadoOuLiderRecomeca');
});

test('canPlay exige cadeira, adversario, vez e partida em andamento', () => {
  const s = { seats: ['bia', 'leo'], names: ['Bia', 'Leo'], result: null };
  assert.equal(C.canPlay(s, ctx('bia'), 0), true);
  assert.equal(C.canPlay(s, ctx('leo'), 0), 'mesa.jogo.naoESuaVez');
  assert.equal(C.canPlay(s, ctx('ana'), 0), 'mesa.jogo.senteSeParaJogar');
  assert.equal(C.canPlay({ ...s, seats: ['bia', null] }, ctx('bia'), 0), 'mesa.cadeiras.esperaOutra');
  assert.equal(C.canPlay({ ...s, result: { winner: 0 } }, ctx('bia'), 0), 'mesa.cadeiras.partidaAcabou');
});

test('describePlaying cobre cadeiras vazias, meia e cheia', () => {
  const L = ['X', 'O'];
  assert.deepEqual(C.describePlaying({ seats: [null, null], names: [null, null] }, 0, L), { chave: 'mesa.resumo.cadeirasLivres' });
  assert.deepEqual(C.describePlaying({ seats: [null, 'leo'], names: [null, 'Leo'] }, 0, L), {
    chave: 'mesa.resumo.esperaAdversario', valores: { nome: 'Leo' },
  });
  assert.deepEqual(C.describePlaying({ seats: ['bia', 'leo'], names: ['Bia', 'Leo'] }, 1, L), {
    chave: 'mesa.resumo.vezDe', valores: { a: 'Bia', b: 'Leo', vez: 'Leo' },
  });
});

test('nameOf prefere o nome atual da sala quando a lista vem', () => {
  const s = { seats: ['bia', null], names: ['Bia', null] };
  assert.equal(C.nameOf(s, 0, ['X', 'O'], [{ id: 'bia', name: 'Beatriz' }]), 'Beatriz');
  assert.equal(C.nameOf(s, 0, ['X', 'O'], []), 'Bia');
});

test('nome longo e cortado no teto', () => {
  const long = 'a'.repeat(100);
  const c = { from: 'x', peers: [{ id: 'x', name: long }] };
  const s = C.reduceSeat(C.emptySeats(), C.prepareSeat(C.emptySeats(), { kind: 'sit', seat: 0 }, c), c);
  assert.equal(s.names[0].length, C.NAME_MAX);
});

test('safe troca excecao pelo valor reserva', () => {
  assert.equal(C.safe(() => { throw new Error('x'); }, 'reserva'), 'reserva');
  assert.equal(C.safe(() => 1, 'reserva'), 1);
});

// ---- Auditoria da Mesa 2026-11-25 (J-04): cadeira de id que saiu da sala (migracao) conta como livre ----

const JOGOS = ['velha', 'lig4', 'damas', 'xadrez'].map((nome) => [nome, require(`./${nome}`)]);
// Depois da migracao os ids sao outros: "1" e "2" eram os de antes, "7" e "8" sao os de agora.
const NOVOS = [{ id: '7', name: 'Ana' }, { id: '8', name: 'Bia' }];
const comoServidor = (mod, state, action, from, peers = NOVOS) => {
  const c = { from, isLeader: false, peers, now: 1e12 };
  const veredito = mod.validate(state, action, c);
  if (veredito !== true) return { erro: veredito };
  const preparada = JSON.parse(JSON.stringify(mod.prepare ? mod.prepare(state, action, c) : action));
  // O reduce so recebe { from, isLeader } (src/renderer/mesa.js applyOp): sem peers.
  return { estado: mod.reduce(state, preparada, { from, isLeader: false }) };
};

for (const [nome, mod] of JOGOS) {
  test(`J-04 ${nome}: depois da migracao as cadeiras de ids antigos nao travam ninguem`, () => {
    const migrado = Object.assign(mod.init({}), { seats: ['1', '2'], names: ['Ana', 'Bia'] });
    let r = comoServidor(mod, migrado, { kind: 'sit', seat: 0 }, '7');
    assert.equal(r.erro, undefined, 'senta na cadeira do fantasma');
    assert.deepEqual(r.estado.seats, ['7', '2']);
    assert.deepEqual(r.estado.names, ['Ana', 'Bia'], 'o nome do fantasma some so quando a cadeira e retomada');
    // Com a outra cadeira ainda de fantasma, ninguem joga: falta adversario.
    const jogo = nome === 'velha' ? { kind: 'move', cell: 0 } : null;
    if (jogo) assert.equal(comoServidor(mod, r.estado, jogo, '7').erro, 'mesa.cadeiras.esperaOutra');
    r = comoServidor(mod, r.estado, { kind: 'sit', seat: 1 }, '8');
    assert.equal(r.erro, undefined);
    assert.deepEqual(r.estado.seats, ['7', '8']);
    assert.deepEqual(r.estado.names, ['Ana', 'Bia']);
    // E depois de sentados, levantar e nova partida funcionam.
    assert.equal(comoServidor(mod, r.estado, { kind: 'stand' }, '7').estado.seats[0], null);
    assert.equal(mod.validate(r.estado, { kind: 'reset' }, { from: '7', peers: NOVOS }), true);
  });

  test(`J-04 ${nome}: cadeira de quem esta na sala continua ocupada`, () => {
    const s = Object.assign(mod.init({}), { seats: ['7', null], names: ['Ana', null] });
    assert.equal(comoServidor(mod, s, { kind: 'sit', seat: 0 }, '8').erro, 'mesa.cadeiras.ocupada');
  });

  test(`J-04 ${nome}: a acao crua do cliente nao ganha a cadeira de quem esta na sala com \`fantasma\``, () => {
    const s = Object.assign(mod.init({}), { seats: ['7', null], names: ['Ana', null] });
    const c = { from: '8', isLeader: false, peers: NOVOS };
    assert.equal(mod.validate(s, { kind: 'sit', seat: 0, fantasma: true }, c), 'mesa.cadeiras.ocupada');
  });
}

test('J-04: semFantasmas zera so as cadeiras de ids fora da sala (interface e resumo)', () => {
  const s = { seats: ['1', '8'], names: ['Ana', 'Bia'] };
  assert.deepEqual(C.semFantasmas(s, NOVOS), { seats: [null, '8'], names: [null, 'Bia'] });
  assert.equal(C.semFantasmas(s, undefined), s, 'sem lista de peers, nada muda');
  const ok = { seats: ['7', '8'], names: ['Ana', 'Bia'] };
  assert.equal(C.semFantasmas(ok, NOVOS), ok);
  assert.deepEqual(C.describePlaying(s, 0, ['A', 'B'], NOVOS).chave, 'mesa.resumo.esperaAdversario');
});

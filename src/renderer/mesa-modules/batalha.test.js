'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const batalha = require('./batalha');
const registry = require('./index');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];

/** Sorte repetivel (LCG), para as frotas sairem sempre iguais. */
function semente(n) {
  let x = n >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

let agora = 1000;
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS, now: agora, random: semente(agora) }, extra);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** Como no servidor: validate na acao do cliente, prepare, reduce. */
function act(state, action, from, extra) {
  const c = ctx(from, extra);
  assert.equal(batalha.validate(state, action, c), true, JSON.stringify(action));
  const prepared = JSON.parse(JSON.stringify(batalha.prepare(deepFreeze(state), action, c)));
  return deepFreeze(batalha.reduce(deepFreeze(state), prepared, { from, isLeader: c.isLeader }));
}

function sentados() {
  let s = deepFreeze(batalha.init({}));
  s = act(s, { kind: 'sit', seat: 0 }, 'bia');
  agora += 1;
  return act(s, { kind: 'sit', seat: 1 }, 'leo');
}

function jogando() {
  let s = sentados();
  s = act(s, { kind: 'ready' }, 'bia');
  return act(s, { kind: 'ready' }, 'leo');
}

/** Todas as casas de navio da frota da cadeira `i`. */
function casasDe(s, i) {
  return s.fleets[i].flat();
}

function aguas(s, i) {
  const navio = new Set(casasDe(s, i));
  return Array.from({ length: 100 }, (_, x) => x).filter((x) => !navio.has(x));
}

test('descritor segue o contrato e passa no registro como secret', () => {
  assert.equal(batalha.type, 'batalha');
  assert.equal(batalha.title, 'Batalha naval');
  assert.equal(batalha.group, 'jogos');
  assert.equal(batalha.secret, true);
  const res = registry.checkModule(batalha);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.module.secret, true);
  assert.ok(registry.MODULE_NAMES.includes('batalha'));
});

test('frota sorteada: 5 navios retos, 5-4-3-3-2, sem se encostar', () => {
  for (let n = 1; n < 60; n++) {
    const frota = batalha.randomFleet(semente(n));
    assert.equal(batalha.isFleet(frota), true, `semente ${n}`);
    assert.deepEqual(frota.map((c) => c.length), [5, 4, 3, 3, 2]);
    const dono = new Map();
    frota.forEach((casas, k) => casas.forEach((x) => dono.set(x, k)));
    for (const [x, k] of dono) {
      const l = Math.floor(x / 10);
      const c = x % 10;
      for (let dl = -1; dl <= 1; dl++) {
        for (let dc = -1; dc <= 1; dc++) {
          const ll = l + dl;
          const cc = c + dc;
          if (ll < 0 || ll > 9 || cc < 0 || cc > 9) continue;
          const outro = dono.get(ll * 10 + cc);
          assert.ok(outro === undefined || outro === k, `navios encostados na semente ${n}`);
        }
      }
    }
  }
  // Sorte ruim (sempre 0) ainda da uma frota valida.
  assert.equal(batalha.isFleet(batalha.randomFleet(() => 0)), true);
});

test('isFleet recusa frota torta, repetida ou fora do mar', () => {
  const ok = batalha.randomFleet(semente(3));
  assert.equal(batalha.isFleet(ok), true);
  assert.equal(batalha.isFleet(ok.slice(0, 4)), false);
  assert.equal(batalha.isFleet([[0, 1, 2, 3, 5], ...ok.slice(1)]), false, 'buraco');
  assert.equal(batalha.isFleet([[8, 9, 10, 11, 12], ...ok.slice(1)]), false, 'dobra a linha');
  assert.equal(batalha.isFleet([[96, 97, 98, 99, 100], ...ok.slice(1)]), false, 'fora do mar');
  assert.equal(batalha.isFleet([ok[0], ok[0].slice(0, 4), ...ok.slice(2)]), false, 'repetida');
  assert.equal(batalha.isFleet(null), false);
});

test('sentar sorteia a frota no servidor; a fleet mandada pelo cliente e jogada fora', () => {
  const s0 = deepFreeze(batalha.init({}));
  const minha = batalha.randomFleet(semente(99));
  const c = ctx('bia');
  const prep = batalha.prepare(s0, { kind: 'sit', seat: 0, fleet: minha }, c);
  assert.equal(prep.name, 'Bia');
  assert.equal(batalha.isFleet(prep.fleet), true);
  assert.notDeepEqual(prep.fleet, minha);
  const s = batalha.reduce(s0, prep, { from: 'bia' });
  assert.deepEqual(s.seats, ['bia', null]);
  assert.deepEqual(s.fleets[0], prep.fleet);
  assert.equal(s.fleets[1], null);
  // Sem o prepare, a acao do cliente nunca chega ao reduce; e o shuffle
  // tambem so troca pela frota que o prepare sorteou.
  const p2 = batalha.prepare(s, { kind: 'shuffle', fleet: minha }, ctx('bia'));
  assert.notDeepEqual(p2.fleet, minha);
});

test('sortear de novo so antes de ficar pronto; comeca com os dois prontos', () => {
  let s = sentados();
  const antes = s.fleets[0];
  agora += 7;
  s = act(s, { kind: 'shuffle' }, 'bia');
  assert.notDeepEqual(s.fleets[0], antes);
  assert.equal(batalha.validate(s, { kind: 'fire', cell: 0 }, ctx('bia')), 'Esperando os dois ficarem prontos');
  s = act(s, { kind: 'ready' }, 'bia');
  assert.equal(batalha.validate(s, { kind: 'shuffle' }, ctx('bia')), 'Você já disse que está pronto');
  assert.equal(s.phase, 'setup');
  agora = 5000;
  s = act(s, { kind: 'ready' }, 'leo');
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  assert.equal(s.deadline, 5000 + batalha.TURN_MS);
  assert.equal(batalha.timeoutAt(s), 5000 + batalha.TURN_MS);
  assert.equal(batalha.validate(s, { kind: 'shuffle' }, ctx('leo')), 'A partida já começou');
});

test('tiro por vez, alternado: acertar nao da outro tiro', () => {
  let s = jogando();
  const alvo = casasDe(s, 1)[0];
  s = act(s, { kind: 'fire', cell: alvo }, 'bia');
  assert.deepEqual(s.last, { seat: 0, cell: alvo, hit: true, sunk: null });
  assert.equal(s.turn, 1, 'acertou e mesmo assim passa a vez');
  assert.equal(batalha.validate(s, { kind: 'fire', cell: 0 }, ctx('bia')), 'Não é a sua vez');
  assert.equal(batalha.validate(s, { kind: 'fire', cell: 0 }, ctx('ana')), 'Sente-se para jogar');
  const agua = aguas(s, 0)[0];
  s = act(s, { kind: 'fire', cell: agua }, 'leo');
  assert.equal(s.last.hit, false);
  assert.equal(batalha.validate(s, { kind: 'fire', cell: alvo }, ctx('bia')), 'Você já atirou aí');
  assert.equal(batalha.validate(s, { kind: 'fire', cell: 100 }, ctx('bia')), 'Casa inválida');
});

test('afundar os 5 navios vence; navio afundado aparece inteiro para todos', () => {
  let s = jogando();
  const alvos = casasDe(s, 1);
  const aguaLeo = aguas(s, 0);
  alvos.forEach((cell, i) => {
    s = act(s, { kind: 'fire', cell }, 'bia');
    if (i === 4) {
      // O porta-avioes (5 casas) afundou no quinto tiro.
      assert.equal(s.last.sunk, 0);
      const v = batalha.view(s, 'ana', { peers: PEERS });
      assert.deepEqual(v.boards[1].ships.map((n) => n.cells), [s.fleets[1][0]]);
      assert.equal(v.boards[1].left, 4);
    }
    if (!s.result) s = act(s, { kind: 'fire', cell: aguaLeo[i] }, 'leo');
  });
  assert.deepEqual(s.result, { winner: 0, reason: 'afundou' });
  assert.equal(s.deadline, null);
  assert.equal(batalha.timeoutAt(s), null);
  assert.equal(batalha.validate(s, { kind: 'fire', cell: aguas(s, 1)[0] }, ctx('bia')), 'A partida acabou');
  // No fim as duas frotas aparecem.
  const v = batalha.view(s, 'ana', { peers: PEERS });
  assert.equal(v.boards[0].ships.length, 5);
  assert.equal(v.boards[1].ships.length, 5);
  assert.equal(batalha.summary(s), 'Bia venceu');
});

test('view: o dono ve os proprios navios; o adversario e quem assiste, so tiros e afundados', () => {
  let s = jogando();
  const alvo = casasDe(s, 1)[2]; // um tiro no encouracado do Leo, sem afundar
  s = act(s, { kind: 'fire', cell: alvo }, 'bia');
  const deBia = batalha.view(s, 'bia', { peers: PEERS });
  const deLeo = batalha.view(s, 'leo', { peers: PEERS });
  const deAna = batalha.view(s, 'ana', { peers: PEERS });
  const deNinguem = batalha.view(s, null, { peers: PEERS });

  assert.equal(deBia.me.seat, 0);
  assert.equal(deBia.boards[0].ships.length, 5, 'Bia ve a propria frota');
  assert.equal(deBia.boards[1].ships.length, 0, 'e nao a do Leo');
  assert.deepEqual(deBia.boards[1].shots, [[alvo, 1]]);
  assert.equal(deLeo.boards[1].ships.length, 5);
  assert.equal(deLeo.boards[0].ships.length, 0);

  for (const v of [deAna, deNinguem]) {
    assert.equal(v.me.seat, -1);
    assert.equal(v.boards[0].ships.length, 0);
    assert.equal(v.boards[1].ships.length, 0);
    assert.deepEqual(v.boards[1].shots, [[alvo, 1]]);
  }
  // Nenhuma casa de navio da Bia que nao levou tiro aparece em nada que o
  // Leo recebe (nem em `fleets`, que nao existe na view).
  const texto = JSON.stringify(deLeo);
  assert.equal(deLeo.fleets, undefined);
  assert.ok(!texto.includes(JSON.stringify(s.fleets[0][0])));
  assert.equal(JSON.stringify(deAna).includes(JSON.stringify(s.fleets[1][0])), false);
});

test('view traz o que a interface precisa para ligar botoes', () => {
  let s = sentados();
  let v = batalha.view(s, 'bia', { peers: PEERS });
  assert.equal(v.me.can.shuffle, true);
  assert.equal(v.me.can.ready, true);
  assert.equal(v.me.can.fire, false);
  assert.deepEqual(v.me.can.sit, [false, false]);
  v = batalha.view(s, 'ana', { peers: PEERS });
  assert.deepEqual(v.me.can.sit, [false, false], 'as duas ocupadas');
  assert.equal(v.me.can.reset, false, 'quem assiste nao recomeca');
  s = act(s, { kind: 'ready' }, 'bia');
  s = act(s, { kind: 'ready' }, 'leo');
  assert.equal(batalha.view(s, 'bia', { peers: PEERS }).me.can.fire, true);
  assert.equal(batalha.view(s, 'leo', { peers: PEERS }).me.can.fire, false);
  assert.equal(batalha.view(s, null, { peers: PEERS }).me.can.fire, false);
});

test('tempo esgotado: o tiro sai sozinho numa casa sorteada ainda livre, e a vez passa', () => {
  let s = jogando();
  assert.equal(batalha.validate(s, { kind: 'timeout' }, ctx('ana')), true, 'qualquer um na Mesa manda');
  agora = 90000;
  const prep = batalha.prepare(s, { kind: 'timeout' }, ctx('ana'));
  assert.equal(prep.at, 90000);
  assert.ok(!s.shots[1].includes(prep.cell));
  s = deepFreeze(batalha.reduce(s, prep, { from: 'ana' }));
  assert.equal(s.shots[1].length, 1);
  assert.equal(s.last.seat, 0, 'o tiro e de quem tinha a vez');
  assert.equal(s.turn, 1);
  assert.equal(s.deadline, 90000 + batalha.TURN_MS);
  const cedo = sentados();
  assert.equal(batalha.validate(cedo, { kind: 'timeout' }, ctx('ana')), 'Nada correndo');
  assert.equal(batalha.timeoutAt(cedo), null);
});

test('desistir da a vitoria ao outro; nova partida sorteia frotas novas para quem esta sentado', () => {
  let s = jogando();
  assert.equal(batalha.validate(s, { kind: 'resign' }, ctx('ana')), 'Só quem está sentado desiste');
  s = act(s, { kind: 'resign' }, 'leo');
  assert.deepEqual(s.result, { winner: 0, reason: 'abandono' });
  assert.equal(batalha.validate(s, { kind: 'reset' }, ctx('ana')), 'Só quem está sentado ou o líder recomeça');
  agora += 13;
  s = act(s, { kind: 'reset' }, 'ana', { isLeader: true });
  assert.equal(s.phase, 'setup');
  assert.equal(s.result, null);
  assert.deepEqual(s.shots, [[], []]);
  assert.deepEqual(s.ready, [false, false]);
  assert.equal(batalha.isFleet(s.fleets[0]) && batalha.isFleet(s.fleets[1]), true);
  assert.deepEqual(s.seats, ['bia', 'leo']);
});

test('quem sai posicionando leva a frota; no meio da partida a frota fica para quem sentar', () => {
  let s = sentados();
  let d = batalha.dropPeer(s, 'leo');
  assert.deepEqual(d.seats, ['bia', null]);
  assert.equal(d.fleets[1], null);
  assert.equal(batalha.dropPeer(s, 'ana'), s, 'quem nao estava sentado nao muda nada');

  s = jogando();
  const frotaLeo = s.fleets[1];
  d = deepFreeze(batalha.dropPeer(s, 'leo'));
  assert.deepEqual(d.seats, ['bia', null]);
  assert.deepEqual(d.fleets[1], frotaLeo);
  assert.equal(batalha.timeoutAt(d), null, 'sem adversario o relogio para');
  assert.equal(batalha.validate(d, { kind: 'fire', cell: 0 }, ctx('bia')), 'Espere alguém sentar na outra cadeira');
  agora = 70000;
  d = act(d, { kind: 'sit', seat: 1 }, 'ana');
  assert.deepEqual(d.fleets[1], frotaLeo, 'Ana continua com a frota do Leo');
  assert.equal(d.deadline, 70000 + batalha.TURN_MS);
});

test('migrate cancela a partida e nao leva segredo nenhum; cadeira de id que sumiu fica livre', () => {
  let s = jogando();
  s = act(s, { kind: 'fire', cell: casasDe(s, 1)[0] }, 'bia');
  const m = batalha.migrate(s);
  assert.deepEqual(m.fleets, [null, null]);
  assert.deepEqual(m.shots, [[], []]);
  assert.equal(m.phase, 'setup');
  assert.deepEqual(m.seats, ['bia', 'leo']);
  for (const casas of s.fleets.flat()) assert.ok(!JSON.stringify(m).includes(JSON.stringify(casas)));
  // No servidor novo os ids mudaram: as cadeiras antigas contam como livres.
  const novos = [{ id: '40', name: 'Bia' }];
  const c = { from: '40', peers: novos, now: 1, random: semente(1) };
  assert.equal(batalha.validate(m, { kind: 'sit', seat: 0 }, c), true);
  assert.deepEqual(batalha.view(m, '40', { peers: novos }).seats, [null, null]);
  const s2 = batalha.reduce(m, batalha.prepare(m, { kind: 'sit', seat: 0 }, c), c);
  assert.deepEqual(s2.seats, ['40', 'leo']);
  assert.equal(batalha.isFleet(s2.fleets[0]), true);
});

test('o estado inteiro da partida mais longa cabe no teto', () => {
  let s = jogando();
  const aguasLeo = aguas(s, 1);
  const aguasBia = aguas(s, 0);
  for (let i = 0; i < 80; i++) {
    s = act(s, { kind: 'fire', cell: aguasLeo[i] }, 'bia');
    s = act(s, { kind: 'fire', cell: aguasBia[i] }, 'leo');
  }
  assert.ok(JSON.stringify(s).length < batalha.maxStateBytes, String(JSON.stringify(s).length));
  assert.ok(JSON.stringify(batalha.view(s, 'bia', { peers: PEERS })).length < 8192);
});

test('acao estranha nunca lanca', () => {
  const s = sentados();
  for (const a of [null, 1, 'x', {}, { kind: 'voa' }, { kind: 'fire', cell: 'a' }, { kind: 'sit', seat: 7 }]) {
    assert.equal(typeof batalha.validate(s, a, ctx('bia')), 'string');
    assert.doesNotThrow(() => batalha.reduce(s, a, { from: 'bia' }));
  }
  assert.equal(batalha.view(null, 'bia'), null);
  assert.equal(batalha.summary(null), 'Batalha naval');
});

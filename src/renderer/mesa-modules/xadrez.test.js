'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const xadrez = require('./xadrez');
const chessjs = require('../vendor/chess.js');

const PEERS = [{ id: 'bia', name: 'Bia' }, { id: 'leo', name: 'Leo' }, { id: 'ana', name: 'Ana' }];
const ctx = (from, extra) => Object.assign({ from, isLeader: false, peers: PEERS }, extra);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function act(state, action, from, extra) {
  const c = ctx(from, extra);
  assert.equal(xadrez.validate(state, action, c), true, JSON.stringify(action));
  return deepFreeze(xadrez.reduce(deepFreeze(state), action, c));
}

function seated() {
  let s = deepFreeze(xadrez.init({}));
  s = act(s, { kind: 'sit', seat: 0 }, 'bia');
  return act(s, { kind: 'sit', seat: 1 }, 'leo');
}

/** Posicao arbitraria com as duas cadeiras ocupadas. */
function fromFen(fen) {
  const turn = fen.split(' ')[1] === 'w' ? 0 : 1;
  return deepFreeze(Object.assign({}, seated(), { fen, seen: [], turn }));
}

const who = (s) => (s.turn === 0 ? 'bia' : 'leo');

/** Joga uma lista de lances em UCI ('e2e4', 'e7e8q'). */
function playUci(s, list) {
  for (const uci of list) {
    const action = { kind: 'move', from: uci.slice(0, 2), to: uci.slice(2, 4) };
    if (uci[4]) action.promotion = uci[4];
    s = act(s, action, who(s));
  }
  return s;
}

test('descritor segue o contrato', () => {
  assert.equal(xadrez.type, 'xadrez');
  assert.equal(xadrez.title, 'Xadrez');
  assert.equal(xadrez.group, 'jogos');
  assert.equal(xadrez.size.aspect, 1);
});

test('chess.js vendorizado carrega por require com a API esperada', () => {
  assert.equal(typeof chessjs.Chess, 'function');
  assert.equal(chessjs.DEFAULT_POSITION, xadrez.init({}).fen);
});

test('no renderer os arquivos carregam por <script>, sem require', () => {
  const dir = path.join(__dirname, '..');
  const context = vm.createContext({ window: {} });
  for (const file of ['vendor/chess.js', 'mesa-modules/cadeiras.js', 'mesa-modules/velha.js',
    'mesa-modules/lig4.js', 'mesa-modules/damas.js', 'mesa-modules/xadrez.js']) {
    vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  }
  const G = context.window.GoLive;
  assert.equal(typeof G.chessjs.Chess, 'function');
  assert.deepEqual(Object.keys(G.mesaModules).sort(), ['damas', 'lig4', 'velha', 'xadrez']);
  let s = G.mesaModules.xadrez.init({});
  s = G.mesaModules.xadrez.reduce(s, { kind: 'sit', seat: 0 }, { from: 'bia' });
  s = G.mesaModules.xadrez.reduce(s, { kind: 'sit', seat: 1 }, { from: 'leo' });
  s = G.mesaModules.xadrez.reduce(s, { kind: 'move', from: 'e2', to: 'e4' }, { from: 'bia' });
  assert.equal(JSON.stringify(s.san), '["e4"]'); // outro realm: compara pelo JSON
});

test('init: posicao inicial, brancas (cadeira 0) comecam', () => {
  const s = xadrez.init({});
  assert.equal(s.turn, 0);
  assert.deepEqual(s.seats, [null, null]);
  assert.equal(xadrez.summary(s), 'Cadeiras livres');
  assert.equal(xadrez.summary(seated()), 'Bia × Leo — vez de Bia');
});

test('lance legal atualiza fen, san, vez e ultimo lance', () => {
  const s = playUci(seated(), ['e2e4']);
  assert.equal(s.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  assert.deepEqual(s.san, ['e4']);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.last, { from: 'e2', to: 'e4' });
  assert.equal(xadrez.summary(s), 'Bia × Leo — vez de Leo');
});

test('lance de peao zera as marcas de posicao; lance reversivel acrescenta', () => {
  assert.equal(xadrez.init({}).seen.length, 1);
  let s = playUci(seated(), ['g1f3']);
  assert.equal(s.seen.length, 2);
  s = playUci(s, ['e7e5']);
  assert.equal(s.seen.length, 1);
  s = playUci(s, ['f3g1', 'b8c6']);
  assert.equal(s.seen.length, 3);
  assert.equal(new Set(s.seen).size, 3);
  assert.ok(s.seen.every((m) => typeof m === 'string' && m.length <= 11));
});

test('lance ilegal, fora da vez e de quem assiste sao recusados', () => {
  const s = seated();
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e2', to: 'e5' }, ctx('bia')), 'Lance inválido');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e7', to: 'e5' }, ctx('bia')), 'Lance inválido');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e2', to: 'e4' }, ctx('leo')), 'Não é a sua vez');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e2', to: 'e4' }, ctx('ana')), 'Sente-se para jogar');
});

test('xeque-mate encerra com vitoria de quem deu o mate', () => {
  const s = playUci(seated(), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual(s.result, { winner: 1, reason: 'mate' });
  assert.equal(s.check, false);
  assert.equal(xadrez.summary(s), 'Xeque-mate, Leo venceu');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'a2', to: 'a3' }, ctx('bia')), 'A partida acabou');
});

test('afogamento empata', () => {
  const s = playUci(fromFen('k7/8/2Q5/8/8/8/8/7K w - - 0 1'), ['c6b6']);
  assert.deepEqual(s.result, { winner: null, reason: 'afogamento' });
  assert.equal(xadrez.summary(s), 'Afogamento, empate');
});

test('material insuficiente empata', () => {
  const s = playUci(fromFen('k7/8/8/8/8/8/1p6/K7 w - - 0 1'), ['a1b2']);
  assert.deepEqual(s.result, { winner: null, reason: 'material' });
  assert.equal(xadrez.summary(s), 'Empate por material insuficiente');
});

test('repeticao tripla empata', () => {
  const dance = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  let s = playUci(seated(), dance);
  assert.equal(s.result, null);
  s = playUci(s, dance.slice(0, 3));
  assert.equal(s.result, null);
  s = playUci(s, dance.slice(3));
  assert.deepEqual(s.result, { winner: null, reason: 'repeticao' });
  assert.equal(xadrez.summary(s), 'Empate por repetição');
});

test('regra dos 50 lances empata', () => {
  const s = playUci(fromFen('k7/8/8/8/8/8/8/K6R w - - 99 80'), ['h1h2']);
  assert.deepEqual(s.result, { winner: null, reason: 'cinquenta' });
  assert.equal(xadrez.summary(s), 'Empate pela regra dos 50 lances');
});

test('promocao exige a peca escolhida e da xeque', () => {
  const s = fromFen('k7/4P3/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e7', to: 'e8' }, ctx('bia')), 'Escolha a peça da promoção');
  assert.equal(xadrez.validate(s, { kind: 'move', from: 'e7', to: 'e8', promotion: 'k' }, ctx('bia')),
    'Peça de promoção inválida');
  const t = act(s, { kind: 'move', from: 'e7', to: 'e8', promotion: 'q' }, 'bia');
  assert.equal(t.fen.split(' ')[0], 'k3Q3/8/8/8/8/8/8/K7');
  assert.deepEqual(t.san, ['e8=Q+']);
  assert.equal(t.check, true);
  assert.equal(xadrez.summary(t), 'Bia × Leo — vez de Leo (xeque)');
  const n = act(s, { kind: 'move', from: 'e7', to: 'e8', promotion: 'n' }, 'bia');
  assert.equal(n.fen.split(' ')[0], 'k3N3/8/8/8/8/8/8/K7');
});

test('promocao em lance que nao e de promocao e recusada', () => {
  assert.equal(xadrez.validate(seated(), { kind: 'move', from: 'e2', to: 'e4', promotion: 'q' }, ctx('bia')),
    'Só o peão na última fileira promove');
});

test('roque e en passant vem do chess.js', () => {
  let s = playUci(seated(), ['e2e4', 'a7a6', 'g1f3', 'a6a5', 'f1c4', 'a5a4', 'e1g1']);
  assert.equal(s.san[s.san.length - 1], 'O-O');
  s = playUci(s, ['d7d5', 'e4e5', 'f7f5', 'e5f6']);
  assert.equal(s.san[s.san.length - 1], 'exf6');
});

test('desistir, recomecar e sair da sala', () => {
  let s = playUci(seated(), ['e2e4']);
  assert.equal(xadrez.validate(s, { kind: 'resign' }, ctx('ana')), 'Só quem está sentado desiste');
  s = act(s, { kind: 'resign' }, 'bia');
  assert.deepEqual(s.result, { winner: 1, reason: 'abandono' });
  assert.equal(xadrez.summary(s), 'Bia desistiu, Leo venceu');
  assert.equal(xadrez.validate(s, { kind: 'reset' }, ctx('ana')), 'Só quem está sentado ou o líder recomeça');
  s = act(s, { kind: 'reset' }, 'leo');
  assert.deepEqual(s.seats, ['bia', 'leo']);
  assert.equal(s.fen, xadrez.init({}).fen);
  assert.deepEqual(s.san, []);
  s = deepFreeze(xadrez.dropPeer(s, 'bia'));
  assert.deepEqual(s.seats, [null, 'leo']);
  assert.equal(xadrez.summary(s), 'Leo espera adversário');
  s = act(s, { kind: 'sit', seat: 0 }, 'ana');
  s = act(s, { kind: 'move', from: 'd2', to: 'd4' }, 'ana');
  assert.equal(xadrez.summary(s, PEERS), 'Ana × Leo — vez de Leo');
});

test('partida longa: san curto e estado no teto', () => {
  let s = seated();
  let seed = 11;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let i = 0; i < 200 && !s.result; i++) {
    const moves = new chessjs.Chess(s.fen).moves({ verbose: true });
    const m = moves[next() % moves.length];
    s = playUci(s, [m.from + m.to + (m.promotion || '')]);
    assert.ok(s.san.length <= 40);
    assert.ok(s.seen.length <= 101);
    assert.ok(JSON.stringify(s).length < xadrez.maxStateBytes);
  }
});

test('100 meios-lances sem peao nem captura cabem no teto e terminam empatados', () => {
  // Torres e reis andando sem repetir posicao ate a regra dos 50 lances.
  let s = fromFen('r3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  let seed = 5;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let i = 0; i < 100 && !s.result; i++) {
    const moves = new chessjs.Chess(s.fen).moves({ verbose: true }).filter((m) => !m.captured);
    const fresh = moves.filter((m) => {
      const g = new chessjs.Chess(s.fen);
      g.move(m);
      return !s.seen.includes(xadrez.positionMark(g.fen()));
    });
    const pool = fresh.length ? fresh : moves;
    const m = pool[next() % pool.length];
    s = playUci(s, [m.from + m.to]);
  }
  assert.ok(JSON.stringify(s).length < xadrez.maxStateBytes, String(JSON.stringify(s).length));
  assert.ok(s.result);
});

test('mensagem malformada nunca lanca e nao muda o estado', () => {
  const s = deepFreeze(seated());
  const bad = [null, 0, 'e2e4', {}, { kind: 'move' }, { kind: 'move', from: 'e2' },
    { kind: 'move', from: 'e9', to: 'e4' }, { kind: 'move', from: 'e2', to: 4 },
    { kind: 'move', from: 'E2', to: 'E4' }, { kind: 'move', from: 'e2', to: 'e4', promotion: null },
    { kind: 'move', from: ['e2'], to: 'e4' }, { kind: 'castle' }];
  for (const action of bad) {
    for (const c of [ctx('bia'), undefined, 'bia']) {
      assert.equal(typeof xadrez.validate(s, action, c), 'string', JSON.stringify(action));
      assert.equal(xadrez.reduce(s, action, c), s);
    }
  }
  const broken = deepFreeze(Object.assign({}, s, { fen: 'isso nao e fen' }));
  assert.equal(xadrez.validate(broken, { kind: 'move', from: 'e2', to: 'e4' }, ctx('bia')), 'Ação inválida');
  assert.equal(xadrez.reduce(broken, { kind: 'move', from: 'e2', to: 'e4' }, ctx('bia')), broken);
  assert.equal(typeof xadrez.summary(undefined), 'string');
});

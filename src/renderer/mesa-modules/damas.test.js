'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const damas = require('./damas');

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
  assert.equal(damas.validate(state, action, c), true, JSON.stringify(action));
  return deepFreeze(damas.reduce(deepFreeze(state), action, c));
}

function seated() {
  let s = deepFreeze(damas.init({}));
  s = act(s, { kind: 'sit', seat: 0 }, 'bia');
  return act(s, { kind: 'sit', seat: 1 }, 'leo');
}

/** Tabuleiro vazio com as pecas dadas: { 'linha,coluna': 'c' | 'C' | 'e' | 'E' }. */
function board(pieces) {
  const g = Array.from({ length: 8 }, () => '........'.split(''));
  for (const [k, ch] of Object.entries(pieces)) {
    const [r, c] = k.split(',').map(Number);
    assert.equal((r + c) % 2, 1, `casa clara ${k}`);
    g[r][c] = ch;
  }
  return g.map((row) => row.join(''));
}

function position(pieces, turn = 0, extra) {
  return deepFreeze(Object.assign({}, seated(), { board: board(pieces), turn }, extra));
}

const who = (s) => (s.turn === 0 ? 'bia' : 'leo');
const paths = (s) => damas.legalMoves(s).map((m) => JSON.stringify(m.path)).sort();

test('descritor segue o contrato', () => {
  assert.equal(damas.type, 'damas');
  assert.equal(damas.title, 'Damas');
  assert.equal(damas.group, 'jogos');
  assert.equal(damas.size.aspect, 1);
  assert.equal(typeof damas.legalMoves, 'function');
});

test('init: 12 pedras de cada lado nas casas escuras, claras comecam', () => {
  const s = damas.init({});
  const all = s.board.join('');
  assert.equal(all.split('c').length - 1, 12);
  assert.equal(all.split('e').length - 1, 12);
  assert.equal(s.board[7], 'c.c.c.c.');
  assert.equal(s.board[0], '.e.e.e.e');
  assert.equal(s.turn, 0);
  assert.ok(JSON.stringify(s).length < damas.maxStateBytes);
});

test('abertura: 7 lances simples das claras, so para a frente', () => {
  const s = seated();
  const moves = damas.legalMoves(s);
  assert.equal(moves.length, 7);
  assert.ok(moves.every((m) => m.path[0][0] === 5 && m.path[1][0] === 4 && m.captures.length === 0));
  assert.equal(damas.summary(s), 'Bia × Leo — vez de Bia');
});

test('lance simples move a pedra e passa a vez', () => {
  const s = act(seated(), { kind: 'move', path: [[5, 2], [4, 3]] }, 'bia');
  assert.equal(s.board[5], 'c...c.c.');
  assert.equal(s.board[4], '...c....');
  assert.equal(s.turn, 1);
  assert.deepEqual(s.last, { path: [[5, 2], [4, 3]], captures: [] });
  assert.equal(damas.validate(s, { kind: 'move', path: [[2, 1], [3, 0]] }, ctx('bia')), 'Não é a sua vez');
  assert.equal(damas.validate(s, { kind: 'move', path: [[2, 1], [3, 0]] }, ctx('ana')), 'Sente-se para jogar');
});

test('pedra nao anda para tras sem capturar', () => {
  const s = position({ '4,3': 'c', '0,1': 'e' });
  assert.deepEqual(paths(s), ['[[4,3],[3,2]]', '[[4,3],[3,4]]']);
  assert.equal(damas.validate(s, { kind: 'move', path: [[4, 3], [5, 2]] }, ctx('bia')), 'Lance inválido');
});

test('captura obrigatoria: lance simples e recusado quando ha captura', () => {
  const s = position({ '5,2': 'c', '5,6': 'c', '4,3': 'e', '0,1': 'e' });
  assert.deepEqual(paths(s), ['[[5,2],[3,4]]']);
  assert.equal(damas.validate(s, { kind: 'move', path: [[5, 6], [4, 7]] }, ctx('bia')), 'Captura obrigatória');
  const t = act(s, { kind: 'move', path: [[5, 2], [3, 4]] }, 'bia');
  assert.equal(t.board[4], '........');
  assert.equal(t.board[3], '....c...');
  assert.deepEqual(t.last.captures, [[4, 3]]);
  assert.equal(t.kingMoves, 0);
});

test('pedra captura para tras', () => {
  const s = position({ '3,2': 'c', '4,3': 'e', '0,1': 'e' });
  assert.deepEqual(paths(s), ['[[3,2],[5,4]]']);
});

test('captura em sequencia com as pecas saindo so no fim', () => {
  const s = position({ '7,0': 'c', '6,1': 'e', '4,3': 'e', '0,7': 'e' });
  assert.deepEqual(paths(s), ['[[7,0],[5,2],[3,4]]']);
  const t = act(s, { kind: 'move', path: [[7, 0], [5, 2], [3, 4]] }, 'bia');
  assert.deepEqual(t.last.captures, [[6, 1], [4, 3]]);
  assert.equal(t.board.join('').split('e').length - 1, 1);
  assert.equal(t.board[3][4], 'c');
});

test('parar no meio da sequencia e recusado', () => {
  const s = position({ '7,0': 'c', '6,1': 'e', '4,3': 'e', '0,7': 'e' });
  assert.equal(damas.validate(s, { kind: 'move', path: [[7, 0], [5, 2]] }, ctx('bia')),
    'Captura obrigatória de 2 peças (lei da maioria)');
});

test('lei da maioria: vale a sequencia que captura mais, mesmo de pedra contra dama', () => {
  // A dama em (7,0) so toma (6,1) e para em (5,2); a pedra em (5,6) toma 2.
  const s = position({ '7,0': 'C', '6,1': 'e', '4,3': 'c', '5,6': 'c', '4,5': 'e', '2,3': 'e' });
  assert.deepEqual(paths(s), ['[[5,6],[3,4],[1,2]]']);
  assert.equal(damas.validate(s, { kind: 'move', path: [[7, 0], [5, 2]] }, ctx('bia')),
    'Captura obrigatória de 2 peças (lei da maioria)');
});

test('peca capturada nao e pulada duas vezes: o giro termina onde comecou', () => {
  const s = position({ '6,3': 'c', '5,4': 'e', '3,4': 'e', '3,2': 'e', '5,2': 'e', '0,1': 'e' });
  const moves = damas.legalMoves(s);
  assert.equal(moves.length, 2);
  for (const m of moves) {
    assert.equal(m.captures.length, 4);
    assert.deepEqual(m.path[m.path.length - 1], [6, 3]);
  }
  const t = act(s, { kind: 'move', path: moves[0].path }, 'bia');
  assert.equal(t.board[6][3], 'c');
  assert.equal(t.board.join('').split('e').length - 1, 1);
});

test('dama anda longe em qualquer diagonal', () => {
  const s = position({ '7,0': 'C', '0,1': 'e' });
  assert.equal(damas.legalMoves(s).length, 7);
  const t = act(s, { kind: 'move', path: [[7, 0], [0, 7]] }, 'bia');
  assert.equal(t.board[0][7], 'C');
  assert.equal(t.kingMoves, 1);
});

test('dama captura a distancia e escolhe onde parar', () => {
  const s = position({ '7,0': 'C', '4,3': 'e', '0,1': 'e' });
  assert.deepEqual(paths(s), ['[[7,0],[0,7]]', '[[7,0],[1,6]]', '[[7,0],[2,5]]', '[[7,0],[3,4]]']);
});

test('dama que pode continuar tem de parar na casa que continua', () => {
  // Depois de tomar (4,3), so parando em (2,5) ela toma (3,6).
  const s = position({ '7,0': 'C', '4,3': 'e', '3,6': 'e', '0,1': 'e' });
  assert.deepEqual(paths(s), ['[[7,0],[2,5],[4,7]]']);
});

test('dama nao pula duas pecas seguidas nem a propria', () => {
  const s = position({ '7,0': 'C', '5,2': 'e', '4,3': 'e', '6,5': 'c', '0,1': 'e' });
  assert.ok(damas.legalMoves(s).every((m) => m.captures.length === 0));
  const t = position({ '7,0': 'C', '6,1': 'c', '4,3': 'e', '0,1': 'e' });
  assert.ok(damas.legalMoves(t).every((m) => m.captures.length === 0));
});

test('promocao ao terminar na ultima fileira', () => {
  const s = position({ '1,2': 'c', '6,1': 'e' });
  const t = act(s, { kind: 'move', path: [[1, 2], [0, 3]] }, 'bia');
  assert.equal(t.board[0][3], 'C');
  const e = act(position({ '6,1': 'e', '0,3': 'c' }, 1), { kind: 'move', path: [[6, 1], [7, 0]] }, 'leo');
  assert.equal(e.board[7][0], 'E');
});

test('passar pela ultima fileira no meio da captura nao promove', () => {
  const s = position({ '2,1': 'c', '1,2': 'e', '1,4': 'e', '7,0': 'e' });
  assert.deepEqual(paths(s), ['[[2,1],[0,3],[2,5]]']);
  const t = act(s, { kind: 'move', path: [[2, 1], [0, 3], [2, 5]] }, 'bia');
  assert.equal(t.board[2][5], 'c');
});

test('vence quem deixa o adversario sem pecas', () => {
  const s = position({ '5,2': 'c', '4,3': 'e' });
  const t = act(s, { kind: 'move', path: [[5, 2], [3, 4]] }, 'bia');
  assert.deepEqual(t.result, { winner: 0, reason: 'sem-lances' });
  assert.equal(damas.summary(t), 'Bia venceu');
  assert.deepEqual(damas.legalMoves(t), []);
});

test('vence quem deixa o adversario bloqueado', () => {
  // Escura em (6,7) presa: (7,6) ocupada por clara protegida pela borda.
  const s = position({ '6,7': 'e', '4,1': 'c', '7,6': 'c' });
  const t = act(s, { kind: 'move', path: [[4, 1], [3, 0]] }, 'bia');
  assert.deepEqual(t.result, { winner: 0, reason: 'sem-lances' });
});

test('empate depois de 20 lances seguidos so de damas sem captura', () => {
  let s = position({ '7,0': 'C', '0,1': 'E' });
  const shuttle = [
    [[[7, 0], [6, 1]], [[0, 1], [1, 0]]],
    [[[6, 1], [7, 0]], [[1, 0], [0, 1]]],
  ];
  for (let i = 0; i < 10; i++) {
    const [a, b] = shuttle[i % 2];
    s = act(s, { kind: 'move', path: a }, 'bia');
    assert.equal(s.result, null);
    s = act(s, { kind: 'move', path: b }, 'leo');
  }
  assert.equal(s.kingMoves, 20);
  assert.deepEqual(s.result, { winner: null, reason: 'damas' });
  assert.equal(damas.summary(s), 'Empate, 20 lances só de damas');
});

test('lance de pedra zera a contagem de lances so de damas', () => {
  const s = position({ '7,0': 'C', '5,6': 'c', '0,1': 'E' }, 0, { kingMoves: 15 });
  const t = act(s, { kind: 'move', path: [[5, 6], [4, 7]] }, 'bia');
  assert.equal(t.kingMoves, 0);
});

test('desistir da a vitoria ao outro e so vale para quem esta sentado', () => {
  const s = seated();
  assert.equal(damas.validate(s, { kind: 'resign' }, ctx('ana')), 'Só quem está sentado desiste');
  const t = act(s, { kind: 'resign' }, 'leo');
  assert.deepEqual(t.result, { winner: 0, reason: 'abandono' });
  assert.equal(damas.summary(t), 'Leo desistiu, Bia venceu');
  assert.equal(damas.validate(t, { kind: 'resign' }, ctx('bia')), 'A partida acabou');
});

test('reset volta a posicao inicial mantendo as cadeiras', () => {
  const s = act(seated(), { kind: 'move', path: [[5, 2], [4, 3]] }, 'bia');
  const t = act(s, { kind: 'reset' }, 'ana', { isLeader: true });
  assert.deepEqual(t.board, damas.init({}).board);
  assert.deepEqual(t.seats, ['bia', 'leo']);
  assert.equal(t.turn, 0);
});

test('dropPeer libera a cadeira sem mexer no tabuleiro', () => {
  const s = act(seated(), { kind: 'move', path: [[5, 2], [4, 3]] }, 'bia');
  const t = damas.dropPeer(s, 'leo');
  assert.deepEqual(t.seats, ['bia', null]);
  assert.equal(t.board, s.board);
  assert.equal(damas.validate(t, { kind: 'move', path: [[2, 1], [3, 0]] }, ctx('bia')),
    'Espere alguém sentar na outra cadeira');
});

test('caminho malformado e mensagem estranha nunca lancam', () => {
  const s = deepFreeze(seated());
  const bad = [null, 3, 'move', {}, { kind: 'move' }, { kind: 'move', path: 'a1' },
    { kind: 'move', path: [] }, { kind: 'move', path: [[5, 2]] },
    { kind: 'move', path: [[5, 2], [4]] }, { kind: 'move', path: [[5, 2], [4, 9]] },
    { kind: 'move', path: [[5, 2], ['4', '3']] }, { kind: 'move', path: [[5.5, 2], [4, 3]] },
    { kind: 'move', path: Array(40).fill([5, 2]) }, { kind: 'move', path: [null, null] }];
  for (const action of bad) {
    for (const c of [ctx('bia'), undefined, 7]) {
      assert.equal(typeof damas.validate(s, action, c), 'string', JSON.stringify(action));
      assert.equal(damas.reduce(s, action, c), s);
    }
  }
  for (const st of [null, {}, { board: 5, turn: 0 }]) {
    assert.deepEqual(damas.legalMoves(st), []);
    assert.equal(typeof damas.summary(st), 'string');
  }
});

test('partida longa aleatoria mas deterministica fica no teto de bytes', () => {
  let s = seated();
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let i = 0; i < 300 && !s.result; i++) {
    const moves = damas.legalMoves(s);
    const m = moves[next() % moves.length];
    s = act(s, { kind: 'move', path: m.path }, who(s));
    assert.ok(JSON.stringify(s).length < damas.maxStateBytes);
  }
});

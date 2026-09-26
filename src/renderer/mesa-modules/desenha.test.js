'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const desenha = require('./desenha');
const { jsonBytes } = require('../mesa');

const PEERS = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Bia' }, { id: '3', name: 'Caio' }];

function ctx(from, extra = {}) {
  return { from, isLeader: false, peers: PEERS, now: 1000, random: () => 0.1, ...extra };
}

/** Roda uma acao inteira (validate -> prepare -> reduce), do jeito que o
 * servidor faz. Falha se `validate` recusar. */
function passo(s, action, from, extra = {}) {
  const c = ctx(from, extra);
  const v = desenha.validate(s, action, c);
  assert.equal(v, true, `validate recusou ${JSON.stringify(action)}: ${v}`);
  return desenha.reduce(s, desenha.prepare(s, action, c), c);
}

function entramTodos(s) {
  let st = s;
  st = passo(st, { kind: 'join' }, '1');
  st = passo(st, { kind: 'join' }, '2');
  return st;
}

test('lista de palavras: 150+ palavras distintas, sem string vazia', () => {
  assert.ok(desenha.PALAVRAS.length >= 150, `so ${desenha.PALAVRAS.length}`);
  assert.equal(new Set(desenha.PALAVRAS).size, desenha.PALAVRAS.length, 'tem repetida');
  for (const p of desenha.PALAVRAS) assert.ok(typeof p === 'string' && p.trim().length > 0);
});

test('normalizar: sem acento, sem caixa, espacos colapsados', () => {
  assert.equal(desenha.normalizar('Girafa'), 'girafa');
  assert.equal(desenha.normalizar('  Ônibus  '), 'onibus');
  assert.equal(desenha.normalizar('Arco-Íris'), 'arco-iris');
  assert.equal(desenha.normalizar('café   com   leite'), 'cafe com leite');
});

test('dentroDe1: uma letra a mais, a menos ou trocada -- nunca mais que isso', () => {
  assert.equal(desenha.dentroDe1('gato', 'gato'), true);
  assert.equal(desenha.dentroDe1('gato', 'gata'), true); // trocada
  assert.equal(desenha.dentroDe1('gato', 'gatos'), true); // a mais
  assert.equal(desenha.dentroDe1('gatos', 'gato'), true); // a menos
  assert.equal(desenha.dentroDe1('gato', 'sapo'), false);
  assert.equal(desenha.dentroDe1('gato', 'cachorro'), false);
  assert.equal(desenha.dentroDe1('gato', 'gatoo'), true);
  assert.equal(desenha.dentroDe1('gato', 'gatooo'), false); // duas a mais
});

test('init: lobby vazio', () => {
  const s = desenha.init();
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.players, []);
  assert.equal(s.drawerIdx, -1);
});

test('join: so na fase lobby, nao duplica, respeita o teto', () => {
  let s = desenha.init();
  s = passo(s, { kind: 'join' }, '1');
  assert.equal(s.players.length, 1);
  assert.equal(s.players[0].name, 'Ana');
  assert.notEqual(desenha.validate(s, { kind: 'join' }, ctx('1')), true, 'ja entrou');
  s = passo(s, { kind: 'join' }, '2');
  assert.equal(s.players.length, 2);
});

test('start: precisa de 2+, poe a fase choosing com 3 opcoes pro primeiro da lista', () => {
  let s = passo(desenha.init(), { kind: 'join' }, '1');
  assert.notEqual(desenha.validate(s, { kind: 'start' }, ctx('1')), true, 'so tem 1');
  s = passo(s, { kind: 'join' }, '2');
  s = passo(s, { kind: 'start' }, '1');
  assert.equal(s.phase, 'choosing');
  assert.equal(s.drawerIdx, 0);
  assert.equal(s.options.length, 3);
  assert.equal(new Set(s.options).size, 3);
});

test('choose: so quem desenha, vira a palavra secreta e comeca o prazo de 80s', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  assert.notEqual(desenha.validate(s, { kind: 'choose', index: 0 }, ctx('2')), true, 'nao e a vez da Bia');
  const opcoes = s.options;
  s = passo(s, { kind: 'choose', index: 1 }, '1');
  assert.equal(s.phase, 'drawing');
  assert.equal(s.word, opcoes[1]);
  assert.equal(s.options, null);
  assert.equal(s.deadline, 1000 + desenha.DRAW_MS);
});

test('guess: acerto sem acento/caixa da pontos pelo tempo e bonus pro desenhista', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  const palavra = s.options[0];
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  assert.equal(s.word, palavra);
  const chute = palavra.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  // Com 2 jogadores a rodada fecha sozinha assim que a Bia acerta (so ela
  // precisava acertar); os pontos ficam em `players`, que sobrevive ao
  // fim da rodada.
  s = passo(s, { kind: 'guess', text: chute }, '2', { now: 1000 }); // acertou na hora: 100 pontos
  assert.equal(s.players.find((p) => p.id === '2').score, 100, 'acertou logo no inicio: pontuacao maxima');
  assert.equal(s.players.find((p) => p.id === '1').score, 10, 'a Ana (desenhista) ganha o bonus fixo');
  assert.equal(s.phase, 'choosing', 'unico que faltava acertar: a rodada fechou');
});

test('guess: rodada fecha quando todos os que nao desenham acertam', () => {
  let s = desenha.init();
  s = passo(s, { kind: 'join' }, '1');
  s = passo(s, { kind: 'join' }, '2');
  s = passo(s, { kind: 'join' }, '3');
  s = passo(s, { kind: 'start' }, '1');
  const palavra = s.options[2];
  s = passo(s, { kind: 'choose', index: 2 }, '1');
  s = passo(s, { kind: 'guess', text: 'chute errado' }, '2', { now: 1000 });
  assert.equal(s.phase, 'drawing', 'errou: continua a rodada');
  assert.equal(s.lastEvent.kind, 'wrong');
  s = passo(s, { kind: 'guess', text: palavra }, '2', { now: 1000 });
  assert.equal(s.guessedBy.includes('2'), true);
  assert.equal(s.phase, 'drawing', 'falta o Caio acertar');
  const scoreBiaAntes = s.players.find((p) => p.id === '2').score;
  assert.ok(scoreBiaAntes >= 10 && scoreBiaAntes <= 100);
  const scoreAnaAntes = s.players.find((p) => p.id === '1').score;
  assert.equal(scoreAnaAntes, 10, 'a Ana (desenhista) ja ganhou o bonus do acerto da Bia');
  s = passo(s, { kind: 'guess', text: palavra }, '3', { now: 1000 });
  assert.equal(s.phase, 'choosing', 'todos acertaram: proxima rodada');
  assert.equal(s.drawerIdx, 1, 'a vez passou pra Bia');
  assert.equal(s.lastRound.word, palavra);
  assert.equal(s.lastRound.drawerId, '1');
  assert.equal(s.drawCounts['1'], 1);
});

test('guess: "quase" (uma letra de diferenca) nao conta como acerto nem erro visivel a todos', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  const palavra = s.options[0];
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  const quase = `${palavra}x`;
  s = passo(s, { kind: 'guess', text: quase }, '2', { now: 1000 });
  assert.equal(s.phase, 'drawing');
  assert.equal(s.guessedBy.length, 0);
  assert.equal(s.lastEvent.kind, 'close');
  assert.equal(s.lastEvent.by, '2');
});

test('quem ja acertou nao pode chutar de novo', () => {
  let s = desenha.init();
  s = passo(s, { kind: 'join' }, '1');
  s = passo(s, { kind: 'join' }, '2');
  s = passo(s, { kind: 'join' }, '3');
  s = passo(s, { kind: 'start' }, '1');
  const palavra = s.options[0];
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  s = passo(s, { kind: 'guess', text: palavra }, '2', { now: 1000 });
  assert.notEqual(desenha.validate(s, { kind: 'guess', text: palavra }, ctx('2')), true);
});

test('timeout: fecha a rodada sem ninguem acertar, revela a palavra em lastRound', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  const palavra = s.options[0];
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  s = passo(s, { kind: 'timeout' }, '2', { now: 1000 + desenha.DRAW_MS + 1 });
  assert.equal(s.phase, 'choosing');
  assert.equal(s.lastRound.word, palavra);
  assert.equal(s.drawCounts['1'], 1);
});

test('depois que todos desenharem DRAWS_PER_PLAYER vezes, o jogo acaba', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  // 2 jogadores, 2 desenhos cada = 4 rodadas por timeout.
  for (let i = 0; i < 4; i++) {
    assert.equal(s.phase, 'choosing', `rodada ${i}`);
    s = passo(s, { kind: 'choose', index: 0 }, s.players[s.drawerIdx].id, { now: 1000 });
    s = passo(s, { kind: 'timeout' }, s.players[1 - s.drawerIdx].id, { now: 1000 + desenha.DRAW_MS + 1 });
  }
  assert.equal(s.phase, 'gameend');
  assert.equal(s.drawCounts['1'], 2);
  assert.equal(s.drawCounts['2'], 2);
});

test('view: quem desenha ve a palavra e as 3 opcoes; quem so assiste, nao', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  const vDesenhista = desenha.view(s, '1', { peers: PEERS });
  assert.deepEqual(vDesenhista.options, s.options);
  assert.equal(vDesenhista.word, null, 'so escolheu depois do choose');
  const vOutro = desenha.view(s, '2', { peers: PEERS });
  assert.equal(vOutro.options, null);
  const vFora = desenha.view(s, '3', { peers: PEERS });
  assert.equal(vFora.me.isDrawer, false);
  assert.equal(vFora.me.joined, false);

  s = passo(s, { kind: 'choose', index: 0 }, '1');
  const palavra = s.word;
  assert.equal(desenha.view(s, '1', { peers: PEERS }).word, palavra, 'o desenhista ve');
  assert.equal(desenha.view(s, '2', { peers: PEERS }).word, null, 'quem ainda nao acertou nao ve');
  assert.equal(desenha.view(s, null, { peers: PEERS }).word, null, 'quem so assiste nao ve');
  assert.equal(desenha.view(s, '2', { peers: PEERS }).wordLen, palavra.length, 'mas ve o tamanho');
});

test('view: "quase" so aparece pra quem chutou; acerto/erro aparecem pra todos (sem a palavra)', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  const palavra = s.word;
  s = passo(s, { kind: 'guess', text: `${palavra}x` }, '2', { now: 1000 });
  assert.equal(desenha.view(s, '2', { peers: PEERS }).event.kind, 'close');
  assert.equal(desenha.view(s, '1', { peers: PEERS }).event, null, 'o desenhista nao ve o "quase" da Bia');
  assert.equal(desenha.view(s, '3', { peers: PEERS }).event, null);
});

test('canAnnotateDraw: so quem esta desenhando, e so na fase drawing', () => {
  let s = entramTodos(desenha.init());
  assert.equal(desenha.canAnnotateDraw(s, '1'), false, 'ainda no lobby');
  s = passo(s, { kind: 'start' }, '1');
  assert.equal(desenha.canAnnotateDraw(s, '1'), false, 'escolhendo, ainda nao desenha');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  assert.equal(desenha.canAnnotateDraw(s, '1'), true);
  assert.equal(desenha.canAnnotateDraw(s, '2'), false);
});

test('dropPeer: sai no lobby so tira da lista', () => {
  let s = entramTodos(desenha.init());
  s = desenha.dropPeer(s, '2');
  assert.deepEqual(s.players.map((p) => p.id), ['1']);
});

test('dropPeer: o desenhista sai no meio -- a rodada fecha, os pontos ficam, o jogo continua', () => {
  let s = desenha.init();
  s = passo(s, { kind: 'join' }, '1');
  s = passo(s, { kind: 'join' }, '2');
  s = passo(s, { kind: 'join' }, '3');
  s = passo(s, { kind: 'start' }, '1');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  s = desenha.dropPeer(s, '1');
  assert.equal(s.players.some((p) => p.id === '1'), false);
  assert.equal(s.phase, 'choosing', 'a rodada fechou sozinha, sem desenhista');
  assert.equal(s.players.length, 2);
});

test('dropPeer: sai gente ate sobrar so 1 -- volta pro lobby, sem travar', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  s = desenha.dropPeer(s, '2');
  assert.equal(s.phase, 'lobby');
  assert.equal(s.players.length, 1);
});

test('migrate: nao leva segredo nenhum, so jogadores e pontos; jogo cancelado (volta ao lobby)', () => {
  let s = entramTodos(desenha.init());
  s = passo(s, { kind: 'start' }, '1');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  const m = desenha.migrate(s);
  assert.equal(m.phase, 'lobby');
  assert.equal(m.word, null);
  assert.equal(m.options, null);
  assert.deepEqual(m.players.map((p) => p.id), ['1', '2']);
  assert.equal(JSON.stringify(m).includes(JSON.stringify(s.word)), false);
});

test('timeoutAt: so durante a fase drawing', () => {
  let s = entramTodos(desenha.init());
  assert.equal(desenha.timeoutAt(s), null);
  s = passo(s, { kind: 'start' }, '1');
  assert.equal(desenha.timeoutAt(s), null, 'escolhendo, sem prazo ainda');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  assert.equal(desenha.timeoutAt(s), s.deadline);
});

test('o estado inteiro cabe no teto declarado mesmo com a mesa cheia de jogadores', () => {
  let s = desenha.init();
  for (let i = 1; i <= desenha.MAX_PLAYERS; i++) s = passo(s, { kind: 'join' }, String(i));
  s = passo(s, { kind: 'start' }, '1');
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  assert.ok(jsonBytes(s) <= 8192);
});

test('summary devolve texto em cada fase', () => {
  let s = entramTodos(desenha.init());
  assert.equal(typeof desenha.summary(s), 'string');
  s = passo(s, { kind: 'start' }, '1');
  assert.match(desenha.summary(s), /escolhendo/);
  s = passo(s, { kind: 'choose', index: 0 }, '1');
  assert.match(desenha.summary(s), /desenhando/);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  PALETTE, MAX_ITEMS, MAX_POINTS_PER_STROKE, MAX_TEXT,
  colorFor, contentRect, toNorm, toPx, opAllowed, sanitizeItems, createStore,
} = require('./annotate');

// ---------- cor por pessoa ----------

test('colorFor da cores distintas pros primeiros ids de conexao', () => {
  const cores = ['1', '2', '3', '4', '5', '6'].map(colorFor);
  assert.equal(new Set(cores).size, 6);
});

test('colorFor e estavel e da a volta na paleta', () => {
  assert.equal(colorFor('1'), colorFor('1'));
  assert.equal(colorFor('1'), PALETTE[0]);
  assert.equal(colorFor(String(PALETTE.length + 1)), PALETTE[0]);
});

test('colorFor nunca devolve indefinido pra id nao numerico', () => {
  for (const id of ['me', '', null, undefined, 'abc-123']) {
    assert.ok(PALETTE.includes(colorFor(id)), `id ${String(id)}`);
  }
});

test('a paleta nao tem a cor de "ao vivo" (--live e vermelho)', () => {
  // Um traco vermelho por cima de video ao vivo seria a mesma cor dizendo
  // duas coisas -- ver a spec, secao 5.3.
  for (const cor of PALETTE) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
    assert.ok(!(r > 200 && g < 110 && b < 110), `${cor} e vermelho demais`);
  }
});

// ---------- letterbox ----------

test('contentRect poe barras nas laterais quando a caixa e mais larga que o video', () => {
  // video 16:9 numa caixa 2:1 -> sobra nos lados, altura cheia
  const r = contentRect(1920, 1080, 1000, 500);
  assert.equal(Math.round(r.height), 500);
  assert.equal(Math.round(r.width), 889);
  assert.equal(Math.round(r.top), 0);
  assert.ok(r.left > 0);
});

test('contentRect poe barras em cima e embaixo quando a caixa e mais alta', () => {
  const r = contentRect(1920, 1080, 800, 800);
  assert.equal(Math.round(r.width), 800);
  assert.equal(Math.round(r.height), 450);
  assert.equal(Math.round(r.left), 0);
  assert.equal(Math.round(r.top), 175);
});

test('contentRect sem dimensao de video devolve a caixa inteira (sem divisao por zero)', () => {
  assert.deepEqual(contentRect(0, 0, 640, 360), { left: 0, top: 0, width: 640, height: 360 });
  assert.deepEqual(contentRect(NaN, 1080, 640, 360), { left: 0, top: 0, width: 640, height: 360 });
});

test('toNorm e toPx sao inversos dentro do conteudo', () => {
  const rect = contentRect(1920, 1080, 800, 800); // left 0, top 175, 800x450
  const norm = toNorm(400, 400, rect);
  assert.deepEqual(norm, { x: 0.5, y: 0.5 });
  const px = toPx(norm.x, norm.y, rect);
  assert.equal(Math.round(px.x), 400);
  assert.equal(Math.round(px.y), 400);
});

test('toNorm prende na borda quando o ponteiro sai do video', () => {
  const rect = contentRect(1920, 1080, 800, 800);
  assert.deepEqual(toNorm(-50, 0, rect), { x: 0, y: 0 });
  assert.deepEqual(toNorm(9999, 9999, rect), { x: 1, y: 1 });
});

test('o mesmo ponto normalizado cai no mesmo lugar em janela e em fullscreen', () => {
  // E a razao de a normalizacao ser sobre o CONTEUDO e nao sobre a caixa.
  const janela = contentRect(1920, 1080, 640, 480);
  const cheia = contentRect(1920, 1080, 1920, 1200);
  const norm = toNorm(320, 240, janela); // centro do conteudo
  const px = toPx(norm.x, norm.y, cheia);
  assert.equal(Math.round(px.x), 960);
  assert.equal(Math.round(px.y), 600);
});

// ---------- deposito ----------

function store() {
  return createStore();
}

test('begin + points + end montam um traco unico', () => {
  const s = store();
  assert.ok(s.apply('tela', '2', { op: 'begin', id: 'a', x: 0.1, y: 0.1, width: 4 }));
  assert.ok(s.apply('tela', '2', { op: 'points', id: 'a', points: [[0.2, 0.2], [0.3, 0.3]] }));
  assert.equal(s.apply('tela', '2', { op: 'end', id: 'a' }), false); // 'end' nao muda a lousa
  const items = s.items('tela');
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'stroke');
  assert.equal(items[0].from, '2');
  assert.deepEqual(items[0].points, [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]]);
});

test('ninguem estende o traco de outra pessoa', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0.1, y: 0.1 });
  assert.equal(s.apply('tela', '3', { op: 'points', id: 'a', points: [[0.9, 0.9]] }), false);
  assert.equal(s.items('tela')[0].points.length, 1);
});

test('points sem begin nao cria traco', () => {
  const s = store();
  assert.equal(s.apply('tela', '2', { op: 'points', id: 'fantasma', points: [[0.5, 0.5]] }), false);
  assert.equal(s.items('tela').length, 0);
});

test('coordenada fora de 0..1 ou nao numerica e descartada', () => {
  const s = store();
  assert.equal(s.apply('tela', '2', { op: 'begin', id: 'a', x: 1.5, y: 0.5 }), false);
  assert.equal(s.apply('tela', '2', { op: 'begin', id: 'b', x: 'meio', y: 0.5 }), false);
  s.apply('tela', '2', { op: 'begin', id: 'c', x: 0.5, y: 0.5 });
  assert.equal(s.apply('tela', '2', { op: 'points', id: 'c', points: [[2, 2], ['x', 0.1]] }), false);
  assert.equal(s.items('tela').length, 1);
});

test('a largura do pincel e presa numa faixa util', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0, y: 0, width: 9999 });
  s.apply('tela', '2', { op: 'begin', id: 'b', x: 0, y: 0, width: -3 });
  s.apply('tela', '2', { op: 'begin', id: 'c', x: 0, y: 0, width: 'grosso' });
  const [a, b, c] = s.items('tela');
  assert.equal(a.width, 20);
  assert.equal(b.width, 1);
  assert.equal(c.width, 4); // padrao
});

test('texto entra como item e corta em MAX_TEXT', () => {
  const s = store();
  assert.ok(s.apply('tela', '5', { op: 'text', id: 't1', x: 0.2, y: 0.3, text: 'x'.repeat(500), size: 24 }));
  const [item] = s.items('tela');
  assert.equal(item.kind, 'text');
  assert.equal(item.text.length, MAX_TEXT);
  assert.equal(item.size, 24);
});

test('texto vazio ou so espaco nao vira item', () => {
  const s = store();
  assert.equal(s.apply('tela', '5', { op: 'text', id: 't1', x: 0.2, y: 0.3, text: '   ' }), false);
  assert.equal(s.items('tela').length, 0);
});

test('undo tira o ultimo item de quem pediu, nao o ultimo da lousa', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  s.apply('tela', '3', { op: 'begin', id: 'b', x: 0, y: 0 });
  s.apply('tela', '2', { op: 'begin', id: 'c', x: 0, y: 0 });
  assert.ok(s.apply('tela', '2', { op: 'undo' }));
  assert.deepEqual(s.items('tela').map((i) => i.id), ['a', 'b']);
  assert.ok(s.apply('tela', '2', { op: 'undo' }));
  assert.deepEqual(s.items('tela').map((i) => i.id), ['b']);
  assert.equal(s.apply('tela', '2', { op: 'undo' }), false); // nao sobra nada meu
});

test('clear "mine" so apaga o proprio; "all" apaga tudo, e so o dono da tela manda', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  s.apply('tela', '3', { op: 'begin', id: 'b', x: 0, y: 0 });
  s.apply('tela', '2', { op: 'clear', scope: 'mine' });
  assert.deepEqual(s.items('tela').map((i) => i.from), ['3']);

  // Quem NAO e dono da superficie nao limpa a lousa dos outros.
  assert.equal(s.apply('tela', '9', { op: 'clear', scope: 'all' }), false);
  assert.equal(s.items('tela').length, 1);

  // O dono, sim.
  assert.equal(s.apply('tela', 'tela', { op: 'clear', scope: 'all' }), true);
  assert.equal(s.items('tela').length, 0);
});

test('cada superficie tem a propria lousa', () => {
  const s = store();
  s.apply('tela-a', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  s.apply('tela-b', '2', { op: 'begin', id: 'b', x: 0, y: 0 });
  assert.equal(s.items('tela-a').length, 1);
  assert.equal(s.items('tela-b').length, 1);
  s.drop('tela-a');
  assert.equal(s.items('tela-a').length, 0);
  assert.equal(s.items('tela-b').length, 1);
});

test('a lousa para no teto de itens, descartando o mais antigo', () => {
  const s = store();
  for (let i = 0; i < MAX_ITEMS + 10; i++) {
    s.apply('tela', '2', { op: 'begin', id: `i${i}`, x: 0, y: 0 });
  }
  const items = s.items('tela');
  assert.equal(items.length, MAX_ITEMS);
  assert.equal(items[0].id, 'i10'); // os 10 primeiros sairam
});

test('o traco para no teto de pontos sem estourar memoria', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  for (let i = 0; i < 30; i++) {
    s.apply('tela', '2', { op: 'points', id: 'a', points: Array.from({ length: 100 }, () => [0.5, 0.5]) });
  }
  assert.equal(s.items('tela')[0].points.length, MAX_POINTS_PER_STROKE);
});

test('hasFrom diz se ha o que desfazer', () => {
  const s = store();
  assert.equal(s.hasFrom('tela', '2'), false);
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  assert.equal(s.hasFrom('tela', '2'), true);
  assert.equal(s.hasFrom('tela', '3'), false);
});

// ---------- snapshot / sync ----------

test('snapshot copia os pontos (quem recebe nao segura o traco vivo)', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'a', x: 0.1, y: 0.1 });
  const snap = s.snapshot('tela');
  s.apply('tela', '2', { op: 'points', id: 'a', points: [[0.9, 0.9]] });
  assert.equal(snap[0].points.length, 1); // o snapshot nao cresceu junto
});

test('load substitui a lousa e sanitiza o que veio', () => {
  const s = store();
  s.apply('tela', '2', { op: 'begin', id: 'velho', x: 0, y: 0 });
  s.load('tela', [
    { kind: 'stroke', id: 'a', from: '3', points: [[0.1, 0.1], [2, 2]], width: 3 },
    { kind: 'text', id: 'b', from: '4', x: 0.5, y: 0.5, text: 'oi', size: 18 },
    { kind: 'stroke', id: 'c', from: '3', points: [] }, // sem ponto util -> fora
    { kind: 'meme', id: 'd', from: '3' }, // tipo desconhecido -> fora
    null,
  ]);
  const items = s.items('tela');
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
  assert.deepEqual(items[0].points, [[0.1, 0.1]]); // o ponto invalido caiu
});

test('sanitizeItems recusa item sem autor e respeita o teto', () => {
  assert.deepEqual(sanitizeItems('nao e lista'), []);
  assert.deepEqual(sanitizeItems([{ kind: 'stroke', id: 'a', points: [[0, 0]] }]), []); // sem `from`
  const muitos = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({
    kind: 'stroke', id: `i${i}`, from: '2', points: [[0, 0]],
  }));
  assert.equal(sanitizeItems(muitos).length, MAX_ITEMS);
});

// ---------- papeis: quem assiste rabisca, quem e dono da tela apaga ----------

test('opAllowed: o dono da tela nao desenha na propria tela', () => {
  for (const op of [
    { op: 'begin', id: 'a', x: 0, y: 0 },
    { op: 'points', id: 'a', points: [[0.5, 0.5]] },
    { op: 'text', id: 't', x: 0.1, y: 0.1, text: 'oi' },
    { op: 'undo' },
    { op: 'clear', scope: 'mine' },
  ]) {
    assert.equal(opAllowed('7', '7', op), false, `${op.op} do dono devia ser recusado`);
    assert.equal(opAllowed('7', '2', op), true, `${op.op} de quem assiste devia passar`);
  }
});

test('opAllowed: "clear all" e o inverso -- so o dono', () => {
  assert.equal(opAllowed('7', '7', { op: 'clear', scope: 'all' }), true);
  assert.equal(opAllowed('7', '2', { op: 'clear', scope: 'all' }), false);
});

test('opAllowed compara ids como texto (o id de conexao viaja como string)', () => {
  assert.equal(opAllowed(7, '7', { op: 'undo' }), false);
  assert.equal(opAllowed('7', 7, { op: 'clear', scope: 'all' }), true);
});

test('opAllowed recusa op que nao e objeto', () => {
  for (const lixo of [null, undefined, 'begin', 42, []]) {
    assert.equal(opAllowed('7', '2', lixo), false);
  }
});

test('store.apply nao deixa o dono da tela abrir um traco na propria tela', () => {
  // A regra vale no store, nao so na interface: `apply` e o unico caminho
  // tanto pro que nasce aqui quanto pro que chega pela rede.
  const s = store();
  assert.equal(s.apply('7', '7', { op: 'begin', id: 'a', x: 0.5, y: 0.5 }), false);
  assert.equal(s.items('7').length, 0);

  assert.equal(s.apply('7', '2', { op: 'begin', id: 'b', x: 0.5, y: 0.5 }), true);
  assert.equal(s.items('7').length, 1);
});

test('store.apply: um "text" do dono da propria tela nao entra', () => {
  const s = store();
  assert.equal(s.apply('7', '7', { op: 'text', id: 't', x: 0.2, y: 0.2, text: 'meu' }), false);
  assert.equal(s.items('7').length, 0);
});

test('store.apply: o dono da tela limpa tudo, inclusive o que nao e dele', () => {
  const s = store();
  s.apply('7', '2', { op: 'begin', id: 'a', x: 0, y: 0 });
  s.apply('7', '3', { op: 'text', id: 't', x: 0.2, y: 0.2, text: 'oi' });
  assert.equal(s.items('7').length, 2);
  assert.equal(s.apply('7', '7', { op: 'clear', scope: 'all' }), true);
  assert.equal(s.items('7').length, 0);
});

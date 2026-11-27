'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { traduzirResumo: R } = require('../i18n');
const quadro = require('./quadro');
const { codigo } = require('../i18n');
const { jsonBytes } = require('../mesa');

test('init carimba quem criou a janela (ctx.by), sem ele fica null', () => {
  assert.deepEqual(quadro.init({ by: '7' }), { owner: '7', hidden: false });
  assert.deepEqual(quadro.init({}), { owner: null, hidden: false });
  assert.deepEqual(quadro.init({ by: null }), { owner: null, hidden: false });
});

test('visibility: so quem criou valida a forma certa; lider e forma invalida nao passam', () => {
  const s = quadro.init({ by: '7' });
  assert.equal(quadro.validate(s, { kind: 'visibility', hidden: true }, { from: '7' }), true);
  assert.equal(
    quadro.validate(s, { kind: 'visibility', hidden: true }, { from: '9' }),
    codigo('mesa.quadro.soQuemCriouEsconde'),
  );
  assert.equal(
    typeof quadro.validate(s, { kind: 'visibility', hidden: true }, { from: '9', isLeader: true }),
    'string',
  );
  assert.equal(
    quadro.validate(s, { kind: 'visibility', hidden: 'sim' }, { from: '7' }),
    codigo('mesa.quadro.visibilidadeInvalida'),
  );
  assert.equal(typeof quadro.validate(s, { kind: 'qualquer' }, { from: '7' }), 'string');
});

test('visibility: reduce troca a visibilidade sem alterar quem criou', () => {
  const s = quadro.init({ by: '7' });
  assert.deepEqual(quadro.reduce(s, { kind: 'visibility', hidden: true }), { owner: '7', hidden: true });
  assert.deepEqual(quadro.reduce({ owner: '7', hidden: true }, { kind: 'visibility', hidden: false }), {
    owner: '7', hidden: false,
  });
});

test('canAnnotateClear: so quem criou a janela ou o lider', () => {
  const s = quadro.init({ by: '7' });
  assert.equal(quadro.canAnnotateClear(s, '7', { isLeader: false }), true);
  assert.equal(quadro.canAnnotateClear(s, '9', { isLeader: true }), true);
  assert.equal(quadro.canAnnotateClear(s, '9', { isLeader: false }), false);
  assert.equal(quadro.canAnnotateClear(s, '9', {}), false);
});

test('rabisco: visivel aceita todos; escondido aceita e mostra so quem criou', () => {
  const visivel = quadro.init({ by: '7' });
  const escondido = { owner: '7', hidden: true };
  assert.equal(quadro.canAnnotateDraw(visivel, '9', { isLeader: false }), true);
  assert.equal(quadro.canAnnotateClear(visivel, '9', { isLeader: true }), true);
  assert.equal(quadro.canAnnotateSee(visivel, '9', {}), true);
  assert.equal(quadro.canAnnotateDraw(escondido, '7', { isLeader: false }), true);
  assert.equal(quadro.canAnnotateDraw(escondido, '9', { isLeader: true }), false);
  assert.equal(quadro.canAnnotateClear(escondido, '7', { isLeader: false }), true);
  assert.equal(quadro.canAnnotateClear(escondido, '9', { isLeader: true }), false);
  assert.equal(quadro.canAnnotateSee(escondido, '7', {}), true);
  assert.equal(quadro.canAnnotateSee(escondido, '9', {}), false);
});

test('isPrivate indica quando o cursor nao pode sair do quadro', () => {
  assert.equal(quadro.isPrivate({ owner: '7', hidden: false }), false);
  assert.equal(quadro.isPrivate({ owner: '7', hidden: true }), true);
});

test('dropPeer mostra de novo o quadro escondido se quem criou sai', () => {
  const s = { owner: '7', hidden: true };
  assert.deepEqual(quadro.dropPeer(s, '7'), { owner: '7', hidden: false });
  assert.equal(quadro.dropPeer(s, '9'), s);
});

test('o estado (so o dono) cabe folgado no teto declarado', () => {
  const s = quadro.init({ by: '123456789012' });
  assert.ok(jsonBytes(s) <= quadro.maxStateBytes);
});

test('summary indica quando o quadro esta escondido', () => {
  assert.equal(R(quadro.summary({ owner: '7', hidden: true })), 'Quadro escondido');
  assert.equal(typeof R(quadro.summary(quadro.init({}))), 'string');
});

// ---- Auditoria da Mesa 2026-11-25 (J-16): quadro escondido cujo dono saiu da sala (migracao) ----

test('J-16: dono que nao esta mais na sala (id antigo da migracao) nao segura o quadro escondido', () => {
  const escondido = { owner: '1', hidden: true };
  const sala = { peers: [{ id: '7' }, { id: '8' }], isLeader: false };
  assert.equal(quadro.canAnnotateSee(escondido, '8', sala), true);
  assert.equal(quadro.canAnnotateDraw(escondido, '8', sala), true);
  assert.equal(quadro.isPrivate(escondido, sala), false);
  // Sem dono na sala vale a regra do quadro aberto: limpar e do lider (ou do dono, que nao existe mais).
  assert.equal(quadro.canAnnotateClear(escondido, '8', sala), false);
  assert.equal(quadro.canAnnotateClear(escondido, '8', { ...sala, isLeader: true }), true);
});

test('J-16: com o dono na sala o quadro escondido segue escondido', () => {
  const escondido = { owner: '7', hidden: true };
  const sala = { peers: [{ id: '7' }, { id: '8' }], isLeader: false };
  assert.equal(quadro.canAnnotateSee(escondido, '8', sala), false);
  assert.equal(quadro.canAnnotateDraw(escondido, '8', sala), false);
  assert.equal(quadro.canAnnotateSee(escondido, '7', sala), true);
  assert.equal(quadro.isPrivate(escondido, sala), true);
  assert.equal(quadro.isPrivate(escondido), true, 'sem lista de peers (cliente antigo) vale o estado');
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MIGRATION_STEP_MS,
  ABRUPT_SLACK_MS,
  PROOF_MAX_AGE_MS,
  baseDelayMs,
  turnAt,
  decide,
  hostSuccessCheck,
  finishHostSuccessCheck,
  hostSuccessAction,
  successionOrder,
  dialPorts,
  dialAddresses,
  migrationProof,
  verifyMigrationBeacon,
} = require('./migration');
const { worstCaseReconnectMs, MAX_RECONNECT } = require('./reconnect');
const { formatMigrationBeacon, parseMigrationBeacon, signMigrationBeacon } = require('../main/discovery');

// Relogio injetado: todos os instantes sao relativos a queda (dropAt = 0).
const ORDER = ['2', '3', '4']; // host era '1'

test('caminho gracioso mantem os tempos de antes: sucessor ja, proximo aos 15 s, depois aos 30 s', () => {
  const baseMs = baseDelayMs({ abrupt: false });
  assert.equal(baseMs, 0);
  assert.equal(MIGRATION_STEP_MS, 15000);
  assert.equal(decide({ order: ORDER, myId: '2', dropAt: 0, baseMs, now: 0 }).action, 'host');
  const tres = decide({ order: ORDER, myId: '3', dropAt: 0, baseMs, now: 0 });
  assert.equal(tres.action, 'dial');
  assert.deepEqual(tres.targets, ['2']);
  assert.equal(tres.nextTurnAt, 15000);
  assert.equal(decide({ order: ORDER, myId: '3', dropAt: 0, baseMs, now: 14999 }).action, 'dial');
  assert.equal(decide({ order: ORDER, myId: '3', dropAt: 0, baseMs, now: 15000 }).action, 'host');
  assert.equal(decide({ order: ORDER, myId: '4', dropAt: 0, baseMs, now: 29999 }).action, 'dial');
  assert.equal(decide({ order: ORDER, myId: '4', dropAt: 0, baseMs, now: 30000 }).action, 'host');
});

test('caminho abrupto: a base e o pior caso da reconexao + folga, igual pra todos', () => {
  const worst = worstCaseReconnectMs(MAX_RECONNECT);
  const baseMs = baseDelayMs({ abrupt: true, worstCaseReconnectMs: worst });
  assert.equal(baseMs, worst + ABRUPT_SLACK_MS);
  // Quem desiste cedo (60 s, recusas rapidas) e quem desiste tarde (116 s)
  // chegam a MESMA decisao, porque a conta parte da queda.
  for (const now of [60000, worst]) {
    assert.equal(decide({ order: ORDER, myId: '2', dropAt: 0, baseMs, now }).action, 'host');
    assert.deepEqual(decide({ order: ORDER, myId: '3', dropAt: 0, baseMs, now }).targets, ['2']);
    assert.deepEqual(decide({ order: ORDER, myId: '4', dropAt: 0, baseMs, now }).targets, ['2']);
  }
  assert.equal(decide({ order: ORDER, myId: '3', dropAt: 0, baseMs, now: baseMs + MIGRATION_STEP_MS }).action, 'host');
});

test('em cada instante existe exatamente UM candidato que assume (a sala nao se parte)', () => {
  for (const abrupt of [false, true]) {
    const baseMs = baseDelayMs({ abrupt, worstCaseReconnectMs: worstCaseReconnectMs(MAX_RECONNECT) });
    for (let now = 0; now <= baseMs + 5 * MIGRATION_STEP_MS; now += 500) {
      const hosts = ORDER.filter((myId) => decide({ order: ORDER, myId, dropAt: 0, baseMs, now }).action === 'host');
      assert.equal(hosts.length, 1, `abrupt=${abrupt} now=${now}: ${hosts}`);
    }
  }
});

test('sucessor que perdeu a vez procura o da vez em vez de subir uma segunda sala', () => {
  const d = decide({ order: ORDER, myId: '2', dropAt: 0, baseMs: 0, now: MIGRATION_STEP_MS + 1 });
  assert.equal(d.action, 'dial');
  assert.deepEqual(d.targets, ['3']);
});

test('sucessor que terminou de subir depois da vez seguinte sonda o candidato atual antes de anunciar', () => {
  const check = hostSuccessCheck({ order: ORDER, myId: '2', dropAt: 0, baseMs: 0, now: MIGRATION_STEP_MS + 1 });
  assert.equal(check.action, 'probe');
  assert.deepEqual(check.targets, ['3']);
  assert.equal(finishHostSuccessCheck(check, { sameRoom: true }), 'yield');
});

test('sucessor atrasado ainda assume se a sondagem pos-host nao achar uma sala', () => {
  const check = hostSuccessCheck({ order: ORDER, myId: '2', dropAt: 0, baseMs: 0, now: MIGRATION_STEP_MS + 1 });
  assert.equal(check.action, 'probe');
  // O renderer so anuncia depois desta sonda; `null` significa que nao ha
  // sala viva no candidato cuja vez ja comecou.
  assert.equal(finishHostSuccessCheck(check, null), 'assume');
});

test('tentativa abandonada que resolve depois manda derrubar sem anunciar beacon', () => {
  // O token 7 foi invalidado quando a sonda encontrou a sala do proximo
  // candidato; o renderer mapeia `discard` para abortHosting, antes do beacon.
  assert.equal(hostSuccessAction({ attemptToken: 7, currentAttemptToken: 8 }), 'discard');
});

test('quem espera procura o da vez E os anteriores (sucessor atrasado ainda junta a sala)', () => {
  const d = decide({ order: ORDER, myId: '4', dropAt: 0, baseMs: 0, now: MIGRATION_STEP_MS });
  assert.deepEqual(d.targets, ['2', '3']);
  assert.equal(d.nextTurnAt, 2 * MIGRATION_STEP_MS);
});

test('decide devolve none pra quem nao esta na lista (o proprio lider)', () => {
  assert.equal(decide({ order: ORDER, myId: '1', dropAt: 0, now: 0 }).action, 'none');
});

test('turnAt nao passa do ultimo candidato e devolve -1 sem candidatos', () => {
  assert.equal(turnAt({ count: 3, dropAt: 0, now: 10 * MIGRATION_STEP_MS }), 2);
  assert.equal(turnAt({ count: 0, dropAt: 0, now: 0 }), -1);
});

test('successionOrder segue a ordem numerica sem o host e poe o sucessor anunciado na frente', () => {
  assert.deepEqual(successionOrder(['10', '1', '3', '2'], '1'), ['2', '3', '10']);
  assert.deepEqual(successionOrder(['10', '1', '3', '2'], '1', '3'), ['3', '2', '10']);
  assert.deepEqual(successionOrder(['1', '2'], '1', '1'), ['2']);
});

test('dialPorts tenta a porta da sala toda rodada e a faixa inteira so de tempos em tempos', () => {
  assert.deepEqual(dialPorts(9003, 0), [9003]);
  assert.deepEqual(dialPorts(9003, 1), [9003]);
  const sweep = dialPorts(9003, 5);
  assert.equal(sweep[0], 9003);
  assert.equal(sweep.length, 11);
  assert.equal(new Set(sweep).size, 11);
  assert.deepEqual(dialPorts(null, 0), [9000]);
});

test('dialAddresses monta ip:porta por candidato, IPv6 entre colchetes, e pula quem nao tem IP', () => {
  const addresses = { 2: '100.64.0.2', 3: 'fd7a:115c::3' };
  assert.deepEqual(dialAddresses({ targets: ['2', '3', '9'], addresses, port: 9001 }), ['100.64.0.2:9001', '[fd7a:115c::3]:9001']);
});

// --- Prova do beacon (item C) ---------------------------------------------

const SEGREDO = 'segredo-atual-da-sala';

test('a prova do renderer (WebCrypto) e a do main (node:crypto) sao a mesma conta', async () => {
  const ts = 1_700_000_000_000;
  assert.equal(await migrationProof(SEGREDO, 'sala', '10.0.0.5:9000', ts), signMigrationBeacon(SEGREDO, 'sala', '10.0.0.5:9000', ts));
});

test('beacon assinado com o segredo atual e aceito', async () => {
  const now = 1_700_000_000_000;
  const beacon = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.5:9000', port: 9000, secret: SEGREDO, ts: now }));
  assert.equal(await verifyMigrationBeacon({ beacon, roomId: 'sala', secret: SEGREDO, now: now + 1000 }), true);
});

test('beacon com roomId certo mas prova errada, ausente ou adulterada e ignorado', async () => {
  const now = 1_700_000_000_000;
  const semProva = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.66:9000', port: 9000 }));
  assert.equal(await verifyMigrationBeacon({ beacon: semProva, roomId: 'sala', secret: SEGREDO, now }), false);
  const outroSegredo = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.66:9000', port: 9000, secret: 'chute', ts: now }));
  assert.equal(await verifyMigrationBeacon({ beacon: outroSegredo, roomId: 'sala', secret: SEGREDO, now }), false);
  const legitimo = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.5:9000', port: 9000, secret: SEGREDO, ts: now }));
  // A prova cobre o endereco: trocar pra onde o beacon aponta a invalida.
  assert.equal(await verifyMigrationBeacon({ beacon: { ...legitimo, address: '10.0.0.66:9000' }, roomId: 'sala', secret: SEGREDO, now }), false);
  // E cobre o roomId: a prova de outra sala nao serve nesta.
  const outraSala = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'outra', address: '10.0.0.5:9000', port: 9000, secret: SEGREDO, ts: now }));
  assert.equal(await verifyMigrationBeacon({ beacon: { ...outraSala, roomId: 'sala' }, roomId: 'sala', secret: SEGREDO, now }), false);
});

test('beacon antigo (fora da janela) e ignorado mesmo com a prova certa', async () => {
  const ts = 1_700_000_000_000;
  const beacon = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.5:9000', port: 9000, secret: SEGREDO, ts }));
  assert.equal(await verifyMigrationBeacon({ beacon, roomId: 'sala', secret: SEGREDO, now: ts + PROOF_MAX_AGE_MS + 1 }), false);
  assert.equal(await verifyMigrationBeacon({ beacon, roomId: 'sala', secret: SEGREDO, now: ts - PROOF_MAX_AGE_MS - 1 }), false);
});

test('sem segredo conhecido nenhum beacon e seguido', async () => {
  const now = 1_700_000_000_000;
  const beacon = parseMigrationBeacon(formatMigrationBeacon({ roomId: 'sala', address: '10.0.0.5:9000', port: 9000, secret: SEGREDO, ts: now }));
  assert.equal(await verifyMigrationBeacon({ beacon, roomId: 'sala', secret: null, now }), false);
});

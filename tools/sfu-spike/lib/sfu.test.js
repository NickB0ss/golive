'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LocalSfu, createLocalSfu, validateListenIp, validatePortRange, DEFAULT_MEDIA_CODECS } = require('./sfu');
const { createFakeMediasoup } = require('./fake-mediasoup');

const OWNER = 'wc:1';
const OTHER = 'wc:2';
const DTLS = { role: 'client', fingerprints: [{ algorithm: 'sha-256', value: 'AA' }] };
const RTP_PARAMS = { codecs: [{ mimeType: 'video/H264', payloadType: 108, clockRate: 90000 }], encodings: [{ ssrc: 1 }] };
const CAPS = { codecs: [{ mimeType: 'video/H264' }], headerExtensions: [] };

async function make(behavior, options) {
  const ms = createFakeMediasoup(behavior);
  const sfu = new LocalSfu({ mediasoup: ms, closeTimeoutMs: 80, ...options });
  await sfu.start();
  return { ms, sfu, worker: ms.workers[0], router: ms.workers[0].routers[0] };
}

const rq = (sfu, method, params, owner = OWNER) => sfu.request(method, params, { owner });

/** Produtor completo: join, transport de envio, connect, produce. */
async function setupProducer(sfu, owner = OWNER) {
  const { peerId } = await rq(sfu, 'join', { role: 'producer' }, owner);
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'send' }, owner);
  await rq(sfu, 'connectTransport', { peerId, transportId: tr.id, dtlsParameters: DTLS }, owner);
  const { id } = await rq(sfu, 'produce', { peerId, transportId: tr.id, kind: 'video', rtpParameters: RTP_PARAMS }, owner);
  return { peerId, transportId: tr.id, producerId: id };
}

async function setupConsumer(sfu, producerId, owner = OWNER) {
  const { peerId } = await rq(sfu, 'join', { role: 'consumer' }, owner);
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'recv' }, owner);
  const c = await rq(sfu, 'consume', { peerId, transportId: tr.id, producerId, rtpCapabilities: CAPS }, owner);
  return { peerId, transportId: tr.id, consumer: c };
}

async function rejects(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `esperava ${code}, veio ${err.code}: ${err.message}`);
    return true;
  });
}

test('listenIp so aceita loopback; 0.0.0.0, :: e IP de LAN sao recusados', () => {
  assert.equal(validateListenIp('127.0.0.1'), '127.0.0.1');
  assert.equal(validateListenIp('::1'), '::1');
  for (const bad of ['0.0.0.0', '::', '192.168.0.10', '', 'localhost', 42]) {
    assert.throws(() => validateListenIp(bad), (err) => err.code === 'BAD_LISTEN_IP');
  }
  assert.throws(() => new LocalSfu({ listenIp: '0.0.0.0' }), (err) => err.code === 'BAD_LISTEN_IP');
});

test('transports usam listenInfos em 127.0.0.1, so UDP, sem announcedAddress nem listenIps', async () => {
  const { sfu, router } = await make();
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  const opts = router.transports[0].options;
  assert.deepEqual(opts.listenInfos, [{ protocol: 'udp', ip: '127.0.0.1' }]);
  assert.equal(opts.enableTcp, false);
  assert.equal(opts.enableUdp, true);
  assert.equal('listenIps' in opts, false);
  assert.equal('announcedAddress' in opts.listenInfos[0], false);
  assert.equal('announcedIp' in opts.listenInfos[0], false);
  assert.ok(tr.iceCandidates.every((c) => c.ip === '127.0.0.1'));
  await sfu.close();
});

test('router so oferece H.264 primeiro e VP8 depois (preferencia explicita)', () => {
  assert.equal(DEFAULT_MEDIA_CODECS[0].mimeType, 'video/H264');
  assert.equal(DEFAULT_MEDIA_CODECS[1].mimeType, 'video/VP8');
});

test('metodo desconhecido, nomes de prototipo e chamada sem dono sao recusados', async () => {
  const { sfu } = await make();
  for (const m of ['__proto__', 'constructor', 'close', 'toString', '_m_join', 'stats ', 42, undefined]) {
    await rejects(sfu.request(m, {}, { owner: OWNER }), 'METHOD_NOT_FOUND');
  }
  await rejects(sfu.request('join', { role: 'consumer' }, {}), 'FORBIDDEN');
  await rejects(sfu.request('join', { role: 'consumer' }), 'FORBIDDEN');
  await rejects(rq(sfu, 'join', 'texto'), 'BAD_REQUEST');
  await rejects(rq(sfu, 'join', { role: 'admin' }), 'BAD_REQUEST');
  await sfu.close();
});

test('peer pertence ao dono: outro dono e peerId inventado dao FORBIDDEN igual', async () => {
  const { sfu } = await make();
  const p = await setupProducer(sfu);
  await rejects(rq(sfu, 'createTransport', { peerId: p.peerId, direction: 'send' }, OTHER), 'FORBIDDEN');
  await rejects(rq(sfu, 'leave', { peerId: p.peerId }, OTHER), 'FORBIDDEN');
  await rejects(rq(sfu, 'leave', { peerId: 'inventado' }), 'FORBIDDEN');
  await rejects(rq(sfu, 'leave', { peerId: 123 }), 'BAD_REQUEST');
  await sfu.close();
});

test('IDs de transport/consumer so valem dentro do peer que os criou', async () => {
  const { sfu } = await make();
  const prod = await setupProducer(sfu);
  const a = await setupConsumer(sfu, prod.producerId);
  const b = await setupConsumer(sfu, prod.producerId);
  // transport do consumidor A usado pelo B
  await rejects(rq(sfu, 'connectTransport', { peerId: b.peerId, transportId: a.transportId, dtlsParameters: DTLS }), 'FORBIDDEN');
  // transport do produtor usado por consumidor
  await rejects(rq(sfu, 'consume', { peerId: b.peerId, transportId: prod.transportId, producerId: prod.producerId, rtpCapabilities: CAPS }), 'FORBIDDEN');
  // consumer do A retomado pelo B
  await rejects(rq(sfu, 'resumeConsumer', { peerId: b.peerId, consumerId: a.consumer.id }), 'FORBIDDEN');
  // id arbitrario
  await rejects(rq(sfu, 'resumeConsumer', { peerId: b.peerId, consumerId: 'qualquer' }), 'FORBIDDEN');
  await rejects(rq(sfu, 'connectTransport', { peerId: b.peerId, transportId: 'tr-999', dtlsParameters: DTLS }), 'FORBIDDEN');
  // o proprio dono do B retoma o seu
  const ok = await rq(sfu, 'resumeConsumer', { peerId: a.peerId, consumerId: a.consumer.id });
  assert.equal(ok.paused, false);
  await sfu.close();
});

test('papel e direcao: produtor so envia, consumidor so recebe; um transport por peer', async () => {
  const { sfu } = await make();
  const { peerId: prod } = await rq(sfu, 'join', { role: 'producer' });
  await rejects(rq(sfu, 'createTransport', { peerId: prod, direction: 'recv' }), 'BAD_STATE');
  await rq(sfu, 'createTransport', { peerId: prod, direction: 'send' });
  await rejects(rq(sfu, 'createTransport', { peerId: prod, direction: 'send' }), 'BAD_STATE');
  const { peerId: cons } = await rq(sfu, 'join', { role: 'consumer' });
  await rejects(rq(sfu, 'createTransport', { peerId: cons, direction: 'send' }), 'BAD_STATE');
  await rejects(rq(sfu, 'createTransport', { peerId: cons, direction: 'sideways' }), 'BAD_REQUEST');
  await sfu.close();
});

test('produce exige transport conectado, kind video e e um unico envio', async () => {
  const { sfu } = await make();
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  const args = { peerId, transportId: tr.id, kind: 'video', rtpParameters: RTP_PARAMS };
  await rejects(rq(sfu, 'produce', args), 'BAD_STATE'); // ainda nao conectado
  await rq(sfu, 'connectTransport', { peerId, transportId: tr.id, dtlsParameters: DTLS });
  await rejects(rq(sfu, 'connectTransport', { peerId, transportId: tr.id, dtlsParameters: DTLS }), 'BAD_STATE'); // connect duplo
  await rejects(rq(sfu, 'produce', { ...args, kind: 'audio' }), 'BAD_REQUEST');
  await rejects(rq(sfu, 'produce', { ...args, rtpParameters: { codecs: [] } }), 'BAD_REQUEST');
  await rejects(rq(sfu, 'produce', { ...args, rtpParameters: 'x' }), 'BAD_REQUEST');
  await rq(sfu, 'produce', args);
  await rejects(rq(sfu, 'produce', args), 'BAD_STATE'); // segundo envio
  await rejects(rq(sfu, 'join', { role: 'producer' }), 'LIMIT'); // segundo produtor
  await sfu.close();
});

test('consume cria o consumer PAUSADO, valida canConsume e nao exige DTLS conectado', async () => {
  const { sfu, router } = await make();
  const prod = await setupProducer(sfu);
  const c = await setupConsumer(sfu, prod.producerId); // recv nunca conectou
  assert.equal(c.consumer.paused, true);
  assert.equal(router.transports[1].consumers[0].options.paused, true);
  assert.equal(router.canConsumeCalls.length, 1);
  assert.equal(router.canConsumeCalls[0].producerId, prod.producerId);
  assert.equal(router.transports[1].connected, false);

  const { peerId } = await rq(sfu, 'join', { role: 'consumer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'recv' });
  await rejects(rq(sfu, 'consume', { peerId, transportId: tr.id, producerId: 'nao-existe', rtpCapabilities: CAPS }), 'NO_PRODUCER');
  await rejects(rq(sfu, 'consume', { peerId, transportId: tr.id, producerId: prod.producerId, rtpCapabilities: 'x' }), 'BAD_REQUEST');
  router.canConsumeResult = false;
  await rejects(rq(sfu, 'consume', { peerId, transportId: tr.id, producerId: prod.producerId, rtpCapabilities: CAPS }), 'CANNOT_CONSUME');
  router.canConsumeResult = true;
  await rq(sfu, 'consume', { peerId, transportId: tr.id, producerId: prod.producerId, rtpCapabilities: CAPS });
  await rejects(rq(sfu, 'consume', { peerId, transportId: tr.id, producerId: prod.producerId, rtpCapabilities: CAPS }), 'BAD_STATE'); // segundo consume do mesmo peer
  await sfu.close();
});

test('so resume depois do consume; segundo resume e inofensivo', async () => {
  const { sfu, router } = await make();
  const prod = await setupProducer(sfu);
  const c = await setupConsumer(sfu, prod.producerId);
  assert.equal(router.transports[1].consumers[0].paused, true);
  await rq(sfu, 'resumeConsumer', { peerId: c.peerId, consumerId: c.consumer.id });
  assert.equal(router.transports[1].consumers[0].paused, false);
  await rq(sfu, 'resumeConsumer', { peerId: c.peerId, consumerId: c.consumer.id });
  await sfu.close();
});

test('leave fecha consumer e transport do peer e e idempotente; os outros seguem', async () => {
  const { sfu, router } = await make();
  const prod = await setupProducer(sfu);
  const a = await setupConsumer(sfu, prod.producerId);
  const b = await setupConsumer(sfu, prod.producerId);
  assert.deepEqual((await sfu.stats()).counts, { peers: 3, transports: 3, producers: 1, consumers: 2 });
  assert.deepEqual(await rq(sfu, 'leave', { peerId: a.peerId }), { left: true, already: false });
  assert.equal(router.transports[1].closed, true);
  assert.equal(router.transports[1].consumers[0].closed, true);
  assert.equal(router.transports[2].closed, false);
  assert.deepEqual(await rq(sfu, 'leave', { peerId: a.peerId }), { left: true, already: true });
  const stats = await sfu.stats();
  assert.deepEqual(stats.counts, { peers: 2, transports: 2, producers: 1, consumers: 1 });
  assert.equal(stats.consumers[0].peerId, b.peerId);
  assert.equal(stats.listen.ip, '127.0.0.1');
  assert.equal(stats.workerResourceUsage.ru_utime, 10);
  // peer que saiu nao opera mais
  await rejects(rq(sfu, 'createTransport', { peerId: a.peerId, direction: 'recv' }), 'BAD_STATE');
  await sfu.close();
});

test('o produtor saindo libera o slot de producer', async () => {
  const { sfu } = await make();
  const prod = await setupProducer(sfu);
  await rq(sfu, 'leave', { peerId: prod.peerId });
  assert.equal(sfu.producer, null);
  const again = await setupProducer(sfu); // pode produzir de novo
  assert.ok(again.producerId);
  await sfu.close();
});

test('close() e idempotente: mesma promessa, worker.close uma vez, subprocessclose aguardado', async () => {
  const { sfu, worker } = await make();
  const prod = await setupProducer(sfu);
  await setupConsumer(sfu, prod.producerId);
  const p1 = sfu.close();
  const p2 = sfu.close();
  assert.equal(p1, p2);
  const r = await p1;
  assert.equal(r.subprocessClosed, true);
  assert.equal(r.timedOut, false);
  assert.equal(r.forcedKill, false);
  assert.equal(r.died, false);
  assert.equal(r.ports.length, 2);
  assert.equal(worker.closeCalls, 1);
  assert.equal(sfu.state, 'closed');
  assert.equal(await sfu.close(), r);
  await rejects(rq(sfu, 'join', { role: 'consumer' }), 'NOT_RUNNING');
  await rejects(sfu.stats(), 'NOT_RUNNING');
});

test('close() com subprocessclose que nao chega: timeout, kill forcado e relatorio honesto', async () => {
  const killed = [];
  const { sfu } = await make({ hangOnClose: true }, { killProcess: (pid) => killed.push(pid) });
  const r = await sfu.close();
  assert.equal(r.subprocessClosed, false);
  assert.equal(r.timedOut, true);
  assert.equal(r.forcedKill, true);
  assert.deepEqual(killed, [r.workerPid]);
});

test('worker morto: requisicoes dao WORKER_DIED e close() ainda conclui marcando died', async () => {
  const { sfu, worker } = await make();
  worker.die('segfault');
  assert.equal(sfu.state, 'died');
  await rejects(rq(sfu, 'join', { role: 'consumer' }), 'WORKER_DIED');
  await rejects(sfu.stats(), 'WORKER_DIED');
  const r = await sfu.close();
  assert.equal(r.died, true);
  assert.match(r.diedError, /segfault/);
  assert.equal(r.subprocessClosed, true);
});

test('close() durante a criacao do worker: nada vaza e start() rejeita CLOSED', async () => {
  const ms = createFakeMediasoup({ workerDelayMs: 40 });
  const sfu = new LocalSfu({ mediasoup: ms, closeTimeoutMs: 80 });
  const started = sfu.start();
  const closed = sfu.close();
  await rejects(started, 'CLOSED');
  const r = await closed;
  assert.equal(ms.workers.length, 1);
  assert.equal(ms.workers[0].closed, true);
  assert.equal(ms.workers[0].routers.length, 0, 'router nao deve nascer depois do close');
  assert.equal(r.subprocessClosed, true);
  assert.equal(sfu.state, 'closed');
});

test('close() durante a criacao do router desfaz o worker', async () => {
  const ms = createFakeMediasoup({ routerDelayMs: 40 });
  const sfu = new LocalSfu({ mediasoup: ms, closeTimeoutMs: 80 });
  const started = sfu.start();
  await new Promise((r) => { setTimeout(r, 15); });
  const closed = sfu.close();
  await rejects(started, 'CLOSED');
  const r = await closed;
  assert.equal(ms.workers[0].closed, true);
  assert.equal(r.subprocessClosed, true);
});

test('transport que termina de nascer depois do leave e fechado (sem vazar)', async () => {
  const { sfu, router, worker } = await make({ transportDelayMs: 40 });
  const { peerId } = await rq(sfu, 'join', { role: 'consumer' });
  const creating = rq(sfu, 'createTransport', { peerId, direction: 'recv' });
  await new Promise((r) => { setTimeout(r, 10); });
  await rq(sfu, 'leave', { peerId });
  await rejects(creating, 'CLOSED');
  assert.equal(router.transports[0].closed, true);
  assert.equal(worker.closeCalls, 0);
  await sfu.close();
});

test('timeout de criacao do worker: erro START_TIMEOUT e worker tardio e fechado', async () => {
  const ms = createFakeMediasoup({ workerDelayMs: 60 });
  const sfu = new LocalSfu({ mediasoup: ms, startTimeoutMs: 20, closeTimeoutMs: 50 });
  await rejects(sfu.start(), 'START_TIMEOUT');
  await new Promise((r) => { setTimeout(r, 120); });
  assert.equal(ms.workers.length, 1);
  assert.equal(ms.workers[0].closed, true, 'o worker que chegou depois do timeout precisa ser fechado');
  assert.equal(sfu.state, 'closed');
});

test('falha ao criar o worker: erro original e estado fechado', async () => {
  const ms = createFakeMediasoup({ createWorkerError: 'binario ausente' });
  const sfu = new LocalSfu({ mediasoup: ms });
  await assert.rejects(sfu.start(), /binario ausente/);
  const r = await sfu.close();
  assert.equal(r.workerPid, null);
  assert.equal(sfu.state, 'closed');
});

test('createLocalSfu devolve request/stats/close e fecha de verdade', async () => {
  const ms = createFakeMediasoup();
  const api = await createLocalSfu({ mediasoup: ms, listenIp: '127.0.0.1', closeTimeoutMs: 50 });
  const { peerId } = await api.request('join', { role: 'consumer' }, { owner: OWNER });
  assert.ok(peerId);
  assert.equal((await api.stats()).counts.peers, 1);
  const r = await api.close();
  assert.equal(r.subprocessClosed, true);
  await assert.rejects(createLocalSfu({ mediasoup: ms, listenIp: '0.0.0.0' }), (e) => e.code === 'BAD_LISTEN_IP');
});

test('requisicao lenta recebe TIMEOUT estruturado', async () => {
  const { sfu, router } = await make({ transportDelayMs: 200 }, { requestTimeoutMs: 30 });
  const { peerId } = await rq(sfu, 'join', { role: 'consumer' });
  await rejects(rq(sfu, 'createTransport', { peerId, direction: 'recv' }), 'TIMEOUT');
  await sfu.close();
  await new Promise((r) => { setTimeout(r, 250); });
  assert.ok(router.transports.every((t) => t.closed), 'transport tardio nao pode sobrar aberto');
});

test('parametros gigantes sao recusados antes de chegar ao mediasoup', async () => {
  const { sfu } = await make();
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  await rejects(rq(sfu, 'connectTransport', { peerId, transportId: 'x', dtlsParameters: { fingerprints: [], lixo: 'a'.repeat(70000) } }), 'BAD_REQUEST');
  await sfu.close();
});

test('portRange vai em listenInfos[].portRange (nao em rtcMinPort/rtcMaxPort obsoletos) e e validado', async () => {
  const { ms, sfu, router } = await make({}, { portRange: { min: 42000, max: 42199 } });
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  assert.deepEqual(router.transports[0].options.listenInfos, [{ protocol: 'udp', ip: '127.0.0.1', portRange: { min: 42000, max: 42199 } }]);
  assert.equal('rtcMinPort' in ms.workers[0].settings, false);
  assert.equal('rtcMaxPort' in ms.workers[0].settings, false);
  await sfu.close();
  for (const bad of [{ min: 80, max: 90 }, { min: 5000, max: 4000 }, { min: 'a', max: 5000 }, {}, 'x']) {
    assert.throws(() => validatePortRange(bad), (err) => err.code === 'BAD_PORT_RANGE');
  }
  assert.equal(validatePortRange(undefined), null);
});

test('produce recusa simulcast/SVC (mais de uma codificacao) no servidor', async () => {
  const { sfu } = await make();
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  await rq(sfu, 'connectTransport', { peerId, transportId: tr.id, dtlsParameters: DTLS });
  const multi = { ...RTP_PARAMS, encodings: [{ ssrc: 1 }, { ssrc: 2 }] };
  await rejects(rq(sfu, 'produce', { peerId, transportId: tr.id, kind: 'video', rtpParameters: multi }), 'BAD_REQUEST');
  await rq(sfu, 'produce', { peerId, transportId: tr.id, kind: 'video', rtpParameters: RTP_PARAMS });
  await sfu.close();
});

test('concorrencia: dois createTransport do mesmo peer -> um passa, o outro BAD_STATE, so 1 transport no router', async () => {
  const { sfu, router } = await make({ transportDelayMs: 20 });
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const res = await Promise.allSettled([
    rq(sfu, 'createTransport', { peerId, direction: 'send' }),
    rq(sfu, 'createTransport', { peerId, direction: 'send' }),
  ]);
  assert.deepEqual(res.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(res.find((r) => r.status === 'rejected').reason.code, 'BAD_STATE');
  assert.equal(router.transports.length, 1);
  assert.equal((await sfu.stats()).counts.transports, 1);
  await sfu.close();
});

test('concorrencia: reserva de createTransport e liberada quando a criacao falha', async () => {
  const { sfu, router } = await make();
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const original = router.createWebRtcTransport.bind(router);
  router.createWebRtcTransport = async () => { throw new Error('falha de bind'); };
  await assert.rejects(rq(sfu, 'createTransport', { peerId, direction: 'send' }), /falha de bind/);
  router.createWebRtcTransport = original;
  await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  await sfu.close();
});

test('concorrencia: dois produce -> um passa, o outro BAD_STATE, so 1 producer aberto', async () => {
  const { sfu, router } = await make({ produceDelayMs: 20 });
  const { peerId } = await rq(sfu, 'join', { role: 'producer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'send' });
  await rq(sfu, 'connectTransport', { peerId, transportId: tr.id, dtlsParameters: DTLS });
  const args = { peerId, transportId: tr.id, kind: 'video', rtpParameters: RTP_PARAMS };
  const res = await Promise.allSettled([rq(sfu, 'produce', args), rq(sfu, 'produce', args)]);
  assert.deepEqual(res.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(res.find((r) => r.status === 'rejected').reason.code, 'BAD_STATE');
  assert.equal(router.transports[0].producers.length, 1);
  assert.equal(router.transports[0].producers.filter((p) => !p.closed).length, 1);
  assert.equal((await sfu.stats()).counts.producers, 1);
  await sfu.close();
});

test('concorrencia: dois consume do mesmo peer -> um passa, o outro BAD_STATE, so 1 consumer aberto', async () => {
  const { sfu, router } = await make({ consumeDelayMs: 20 });
  const prod = await setupProducer(sfu);
  const { peerId } = await rq(sfu, 'join', { role: 'consumer' });
  const tr = await rq(sfu, 'createTransport', { peerId, direction: 'recv' });
  const args = { peerId, transportId: tr.id, producerId: prod.producerId, rtpCapabilities: CAPS };
  const res = await Promise.allSettled([rq(sfu, 'consume', args), rq(sfu, 'consume', args)]);
  assert.deepEqual(res.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(res.find((r) => r.status === 'rejected').reason.code, 'BAD_STATE');
  const recv = router.transports.find((t) => t.id === tr.id);
  assert.equal(recv.consumers.length, 1);
  assert.equal((await sfu.stats()).counts.consumers, 1);
  await sfu.close();
});

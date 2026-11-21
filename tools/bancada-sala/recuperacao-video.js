'use strict';

/* global document, GoLive, MediaStream, reofferOne, createScreenRelay */

// Electron standalone: nao abre o app, captura pessoal, descoberta ou updater.
// Mede quadros exibidos no render offscreen, com mesh/screenrelay e adaptadores de app.js.
// node_modules/electron/dist/electron.exe tools/bancada-sala/recuperacao-video.js
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'lab-out/recuperacao-video');
fs.mkdirSync(OUT, { recursive: true });
const profile = fs.mkdtempSync(path.join(OUT, 'perfil-'));
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding',
  'force_high_performance_gpu', 'ignore-gpu-blocklist']) app.commandLine.appendSwitch(flag);
require('../../src/main/chromiumflags').aplicarFlagsChromium(app.commandLine, console);
app.on('window-all-closed', () => {});

function appFunction(name) {
  const source = fs.readFileSync(path.join(ROOT, 'src/renderer/app.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`funcao ausente: ${name}`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}

async function scenario() {
  /* eslint-disable no-unused-vars -- bindings usados pelos adaptadores de app.js injetados pelo main */
  const { createMesh, parseKind, relayKindFor, RTC_CONFIG } = GoLive.mesh;
  RTC_CONFIG.iceServers = [];
  const quality = { width: 1280, height: 720, bitrate: 6000000, fps: 30, codec: 'video/H264' };
  const KINDS = ['screen', 'camera'];
  const cfg = { network: { tree: true } };
  const originTree = { screen: { assignments: new Map([['viewer', { role: 'direct' }]]) } };
  const plannedScreenOffers = new Map();
  const sourceswap = GoLive.sourceswap;
  const screenrelay = GoLive.screenrelay;
  const qualityFor = () => quality;
  const qualityForPeer = () => quality;
  const reapplyAudienceQuality = () => {};
  const cameraStream = null;
  /* eslint-enable no-unused-vars */
  let sharePaused = false;
  const canvas = document.createElement('canvas');
  canvas.width = quality.width; canvas.height = quality.height;
  const context = canvas.getContext('2d');
  let raw = canvas.captureStream(0).getVideoTracks()[0];
  let relay = createScreenRelay(raw);
  if (!relay) throw new Error('screenrelay indisponivel');
  const localStream = new MediaStream([relay.track]);
  let paints = 0;
  const paintTimer = setInterval(() => {
    context.fillStyle = `hsl(${paints++ % 360},70%,40%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    raw.requestFrame();
  }, 1000 / quality.fps);
  const video = document.createElement('video');
  video.muted = true; video.autoplay = true; document.body.append(video);
  let epoch = 0;
  let shown = 0;
  let offered = 0;
  const errors = [];
  const checks = [];
  const watchFrame = () => { shown += 1; video.requestVideoFrameCallback(watchFrame); };
  video.requestVideoFrameCallback(watchFrame);
  const deliver = fn => { Promise.resolve().then(fn).catch(error => errors.push(error.message)); };
  const viewer = createMesh({ send(message) {
    if (message.type === 'ice') deliver(() => origin.handleIce('viewer', message.dir, message.candidate, message.kind));
    return true;
  }, onTrack(_id, _name, stream) {
    epoch += 1; shown = 0; video.srcObject = stream;
    video.play().catch(error => errors.push(error.message));
  }, onPeerState() {} });
  const origin = createMesh({ send(message) {
    if (message.type === 'offer') {
      offered += 1;
      deliver(async () => {
        const answer = await viewer.handleOffer('origin', message.sdp, message.kind, message.renegotiate);
        await origin.handleAnswer('viewer', answer, message.kind);
      });
    } else if (message.type === 'ice') {
      deliver(() => viewer.handleIce('origin', message.dir, message.candidate, message.kind));
    }
    return true;
  }, onTrack() {}, onPeerState() {} });
  origin.addPeer('viewer', 'espectador');
  viewer.addPeer('origin', 'origem');
  const currentSession = { mesh: origin, sig: { isOpen: () => true } };
  const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
  async function waitFrames(afterEpoch, afterShown) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const stats = await viewer.inStatsFor('origin');
      const incoming = stats && [...stats.values()].find(row => row.type === 'inbound-rtp' && row.kind === 'video');
      const newInput = afterShown == null ? epoch > afterEpoch : epoch === afterEpoch && shown >= afterShown + 10;
      if (newInput && shown >= 10 && incoming?.framesDecoded >= 10) {
        return { epoch, shown, decoded: incoming.framesDecoded, width: video.videoWidth, height: video.videoHeight };
      }
      await sleep(50);
    }
    const stats = await viewer.inStatsFor('origin');
    const incoming = stats && [...stats.values()].find(row => row.type === 'inbound-rtp' && row.kind === 'video');
    throw new Error(JSON.stringify({ motivo: 'sem frames exibidos', epoch, shown, incoming,
      playback: video.getVideoPlaybackQuality().totalVideoFrames, ready: video.readyState,
      pipeline: relay.stats(), errors }));
  }
  function check(name, condition, details = {}) {
    checks.push({ name, passed: Boolean(condition), ...details });
    if (!condition) throw new Error(`falhou: ${name}`);
  }
  // Os corpos abaixo sao injetados diretamente de app.js pelo main.
  /* ADAPTADORES */
  try {
    await origin.offerTo('viewer', localStream, quality, 'screen');
    check('envio-inicial', true, await waitFrames(0));
    const beforeMissing = epoch;
    origin.closeOut('viewer', 'screen');
    check('reoffer-conexao-ausente', await reofferOne(currentSession, 'viewer', 'screen'));
    check('frames-apos-conexao-ausente', true, await waitFrames(beforeMissing));

    origin.closeOut('viewer', 'screen');
    const beforeCancelled = epoch;
    const pending = origin.offerTo('viewer', localStream, quality, 'screen');
    origin.closeOut('viewer', 'screen');
    check('oferta-interrompida-liberou-trava', await pending === false && !origin.isNegotiating('viewer', 'screen'));
    check('reoffer-apos-interrupcao', await reofferOne(currentSession, 'viewer', 'screen'));
    check('frames-apos-interrupcao', true, await waitFrames(beforeCancelled));

    originTree.screen.assignments.set('viewer', { role: 'folha' });
    const beforeDenied = offered;
    check('folha-nao-recebe-envio-direto', !await reofferOne(currentSession, 'viewer', 'screen')
      && offered === beforeDenied);
    originTree.screen.assignments.set('viewer', { role: 'direct' });
    // Inicia a demanda da PC antiga e fecha antes de sua Promise resolver.
    // A PC nova precisa aplicar a pausa independentemente dessa operacao.
    origin.setPeerDemand('viewer', 'screen', false, relay.track);
    origin.closeOut('viewer', 'screen');
    const beforePaused = epoch;
    sharePaused = true;
    check('reoffer-com-pausa', await reofferOne(currentSession, 'viewer', 'screen'));
    await origin.demandApplied('viewer', 'screen');
    check('pausa-preservada', origin.isPeerSuspended('viewer', 'screen')
      && origin.peers.get('viewer').outConns.screen.getSenders().every(sender => !sender.track));
    sharePaused = false;
    origin.setPeerDemand('viewer', 'screen', true, relay.track);
    await origin.demandApplied('viewer', 'screen');
    check('frames-apos-retomar-pausa', true, await waitFrames(beforePaused));

    // Terminar a track real encerra o leitor nativo. Trocar a fonte precisa
    // instalar outro canvas, nao aceitar uma entrada que ninguem vai ler.
    raw.stop();
    const endDeadline = performance.now() + 2000;
    while (relay.stats().loopRunning && performance.now() < endDeadline) await sleep(20);
    check('leitor-da-fonte-encerrou', !relay.stats().loopRunning);
    const nextRaw = canvas.captureStream(0).getVideoTracks()[0];
    check('relay-encerrado-recusa-troca', !relay.swapSource(nextRaw));
    const oldRelay = relay;
    relay = createScreenRelay(nextRaw);
    check('relay-novo-criado', Boolean(relay));
    localStream.removeTrack(oldRelay.track);
    localStream.addTrack(relay.track);
    origin.replaceLocalTrack('screen', 'video', relay.track);
    oldRelay.stop();
    raw = nextRaw;
    const beforeNewSource = shown;
    check('frames-apos-recriar-relay', true, await waitFrames(epoch, beforeNewSource));
    check('sem-erros-de-sinalizacao', errors.length === 0, { errors });
    return { status: 'ok', checks, pipeline: relay.stats(), paints, paused: sharePaused,
      limitations: ['Sintetico com render offscreen em loopback, sem WGC, carga de jogo ou rede entre PCs.',
        'A bancada usa backgroundThrottling false e adaptadores de qualidade fixos; nao mede politicas de banda.'] };
  } finally {
    clearInterval(paintTimer); origin.removePeer('viewer'); viewer.removePeer('origin');
    relay.stop(); raw.stop(); video.srcObject = null;
  }
}

const reportFile = path.join(OUT, `recuperacao-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
let finished = false;
function finish(report, code) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(reportFile, JSON.stringify({ runtime: process.versions, profile, ...report }, null, 2));
  console.log(JSON.stringify({ reportFile, status: report.status, checks: report.checks?.length, error: report.error }));
  app.exit(code);
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  const win = new BrowserWindow({ show: false, webPreferences: {
    offscreen: true, backgroundThrottling: false, nodeIntegration: false, contextIsolation: true,
  } });
  win.webContents.setFrameRate(60);
  win.webContents.on('paint', () => {});
  await win.loadURL('data:text/html,<title>Bancada de recuperacao</title>');
  for (const filename of ['networktiming.js', 'mesh.js', 'screenrelay.js', 'sourceswap.js']) {
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(ROOT, 'src/renderer', filename), 'utf8'));
  }
  const adapters = ['createScreenRelay', 'enforceSharePauseFor', 'offerOwnStreamTo', 'reofferOne']
    .map(appFunction).join('\n');
  const script = scenario.toString().replace('/* ADAPTADORES */', () => adapters);
  const report = await win.webContents.executeJavaScript(`(${script})()`);
  finish(report, report.status === 'ok' ? 0 : 1);
}).catch(error => finish({ status: 'error', error: error.stack || String(error) }, 1));
setTimeout(() => finish({ status: 'timeout', error: 'bancada excedeu 45 s' }, 2), 45000).unref();

/*
 * Processo principal do Electron.
 *
 * Responsabilidades:
 *   1. Ligar as flags do Chromium que liberam encoder de hardware pro WebRTC.
 *   2. Listar as telas/janelas disponiveis pro renderer montar o seletor.
 *   3. Atender o pedido de getDisplayMedia devolvendo a fonte escolhida
 *      junto com o audio do sistema (loopback, so funciona no Windows).
 */

const { app, BrowserWindow, desktopCapturer, session, ipcMain, screen, shell, globalShortcut } = require('electron');
const path = require('path');

// TODAS as features do Chromium tem que sair daqui, numa lista so:
// appendSwitch('enable-features', ...) chamado duas vezes NAO soma -- a
// segunda chamada sobrescreve a primeira, em silencio.
//
// Uma feature que nao existe nesta versao do Chromium tambem e ignorada em
// silencio -- parece que funcionou. Por isso os nomes de WGC abaixo estao
// marcados como NAO VERIFICADOS: eles mudaram de nome e de granularidade
// entre versoes. Como confirmar qual capturador esta em uso, em ordem:
//   1. rodar com --enable-logging --v=1 e procurar WgcCapturerWin no log
//      (o caminho lento aparece como ScreenCapturerWinGdi/WindowCapturerWinGdi);
//   2. teste decisivo: compartilhar uma janela de jogo em fullscreen
//      exclusivo -- GDI devolve tela preta, WGC devolve imagem.
// Ver a spec de 2026-08-23, F1.2.
const ENABLED_FEATURES = [
  // Encoder de hardware. Sem isso o Chromium as vezes cai no encoder de
  // software e 1080p60 come CPU sem necessidade.
  'WebRtcAllowH264Send',
  // Windows.Graphics.Capture: captura pelo lado da GPU. O caminho antigo
  // (GDI/BitBlt) codifica janela na CPU e devolve preto em fullscreen
  // exclusivo. NAO VERIFICADO nesta versao -- ver acima.
  'AllowWgcScreenCapturer',
  'AllowWgcWindowCapturer',
  'AllowWgcDesktopCapturer',
];
app.commandLine.appendSwitch('enable-features', ENABLED_FEATURES.join(','));
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('force_high_performance_gpu');
// Log de 2026-08-29: duas maquinas NVIDIA (RTX 3060, GTX 1650) com driver
// recente, e getGPUFeatureStatus devolve video_encode/video_decode/
// gpu_compositing todos "disabled_software" -- a GPU nao esta sendo usada
// pra nada, entao a tela codifica sempre em OpenH264. Sem essa flag o
// Chromium respeita a propria blocklist de driver; com ela, tenta o
// caminho de hardware assim mesmo. Se a maquina realmente nao aguentar, o
// pior caso e o que ja acontece hoje (cai pro software).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Sem isso o Chromium derruba o framerate quando a janela nao esta em foco.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

/** Fonte de captura escolhida no seletor do renderer. */
let selectedSourceId = null;
/** Modo de audio pro getDisplayMedia: 'none' | 'system'. So usado quando o
 * renderer decide usar o loopback de sistema padrao do Electron (ver
 * startShare em app.js) -- a captura por processo (excluir/incluir o
 * Discord, ou audio so de uma janela) roda por fora, via o addon nativo. */
let audioMode = 'system';

/** Addon nativo (WASAPI Process Loopback) pra capturar/excluir o audio de
 * um processo especifico (ex: incluir/excluir o Discord do que e
 * compartilhado). So existe no Windows com o addon compilado -- em
 * qualquer outra situacao fica null e a feature correspondente vira no-op
 * (o renderer cai pro loopback de sistema normal). */
let audioAddon = null;
/** Guardado pra logar depois que o logger existir (setupLogger roda mais
 * abaixo) -- se o addon nao carregou, e crucial que isso fique registrado:
 * a falha e completamente silenciosa pro usuario (a UI nao acusa nada, so
 * "incluir o som do Discord" e o eco/loop de audio entre duas pessoas
 * compartilhando tela param de funcionar direito). Ver a auditoria de
 * 2026-08-27, item C2 -- um build empacotado sem o .node cai exatamente
 * aqui, sem avisar ninguem. */
let audioAddonLoadError = null;
try {
  audioAddon = require(path.join(__dirname, '..', 'build', 'Release', 'golive_audio.node'));
} catch (err) {
  audioAddon = null;
  audioAddonLoadError = err;
}
/** captureId -> instancia nativa LoopbackCapture em andamento. */
const activeCaptures = new Map();
let nextCaptureId = 1;

let win = null;
/** Controle do auto-updater, preenchido em whenReady (so em build empacotado). */
let updater = null;

const { createSignalingServer } = require('../server/signaling-core');
const { pickAddress } = require('./main/network');
const { ensureFirewallRule } = require('./main/firewall');
const { findFreeServer } = require('./main/ports');
const { createDiscovery } = require('./main/discovery');
const { setupAutoUpdater } = require('./main/updater');
const { setupLogger } = require('./main/logger');
const { thumbnailDataUrl } = require('./main/thumbs');

// Criado cedo (antes de whenReady) pra pegar exceptions que acontecam
// durante a inicializacao tambem. app.getPath('userData') ja funciona
// aqui -- so depende do appId, fixado no topo deste arquivo via app info
// implicita do Electron.
const logger = setupLogger();
logger.log(`GoLive iniciando -- versao ${app.getVersion()}, log em ${logger.path}`);
if (audioAddonLoadError) {
  logger.error(
    'addon de audio nativo indisponivel -- "incluir o som do Discord" e a exclusao do audio do proprio GoLive vao ficar fora do ar:',
    audioAddonLoadError.message
  );
}
process.on('uncaughtException', (err) => logger.error('uncaughtException no main:', err?.stack || err));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection no main:', err?.stack || err));

// Processo de GPU caindo repetidamente e o Chromium desligando a
// aceleracao em silencio depois -- exatamente o quadro do log de
// 2026-08-29 (tudo "disabled_software" numa RTX 3060). `render-process-gone`
// nao pega isto: e outro processo filho.
app.on('child-process-gone', (_event, details) => {
  const grave = details.type === 'GPU' || details.reason !== 'clean-exit';
  logger[grave ? 'error' : 'log'](
    `processo filho encerrou: type=${details.type} name=${details.name || details.serviceName || '-'}`
    + ` reason=${details.reason} exitCode=${details.exitCode}`
  );
});

/** Servidor de sinalizacao embutido, quando este processo esta hospedando. */
let embeddedServer = null;
/** Nome do host da sala ativa, pra reusar no beacon quando o toggle de
 * anunciar e ligado depois (Configuracoes > Rede), sem precisar do renderer
 * reenviar o nome. */
let hostedRoomName = 'anônimo';

/** Descoberta de salas via broadcast UDP. Sempre escuta (independente de
 * estar anunciando ou nao); so publica beacons enquanto houver sala local
 * ativa com "anunciar" ligado. */
const discovery = createDiscovery();
let discoveryStarted = false;

async function ensureDiscoveryStarted() {
  if (discoveryStarted) return;
  discoveryStarted = true;
  discovery.setOnRoomsChange((rooms) => {
    if (win && !win.isDestroyed()) win.webContents.send('rooms:discovered', rooms);
  });
  try {
    await discovery.start();
  } catch {
    discoveryStarted = false; // best-effort: sem descoberta o resto do app segue funcionando
  }
}

async function closeEmbeddedServer() {
  if (!embeddedServer) return;
  await embeddedServer.close();
  embeddedServer = null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1116',
    title: 'GoLive LAN',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.on('enter-full-screen', () => win?.webContents.send('window:fullscreen-changed', true));
  win.on('leave-full-screen', () => win?.webContents.send('window:fullscreen-changed', false));

  // Quem transmite passa a maior parte do tempo com o jogo por cima. Estes
  // eventos sao o sinal pro renderer parar de PINTAR (prévia local, tiles,
  // stats) -- a captura e o encode do WebRTC vivem no processo de GPU e
  // seguem intactos. Ver a spec de 2026-08-23, F1.4.
  //
  // 'minimize'/'restore' vem alem do document.visibilityState porque
  // disable-renderer-backgrounding (acima) faz o Chromium tratar o renderer
  // como visivel em situacoes em que ele nao esta.
  const sendVisibility = (visible) => {
    if (win && !win.isDestroyed()) win.webContents.send('window:visibility-changed', visible);
  };
  win.on('minimize', () => sendVisibility(false));
  win.on('restore', () => sendVisibility(true));
  win.on('show', () => sendVisibility(true));
  win.on('hide', () => sendVisibility(false));

  // Instrumentacao pro relato de "saiu da sala sozinho, sem crash visivel":
  // se o renderer cair ou travar sob carga (encoder de software pegando a
  // CPU), isso fecha a conexao de sinalizacao sem deixar rastro nenhum hoje.
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`renderer caiu: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on('unresponsive', () => {
    logger.error('renderer ficou sem responder (unresponsive)');
  });
  win.webContents.on('responsive', () => {
    logger.error('renderer voltou a responder');
  });
  // Todo console.log/warn/error do renderer (inclusive o [signaling] conexao
  // fechada... de app.js) cai aqui tambem -- sem isto so aparecia no DevTools,
  // que ninguem deixa aberto compartilhando tela.
  win.webContents.on('console-message', (_event, level, message) => {
    const LEVELS = ['log', 'info', 'warn', 'error'];
    logger[level >= 2 ? 'error' : 'log'](`[renderer:${LEVELS[level] || level}] ${message}`);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

/** Abre chrome://gpu numa janela escondida, extrai o "Problems Detected" e
 * o resumo de status, joga no log e fecha. Envolto em try/catch por todo
 * lado: e diagnostico, nao pode atrapalhar nada. */
function logGpuProblems() {
  let w;
  try {
    w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  } catch (err) {
    logger.error('diag GPU: nao abriu janela:', err?.message || err);
    return;
  }
  const fechar = () => { try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* ja fechou */ } };
  const timer = setTimeout(fechar, 15000); // trava de seguranca
  w.webContents.once('did-finish-load', async () => {
    try {
      const texto = await w.webContents.executeJavaScript(
        `(() => {
          const t = (document.body && document.body.innerText) || '';
          const i = t.indexOf('Problems Detected');
          const j = t.indexOf('Graphics Feature Status');
          const ini = j >= 0 && (i < 0 || j < i) ? j : (i >= 0 ? i : 0);
          return t.slice(ini, ini + 2500);
        })()`
      );
      String(texto)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .forEach((l) => logger.log(`[gpu] ${l}`));
    } catch (err) {
      logger.error('diag GPU: leitura de chrome://gpu falhou:', err?.message || err);
    } finally {
      clearTimeout(timer);
      fechar();
    }
  });
  w.webContents.once('did-fail-load', (_e, code, desc) => {
    logger.error(`diag GPU: chrome://gpu nao carregou (${code} ${desc})`);
    clearTimeout(timer);
    fechar();
  });
  w.loadURL('chrome://gpu').catch((err) => {
    logger.error('diag GPU: loadURL falhou:', err?.message || err);
    clearTimeout(timer);
    fechar();
  });
}

app.whenReady().then(() => {
  // Diagnostico de "encoder em software / fps baixo": se video_encode nao
  // vier 'enabled', o Chromium nao tem encoder de hardware nesta maquina
  // (GPU na blocklist, driver velho, ou Optimus rodando na iGPU) e a tela
  // vai SEMPRE cair pro OpenH264. Uma linha, no start.
  try {
    logger.log(`GPU feature status: ${JSON.stringify(app.getGPUFeatureStatus())}`);
  } catch (err) {
    logger.error('getGPUFeatureStatus falhou:', err?.message || err);
  }
  app.getGPUInfo('complete').then(
    (info) => {
      const dev = (info?.gpuDevice || []).find((d) => d.active) || (info?.gpuDevice || [])[0] || {};
      logger.log(
        `GPU ativa: vendorId=${dev.vendorId} deviceId=${dev.deviceId}`
        + ` driver=${dev.driverVersion || info?.auxAttributes?.driverVersion || info?.driverVersion || '?'}`
        + ` gl=${info?.auxAttributes?.glRenderer || '?'}`
      );
    },
    (err) => logger.error('getGPUInfo falhou:', err?.message || err)
  );
  // getGPUFeatureStatus diz O QUE esta desligado, nao POR QUE. O
  // "Problems Detected" do chrome://gpu tem o motivo (blocklist, flag,
  // crash do processo de GPU). Log de 2026-08-29: video_encode
  // "disabled_software" numa RTX 3060 com --ignore-gpu-blocklist e sem
  // crash de processo -- o motivo esta aqui. Best-effort, atrasado pro
  // processo de GPU subir, e nunca derruba o start.
  setTimeout(logGpuProblems, 5000);

  // Intercepta getDisplayMedia. O Electron nao tem seletor nativo, entao
  // devolvemos a fonte que o usuario ja escolheu na nossa UI.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = sources.find((s) => s.id === selectedSourceId);
          // Antes caia pra `sources[0]` quando o id escolhido nao batia mais
          // (janela fechada entre o clique no card e a confirmacao do SO) --
          // sources[0] costuma ser o monitor principal inteiro, entao quem
          // achava que estava mostrando uma janela acabava compartilhando a
          // area de trabalho inteira, sem aviso nenhum. Recusar aqui faz o
          // getDisplayMedia do renderer rejeitar, e o catch de startShare
          // mostra o motivo em vez de compartilhar a fonte errada calado.
          if (!chosen) return callback({});
          // 'loopback' so no modo 'system'; nos modos 'none' e 'device' o
          // getDisplayMedia nao carrega audio (o modo 'device' e adicionado
          // pelo renderer via getUserMedia, fora deste handler).
          callback({ video: chosen, audio: audioMode === 'system' ? 'loopback' : undefined });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false }
  );

  createWindow();
  // Escuta descoberta de salas sempre, mesmo sem hospedar nenhuma -- senao
  // quem so quer entrar em salas dos outros nunca ve a lista da rede (o
  // socket UDP de escuta so era aberto ao criar/anunciar uma sala local).
  ensureDiscoveryStarted();

  updater = setupAutoUpdater((payload) => {
    logger.log(`update: ${payload.status}${payload.message ? ' -- ' + payload.message : ''}`);
    if (win && !win.isDestroyed()) win.webContents.send('update:status', payload);
  });
  updater.checkForUpdates(false); // check no boot, mas sem baixar nada

  // Quem transmite passa a maior parte do tempo com o jogo em fullscreen por
  // cima: sem atalho global nao existe como pausar a transmissao sem
  // alt-tab, que em fullscreen exclusivo custa um engasgo. Falha de registro
  // (outro app ja tomou a combinacao) nao pode derrubar a inicializacao --
  // so vira log, e o botao da UI continua valendo.
  const atalhoOk = globalShortcut.register('Control+Alt+P', () => {
    if (win && !win.isDestroyed()) win.webContents.send('shortcut:toggle-pause');
  });
  if (!atalhoOk) logger.error('atalho global Control+Alt+P nao pode ser registrado');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', async () => {
  // Fecha o servidor embutido ANTES de sair: o close() dele avisa os
  // clientes ('room-closed' + close limpo) pra que voltem pro lobby em vez
  // de ficar presos numa sala fantasma. `await` garante que os frames saiam
  // antes do processo morrer; se travar, o quit abaixo encerra mesmo assim.
  try {
    await closeEmbeddedServer();
  } catch {
    /* best-effort: seguimos com o encerramento */
  }
  discovery.stop();
  discoveryStarted = false;
  for (const capture of activeCaptures.values()) {
    try {
      capture.stop();
    } catch {
      /* ja parada */
    }
  }
  activeCaptures.clear();
  if (process.platform !== 'darwin') app.quit();
});

function advertiseHostedRoom() {
  if (!embeddedServer) {
    discovery.stopAdvertising();
    return;
  }
  const picked = pickAddress();
  const address = picked ? `${picked.address}:${embeddedServer.port}` : null;
  if (!address) {
    discovery.stopAdvertising();
    return;
  }
  discovery.startAdvertising({
    name: hostedRoomName,
    port: embeddedServer.port,
    address,
    getPeerCount: () => embeddedServer.getPeerCount(),
  });
}

// --- IPC ---------------------------------------------------------------

// `types` deixa o renderer pedir so as telas primeiro (rapido, sao poucas)
// e as janelas depois -- a lista de janelas e a parte cara: cada thumbnail
// e capturada e codificada em JPEG uma a uma. O tamanho do thumbnail e o que
// domina esse custo, entao ficamos no minimo que ainda enche o card (190px).
ipcMain.handle('sources:list', async (_event, types) => {
  const wanted = Array.isArray(types) && types.length ? types : ['screen', 'window'];
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: wanted,
    thumbnailSize: { width: 224, height: 126 },
    fetchWindowIcons: false,
  });

  return sources.map((s) => {
    // Casa a fonte de tela com o display pra mostrar a resolucao real.
    const display = displays.find((d) => String(d.id) === String(s.display_id));
    return {
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen:'),
      thumbnail: thumbnailDataUrl(s.thumbnail),
      resolution: display
        ? `${Math.round(display.size.width * display.scaleFactor)}x${Math.round(
            display.size.height * display.scaleFactor
          )}`
        : null,
    };
  });
});

ipcMain.handle('sources:select', (_event, { id, audioMode: mode }) => {
  selectedSourceId = id;
  audioMode = mode === 'system' ? 'system' : 'none';
  return true;
});

ipcMain.handle('room:host', async (_event, { name, advertise } = {}) => {
  try {
    if (embeddedServer) await closeEmbeddedServer();
    embeddedServer = await findFreeServer((port) => createSignalingServer({ port }));

    const firewall = await ensureFirewallRule(embeddedServer.port);
    const picked = pickAddress();
    const address = picked ? `${picked.address}:${embeddedServer.port}` : null;

    hostedRoomName = name || 'anônimo';
    await ensureDiscoveryStarted();
    if (advertise && address) {
      advertiseHostedRoom();
    } else {
      discovery.stopAdvertising();
    }

    return {
      ok: true,
      port: embeddedServer.port,
      address,
      firewall,
      addressWarning: picked ? undefined : 'Radmin/Tailscale não detectado',
    };
  } catch (err) {
    return { ok: false, error: err.code === 'PORTS_EXHAUSTED' ? 'PORTS_EXHAUSTED' : err.message };
  }
});

// Quem hospeda e sai da sala tem que derrubar a sala junto: para o anuncio
// UDP na hora e fecha o servidor embutido. Sem isto o beacon continua saindo
// e a sala fica pendurada em "Ao vivo agora" nas outras maquinas ate o app
// do host fechar. Ordem importa: para o advertise ANTES de fechar o servidor,
// senao o proximo tick do beacon chama getPeerCount() num servidor ja nulo.
ipcMain.handle('room:unhost', async () => {
  discovery.stopAdvertising();
  await closeEmbeddedServer();
  return true;
});

// Nova tentativa de liberar a porta no firewall, disparada pelo botao
// "Permitir acesso à rede" no aviso do palco quando a primeira tentativa
// (durante room:host) foi cancelada ou falhou no UAC. Re-dispara o pedido
// de elevacao pra mesma porta da sala ativa.
ipcMain.handle('firewall:retry', async () => {
  if (!embeddedServer) return { ok: false, error: 'NO_ROOM' };
  return ensureFirewallRule(embeddedServer.port);
});

ipcMain.handle('discovery:setAdvertise', async (_event, enabled) => {
  await ensureDiscoveryStarted();
  if (!enabled || !embeddedServer) {
    discovery.stopAdvertising();
    return true;
  }
  advertiseHostedRoom();
  return true;
});

ipcMain.handle('discovery:refresh', async () => {
  const wasAdvertising = discovery.isAdvertising();
  discovery.stop();
  discoveryStarted = false;
  await ensureDiscoveryStarted();
  if (wasAdvertising) advertiseHostedRoom();
  return true;
});

// Atualizacao: o renderer dirige o fluxo. 'check' e disparado tanto no boot
// (main, manual=false) quanto pelo botao de buscar (manual=true); 'download'
// so pelo botao "Reiniciar e instalar"; 'install' quando o download termina.
ipcMain.handle('update:check', () => {
  updater?.checkForUpdates(true);
  return true;
});
ipcMain.handle('update:download', () => {
  updater?.downloadUpdate();
  return true;
});
ipcMain.handle('update:install', () => {
  updater?.quitAndInstall();
  return true;
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('window:setFullScreen', (_event, enabled) => {
  win?.setFullScreen(!!enabled);
  return true;
});

// Abre a pasta de logs no explorador de arquivos -- pra mandar pra quem for
// investigar um bug depois (ver golive #12).
ipcMain.handle('logs:openFolder', () => {
  shell.openPath(logger.dir);
  return true;
});

// --- Audio por processo (WASAPI Process Loopback) -----------------------
//
// So funciona no Windows 10 2004+ com o addon nativo compilado (ver
// binding.gyp / native/src). Onde nao estiver disponivel, todo handler
// abaixo devolve um "vazio" sensato (0 / indisponivel) em vez de derrubar
// o processo principal -- quem chama trata isso caindo pro loopback de
// sistema normal do Electron.

ipcMain.handle('audio:findDiscordPid', () => {
  if (!audioAddon) return 0;
  try {
    return audioAddon.findDiscordRootPid();
  } catch {
    return 0;
  }
});

ipcMain.handle('audio:getOwnPid', () => {
  if (!audioAddon) return 0;
  return process.pid;
});

// PIDs de todo processo com audio tocando agora no dispositivo de saida
// padrao -- base do modo "lista de inclusao" usado quando a pessoa
// compartilha a tela SEM incluir o Discord (ver startShare em app.js).
ipcMain.handle('audio:listRenderPids', () => {
  if (!audioAddon) return [];
  try {
    return audioAddon.listAudioRenderPids();
  } catch {
    return [];
  }
});

// Lista de processos (pid/ppid/name) pra montar a arvore do Discord e do
// proprio GoLive a partir dos PIDs "raiz" -- usado junto com
// audio:listRenderPids pra saber quais PIDs excluir da lista de inclusao.
ipcMain.handle('audio:listProcessNames', () => {
  if (!audioAddon) return [];
  try {
    return audioAddon.listProcessNames();
  } catch {
    return [];
  }
});

ipcMain.handle('audio:pidForSource', (_event, sourceId) => {
  if (!audioAddon || typeof sourceId !== 'string') return 0;
  // Id de janela do desktopCapturer no Windows tem a forma "window:<hwnd>:0".
  const match = /^window:(-?\d+):/.exec(sourceId);
  if (!match) return 0;
  try {
    return audioAddon.pidForWindowHandle(Number(match[1]));
  } catch {
    return 0;
  }
});

ipcMain.handle('audio:startCapture', (event, { pid, exclude } = {}) => {
  if (!audioAddon || !pid) return Promise.resolve({ ok: false, error: 'indisponivel' });

  return new Promise((resolve) => {
    const captureId = nextCaptureId++;
    const sender = event.sender;
    let settled = false;

    const onData = (samples, channels, sampleRate) => {
      if (sender.isDestroyed()) return;
      sender.send('audio:chunk', captureId, samples, channels, sampleRate);
    };
    const onReady = (ok, message) => {
      if (settled) return;
      settled = true;
      if (ok) {
        resolve({ ok: true, captureId });
      } else {
        activeCaptures.delete(captureId);
        resolve({ ok: false, error: message });
      }
    };

    try {
      const capture = new audioAddon.LoopbackCapture(pid, !!exclude, onData, onReady);
      activeCaptures.set(captureId, capture);
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
});

ipcMain.handle('audio:stopCapture', (_event, captureId) => {
  const capture = activeCaptures.get(captureId);
  if (!capture) return true;
  activeCaptures.delete(captureId);
  try {
    capture.stop();
  } catch {
    /* ja parada */
  }
  return true;
});

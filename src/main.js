/*
 * Processo principal do Electron.
 *
 * Responsabilidades:
 *   1. Ligar as flags do Chromium que liberam encoder de hardware pro WebRTC.
 *   2. Listar as telas/janelas disponiveis pro renderer montar o seletor.
 *   3. Atender o pedido de getDisplayMedia devolvendo a fonte escolhida
 *      junto com o audio do sistema (loopback, so funciona no Windows).
 */

const { app, BrowserWindow, desktopCapturer, session, ipcMain, screen } = require('electron');
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
try {
  audioAddon = require(path.join(__dirname, '..', 'build', 'Release', 'golive_audio.node'));
} catch {
  audioAddon = null;
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Intercepta getDisplayMedia. O Electron nao tem seletor nativo, entao
  // devolvemos a fonte que o usuario ja escolheu na nossa UI.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = sources.find((s) => s.id === selectedSourceId) || sources[0];
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
    if (win && !win.isDestroyed()) win.webContents.send('update:status', payload);
  });
  updater.checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeEmbeddedServer().catch(() => {});
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
// e capturada e codificada em PNG uma a uma. O tamanho do thumbnail e o que
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
      thumbnail: s.thumbnail.toDataURL(),
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

ipcMain.handle('window:setFullScreen', (_event, enabled) => {
  win?.setFullScreen(!!enabled);
  return true;
});

// Instala a atualizacao ja baixada e reinicia. So chamado pelo renderer
// depois de confirmar com o usuario (ex: fora de uma chamada ativa) --
// nao dispara sozinho ao terminar o download.
ipcMain.handle('update:install', () => {
  updater?.quitAndInstall();
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

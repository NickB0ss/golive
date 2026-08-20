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

// Encoder de hardware. Sem isso o Chromium as vezes cai no encoder de
// software e 1080p60 come CPU sem necessidade.
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowH264Send,PlatformHEVCEncoderSupport');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('force_high_performance_gpu');
// Sem isso o Chromium derruba o framerate quando a janela nao esta em foco.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

/** Fonte de captura escolhida no seletor do renderer. */
let selectedSourceId = null;
/** Modo de audio: 'none' | 'system' | 'device'. 'device' e capturado no
 * renderer via getUserMedia, entao aqui so importa distinguir 'system'. */
let audioMode = 'system';

let win = null;

const { createSignalingServer } = require('../server/signaling-core');
const { pickAddress } = require('./main/network');
const { ensureFirewallRule } = require('./main/firewall');
const { findFreeServer } = require('./main/ports');
const { createDiscovery } = require('./main/discovery');

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
    win?.webContents.send('rooms:discovered', rooms);
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeEmbeddedServer().catch(() => {});
  discovery.stop();
  discoveryStarted = false;
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

ipcMain.handle('sources:list', async () => {
  const displays = screen.getAllDisplays();
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
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
  audioMode = mode === 'system' || mode === 'device' ? mode : 'none';
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

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
/** Se o usuario pediu pra incluir o audio do sistema. */
let includeSystemAudio = true;

let win = null;

const { createSignalingServer } = require('../server/signaling-core');
const { pickAddress } = require('./main/network');
const { ensureFirewallRule } = require('./main/firewall');

/** Servidor de sinalizacao embutido, quando este processo esta hospedando. */
let embeddedServer = null;

async function findFreeServer(startPort = 9000, endPort = 9010) {
  for (let port = startPort; port <= endPort; port++) {
    try {
      return await createSignalingServer({ port });
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  const err = new Error('PORTS_EXHAUSTED');
  err.code = 'PORTS_EXHAUSTED';
  throw err;
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
          // 'loopback' captura o som que sai da placa de audio (Windows).
          callback({ video: chosen, audio: includeSystemAudio ? 'loopback' : undefined });
        })
        .catch(() => callback({}));
    },
    // useSystemPicker: false -> usamos o nosso proprio seletor.
    { useSystemPicker: false }
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeEmbeddedServer();
  if (process.platform !== 'darwin') app.quit();
});

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

ipcMain.handle('sources:select', (_event, { id, systemAudio }) => {
  selectedSourceId = id;
  includeSystemAudio = Boolean(systemAudio);
  return true;
});

ipcMain.handle('room:host', async (_event, { name }) => {
  try {
    if (embeddedServer) await closeEmbeddedServer();
    embeddedServer = await findFreeServer();

    const firewall = await ensureFirewallRule(embeddedServer.port);
    const picked = pickAddress();

    return {
      ok: true,
      port: embeddedServer.port,
      address: picked ? `${picked.address}:${embeddedServer.port}` : null,
      firewall,
      addressWarning: picked ? undefined : 'Radmin/Tailscale não detectado',
    };
  } catch (err) {
    return { ok: false, error: err.code === 'PORTS_EXHAUSTED' ? 'PORTS_EXHAUSTED' : err.message };
  }
});

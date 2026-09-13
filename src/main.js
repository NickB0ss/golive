/*
 * Processo principal do Electron.
 *
 * Responsabilidades:
 *   1. Ligar as flags do Chromium que liberam encoder de hardware pro WebRTC.
 *   2. Listar as telas/janelas disponiveis pro renderer montar o seletor.
 *   3. Atender o pedido de getDisplayMedia devolvendo a fonte escolhida
 *      junto com o audio do sistema (loopback, so funciona no Windows).
 */

const { app, BrowserWindow, desktopCapturer, session, ipcMain, screen, shell, globalShortcut, powerMonitor, crashReporter } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { clampBounds, parseStoredBounds } = require('./main/spywin');

// So pode existir UM GoLive rodando por maquina: dois processos tentando abrir
// o mesmo servidor de sinalizacao/porta, escutar a mesma descoberta UDP e
// registrar o mesmo atalho global e receita pra sala fantasma e atalho que so
// funciona num dos dois. `requestSingleInstanceLock` tem que ser a PRIMEIRA
// coisa do arquivo, antes de qualquer commandLine.appendSwitch ou outro side
// effect -- se perder a lock, so falta sair.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

app.setAppUserModelId('com.golive.lan');

// TODAS as features do Chromium tem que sair daqui, numa lista so:
// appendSwitch('enable-features', ...) chamado duas vezes NAO soma -- a
// segunda chamada sobrescreve a primeira, em silencio.
//
// Uma feature que nao existe nesta versao do Chromium tambem e ignorada em
// silencio -- parece que funcionou. Os nomes de WGC abaixo mudaram de nome
// e de granularidade entre versoes; no Chromium 128 (Electron 32.3.3) eles
// foram VERIFICADOS em 2026-09-12: com --enable-logging --v=1 o log mostra
// `DesktopCaptureOptions: ... allow_wgc_screen_capturer: 1,
// allow_wgc_window_capturer: 1`, e a captura de monitor entregou ~32 fps
// numa area de trabalho parada. Na mesma maquina o caminho DXGI nem sobe
// ("Cannot initialize any DxgiOutputDuplicator instance" nos adaptadores
// 1 e 2 -- ha duas RTX 3060 com LUIDs diferentes), entao ali o app depende
// do WGC, que depende da composicao do DWM: jogo em tela cheia exclusiva
// pode deixar a captura sem quadros (track em mute/unmute). Ao subir o
// Electron, reconfirmar. Como confirmar qual capturador esta em uso:
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
let spyWin = null;
let spyBoundsTimer = null;

function spyFallbackBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  return { x: workArea.x + workArea.width - 376, y: workArea.y + workArea.height - 242, width: 360, height: 202 };
}

function spyBoundsPath() {
  return path.join(app.getPath('userData'), 'espiar-janela.json');
}

function loadSpyBounds() {
  const fallback = spyFallbackBounds();
  try {
    const stored = parseStoredBounds(fs.readFileSync(spyBoundsPath(), 'utf8'));
    return clampBounds(stored, screen.getAllDisplays(), fallback);
  } catch {
    return fallback;
  }
}

function saveSpyBounds() {
  if (!spyWin || spyWin.isDestroyed()) return;
  try {
    fs.writeFileSync(spyBoundsPath(), JSON.stringify(spyWin.getBounds()), 'utf8');
  } catch (err) {
    logger.error('espiar: nao salvou geometria:', err?.message || err);
  }
}

function destroySpyWindow() {
  clearTimeout(spyBoundsTimer);
  spyBoundsTimer = null;
  if (spyWin && !spyWin.isDestroyed()) spyWin.destroy();
  spyWin = null;
}

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
/** Janela transparente que desenha os rabiscos da sala na tela REAL de quem
 * esta compartilhando. Nasce so quando a transmissao e de uma TELA inteira
 * com anotacao ligada -- ver createOverlayWindow. */
let overlayWin = null;
/** `Map<sourceId, displayId>` montado a cada `sources:list`. E o unico jeito
 * honesto de saber que monitor cobrir: o `<n>` de `screen:<n>:0` nao e o id
 * de display do Electron (ver src/main/overlay.js). */
let sourceDisplays = new Map();
/** Display da fonte escolhida agora, ou null se for janela. */
let selectedDisplayId = null;
/** Controle do auto-updater, preenchido em whenReady (so em build empacotado). */
let updater = null;
/** Janela de carregamento da abertura (ver src/main/boot.js). Existe so
 * entre app.whenReady e a liberacao do app -- nunca depois. */
let splashWin = null;
/** Maquina de estados da abertura, criada junto da splash. */
let bootController = null;
/** setInterval da checagem periodica em segundo plano (pos-liberacao). */
let periodicUpdateTimer = null;
/** Ultima versao vista em 'available' antes da janela principal existir --
 * repassada pra ela assim que carrega, pra o botao de atualizar do lobby
 * nascer aceso mesmo se o boot liberou por timeout/erro no meio do download
 * (ver releaseApp). Null quando nao ha nenhuma vista, ou quando ja foi
 * baixada (instalar torna a pergunta "tem atualizacao?" sem sentido). */
let sawUpdateAvailable = null;
/** Estado confirmado pelo renderer para impedir instalacao dentro da sala. */
let roomActive = false;

// Segunda tentativa de abrir o app: em vez de deixar o SO iniciar outro
// processo (que ia falhar tentando reusar porta/UDP), o Electron dispara isto
// no processo original. So resta trazer a janela existente pra frente -- a
// principal se ja existir, senao a de carregamento.
app.on('second-instance', () => {
  const target = win && !win.isDestroyed() ? win : (splashWin && !splashWin.isDestroyed() ? splashWin : null);
  if (!target) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
});

const { createSignalingServer } = require('../server/signaling-core');
const { pickAddress } = require('./main/network');
const { ensureFirewallRule } = require('./main/firewall');
const { findFreeServer } = require('./main/ports');
const { createDiscovery } = require('./main/discovery');
const { setupAutoUpdater } = require('./main/updater');
const { createBootUpdater } = require('./main/boot');
const { createUpdatePolicy } = require('./main/update-policy');
/** Politica que impede `downloaded` tardio do boot de instalar apos liberar. */
const updatePolicy = createUpdatePolicy();
const { setupLogger } = require('./main/logger');
const { thumbnailDataUrl } = require('./main/thumbs');
const { mergeSourceDisplays, boundsFor } = require('./main/overlay');

// Criado cedo (antes de whenReady) pra pegar exceptions que acontecam
// durante a inicializacao tambem. app.getPath('userData') ja funciona
// aqui -- so depende do appId, fixado no topo deste arquivo via app info
// implicita do Electron.
const logger = setupLogger();
// O crashpad precisa nascer antes do ready e antes de qualquer renderer; sem
// upload, ele so deixa os .dmp locais para a proxima investigacao.
try {
  crashReporter.start({ uploadToServer: false });
} catch (err) {
  logger.error('crashReporter local nao iniciou:', err?.message || err);
}

// Conta somente nomes e datas: abrir dump aqui pode vazar dados e atrasar boot.
function logCrashDumpsLocais() {
  let quantidade = 0;
  let maisRecente = null;
  const visitar = (diretorio, nivel) => {
    let entradas;
    try {
      entradas = fs.readdirSync(diretorio, { withFileTypes: true });
    } catch (err) {
      logger.error('crash dumps locais: leitura de diretorio falhou, seguindo boot:', err?.message || err);
      return;
    }
    for (const entrada of entradas) {
      const arquivo = path.join(diretorio, entrada.name);
      if (entrada.isDirectory() && nivel < 2) {
        visitar(arquivo, nivel + 1);
      } else if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.dmp')) {
        try {
          const mtime = fs.statSync(arquivo).mtime;
          quantidade += 1;
          if (!maisRecente || mtime > maisRecente) maisRecente = mtime;
        } catch (err) {
          logger.error('crash dumps locais: leitura de arquivo falhou, seguindo boot:', err?.message || err);
        }
      }
    }
  };
  try {
    visitar(app.getPath('crashDumps'), 0);
    logger.log(`crash dumps locais: quantidade=${quantidade} maisRecente=${maisRecente ? maisRecente.toISOString() : '-'}`);
  } catch (err) {
    logger.error('crash dumps locais: caminho falhou, seguindo boot:', err?.message || err);
  }
}

logCrashDumpsLocais();
logger.log(`GoLive iniciando -- versao ${app.getVersion()}, log em ${logger.path}`);
if (audioAddonLoadError) {
  logger.error(
    'addon de audio nativo indisponivel -- "incluir o som do Discord" e a exclusao do audio do proprio GoLive vao ficar fora do ar:',
    audioAddonLoadError.message
  );
}
process.on('uncaughtException', (err) => logger.error('uncaughtException no main:', err?.stack || err));
process.on('unhandledRejection', (err) => logger.error('unhandledRejection no main:', err?.stack || err));

// Encerramento LIMPO deixa marca. E o par que faltava do log sincrono (ver
// o cabecalho de main/logger.js): nos logs de 2026-09-05 duas maquinas
// somem no meio de uma linha de diag e reaparecem num arquivo novo minutos
// depois. Sem uma linha de saida nao da pra distinguir "a pessoa fechou o
// app" de "o app morreu" -- e essa e a primeira pergunta em toda
// investigacao de crash. Com isto a regra de leitura vira uma so:
//
//     log que termina SEM 'encerrando' terminou em crash.
//
// before-quit e will-quit disparam os dois no mesmo encerramento; a
// primeira linha e a que interessa (a que sabe o motivo).
let encerrandoPor = null;
function logEncerramento(motivo) {
  if (encerrandoPor) return;
  encerrandoPor = motivo;
  logger.log(`encerrando: ${motivo}`);
}
app.on('before-quit', () => logEncerramento('before-quit'));

// Processo de GPU caindo repetidamente e o Chromium desligando a
// aceleracao em silencio depois -- exatamente o quadro do log de
// 2026-08-29 (tudo "disabled_software" numa RTX 3060). `render-process-gone`
// nao pega isto: e outro processo filho.
app.on('child-process-gone', (_event, details) => {
  const grave = details.type === 'GPU' || details.reason !== 'clean-exit';
  logger[grave ? 'error' : 'log'](
    `processo filho encerrou: type=${details.type} name=${details.name || details.serviceName || '-'}`
    + ` reason=${details.reason} exitCode=${details.exitCode}`
    + ` salaHospedada=${embeddedServer ? 'sim' : 'nao'}`
  );
});

/** Servidor de sinalizacao embutido, quando este processo esta hospedando. */
let embeddedServer = null;
/** Fechamento em andamento, pra eventos de encerramento concorrentes usarem
 * a mesma promessa e nao fecharem o servidor duas vezes. */
let embeddedServerClosing = null;
/** Nome do host da sala ativa, pra reusar no beacon quando o anuncio e
 * refeito (discovery:refresh) sem o renderer reenviar o nome. */
let hostedRoomName = 'anônimo';
/** PIN da sala ativa (B3), ou null pra sala aberta. Guardado aqui pelo
 * mesmo motivo do nome: o discovery:refresh chama advertiseHostedRoom sem
 * o renderer reenviar nada, e o beacon precisa saber se marca o cadeado.
 * O PIN em si nunca vai pro beacon. */
let hostedRoomPin = null;

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
  discovery.onMigrationBeacon((beacon) => {
    if (win && !win.isDestroyed()) win.webContents.send('room-migrate:discovered', beacon);
  });
  try {
    await discovery.start();
  } catch {
    discoveryStarted = false; // best-effort: sem descoberta o resto do app segue funcionando
  }
}

async function closeEmbeddedServer(opts) {
  if (embeddedServerClosing) return embeddedServerClosing;
  if (!embeddedServer) return;
  // O callback do beacon le embeddedServer a cada tick. Para o timer antes
  // de limpar a referencia para ele nunca observar o servidor fechado.
  discovery.stopAdvertising();
  const server = embeddedServer;
  embeddedServer = null;
  hostedRoomPin = null;
  // Limpa a referencia antes do await: session-end e will-quit podem chegar
  // quase juntos, e os dois precisam compartilhar este mesmo fechamento.
  try {
    embeddedServerClosing = Promise.resolve(server.close(opts));
  } catch (err) {
    embeddedServerClosing = Promise.reject(err);
  }
  embeddedServerClosing = embeddedServerClosing.finally(() => {
    embeddedServerClosing = null;
  });
  return embeddedServerClosing;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // Fica fixo mesmo com o tema "Papel" (claro) salvo: cfg.theme vive no
    // localStorage do renderer, que o processo principal nao enxerga sem
    // duplicar a logica de storage de config.js so pra isso (fora do
    // escopo da Frente C -- ver plano C7). O preco e um flash escuro breve
    // so no boot, ate o CSS do renderer carregar e repintar o body.
    backgroundColor: '#0e1116',
    title: 'GoLive LAN',
    // No pacote Windows o ícone do .exe (build.win.icon) já vira o ícone da
    // janela; isto cobre o `npm start`, que senão mostra o ícone padrão do
    // Electron. O .ico traz os tamanhos pequenos que a barra de tarefas usa.
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.ico'),
    // Windows: sem barra de titulo nativa -- o app desenha a propria faixa
    // de controles (ver spec 2026-09-07). macOS/Linux ficam com a nativa.
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  // Controles de janela proprios (Windows, janela sem moldura). fire-and-forget:
  // nada a devolver. Ver spec 2026-09-07.
  ipcMain.on('window:minimize', () => {
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('window:toggle-maximize', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:close', () => {
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.on('window:show', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  const sendMaxState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('window:maximize-changed', win.isMaximized());
    }
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);
  // F11 nao alterna fullscreen nativo: o app tem o proprio (tile em tela
  // cheia, via win.setFullScreen no renderer).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') event.preventDefault();
  });

  const spyUrl = pathToFileURL(path.join(__dirname, 'renderer', 'espiar.html')).href;
  win.webContents.setWindowOpenHandler((details) => {
    if (details.frameName !== 'golive-espiar' || details.url !== spyUrl) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...loadSpyBounds(),
        frame: false,
        alwaysOnTop: true,
        resizable: true,
        movable: true,
        minimizable: false,
        maximizable: false,
        backgroundColor: '#0e1116',
        webPreferences: {
          preload: path.join(__dirname, 'espiar-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      },
    };
  });
  win.webContents.on('did-create-window', (_event, child, details) => {
    if (details.frameName !== 'golive-espiar') return;
    destroySpyWindow();
    spyWin = child;
    // Mesmo nivel do rabisco: janela comum fica atras de jogo sem borda.
    spyWin.setAlwaysOnTop(true, 'screen-saver');
    spyWin.setMenuBarVisibility(false);
    const scheduleSave = () => {
      clearTimeout(spyBoundsTimer);
      spyBoundsTimer = setTimeout(saveSpyBounds, 400);
    };
    spyWin.on('move', scheduleSave);
    spyWin.on('resize', scheduleSave);
    spyWin.on('closed', () => {
      if (spyWin === child) spyWin = null;
    });
  });
  ipcMain.on('spy:back', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('spy:back');
  });

  // A janela de rabisco e uma BrowserWindow como outra qualquer: viva depois
  // que a principal fecha, ela segura o 'window-all-closed' e o app fica
  // rodando invisivel, sem nada na tela nem na barra de tarefas (ela e
  // skipTaskbar). Ela morre junto com a principal, sempre.
  win.on('closed', () => {
    destroyOverlayWindow();
    destroySpyWindow();
  });
  // No logoff/desligamento do Windows o Electron pode morrer sem before-quit
  // nem will-quit. Fecha ja aqui para o servidor avisar room-closed antes do
  // processo sumir; closeEmbeddedServer e idempotente para a sequencia normal.
  if (process.platform === 'win32') {
    win.on('query-session-end', () => logger.log('query-session-end recebido'));
    win.on('session-end', () => {
      logEncerramento('session-end');
      // O Windows pode matar o processo logo em seguida; migrar e best-effort.
      closeEmbeddedServer({ migrate: true }).catch(() => {
        /* best-effort: o Windows pode encerrar o processo agora */
      });
    });
  }
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

// --- Abertura: tela de carregamento + atualizacao automatica -----------
//
// Ver docs/superpowers/specs/2026-09-12-abertura-com-atualizacao-design.md.
// A janela principal (createWindow, acima) so nasce depois que a maquina de
// estados de src/main/boot.js decide 'release' -- nunca em paralelo com a
// checagem/download/instalacao da abertura.

/** Janela pequena, sem moldura, que aparece ANTES da principal pra checar
 * (e, se houver, baixar/instalar) atualizacao sem perguntar. Mesmo padrao
 * de seguranca da janela principal (contextIsolation, sem nodeIntegration).
 * `backgroundColor` bate com o fundo de splash.css -- sem isso haveria um
 * flash da cor padrao do Electron antes do CSS carregar. */
function createSplashWindow() {
  splashWin = new BrowserWindow({
    width: 300,
    height: 360,
    resizable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: '#0E0F13',
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'splash', 'preload-splash.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWin.setMenuBarVisibility(false);
  splashWin.on('closed', () => { splashWin = null; });
  // show so depois de pronta pra pintar -- sem isso haveria um frame em branco.
  splashWin.once('ready-to-show', () => splashWin?.show());
  return splashWin.loadFile(path.join(__dirname, 'splash', 'splash.html'));
}

/** Manda a fase atual da abertura pra tela de carregamento. Silencioso se
 * ela ja fechou -- so acontece na corrida rara entre 'downloaded' (o
 * processo esta prestes a fechar sozinho) e um evento tardio. */
function sendSplashPhase(phase, extra) {
  if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.send('boot:phase', { phase, ...extra });
}

/** O que o app fazia direto no whenReady antes desta feature: cria a janela
 * principal, liga a descoberta e o atalho global, e so AGORA -- depois que
 * a abertura decidiu que nao ha nada mais pra baixar/instalar antes disso.
 * Chamada uma unica vez por processo (a maquina de estados de boot.js so
 * chega em 'release' uma vez). */
function releaseApp() {
  updatePolicy.markBootReleased();
  if (bootController?.isDownloadAbandoned()) updater?.cancelBootDownload();
  createWindow();
  // A principal precisa existir antes de fechar a splash. Sem essa ordem o
  // window-all-closed pode encerrar o processo durante a transicao.
  if (splashWin && !splashWin.isDestroyed()) splashWin.close();
  splashWin = null;
  ensureDiscoveryStarted().catch((err) => logger.error('descoberta nao iniciou:', err?.message || err));

  // O boot pode ter visto uma versao nova e nao ter conseguido baixar a
  // tempo (timeout de checagem/download travado/erro) -- a informacao nao
  // pode se perder: o botao "Atualizar" do lobby precisa nascer aceso.
  if (sawUpdateAvailable) {
    const info = sawUpdateAvailable;
    win.webContents.once('did-finish-load', () => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('update:status', { status: 'available', manual: false, version: info.version });
      }
    });
  }

  // Quem transmite passa a maior parte do tempo com o jogo em fullscreen por
  // cima: sem atalho global nao existe como pausar a transmissao sem
  // alt-tab, que em fullscreen exclusivo custa um engasgo. Falha de registro
  // (outro app ja tomou a combinacao) nao pode derrubar a inicializacao --
  // so vira log, e o botao da UI continua valendo.
  const atalhoOk = globalShortcut.register('Control+Alt+P', () => {
    if (win && !win.isDestroyed()) win.webContents.send('shortcut:toggle-pause');
  });
  if (!atalhoOk) logger.error('atalho global Control+Alt+P nao pode ser registrado');

  // Checagem periodica em segundo plano (60 min), sem baixar nada -- so pra
  // acender o botao "Atualizar" do lobby se uma versao nova sair enquanto o
  // app esta em uso. Baixar sozinho de novo aqui repetiria o problema que a
  // decisao de 2026-08-26 corrigiu (ver src/main/updater.js).
  periodicUpdateTimer = setInterval(() => updater?.checkForUpdates(false), 60 * 60 * 1000);
}

/** Unico ponto que recebe status do autoUpdater (boot.js OU checagem
 * periodica/manual com a janela ja aberta -- o mesmo `updater` serve os
 * tres caminhos). Loga sempre; repassa pro bootController (que ignora
 * sozinho se ja liberou) e pra janela principal se ela ja existir. */
function dispatchUpdateStatus(payload) {
  logger.log(
    `update: ${payload.status}${payload.reason ? ` [${payload.reason}]` : ''}` +
      `${payload.message ? ' -- ' + payload.message : ''}`
  );
  bootController?.handleStatus(payload);
  const destination = updatePolicy.handleStatus(payload);
  if (destination === 'boot-installing') return;
  if (destination === 'ready') {
    sawUpdateAvailable = { version: payload.version || null };
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:status', { status: 'available', manual: false, version: payload.version || null });
    }
    return;
  }
  if (destination === 'install-manual') {
    if (win && !win.isDestroyed()) win.webContents.send('update:status', { status: 'installing' });
    updater?.quitAndInstall();
    return;
  }
  if (payload?.status === 'available') sawUpdateAvailable = { version: payload.version || null };
  if (win && !win.isDestroyed()) win.webContents.send('update:status', payload);
}

/** Secoes do chrome://gpu que valem log, na ordem em que sao emitidas.
 *
 * "Video Acceleration Information" entrou em 2026-09-05: e a unica que diz
 * COM QUE TETO o encoder de hardware e oferecido. "Graphics Feature Status"
 * so diz "Video Encode: Hardware accelerated", que e verdade e nao ajuda --
 * informa que existe algum encoder, nao o que ele aceita.
 *
 * Numa RTX 3060 ela veio com "Encode h264 ... 32x32 to 1920x1088 pixels,
 * and/or 30.000 fps". CUIDADO com a leitura obvia: isso NAO e a capacidade
 * da placa (o NVENC de uma 3060 faz 1080p60 sem esforco, e o Discord usa
 * exatamente isso na mesma maquina) e, medido em 2026-09-05, TAMBEM nao e
 * o motivo do OpenH264 -- um teste local de loopback com H264 forcado deu o
 * mesmo custo de encode a 1080p30 e a 1080p60 (7,83 e 7,88 ms/quadro). Se o
 * teto de fps fosse o portao, a rodada de 30 teria trocado de caminho.
 *
 * Ou seja: a causa do OpenH264 segue DESCONHECIDA. Estas linhas ficam no log
 * porque sao dado bruto util (e o teto pode ser diferente em outra maquina),
 * nao porque a pergunta esteja respondida. */
const SECOES_GPU = ['Problems Detected', 'Graphics Feature Status', 'Video Acceleration Information'];

/** Quanto de cada secao vai pro log. A pagina inteira passa de 60 KB. */
const GPU_SECAO_MAX_LINHAS = 40;

/** Script injetado no chrome://gpu pra extrair o relatorio.
 *
 * NAO usa innerText, de proposito. innerText exige LAYOUT, e esta janela e
 * `show: false` -- ela so foi diagramada por acaso, porque a janela
 * principal do app estava visivel na hora. Com o app minimizado o innerText
 * volta vazio, a leitura cai no textContent do shadow root, e o <style>
 * minificado da pagina vai junto: o log encheria de CSS.
 *
 * E desce em shadow roots ANINHADOS. O chrome://gpu poe o <info-view> num
 * shadow root e o conteudo de verdade em shadow roots DENTRO dele -- ler so
 * o primeiro nivel devolve 116 caracteres de casca.
 *
 * Sem sequencia de escape nenhuma no corpo (a quebra de linha vem de
 * fromCharCode): este texto atravessa um template literal antes de virar
 * codigo, e cada camada de escape e uma chance de o script morrer com
 * SyntaxError -- que foi exatamente o que travou esta investigacao. */
const GPU_EXTRACTOR = `(() => {
  try {
    const NL = String.fromCharCode(10);
    const BLOCO = /^(DIV|H1|H2|H3|LI|TR|P|SECTION|UL)$/;
    const ler = (no) => {
      let out = '';
      for (const f of no.childNodes) {
        if (f.nodeType === 3) { out += f.nodeValue; continue; }
        if (f.nodeType !== 1) continue;
        const tag = f.tagName;
        if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK') continue;
        if (f.shadowRoot) out += ler(f.shadowRoot);
        out += ler(f);
        if (BLOCO.test(tag)) out += NL;
        else if (tag === 'TD' || tag === 'TH') out += ' | ';
      }
      return out;
    };
    const linhas = ler(document.body).split(NL).map((l) => l.trim()).filter(Boolean);
    return { ok: true, texto: linhas.join(NL) };
  } catch (e) {
    return { ok: false, erro: String((e && e.stack) || e) };
  }
})()`;

/** Abre chrome://gpu numa janela escondida, extrai o "Problems Detected" e
 * o resumo de status, joga no log e fecha. Envolto em try/catch por todo
 * lado: e diagnostico, nao pode atrapalhar nada.
 *
 * NUNCA sai calado. A versao anterior podia: ela filtrava as linhas com
 * `.filter(Boolean)` e, se o texto extraido viesse vazio, o array esvaziava
 * e a funcao terminava sem logar NADA -- nem sucesso, nem erro. Foi o que
 * aconteceu: 24 arquivos de log, 4 maquinas, zero linha `[gpu]`. Justo o
 * diagnostico que existe pra responder "por que a GPU esta desligada"
 * (tudo "disabled_software" numa RTX 3060) era o unico que nao aparecia.
 *
 * A causa provavel do texto vazio esta corrigida junto: o chrome://gpu
 * monta o conteudo dentro de shadow roots, e `document.body.innerText` nao
 * atravessa shadow DOM -- devolve string vazia. Agora a varredura desce
 * pelos shadow roots, e o que nao der certo vira linha de erro COM o
 * tamanho do que foi lido, pra diferenciar "nao carregou" de "carregou
 * vazio" de "carregou e o texto nao tem as secoes". */
function logGpuProblems() {
  // Segunda leitura do feature status, agora com o processo de GPU no ar.
  //
  // A primeira (la em whenReady) sai ~100ms depois do start e devolve o
  // estado INICIAL, pessimista: tudo "disabled_software". Foi essa leitura
  // que abriu a investigacao de "aceleracao desligada" na v0.3.3 e
  // apareceu identica nos 24 logs de 2026-09-05 -- inclusive numa RTX 3060
  // em que o chrome://gpu, 5 segundos depois, reporta "Hardware
  // accelerated" em tudo. As duas linhas ficam no log de proposito: a
  // diferenca entre elas e o dado, e sem as duas ninguem descobre que a
  // primeira nao vale.
  try {
    logger.log(`GPU feature status (apos subir): ${JSON.stringify(app.getGPUFeatureStatus())}`);
  } catch (err) {
    logger.error('diag GPU: getGPUFeatureStatus tardio falhou:', err?.message || err);
  }
  logger.log('diag GPU: consultando chrome://gpu');
  let w;
  try {
    w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  } catch (err) {
    logger.error('diag GPU: nao abriu janela:', err?.message || err);
    return;
  }
  let respondeu = false;
  const fechar = () => { try { if (w && !w.isDestroyed()) w.destroy(); } catch { /* ja fechou */ } };
  // Trava de seguranca: se nem did-finish-load nem did-fail-load dispararem
  // (o silencio total que a gente viu), isto e o que sobra pra registrar.
  const timer = setTimeout(() => {
    if (!respondeu) logger.error('diag GPU: chrome://gpu nao respondeu em 15s (nenhum evento de carga)');
    fechar();
  }, 15000);
  w.webContents.once('did-finish-load', async () => {
    respondeu = true;
    try {
      const lido = await w.webContents.executeJavaScript(GPU_EXTRACTOR);
      if (!lido?.ok) {
        logger.error('diag GPU: o extrator falhou dentro da pagina:', lido?.erro || '(sem erro)');
        return;
      }
      const texto = String(lido.texto || '');
      if (!texto.trim()) {
        logger.error('diag GPU: chrome://gpu carregou mas veio vazio (o processo de GPU pode nao ter subido)');
        return;
      }
      let achouAlguma = false;
      for (const secao of SECOES_GPU) {
        const i = texto.indexOf(secao);
        if (i < 0) continue; // 'Problems Detected' so existe quando HA problemas
        achouAlguma = true;
        texto.slice(i).split('\n').slice(0, GPU_SECAO_MAX_LINHAS).forEach((l) => logger.log(`[gpu] ${l}`));
      }
      if (!achouAlguma) {
        logger.error(`diag GPU: nenhuma secao conhecida na pagina (${texto.length} chars lidos)`);
      }
    } catch (err) {
      logger.error('diag GPU: leitura de chrome://gpu falhou:', err?.message || err);
    } finally {
      clearTimeout(timer);
      fechar();
    }
  });
  w.webContents.once('did-fail-load', (_e, code, desc) => {
    respondeu = true;
    logger.error(`diag GPU: chrome://gpu nao carregou (${code} ${desc})`);
    clearTimeout(timer);
    fechar();
  });
  w.loadURL('chrome://gpu').catch((err) => {
    respondeu = true;
    logger.error('diag GPU: loadURL falhou:', err?.message || err);
    clearTimeout(timer);
    fechar();
  });
}

app.whenReady().then(() => {
  // powerMonitor so pode ser usado depois do ready; registrar uma vez aqui
  // mantem o diagnostico de energia sem arriscar falha no carregamento.
  for (const evento of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'shutdown']) {
    powerMonitor.on(evento, () => logger.log(`powerMonitor: ${evento}`));
  }

  // Leitura PRECOCE do feature status. NAO tire conclusao dela.
  //
  // Aqui estamos ~100ms depois do start e o processo de GPU ainda nao
  // reportou nada, entao isto devolve o estado inicial, que e pessimista
  // por construcao: tudo "disabled_software". Nao quer dizer que a maquina
  // esta sem aceleracao. Medido em 2026-09-05, mesma sessao, mesma RTX
  // 3060: esta linha disse video_encode "disabled_software" e o
  // chrome://gpu, 5s depois, disse "Video Encode: Hardware accelerated".
  //
  // Fica no log so como marco de inicio e pra dar a diferenca contra a
  // leitura tardia (ver logGpuProblems). Quem responde "tem aceleracao?" e
  // a linha `GPU feature status (apos subir)` e as linhas `[gpu]`.
  try {
    logger.log(`GPU feature status (no start, pode estar pessimista): ${JSON.stringify(app.getGPUFeatureStatus())}`);
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

  // updater existe o processo inteiro (boot da abertura, checagem periodica
  // pos-liberacao e o botao manual de buscar todos passam por aqui, ver
  // dispatchUpdateStatus acima).
  updater = setupAutoUpdater(dispatchUpdateStatus);

  // Tela de carregamento primeiro: SO depois que ela decidir 'release' (sem
  // atualizacao, ou timeout/erro, ou o download travou) e que a janela
  // principal, a descoberta e o atalho global sobem -- ver releaseApp.
  // Instalar uma atualizacao encontrada aqui fecha o processo sozinho
  // (quitAndInstall) e releaseApp nunca chega a rodar nesse caminho.
  createSplashWindow()
    .then(() => {
      bootController = createBootUpdater({
        driver: updater,
        onPhase: (phase, extra) => {
          sendSplashPhase(phase, extra);
          if (phase === 'release') releaseApp();
        },
        // Em build empacotado nao ha piso: a tela some assim que o
        // resultado chega. Em dev (npm start) a checagem cai no stub
        // sintetico quase instantaneo -- sem piso a tela nem daria tempo
        // de ser lida, entao ~0.6s so pra nao flashar (nao e comportamento
        // de producao).
        minDisplayMs: app.isPackaged ? 0 : 600,
      });
      bootController.start();
    })
    .catch((err) => {
      // Falha rarissima (a pagina da splash nao carregou). Nunca deixar o
      // app preso atras de uma tela que nao teve como abrir.
      logger.error('splash: nao carregou, liberando o app direto:', err?.message || err);
      releaseApp();
    });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => logger.error('bootstrap (app.whenReady) falhou:', err?.message || err));

app.on('will-quit', () => {
  logEncerramento('will-quit');
  globalShortcut.unregisterAll();
  if (periodicUpdateTimer) clearInterval(periodicUpdateTimer);
  destroyOverlayWindow();
  destroySpyWindow();
  // Ultima linha da sessao: depois disto o logger vira no-op de arquivo (o
  // console segue), entao um handler atrasado nao lanca nem escreve num fd
  // fechado.
  logger.log('sessao encerrada');
  logger.close();
});

app.on('window-all-closed', async () => {
  logEncerramento('window-all-closed');
  // Fecha o servidor embutido ANTES de sair: o close() dele avisa os
  // clientes ('room-closed' + close limpo) pra que voltem pro lobby em vez
  // de ficar presos numa sala fantasma. `await` garante que os frames saiam
  // antes do processo morrer; se travar, o quit abaixo encerra mesmo assim.
  try {
    await closeEmbeddedServer({ migrate: true });
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
    // Defesa para um tick que tenha sido enfileirado enquanto a sala fecha.
    getPeerCount: () => embeddedServer?.getPeerCount?.() || 0,
    protected: Boolean(hostedRoomPin),
    // A versao viaja no beacon so pra lista da rede poder avisar ANTES do
    // clique ("v0.6.0 - atualize") em vez de deixar a pessoa conectar e
    // tomar um join-denied. Quem barra de verdade e o servidor.
    version: app.getVersion(),
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
    // O icone e o que distingue cinco janelas do mesmo navegador uma da
    // outra antes de ler o titulo. Custa um bitmap pequeno por janela, no
    // mesmo lote que ja captura uma miniatura de 224x126 -- e o lote de
    // janelas ja roda em paralelo com o de telas, sem segurar a abertura
    // do dialogo (ver a spec de 2026-08-23, F1.6).
    fetchWindowIcons: true,
  });

  // Guarda o casamento fonte->display enquanto ele esta na mao: e o que a
  // janela de rabisco vai consultar depois pra saber que monitor cobrir. Sai
  // de graca aqui e nao inventa correspondencia nenhuma (ver
  // src/main/overlay.js pra por que parsear o id nao serviria).
  //
  // SOMA, nao substitui: o dialogo chama isto duas vezes em paralelo (telas
  // e janelas), e a chamada de janelas indexa vazio -- atribuindo, ela
  // apagava as telas que a outra tinha acabado de achar.
  sourceDisplays = mergeSourceDisplays(sourceDisplays, sources, displays);

  return sources.map((s) => {
    // Casa a fonte de tela com o display pra mostrar a resolucao real.
    const display = displays.find((d) => String(d.id) === String(s.display_id));
    const height = display ? Math.round(display.size.height * display.scaleFactor) : null;
    return {
      id: s.id,
      name: s.name,
      isScreen: s.id.startsWith('screen:'),
      thumbnail: thumbnailDataUrl(s.thumbnail),
      resolution: display
        ? `${Math.round(display.size.width * display.scaleFactor)}x${height}`
        : null,
      // Altura em pixels do display -- o renderer deriva dela a tag
      // (4K/1440p/1080p/720p) sem reparsear a string de resolucao.
      height,
      // Data URL do icone do app dono da janela, ou null (telas nunca tem;
      // janela sem icone registrado tambem nao).
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    };
  });
});

ipcMain.handle('sources:select', (_event, { id, audioMode: mode }) => {
  selectedSourceId = id;
  selectedDisplayId = sourceDisplays.get(id) || null;
  audioMode = mode === 'system' ? 'system' : 'none';
  return true;
});

ipcMain.handle('room:host', async (_event, {
  name, advertise, protect, roomId, pin: forcedPin, initialTransferredTo, initialBans, initialChatHistory,
} = {}) => {
  try {
    if (embeddedServer || embeddedServerClosing) await closeEmbeddedServer();
    // PIN de 4 digitos gerado com a sala (B3). Nao e cripto -- so corta o
    // entrar-por-acidente. `Math.random` basta: nao ha modelo de ameaca de
    // forca bruta aqui (o servidor derruba o socket a cada tentativa, e a
    // sala vive minutos). 1000-9999 pra sempre ter 4 casas.
    const pin = forcedPin !== undefined ? forcedPin : (protect ? String(1000 + Math.floor(Math.random() * 9000)) : null);
    // Token de dono (novo): gerado por sala, nunca sai desta maquina -- so
    // volta pro renderer que criou a sala, que o reenvia no proprio 'join'.
    const ownerToken = require('crypto').randomUUID();
    // A versao entra na sala junto com o PIN e o token de dono: o servidor
    // barra no 'join' quem nao estiver exatamente nela (ver signaling-core).
    embeddedServer = await findFreeServer((port) => createSignalingServer({
      port,
      pin,
      ownerToken,
      roomId,
      initialTransferredTo,
      initialBans,
      initialChatHistory,
      appVersion: app.getVersion(),
      log: (...a) => logger.log('[servidor]', ...a),
    }));
    hostedRoomPin = pin;

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
      pin,
      ownerToken,
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
  await closeEmbeddedServer({ migrate: true });
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

ipcMain.handle('room:migrate-beacon:start', async (_event, { roomId, address, port, protect } = {}) => {
  discovery.startAdvertisingMigration({ roomId, address, port, protected: Boolean(protect) });
  return true;
});

ipcMain.handle('room:migrate-beacon:stop', async () => {
  discovery.stopAdvertisingMigration();
  return true;
});

// Endereco desta maquina na rede virtual, pro lobby responder "qual endereco
// eu passo pros meus amigos?" ANTES de criar a sala -- ate agora essa
// resposta so existia depois. Mesmo pickAddress que o room:host usa, entao
// o que o lobby mostra e o que a sala vai anunciar.
ipcMain.handle('network:address', () => {
  const picked = pickAddress();
  return picked ? { address: picked.address, kind: picked.kind, iface: picked.iface } : null;
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
  // So este IPC, disparado pelo clique explicito em "Atualizar", inicia o
  // fluxo manual. Se o boot abandonado terminou tarde, o pacote ja esta
  // pronto e o mesmo clique instala sem baixar de novo.
  const action = updatePolicy.requestManualUpdate(updater?.hasDownloadedUpdate());
  if (action === 'install-manual') updater?.quitAndInstall();
  else if (action === 'download-manual') updater?.downloadUpdate('manual');
  return true;
});

ipcMain.on('room:active', (event, active) => {
  // So a janela principal pode informar este estado, e o valor precisa ser
  // booleano de verdade para nao aceitar coercao de IPC malformado.
  if (event.sender !== win?.webContents || typeof active !== 'boolean') return;
  roomActive = active;
  updatePolicy.setRoomActive(roomActive);
});

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('window:setFullScreen', (_event, enabled) => {
  win?.setFullScreen(!!enabled);
  return true;
});

// --- Rabisco na tela real (overlay) ------------------------------------
//
// Uma janela transparente esticada sobre o monitor compartilhado, desenhando
// o que a sala rabisca. Tres propriedades a fazem funcionar, e nenhuma e
// opcional:
//
//   click-through  `setIgnoreMouseEvents(true)` -- sem isso a janela come
//                  TODO clique da tela de quem esta compartilhando. E o
//                  requisito mais duro: um overlay que rouba o mouse
//                  transforma a tela da pessoa num quadro morto.
//   sempre por cima `setAlwaysOnTop(true, 'screen-saver')` -- o nivel comum
//                  fica abaixo de jogo em fullscreen sem borda, que e
//                  metade do uso deste app.
//   fora da captura `setContentProtection(true)` -- sem isso o overlay entra
//                  na propria captura e quem assiste ve cada traco DUAS
//                  vezes: o local, no canvas do tile, e o de volta, queimado
//                  no video. No Windows 10 2004+ isso vira
//                  WDA_EXCLUDEFROMCAPTURE, que some com a janela pro
//                  capturador sem pintar nada por cima dela.

function createOverlayWindow(bounds) {
  destroyOverlayWindow();
  overlayWin = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    // focusable: false mantem o foco no jogo/documento por baixo -- a janela
    // nunca deve roubar o Alt+Tab de quem esta compartilhando.
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // A pagina e estatica e sem interacao; deixar o Chromium hibernar o
      // renderer dela pararia o requestAnimationFrame que desenha o traco.
      backgroundThrottling: false,
    },
  });

  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setContentProtection(true);
  overlayWin.setMenuBarVisibility(false);
  overlayWin.on('closed', () => { overlayWin = null; });
  // showInactive, nao show: aparecer nao pode tirar o foco do que a pessoa
  // esta fazendo.
  overlayWin.once('ready-to-show', () => overlayWin?.showInactive());
  // A promessa so resolve depois que a pagina carregou. Sem isso, o primeiro
  // `overlay:load` que o renderer mandar logo apos o start cairia num
  // webContents que ainda nao rodou o script -- `send` nao enfileira, e a
  // lousa que ja existia sumiria da tela real.
  return overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
}

function destroyOverlayWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}

/** Manda um evento pra janela de rabisco, se ela existir e ja tiver carregado.
 * Silencioso de proposito: op de anotacao chega ~60x por segundo por pessoa
 * desenhando, e nenhuma delas vale um erro no log se a janela acabou de
 * fechar. */
function sendToOverlay(channel, payload) {
  if (!overlayWin || overlayWin.isDestroyed()) return false;
  overlayWin.webContents.send(channel, payload);
  return true;
}

/** Abre o overlay pro que esta sendo compartilhado agora. Devolve por que
 * NAO abriu quando nao abriu -- o renderer usa isso pra avisar em vez de
 * deixar a pessoa achando que os amigos estao rabiscando no vazio.
 *   'window'  -> a fonte e uma janela, nao uma tela
 *   'display' -> o monitor sumiu entre a escolha e o ao vivo */
ipcMain.handle('overlay:start', async () => {
  if (!selectedDisplayId) return { ok: false, reason: 'window' };
  const bounds = boundsFor(selectedDisplayId, screen.getAllDisplays());
  if (!bounds) return { ok: false, reason: 'display' };
  try {
    await createOverlayWindow(bounds);
  } catch (err) {
    logger.error('overlay: a janela de rabisco nao carregou:', err?.message || err);
    destroyOverlayWindow();
    return { ok: false, reason: 'display' };
  }
  return { ok: true };
});

ipcMain.handle('overlay:stop', () => {
  destroyOverlayWindow();
  return true;
});

ipcMain.handle('overlay:op', (_event, payload) => sendToOverlay('overlay:op', payload));
ipcMain.handle('overlay:load', (_event, payload) => sendToOverlay('overlay:load', payload));
ipcMain.handle('overlay:fx', (_event, payload) => sendToOverlay('overlay:fx', payload));

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

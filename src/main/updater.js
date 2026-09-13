/*
 * Atualizacao via GitHub Releases (electron-updater).
 *
 * `autoDownload = false` e `autoInstallOnAppQuit = false`: o electron-updater
 * nunca decide sozinho quando baixar ou instalar -- quem decide e o chamador
 * (main.js), chamando `downloadUpdate()`/`quitAndInstall()` explicitamente.
 * Isso nao mudou desde 2026-08-26 e continua testado abaixo.
 *
 * O QUANDO mudou (ver docs/superpowers/specs/2026-09-12-abertura-com-
 * atualizacao-design.md, decisao 2): antes, so o clique num botao com o app
 * ja aberto disparava `downloadUpdate`/`quitAndInstall`. Agora existe um
 * segundo caminho, automatico: a tela de carregamento da abertura
 * (`src/main/boot.js`) baixa e instala sozinha, sem perguntar, ANTES de
 * existir janela principal -- exatamente o pedido do usuario. A decisao
 * antiga de "nada instala sem o usuario mandar" reagia a um fluxo que
 * baixava escondido com o app em uso e instalava ao fechar sem aviso nenhum;
 * o fluxo novo instala igual sem perguntar, mas numa tela dedicada, visivel,
 * antes de qualquer sessao existir -- o problema que motivou a reversao
 * (cirurgia silenciosa no meio do uso) nao se repete.
 *
 * `quitAndInstall(true, true)`: silencioso (o NSIS oneClick, ver
 * package.json, ja seria silencioso de qualquer jeito) E forca reabrir
 * depois -- sem o segundo `true` um "atualiza sozinho" que nao reabre
 * pareceria o app tendo crashado.
 *
 * So faz sentido em build empacotado (app.isPackaged). Em dev nao ha
 * instalador nenhum -- ai `deps.autoUpdater` ausente cai num stub que so
 * emite um 'not-available' sintetico pro botao de buscar dar algum retorno.
 */

'use strict';

// `require('electron')` fora do runtime do Electron devolve uma string (o
// caminho do binario), entao `.app` fica undefined -- o try/catch cobre
// tanto isso quanto um require que falhe de vez (ambiente de teste).
function isPackagedApp() {
  try {
    return require('electron').app.isPackaged === true;
  } catch {
    return false;
  }
}

/*
 * Por que a busca por atualizacao falhou, como um CODIGO estavel. Quem
 * traduz pra portugues e o renderer (`app.js`), que ja e o dono de toda a
 * copia da interface -- aqui em `src/main/` nao entra texto de tela.
 * `null` quando o erro nao e um dos conhecidos: ai o renderer cai no texto
 * generico em vez de despejar stack trace na cara de quem usa.
 *
 * Os codigos de update vem do proprio electron-updater (`newError(msg,
 * code)` no GitHubProvider); os de rede vem do sistema, no `err.code` do
 * socket; o limite de pedidos chega como `statusCode` do HttpError.
 *
 * O caso que motivou isto: a v0.10.0 subiu no GitHub so com o `.exe`, sem
 * `latest.yml`. O provider da 404 no arquivo de canal e joga
 * ERR_UPDATER_CHANNEL_FILE_NOT_FOUND -- mas o toast dizia apenas "nao
 * consegui verificar a atualizacao", entao release quebrado e internet
 * caida ficavam iguais aos olhos de quem reportava o problema.
 */
const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
]);

function updateErrorReason(err) {
  if (!err) return null;

  if (NETWORK_CODES.has(err.code)) return 'sem-rede';
  if (err.statusCode === 403 || err.statusCode === 429) return 'limite';

  switch (err.code) {
    case 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND':
      return 'release-incompleto';
    case 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND':
    case 'ERR_UPDATER_NO_PUBLISHED_VERSIONS':
      return 'sem-release';
    case 'ERR_UPDATER_INVALID_RELEASE_FEED':
      return 'feed-quebrado';
    default:
      return null;
  }
}

/**
 * Liga o checador de updates e devolve { checkForUpdates, downloadUpdate,
 * quitAndInstall } pro main repassar aos IPCs.
 *
 * `onStatus` recebe { status, manual, ... }, status em:
 *   'checking' | 'available' | 'not-available' | 'downloading' |
 *   'downloaded' | 'error'
 * `manual` diz se o ciclo atual foi disparado pelo botao de buscar (true)
 * ou pelo check automatico do boot (false) -- o renderer usa isso pra so
 * mostrar o toast de "voce ja esta na versao mais recente" em busca manual.
 * Extras por status: 'available'/'downloaded' trazem `version`;
 * 'downloading' traz `progress` (0-100); 'error' traz `message`.
 *
 * `deps.autoUpdater` e injetavel pra teste; sem ele, usa o autoUpdater real
 * do electron-updater (import tardio -- ele loga bastante no require).
 */
function setupAutoUpdater(onStatus, deps = {}) {
  const injected = deps.autoUpdater || null;

  // Sem instalador (dev) e sem mock: stub que so da retorno pro botao.
  if (!injected && !isPackagedApp()) {
    return {
      checkForUpdates: (manual) => onStatus({ status: 'not-available', manual: !!manual }),
      downloadUpdate: () => {},
      cancelBootDownload: () => {},
      hasDownloadedUpdate: () => false,
      quitAndInstall: () => {},
    };
  }

  const electronUpdater = injected ? null : require('electron-updater');
  const autoUpdater = injected || electronUpdater.autoUpdater;
  const CancellationToken = deps.CancellationToken || electronUpdater?.CancellationToken || null;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Cada download tem uma origem propria. Isso impede uma checagem tardia de
  // reclassificar evento de download e instalar algo que o boot abandonou.
  let lastCheckManual = false;
  let downloadSource = null;
  let downloadedSource = null;
  let bootCancellationToken = null;
  let cancelledDownloadSource = null;
  const emit = (payload) => onStatus({ manual: lastCheckManual, ...payload });

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info?.version }));
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }));
  autoUpdater.on('download-progress', (p) => emit({
    status: 'downloading',
    progress: Math.round(p?.percent || 0),
    ...(downloadSource ? { downloadSource } : {}),
  }));
  autoUpdater.on('update-downloaded', (info) => {
    downloadedSource = downloadSource || cancelledDownloadSource;
    downloadSource = null;
    cancelledDownloadSource = null;
    bootCancellationToken = null;
    emit({
      status: 'downloaded',
      version: info?.version,
      ...(downloadedSource ? { downloadSource: downloadedSource } : {}),
    });
  });
  autoUpdater.on('update-cancelled', () => {
    const source = downloadSource;
    cancelledDownloadSource = source;
    downloadSource = null;
    bootCancellationToken = null;
    emit({ status: 'cancelled', ...(source ? { downloadSource: source } : {}) });
  });
  autoUpdater.on('error', (err) => {
    const reason = updateErrorReason(err);
    const source = downloadSource;
    downloadSource = null;
    bootCancellationToken = null;
    emit({
      status: 'error',
      message: err?.message || String(err),
      ...(reason ? { reason } : {}),
      ...(source ? { downloadSource: source } : {}),
    });
  });

  return {
    checkForUpdates: (manual) => {
      if (downloadSource) {
        onStatus({ status: 'busy', manual: !!manual, reason: 'baixando' });
        return;
      }
      if (downloadedSource) {
        onStatus({ status: 'busy', manual: !!manual, reason: 'atualizacao-ja-baixada' });
        return;
      }
      lastCheckManual = !!manual;
      Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
    },
    downloadUpdate: (source = 'manual') => {
      if (downloadSource || downloadedSource) return;
      cancelledDownloadSource = null;
      downloadSource = source;
      bootCancellationToken = source === 'boot' && CancellationToken ? new CancellationToken() : null;
      Promise.resolve(autoUpdater.downloadUpdate(bootCancellationToken || undefined)).catch(() => {});
    },
    cancelBootDownload: () => {
      if (downloadSource !== 'boot' || !bootCancellationToken) return;
      bootCancellationToken.cancel();
    },
    hasDownloadedUpdate: () => !!downloadedSource,
    // (true, true): silencioso + forca reabrir -- ver comentario do topo
    // do arquivo.
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
  };
}

module.exports = { setupAutoUpdater, updateErrorReason };

/*
 * Atualizacao via GitHub Releases (electron-updater).
 *
 * O fluxo e explicito, nao passivo: o app checa por atualizacao ao abrir
 * (e quando o usuario aperta o botao de buscar), mas NAO baixa nada sozinho
 * -- `autoDownload = false`. Quem dispara o download e o botao "Reiniciar e
 * instalar" no renderer; quando o download termina, o renderer chama
 * `quitAndInstall()`, que fecha o app, roda o instalador NSIS em silencio
 * (nsis.oneClick, ver package.json) e reabre na versao nova.
 *
 * `autoInstallOnAppQuit = false`: nada e instalado sem o usuario mandar.
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
      quitAndInstall: () => {},
    };
  }

  const autoUpdater = injected || require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // Guarda se o ciclo em andamento partiu do botao de buscar. Todo evento
  // repassado carrega esse flag ate o proximo checkForUpdates trocar.
  let lastCheckManual = false;
  const emit = (payload) => onStatus({ manual: lastCheckManual, ...payload });

  autoUpdater.on('checking-for-update', () => emit({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => emit({ status: 'available', version: info?.version }));
  autoUpdater.on('update-not-available', () => emit({ status: 'not-available' }));
  autoUpdater.on('download-progress', (p) =>
    emit({ status: 'downloading', progress: Math.round(p?.percent || 0) })
  );
  autoUpdater.on('update-downloaded', (info) => emit({ status: 'downloaded', version: info?.version }));
  autoUpdater.on('error', (err) => {
    const reason = updateErrorReason(err);
    emit({ status: 'error', message: err?.message || String(err), ...(reason ? { reason } : {}) });
  });

  return {
    checkForUpdates: (manual) => {
      lastCheckManual = !!manual;
      Promise.resolve(autoUpdater.checkForUpdates()).catch(() => {});
    },
    downloadUpdate: () => {
      Promise.resolve(autoUpdater.downloadUpdate()).catch(() => {});
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}

module.exports = { setupAutoUpdater, updateErrorReason };

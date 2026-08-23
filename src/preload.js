/*
 * Ponte entre o processo principal e a pagina. Mantem contextIsolation
 * ligado: o renderer so enxerga as tres funcoes abaixo, nada de Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('golive', {
  /** Lista telas e janelas capturaveis, com thumbnail em data URL. Aceita
   * um filtro de tipos (['screen'] | ['window']) pra buscar em duas etapas
   * e nao segurar o dialogo esperando o lote todo. */
  listSources: (types) => ipcRenderer.invoke('sources:list', types),

  /** Define qual fonte o getDisplayMedia vai devolver e o modo de audio
   * ('none' | 'system' | 'device'). */
  selectSource: (id, audioMode) =>
    ipcRenderer.invoke('sources:select', { id, audioMode }),

  /** Sobe o servidor de sinalizacao embutido e devolve o endereco pronto.
   * Aceita { name, advertise }: advertise liga o anuncio via broadcast UDP
   * assim que a sala sobe. */
  hostRoom: (payload) => ipcRenderer.invoke('room:host', payload),

  /** Liga/desliga o anuncio da sala ativa via broadcast UDP em tempo real
   * (ex: usuario mexeu no toggle de Configuracoes > Rede depois de ja ter
   * criado a sala). Sem efeito se nao houver sala local hospedada. */
  setAdvertise: (enabled) => ipcRenderer.invoke('discovery:setAdvertise', enabled),

  /** Força um novo ciclo de descoberta: fecha e reabre o socket UDP,
   * limpando salas conhecidas, e reanuncia a sala hospedada se havia uma
   * sendo anunciada. */
  refreshDiscovery: () => ipcRenderer.invoke('discovery:refresh'),

  /** Assina a lista de salas descobertas na rede via broadcast UDP. Chamado
   * sempre que a lista muda (nova sala anunciada, sala expirou). */
  onRoomsDiscovered: (callback) =>
    ipcRenderer.on('rooms:discovered', (_event, rooms) => callback(rooms)),

  /** Liga/desliga o fullscreen real da janela do app (nao so o tile dentro
   * dela). */
  setFullScreen: (enabled) => ipcRenderer.invoke('window:setFullScreen', enabled),

  /** Avisa quando o fullscreen da janela muda por qualquer via -- inclusive
   * Esc ou controles nativos do SO, que nao passam pelo nosso botao. */
  onFullScreenChange: (callback) =>
    ipcRenderer.on('window:fullscreen-changed', (_event, enabled) => callback(enabled)),

  /** Avisa quando a janela e minimizada/restaurada (ou escondida/mostrada).
   * O renderer usa isso pra parar de pintar o que ninguem esta vendo --
   * sem tocar na captura nem no encode, que rodam no processo de GPU. */
  onWindowVisibilityChange: (callback) =>
    ipcRenderer.on('window:visibility-changed', (_event, visible) => callback(visible)),

  /** PID "raiz" do Discord rodando agora, ou 0 se nao estiver rodando ou o
   * addon nativo nao estiver disponivel (so existe no Windows). */
  findDiscordPid: () => ipcRenderer.invoke('audio:findDiscordPid'),

  /** PID dono da janela de um id de fonte do listSources (so faz sentido
   * pra fontes "window:..."; devolve 0 pra fontes de tela inteira). */
  pidForSource: (sourceId) => ipcRenderer.invoke('audio:pidForSource', sourceId),

  /** PID do proprio GoLive (processo principal), ou 0 se o addon nativo nao
   * estiver disponivel. Usado pra excluir o audio que o proprio GoLive
   * reproduz (voz/tela dos outros participantes) da captura de sistema --
   * sem isso, esse audio reproduzido entra na captura e volta pros outros,
   * criando um eco/loop quando duas pessoas compartilham tela e se ouvem. */
  getOwnPid: () => ipcRenderer.invoke('audio:getOwnPid'),

  /** PIDs de todo processo com audio tocando agora no dispositivo de saida
   * padrao. Devolve [] se o addon nativo nao estiver disponivel. Base do
   * modo "lista de inclusao" usado ao compartilhar a tela SEM incluir o
   * Discord (ver startShare em app.js). */
  listAudioRenderPids: () => ipcRenderer.invoke('audio:listRenderPids'),

  /** Snapshot de processos rodando agora: [{ pid, ppid, name }]. Devolve []
   * se o addon nativo nao estiver disponivel. Usado junto com
   * listAudioRenderPids pra montar a arvore do Discord/GoLive e filtrar a
   * lista de inclusao. */
  listProcessNames: () => ipcRenderer.invoke('audio:listProcessNames'),

  /** Inicia uma captura de audio nativa (WASAPI Process Loopback) por
   * processo. `exclude: true` = sistema inteiro MENOS esse processo (e
   * filhos); `exclude: false` = SO esse processo. Devolve
   * { ok, captureId } ou { ok: false, error }. Os chunks de audio chegam
   * via onAudioChunk ate stopProcessAudioCapture ser chamado. */
  startProcessAudioCapture: (pid, exclude) => ipcRenderer.invoke('audio:startCapture', { pid, exclude }),

  /** Para uma captura iniciada com startProcessAudioCapture. */
  stopProcessAudioCapture: (captureId) => ipcRenderer.invoke('audio:stopCapture', captureId),

  /** PCM float32 entrelacado de uma captura ativa:
   * (captureId, samples: Float32Array, channels: number, sampleRate: number) => void. */
  onAudioChunk: (callback) =>
    ipcRenderer.on('audio:chunk', (_event, captureId, samples, channels, sampleRate) =>
      callback(captureId, samples, channels, sampleRate)
    ),

  /** Status do auto-updater: { status, info?, progress?, message? }, status
   * em 'checking' | 'available' | 'not-available' | 'downloading' |
   * 'downloaded' | 'error'. So dispara em build empacotado. */
  onUpdateStatus: (callback) =>
    ipcRenderer.on('update:status', (_event, payload) => callback(payload)),

  /** Instala a atualizacao ja baixada e reinicia o app. So chamar depois de
   * 'downloaded' e com a confirmacao do usuario. */
  installUpdate: () => ipcRenderer.invoke('update:install'),
});

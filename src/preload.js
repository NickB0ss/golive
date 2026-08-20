/*
 * Ponte entre o processo principal e a pagina. Mantem contextIsolation
 * ligado: o renderer so enxerga as tres funcoes abaixo, nada de Node.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('golive', {
  /** Lista telas e janelas capturaveis, com thumbnail em data URL. */
  listSources: () => ipcRenderer.invoke('sources:list'),

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
});

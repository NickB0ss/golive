'use strict';

/*
 * Decisao de autorizar (ou nao) um getDisplayMedia na bancada. Puro: o main
 * injeta as funcoes que tocam o Electron.
 *
 * Regras (modo owned-window):
 *   - so video; audio recusado (nada de loopback, nada de microfone);
 *   - so a pagina da bancada (frame confiavel), e so depois de armada UMA vez;
 *   - a fonte entregue e EXATAMENTE a janela criada pela bancada
 *     (getMediaSourceId); nunca sources[0], nunca tela inteira;
 *   - tudo e conferido de novo depois do await de desktopCapturer, porque a
 *     janela pode ter fechado ou a armacao ter sido consumida nesse intervalo;
 *   - qualquer duvida => null (o chamador responde com recusa).
 */

/**
 * @param {object} p
 * @param {object} p.request                    pedido do Electron (videoRequested, audioRequested, frame)
 * @param {() => boolean} p.isArmed             a bancada pediu uma captura e ela ainda nao foi usada
 * @param {(frame: object) => boolean} p.isTrustedFrame  o frame e o principal da pagina da bancada
 * @param {() => (string|null)} p.ownedSourceId id da fonte da janela propria (ou null se fechada)
 * @param {() => Promise<Array<{id: string}>>} p.listSources  desktopCapturer.getSources({types:['window']})
 * @param {() => void} p.consume                gasta a armacao
 * @returns {Promise<{video: object}|null>}
 */
async function authorizeOwnedWindow(p) {
  const { request } = p;
  if (!request || request.videoRequested !== true || request.audioRequested === true) return null;
  if (!p.isArmed() || !p.isTrustedFrame(request.frame)) return null;

  const sources = await p.listSources();

  if (!p.isArmed() || !p.isTrustedFrame(request.frame)) return null;
  const id = p.ownedSourceId();
  if (!id) return null;
  const source = (sources || []).find((s) => s && s.id === id);
  if (!source) return null;
  p.consume();
  return { video: source };
}

/**
 * Pedido de permissao da sessao (setPermissionRequestHandler). O Chromium pede
 * permissao ANTES de chamar o handler de getDisplayMedia: recusada aqui, a
 * captura falha com "Permission denied" sem passar pela guarda acima. No
 * Electron 44 o pedido chega como 'media' com mediaTypes VAZIO (medido em
 * 08/10/2026); 'display-capture' fica aceito para versoes que o usem.
 * getUserMedia de camera/microfone traz 'video'/'audio' em mediaTypes e segue
 * recusado. So armada e so da pagina da bancada; a fonte exata continua
 * decidida por authorizeOwnedWindow. Todo o resto: recusa.
 */
function allowPermission({ permission, mediaTypes, armed, fromBench }) {
  if (armed !== true || fromBench !== true) return false;
  if (permission === 'display-capture') return true;
  return permission === 'media' && Array.isArray(mediaTypes) && mediaTypes.length === 0;
}

module.exports = { authorizeOwnedWindow, allowPermission };

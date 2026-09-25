'use strict';

/**
 * Links que os players da Mesa (YouTube, Twitch) tentam abrir em janela nova
 * -- clique no logo ou no titulo do video. O `setWindowOpenHandler` da
 * janela principal recusa tudo que nao e a Espiar; estes vao para o
 * navegador padrao (`shell.openExternal`), e so estes:
 *
 * - destino https em www.youtube.com, youtu.be ou www.twitch.tv, sem
 *   usuario/senha nem porta;
 * - pedido feito DE DENTRO do iframe de um desses players (o `referrer` da
 *   janela nova e a origem do iframe: https://www.youtube-nocookie.com/ ou
 *   https://player.twitch.tv/). Um link igual vindo da pagina do app (chat,
 *   por exemplo) continua recusado aqui: o app tem o proprio caminho para isso.
 *
 * Devolve a URL normalizada para abrir, ou `null` (recusar).
 */
const DESTINOS = new Set(['www.youtube.com', 'youtu.be', 'www.twitch.tv']);
const ORIGENS_DOS_PLAYERS = new Set(['https://www.youtube-nocookie.com', 'https://player.twitch.tv']);
const MAX_URL = 2048;

function origemDoReferrer(details) {
  const ref = details && details.referrer && typeof details.referrer.url === 'string' ? details.referrer.url : '';
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

function linkParaNavegador(details) {
  if (!details || typeof details.url !== 'string' || details.url.length > MAX_URL) return null;
  if (!ORIGENS_DOS_PLAYERS.has(origemDoReferrer(details))) return null;
  let u;
  try {
    u = new URL(details.url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!DESTINOS.has(u.hostname)) return null;
  return u.href;
}

module.exports = { linkParaNavegador, DESTINOS, ORIGENS_DOS_PLAYERS };

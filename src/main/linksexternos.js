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

/*
 * Links que a PAGINA do app pede para abrir, pelas janelas da Mesa (IPC
 * 'mesa:abrir-link', so do quadro principal da janela do app). Sempre um
 * clique da propria pessoa; o conteudo da janela confere antes e confirma o
 * dominio com ela. Aqui e a ultima palavra:
 *
 * - 'jam' (janela Spotify Jam): so os links de Jam do Spotify --
 *   https://spotify.link/<codigo> ou
 *   https://open.spotify.com/socialsession/<id> (o mesmo formato estrito de
 *   mesa-modules/jam.js), abertos na forma canonica, sem query;
 * - 'link' (janela Link): qualquer site https, sem usuario/senha, sem
 *   porta, com nome de dominio (nada de IP, localhost ou nome sem ponto).
 *
 * Devolve a URL para abrir ou `null`.
 */
const DESTINOS_JAM = new Set(['spotify.link', 'open.spotify.com']);
const CODIGO_JAM = /^\/([A-Za-z0-9]{5,32})\/?$/;
const SESSAO_JAM = /^\/(?:intl-[a-z]{2}(?:-[A-Za-z]{2})?\/)?socialsession\/([A-Za-z0-9-]{8,64})\/?$/;
const ROTULO = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function urlHttpsLimpa(url) {
  if (typeof url !== 'string' || url.length > MAX_URL || !/^https:\/\//i.test(url) || /[\s\p{Cc}\\]/u.test(url)) return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return u;
}

/** Nome de dominio de verdade: rotulos DNS, pelo menos um ponto, e o ultimo
 * com letra (fora IPv4, IPv6 entre colchetes, localhost e nomes da rede). */
function dominioPublico(host) {
  if (!host || host.length > 253 || host.endsWith('.')) return false;
  const partes = host.split('.');
  if (partes.length < 2 || !partes.every((p) => ROTULO.test(p))) return false;
  const tld = partes[partes.length - 1];
  if (!/[a-z]/.test(tld)) return false;
  return !['localhost', 'local', 'internal', 'lan', 'home', 'arpa'].includes(tld);
}

function linkDaMesa(tipo, url) {
  const u = urlHttpsLimpa(url);
  if (!u) return null;
  if (tipo === 'jam') {
    if (!DESTINOS_JAM.has(u.hostname)) return null;
    const m = u.hostname === 'spotify.link' ? CODIGO_JAM.exec(u.pathname) : SESSAO_JAM.exec(u.pathname);
    if (!m) return null;
    return u.hostname === 'spotify.link' ? `https://spotify.link/${m[1]}` : `https://open.spotify.com/socialsession/${m[1]}`;
  }
  if (tipo === 'link') return dominioPublico(u.hostname) ? u.href : null;
  return null;
}

module.exports = { linkParaNavegador, linkDaMesa, dominioPublico, DESTINOS, DESTINOS_JAM, ORIGENS_DOS_PLAYERS };

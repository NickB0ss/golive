'use strict';

/*
 * Apoio das janelas de midia da Mesa (youtube, radio, aovivo) -- PURO.
 *
 * Nao e tipo de janela (fica em HELPER_NAMES do registro): e o que os tres
 * modulos dividem. Le links do YouTube e da Twitch sem rede nenhuma (so
 * `URL`) e calcula a posicao de um video no relogio da sala.
 *
 * No renderer entra por <script> antes dos modulos; no Node os modulos o
 * carregam com `module.require('./midialinks')`.
 */

(function (root) {
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const CHANNEL_RE = /^[A-Za-z0-9_]{3,25}$/;
  const MAX_LINK = 2048;
  // Posicao maxima aceita (segundos). Transmissao gravada do YouTube passa
  // de 12 h; mais que uma semana e lixo.
  const MAX_POS = 7 * 24 * 3600;

  const YT_HOSTS = new Set([
    'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'youtube-nocookie.com', 'www.youtube-nocookie.com',
  ]);
  const YT_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
  // Primeiro segmento do caminho que leva o id: /shorts/<id>, /embed/<id>...
  const YT_PATH_KINDS = new Set(['shorts', 'embed', 'live', 'v', 'e']);

  const TW_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv']);
  // Caminhos da Twitch que nao sao canal (twitch.tv/directory, /videos/123...).
  const TW_RESERVED = new Set([
    'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops',
    'downloads', 'jobs', 'p', 'search', 'friends', 'messages', 'payments', 'prime',
    'turbo', 'user', 'store', 'broadcast', 'moderator', 'popout', 'embed', 'login',
    'signup', 'logout', 'team', 'collections', 'following', 'clip', 'clips', 'u',
  ]);

  function isVideoId(v) {
    return typeof v === 'string' && VIDEO_ID_RE.test(v);
  }

  function isPos(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_POS;
  }

  function isTime(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
  }

  /** "90", "90s", "1m30s", "1h2m3s", "01:30" -> segundos; ruim -> 0. */
  function parseStart(v) {
    if (typeof v !== 'string' || !v || v.length > 16) return 0;
    let s = 0;
    if (/^\d+(\.\d+)?$/.test(v)) s = Number(v);
    else if (/^(\d+h)?(\d+m)?(\d+(\.\d+)?s)?$/i.test(v)) {
      const h = /(\d+)h/i.exec(v);
      const m = /(\d+)m/i.exec(v);
      const sec = /(\d+(?:\.\d+)?)s/i.exec(v);
      s = (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0);
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(v)) {
      s = v.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
    }
    return Number.isFinite(s) && s > 0 && s <= MAX_POS ? Math.floor(s) : 0;
  }

  function toUrl(input) {
    const raw = input.trim();
    try {
      return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return null;
    }
  }

  /** Link (ou id cru) do YouTube -> `{ videoId, start }`; senao `null`.
   * Aceita watch?v=, youtu.be/, music.youtube.com, shorts/, embed/, live/,
   * com `t=`/`start=` (tambem no `#t=`). Nunca faz rede. */
  function parseYouTube(input) {
    if (typeof input !== 'string') return null;
    const raw = input.trim();
    if (!raw || raw.length > MAX_LINK) return null;
    if (isVideoId(raw)) return { videoId: raw, start: 0 };
    const url = toUrl(raw);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split('/').filter(Boolean);
    let id = null;
    if (YT_SHORT_HOSTS.has(host)) {
      id = parts[0] || null;
    } else if (YT_HOSTS.has(host)) {
      if (parts[0] === 'watch') id = url.searchParams.get('v');
      else if (YT_PATH_KINDS.has(parts[0])) id = parts[1] || null;
      else if (parts.length === 0 && url.searchParams.has('v')) id = url.searchParams.get('v');
    }
    if (!isVideoId(id)) return null;
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const start = parseStart(url.searchParams.get('t') || url.searchParams.get('start') || hash.get('t') || '');
    return { videoId: id, start };
  }

  /** Link (ou nome cru) de canal da Twitch -> nome em minusculas; senao `null`. */
  function parseTwitch(input) {
    if (typeof input !== 'string') return null;
    const raw = input.trim().replace(/^@/, '');
    if (!raw || raw.length > MAX_LINK) return null;
    if (CHANNEL_RE.test(raw)) return raw.toLowerCase();
    const url = toUrl(raw);
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    const host = url.hostname.toLowerCase();
    let name = null;
    if (host === 'player.twitch.tv') name = url.searchParams.get('channel');
    else if (TW_HOSTS.has(host)) {
      const first = url.pathname.split('/').filter(Boolean)[0] || '';
      if (!TW_RESERVED.has(first.toLowerCase())) name = first;
    }
    return typeof name === 'string' && CHANNEL_RE.test(name) ? name.toLowerCase() : null;
  }

  /** Posicao (s) de um estado `{ playing, pos, at, rate }` na hora do
   * servidor `serverNow` (ms). Parado: `pos`. Hora ausente: `pos`. */
  function positionAt(state, serverNow) {
    if (!state || !isPos(state.pos)) return 0;
    if (!state.playing || !isTime(state.at) || !isTime(serverNow)) return state.pos;
    const rate = typeof state.rate === 'number' && state.rate > 0 && state.rate <= 2 ? state.rate : 1;
    return Math.min(MAX_POS, state.pos + (Math.max(0, serverNow - state.at) / 1000) * rate);
  }

  /** "1:05" / "1:02:03". */
  function formatPos(sec) {
    const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
    const s = t % 60;
    const m = Math.floor(t / 60) % 60;
    const h = Math.floor(t / 3600);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Texto de uma pessoa ou titulo: sem controle, espacos colapsados, cortado. */
  function cleanText(v, max) {
    if (typeof v !== 'string') return null;
    const t = v.slice(0, max * 4).replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(t).slice(0, max).join('');
  }

  const api = {
    VIDEO_ID_RE, CHANNEL_RE, MAX_POS, MAX_LINK,
    isVideoId, isPos, isTime, parseStart, parseYouTube, parseTwitch, positionAt, formatPos, cleanText,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaMidiaLinks = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

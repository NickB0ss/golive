// src/renderer/knownhosts.js
'use strict';

/*
 * Amigos salvos (P2 da auditoria de 2026-09-18, anexo 5-produto.md): uma
 * lista local de enderecos de maquina -- nao de "sala", que continua sem
 * historico em disco por decisao de 2026-08-23. O que fica salvo e
 * IP[:porta], pra a sonda dirigida (app.js) poder perguntar de novo "essa
 * maquina esta com uma sala aberta agora?" -- e nunca um nome de sala
 * congelado que pode nao existir mais.
 *
 * Modulo puro, sem DOM nem rede: normalizacao/validacao de endereco,
 * deduplicacao, teto e ordenacao vivem aqui pra serem testaveis sem subir
 * WebSocket nenhum (mesmo espirito de src/main/discovery.js).
 */

(function (root) {
  // Porta padrao do servidor de sinalizacao embutido (src/main/ports.js
  // tenta 9000-9010; 9000 e o primeiro). Mesma constante que
  // normalizeRoomUrl (app.js) ja usa quando o endereco vem sem porta.
  const DEFAULT_PORT = 9000;

  // Teto da lista. Generoso o bastante pra um grupo de amigos inteiro, baixo
  // o bastante pra um config.json continuar pequeno.
  const MAX_KNOWN_HOSTS = 32;

  function isValidPort(port) {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  // Sem zero a esquerda (exceto o proprio "0"): "010" seria lido como octal
  // por alguma ferramenta na cadeia, e isto e endereco de rede, nao um
  // numero decorativo.
  function isValidIPv4(host) {
    if (typeof host !== 'string' || !host) return false;
    const parts = host.split('.');
    if (parts.length !== 4) return false;
    return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && (p === '0' || p[0] !== '0'));
  }

  // Validacao pratica de IPv6 (RFC 5952 simplificada): ate 8 grupos
  // hexadecimais de 1-4 digitos, com no maximo UM '::' comprimindo zeros.
  // Nao valida zone id (`%eth0`) nem IPv4-mapped (`::ffff:1.2.3.4`) -- o
  // app nao anuncia beacon em IPv6 hoje, entao a forma pura ja cobre o uso
  // real (Tailscale/Radmin tambem falam IPv4).
  function isValidIPv6(host) {
    if (typeof host !== 'string' || !host || host.indexOf(':') === -1) return false;
    if (!/^[0-9a-fA-F:]+$/.test(host)) return false;
    const halves = host.split('::');
    if (halves.length > 2) return false; // mais de um '::' nao existe
    const groupsOf = (s) => (s === '' ? [] : s.split(':'));
    if (halves.length === 2) {
      const head = groupsOf(halves[0]);
      const tail = groupsOf(halves[1]);
      // '::' precisa comprimir pelo menos um grupo -- 8 grupos explicitos
      // nao usariam '::' de verdade.
      if (head.length + tail.length > 7) return false;
      return [...head, ...tail].every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
    }
    const groups = host.split(':');
    return groups.length === 8 && groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g));
  }

  function stripScheme(raw) {
    return String(raw).trim().replace(/^wss?:\/\//i, '');
  }

  /** Normaliza um endereco digitado, salvo ou vindo da sonda em
   * `{ host, port, address }`, onde `address` e a forma canonica usada como
   * chave (dedupe, merge com a lista de beacon) -- IPv4 "host:porta", IPv6
   * "[host]:porta". Devolve `null` pra qualquer coisa que nao seja um
   * literal IPv4 ou IPv6 valido (sem hostname/DNS -- o app nunca resolveu
   * nome, so numero). */
  function normalizeAddress(raw, defaultPort = DEFAULT_PORT) {
    if (typeof raw !== 'string') return null;
    let s = stripScheme(raw);
    if (!s) return null;
    s = s.split('/')[0]; // sem path/query -- so importa host[:porta]

    // IPv6 com colchetes: "[::1]" ou "[::1]:9000".
    const bracketed = /^\[([0-9a-fA-F:]+)\](?::(\d+))?$/.exec(s);
    if (bracketed) {
      const host = bracketed[1];
      if (!isValidIPv6(host)) return null;
      const port = bracketed[2] ? Number(bracketed[2]) : defaultPort;
      if (!isValidPort(port)) return null;
      return { host, port, address: `[${host}]:${port}` };
    }

    // IPv6 sem colchetes (2+ ':' -- um IPv4:porta so tem um). Sem colchetes
    // nao da pra saber onde o host acaba e a porta comeca, entao a porta
    // fica sempre no padrao aqui.
    if ((s.match(/:/g) || []).length >= 2) {
      if (!isValidIPv6(s)) return null;
      return { host: s, port: defaultPort, address: `[${s}]:${defaultPort}` };
    }

    // IPv4, com ou sem porta.
    const parts = s.split(':');
    if (parts.length > 2) return null;
    const host = parts[0];
    if (!isValidIPv4(host)) return null;
    const port = parts.length === 2 ? Number(parts[1]) : defaultPort;
    if (!isValidPort(port)) return null;
    return { host, port, address: `${host}:${port}` };
  }

  /** Mais recente primeiro -- "ordem por ultimo sucesso" (P2). */
  function sortByRecency(list) {
    return [...list].sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  }

  /** Adiciona (ou toca) um endereco na lista. `rawAddress` invalido e no-op
   * (devolve a MESMA referencia, pra quem chama saber que nada mudou e
   * pular persist()/render()). Endereco ja existente so atualiza
   * `lastSeenAt` -- nunca duplica. Lista cheia descarta o mais antigo por
   * `lastSeenAt` antes de entrar o novo, igual a `rooms` em discovery.js. */
  function addHost(list, rawAddress, now = Date.now(), opts = {}) {
    const max = opts.max || MAX_KNOWN_HOSTS;
    const parsed = normalizeAddress(rawAddress, opts.defaultPort);
    if (!parsed) return list;
    const key = parsed.address;
    const idx = list.findIndex((h) => h.address === key);
    const next = list.slice();
    if (idx >= 0) {
      // So anda pra frente: um replay antigo (ex: carregando o config) nao
      // pode apagar um sucesso mais recente ja registrado.
      next[idx] = { address: key, lastSeenAt: Math.max(next[idx].lastSeenAt || 0, now) };
    } else {
      if (next.length >= max) {
        let oldestIdx = 0;
        for (let i = 1; i < next.length; i += 1) {
          if ((next[i].lastSeenAt || 0) < (next[oldestIdx].lastSeenAt || 0)) oldestIdx = i;
        }
        next.splice(oldestIdx, 1);
      }
      next.push({ address: key, lastSeenAt: now });
    }
    return sortByRecency(next);
  }

  /** Remove pela interface (pode ser removido, por requisito do P2).
   * Aceita tanto a forma ja canonica quanto uma digitada de novo. */
  function removeHost(list, address) {
    const parsed = normalizeAddress(address);
    const key = parsed ? parsed.address : address;
    return list.filter((h) => h.address !== key);
  }

  /** Le a lista `knownHosts` de um config salvo. Cada item e validado e
   * normalizado por si -- um item torto (endereco invalido, tipo errado)
   * some em silencio sem custar os outros, igual a `loadStringList` de
   * config.js. Reusa addHost pra herdar dedupe/teto/ordem de um so lugar. */
  function loadList(incoming, opts = {}) {
    if (!Array.isArray(incoming)) return [];
    let list = [];
    for (const item of incoming) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (typeof item.address !== 'string') continue;
      const lastSeenAt = typeof item.lastSeenAt === 'number' && Number.isFinite(item.lastSeenAt) ? item.lastSeenAt : 0;
      list = addHost(list, item.address, lastSeenAt, opts);
    }
    return list;
  }

  /** Funde a lista descoberta por beacon UDP com a achada pela sonda
   * dirigida, sem duplicar quando as duas acham a MESMA sala -- chave
   * `address` (IP:porta), exatamente como o beacon ja chaveia em
   * discovery.js. Beacon vence o empate: chegou por broadcast de verdade,
   * a sonda so preenche o que o broadcast (ex: Tailscale) nao alcanca. */
  function mergeRoomSources(beaconRooms, probedRooms) {
    const out = [];
    const seen = new Set();
    for (const room of beaconRooms || []) {
      if (!room || typeof room.address !== 'string' || seen.has(room.address)) continue;
      seen.add(room.address);
      out.push(room);
    }
    for (const room of probedRooms || []) {
      if (!room || typeof room.address !== 'string' || seen.has(room.address)) continue;
      seen.add(room.address);
      out.push(room);
    }
    return out;
  }

  const api = {
    DEFAULT_PORT,
    MAX_KNOWN_HOSTS,
    isValidIPv4,
    isValidIPv6,
    normalizeAddress,
    sortByRecency,
    addHost,
    removeHost,
    loadList,
    mergeRoomSources,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.knownhosts = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

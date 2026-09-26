'use strict';

/*
 * Registro dos tipos de janela da Mesa (contrato:
 * docs/superpowers/plans/2026-09-24-mesa-contrato.md, secao 1).
 *
 * Cada tipo e um modulo puro em `mesa-modules/<tipo>.js` que se registra em
 * `GoLive.mesaModules[<tipo>]`. Este arquivo junta os dois lados:
 *
 * - no renderer, os modulos chegam por <script> e o registro le
 *   `window.GoLive.mesaModules` na hora do `get`/`list` (a ordem das tags
 *   entre este arquivo e os modulos nao importa);
 * - no servidor (Node), o registro faz `require` de cada nome em
 *   MODULE_NAMES. Arquivo que ainda nao existe e pulado em silencio; arquivo
 *   que existe e quebra (erro de sintaxe, formato fora do contrato) vai para
 *   `loadErrors` e fica de fora -- nunca derruba o servidor da sala.
 *
 * Tipo novo: criar `mesa-modules/<tipo>.js` e pôr o nome em MODULE_NAMES
 * (e a <script> no index.html). O teste deste registro reprova arquivo na
 * pasta que nao esteja na lista.
 *
 * O registro publico fica em `GoLive.mesaRegistry` (o mapa cru dos modulos
 * continua em `GoLive.mesaModules`).
 */

(function (root) {
  // Os tipos que os times entregam, um nome por arquivo, na ordem do menu
  // "Adicionar janela". Nome ausente no disco e so pulado.
  const MODULE_NAMES = Object.freeze([
    // Assistir junto
    'youtube', 'radio', 'aovivo',
    // Ferramentas
    'nota', 'lista', 'enquete', 'imagem', 'galeria',
    // Noite de jogo
    'placar', 'cronometro', 'sorteio', 'dados', 'roleta',
    // Jogos
    'velha', 'lig4', 'damas', 'xadrez', 'batalha', 'poquer', 'blackjack',
    // Festa: Spotify Jam (assistir), sons (noite), link (ferramentas)
    'jam', 'sons', 'link',
  ]);

  // Arquivos de apoio da pasta que NAO sao tipo de janela: os modulos que
  // os usam os carregam sozinhos (no renderer, por <script> antes deles):
  // `cadeiras` (jogos), `midialinks` (youtube, radio, aovivo), `baralho`
  // (jogos de cartas) e `poquer-maos` (o avaliador de maos do pôquer).
  const HELPER_NAMES = Object.freeze(['cadeiras', 'midialinks', 'baralho', 'poquer-maos']);

  const GROUPS = Object.freeze(['assistir', 'jogos', 'noite', 'ferramentas']);
  const TYPE_RE = /^[a-z][a-z0-9]{0,23}$/;
  // Teto do estado de UMA janela, qualquer que seja o que o modulo declare.
  // 32 janelas x 16 KB e o pior welcome possivel (~512 KB).
  const MAX_STATE_BYTES_CAP = 16 * 1024;
  const MIN_STATE_BYTES = 64;

  // Janelas de midia: a tela e a camera de alguem ao vivo. Nao tem acao
  // (`act`): o video anda pelo WebRTC, nao pela mesa. O estado so diz de
  // quem e: `{ peerId, kind }`, com `peerId` sempre de quem pos (ctx.by).
  const BUILTIN = [
    {
      type: 'tela',
      title: 'Tela',
      group: null,
      media: true,
      size: { w: 640, h: 360, minW: 160, minH: 90, aspect: 16 / 9 },
      maxStateBytes: 256,
      init(ctx) {
        return { peerId: ctx && ctx.by != null ? String(ctx.by) : null, kind: 'screen' };
      },
    },
    {
      type: 'camera',
      title: 'Câmera',
      group: null,
      media: true,
      size: { w: 320, h: 240, minW: 120, minH: 90, aspect: 4 / 3 },
      maxStateBytes: 256,
      init(ctx) {
        return { peerId: ctx && ctx.by != null ? String(ctx.by) : null, kind: 'camera' };
      },
    },
  ];

  const registry = new Map(); // tipo -> modulo conferido
  const sources = new Map(); // tipo -> o objeto cru que foi conferido
  const loadErrors = []; // { name, error }

  function isPosNum(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  }

  /** Confere um modulo contra o contrato. Devolve `{ ok: true, module }`
   * com uma copia normalizada (teto do estado aplicado) ou
   * `{ ok: false, reason }`. */
  function checkModule(mod) {
    if (!mod || typeof mod !== 'object') return { ok: false, reason: 'não é objeto' };
    if (typeof mod.type !== 'string' || !TYPE_RE.test(mod.type)) return { ok: false, reason: 'type inválido' };
    if (typeof mod.title !== 'string' || !mod.title.trim() || mod.title.length > 40) return { ok: false, reason: 'title inválido' };
    const media = mod.media === true;
    if (!media && !GROUPS.includes(mod.group)) return { ok: false, reason: 'group inválido' };
    const size = mod.size;
    if (!size || !isPosNum(size.w) || !isPosNum(size.h) || !isPosNum(size.minW) || !isPosNum(size.minH)
      || size.minW > size.w || size.minH > size.h) {
      return { ok: false, reason: 'size inválido' };
    }
    if (size.aspect != null && !isPosNum(size.aspect)) return { ok: false, reason: 'size.aspect inválido' };
    if (!isPosNum(mod.maxStateBytes)) return { ok: false, reason: 'maxStateBytes inválido' };
    if (typeof mod.init !== 'function') return { ok: false, reason: 'sem init' };
    if (!media && (typeof mod.validate !== 'function' || typeof mod.reduce !== 'function')) {
      return { ok: false, reason: 'sem validate/reduce' };
    }
    for (const opt of ['prepare', 'view', 'migrate', 'timeoutAt', 'dropPeer']) {
      if (mod[opt] != null && typeof mod[opt] !== 'function') return { ok: false, reason: `${opt} não é função` };
    }
    // Informacao escondida (contrato, secao 8): sem `view` o servidor nao
    // teria como mandar o estado sem o segredo.
    if (mod.secret != null && typeof mod.secret !== 'boolean') return { ok: false, reason: 'secret inválido' };
    if (mod.secret === true && typeof mod.view !== 'function') return { ok: false, reason: 'secret sem view' };
    const maxStateBytes = Math.max(MIN_STATE_BYTES, Math.min(MAX_STATE_BYTES_CAP, Math.floor(mod.maxStateBytes)));
    const module = Object.freeze({
      ...mod,
      group: media ? null : mod.group,
      media,
      secret: mod.secret === true,
      size: Object.freeze({ ...size, aspect: size.aspect == null ? null : size.aspect }),
      maxStateBytes,
    });
    return { ok: true, module };
  }

  function rawMap() {
    root.GoLive = root.GoLive || {};
    root.GoLive.mesaModules = root.GoLive.mesaModules || {};
    return root.GoLive.mesaModules;
  }

  /** Registra um modulo. `false` (e o motivo em `loadErrors`) quando ele
   * esta fora do contrato. Registrar o mesmo tipo de novo troca o anterior. */
  function register(mod) {
    const res = checkModule(mod);
    if (!res.ok) {
      loadErrors.push({ name: mod && typeof mod.type === 'string' ? mod.type : '?', error: res.reason });
      return false;
    }
    registry.set(res.module.type, res.module);
    sources.set(res.module.type, mod);
    const map = rawMap();
    if (map[res.module.type] !== mod) map[res.module.type] = mod;
    return true;
  }

  /** Puxa para o registro o que se registrou sozinho no mapa cru depois
   * (os <script> dos modulos no renderer). */
  function syncRaw() {
    const map = rawMap();
    for (const type of Object.keys(map)) {
      const mod = map[type];
      if (sources.get(type) === mod) continue;
      if (!mod || mod.type !== type) {
        loadErrors.push({ name: type, error: 'type não bate com a chave' });
        delete map[type];
        continue;
      }
      if (!register(mod)) delete map[type];
    }
  }

  function get(type) {
    if (typeof type !== 'string') return null;
    if (!registry.has(type)) syncRaw();
    return registry.get(type) || null;
  }

  /** Todos os tipos: os da lista na ordem dela, depois os embutidos, depois
   * qualquer outro que tenha se registrado. */
  function list() {
    syncRaw();
    const out = [];
    const seen = new Set();
    for (const name of [...MODULE_NAMES, ...BUILTIN.map((b) => b.type), ...[...registry.keys()].sort()]) {
      if (seen.has(name) || !registry.has(name)) continue;
      seen.add(name);
      out.push(registry.get(name));
    }
    return out;
  }

  /** So o que entra no menu "Adicionar janela" (sem tela e camera, que o
   * app poe sozinho). */
  function addable() {
    return list().filter((m) => !m.media);
  }

  /** Carrega os nomes pelo `require` de Node. `req` e injetavel para teste.
   * Nome que nao resolve (arquivo ainda nao entregue) e pulado; o resto que
   * falhar vai para `loadErrors`. */
  function loadFrom(names, req) {
    const loaded = [];
    for (const name of names) {
      let resolved;
      try {
        resolved = req.resolve(`./${name}.js`);
      } catch {
        continue; // ainda nao existe
      }
      try {
        const mod = req(resolved);
        if (!mod || mod.type !== name) {
          loadErrors.push({ name, error: 'type não bate com o nome do arquivo' });
          continue;
        }
        if (register(mod)) loaded.push(name);
      } catch (err) {
        loadErrors.push({ name, error: String((err && err.message) || err).slice(0, 200) });
      }
    }
    return loaded;
  }

  for (const b of BUILTIN) register(b);

  const api = {
    MODULE_NAMES, HELPER_NAMES, GROUPS, MAX_STATE_BYTES_CAP,
    register, get, list, addable, checkModule, loadFrom, loadErrors,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaRegistry = api;

  if (typeof module !== 'undefined' && typeof require === 'function') {
    loadFrom(MODULE_NAMES, require);
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : global);

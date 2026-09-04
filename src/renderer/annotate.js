// src/renderer/annotate.js
'use strict';

/*
 * Anotacao na tela compartilhada -- a parte PURA: paleta por pessoa, a
 * matematica do letterbox e o deposito de itens por superficie.
 *
 * Nada aqui toca no DOM nem na rede. Quem desenha e o ui.js (canvas +
 * ponteiro); quem transporta e o app.js (mensagens 'annotate'). Este
 * arquivo e a unica fonte da verdade sobre O QUE existe na lousa, e por
 * isso e o unico que da pra testar sem subir Electron.
 *
 * Ver docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md
 */

(function (root) {
  // Tintas. Saturadas de proposito -- e a excecao declarada na spec (secao
  // 5.3): a cor aqui nao classifica estado de app nenhum, ela diz QUEM
  // desenhou, e vive num plano que so existe enquanto alguem esta
  // desenhando por cima de video.
  //
  // Sem vermelho: `--live` (o unico acento saturado do tema) significa
  // "alguem esta ao vivo", e um traco vermelho por cima de um video ao vivo
  // seria a mesma cor dizendo duas coisas.
  const PALETTE = [
    '#4ADE80', // verde
    '#60A5FA', // azul
    '#FBBF24', // ambar
    '#F472B6', // rosa
    '#A78BFA', // violeta
    '#22D3EE', // ciano
    '#FB923C', // laranja
    '#E2E8F0', // gelo
  ];

  // Tetos. Todos existem porque tudo isto e entrada de rede -- ver a tabela
  // da secao 5.6 da spec. O de itens corta o MAIS ANTIGO (a lousa e uma
  // conversa: o que importa e o que acabou de ser dito).
  const MAX_ITEMS = 400;
  const MAX_POINTS_PER_STROKE = 2000;
  const MAX_TEXT = 120;

  /** Cor do pincel de um participante. O id de conexao e atribuido pelo
   * servidor em sequencia ('1', '2', '3'...), entao indexar a paleta por
   * ele da cores DISTINTAS numa sala real (~4-6 pessoas) e a MESMA tabela
   * em todos os clientes, sem trocar uma mensagem sobre isso.
   *
   * O ramo de hash cobre ids que nao sejam numericos (a chave local 'me'
   * antes do welcome, ou um servidor futuro que mude o formato): pior caso
   * duas pessoas repetem cor, nunca uma cor indefinida. */
  function colorFor(peerId) {
    const str = String(peerId ?? '');
    const n = Number(str);
    if (Number.isInteger(n) && n > 0) return PALETTE[(n - 1) % PALETTE.length];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  /** Retangulo do CONTEUDO do video dentro da caixa do tile.
   *
   * O `<video>` e `object-fit: contain`: a imagem tem letterbox, e a caixa
   * do elemento nao e a caixa do que se ve. Normalizar sobre a caixa do
   * elemento poria o mesmo rabisco em pixels diferentes pra quem esta em
   * janela e pra quem esta em fullscreen -- que e exatamente o erro que
   * esta funcao existe pra impedir.
   *
   * Sem dimensao de video ainda (primeiro quadro nao chegou) devolve a
   * caixa inteira: melhor um mapeamento aproximado por um instante do que
   * uma divisao por zero. */
  function contentRect(videoW, videoH, boxW, boxH) {
    const vw = Number(videoW);
    const vh = Number(videoH);
    const bw = Number(boxW) || 0;
    const bh = Number(boxH) || 0;
    if (!(vw > 0) || !(vh > 0) || !(bw > 0) || !(bh > 0)) {
      return { left: 0, top: 0, width: bw, height: bh };
    }
    const scale = Math.min(bw / vw, bh / vh);
    const width = vw * scale;
    const height = vh * scale;
    return { left: (bw - width) / 2, top: (bh - height) / 2, width, height };
  }

  /** Ponto em pixels (relativo a caixa do tile) -> 0..1 sobre o conteudo.
   * Preso na borda: arrastar pra fora do video nao gera coordenada fora da
   * faixa, gera um traco que encosta na beirada. */
  function toNorm(px, py, rect) {
    if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
    const x = (px - rect.left) / rect.width;
    const y = (py - rect.top) / rect.height;
    return { x: round3(clamp01(x)), y: round3(clamp01(y)) };
  }

  /** 0..1 -> pixels relativos a caixa do tile. Inverso exato de toNorm. */
  function toPx(x, y, rect) {
    return { x: rect.left + x * rect.width, y: rect.top + y * rect.height };
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function round3(v) {
    return Math.round(v * 1000) / 1000;
  }
  function isNorm(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  }

  /** Um item vindo da rede (snapshot de quem ja estava na sala) recortado
   * pro que a gente desenha. Devolve `null` pro que nao da pra aproveitar
   * -- item torto e descartado, nunca "consertado" com valor inventado.
   *
   * A COR nao vem daqui nem da rede: e derivada de `from` na hora de
   * desenhar. Nao existe campo de cor pra forjar. */
  function sanitizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : null;
    const from = raw.from == null ? null : String(raw.from).slice(0, 64);
    if (!id || !from) return null;

    if (raw.kind === 'stroke') {
      if (!Array.isArray(raw.points)) return null;
      const points = [];
      for (const p of raw.points.slice(0, MAX_POINTS_PER_STROKE)) {
        if (!Array.isArray(p) || !isNorm(p[0]) || !isNorm(p[1])) continue;
        points.push([round3(p[0]), round3(p[1])]);
      }
      if (!points.length) return null;
      const width = Number(raw.width);
      return { kind: 'stroke', id, from, width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 20) : 4, points };
    }

    if (raw.kind === 'text') {
      const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : '';
      if (!text.trim() || !isNorm(raw.x) || !isNorm(raw.y)) return null;
      const size = Number(raw.size);
      return {
        kind: 'text', id, from, text,
        x: round3(raw.x), y: round3(raw.y),
        size: Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : 20,
      };
    }
    return null;
  }

  function sanitizeItems(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const raw of list.slice(0, MAX_ITEMS)) {
      const item = sanitizeItem(raw);
      if (item) out.push(item);
    }
    return out;
  }

  /** Deposito de lousas, indexado pela superficie (o id de quem esta
   * transmitindo aquela tela). Uma instancia por app -- ele guarda tanto o
   * que EU desenho quanto o que chega pela rede, pelo mesmo caminho
   * (`apply`), pra que nao existam dois formatos de item.
   *
   * `apply` devolve `true` quando algo mudou de verdade: quem chama usa
   * isso pra so redesenhar o canvas quando ha o que redesenhar. */
  function createStore() {
    const surfaces = new Map(); // surfaceId -> item[]

    function items(surfaceId) {
      return surfaces.get(String(surfaceId)) || [];
    }

    function listFor(surfaceId) {
      const key = String(surfaceId);
      let list = surfaces.get(key);
      if (!list) {
        list = [];
        surfaces.set(key, list);
      }
      return list;
    }

    /** `from` e quem MANDOU a op -- carimbado pelo servidor pro que vem da
     * rede, e o proprio id pro que nasce aqui. Toda regra de autoria sai
     * dele: so o autor estende o proprio traco, so o autor desfaz o
     * proprio item. */
    function apply(surfaceId, from, op) {
      if (!op || typeof op !== 'object') return false;
      const author = String(from);
      const list = listFor(surfaceId);

      switch (op.op) {
        case 'begin': {
          if (!op.id || !isNorm(op.x) || !isNorm(op.y)) return false;
          const width = Number(op.width);
          list.push({
            kind: 'stroke',
            id: String(op.id).slice(0, 64),
            from: author,
            width: Number.isFinite(width) ? Math.min(Math.max(width, 1), 20) : 4,
            points: [[round3(op.x), round3(op.y)]],
          });
          trim(list);
          return true;
        }
        case 'points': {
          if (!op.id || !Array.isArray(op.points)) return false;
          // Busca de tras pra frente: o traco que esta sendo estendido e
          // quase sempre o ultimo da lista.
          const stroke = findStroke(list, String(op.id), author);
          if (!stroke) return false; // 'points' sem 'begin' (ou de outro autor) nao cria traco
          let changed = false;
          for (const p of op.points) {
            if (!Array.isArray(p) || !isNorm(p[0]) || !isNorm(p[1])) continue;
            if (stroke.points.length >= MAX_POINTS_PER_STROKE) break;
            stroke.points.push([round3(p[0]), round3(p[1])]);
            changed = true;
          }
          return changed;
        }
        case 'end':
          return false; // o traco ja esta na lista desde o 'begin' -- 'end' so fecha o lote do lado de quem desenha
        case 'text': {
          const text = typeof op.text === 'string' ? op.text.slice(0, MAX_TEXT) : '';
          if (!op.id || !text.trim() || !isNorm(op.x) || !isNorm(op.y)) return false;
          const size = Number(op.size);
          list.push({
            kind: 'text',
            id: String(op.id).slice(0, 64),
            from: author,
            text,
            x: round3(op.x),
            y: round3(op.y),
            size: Number.isFinite(size) ? Math.min(Math.max(size, 8), 96) : 20,
          });
          trim(list);
          return true;
        }
        case 'undo': {
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].from !== author) continue;
            list.splice(i, 1);
            return true;
          }
          return false;
        }
        case 'clear': {
          if (op.scope === 'all') {
            if (!list.length) return false;
            list.length = 0;
            return true;
          }
          const before = list.length;
          const kept = list.filter((it) => it.from !== author);
          if (kept.length === before) return false;
          list.length = 0;
          list.push(...kept);
          return true;
        }
        default:
          return false;
      }
    }

    function findStroke(list, id, author) {
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i];
        if (it.kind === 'stroke' && it.id === id && it.from === author) return it;
      }
      return null;
    }

    function trim(list) {
      while (list.length > MAX_ITEMS) list.shift();
    }

    /** Snapshot pra mandar pra quem entrou no meio da explicacao. Copia
     * rasa dos pontos: quem recebe nao pode acabar segurando o mesmo array
     * que o traco vivo daqui. */
    function snapshot(surfaceId) {
      return items(surfaceId).map((it) =>
        it.kind === 'stroke' ? { ...it, points: it.points.map((p) => [p[0], p[1]]) } : { ...it }
      );
    }

    /** Carrega um snapshot recebido, SUBSTITUINDO o que houver. So e
     * chamado no primeiro sync de uma superficie (ver app.js) -- carregar
     * por cima de uma lousa em uso apagaria o traco que a pessoa esta
     * desenhando neste instante. */
    function load(surfaceId, list) {
      surfaces.set(String(surfaceId), sanitizeItems(list));
    }

    function drop(surfaceId) {
      surfaces.delete(String(surfaceId));
    }

    function clearAll() {
      surfaces.clear();
    }

    /** Ha algo desenhado por `author` nesta superficie? E o que decide se
     * "Desfazer" e "Limpar os meus" fazem alguma coisa. */
    function hasFrom(surfaceId, author) {
      return items(surfaceId).some((it) => it.from === String(author));
    }

    return { apply, items, snapshot, load, drop, clearAll, hasFrom };
  }

  const api = {
    PALETTE,
    MAX_ITEMS,
    MAX_POINTS_PER_STROKE,
    MAX_TEXT,
    colorFor,
    contentRect,
    toNorm,
    toPx,
    sanitizeItem,
    sanitizeItems,
    createStore,
  };

  root.GoLive = root.GoLive || {};
  root.GoLive.annotate = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

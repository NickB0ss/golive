'use strict';

/*
 * "Pôr na mesa" a partir do chat -- a parte PURA.
 *
 * 1. As imagens que o historico do chat ainda guarda. A janela `imagem` da
 *    Mesa guarda so o id da mensagem (nunca o data URL: o estado de janela
 *    tem teto de bytes e a imagem ja esta no historico), entao cada PC
 *    precisa saber, pelo id, se a imagem ainda existe. Este deposito espelha
 *    as regras do historico do servidor (server/signaling-core.js,
 *    `pushChatEntry`/`trimImageHistory`): 50 linhas, das quais no maximo 8
 *    com imagem, a mais antiga saindo inteira. Assim quem chegou agora (que
 *    recebeu o historico no welcome) e quem estava desde o comeco veem a
 *    mesma coisa na janela.
 *
 *    Diferenca conhecida: o servidor nao manda a quem entra a linha "fulano
 *    entrou" da propria entrada (ela vai para o historico), entao o espelho
 *    dessa pessoa tem uma linha a menos ate o proximo welcome. No pior caso
 *    a imagem mais antiga some dela uma mensagem depois de sumir para os
 *    outros -- nunca o contrario.
 *
 * 2. Links do YouTube numa mensagem de texto (para o botao "Pôr na mesa").
 *
 * Sem DOM. O app.js alimenta o deposito (welcome e cada `chat`) e o expoe em
 * `GoLive.chatImagens`, onde o conteudo das janelas `imagem` e `galeria` le.
 */

(function (root) {
  const MAX_LINES = 50; // CHAT_HISTORY_MAX do servidor
  const MAX_IMAGES = 8; // CHAT_IMAGE_HISTORY_MAX do servidor
  const MAX_LINKS = 3; // botoes "Pôr na mesa" por mensagem
  const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

  function isMsgId(v) {
    return typeof v === 'string' && ID_RE.test(v);
  }

  function hasImage(entry, isImage) {
    return Boolean(entry && !entry.system && typeof entry.image === 'string' && (!isImage || isImage(entry.image)));
  }

  /**
   * `isImage(dataUrl)`: a mesma validacao que o chat usa para exibir
   * (chatmedia.isImageDataUrl). Linha com imagem invalida conta como texto,
   * como no servidor (que ja a teria recusado).
   */
  function createStore({ isImage = null, maxLines = MAX_LINES, maxImages = MAX_IMAGES } = {}) {
    let lines = []; // { id, image, from, name, w, h, ts } | { system: true }
    const listeners = new Set();

    function toLine(entry) {
      if (!entry || typeof entry !== 'object') return null;
      if (!hasImage(entry, isImage)) return { image: null };
      return {
        id: isMsgId(entry.id) ? entry.id : null,
        image: entry.image,
        from: entry.from != null ? String(entry.from) : null,
        name: typeof entry.name === 'string' ? entry.name : '',
        w: Number.isFinite(entry.w) ? entry.w : null,
        h: Number.isFinite(entry.h) ? entry.h : null,
        ts: Number.isFinite(entry.ts) ? entry.ts : null,
      };
    }

    function trim() {
      if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
      let extras = lines.filter((l) => l.image).length - maxImages;
      while (extras > 0) {
        const i = lines.findIndex((l) => l.image);
        if (i < 0) break;
        lines.splice(i, 1);
        extras -= 1;
      }
    }

    function emit() {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch {
          // um ouvinte quebrado (janela ja fechando) nao derruba os outros
        }
      }
    }

    /** O historico inteiro (welcome). */
    function setHistory(entries) {
      lines = [];
      for (const e of Array.isArray(entries) ? entries : []) {
        const l = toLine(e);
        if (!l) continue;
        lines.push(l);
        trim();
      }
      emit();
    }

    /** Uma linha nova (mensagem ou linha de sistema). */
    function push(entry) {
      const l = toLine(entry);
      if (!l) return;
      lines.push(l);
      trim();
      emit();
    }

    function clear() {
      lines = [];
      emit();
    }

    /** A imagem da mensagem `id`, ou null se ela saiu do historico. */
    function get(id) {
      if (!isMsgId(id)) return null;
      const l = lines.find((x) => x.image && x.id === id);
      return l ? { ...l } : null;
    }

    /** As imagens que o historico guarda, da mais antiga para a mais nova. */
    function list() {
      return lines.filter((l) => l.image && l.id).map((l) => ({ ...l }));
    }

    /** Avisa a cada mudanca. Devolve o desfazedor. */
    function onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return { setHistory, push, clear, get, list, onChange };
  }

  const YT_URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\/[^\s<>"'`]+/gi;

  /** Links do YouTube numa mensagem: `[{ url, videoId }]`, sem repetir o
   * mesmo video, no maximo 3. `parse` e o `parseYouTube` de midialinks. */
  function youtubeLinks(text, parse) {
    if (typeof text !== 'string' || !text || typeof parse !== 'function') return [];
    const out = [];
    const seen = new Set();
    for (const m of text.matchAll(YT_URL_RE)) {
      // Pontuacao grudada no fim ("olha isso: youtu.be/abc.") nao e do link.
      const url = m[0].replace(/[.,;:!?)\]}]+$/, '');
      const link = parse(url);
      if (!link || seen.has(link.videoId)) continue;
      seen.add(link.videoId);
      out.push({ url, videoId: link.videoId });
      if (out.length >= MAX_LINKS) break;
    }
    return out;
  }

  const api = { MAX_LINES, MAX_IMAGES, MAX_LINKS, isMsgId, createStore, youtubeLinks };

  root.GoLive = root.GoLive || {};
  root.GoLive.chatImagensLib = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

'use strict';

/*
 * "Pôr na mesa" -- de fora do menu da Mesa: um link do YouTube no chat, uma
 * imagem do chat, uma imagem da Galeria.
 *
 * Funciona nas duas vistas. Sao duas operacoes, como o menu faria na mao:
 * `add` da janela e, quando o servidor diz qual id ela ganhou, `act` com o
 * conteudo (`load` do video, `set` da imagem).
 *
 *  - Na Mesa, a janela nasce no meio da vista de quem clicou (no lugar livre
 *    mais perto, `view.spot`), e o id vem no eco `mesa` op `add` com `by`
 *    = eu, que a vista tambem recebe e desenha.
 *  - Na Transmissao, nasce no meio da mesa; quem esta la nao recebe o eco,
 *    entao o servidor manda `mesa-ack` so para o autor (contrato, secao 5).
 *
 * Sobreposicao no `add` (alguem pos outra janela no meio antes): o servidor
 * recusa com `fix`, o lugar livre mais perto, e este modulo tenta ali (ate 3
 * vezes). Qualquer outra recusa vira aviso.
 *
 * Sem DOM: `send`, `me`, `view`, `toast`, `registry` e `now` sao injetados
 * (app.js monta), e o teste roda no Node.
 */

(function (root) {
  const PENDING_MS = 8000; // um `add` que nao teve resposta nesse tempo e esquecido
  const MAX_TRIES = 3;
  const WORLD = { w: 4800, h: 3000 }; // mesa.js; repetido para rodar sem ele no teste

  const DENIED = {
    rate: 'Calma: muitas mudanças de uma vez.',
    locked: 'Só o líder mexe na mesa agora.',
    full: 'A mesa já tem 32 janelas.',
    'no-space': 'Não há lugar livre na mesa para esta janela.',
    'unknown-type': 'Esta sala não conhece este tipo de janela.',
    'not-found': 'A janela saiu da mesa antes de receber o conteúdo.',
  };

  /** Retangulo do tamanho padrao do tipo com o meio em (cx, cy). */
  function centered(size, cx, cy) {
    const w = Math.round(size.w);
    const h = Math.round(size.h);
    return { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
  }

  function create(deps) {
    const now = deps.now || (() => Date.now());
    let pending = null; // { type, action, title, tries, at }
    let lastAct = null; // { id, title, at }: recusa do act vira aviso

    function mod(type) {
      try {
        return deps.registry()?.get(type) || null;
      } catch {
        return null;
      }
    }

    function expire() {
      if (pending && now() - pending.at > PENDING_MS) pending = null;
      if (lastAct && now() - lastAct.at > PENDING_MS) lastAct = null;
    }

    function sendAdd(rect) {
      return deps.send({ type: 'mesa', op: 'add', win: { type: pending.type, ...rect } });
    }

    /** Pede a janela `type` e, quando ela existir, manda `action` para ela.
     * `false` se nem deu para pedir (tipo desconhecido, sem conexao). */
    function put(type, action) {
      expire();
      const m = mod(type);
      if (!m || m.media) return false;
      const opened = deps.view.isOpen();
      const rect = (opened && deps.view.spot(type)) || centered(m.size, WORLD.w / 2, WORLD.h / 2);
      pending = { type, action, title: m.title, tries: 0, at: now() };
      if (!sendAdd(rect)) {
        pending = null;
        deps.toast('Sem conexão com a sala agora.');
        return false;
      }
      return true;
    }

    function sendAct(id) {
      const p = pending;
      pending = null;
      if (!p || typeof id !== 'string' || !id) return;
      if (p.action) deps.send({ type: 'mesa', op: 'act', id, action: p.action });
      lastAct = { id, title: p.title, at: now() };
      if (!deps.view.isOpen()) deps.toast(`${p.title} foi para a mesa.`);
    }

    /** Uma mensagem da sinalizacao. `true` quando ela era so deste modulo
     * (a vista nao deve tratar de novo). */
    function handle(msg) {
      if (!msg || typeof msg !== 'object') return false;
      expire();
      if (msg.type === 'mesa' && msg.op === 'add' && pending && String(msg.by) === String(deps.me())
        && msg.win && msg.win.type === pending.type) {
        sendAct(msg.win.id);
        return false; // a vista desenha a janela
      }
      if (msg.type === 'mesa-ack' && msg.op === 'add' && pending) {
        sendAct(msg.id);
        return true;
      }
      if (msg.type === 'mesa-denied' && msg.op === 'add' && pending) {
        const reason = String(msg.reason || '');
        const fix = msg.fix && typeof msg.fix === 'object' ? msg.fix : null;
        if ((reason === 'overlap' || reason === 'out-of-world') && fix && pending.tries < MAX_TRIES) {
          pending.tries += 1;
          pending.at = now();
          sendAdd({ x: fix.x, y: fix.y, w: fix.w, h: fix.h });
          return true;
        }
        pending = null;
        deps.toast(DENIED[reason] || 'Não deu para pôr na mesa agora.');
        return true;
      }
      if (msg.type === 'mesa-denied' && msg.op === 'act' && lastAct && msg.id === lastAct.id && !deps.view.isOpen()) {
        // Na Mesa o conteudo da janela mostra a recusa; na Transmissao, aviso.
        const detail = typeof msg.detail === 'string' && msg.detail ? msg.detail : null;
        deps.toast(detail ? `${lastAct.title}: ${detail}` : (DENIED[msg.reason] || 'Não deu para pôr na mesa agora.'));
        lastAct = null;
        return true;
      }
      return false;
    }

    /** A sala acabou ou trocou: nada pendente vale mais. */
    function reset() {
      pending = null;
      lastAct = null;
    }

    return { put, handle, reset, pending: () => (pending ? { ...pending } : null) };
  }

  const api = { create, centered, PENDING_MS, MAX_TRIES };

  root.GoLive = root.GoLive || {};
  root.GoLive.mesaPorLib = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

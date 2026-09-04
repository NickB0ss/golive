// src/renderer/ui.js
'use strict';

(function (root) {
  const $ = (id) => document.getElementById(id);
  const configApi = root.GoLive.config;
  const version = root.GoLive.version;
  const theme = root.GoLive.theme;
  const emoji = root.GoLive.emoji;
  const chatmedia = root.GoLive.chatmedia;
  const annotate = root.GoLive.annotate;

  // Resolucao e taxa em linhas separadas dentro do chip; `tag` marca o
  // padrao do app (1080p60), pra escolha nao ser as cegas.
  // Nota que acompanha a linha de custo, so nas TRES pontas que merecem uma.
  // Antes eram tags impressas dentro dos chips, uma por preset -- e ali elas
  // nao davam pra comparar: "mais leve", "padrao" e "exige banda" sao tres
  // escalas diferentes (custo, recomendacao, requisito) lado a lado. Na
  // linha de resumo so aparece a nota da opcao escolhida, ao lado do numero
  // exato dela.
  const QUALITY_PRESET_NOTE = {
    '720p30': 'o mais leve',
    '1080p60': 'padrão',
    '1440p60': 'exige bastante upload',
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const gridEl = $('grid');

  // tileRegistry espelha os tiles ativos (id -> {label, stream, avatar}) e e
  // a fonte de candidatos pro "+" do PiP. fullscreenTileId e o id do tile em
  // fullscreen agora (ou null). pinnedPip sao os ids marcados como miniatura
  // -- sobrevive a trocas de foco e a sair/entrar de fullscreen, so e limpo
  // quando o id some do tileRegistry ou o usuario remove manualmente (ver
  // spec docs/superpowers/specs/2026-08-20-tile-avatars-and-fullscreen-pip-design.md).
  const tileRegistry = new Map();
  let fullscreenTileId = null;
  const pinnedPip = new Set();

  // Posicao/tamanho de cada miniatura arrastavel dentro do fullscreen --
  // id -> { x, y, w }. x/y em % da area do fullscreen (0-100, sobrevive a
  // trocar de monitor/resolucao), w em px (altura sempre w * 9/16). Mesmo
  // ciclo de vida do pinnedPip: sobrevive a trocar de foco e a sair/entrar
  // de fullscreen, so e limpo quando o id sai do tileRegistry ou o usuario
  // remove a miniatura manualmente.
  const pipLayout = new Map();
  const PIP_MIN_W = 120;
  const PIP_MAX_W_RATIO = 0.45;
  const PIP_DEFAULT_W = 140;
  const PIP_MARGIN_PX = 16;

  // Mantem a classe `.fullscreen` do tile sincronizada quando o usuario sai
  // do fullscreen por Esc ou pelos controles nativos do SO, sem passar pelo
  // nosso botao/duplo-clique (toggleTileFullscreen, mais abaixo).
  window.golive.onFullScreenChange((enabled) => {
    if (enabled) return;
    document.querySelectorAll('.tile.fullscreen').forEach((t) => t.classList.remove('fullscreen', 'idle'));
    fullscreenTileId = null;
    clearTimeout(fullscreenIdleTimer);
  });

  // Nome, avatar, "+" do PiP e o botao de sair do fullscreen (`.tile.fullscreen.idle`
  // no CSS) e o proprio cursor do mouse (`cursor: none`) somem depois de um
  // tempo parado, tipo player de video, e voltam no primeiro movimento.
  const FULLSCREEN_IDLE_MS = 3000;
  let fullscreenIdleTimer = null;

  function scheduleFullscreenIdle(tile) {
    clearTimeout(fullscreenIdleTimer);
    tile.classList.remove('idle');
    fullscreenIdleTimer = setTimeout(() => tile.classList.add('idle'), FULLSCREEN_IDLE_MS);
  }

  function clearFullscreenIdle(tile) {
    clearTimeout(fullscreenIdleTimer);
    fullscreenIdleTimer = null;
    tile?.classList.remove('idle');
  }

  document.addEventListener('mousemove', () => {
    if (!fullscreenTileId) return;
    const tile = document.getElementById(`tile-${fullscreenTileId}`);
    if (tile) scheduleFullscreenIdle(tile);
  });

  // Volume/mute por tile remoto, roteado via Web Audio pra poder passar de
  // 100% (o <video> nativo so vai ate 1.0) -- ver Step 3 do Task 11 do plano
  // de implementacao pra contexto completo.
  let playbackAudioCtx = null;
  function getPlaybackAudioContext() {
    if (!playbackAudioCtx) playbackAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return playbackAudioCtx;
  }

  const tileAudio = new Map(); // id -> { volume, muted, source, gain, builtForStream, builtAudioTrackCount }

  function getOrCreateAudioState(id) {
    let state = tileAudio.get(id);
    if (!state) {
      state = {
        volume: 1,
        muted: false,
        source: null,
        gain: null,
        builtForStream: null,
        builtAudioTrackCount: 0,
      };
      tileAudio.set(id, state);
    }
    return state;
  }

  /** Silenciar e LOCAL: um GainNode por tile, sem passar pelo servidor --
   * ninguem mais na sala fica sabendo, e e por isso que ele nunca esteve no
   * mesmo menu que expulsar e banir (que vao pro servidor e valem pra sala
   * inteira). Desde 2026-09-04 o unico lugar que o oferece e o menu de
   * contexto do tile; estas duas funcoes sao a porta desse estado. */
  function setMuted(id, muted) {
    const state = getOrCreateAudioState(id);
    state.muted = muted;
    if (state.gain) state.gain.gain.value = muted ? 0 : state.volume;
  }
  function isMuted(id) {
    return getOrCreateAudioState(id).muted;
  }

  // Chamada em TODA renderizacao do tile (nao so quando o srcObject muda),
  // porque mesh.js dispara um evento 'track' por track (video, depois audio,
  // separadamente) e cada um vira uma chamada a showTile com o MESMO objeto
  // de stream -- entao na 1a chamada (so video) pode nao existir audio track
  // ainda, e a 2a chamada (audio chegou) e a que realmente precisa construir
  // o grafo. Tambem cobre tiles camera-only, que nunca ganham audio track:
  // nesse caso so retornamos sem tentar nada, sem lancar excecao.
  function ensureTileAudio(id, video, stream) {
    if (id === 'me' || id === 'cam-me') return;
    const state = getOrCreateAudioState(id);
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) return; // sem audio track (ainda, ou nunca) -- nada a conectar
    if (state.source && state.builtForStream === stream && state.builtAudioTrackCount === audioTracks.length) {
      return; // grafo ja construido pra essa combinacao exata de stream+tracks
    }

    const ctx = getPlaybackAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (state.source) {
      try { state.source.disconnect(); } catch { /* ja desconectado */ }
    }
    try {
      // MediaStreamAudioSourceNode so enxerga as tracks que existem no
      // momento da criacao -- por isso recriamos sempre que a contagem de
      // audio tracks muda, em vez de confiar que uma track adicionada depois
      // vai "aparecer" nesse node.
      state.source = ctx.createMediaStreamSource(stream);
    } catch {
      // Chromium pode lancar InvalidStateError numa corrida (ex: track
      // removida entre o check acima e a criacao). Nao derruba showTile --
      // so deixa sem grafo ativo pra esse tile, e tenta de novo na proxima
      // chamada.
      state.source = null;
      return;
    }
    if (!state.gain) state.gain = ctx.createGain();
    state.gain.gain.value = state.muted ? 0 : state.volume;
    state.source.connect(state.gain).connect(ctx.destination);
    state.builtForStream = stream;
    state.builtAudioTrackCount = audioTracks.length;
  }

  function releaseTileAudio(id) {
    const state = tileAudio.get(id);
    if (!state) return;
    try { state.source?.disconnect(); } catch { /* ja desconectado */ }
    try { state.gain?.disconnect(); } catch { /* ja desconectado */ }
    tileAudio.delete(id);
  }

  // Motion #14, a transicao de maior alavancagem do app: o tile CRESCE ate
  // virar fullscreen em vez de cortar seco. startViewTransition existe no
  // Chromium 128 (Electron 32), entao nao precisa de polyfill nem de
  // biblioteca.
  //
  // O `view-transition-name` so existe DURANTE a transicao: dois elementos
  // com o mesmo nome ao mesmo tempo abortam a transicao inteira, e sair do
  // fullscreen com outro tile ja marcado seria exatamente isso.
  //
  // ATENCAO, pendencia de verificacao da spec: view transitions tiram um
  // snapshot do elemento, e <video> tocando pode piscar ou congelar um
  // frame na captura. Se piscar na pratica, a alternativa e animar o
  // transform do tile do retangulo de origem ate o de destino (FLIP).
  function toggleTileFullscreen(tile, id) {
    const apply = () => {
      const entering = !tile.classList.contains('fullscreen');
      tile.classList.toggle('fullscreen', entering);
      window.golive.setFullScreen(entering);
      if (entering) {
        fullscreenTileId = id;
        renderPipStrip(tile);
        scheduleFullscreenIdle(tile);
      } else {
        fullscreenTileId = null;
        clearFullscreenIdle(tile);
      }
    };

    if (!document.startViewTransition) return apply(); // fallback: corte seco, como antes

    tile.style.viewTransitionName = 'tile';
    const transition = document.startViewTransition(apply);
    transition.finished.finally(() => {
      tile.style.viewTransitionName = '';
    });
  }

  // Pintura dos <video>. Um <video> pausado deixa de compor frames, mas a
  // MediaStreamTrack por tras continua viva e sendo enviada -- pausar o
  // elemento e parada de EXIBICAO, nao de captura nem de encode (que rodam
  // no processo de GPU). E o que permite nao gastar GPU desenhando a propria
  // tela dentro da propria tela enquanto o jogo esta por cima. Ver a spec de
  // 2026-08-23, F1.4.
  let paintingEnabled = true;

  function applyPainting(video) {
    if (!video) return;
    if (paintingEnabled) video.play().catch(() => {});
    else video.pause();
  }

  function setPainting(enabled) {
    if (paintingEnabled === enabled) return;
    paintingEnabled = enabled;
    gridEl.querySelectorAll('video').forEach((video) => {
      // O veu de pausa ja mandou o video pausar e sumir -- a janela
      // ficar visivel de novo nao pode religar a decodificacao por baixo
      // dele (ver renderPausedOverlay).
      if (video.closest('.tile')?.classList.contains('is-paused')) return;
      applyPainting(video);
    });
  }

  // Quem esta assistindo cada tile agora (F1.3 + o broadcast de
  // 'watchers' em app.js) -- id do tile -> [{ id, name, avatar }]. Guardado
  // aqui (nao so no DOM) porque a mensagem 'watchers' pode chegar antes do
  // tile existir (renegociacao) ou depois dele ter sido recriado.
  const tileWatchers = new Map();

  function renderTileWatchers(tile, watchers) {
    const el = tile?.querySelector('.tile-watchers');
    if (!el) return;
    if (!watchers?.length) {
      el.classList.add('empty');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('empty');
    el.innerHTML = `
      <span class="tile-watchers-label">assistindo</span>
      <ul class="tile-watchers-list">
        ${watchers
          .map(
            (w) => `<li>
              <span class="tile-watchers-avatar">${avatarInnerHtml(w.id, w.name, w.avatar)}</span>
              <span class="tile-watchers-name">${escapeHtml(w.name || '?')}</span>
            </li>`
          )
          .join('')}
      </ul>`;
  }

  /** `tileId` e o id usado em showTile ('me'/'cam-me' pro proprio, peerId ou
   * `cam-${peerId}` pro de um peer). `watchers` e a lista devolvida por
   * mesh.watchersOf, ja carimbada com quem mandou (ver app.js). */
  function setWatchers(tileId, watchers) {
    tileWatchers.set(tileId, watchers || []);
    renderTileWatchers(document.getElementById(`tile-${tileId}`), watchers);
  }

  // Ultimo estado de pausa por tile ({ paused, opts }), pro overlay
  // sobreviver a um tile recriado do zero -- mesmo motivo do tileWatchers
  // acima (renegociacao pode destruir e recriar o <div class="tile"> com o
  // mesmo id).
  const tilePaused = new Map();

  /** Desenha (ou desfaz) o veu de pausa dentro de `tile`. `video` e o
   * elemento do proprio tile -- borrar o ultimo quadro em vez de escurecer
   * pra preto preserva contexto ("ainda e esta transmissao") e evita ler o
   * conteudo parado (ver a spec de 2026-09-03, secao 4). */
  function renderPausedOverlay(tile, video, paused, opts) {
    if (!paused) {
      tile.querySelector('.tile-paused-shot')?.remove();
      tile.querySelector('.tile-paused')?.remove();
      tile.classList.remove('is-paused');
      if (video) {
        video.hidden = false;
        applyPainting(video);
      }
      return;
    }
    if (video && video.videoWidth > 0) {
      // 320px de largura: o blur(20px) do CSS destroi qualquer detalhe
      // acima disso, entao borrar um bitmap reduzido e esticar da o mesmo
      // resultado visual por uma fracao dos pixels (ver spec, secao 4.3).
      const canvas = tile.querySelector('.tile-paused-shot') || document.createElement('canvas');
      canvas.className = 'tile-paused-shot';
      const w = 320;
      const h = Math.round((video.videoHeight / video.videoWidth) * w) || w;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      if (!canvas.isConnected) tile.insertBefore(canvas, tile.firstChild);
    } else {
      // Sem primeiro quadro ainda: pula o bitmap, so o veu escuro + texto.
      tile.querySelector('.tile-paused-shot')?.remove();
    }
    if (video) {
      video.pause();
      video.hidden = true;
    }
    let veil = tile.querySelector('.tile-paused');
    if (!veil) {
      veil = document.createElement('div');
      veil.className = 'tile-paused';
      veil.setAttribute('role', 'status');
      veil.innerHTML = `
        <span class="tile-paused-icon">${PAUSE_ICON}</span>
        <p class="tile-paused-title"></p>
        <p class="tile-paused-subtitle"></p>`;
      tile.appendChild(veil);
    }
    veil.querySelector('.tile-paused-title').textContent = opts?.title || 'Transmissão pausada';
    veil.querySelector('.tile-paused-subtitle').textContent = opts?.subtitle || '';
    tile.classList.add('is-paused');
  }

  /** `tileId` no mesmo espaco de `showTile` ('me'/'cam-me' pro proprio,
   * peerId ou `cam-${peerId}` pro de um peer). `opts` e `{ title, subtitle }`
   * -- o tile local usa um texto diferente do de quem assiste (ver app.js). */
  function setPaused(tileId, paused, opts) {
    tilePaused.set(tileId, { paused, opts });
    const tile = document.getElementById(`tile-${tileId}`);
    if (!tile) return; // tile pode ja ter sido removido (ex: parou de transmitir)
    renderPausedOverlay(tile, tile.querySelector('video'), paused, opts);
  }

  /** Numero de colunas da grade e uma DECISAO por contagem de tiles, nao um
   * resto de divisao do auto-fit -- ver a spec de 2026-09-03, secao 9. O CSS
   * le este data-count; 7+ tiles caem todos no balde 'many'. */
  function syncGridCount() {
    const n = gridEl.querySelectorAll('.tile').length;
    if (!n) gridEl.removeAttribute('data-count');
    else gridEl.dataset.count = n > 6 ? 'many' : String(n);
  }

  function showTile(id, label, stream, { muted = false, avatar = null, kind = null, displayName = null } = {}) {
    gridEl.querySelector('.empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.innerHTML = `
        <video autoplay playsinline></video>
        <canvas class="tile-annot-canvas"></canvas>
        <span class="tile-avatar"></span>
        <span class="tile-kind-badge"></span>
        <span class="tile-label"></span>
        <div class="tile-watchers empty"></div>
        <button class="tile-annot-btn" type="button" title="Rabiscar nesta tela" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        </button>
        <button class="tile-fullscreen-btn" type="button" title="Tela cheia">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
        </button>
        <div class="tile-annot-bar" hidden></div>
        <div class="pip-strip"></div>`;
      tile.addEventListener('dblclick', () => toggleTileFullscreen(tile, id));
      wireTileAnnotations(tile, id);
      tile.querySelector('.tile-fullscreen-btn').addEventListener('click', (event) => {
        event.stopPropagation();
        toggleTileFullscreen(tile, id);
      });
      if (id !== 'me' && id !== 'cam-me') {
        tile.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openTileMenu(id, event.clientX, event.clientY);
        });
      }
      gridEl.appendChild(tile);
      syncGridCount();
      // Tile pode ter sido recriado (ex: renegociacao) depois de ja termos
      // recebido um 'watchers' pra esse id -- sem isto o overlay ficaria
      // vazio ate a proxima mudanca de audiencia.
      renderTileWatchers(tile, tileWatchers.get(id));
      // Mesmo motivo: um tile recriado enquanto pausado nasceria sem o
      // veu, ate a proxima mudanca de estado de pausa.
      const pausedState = tilePaused.get(id);
      if (pausedState?.paused) renderPausedOverlay(tile, tile.querySelector('video'), true, pausedState.opts);
      // E de novo o mesmo motivo, pela ordem inversa: o 'broadcast-state'
      // que diz "esta tela aceita rabisco" chega ANTES da primeira track,
      // entao o setSurface daquele instante nao achou tile pra marcar.
      const annotInfo = annotSurfaces.get(id);
      if (annotInfo) {
        setAnnotSurface(id, { surfaceId: annotInfo.surfaceId, allowed: true, canClearAll: annotInfo.canClearAll });
      }
    }

    const video = tile.querySelector('video');
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    ensureTileAudio(id, video, stream);
    // Ultima coisa a mexer em video.muted -- tem que rodar em TODA chamada
    // (nao so quando o srcObject muda), porque a 2a chamada de showTile pro
    // mesmo peer (audio track chegando separado, ver ensureTileAudio acima)
    // reusa o mesmo objeto de stream e passaria pelo `if` de cima sem entrar
    // nele, deixando o video desmutado se essa linha so rodasse ali dentro.
    video.muted = (id === 'me' || id === 'cam-me') ? muted : true;
    tile.querySelector('.tile-label').textContent = label;
    // O nome pro avatar vem de `displayName` quando existe: o label dos tiles
    // locais e "Voce (previa)"/"Voce (camera)", que daria a inicial "V" em vez
    // da inicial do nome do usuario.
    const avatarName = displayName || label;
    tile.querySelector('.tile-avatar').innerHTML = avatarInnerHtml(displayName || id, avatarName, avatar);
    // Ordena a grade por CSS (`.tile[data-kind="camera"] { order: 1 }`):
    // tela e o conteudo, camera e o acompanhamento.
    if (kind) tile.dataset.kind = kind;
    else delete tile.dataset.kind;
    const badgeEl = tile.querySelector('.tile-kind-badge');
    badgeEl.innerHTML = tileKindIcon(kind);
    if (kind === 'camera') badgeEl.title = 'Câmera';
    else if (kind === 'screen') badgeEl.title = 'Tela';
    else badgeEl.removeAttribute('title');

    // Tile criado enquanto a janela esta oculta nasce pausado (o atributo
    // autoplay do <video> tocaria sozinho, sem isto). Excecao: tile com o
    // veu de pausa ativo -- quem manda no video ali e o overlay, nao a
    // visibilidade da janela (ver renderPausedOverlay).
    if (!tilePaused.get(id)?.paused) applyPainting(video);

    tileRegistry.set(id, { label, stream, avatar, kind, displayName });
  }

  function removeTile(id, emptyMessage) {
    document.getElementById(`tile-${id}`)?.remove();
    // A lousa morre com a tela: parou de compartilhar, o desenho vai junto
    // (spec de 2026-09-04, secao 8) -- e o observador de tamanho tem de
    // soltar o elemento que acabou de sair do DOM.
    releaseTileAnnotations(id);
    syncGridCount();
    releaseTileAudio(id);
    tileRegistry.delete(id);
    tileWatchers.delete(id);
    tilePaused.delete(id);
    pinnedPip.delete(id);
    pipLayout.delete(id);
    if (id === fullscreenTileId) {
      fullscreenTileId = null;
      clearTimeout(fullscreenIdleTimer);
      window.golive.setFullScreen(false);
    } else if (fullscreenTileId) {
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile);
    }
    if (!gridEl.children.length) {
      gridEl.innerHTML = `<div class="empty">${escapeHtml(emptyMessage)}</div>`;
    }
  }

  // ---------- Anotacao na tela (rabisco e escrita) ----------
  //
  // O deposito de itens e a matematica de coordenada moram em annotate.js
  // (puros, testados). Aqui fica o que precisa de DOM: o canvas por cima do
  // video, o ponteiro, a barrinha de ferramentas e o lote de pontos por
  // quadro. Ver a spec de 2026-09-04, secao 5.
  //
  // O que sai daqui pra rede sai por `onAnnotOp`; o que chega da rede entra
  // por `applyAnnotOp`. Os dois passam pelo MESMO `store.apply`, entao nao
  // existe um formato de item "local" e outro "remoto".

  const annotStore = annotate.createStore();
  // tileId -> { surfaceId, canClearAll }. Um tile so esta nesta tabela
  // quando aquela tela aceita anotacao; sair dela e o que apaga a lousa.
  const annotSurfaces = new Map();
  const annotObservers = new Map(); // tileId -> ResizeObserver
  let annotSelfId = 'me'; // id de conexao (o servidor carimba) -- decide a MINHA cor
  let annotDrawingTile = null; // tile com o modo de desenho ligado (so um por vez)
  let annotTool = 'pen';
  let onAnnotOp = null;

  const ANNOT_TOOLS = {
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.51 13a9 9 0 1 0 2.13-9.36L3 7"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  };

  function annotSetSelf(id) {
    annotSelfId = id == null ? 'me' : String(id);
    for (const tileId of annotSurfaces.keys()) syncAnnotBar(tileId);
  }

  /** Liga (ou desliga) a lousa de um tile. `surfaceId` e o dono da tela --
   * a chave da lousa, igual dos dois lados do fio. `allowed: false` desliga
   * tudo e apaga: quem parou de compartilhar levou a lousa junto. */
  function setAnnotSurface(tileId, { surfaceId, allowed, canClearAll = false } = {}) {
    const tile = document.getElementById(`tile-${tileId}`);
    if (!allowed || !surfaceId) {
      if (annotSurfaces.has(tileId)) {
        const old = annotSurfaces.get(tileId);
        annotStore.drop(old.surfaceId);
      }
      annotSurfaces.delete(tileId);
      if (annotDrawingTile === tileId) setAnnotDrawing(tileId, false);
      if (tile) {
        tile.classList.remove('annotatable');
        tile.querySelector('.tile-annot-btn').hidden = true;
        clearAnnotCanvas(tile);
      }
      return;
    }
    annotSurfaces.set(tileId, { surfaceId: String(surfaceId), canClearAll });
    if (!tile) return;
    tile.classList.add('annotatable');
    tile.querySelector('.tile-annot-btn').hidden = false;
    syncAnnotBar(tileId);
    redrawAnnot(tileId);
  }

  function annotSurfaceOf(tileId) {
    return annotSurfaces.get(tileId)?.surfaceId || null;
  }

  /** Aplica uma op vinda da rede. `from` e sempre o carimbo do servidor --
   * e dele que sai a cor, entao ninguem desenha com a cor de outro. */
  function applyAnnotOp(surfaceId, from, op) {
    // `clear all` so vale do dono da tela: o servidor nao guarda estado de
    // anotacao e nao tem como saber disso, entao a checagem e aqui, do
    // mesmo jeito cooperativo do resto do app.
    if (op?.op === 'clear' && op.scope === 'all' && String(from) !== String(surfaceId)) return;
    if (!annotStore.apply(surfaceId, from, op)) return;
    for (const [tileId, info] of annotSurfaces) {
      if (info.surfaceId === String(surfaceId)) {
        redrawAnnot(tileId);
        syncAnnotBar(tileId);
      }
    }
  }

  function loadAnnotSnapshot(surfaceId, items) {
    annotStore.load(surfaceId, items);
    for (const [tileId, info] of annotSurfaces) {
      if (info.surfaceId === String(surfaceId)) redrawAnnot(tileId);
    }
  }

  function annotSnapshot(surfaceId) {
    return annotStore.snapshot(surfaceId);
  }

  /** Manda a op pra rede E aplica localmente. A ordem importa pouco, mas
   * aplicar aqui e o que faz o traco aparecer sem esperar a volta do
   * servidor -- o proprio servidor nao devolve a op pra quem mandou. */
  function emitAnnotOp(tileId, op) {
    const surfaceId = annotSurfaceOf(tileId);
    if (!surfaceId) return;
    applyLocalAnnot(surfaceId, op);
    onAnnotOp?.(surfaceId, op);
  }

  function applyLocalAnnot(surfaceId, op) {
    if (!surfaceId) return; // tile deixou de aceitar anotacao no meio do traco
    if (!annotStore.apply(surfaceId, annotSelfId, op)) return;
    for (const [tileId, info] of annotSurfaces) {
      if (info.surfaceId === String(surfaceId)) {
        redrawAnnot(tileId);
        syncAnnotBar(tileId);
      }
    }
  }

  // ---- desenho ----

  function annotCanvasOf(tile) {
    return tile?.querySelector('.tile-annot-canvas') || null;
  }

  function clearAnnotCanvas(tile) {
    const canvas = annotCanvasOf(tile);
    const ctx = canvas?.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Redesenha a lousa inteira a partir da lista de itens. O canvas nunca e
   * a fonte da verdade -- e por isso que redimensionar a janela, entrar em
   * fullscreen ou receber a tela em outra resolucao nao perde nada. */
  function redrawAnnot(tileId) {
    const tile = document.getElementById(`tile-${tileId}`);
    const canvas = annotCanvasOf(tile);
    const surfaceId = annotSurfaceOf(tileId);
    if (!tile || !canvas || !surfaceId) return;

    const box = tile.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // devicePixelRatio: sem isto o traco fica serrilhado em tela 4K, que e
    // exatamente o publico do app.
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(box.width * dpr);
    const h = Math.round(box.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);

    const video = tile.querySelector('video');
    const rect = annotate.contentRect(video?.videoWidth, video?.videoHeight, box.width, box.height);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.textBaseline = 'top';
    for (const item of annotStore.items(surfaceId)) {
      const cor = annotate.colorFor(item.from);
      if (item.kind === 'stroke') {
        ctx.strokeStyle = cor;
        ctx.lineWidth = item.width;
        // Sombra fraca por baixo: tinta clara sobre video claro (uma janela
        // branca, um documento) sumiria sem um contorno.
        ctx.shadowColor = 'rgba(0,0,0,.55)';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        item.points.forEach(([x, y], i) => {
          const p = annotate.toPx(x, y, rect);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (item.points.length === 1) {
          // Um toque sem arrasto e um ponto, nao nada.
          const p = annotate.toPx(item.points[0][0], item.points[0][1], rect);
          ctx.arc(p.x, p.y, item.width / 2, 0, Math.PI * 2);
          ctx.fillStyle = cor;
          ctx.fill();
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (item.kind === 'text') {
        const p = annotate.toPx(item.x, item.y, rect);
        // O tamanho da fonte acompanha a caixa do video: um texto de 20px
        // numa previa de 320px e um berro; o mesmo texto em fullscreen
        // seria uma formiga. Escala pela altura do conteudo.
        const size = item.size * (rect.height / 540);
        ctx.font = `600 ${Math.max(10, size)}px system-ui, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,.65)';
        ctx.shadowBlur = 4;
        ctx.fillStyle = cor;
        ctx.fillText(item.text, p.x, p.y);
        ctx.shadowBlur = 0;
      }
    }
  }

  /** Liga/desliga o modo de desenho de um tile. Com ele desligado o canvas
   * e `pointer-events: none` -- o duplo clique do fullscreen, o botao
   * direito do mute e o arrasto do PiP continuam funcionando como sempre.
   * E a razao de o modo ser explicito: o tile ja tem quatro gestos, e
   * roubar todos eles pra caneta seria pior que um clique a mais. */
  function setAnnotDrawing(tileId, on) {
    if (on && annotDrawingTile && annotDrawingTile !== tileId) setAnnotDrawing(annotDrawingTile, false);
    const tile = document.getElementById(`tile-${tileId}`);
    if (!tile) return;
    tile.classList.toggle('annot-on', on);
    tile.querySelector('.tile-annot-bar').hidden = !on;
    tile.querySelector('.tile-annot-btn').classList.toggle('active', on);
    annotDrawingTile = on ? tileId : (annotDrawingTile === tileId ? null : annotDrawingTile);
    if (on) syncAnnotBar(tileId);
    else closeAnnotTextInput(tile);
  }

  function syncAnnotBar(tileId) {
    const tile = document.getElementById(`tile-${tileId}`);
    const bar = tile?.querySelector('.tile-annot-bar');
    const surfaceId = annotSurfaceOf(tileId);
    if (!bar || !surfaceId) return;
    const info = annotSurfaces.get(tileId);
    const temMeu = annotStore.hasFrom(surfaceId, annotSelfId);
    bar.innerHTML = `
      <button type="button" class="annot-tool${annotTool === 'pen' ? ' active' : ''}" data-tool="pen" title="Caneta">${ANNOT_TOOLS.pen}</button>
      <button type="button" class="annot-tool${annotTool === 'text' ? ' active' : ''}" data-tool="text" title="Escrever">${ANNOT_TOOLS.text}</button>
      <span class="annot-sep"></span>
      <button type="button" class="annot-tool" data-act="undo" title="Desfazer o meu último"${temMeu ? '' : ' disabled'}>${ANNOT_TOOLS.undo}</button>
      <button type="button" class="annot-tool" data-act="clear-mine" title="Apagar os meus"${temMeu ? '' : ' disabled'}>${ANNOT_TOOLS.clear}</button>
      ${info.canClearAll ? `<button type="button" class="annot-tool warn" data-act="clear-all" title="Apagar tudo (é a sua tela)">${ANNOT_TOOLS.clear}<em>tudo</em></button>` : ''}
      <span class="annot-sep"></span>
      <span class="annot-ink" style="background:${annotate.colorFor(annotSelfId)}" title="Esta é a sua cor"></span>
      <button type="button" class="annot-tool" data-act="off" title="Sair do modo rabisco">${ANNOT_TOOLS.off}</button>`;
  }

  /** Amarra o tile ao sistema de anotacao, uma vez, na criacao dele. Todo
   * o resto e delegado (a barra e remontada a cada mudanca de estado, entao
   * ouvir no container e o que evita religar listener a cada render). */
  function wireTileAnnotations(tile, tileId) {
    const canvas = annotCanvasOf(tile);
    const bar = tile.querySelector('.tile-annot-bar');

    tile.querySelector('.tile-annot-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      setAnnotDrawing(tileId, !tile.classList.contains('annot-on'));
    });

    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn.dataset.tool) {
        annotTool = btn.dataset.tool;
        syncAnnotBar(tileId);
        return;
      }
      switch (btn.dataset.act) {
        case 'undo': emitAnnotOp(tileId, { op: 'undo' }); break;
        case 'clear-mine': emitAnnotOp(tileId, { op: 'clear', scope: 'mine' }); break;
        case 'clear-all': emitAnnotOp(tileId, { op: 'clear', scope: 'all' }); break;
        case 'off': setAnnotDrawing(tileId, false); break;
        default: break;
      }
    });

    // Um traco por vez por tile. `pending` junta os pontos do quadro
    // corrente: um `points` por quadro de animacao, nao um por pointermove
    // (~180 mensagens num traco de 3s viram ~50).
    let stroke = null;
    let pending = [];
    let flushTimer = null;

    function pointOf(event) {
      const box = tile.getBoundingClientRect();
      const video = tile.querySelector('video');
      const rect = annotate.contentRect(video?.videoWidth, video?.videoHeight, box.width, box.height);
      return annotate.toNorm(event.clientX - box.left, event.clientY - box.top, rect);
    }

    /** So MANDA -- nao aplica. O ponto ja foi desenhado localmente no
     * proprio pointermove; aplicar de novo aqui duplicaria cada ponto do
     * traco no proprio deposito de quem esta desenhando. */
    function flush() {
      flushTimer = null;
      if (!stroke || !pending.length) return;
      const points = pending;
      pending = [];
      onAnnotOp?.(annotSurfaceOf(tileId), { op: 'points', id: stroke, points });
    }

    canvas.addEventListener('pointerdown', (event) => {
      if (!tile.classList.contains('annot-on') || event.button !== 0) return;
      event.stopPropagation();
      const p = pointOf(event);
      if (annotTool === 'text') {
        openAnnotTextInput(tile, tileId, p, event);
        return;
      }
      stroke = `${annotSelfId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      canvas.setPointerCapture(event.pointerId);
      emitAnnotOp(tileId, { op: 'begin', id: stroke, x: p.x, y: p.y, width: 4 });
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!stroke) return;
      const p = pointOf(event);
      // Desenha JA, sem esperar o lote: o traco tem de acompanhar o dedo.
      applyLocalAnnot(annotSurfaceOf(tileId), { op: 'points', id: stroke, points: [[p.x, p.y]] });
      // E guarda pro lote que vai pra rede no proximo quadro.
      pending.push([p.x, p.y]);
      if (flushTimer === null) flushTimer = requestAnimationFrame(flush);
    });

    const finish = () => {
      if (!stroke) return;
      if (flushTimer !== null) {
        cancelAnimationFrame(flushTimer);
        flushTimer = null;
      }
      if (pending.length) {
        onAnnotOp?.(annotSurfaceOf(tileId), { op: 'points', id: stroke, points: pending });
        pending = [];
      }
      onAnnotOp?.(annotSurfaceOf(tileId), { op: 'end', id: stroke });
      stroke = null;
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave', finish);

    // O tile muda de tamanho por muitos caminhos (janela, contagem da
    // grade, fullscreen). Um observador cobre todos.
    const observer = new ResizeObserver(() => redrawAnnot(tileId));
    observer.observe(tile);
    annotObservers.set(tileId, observer);
  }

  function releaseTileAnnotations(tileId) {
    annotObservers.get(tileId)?.disconnect();
    annotObservers.delete(tileId);
    const info = annotSurfaces.get(tileId);
    if (info) annotStore.drop(info.surfaceId);
    annotSurfaces.delete(tileId);
    if (annotDrawingTile === tileId) annotDrawingTile = null;
  }

  /** Escrita: um campo de uma linha no ponto clicado. Enter fecha, Esc
   * cancela, clicar fora fecha -- e um rotulo, nao um paragrafo. */
  function openAnnotTextInput(tile, tileId, point, event) {
    closeAnnotTextInput(tile);
    const box = tile.getBoundingClientRect();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'annot-text-input';
    input.maxLength = annotate.MAX_TEXT;
    input.placeholder = 'escreva e dê Enter';
    input.style.left = `${event.clientX - box.left}px`;
    input.style.top = `${event.clientY - box.top}px`;
    input.style.color = annotate.colorFor(annotSelfId);
    tile.appendChild(input);
    input.focus();

    const commit = () => {
      const text = input.value.trim();
      input.remove();
      if (!text) return;
      emitAnnotOp(tileId, {
        op: 'text',
        id: `${annotSelfId}-t-${Date.now().toString(36)}`,
        x: point.x,
        y: point.y,
        text,
        size: 20,
      });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Esc aqui nao pode fechar modal nenhum
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') input.remove();
    });
    input.addEventListener('blur', commit);
  }

  function closeAnnotTextInput(tile) {
    tile?.querySelector('.annot-text-input')?.remove();
  }

  // ---------- PiP (miniaturas dentro do fullscreen) ----------

  let openPipMenuEl = null;

  function closePipMenu() {
    openPipMenuEl?.remove();
    openPipMenuEl = null;
    document.removeEventListener('click', closePipMenu);
  }

  function switchFullscreenFocus(newId) {
    const oldId = fullscreenTileId;
    if (oldId === newId || !tileRegistry.has(newId)) return;
    const newTile = document.getElementById(`tile-${newId}`);
    if (!newTile) return;
    clearFullscreenIdle(document.getElementById(`tile-${oldId}`));
    document.getElementById(`tile-${oldId}`)?.classList.remove('fullscreen');
    newTile.classList.add('fullscreen');
    fullscreenTileId = newId;
    pinnedPip.delete(newId);
    if (oldId) pinnedPip.add(oldId);
    renderPipStrip(newTile);
    scheduleFullscreenIdle(newTile);
  }

  // Posicao/tamanho inicial de uma miniatura que ainda nao foi arrastada --
  // empilha da esquerda pra direita a partir do canto inferior esquerdo
  // (mesmo lugar da antiga faixa fixa), e fica gravado em `pipLayout` daqui
  // pra frente (nao e recalculado a cada render, senao empilhar de novo
  // toda vez que uma miniatura for removida atropelaria posicoes ja
  // arrastadas pelo usuario).
  function ensurePipLayout(id, containerRect, stackIndex) {
    let layout = pipLayout.get(id);
    if (layout) return layout;
    const w = PIP_DEFAULT_W;
    const h = (w * 9) / 16;
    const leftPx = PIP_MARGIN_PX + 56 + stackIndex * (w + 10); // 56 ~= largura do "+" + espaco
    const topPx = containerRect.height - PIP_MARGIN_PX - h;
    layout = {
      x: containerRect.width ? (leftPx / containerRect.width) * 100 : 0,
      y: containerRect.height ? (topPx / containerRect.height) * 100 : 0,
      w,
    };
    pipLayout.set(id, layout);
    return layout;
  }

  function applyPipLayout(wrap, layout) {
    const h = (layout.w * 9) / 16;
    wrap.style.left = `${layout.x}%`;
    wrap.style.top = `${layout.y}%`;
    wrap.style.width = `${layout.w}px`;
    wrap.style.height = `${h}px`;
  }

  function clampPipLayout(layout, containerRect) {
    const h = (layout.w * 9) / 16;
    const maxXPx = Math.max(0, containerRect.width - layout.w);
    const maxYPx = Math.max(0, containerRect.height - h);
    const xPx = Math.min(Math.max((layout.x / 100) * containerRect.width, 0), maxXPx);
    const yPx = Math.min(Math.max((layout.y / 100) * containerRect.height, 0), maxYPx);
    layout.x = containerRect.width ? (xPx / containerRect.width) * 100 : 0;
    layout.y = containerRect.height ? (yPx / containerRect.height) * 100 : 0;
  }

  function buildPipThumb(id, containerRect, stackIndex) {
    const entry = tileRegistry.get(id);
    const layout = ensurePipLayout(id, containerRect, stackIndex);
    clampPipLayout(layout, containerRect);

    const wrap = document.createElement('div');
    wrap.className = 'pip-thumb';
    applyPipLayout(wrap, layout);

    const video = document.createElement('video');
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = entry.stream;
    wrap.appendChild(video);

    const avatarEl = document.createElement('span');
    avatarEl.className = 'pip-thumb-avatar';
    avatarEl.innerHTML = avatarInnerHtml(entry.displayName || id, entry.displayName || entry.label, entry.avatar);
    wrap.appendChild(avatarEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'pip-thumb-remove';
    removeBtn.title = 'Remover miniatura';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      pinnedPip.delete(id);
      pipLayout.delete(id);
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile);
    });
    wrap.appendChild(removeBtn);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'pip-thumb-resize';
    resizeHandle.title = 'Redimensionar';
    wrap.appendChild(resizeHandle);

    // Arrasto vs clique: clicar na miniatura troca o foco do fullscreen
    // (switchFullscreenFocus), mas isso so deve valer se o ponteiro nao se
    // moveu -- senao todo arrasto pra mover a miniatura terminaria trocando
    // de tela junto.
    const DRAG_THRESHOLD_PX = 4;

    function startDrag(event, onMove, onClick) {
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      wrap.setPointerCapture(pointerId);

      function onPointerMove(moveEvent) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) moved = true;
        onMove(dx, dy, moveEvent);
      }
      function onPointerUp() {
        wrap.releasePointerCapture(pointerId);
        wrap.removeEventListener('pointermove', onPointerMove);
        wrap.removeEventListener('pointerup', onPointerUp);
        wrap.removeEventListener('pointercancel', onPointerUp);
        if (!moved) onClick?.();
      }
      wrap.addEventListener('pointermove', onPointerMove);
      wrap.addEventListener('pointerup', onPointerUp);
      wrap.addEventListener('pointercancel', onPointerUp);
    }

    wrap.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const strip = wrap.parentElement;
      const startXPct = layout.x;
      const startYPct = layout.y;
      startDrag(
        event,
        (dx, dy) => {
          const rect = strip.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          layout.x = startXPct + (dx / rect.width) * 100;
          layout.y = startYPct + (dy / rect.height) * 100;
          clampPipLayout(layout, rect);
          applyPipLayout(wrap, layout);
        },
        () => switchFullscreenFocus(id)
      );
    });

    resizeHandle.addEventListener('pointerdown', (event) => {
      const strip = wrap.parentElement;
      const startW = layout.w;
      startDrag(event, (dx) => {
        const rect = strip.getBoundingClientRect();
        const maxW = rect.width * PIP_MAX_W_RATIO;
        layout.w = Math.min(Math.max(startW + dx, PIP_MIN_W), Math.max(PIP_MIN_W, maxW));
        clampPipLayout(layout, rect);
        applyPipLayout(wrap, layout);
      });
    });

    return wrap;
  }

  function openPipPicker(anchorBtn, fullscreenId) {
    closePipMenu();
    const rect = anchorBtn.getBoundingClientRect();
    const candidates = Array.from(tileRegistry.entries()).filter(
      ([id]) => id !== fullscreenId && !pinnedPip.has(id)
    );

    const menu = document.createElement('div');
    menu.className = 'pip-picker';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.top}px`;

    if (!candidates.length) {
      menu.innerHTML = '<div class="pip-picker-empty">ninguém mais pra mostrar</div>';
    } else {
      for (const [id, entry] of candidates) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'pip-picker-item';
        item.innerHTML = `
          <span class="pip-picker-avatar">${avatarInnerHtml(entry.displayName || id, entry.displayName || entry.label, entry.avatar)}</span>
          <span>${escapeHtml(entry.label)}</span>`;
        item.addEventListener('click', (event) => {
          event.stopPropagation();
          pinnedPip.add(id);
          closePipMenu();
          const fsTile = document.getElementById(`tile-${fullscreenId}`);
          if (fsTile) renderPipStrip(fsTile);
        });
        menu.appendChild(item);
      }
    }

    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    openPipMenuEl = menu;
    setTimeout(() => document.addEventListener('click', closePipMenu), 0);
  }

  function renderPipStrip(tile) {
    const strip = tile.querySelector('.pip-strip');
    if (!strip) return;
    const id = tile.id.slice('tile-'.length);
    strip.innerHTML = '';
    const containerRect = tile.getBoundingClientRect();
    let stackIndex = 0;
    for (const pinnedId of pinnedPip) {
      if (pinnedId === id || !tileRegistry.has(pinnedId)) continue;
      strip.appendChild(buildPipThumb(pinnedId, containerRect, stackIndex));
      stackIndex++;
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pip-add-btn';
    addBtn.title = 'Adicionar miniatura';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openPipPicker(addBtn, id);
    });
    strip.appendChild(addBtn);
  }

  let openMenuEl = null;

  function closeTileMenu() {
    openMenuEl?.remove();
    openMenuEl = null;
    document.removeEventListener('click', closeTileMenu);
  }

  /** Menu de contexto do tile: o que e sobre AQUELA TELA -- silenciar e
   * volume, os dois locais (GainNode, sem passar pelo servidor).
   *
   * O cabecalho com nome e avatar nao e enfeite: "Silenciar" saiu do menu ⋮
   * do membro (2026-09-04, secao 3.2) e este virou o unico lugar onde se
   * silencia alguem. Sem dizer de QUEM e o menu, a resposta pra "silenciar
   * quem?" so viria depois do clique. */
  function openTileMenu(id, x, y) {
    closeTileMenu();
    const state = getOrCreateAudioState(id);
    const entry = tileRegistry.get(id);
    const nome = entry?.displayName || entry?.label || 'esta tela';

    const menu = document.createElement('div');
    menu.className = 'tile-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.innerHTML = `
      <div class="tile-menu-head">
        <span class="tile-menu-avatar">${avatarInnerHtml(entry?.displayName || id, nome, entry?.avatar || null)}</span>
        <span class="tile-menu-name" title="${escapeHtml(nome)}">${escapeHtml(nome)}</span>
      </div>
      <label class="check compact tile-menu-mute-row">
        <input type="checkbox" class="tile-menu-mute" ${isMuted(id) ? 'checked' : ''} />
        <span class="check-box"><svg class="check-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="check-text"><span class="check-title">Silenciar</span></span>
      </label>
      <label class="tile-menu-volume">
        <span>Volume: <b class="tile-menu-volume-label">${Math.round(state.volume * 100)}%</b></span>
        <input type="range" min="0" max="200" step="1" value="${Math.round(state.volume * 100)}" />
      </label>`;
    menu.addEventListener('click', (event) => event.stopPropagation());
    document.body.appendChild(menu);
    openMenuEl = menu;

    function applyGain() {
      if (state.gain) state.gain.gain.value = state.muted ? 0 : state.volume;
    }

    const muteCheckbox = menu.querySelector('.tile-menu-mute');
    muteCheckbox.addEventListener('change', () => {
      // setMuted (e nao `state.muted = ...`) pra que exista UM caminho de
      // codigo pra silenciar, agora que este e o unico lugar da UI que o
      // oferece.
      setMuted(id, muteCheckbox.checked);
    });

    const range = menu.querySelector('input[type=range]');
    const volumeLabel = menu.querySelector('.tile-menu-volume-label');
    range.addEventListener('input', () => {
      state.volume = Number(range.value) / 100;
      volumeLabel.textContent = `${range.value}%`;
      applyGain();
    });

    // Bubble phase (nao capture): o listener de `click` do proprio menu, que
    // chama stopPropagation, roda ANTES desse e impede que ele chegue aqui
    // quando o clique foi dentro do menu (botao de mute, slider). Em fase de
    // captura isso nao funcionaria -- stopPropagation na fase de bolha nao
    // afeta um listener de captura no document, que ja teria rodado antes.
    setTimeout(() => document.addEventListener('click', closeTileMenu), 0);
  }

  // Tons neutros com um traco de matiz, nao as seis cores saturadas do
  // Discord que estavam aqui antes. O avatar diz QUEM, nao O QUE ESTA
  // ACONTECENDO -- e neste tema cor saturada quer dizer uma coisa so:
  // alguem esta ao vivo. Continua dando pra distinguir as pessoas de
  // relance, sem competir com o unico sinal que importa.
  const AVATAR_PALETTE = ['#3a4152', '#453c4e', '#4a3f39', '#38474a', '#444a38', '#4c3a41'];

  function avatarColorFor(id) {
    const str = String(id);
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  // Mesmo fallback (foto ou iniciais sobre cor gerada) usado em `buildMemberRow`
  // e nos avatares de tile/PiP -- centralizado aqui pra nao divergir.
  function avatarInnerHtml(id, name, avatar) {
    const initial = escapeHtml((name || '?').trim().charAt(0).toUpperCase() || '?');
    return avatar
      ? `<img src="${escapeHtml(avatar)}" alt="" />`
      : `<span class="peer-avatar-fallback" style="background:${avatarColorFor(id)}">${initial}</span>`;
  }

  const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
  const CAMERA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
  const PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;

  // Badge no canto do tile indicando se aquele stream e tela compartilhada
  // ou camera -- necessario pra diferenciar quando o mesmo peer compartilha
  // as duas coisas ao mesmo tempo (ver ids `cam-<peerId>` vs `<peerId>` em
  // app.js).
  // Retorna so o <svg>: o elemento `.tile-kind-badge` ja existe no tile e este
  // html vai pra dentro dele (envolver num segundo span aninhava dois badges
  // absolutos, deixando a bolinha de fora vazia e o icone deslocado).
  function tileKindIcon(kind) {
    if (kind === 'camera') return CAMERA_ICON;
    if (kind === 'screen') return SHARE_ICON;
    return '';
  }

  // ---------- Lobby: lista de salas ----------

  const roomListLiveEl = $('room-list-live');
  const roomsCountEl = $('rooms-count');
  const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const CONNECT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`;
  const CONNECTED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
  const ANTENNA_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/><path d="M7.76 16.24a6 6 0 0 1 0-8.48"/><path d="M16.24 7.76a6 6 0 0 1 0 8.48"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><circle cx="12" cy="12" r="1.6"/></svg>`;

  function fillRoomList(listEl, rooms, { onSelect, activeAddress, isOnCooldown, appVersion }) {
    listEl.innerHTML = '';
    if (!rooms.length) {
      const empty = document.createElement('li');
      empty.className = 'rooms-empty';
      empty.innerHTML = `
        ${ANTENNA_ICON}
        <span class="rooms-empty-title">Nenhuma sala aberta na rede agora</span>
        <span class="rooms-empty-hint">Crie uma sala aqui do lado, ou entre por endereço — quem criou pode ter deixado o anúncio desligado.</span>`;
      listEl.appendChild(empty);
      return;
    }
    for (const room of rooms) {
      const isActive = activeAddress && room.address === activeAddress;
      const onCooldown = !isActive && !!isOnCooldown && isOnCooldown(room.address);
      // Trava de versao: a sala so aceita quem estiver na MESMA versao (o
      // servidor recusa o 'join'). O beacon traz a versao de quem hospeda,
      // entao da pra dizer isso aqui, antes do clique, em vez de deixar a
      // pessoa conectar e voltar com um erro. Beacon sem versao (release
      // antiga anunciando) nao e marcado -- a recusa vem do servidor.
      const incompatible = !isActive && !!appVersion && !!room.version && !version.same(appVersion, room.version);
      const name = room.name || room.hostName || 'sala';
      const li = document.createElement('li');
      li.className = 'room-row';
      if (isActive) li.classList.add('active');
      if (incompatible) li.classList.add('incompatible');

      const meta = room.peers != null
        ? `${room.address} · ${room.peers} ${room.peers === 1 ? 'pessoa' : 'pessoas'}`
        : room.address;

      const versionNote = incompatible
        ? version.mismatchText({ mine: appVersion, theirs: room.version })
        : '';

      const info = document.createElement('div');
      info.className = 'room-info';
      info.innerHTML = `
        <span class="room-badge" style="background:${avatarColorFor(room.address)}">${escapeHtml(name.trim().charAt(0) || '?')}</span>
        <span class="room-item-text">
          <span class="room-name-line">
            ${room.protected ? `<span class="room-lock" title="Precisa de PIN">${LOCK_ICON}</span>` : ''}
            <span class="room-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            ${incompatible ? `<span class="room-version" title="${escapeHtml(versionNote)}">${escapeHtml(version.mismatchBadge({ mine: appVersion, theirs: room.version }))}</span>` : ''}
          </span>
          <span class="room-meta" title="${escapeHtml(incompatible ? versionNote : meta)}">${escapeHtml(incompatible ? versionNote : meta)}</span>
        </span>`;
      li.appendChild(info);

      const connectBtn = document.createElement('button');
      connectBtn.className = 'room-connect secondary';
      connectBtn.type = 'button';
      connectBtn.title = isActive ? 'Já conectado nessa sala'
        : incompatible ? versionNote
        : `Entrar em ${name}`;
      connectBtn.disabled = isActive || onCooldown || incompatible;
      if (onCooldown) connectBtn.classList.add('cooldown');
      connectBtn.innerHTML = isActive
        ? `${CONNECTED_ICON}<span>Conectado</span>`
        : `${CONNECT_ICON}<span>Entrar</span>`;
      li.appendChild(connectBtn);

      // O card inteiro e a porta; o botao e o reforco visual. Um so
      // caminho de codigo, pra nao existir "clicou no card" diferente de
      // "clicou no botao".
      if (!connectBtn.disabled) {
        li.classList.add('clickable');
        li.addEventListener('click', () => onSelect(room));
      }

      listEl.appendChild(li);
    }
  }

  // `liveRooms` = salas descobertas agora mesmo via broadcast UDP na LAN
  // (src/main/discovery.js) — nao ha historico local salvo em disco, so
  // "isso esta aberto agora"; a lista some sozinha quando o beacon para de
  // chegar.
  function renderRooms({ onSelect, activeAddress, liveRooms = [], isOnCooldown, appVersion = null }) {
    fillRoomList(roomListLiveEl, liveRooms, { onSelect, activeAddress, isOnCooldown, appVersion });
    roomsCountEl.textContent = String(liveRooms.length);
    roomsCountEl.classList.toggle('empty', liveRooms.length === 0);
  }

  // ---------- Lobby: endereco desta maquina na rede ----------

  const NET_LABELS = { radmin: 'Radmin VPN', tailscale: 'Tailscale', lan: 'Rede local' };

  /** `info` e o { address, kind } do IPC network:address, ou null. Tres
   * estados: rede virtual (verde), so LAN (amarelo), nada (cinza). */
  function renderNetworkStatus(info) {
    const dot = $('lobby-net-dot');
    const kindEl = $('lobby-net-kind');
    const addrEl = $('lobby-net-addr');
    if (!dot || !kindEl || !addrEl) return;
    // Ponto neutro quando esta tudo certo: --live (vermelho) e reservado a
    // "alguem esta ao vivo", e uma bolinha vermelha aqui ainda leria como
    // erro. So o que exige atencao ganha cor.
    dot.classList.remove('warn');
    addrEl.removeAttribute('title');
    if (!info) {
      dot.classList.add('warn');
      kindEl.textContent = 'Sem rede detectada';
      addrEl.textContent = 'ligue o Radmin ou o Tailscale e atualize';
      return;
    }
    if (info.kind === 'lan') dot.classList.add('warn');
    kindEl.textContent = NET_LABELS[info.kind] || 'Rede';
    addrEl.textContent = info.address;
    addrEl.title = info.iface ? `${info.address} (${info.iface})` : info.address;
  }

  // ---------- Dialogo: Criar sala ----------
  const dlgCreateEl = $('dialog-create-room');
  const btnCreateConfirmEl = $('btn-create-room-confirm');
  const btnCreateCancelEl = $('btn-create-room-cancel');
  let onCreateConfirm = null;
  let creatingRoom = false;

  /** Estado ocupado do "Criar": subir o servidor embutido inclui pedir
   * liberacao de firewall ao Windows, que pode abrir um prompt de elevacao
   * e demorar segundos. O Cancelar tambem desabilita -- nao ha o que
   * cancelar no meio do room:host, e um botao que finge cancelar e pior
   * que um desabilitado. */
  function setCreateRoomBusy(busy) {
    creatingRoom = busy;
    btnCreateConfirmEl.disabled = busy;
    btnCreateCancelEl.disabled = busy;
    btnCreateConfirmEl.classList.toggle('busy', busy);
    btnCreateConfirmEl.querySelector('.btn-spinner').classList.toggle('hidden', !busy);
    btnCreateConfirmEl.querySelector('.btn-label').textContent = busy ? 'Criando sala…' : 'Criar';
    $('chk-protect-room').disabled = busy;
    $('chk-advertise-room').disabled = busy;
  }

  function openCreateRoom({ onConfirm, advertise = true }) {
    $('create-room-error').textContent = '';
    $('chk-protect-room').checked = false;
    // Ultima escolha do usuario (persistida no config) vira o padrao.
    $('chk-advertise-room').checked = advertise !== false;
    setCreateRoomBusy(false);
    onCreateConfirm = onConfirm;
    dlgCreateEl.classList.remove('hidden');
    // focusFirstInteractive guarda o foco anterior (pro restore no close),
    // mas o primeiro focavel aqui e a caixa "anunciar" -- e as duas ja vem
    // com um padrao razoavel. O foco vai pro "Criar": Enter cria a sala.
    focusFirstInteractive(dlgCreateEl);
    btnCreateConfirmEl.focus();
  }
  function closeCreateRoom() {
    setCreateRoomBusy(false);
    dlgCreateEl.classList.add('hidden');
    restoreFocusAfterModal();
    onCreateConfirm = null;
  }
  function setCreateRoomError(text) {
    $('create-room-error').textContent = text || '';
  }
  btnCreateCancelEl.addEventListener('click', () => { if (!creatingRoom) closeCreateRoom(); });
  btnCreateConfirmEl.addEventListener('click', async () => {
    if (creatingRoom || !onCreateConfirm) return;
    const handler = onCreateConfirm;
    setCreateRoomBusy(true);
    try {
      await handler({
        protect: $('chk-protect-room').checked,
        advertise: $('chk-advertise-room').checked,
      });
    } finally {
      // closeCreateRoom ja zerou o estado quando deu certo; quando deu
      // erro o dialogo continua aberto e precisa voltar a ser usavel.
      if (!dlgCreateEl.classList.contains('hidden')) setCreateRoomBusy(false);
    }
  });
  dlgCreateEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !creatingRoom) closeCreateRoom(); });

  // ---------- Dialogo: Entrar numa sala ----------
  const dlgJoinEl = $('dialog-join-room');
  let onJoinConnect = null;

  function openJoinRoom({ onConnect, address, showPinField = false }) {
    $('setup-error').textContent = '';
    $('in-server').value = address || '';
    $('in-pin').value = '';
    $('join-pin-field').classList.toggle('hidden', !showPinField);
    onJoinConnect = onConnect;
    dlgJoinEl.classList.remove('hidden');
    focusFirstInteractive(dlgJoinEl);
  }
  function closeJoinRoom() {
    dlgJoinEl.classList.add('hidden');
    restoreFocusAfterModal();
    onJoinConnect = null;
  }
  function setJoinRoomPinVisible(visible) {
    $('join-pin-field').classList.toggle('hidden', !visible);
  }
  $('btn-join-room-cancel').addEventListener('click', closeJoinRoom);
  $('btn-connect').addEventListener('click', () => {
    onJoinConnect?.({ address: $('in-server').value.trim(), pin: $('in-pin').value.trim() || null });
  });
  dlgJoinEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeJoinRoom(); });

  // ---------- Lista de membros / moderacao ----------

  const peerListEl = $('peer-list');
  const memberMenuEl = $('member-menu');

  function closeMemberMenu() {
    memberMenuEl.classList.add('hidden');
    memberMenuEl.innerHTML = '';
  }
  document.addEventListener('click', (e) => {
    if (!memberMenuEl.contains(e.target) && !e.target.closest('.member-menu-btn')) closeMemberMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMemberMenu(); });

  const MODERATE_ICONS = {
    'stop-share': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="2" x2="22" y2="18"/></svg>',
    'transfer-owner': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l4.5 4L12 5l4.5 6L21 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
  };

  /** Abre o menu do membro `id` ancorado no botao clicado.
   *
   * Este menu e SO sobre a pessoa na sala: moderar. "Silenciar" saiu daqui
   * (2026-09-04, secao 3) -- ele e local, so meu, e so faz sentido sobre uma
   * TELA; mora no botao direito do tile, junto do volume, onde sempre
   * esteve. E "Parar transmissão" so aparece pra quem esta ao vivo AGORA:
   * pedir pra parar uma transmissao que nao existe e um item que nao faz
   * nada.
   *
   * Todo item daqui passa pelo servidor, entao todo item chama `onModerate`.
   * Quem nao e dono nao chega ate aqui -- `buildMemberRow` nem desenha o
   * botao ⋮ (menu sem item nao abre). */
  function openMemberMenu(btn, id, name, { live = false, targetIsOwner = false, onModerate } = {}) {
    const rect = btn.getBoundingClientRect();
    memberMenuEl.innerHTML = `
      ${live ? `<div class="member-menu-item warn" role="menuitem" data-action="stop-share">${MODERATE_ICONS['stop-share']} Parar transmissão</div>` : ''}
      ${targetIsOwner ? '' : `<div class="member-menu-item" role="menuitem" data-action="transfer-owner">${MODERATE_ICONS['transfer-owner']} Passar a liderança</div>`}
      ${live || !targetIsOwner ? '<div class="member-menu-sep"></div>' : ''}
      <div class="member-menu-item" role="menuitem" data-action="kick">${MODERATE_ICONS.kick} Expulsar da sala</div>
      <div class="member-menu-item danger" role="menuitem" data-action="ban">${MODERATE_ICONS.ban} Banir da sala</div>
      <div class="member-menu-hint">Expulso pode voltar. Banido não, enquanto a sala existir.</div>
    `;
    memberMenuEl.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
    memberMenuEl.style.top = `${rect.bottom + 4}px`;
    memberMenuEl.classList.remove('hidden');
    for (const item of memberMenuEl.querySelectorAll('[data-action]')) {
      item.addEventListener('click', () => {
        onModerate?.(item.dataset.action, id, name);
        closeMemberMenu();
      });
    }
    memberMenuEl.querySelector('[role="menuitem"]')?.focus();
  }

  // `live` liga `.peer-avatar.on` (anel --live via box-shadow, o unico sinal
  // saturado do tema). Sem anel no estado normal -- "conectado" e "ao vivo"
  // sao a mesma afirmacao neste tema.
  function buildMemberRow({ id, name, avatar, live, isSelf, pulsing, qualityTag, isOwner, canModerate, onModerate }) {
    // O ⋮ so existe quando ha o que fazer: pra quem nao e dono da sala, o
    // menu inteiro ficou vazio quando "Silenciar" saiu dele, e um botao que
    // abre um menu vazio e pior do que botao nenhum.
    const showMenu = !isSelf && canModerate;
    const li = document.createElement('li');
    if (isSelf) li.classList.add('self');
    li.innerHTML = `
      <span class="peer-avatar-wrap">
        <span class="peer-avatar${live ? ' on' : ''}" style="background:${avatarColorFor(id)}">${avatarInnerHtml(id, name, avatar)}</span>
      </span>
      <span class="peer-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      ${isSelf ? '<span class="peer-you-tag">você</span>' : ''}
      ${isOwner ? '<span class="peer-crown" title="Dono da sala">♛</span>' : ''}
      ${qualityTag ? `<span class="member-quality-tag">${escapeHtml(qualityTag)}</span>` : ''}
      ${live
        ? `<span class="peer-live-badge live-pulse${pulsing ? ' pulsing' : ''}" title="Compartilhando tela">${SHARE_ICON}<em>AO VIVO</em></span>`
        : ''
      }
      ${showMenu ? `<button class="member-menu-btn" type="button" aria-label="Moderar ${escapeHtml(name)}">⋮</button>` : ''}
    `;
    if (showMenu) {
      li.querySelector('.member-menu-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openMemberMenu(e.currentTarget, id, name, { live, targetIsOwner: isOwner, onModerate });
      });
    }
    return li;
  }

  function renderMembers(peers, self, qualityTags, { ownerId, myId, onModerate } = {}) {
    peerListEl.innerHTML = '';
    if (!self && !peers.size) {
      peerListEl.innerHTML = '<li class="muted">você não está em nenhuma sala</li>';
      return;
    }
    let pulseTaken = false;
    const claimPulse = (live) => {
      if (!live || pulseTaken) return false;
      pulseTaken = true;
      return true;
    };
    const iAmOwner = ownerId != null && myId != null && ownerId === myId;

    if (self) {
      peerListEl.appendChild(
        buildMemberRow({
          id: 'me',
          name: self.name || 'anônimo',
          avatar: self.avatar,
          live: self.live,
          isSelf: true,
          pulsing: claimPulse(self.live),
          isOwner: iAmOwner,
        })
      );
    }
    for (const peer of peers.values()) {
      peerListEl.appendChild(
        buildMemberRow({
          id: peer.id,
          name: peer.name,
          avatar: peer.avatar,
          live: peer.live,
          pulsing: claimPulse(peer.live),
          qualityTag: qualityTags?.get(peer.id) || '',
          isOwner: ownerId != null && peer.id === ownerId,
          canModerate: iAmOwner,
          onModerate,
        })
      );
    }
  }

  // ---------- Banidos ----------
  const bannedSectionEl = $('banned-section');
  const bannedListEl = $('banned-list');

  function renderBanned(list, { onUnban } = {}) {
    bannedSectionEl.classList.toggle('hidden', !list || !list.length);
    bannedListEl.innerHTML = '';
    for (const entry of list || []) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="peer-avatar" style="background:${avatarColorFor(entry.key)}">${avatarInnerHtml(entry.key, entry.name, null)}</span>
        <span class="peer-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
        <button class="banned-readmit" type="button">Readmitir</button>
      `;
      li.querySelector('.banned-readmit').addEventListener('click', () => onUnban?.(entry.key));
      bannedListEl.appendChild(li);
    }
  }

  // ---------- Chat ----------
  const chatMessagesEl = $('chat-messages');
  const chatComposeEl = $('chat-compose');
  const chatInputEl = $('chat-input');
  const chatCountEl = $('chat-input-count');
  const chatOfflineBarEl = $('chat-offline-bar');
  let lastChatAuthorId = null; // pra saber quando agrupar (mesmo autor em sequencia)
  let onChatSend = null;

  const SYSTEM_ICONS = {
    join: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    'stop-share': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="2" x2="22" y2="18"/></svg>',
    kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/></svg>',
    ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
    unban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };
  const SYSTEM_LABELS = {
    join: (actor) => `${actor} entrou`,
    leave: (actor) => `${actor} saiu`,
    'stop-share': (actor, target) => `${actor} parou a transmissão de ${target}`,
    kick: (actor, target) => `${actor} expulsou ${target}`,
    ban: (actor, target) => `${actor} baniu ${target}`,
    unban: (actor, target) => `${actor} readmitiu ${target}`,
  };
  const SYSTEM_TONE = { 'stop-share': 'warn', kick: 'danger', ban: 'danger' };

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function appendSystemLine(entry) {
    const div = document.createElement('div');
    const tone = SYSTEM_TONE[entry.event] || '';
    div.className = `chat-sys${tone ? ` ${tone}` : ''}`;
    const label = SYSTEM_LABELS[entry.event]?.(entry.actor, entry.target) || entry.event;
    div.innerHTML = `${SYSTEM_ICONS[entry.event] || ''} ${escapeHtml(label)}`;
    chatMessagesEl.appendChild(div);
    lastChatAuthorId = null; // proxima mensagem de texto nao agrupa com o que veio antes de uma linha de sistema
  }

  /** Miniatura de imagem da linha do chat. As dimensoes viajam na mensagem
   * (ver o servidor), entao a caixa ja nasce com a altura certa e a lista
   * nao "pula" quando o bitmap decodifica.
   *
   * `src` sempre vem de um data URL validado (chatmedia.isImageDataUrl) --
   * o atributo e montado com o valor cru de proposito: escapar um data URL
   * o quebraria, e a validacao ja garantiu que ele nao e outra coisa. */
  function chatImageHtml(entry) {
    if (!chatmedia.isImageDataUrl(entry.image)) return '';
    const box = chatmedia.thumbBox(entry.w, entry.h);
    const dims = box ? ` style="width:${box.w}px;height:${box.h}px"` : '';
    return `<button class="chat-image" type="button" title="Ver em tela cheia"${dims}><img src="${entry.image}" alt="imagem enviada por ${escapeHtml(entry.name)}" /></button>`;
  }

  function appendMessage(entry) {
    const grouped = lastChatAuthorId === entry.from;
    lastChatAuthorId = entry.from;
    const div = document.createElement('div');
    div.className = `chat-line${grouped ? ' grouped' : ''}`;
    div.innerHTML = `
      <span class="chat-avatar-slot">${grouped ? '' : `<span class="chat-avatar" style="background:${avatarColorFor(entry.from)}">${avatarInnerHtml(entry.from, entry.name, entry.avatar || null)}</span>`}</span>
      <span class="chat-body">
        ${grouped ? '' : `<span class="chat-head"><span class="chat-author">${escapeHtml(entry.name)}</span><span class="chat-time">${formatTime(entry.ts)}</span></span>`}
        ${entry.text ? `<span class="chat-text">${escapeHtml(entry.text)}</span>` : ''}
        ${chatImageHtml(entry)}
      </span>
    `;
    const imgBtn = div.querySelector('.chat-image');
    if (imgBtn) imgBtn.addEventListener('click', () => openImageLightbox(entry.image));
    chatMessagesEl.appendChild(div);
  }

  // ---------- Imagem em tela cheia ----------
  const lightboxEl = $('image-lightbox');
  const lightboxImgEl = $('image-lightbox-img');

  function openImageLightbox(src) {
    lightboxImgEl.src = src;
    lightboxEl.classList.remove('hidden');
    lastFocusedBeforeModal = document.activeElement;
    $('image-lightbox-close').focus();
  }
  function closeImageLightbox() {
    lightboxEl.classList.add('hidden');
    // `src=''` e o que solta o bitmap: sem isso a imagem aberta por ultimo
    // fica decodificada na memoria enquanto o app estiver aberto.
    lightboxImgEl.src = '';
    restoreFocusAfterModal();
  }
  $('image-lightbox-close').addEventListener('click', closeImageLightbox);
  lightboxEl.addEventListener('click', (e) => { if (e.target !== lightboxImgEl) closeImageLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !lightboxEl.classList.contains('hidden')) closeImageLightbox();
  });

  function appendEntry(entry) {
    if (entry.system) appendSystemLine(entry);
    else appendMessage(entry);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function append(entry) {
    appendEntry(entry);
  }

  function setHistory(entries) {
    chatMessagesEl.innerHTML = '';
    lastChatAuthorId = null;
    for (const entry of entries || []) appendEntry(entry);
  }

  function setEnabled(enabled) {
    chatInputEl.disabled = !enabled;
    chatComposeEl.classList.toggle('disabled', !enabled);
    chatOfflineBarEl.classList.toggle('hidden', enabled);
  }

  // ---------- Anexo de imagem (previa antes de mandar) ----------
  //
  // A imagem escolhida espera aqui ate a pessoa mandar, em vez de sair
  // sozinha: colar imagem por engano e comum e o chat nao tem apagar (spec
  // de 2026-09-04, secao 6.1). Ela pode ir com legenda, ou sozinha.
  const attachmentEl = $('chat-attachment');
  const attachmentImgEl = $('chat-attachment-img');
  const attachmentInfoEl = $('chat-attachment-info');
  let pendingAttachment = null; // { dataUrl, w, h, label } | null
  let onChatPickImage = null;

  function setAttachment(att) {
    pendingAttachment = att || null;
    if (!pendingAttachment) {
      attachmentEl.classList.add('hidden');
      attachmentImgEl.src = '';
      return;
    }
    attachmentImgEl.src = pendingAttachment.dataUrl;
    attachmentInfoEl.textContent = pendingAttachment.label || '';
    attachmentEl.classList.remove('hidden');
    chatInputEl.focus();
  }
  function clearAttachment() {
    setAttachment(null);
  }
  $('chat-attachment-remove').addEventListener('click', clearAttachment);

  function sendCurrentInput() {
    const text = chatInputEl.value.trim();
    if (!text && !pendingAttachment) return;
    onChatSend?.(text, pendingAttachment);
    chatInputEl.value = '';
    chatCountEl.classList.add('hidden');
    clearAttachment();
  }

  /** Passa o arquivo pro app.js reduzir e devolver via setAttachment. O
   * primeiro arquivo so: mandar cinco imagens de uma vez estouraria a cota
   * de rajada do servidor e ninguem entenderia por que so tres chegaram. */
  function offerFiles(files) {
    const file = Array.from(files || []).find((f) => chatmedia.isAcceptedType(f.type));
    if (file) onChatPickImage?.(file);
  }

  function render({ onSend, onPickImage, getEmojiRecents, onEmojiUsed }) {
    onChatSend = onSend;
    onChatPickImage = onPickImage;
    initEmojiPanel({ getEmojiRecents, onEmojiUsed });
    // #chat-compose e um <form> sem action -- um submit acidental (Enter num
    // futuro <input>, extensao) navegaria o renderer pra file://.../?. Corta.
    chatComposeEl.addEventListener('submit', (e) => e.preventDefault());
    chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput();
      }
    });
    chatInputEl.addEventListener('input', () => {
      const len = chatInputEl.value.length;
      chatCountEl.textContent = `${len}/500`;
      chatCountEl.classList.toggle('hidden', len < 400);
    });

    // Colar (Ctrl+V): print de tela vem como `image/png` nos itens da area
    // de transferencia. Sem preventDefault -- colar TEXTO tem de continuar
    // funcionando; so intercepta quando ha imagem de fato.
    chatInputEl.addEventListener('paste', (e) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (!files.some((f) => chatmedia.isAcceptedType(f.type))) return;
      e.preventDefault();
      offerFiles(files);
    });

    // Arrastar em cima da coluna do chat.
    const dropZone = chatMessagesEl.closest('.chat-section') || chatMessagesEl;
    dropZone.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
      e.preventDefault();
      dropZone.classList.add('dropping');
    });
    dropZone.addEventListener('dragleave', (e) => {
      if (e.target === dropZone) dropZone.classList.remove('dropping');
    });
    dropZone.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      dropZone.classList.remove('dropping');
      offerFiles(e.dataTransfer.files);
    });

    const fileInput = $('chat-file');
    $('btn-chat-attach').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      offerFiles(fileInput.files);
      fileInput.value = ''; // escolher a MESMA imagem duas vezes seguidas tem de disparar o change de novo
    });
  }

  // ---------- Painel de emoji ----------

  const emojiPanelEl = $('emoji-panel');
  const emojiListEl = $('emoji-list');
  const emojiTabsEl = $('emoji-tabs');
  const emojiSearchEl = $('emoji-search-input');
  const emojiBtnEl = $('btn-chat-emoji');
  let emojiGroup = 'recentes';
  let emojiDeps = { getEmojiRecents: () => [], onEmojiUsed: () => {} };

  function initEmojiPanel(deps) {
    emojiDeps = { getEmojiRecents: () => [], onEmojiUsed: () => {}, ...deps };
    emojiTabsEl.innerHTML = [
      { id: 'recentes', icon: '🕐', label: 'Recentes' },
      ...emoji.GROUPS.map((g) => ({ id: g.id, icon: g.icon, label: g.label })),
    ]
      .map((t) => `<button type="button" class="emoji-tab" data-group="${t.id}" title="${escapeHtml(t.label)}" aria-label="${escapeHtml(t.label)}">${t.icon}</button>`)
      .join('');
    emojiTabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.emoji-tab');
      if (!tab) return;
      emojiGroup = tab.dataset.group;
      emojiSearchEl.value = '';
      renderEmojiList();
    });
    emojiSearchEl.addEventListener('input', renderEmojiList);
    emojiBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (emojiPanelEl.classList.contains('hidden')) openEmojiPanel();
      else closeEmojiPanel();
    });
    emojiPanelEl.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => closeEmojiPanel());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !emojiPanelEl.classList.contains('hidden')) {
        closeEmojiPanel();
        chatInputEl.focus();
      }
    });
  }

  function renderEmojiList() {
    const query = emojiSearchEl.value.trim();
    let chars;
    let vazio = '';
    if (query) {
      chars = emoji.search(query);
      vazio = 'nenhum emoji com esse nome';
    } else if (emojiGroup === 'recentes') {
      chars = emoji.loadRecents(emojiDeps.getEmojiRecents());
      vazio = 'os que você usar aparecem aqui';
    } else {
      chars = (emoji.GROUPS.find((g) => g.id === emojiGroup)?.items || []).map(([c]) => c);
    }
    for (const tab of emojiTabsEl.children) {
      const ativo = !query && tab.dataset.group === emojiGroup;
      tab.classList.toggle('active', ativo);
    }
    emojiListEl.innerHTML = chars.length
      ? chars.map((c) => `<button type="button" class="emoji-item" data-emoji="${c}" title="${escapeHtml(emoji.labelFor(c))}">${c}</button>`).join('')
      : `<p class="emoji-empty">${vazio}</p>`;
  }

  function openEmojiPanel() {
    // Ancorado ACIMA do compose, alinhado a direita do botao -- o painel tem
    // altura fixa, entao da pra posicionar sem medir o conteudo.
    const rect = emojiBtnEl.getBoundingClientRect();
    emojiSearchEl.value = '';
    emojiGroup = emoji.loadRecents(emojiDeps.getEmojiRecents()).length ? 'recentes' : emoji.GROUPS[0].id;
    renderEmojiList();
    emojiPanelEl.classList.remove('hidden');
    const width = emojiPanelEl.offsetWidth;
    const height = emojiPanelEl.offsetHeight;
    emojiPanelEl.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`;
    emojiPanelEl.style.top = `${Math.max(8, rect.top - height - 8)}px`;
    emojiBtnEl.setAttribute('aria-expanded', 'true');
    emojiSearchEl.focus();
  }

  function closeEmojiPanel() {
    emojiPanelEl.classList.add('hidden');
    emojiBtnEl.setAttribute('aria-expanded', 'false');
  }

  emojiListEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji-item');
    if (!btn) return;
    insertAtCursor(chatInputEl, btn.dataset.emoji);
    emojiDeps.onEmojiUsed?.(btn.dataset.emoji);
    // O painel NAO fecha: mandar tres emoji seguidos e o caso comum, e
    // reabrir a cada um seria trabalho pra quem so queria "😂😂😂".
    if (emojiGroup === 'recentes' && !emojiSearchEl.value.trim()) renderEmojiList();
  });

  /** Insere no CURSOR, nao no fim: quem parou no meio da frase pra pegar um
   * emoji espera que ele caia onde o cursor estava. Mantem o desfazer do
   * campo funcionando via execCommand quando disponivel. */
  function insertAtCursor(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.focus();
    input.setSelectionRange(start, end);
    if (!document.execCommand?.('insertText', false, text)) {
      input.value = input.value.slice(0, start) + text + input.value.slice(end);
      input.setSelectionRange(start + text.length, start + text.length);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- Cabecalho da sala ----------

  const lobbyViewEl = $('lobby-view');
  const roomViewEl = $('room-view');

  function setStageStatus({ level, label }) {
    const dot = $('stage-status-dot');
    const badge = $('stage-status-badge');
    dot.dataset.level = level;
    if (label) {
      badge.textContent = label;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
      badge.textContent = ''; // sem texto morto por tras do .hidden
    }
  }

  function setStageHeader({ name, address, pin }) {
    $('stage-header').classList.remove('hidden');
    $('stage-room-name').textContent = name;
    $('stage-room-address').textContent = address || '';
    const pinEl = $('stage-room-pin');
    if (pin) {
      pinEl.textContent = `🔒 PIN ${pin}`;
      pinEl.classList.remove('hidden');
    } else {
      pinEl.classList.add('hidden');
    }
    // Troca de tela: Lobby fora, Sala dentro -- unico ponto de alternancia
    // entre as duas (ver a spec, secao 5). clearStageHeader faz o inverso.
    lobbyViewEl.classList.add('hidden');
    roomViewEl.classList.remove('hidden');
  }

  function clearStageHeader() {
    $('stage-header').classList.add('hidden');
    $('stage-room-name').textContent = '';
    $('stage-room-address').textContent = '';
    $('stage-room-pin').classList.add('hidden');
    $('stage-status-badge').classList.add('hidden');
    roomViewEl.classList.add('hidden');
    lobbyViewEl.classList.remove('hidden');
  }

  // ---------- Modal de Configuracoes ----------

  const settingsModalEl = $('settings-modal');
  const settingsCatButtons = Array.from(document.querySelectorAll('.settings-cat'));
  const settingsPanes = {
    profile: $('settings-profile'),
    appearance: $('settings-appearance'),
    voice: $('settings-voice'),
    stats: $('settings-stats'),
  };

  // Indicador deslizante (motion #8). O CSS desenha UM retangulo em
  // ::before/::after e o JS so escreve onde ele fica; a transicao acontece
  // em `transform`, nunca em `top`/`left`.
  //
  // `animate` = false na abertura do modal: sem isso o indicador desliza
  // sozinho da posicao anterior toda vez que o dialogo abre, o que e
  // movimento sem acao do usuario -- justamente o anti-padrao.
  function moveIndicator(container, active, axis, animate = true) {
    if (!container) return;
    if (!active) {
      container.style.setProperty(axis === 'y' ? '--nav-ind-o' : '--tab-ind-o', '0');
      return;
    }
    const prev = container.style.transition;
    if (!animate) container.style.transition = 'none';
    if (axis === 'y') {
      container.style.setProperty('--nav-ind-y', `${active.offsetTop}px`);
      container.style.setProperty('--nav-ind-h', `${active.offsetHeight}px`);
      container.style.setProperty('--nav-ind-o', '1');
    } else {
      container.style.setProperty('--tab-ind-x', `${active.offsetLeft}px`);
      // Sem unidade: e um fator de scaleX sobre uma barra de 1px, nao uma
      // largura -- animar `width` seria animar layout (ver o CSS).
      container.style.setProperty('--tab-ind-w', String(active.offsetWidth));
      container.style.setProperty('--tab-ind-o', '1');
    }
    if (!animate) {
      void container.offsetWidth; // força o layout antes de devolver a transicao
      container.style.transition = prev;
    }
  }

  const settingsNavEl = document.querySelector('.settings-nav');

  function syncSettingsIndicator(animate = true) {
    moveIndicator(settingsNavEl, settingsCatButtons.find((b) => b.classList.contains('active')), 'y', animate);
  }

  settingsCatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      settingsCatButtons.forEach((b) => b.classList.toggle('active', b === btn));
      Object.entries(settingsPanes).forEach(([cat, pane]) =>
        pane.classList.toggle('hidden', cat !== btn.dataset.cat)
      );
      syncSettingsIndicator();
    });
  });

  $('btn-close-settings').addEventListener('click', closeSettings);
  settingsModalEl.addEventListener('click', (event) => {
    if (event.target === settingsModalEl) closeSettings();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !settingsModalEl.classList.contains('hidden')) closeSettings();
  });

  // Preview de camera do modal de Configuracoes. E independente da "camera
  // ao vivo" gerida em app.js (botao da barra lateral) — abre sua propria
  // captura so pra mostrar aqui, e precisa ser parada ao fechar o modal,
  // senao a luz da webcam fica acesa com o modal fechado.
  let settingsCameraPreviewStream = null;

  function stopSettingsCameraPreview() {
    if (!settingsCameraPreviewStream) return;
    settingsCameraPreviewStream.getTracks().forEach((t) => t.stop());
    settingsCameraPreviewStream = null;
    const video = $('settings-camera-preview');
    if (video) video.srcObject = null;
  }

  async function startSettingsCameraPreview(deviceId) {
    stopSettingsCameraPreview();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      });
      // o modal pode ter fechado (ou o dispositivo pode ter mudado de novo)
      // enquanto aguardavamos a permissao/captura
      if (settingsModalEl.classList.contains('hidden')) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      settingsCameraPreviewStream = stream;
      const video = $('settings-camera-preview');
      if (video) video.srcObject = stream;
    } catch {
      /* permissao negada ou sem camera disponivel, preview fica preto */
    }
  }

  function closeSettings() {
    settingsModalEl.classList.add('hidden');
    restoreFocusAfterModal();
    stopSettingsCameraPreview();
  }

  // Gestao de foco dos modais (§5.6). Antes nao havia nenhuma: abrir um
  // dialogo deixava o foco no botao que ficou escondido atras do overlay,
  // entao um Tab levava pra tras da caixa em vez de pra dentro dela.
  const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  let lastFocusedBeforeModal = null;

  function focusFirstInteractive(modalEl) {
    lastFocusedBeforeModal = document.activeElement;
    modalEl.querySelector(FOCUSABLE)?.focus();
  }

  function restoreFocusAfterModal() {
    lastFocusedBeforeModal?.focus?.();
    lastFocusedBeforeModal = null;
  }

  function bandwidthLine(quality) {
    const screenMbps = quality.bitrate / 1_000_000;
    // Virgula: a linha inteira e em portugues, e "2.5 Mbps" no meio dela
    // era o unico numero do app com ponto decimal.
    const texto = screenMbps.toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return `≈${texto} Mbps por espectador enquanto você estiver transmitindo`;
  }

  /** Linha de resumo do seletor de qualidade: o custo exato da combinacao
   * escolhida, mais a nota da ponta quando existe. E a UNICA coisa a ler
   * pra saber o preco -- os dois controles acima so dizem o que foi
   * escolhido. */
  function bandwidthLineHtml(quality) {
    const nota = QUALITY_PRESET_NOTE[quality.preset];
    const base = escapeHtml(bandwidthLine(quality));
    return nota ? `${base} <span class="quality-bandwidth-note">· ${escapeHtml(nota)}</span>` : base;
  }

  // Preview do avatar/apelido dentro do modal (aba Perfil) -- espelha o
  // mesmo estado que o painel do rodapé mostra, atualizado nos dois
  // lugares junto (ver deps.onNameChange/onAvatarChange).
  function renderProfilePreview(config) {
    const img = $('settings-profile-avatar-img');
    const fallback = $('settings-profile-avatar-fallback');
    const nameInput = $('settings-profile-name');
    if (!img || !fallback || !nameInput) return;
    if (config.avatar) {
      img.src = config.avatar;
      img.classList.remove('hidden');
      fallback.textContent = '';
    } else {
      img.classList.add('hidden');
      img.src = '';
      fallback.textContent = (config.name || '?').trim().charAt(0).toUpperCase() || '?';
    }
    if (document.activeElement !== nameInput) nameInput.value = config.name || '';
  }

  // Ordem de exibicao dos cartoes de predefinicao (spec 2026-09-03, 5.2):
  // do escuro neutro ao unico claro. Array explicito, nao
  // Object.keys(theme.PRESETS) -- ainda que coincidam hoje, a ordem de
  // exibicao nao deveria depender da ordem de insercao de theme.js.
  const THEME_PRESET_ORDER = ['signal', 'midnight', 'carvao', 'amber', 'forest', 'paper'];

  /** Um cartao por predefinicao: o app EM MINIATURA, com as cores daquela
   * predefinicao aplicadas inline -- nao um quadrado solido com o nome
   * escrito (spec 2026-09-03, 5.6), e nao mais a rampa de cinco faixas que
   * havia aqui: num tema escuro as cinco superficies sao quase o mesmo
   * preto, e a rampa lia como um retangulo vazio. A miniatura mostra a
   * mesma coisa (a escada de superficies) DENTRO da forma do app, entao a
   * diferenca aparece como o olho vai encontra-la depois: barra, palco,
   * coluna e o botao de acao.
   *
   * Cores inline, nao `var(--...)`: as variaveis do tema sao globais, e
   * aqui sao seis temas na tela ao mesmo tempo. */
  function renderThemePresetCard(id, activeId) {
    const preset = theme.PRESETS[id];
    const s = preset.surfaces;
    const active = id === activeId;
    return `
      <button type="button" class="theme-preset-card${active ? ' active' : ''}" data-preset="${id}" aria-pressed="${active}">
        <span class="theme-preset-mini" style="background:${s.bg}">
          <span class="tpm-top" style="background:${s.s1};border-color:${s.line2}">
            <i style="background:${preset.act}"></i>
            <b style="background:${s.s3}"></b>
            <u style="background:var(--live)"></u>
          </span>
          <span class="tpm-body">
            <span class="tpm-stage" style="background:${s.s2}"></span>
            <span class="tpm-side">
              <b style="background:${s.s3}"></b>
              <b style="background:${s.s3}"></b>
              <span class="tpm-cta" style="background:${preset.act}"></span>
            </span>
          </span>
        </span>
        <span class="theme-preset-label">${escapeHtml(preset.label)}</span>
      </button>`;
  }

  function renderThemePresets(activeId) {
    $('theme-presets').innerHTML = THEME_PRESET_ORDER.map((id) => renderThemePresetCard(id, activeId)).join('');
  }

  /** Qual cartao de predefinicao esta marcado agora. A cor de acao e um
   * acento POR CIMA de uma predefinicao -- nunca um estado sem predefinicao
   * nenhuma --, entao sempre ha uma resposta; 'signal' e a rede de seguranca
   * se o DOM ainda nao foi montado. */
  function selectedThemePreset() {
    const card = $('theme-presets')?.querySelector('.theme-preset-card.active');
    return card?.dataset.preset || 'signal';
  }

  /** Le a cor de acao, valida e aplica ao vivo. E chamada a cada evento
   * `input` (nunca so `change`) -- a pessoa precisa ver o app mudando
   * enquanto arrasta o seletor de cor, que e o unico jeito de avaliar um
   * tema (spec 5.6). Aplica MESMO quando a validacao reprova -- o aviso
   * abaixo do controle e que carrega a reprovacao, a aplicacao ao vivo
   * continua sendo o feedback principal.
   *
   * O cartao da predefinicao CONTINUA marcado: trocar o acento nao tira a
   * pessoa do conjunto fechado, so troca a cor de acao dentro dele. Isso
   * mudou quando os sliders de superficie sairam -- antes, mexer em
   * qualquer controle daqui significava sair de todos os presets. */
  function applyCustomThemeFromControls(deps) {
    const themeCfg = { preset: selectedThemePreset(), act: $('theme-act').value };
    const result = theme.validate(theme.tokensFor(themeCfg));
    deps.onThemeChange(themeCfg);

    const warningEl = $('theme-warning');
    warningEl.textContent = '';
    if (result.ok) return;

    warningEl.append(result.failures[0]);
    if (result.nearestAct) {
      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'theme-warning-fix';
      fixBtn.textContent = `usar ${result.nearestAct}`;
      fixBtn.addEventListener('click', () => {
        $('theme-act').value = result.nearestAct;
        applyCustomThemeFromControls(deps);
      });
      warningEl.append(' ', fixBtn);
    }
  }

  /** Inicializa a aba Aparencia a partir de `cfg.theme`. Sempre ha um cartao
   * marcado; o seletor de cor nasce no `act` salvo, ou no do proprio preset
   * quando nao ha acento proprio.
   *
   * Um `custom` legado (config salvo quando ainda dava pra mexer nas
   * superficies) nao tem mais controle que o represente: os cartoes caem no
   * padrao e o seletor mostra o acento salvo. O tema em uso so muda quando a
   * pessoa mexer em alguma coisa -- abrir as Configuracoes nao repinta nada. */
  function initThemeControls(config) {
    const themeCfg = (config && config.theme) || { preset: 'signal' };
    const knownPreset = theme.PRESETS[themeCfg.preset] ? themeCfg.preset : 'signal';

    renderThemePresets(knownPreset);
    $('theme-act').value = isHexColor(themeCfg.act) ? themeCfg.act : theme.PRESETS[knownPreset].act;
    $('theme-warning').textContent = '';
  }

  function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  async function openSettings(config, deps) {
    settingsPanes.profile.innerHTML = `
      <h3>Perfil</h3>
      <div class="settings-field settings-profile-field">
        <button id="settings-profile-avatar" class="user-avatar user-avatar-lg" type="button" title="Alterar foto de perfil">
          <img id="settings-profile-avatar-img" class="hidden" alt="" />
          <span id="settings-profile-avatar-fallback"></span>
        </button>
        <input id="settings-profile-avatar-input" type="file" accept="image/*" class="hidden" />
      </div>
      <div class="settings-field">
        <label for="settings-profile-name">Apelido</label>
        <input id="settings-profile-name" type="text" placeholder="seu apelido" spellcheck="false" />
      </div>`;

    // A previa e um pedaco de sala DE MENTIRA montado com os mesmos tokens
    // do tema (`var(--s1)`, `var(--act)`, `var(--live)`...). Como theme.apply
    // escreve esses tokens no `:root`, ela muda sozinha enquanto a pessoa
    // arrasta o slider -- sem uma linha de codigo pra sincroniza-la. E a
    // resposta pra "o que essa barrinha faz, afinal?".
    settingsPanes.appearance.innerHTML = `
      <h3>Prévia</h3>
      <div class="theme-preview" aria-hidden="true">
        <div class="theme-preview-app">
          <div class="theme-preview-top">
            <span class="theme-preview-badge">GL</span>
            <span class="theme-preview-title">GoLive LAN</span>
            <span class="theme-preview-dot"></span>
          </div>
          <div class="theme-preview-body">
            <div class="theme-preview-stage">
              <span class="theme-preview-live">● AO VIVO</span>
            </div>
            <div class="theme-preview-side">
              <span class="theme-preview-row"><i class="theme-preview-av"></i><b></b></span>
              <span class="theme-preview-row"><i class="theme-preview-av"></i><b class="short"></b></span>
              <span class="theme-preview-msg"></span>
              <span class="theme-preview-msg short"></span>
              <span class="theme-preview-cta">Compartilhar tela</span>
            </div>
          </div>
        </div>
        <ul class="theme-legend">
          <li><span class="theme-legend-chip" style="background:var(--bg)"></span>fundo</li>
          <li><span class="theme-legend-chip" style="background:var(--s2)"></span>painéis</li>
          <li><span class="theme-legend-chip" style="background:var(--act)"></span>ação</li>
          <li><span class="theme-legend-chip" style="background:var(--live)"></span>ao vivo</li>
        </ul>
      </div>

      <h3>Predefinições</h3>
      <div id="theme-presets" class="theme-presets"></div>

      <h3>Personalizar</h3>
      <div class="settings-field">
        <label for="theme-act">Cor de ação</label>
        <p class="settings-hint">Botão principal, foco do teclado e seleção. O vermelho de "ao vivo" e o âmbar de aviso não mudam — eles significam uma coisa só.</p>
        <input id="theme-act" type="color" value="#4F46E5" aria-describedby="theme-warning" />
      </div>
      <p id="theme-warning" class="hint" role="alert"></p>
      <div class="settings-actions">
        <button id="btn-theme-reset" type="button" class="ghost small">Voltar ao padrão</button>
      </div>`;

    settingsPanes.voice.innerHTML = `
      <h3>Câmera</h3>
      <div class="settings-field">
        <label for="settings-camera-device">Dispositivo</label>
        <select id="settings-camera-device"></select>
      </div>
      <div class="settings-field">
        <video id="settings-camera-preview" autoplay playsinline muted></video>
      </div>
      <h3>Sons</h3>
      <div class="check-group">
        <label class="check">
          <input id="settings-sounds" type="checkbox" />
          <span class="check-box"><svg class="check-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>
          <span class="check-text">
            <span class="check-title">Sons do app</span>
            <span class="check-desc">Entrada, saída, chat, transmissão começando e avisos de moderação.</span>
          </span>
        </label>
      </div>`;

    settingsPanes.stats.innerHTML = `
      <div id="settings-stats-body" class="stats"></div>
      <div class="settings-field">
        <button id="btn-open-logs" type="button" class="ghost small">Abrir pasta de logs</button>
        <small>Pra mandar pra quem for investigar um problema.</small>
      </div>`;

    renderProfilePreview(config);
    $('settings-sounds').checked = config.soundsEnabled;

    $('settings-profile-name').addEventListener('input', (event) => {
      deps.onNameChange(event.target.value);
      // So o fallback (iniciais) depende do nome -- so precisa re-renderizar
      // se nao houver avatar de foto; renderProfilePreview ja preserva o
      // valor do proprio input enquanto ele esta focado.
      if (!deps.getConfig().avatar) renderProfilePreview(deps.getConfig());
    });
    $('settings-profile-avatar').addEventListener('click', () => $('settings-profile-avatar-input').click());
    $('settings-profile-avatar-input').addEventListener('change', async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      await deps.onAvatarChange(file);
      renderProfilePreview(deps.getConfig());
    });

    $('settings-sounds').addEventListener('change', () => {
      deps.onSoundsChange($('settings-sounds').checked);
    });

    initThemeControls(config);
    $('theme-presets').addEventListener('click', (event) => {
      const card = event.target.closest('.theme-preset-card');
      if (!card) return;
      Array.from($('theme-presets').children).forEach((c) => {
        c.classList.toggle('active', c === card);
        c.setAttribute('aria-pressed', String(c === card));
      });
      $('theme-warning').textContent = '';
      // Trocar de predefinicao ZERA o acento proprio: cada preset foi
      // desenhado com o seu, e carregar o acento antigo pro novo entregaria
      // uma combinacao que ninguem escolheu. O seletor de cor acompanha.
      $('theme-act').value = theme.PRESETS[card.dataset.preset].act;
      deps.onThemeChange({ preset: card.dataset.preset });
    });
    $('theme-act').addEventListener('input', () => applyCustomThemeFromControls(deps));

    // Voltar ao padrao: aplica o tema de fabrica E devolve os controles pro
    // estado inicial. Sem o initThemeControls, o seletor de cor continuaria
    // na posicao antiga -- mostrando um tema que nao e mais o que esta no ar.
    $('btn-theme-reset').addEventListener('click', () => {
      const padrao = { preset: configApi.DEFAULTS.theme.preset };
      deps.onThemeChange(padrao);
      initThemeControls({ theme: padrao });
    });

    $('btn-open-logs').addEventListener('click', () => window.golive.openLogsFolder());

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameraSelect = $('settings-camera-device');
      for (const d of devices.filter((d) => d.kind === 'videoinput')) {
        cameraSelect.add(new Option(d.label || 'Câmera', d.deviceId));
      }
      if (config.camera.deviceId) cameraSelect.value = config.camera.deviceId;
      cameraSelect.addEventListener('change', () => {
        deps.onCameraDeviceChange(cameraSelect.value);
        // trata a propria rejeicao internamente (preview preto); o void e a
        // marca de que a solta e deliberada, nao um esquecimento
        void startSettingsCameraPreview(cameraSelect.value);
      });
    } catch {
      /* sem permissao de midia ainda, dropdowns ficam vazios */
    }

    settingsModalEl.classList.remove('hidden');
    // Sem animar: o indicador aparece ja no lugar em vez de deslizar sozinho
    // toda vez que o dialogo abre. offsetTop/offsetHeight so valem depois de
    // o modal sair de display:none, dai a leitura ser aqui.
    syncSettingsIndicator(false);
    focusFirstInteractive(settingsModalEl);
    void startSettingsCameraPreview($('settings-camera-device').value);
  }

  function setStatsHtml(html) {
    const body = $('settings-stats-body');
    if (body) body.innerHTML = html;
  }

  // ---------- Dialogo de compartilhar ----------

  const pickerEl = $('picker');
  const pickerGridEl = $('picker-grid');
  const pickerTabsEl = $('picker-tabs');
  const pickerWindowHintEl = $('picker-window-hint');
  const pickerQualityEl = $('picker-quality');
  const pickerQualityBandwidthEl = $('picker-quality-bandwidth');
  const shareSoundEl = $('share-sound');
  const shareDiscordRowEl = $('share-discord-row');
  const shareDiscordEl = $('share-discord');
  const btnGoLiveEl = $('btn-go-live');
  let selectedSourceId = null;
  // Preenchido a cada abertura do dialogo (ver openPicker) -- guardado aqui
  // porque o listener de 'change' do select e registrado uma unica vez, fora
  // de openPicker (o elemento e estatico, so o callback de destino muda).
  let pickerOnQualityChange = null;

  // Os seis presets sao uma matriz 3x2 (resolucao x fps) sem celula morta,
  // entao o controle tem dois eixos em vez de seis quadrados: a grade de
  // tres colunas quebrava a linha no meio do 1080p e escondia justamente a
  // ordem crescente que a pessoa precisa ver. Ver a spec
  // docs/superpowers/specs/2026-09-03-seletor-de-qualidade-em-dois-eixos-design.md
  //
  // Cada trilha e um radiogroup PROPRIO: os eixos sao independentes, e seta
  // so anda dentro do proprio eixo (Tab e quem troca de eixo).
  const QUALITY_AXES = [
    { axis: 'resolution', label: 'Resolução', values: configApi.QUALITY_RESOLUTIONS, text: (v) => v },
    { axis: 'fps', label: 'Fluidez', values: configApi.QUALITY_FPS, text: (v) => `${v} fps` },
  ];

  pickerQualityEl.innerHTML = QUALITY_AXES.map(({ axis, label, values, text }) => {
    const labelId = `quality-axis-${axis}-label`;
    const opcoes = values.map((valor) => (
      `<button class="quality-seg-opt" type="button" role="radio" aria-checked="false" tabindex="-1" data-value="${escapeHtml(valor)}">${escapeHtml(text(valor))}</button>`
    )).join('');
    return `<div class="quality-axis">
      <span class="quality-axis-label" id="${labelId}">${escapeHtml(label)}</span>
      <div class="quality-seg" role="radiogroup" aria-labelledby="${labelId}" data-axis="${axis}" style="--seg-count: ${values.length}">${opcoes}</div>
    </div>`;
  }).join('');

  /** Posiciona os dois polegares e o roving tabindex. O polegar desliza por
   * `--seg-index` (indice da opcao na trilha) -- o CSS resolve a distancia
   * sozinho, entao nao ha medicao de layout aqui. */
  function syncQualityAxes(preset, animate = true) {
    const eixos = configApi.presetAxes(preset);
    for (const trilha of pickerQualityEl.querySelectorAll('.quality-seg')) {
      if (!animate) trilha.classList.add('no-move');
      const alvo = String(eixos[trilha.dataset.axis]);
      const opcoes = [...trilha.querySelectorAll('.quality-seg-opt')];
      const i = opcoes.findIndex((o) => o.dataset.value === alvo);
      trilha.style.setProperty('--seg-index', String(Math.max(0, i)));
      opcoes.forEach((opcao, j) => {
        const on = j === i;
        opcao.classList.toggle('selected', on);
        opcao.setAttribute('aria-checked', on ? 'true' : 'false');
        // Uma so opcao tabulavel por trilha: dentro de um radiogroup a
        // navegacao entre opcoes e por seta, nao por Tab.
        opcao.tabIndex = on ? 0 : -1;
      });
      if (!animate) {
        void trilha.offsetWidth; // força o layout antes de devolver a transicao
        trilha.classList.remove('no-move');
      }
    }
  }

  /** Preset atual lido dos dois polegares -- a UI e a fonte da verdade
   * entre um clique e outro (o config so e atualizado pelo callback). */
  function currentQualityPreset() {
    const escolhido = {};
    for (const trilha of pickerQualityEl.querySelectorAll('.quality-seg')) {
      escolhido[trilha.dataset.axis] = trilha.querySelector('.quality-seg-opt.selected')?.dataset.value;
    }
    return configApi.presetFor(escolhido.resolution, Number(escolhido.fps));
  }

  function selectQualityPreset(preset) {
    const quality = configApi.qualityFromPreset(preset);
    const mudou = quality.preset !== currentQualityPreset();
    syncQualityAxes(quality.preset);
    pickerQualityBandwidthEl.innerHTML = bandwidthLineHtml(quality);
    // Seta parada na ponta e clique no que ja estava escolhido nao sao
    // mudanca. Sem esta guarda cada um dos dois dispararia o
    // applyLiveQuality() do app -- renegociar o encoder pra chegar no
    // mesmo lugar, com a transmissao no ar.
    if (mudou) pickerOnQualityChange?.(quality);
  }

  /** Troca UM eixo e mantem o outro. */
  function selectQualityAxis(axis, valor) {
    const eixos = configApi.presetAxes(currentQualityPreset());
    eixos[axis] = axis === 'fps' ? Number(valor) : valor;
    selectQualityPreset(configApi.presetFor(eixos.resolution, eixos.fps));
  }

  pickerQualityEl.addEventListener('click', (event) => {
    const opcao = event.target.closest('.quality-seg-opt');
    if (opcao) selectQualityAxis(opcao.closest('.quality-seg').dataset.axis, opcao.dataset.value);
  });
  pickerQualityEl.addEventListener('keydown', (event) => {
    const trilha = event.target.closest('.quality-seg');
    if (!trilha) return;
    const opcoes = [...trilha.querySelectorAll('.quality-seg-opt')];
    const i = opcoes.findIndex((o) => o.classList.contains('selected'));
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    // Setas PARAM nas pontas em vez de dar a volta: numa escada ordenada,
    // "de 1440p pra direita" nao existe, e pular pro 720p desfaz exatamente
    // a ordem que este controle existe pra mostrar.
    let destino = null;
    if (step) destino = Math.min(opcoes.length - 1, Math.max(0, Math.max(0, i) + step));
    else if (event.key === 'Home') destino = 0;
    else if (event.key === 'End') destino = opcoes.length - 1;
    if (destino === null) return;
    event.preventDefault();
    selectQualityAxis(trilha.dataset.axis, opcoes[destino].dataset.value);
    trilha.querySelector('.quality-seg-opt.selected')?.focus();
  });
  let pickerSources = [];
  let pickerTab = 'screen';
  // Um lote por aba: enquanto a busca daquela aba nao voltou, a grade mostra
  // "procurando..." em vez de "nenhuma janela encontrada" (que seria mentira).
  let pickerLoading = { screen: false, window: false };
  // Invalida respostas de uma abertura anterior do dialogo que so chegaram
  // depois do usuario fechar e abrir de novo.
  let pickerRun = 0;

  /** Tag curta da qualidade de uma TELA, derivada da altura em pixels do
   * display. Janela nao tem: o desktopCapturer nao devolve tamanho de
   * janela, e inventar um numero seria pior que nao mostrar nada. */
  function qualityTagFor(source) {
    if (!source.isScreen) return '';
    const h = Number(source.height) || 0;
    if (h >= 2160) return '4K';
    if (h >= 1440) return '1440p';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    return h > 0 ? 'SD' : '';
  }

  // Ordem previsivel em vez da ordem em que o Chromium devolveu: telas por
  // nome com comparacao numerica ("Tela 10" depois de "Tela 2", nao antes),
  // janelas em alfabetica insensivel a caixa.
  const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  function sortSources(list) {
    return [...list].sort((a, b) => collator.compare(a.name || '', b.name || ''));
  }

  function syncPickerCounts() {
    const telas = pickerSources.filter((s) => s.isScreen).length;
    const janelas = pickerSources.length - telas;
    $('picker-count-screen').textContent = pickerLoading.screen ? '' : String(telas);
    $('picker-count-window').textContent = pickerLoading.window ? '' : String(janelas);
  }

  function renderPickerGrid() {
    pickerGridEl.innerHTML = '';
    syncPickerCounts();
    const filtered = sortSources(pickerSources.filter((s) => (pickerTab === 'screen' ? s.isScreen : !s.isScreen)));
    if (!filtered.length) {
      if (pickerLoading[pickerTab]) {
        pickerGridEl.innerHTML = `<div class="picker-grid-empty">${
          pickerTab === 'screen' ? 'procurando telas…' : 'procurando janelas…'
        }</div>`;
        return;
      }
      pickerGridEl.innerHTML = `<div class="picker-grid-empty">${
        pickerTab === 'screen' ? 'nenhuma tela encontrada' : 'nenhuma janela encontrada'
      }</div>`;
      return;
    }
    for (const source of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'source-card';
      card.classList.toggle('selected', source.id === selectedSourceId);
      const tag = qualityTagFor(source);
      card.title = source.name;
      card.innerHTML = `
        <span class="source-thumb">
          <img class="source-shot" src="${source.thumbnail}" alt="" />
          ${tag ? `<span class="source-quality">${escapeHtml(tag)}</span>` : ''}
        </span>
        <span class="source-body">
          ${source.appIcon ? `<img class="source-icon" src="${source.appIcon}" alt="" />` : ''}
          <span class="source-text">
            <span class="source-name">${escapeHtml(source.name)}</span>
            <span class="source-meta">${source.isScreen ? 'Tela' : 'Janela'}${
              source.resolution ? ` &middot; ${escapeHtml(source.resolution)}` : ''
            }</span>
          </span>
        </span>`;
      card.addEventListener('click', () => {
        selectedSourceId = source.id;
        btnGoLiveEl.disabled = false;
        pickerGridEl.querySelectorAll('.source-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      pickerGridEl.appendChild(card);
    }
  }

  pickerTabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.picker-tab');
    if (!btn || btn.classList.contains('active')) return;
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    pickerTab = btn.dataset.tab;
    syncPickerIndicator();
    syncWindowHint();
    renderPickerGrid();
  });

  function syncPickerIndicator(animate = true) {
    moveIndicator(pickerTabsEl, pickerTabsEl.querySelector('.picker-tab.active'), 'x', animate);
  }

  // sources:list captura e codifica em PNG uma miniatura de CADA janela
  // aberta -- um pico de trabalho no instante exato em que a pessoa vai
  // transmitir, ou seja, com o jogo aberto. Por isso roda uma vez por
  // abertura do dialogo (trocar de aba nao recarrega: renderPickerGrid
  // filtra a lista ja em memoria) e so repete quando o usuario pede.
  // Ver a spec de 2026-08-23, F1.6.
  function loadPickerSources() {
    const run = ++pickerRun;
    pickerSources = [];
    pickerLoading = { screen: true, window: true };
    renderPickerGrid();

    // Telas primeiro (sao poucas e rapidas, e e a aba que abre selecionada);
    // as janelas, que sao a parte cara, chegam depois sem segurar o resto.
    const absorb = (tab) => (sources) => {
      if (run !== pickerRun) return; // dialogo ja foi fechado e reaberto
      pickerLoading[tab] = false;
      pickerSources = [...pickerSources, ...sources];
      renderPickerGrid();
    };
    const fail = (tab) => () => {
      if (run !== pickerRun) return;
      pickerLoading[tab] = false;
      renderPickerGrid();
    };
    window.golive.listSources(['screen']).then(absorb('screen'), fail('screen'));
    window.golive.listSources(['window']).then(absorb('window'), fail('window'));
  }

  // Uma fonte selecionada some se ela nao existir mais na lista nova, entao
  // o botao "Ir ao vivo" volta a ficar desabilitado -- melhor do que
  // transmitir uma janela que acabou de fechar.
  $('picker-refresh').addEventListener('click', (event) => {
    const btn = event.currentTarget;
    btn.classList.remove('spin');
    void btn.offsetWidth; // reinicia a animacao mesmo se clicado de novo dentro dos 600ms
    btn.classList.add('spin');
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    loadPickerSources();
  });

  // Capturar uma janela cai no caminho GDI/BitBlt do Chromium, que codifica
  // na CPU e devolve tela preta em fullscreen exclusivo -- ver a spec de
  // 2026-08-23, F1.2. A dica so aparece na aba onde a escolha errada mora.
  function syncWindowHint() {
    pickerWindowHintEl?.classList.toggle('hidden', pickerTab !== 'window');
  }

  // A 2a checkbox ("incluir o som do Discord") so faz sentido com a 1a
  // ligada -- some junto, e some desmarcada tambem (nao fica um estado
  // "incluir Discord" escondido e ativo por baixo dos panos).
  shareSoundEl.addEventListener('change', () => {
    shareDiscordRowEl.classList.toggle('hidden', !shareSoundEl.checked);
    if (!shareSoundEl.checked) shareDiscordEl.checked = false;
  });

  function closePicker() {
    pickerEl.classList.add('hidden');
    restoreFocusAfterModal();
  }

  $('picker-cancel').addEventListener('click', closePicker);

  // Esc fecha o dialogo (sem iniciar nada) e Enter inicia a transmissao --
  // so quando o dialogo esta aberto e (pro Enter) ja tem uma fonte
  // selecionada, senao o botao "Ir ao vivo" tambem estaria desabilitado.
  document.addEventListener('keydown', (event) => {
    if (pickerEl.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      closePicker();
    } else if (event.key === 'Enter' && !btnGoLiveEl.disabled) {
      btnGoLiveEl.click();
    }
  });

  async function openPicker({ onGoLive, nativeAudioAvailable = true, quality, onQualityChange, allowAnnotations = false }) {
    selectedSourceId = null;
    btnGoLiveEl.disabled = true;
    pickerTab = 'screen';
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'screen'));
    syncWindowHint();
    pickerGridEl.innerHTML = '';
    pickerOnQualityChange = onQualityChange;
    // Sem animar: os dois polegares aparecem ja no lugar, como o indicador
    // das abas (ver syncPickerIndicator).
    syncQualityAxes(quality.preset, false);
    pickerQualityBandwidthEl.innerHTML = bandwidthLineHtml(quality);
    shareSoundEl.checked = true;
    // Vem da ULTIMA escolha (config), nao de um padrao fixo: e a mesma
    // regra do "anunciar na rede" no dialogo de criar sala.
    $('allow-annotations').checked = Boolean(allowAnnotations);
    shareDiscordEl.checked = false;
    shareDiscordRowEl.classList.remove('hidden');
    // Sem o addon nativo (Windows apenas), nao ha como excluir o Discord do
    // audio capturado -- a checkbox nao teria efeito nenhum, entao fica
    // desabilitada em vez de prometer algo que nao entrega.
    shareDiscordEl.disabled = !nativeAudioAvailable;
    shareDiscordRowEl.title = nativeAudioAvailable
      ? ''
      : 'Indisponível nesta máquina (requer o addon nativo de áudio, só existe no Windows)';

    btnGoLiveEl.onclick = async () => {
      closePicker();
      try {
        await onGoLive(selectedSourceId, shareSoundEl.checked, shareSoundEl.checked && shareDiscordEl.checked, $('allow-annotations').checked);
      } catch (err) {
        console.error('[picker] onGoLive falhou:', err);
      }
    };

    // O dialogo aparece na hora e as fontes entram conforme chegam -- antes
    // ele so era exibido depois de capturar o thumbnail de TODAS as telas e
    // janelas, o que dava a impressao de que o clique nao tinha funcionado.
    pickerEl.classList.remove('hidden');
    // offsetLeft/offsetWidth so valem depois de sair de display:none.
    syncPickerIndicator(false);
    focusFirstInteractive(pickerEl);
    loadPickerSources();
  }

  // ---------- Dialogo: confirmacao (banir, passar a lideranca) ----------
  //
  // UM dialogo pros dois: eram dois quase iguais, e dois dialogos de
  // confirmacao divergindo em detalhe de foco e de estilo e divida
  // nascendo (spec de 2026-09-04, secao 4.4). O que varia e rotulo e tom
  // do botao de confirmar; o foco nasce SEMPRE no Cancelar.
  const dlgConfirmEl = $('dialog-confirm');
  let onConfirmAccept = null;

  function openConfirm({ title, text, confirmLabel = 'Confirmar', tone = 'destructive', onConfirm }) {
    $('dialog-confirm-title').textContent = title;
    $('dialog-confirm-text').textContent = text;
    const okBtn = $('btn-confirm-ok');
    okBtn.textContent = confirmLabel;
    okBtn.className = tone === 'destructive' ? 'destructive' : 'primary';
    onConfirmAccept = onConfirm;
    dlgConfirmEl.classList.remove('hidden');
    // Guarda o foco anterior pra restaura-lo no close (restoreFocusAfterModal).
    lastFocusedBeforeModal = document.activeElement;
    // Foco no Cancelar, nunca no botao que age (ver a spec de 2026-09-02, 8.3).
    $('btn-confirm-cancel').focus();
  }
  function closeConfirm() {
    dlgConfirmEl.classList.add('hidden');
    restoreFocusAfterModal();
    onConfirmAccept = null;
  }
  $('btn-confirm-cancel').addEventListener('click', closeConfirm);
  $('btn-confirm-ok').addEventListener('click', () => { onConfirmAccept?.(); closeConfirm(); });
  dlgConfirmEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeConfirm(); });

  function openBan({ name, onConfirm }) {
    openConfirm({
      title: `Banir ${name} da sala?`,
      text: `${name} sai agora e não consegue entrar de novo enquanto esta sala existir. Você pode readmitir depois, na lista de membros.`,
      confirmLabel: 'Banir',
      tone: 'destructive',
      onConfirm,
    });
  }

  /** Passar a lideranca nao e destrutivo -- e uma delegacao -- entao o botao
   * e o de acao (primary), nao o vermelho. Irreversivel pelo lado de quem
   * passa, o que e exatamente o que o texto diz. */
  function openTransferOwner({ name, onConfirm }) {
    openConfirm({
      title: `Passar a liderança para ${name}?`,
      text: `${name} passa a poder parar transmissões, expulsar e banir. Você deixa de poder — só ${name} pode devolver.`,
      confirmLabel: 'Passar a liderança',
      tone: 'primary',
      onConfirm,
    });
  }

  // ---------- Barra de controle: estado visivel dos toggles ----------
  // Compartilhar/camera/pausa sabem o proprio estado (app.js ja escrevia
  // classList direto), mas nada em CSS reagia a isso. Esta e a UNICA funcao
  // que mexe em classList/aria/disabled desses tres botoes -- app.js so
  // chama, nunca escreve o DOM deles direto (spec 2026-09-03, secao 3).
  const TOGGLE_BUTTON_IDS = {
    share: 'btn-toggle-share',
    camera: 'btn-toggle-camera',
    pause: 'btn-pause-share',
  };
  const TOGGLE_LABELS = {
    share: { off: 'Compartilhar tela', on: 'Parar de compartilhar' },
    camera: { off: 'Câmera', loading: 'Abrindo…', on: 'Desligar câmera' },
    pause: { off: 'Pausar', on: 'Retomar' },
  };

  function setToggleState(id, state) {
    const btn = $(TOGGLE_BUTTON_IDS[id]);
    if (!btn) return;
    const label = TOGGLE_LABELS[id][state] || TOGGLE_LABELS[id].off;
    btn.querySelector('.btn-label').textContent = label;
    // classe `.hidden`, NAO o atributo/propriedade `hidden`: estes tres nos
    // sao <svg>, e `hidden` e um atributo de HTMLElement -- `svg.hidden = x`
    // grava uma propriedade solta que nao vira atributo, e nem o atributo no
    // markup esconde um <svg> no Chromium (a regra `[hidden]` da folha do
    // navegador nao vence o display do elemento SVG). Era por isso que o
    // spinner da camera girava desde o boot e os dois icones de cada toggle
    // apareciam empilhados. `.hidden { display: none !important }` funciona
    // em qualquer namespace -- e o padrao que setCreateRoomBusy ja usava.
    btn.querySelector('.icon-off').classList.toggle('hidden', state !== 'off');
    btn.querySelector('.icon-on').classList.toggle('hidden', state !== 'on');
    const spinner = btn.querySelector('.btn-spinner');
    if (spinner) spinner.classList.toggle('hidden', state !== 'loading');
    btn.classList.toggle('is-on', state === 'on');
    btn.classList.toggle('loading', state === 'loading');
    btn.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
    // disabled de verdade, nao so visual -- senao o teclado ainda dispara
    // um segundo clique enquanto o driver da camera abre (spec, secao 3.3).
    btn.disabled = state === 'loading';
    if (state === 'loading') btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: { showTile, removeTile, setPainting, setWatchers, setPaused },
    annotations: {
      setSelf: annotSetSelf,
      setSurface: setAnnotSurface,
      applyOp: applyAnnotOp,
      load: loadAnnotSnapshot,
      snapshot: annotSnapshot,
      render: ({ onOp }) => { onAnnotOp = onOp; },
      colorFor: annotate.colorFor,
    },
    rooms: { render: renderRooms, setNetworkStatus: renderNetworkStatus },
    dialogs: {
      openCreateRoom, closeCreateRoom, setCreateRoomError,
      openJoinRoom, closeJoinRoom, setJoinRoomPinVisible,
      openBan, openTransferOwner, openConfirm, closeConfirm,
    },
    stageHeader: { set: setStageHeader, clear: clearStageHeader, setStatus: setStageStatus },
    settings: { open: openSettings, close: closeSettings, setStatsHtml },
    picker: { open: openPicker },
    members: { render: renderMembers, renderBanned },
    chat: { render, append, setHistory, setEnabled, setAttachment, clearAttachment },
    setToggleState,
  };
})(window);

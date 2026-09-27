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
  const laser = root.GoLive.laser;
  const reactions = root.GoLive.reactions;
  const tileMenu = root.GoLive.tileMenu;
  const themecode = root.GoLive.themecode;
  const gridLayout = root.GoLive.gridLayout;
  const roomname = root.GoLive.roomname;
  const lobbyRoom = root.GoLiveLobbyRoom;
  const chatlimit = root.GoLiveChatLimit;
  const chatGrouping = root.GoLive.chatGrouping;
  // O registro de avisos fica no app; esta camada so recebe a lista pronta e
  // mantem teclado, hover e foco consistentes no painel da barra de titulo.
  const warningCenter = root.GoLive.warningcenter.create(document);
  let popoverAtivo = null;

  function closePopover() {
    popoverAtivo?.close();
  }

  /** Dicas do dock (spec 6): uma dica de verdade (role=tooltip), nao o menu do
   * openPopover -- esse fecha os outros popovers e devolve o foco ao botao ao
   * fechar, e a dica roubava o foco da janela que o "+" da Mesa acabara de
   * abrir. Uma so, reposicionada a cada botao; nao mexe no foco. */
  function bindDockTooltips() {
    const atalhos = { 'btn-pause-share': 'Ctrl+Alt+P' };
    const dica = document.createElement('div');
    dica.className = 'tip';
    dica.setAttribute('role', 'tooltip');
    dica.hidden = true;
    document.body.appendChild(dica);
    const esconder = () => {
      dica.hidden = true;
    };
    const mostrar = (botao) => {
      const texto = document.createElement('span');
      texto.textContent = botao.querySelector('.btn-label')?.textContent || botao.getAttribute('aria-label') || '';
      dica.replaceChildren(texto);
      const atalho = atalhos[botao.id];
      if (atalho) {
        const tecla = document.createElement('kbd');
        tecla.textContent = atalho;
        dica.appendChild(tecla);
      }
      dica.hidden = false;
      const caixa = botao.getBoundingClientRect();
      const pos = tileMenu.positionPopover({
        x: caixa.left + (caixa.width - dica.offsetWidth) / 2,
        y: caixa.top - dica.offsetHeight - 8,
        width: dica.offsetWidth,
        height: dica.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      dica.style.left = `${pos.x}px`;
      dica.style.top = `${pos.y}px`;
    };
    // Botoes so de icone do barramento e da cabeca (os com rotulo ja dizem o que fazem).
    let espera = null;
    for (const botao of document.querySelectorAll('.bus .btn--icon, .head .btn--icon, .bus__end .btn')) {
      botao.removeAttribute('title');
      botao.addEventListener('mouseenter', () => {
        clearTimeout(espera);
        espera = setTimeout(() => mostrar(botao), 500);
      });
      botao.addEventListener('focus', () => mostrar(botao));
      botao.addEventListener('mouseleave', () => {
        clearTimeout(espera);
        esconder();
      });
      botao.addEventListener('blur', esconder);
      botao.addEventListener('click', esconder);
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') esconder();
    });
  }

  /** Popover comum: ancora no botao ou num ponto e conserva foco e teclado. */
  function openPopover({ anchor = null, point = null, content, onClose = null, focus = null, onKeydown = null }) {
    closePopover();
    const popover = document.createElement('div');
    popover.className = 'pop';
    popover.setAttribute('role', 'menu');
    popover.tabIndex = -1;
    let pane = { content, focus };
    const pilha = [];
    const renderPane = () => {
      popover.replaceChildren(pane.content);
    };
    const focusPane = () => {
      const selector = pane.focus
        || '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])';
      popover.querySelector(selector)?.focus({ preventScroll: true });
    };
    renderPane();
    document.body.appendChild(popover);
    const rect = anchor?.getBoundingClientRect();
    const x = point?.x ?? rect?.left ?? 0;
    const y = point?.y ?? rect?.bottom ?? 0;
    const pos = tileMenu.positionPopover({
      x,
      y: y + (point ? 0 : 8),
      width: popover.offsetWidth,
      height: popover.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    popover.style.left = `${pos.x}px`;
    popover.style.top = `${pos.y}px`;
    let fechado = false;
    const close = () => {
      if (fechado) return;
      fechado = true;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown, true);
      popover.remove();
      if (popoverAtivo?.popover === popover) popoverAtivo = null;
      onClose?.();
      anchor?.focus({ preventScroll: true });
    };
    const outside = (event) => {
      if (!popover.contains(event.target) && !anchor?.contains(event.target)) close();
    };
    const voltar = () => {
      if (!pilha.length) return false;
      const anterior = pilha.pop();
      pane = anterior.pane;
      anterior.onReturn?.();
      renderPane();
      focusPane();
      return true;
    };
    const keydown = (event) => {
      const active = document.activeElement;
      const campo = active?.matches('input, select, textarea');
      const items = [...popover.querySelectorAll(
        '[role^="menuitem"]:not([disabled]):not([aria-disabled="true"])'
      )];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!voltar()) close();
      } else if (campo && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return;
      } else if (event.key === 'ArrowLeft') {
        if (voltar()) event.preventDefault();
      } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && items.length) {
        event.preventDefault();
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      } else if (event.key === 'Home' && items.length) {
        event.preventDefault();
        items[0].focus();
      } else if (event.key === 'End' && items.length) {
        event.preventDefault();
        items.at(-1).focus();
      } else if (event.key === 'ArrowRight' && active?.matches('[aria-haspopup="menu"]')) {
        event.preventDefault();
        active.click();
      }
      if (!event.defaultPrevented) onKeydown?.(event);
    };
    const openSubmenu = ({ content: submenu, focus: submenuFocus = null, onReturn = null }) => {
      pilha.push({ pane, onReturn });
      pane = { content: submenu, focus: submenuFocus };
      renderPane();
      focusPane();
    };
    popoverAtivo = { popover, close };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    focusPane();
    return { popover, close, openSubmenu, voltar };
  }

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
  };

  /** O servidor nomeia a sala padrao como 'sala de <host>'; na tela a
   * primeira letra vem maiuscula, como qualquer titulo. */
  function nomeDeSala(nome) {
    const s = String(nome || '');
    return s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  bindDockTooltips();

  const gridEl = $('grid');

  // tileRegistry espelha os tiles ativos (id -> {label, stream, avatar}) e e
  // a fonte de candidatos pro "+" do PiP. fullscreenTileId e o id do tile em
  // fullscreen agora (ou null). pinnedPip sao os ids marcados como miniatura
  // -- sobrevive a trocas de foco e a sair/entrar de fullscreen, so e limpo
  // quando o id some do tileRegistry ou o usuario remove manualmente (ver
  // spec docs/superpowers/specs/2026-08-20-tile-avatars-and-fullscreen-pip-design.md).
  const tileRegistry = new Map();
  let fullscreenTileId = null;
  const spyState = root.GoLive.espiar.createSpyState();
  let spyWin = null;
  const pinnedPip = new Set();

  /** Cores do Espiar a partir do tema aplicado agora nesta janela (ver
   * espiar.js). A pagina do Espiar pede isto no boot; as trocas de tema com
   * ela aberta vao por pushSpyTheme. */
  function spyTheme() {
    const cs = getComputedStyle(document.documentElement);
    return root.GoLive.espiar.spyThemeVars((name) => cs.getPropertyValue(name));
  }
  root.GoLive.__espiarTheme = spyTheme;

  function pushSpyTheme() {
    if (!spyWin || spyWin.closed) return;
    spyWin.GoLiveSpy?.setTheme?.(spyTheme());
  }

  // theme.apply so mexe no <html>: `data-theme` (predefinicao) e variaveis
  // inline (acento proprio e tema personalizado). Observar os dois pega
  // qualquer troca, venha de onde vier, sem o app.js precisar avisar.
  new MutationObserver(pushSpyTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style'],
  });

  function updateSpyWindow() {
    const tileId = spyState.tileId();
    const entry = tileRegistry.get(tileId);
    if (!spyWin || spyWin.closed || !entry) return false;
    const api = spyWin.GoLiveSpy;
    if (!api) return false;
    api.setTheme?.(spyTheme());
    api.setStream(tileId, entry.stream, entry.displayName || entry.label);
    const paused = tilePaused.get(tileId);
    api.setPaused(Boolean(paused?.paused), paused?.opts);
    return true;
  }

  function openSpyWindow(tileId) {
    spyState.open(tileId);
    if (!spyWin || spyWin.closed) spyWin = window.open('espiar.html', 'golive-espiar');
    if (!spyWin) {
      spyState.closeFor(tileId);
      return;
    }
    if (!updateSpyWindow()) spyWin.addEventListener('load', updateSpyWindow, { once: true });
  }

  function closeSpyWindow(tileId) {
    if (!spyState.closeFor(tileId)) return;
    if (spyWin && !spyWin.closed) spyWin.close();
    spyWin = null;
  }

  root.GoLive.__espiarClosed = (tileId) => {
    spyState.closed(tileId);
    spyWin = null;
  };
  window.golive.onSpyBack?.(() => {
    const tile = document.getElementById(`tile-${spyState.tileId()}`);
    tile?.focus({ preventScroll: true });
  });

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
    syncPainting(); // a grade voltou a aparecer: religa quem estava atras
    scheduleIdle();
  });

  // Ociosidade do mouse: a interface sai da frente do video depois de um
  // tempo parada, tipo player de video, e volta no primeiro movimento.
  //
  // UM timer so pros dois alcances, porque e UMA nocao de "parado":
  //   - `body.room-idle`  -> cabecalho da sala, barra de controles e barra
  //                          de ferramentas do rabisco (CSS `.room-idle`);
  //   - `.tile.idle`      -> o que ja sumia dentro do fullscreen (nome,
  //                          avatar, PiP, botao de sair) e o cursor.
  // Dois timers dariam duas verdades sobre a mesma coisa, e a chance de a
  // barra sumir enquanto o nome do tile continua la.
  const IDLE_MS = 3000;
  let idleTimer = null;

  /** So entra em ocioso com tile na grade. Numa sala vazia a barra de baixo
   * e a unica saida ("Compartilhar tela", "Sair da sala") -- esconde-la ali
   * seria deixar a pessoa numa tela preta sem porta. */
  function canGoIdle() {
    // Na vista Mesa os tiles moram nas janelas da mesa, fora da grade.
    return !!gridEl?.querySelector('.tile') || !!document.querySelector('.mesa-win');
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    document.body.classList.remove('room-idle');
    if (fullscreenTileId) {
      document.getElementById(`tile-${fullscreenTileId}`)?.classList.remove('idle');
    }
    if (!canGoIdle()) return;
    idleTimer = setTimeout(() => {
      document.body.classList.add('room-idle');
      if (fullscreenTileId) {
        closePipMenu();
        closeTileMenu();
        document.getElementById(`tile-${fullscreenTileId}`)?.classList.add('idle');
      }
    }, IDLE_MS);
  }

  // `focusin` e `keydown` junto do `mousemove`: quem anda de Tab tem de
  // trazer a barra de volta antes de chegar num botao invisivel. Sem eles, o
  // foco do teclado pousaria atras de uma barra apagada -- e o que a regra
  // de "overlay nunca esconde o foco" existe pra impedir.
  for (const evento of ['mousemove', 'mousedown', 'keydown', 'focusin']) {
    document.addEventListener(evento, scheduleIdle, true);
  }

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
      if (entering) {
        // Estes popovers sao fixed no body, fora da casca que o fullscreen
        // esconde. Fechar por suas funcoes preserva os estados ARIA e evita
        // qualquer um deles sobre o video.
        closeMemberMenu();
        closeTileMenu();
        closePipMenu();
        closeEmojiPanel();
        // A lateral acabou de ficar invisivel; foco fora deste tile ficaria
        // preso nela (por exemplo, na busca de emoji).
        if (!tile.contains(document.activeElement)) {
          tile.querySelector('[data-acao="tela-cheia"]')?.focus();
        }
      }
      if (entering) {
        fullscreenTileId = id;
        renderPipStrip(tile); // ja termina em syncPainting
      } else {
        fullscreenTileId = null;
        syncPainting(); // a grade reaparece: religa quem estava atras
      }
      scheduleIdle();
    };

    // O fullscreen real da janela vem so DEPOIS da transicao, e segue o
    // estado da grade naquele momento (nao o do clique): um segundo clique,
    // o tile sumindo ou a troca de foco no meio do caminho ja mudaram
    // `fullscreenTileId`. Chamar setFullScreen dentro do `apply`
    // redimensionava a janela no meio da transicao, que abortava com
    // "InvalidStateError: Transition was aborted" (log de 21/09) -- e o
    // tile nem chegava a crescer.
    const syncWindow = () => window.golive.setFullScreen(!!fullscreenTileId);

    if (!document.startViewTransition) { // fallback: corte seco, como antes
      apply();
      syncWindow();
      return;
    }

    tile.style.viewTransitionName = 'tile';
    const transition = document.startViewTransition(apply);
    // `ready` rejeita quando a transicao e pulada (outra comecou por cima,
    // aba oculta): e esperado, nao erro -- sem isto vira "Uncaught (in
    // promise)" no log. `finished` so rejeita se o `apply` lancar, e ai o
    // erro tem mesmo que aparecer.
    transition.ready.catch(() => {});
    transition.finished.finally(() => {
      tile.style.viewTransitionName = '';
      syncWindow();
    });
  }

  // Pintura dos <video>. Um <video> pausado deixa de compor frames, mas a
  // MediaStreamTrack por tras continua viva e sendo enviada -- pausar o
  // elemento e parada de EXIBICAO, nao de captura nem de encode (que rodam
  // no processo de GPU). E o que permite nao gastar GPU desenhando a propria
  // tela dentro da propria tela enquanto o jogo esta por cima. Ver a spec de
  // 2026-08-23, F1.4.
  let paintingEnabled = true;

  /** Este video esta atras do fullscreen de OUTRO tile?
   *
   * `.tile.fullscreen` e `position: fixed; inset: 0` -- ele COBRE a grade,
   * mas nao a remove: sem isto, entrar em tela cheia adicionava uma camada
   * de viewport inteiro por cima e a grade toda seguia decodificando e
   * compondo por baixo, invisivel. Numa sala de 3 pessoas transmitindo isso
   * e meia duzia de videos pintados a toa, exatamente no momento de maior
   * carga da aplicacao (captura de 1080p60 + um encoder de software por
   * espectador). Ver a analise dos logs de 2026-09-05.
   *
   * As miniaturas do PiP ficam DENTRO do tile em fullscreen (`.pip-strip`),
   * entao `closest('.tile')` devolve o proprio tile de fullscreen e elas
   * seguem pintando -- que e o que a pessoa esta de fato olhando. */
  function isOccludedByFullscreen(video) {
    if (!fullscreenTileId) return false;
    const tile = video.closest?.('.tile');
    return !!tile && tile.id !== `tile-${fullscreenTileId}`;
  }

  function applyPainting(video) {
    if (!video) return;
    if (paintingEnabled && !isOccludedByFullscreen(video)) video.play().catch(() => {});
    else video.pause();
  }

  /** Reavalia a pintura de todos os videos da grade. Chamada em TODA
   * mudanca de `fullscreenTileId` -- entrar, sair, e trocar o foco pra uma
   * miniatura -- alem da visibilidade da janela.
   *
   * Nao mexe em audio: tile remoto tem `video.muted = true` e o som dele
   * corre por fora, no grafo de Web Audio montado em ensureTileAudio
   * (MediaStreamSource -> GainNode -> destination). Pausar o elemento para
   * de PINTAR, nao de ouvir -- mesmo fundamento do F1.4. */
  function syncPainting() {
    // `.mesa-win video`: na vista Mesa o tile (com o mesmo <video>) mora
    // numa janela da mesa, fora da grade -- e minimizar tem de parar de
    // pintar ali tambem.
    document.querySelectorAll('#grid video, .mesa-win video').forEach((video) => {
      // O veu de pausa ja mandou o video pausar e sumir -- a janela
      // ficar visivel de novo nao pode religar a decodificacao por baixo
      // dele (ver renderPausedOverlay).
      if (video.closest('.tile')?.classList.contains('is-paused')) return;
      applyPainting(video);
    });
  }

  function setPainting(enabled) {
    if (paintingEnabled === enabled) return;
    paintingEnabled = enabled;
    syncPainting();
  }

  // Quem esta assistindo cada tile agora (F1.3 + o broadcast de
  // 'watchers' em app.js) -- id do tile -> [{ id, name, avatar }]. Guardado
  // aqui (nao so no DOM) porque a mensagem 'watchers' pode chegar antes do
  // tile existir (renegociacao) ou depois dele ter sido recriado.
  const tileWatchers = new Map();


  /** A audiencia virou um OLHO no canto superior esquerdo, com o numero ao
   * lado. Antes era o painel inteiro que aparecia no hover do tile: com
   * quatro nomes ele cobria um pedaco do video sempre que o mouse passava
   * por perto, e era a unica coisa naquele canto que nao dava pra evitar.
   *
   * Agora o que fica sempre visivel e do tamanho de um selo -- "3 pessoas
   * estao vendo isto" e a informacao que se quer de relance --, e QUEM sao
   * elas so abre quando o mouse para no olho. `:focus-within` abre pelo
   * teclado, entao a lista nao e exclusiva de quem usa mouse. */
  function renderTileWatchers(tile, watchers) {
    const el = tile?.querySelector('.tile__watchers');
    if (!el) return;
    const n = watchers?.length || 0;
    el.textContent = n ? `${n} vendo` : '';
    el.title = n ? watchers.map((w) => w.name).filter(Boolean).join(', ') : '';
  }

  /** `tileId` e o id usado em showTile ('me'/'cam-me' pro proprio, peerId ou
   * `cam-${peerId}` pro de um peer). `watchers` e a lista JA fundida pelo
   * app.js -- com a arvore de retransmissao ligada, quem serve uma folha e o
   * relay, entao a lista de um tile vem de mais de um remetente. */
  function setWatchers(tileId, watchers) {
    tileWatchers.set(tileId, watchers || []);
    renderTileWatchers(document.getElementById(`tile-${tileId}`), watchers);
    redesenharUltimasPresencas();
  }

  /** P4 (auditoria 2026-09-18): chip discreto de saude de recepcao, do lado
   * de quem assiste -- `state` e o retorno de health.next (app.js decide, e
   * so decide, este modulo so pinta). Sem estado por-modulo (ao contrario
   * de tileWatchers/tilePaused): um tile recriado nasce sem chip e o
   * proximo tick de updateStats o repinta -- nao ha janela em que um chip
   * de saude ANTIGO ficaria preso num tile que renegociou. */
  function setHealthChip(tileId, state) {
    const chip = document.getElementById(`tile-${tileId}`)?.querySelector('.tile__warn');
    if (!chip) return;
    const show = Boolean(state?.text) && state.level !== 'ok';
    chip.innerHTML = show ? `<svg class="i i--sm"><use href="#i-triangle-alert" /></svg>${escapeHtml(state.text)}` : '';
    chip.classList.toggle('hidden', !show);
    chip.dataset.level = state?.level === 'ruim' ? 'bad' : 'warn';
    const nivel = state?.level || 'ok';
    if (tileHealth.get(tileId) !== nivel) {
      tileHealth.set(tileId, nivel);
      redesenharUltimasPresencas();
    }
  }

  /** H10/D5 (analise de 2026-09-23): por que a tela assistida congelou --
   * "sem contato com o PC de X", "X parou de enviar imagem". Um quadro
   * parado sem explicacao e o que faz a pessoa sair e entrar da sala.
   * Sem estado aqui, pelo mesmo motivo do chip acima: o app.js reaplica a
   * cada volta do vigia (2 s), entao um tile recriado recupera o aviso. */
  function setStallNote(tileId, text) {
    const note = document.getElementById(`tile-${tileId}`)?.querySelector('.tile__stall');
    if (!note) return;
    const value = text || '';
    if (note.dataset.text !== value) {
      note.dataset.text = value;
      note.innerHTML = value ? `<span class="spinner" aria-hidden="true"></span><strong>${escapeHtml(value)}</strong>` : '';
    }
    note.classList.toggle('hidden', !value);
  }

  // ---------- Escolher qual tela assistir ----------
  //
  // Assistir a TODAS as telas ao mesmo tempo era a decisao do app, nao de
  // quem assiste: cada tela extra e um decode de 1080p60 aqui e um encoder
  // inteiro na maquina de quem transmite. Agora e escolha -- uma tela por
  // padrao, e um botao ao lado pra ver duas (ou mais) juntas.
  //
  // A economia nao mora aqui: uma tela nao escolhida vira `view-state
  // {watching:false}`, e quem transmite SOLTA o encoder daquele espectador
  // (mesh.setPeerDemand). Este modulo so cuida do que se ve e do que se
  // clica; quem faz a conta e o app.js.
  //
  // Estado por tile (nao so no DOM) pelo mesmo motivo do tileWatchers e do
  // tilePaused: renegociacao destroi e recria o `<div class="tile">`.
  const tileWatch = new Map(); // tileId -> { watched, opts }
  let onWatchIntent = null; // (tileId, 'only' | 'add' | 'remove') => void

  function renderWatchGate(tile, tileId) {
    if (!tile) {
      syncGridCount();
      return;
    }
    const state = tileWatch.get(tileId);
    // Sem estado registrado o tile e assistido -- e o caso de todo tile que
    // nao e tela de outra pessoa (o proprio, as cameras).
    const watched = !state || state.watched;
    const opts = state?.opts || {};
    const naMesa = document.body.classList.contains('mesa-open');
    const ocultarNoPalco = !watched && !naMesa;
    tile.classList.toggle('is-unwatched', !watched);
    tile.hidden = ocultarNoPalco;
    if (ocultarNoPalco) {
      const video = tile.querySelector('video');
      if (video) {
        tile._videoOculto = video;
        video.remove();
      }
      delete tile.dataset.kind;
    } else {
      ensureTileBar(tile, tileId);
      const kind = tileRegistry.get(tileId)?.kind || opts.kind;
      if (kind) tile.dataset.kind = kind;
      if (tile._videoOculto) {
        tile.querySelector('.tile__media').prepend(tile._videoOculto);
        delete tile._videoOculto;
      }
    }

    let gate = tile.querySelector('.tile__gate');
    if (watched || !naMesa) {
      gate?.remove();
    } else {
      if (!gate) {
        gate = document.createElement('div');
        gate.className = 'tile__gate blank';
        // Fica no caminho do duplo-clique de fullscreen e do arrasto do PiP
        // de proposito: nao ha o que por em tela cheia enquanto nao se esta
        // assistindo.
        gate.addEventListener('dblclick', (e) => e.stopPropagation());
        gate.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-watch]');
          if (!btn) return;
          e.stopPropagation();
          onWatchIntent?.(tileId, btn.dataset.watch);
        });
        tile.appendChild(gate);
      }
      const nome = opts.name || 'Alguém';
      const ehCamera = opts.kind === 'camera';
      const titulo = ehCamera ? escapeHtml(nome) : `${escapeHtml(nome)} está ao vivo`;
      const sub = ehCamera
        ? 'A câmera só chega quando você pede.'
        : 'A tela só chega quando você pede — é um encoder a menos rodando na máquina de quem transmite.';
      const pessoaId = String(tileId).replace(/^cam-/, '');
      gate.innerHTML = `
        <span class="node" data-size="56" data-state="live" style="--who:${avatarColorFor(pessoaId)}">${avatarInnerHtml(pessoaId, nome, opts.avatar || null)}</span>
        <p class="blank__title">${titulo}</p>
        <p class="blank__text">${sub}</p>
        <div class="tile__gate-actions">
          <button type="button" class="btn btn--primary btn--sm" data-watch="only">Assistir</button>
          ${opts.canAdd ? '<button type="button" class="btn btn--secondary btn--sm" data-watch="add" title="Ver esta tela sem largar a que você já assiste">Ver junto</button>' : ''}
        </div>`;
    }

    // O botao de largar uma tela so existe quando ha OUTRA sendo assistida:
    // sozinho ele seria um jeito de ficar sem ver nada, e a saida pra isso
    // ja e sair da sala ou pedir outra tela.
    const off = tile.querySelector('.tile__hud [data-acao="parar"]');
    if (off) off.hidden = !(watched && opts.canDrop);
    // O card de "ver junto" tambem ocupa a tira: a troca de assistida nao
    // pode esperar a proxima track pra redesenhar a hierarquia do palco.
    syncGridCount();
    // Na Transmissao o tile nao assistido some: o palco vazio entra ou sai
    // junto com a troca, sem esperar outro tile.
    renderEmptyGrid();
  }

  /** `watched` false poe o card de "está ao vivo" no lugar do video. `opts`
   * traz `{ name, avatar, canAdd, canDrop }` -- `canAdd` e `canDrop` sao
   * decisao do app.js (ele e quem sabe quantas telas estao escolhidas). */
  function setWatched(tileId, watched, opts = {}) {
    tileWatch.set(tileId, { watched: Boolean(watched), opts });
    renderWatchGate(document.getElementById(`tile-${tileId}`), tileId);
    redesenharUltimasPresencas();
  }

  function forgetWatched(tileId) {
    tileWatch.delete(tileId);
    syncGridCount();
    redesenharUltimasPresencas();
  }

  function redesenharPortoesAssistir() {
    for (const tileId of tileWatch.keys()) {
      renderWatchGate(document.getElementById(`tile-${tileId}`), tileId);
    }
  }

  function setWatchIntentHandler(fn) {
    onWatchIntent = fn;
  }

  /** Quadros que o <video> do tile ja exibiu -- o que a pessoa de fato ve,
   * nao o que chegou pela rede. null quando nao da pra medir: sem tile, sem
   * stream, video pausado (janela oculta, tela cheia de outro tile) ou
   * escondido pelo veu de pausa. Ver stallwatch.js. */
  function framesShown(tileId) {
    const video = document.getElementById(`tile-${tileId}`)?.querySelector('video');
    if (!video || !video.srcObject || video.paused || video.hidden) return null;
    const quality = video.getVideoPlaybackQuality?.();
    return quality ? quality.totalVideoFrames : null;
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
    const media = tile.querySelector('.tile__media') || tile;
    if (!paused) {
      tile.querySelector('.tile__shot')?.remove();
      tile.querySelector('.tile__state--paused')?.remove();
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
      const canvas = tile.querySelector('.tile__shot') || document.createElement('canvas');
      canvas.className = 'tile__shot';
      const w = 320;
      const h = Math.round((video.videoHeight / video.videoWidth) * w) || w;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      if (!canvas.isConnected) media.insertBefore(canvas, media.firstChild);
    } else {
      // Sem primeiro quadro ainda: pula o bitmap, so o veu escuro + texto.
      tile.querySelector('.tile__shot')?.remove();
    }
    if (video) {
      video.pause();
      video.hidden = true;
    }
    let veil = tile.querySelector('.tile__state--paused');
    if (!veil) {
      veil = document.createElement('div');
      veil.className = 'tile__state tile__state--paused';
      veil.setAttribute('role', 'status');
      veil.innerHTML = `
        <span class="node" data-size="56" data-state="paused"><svg class="i"><use href="#i-pause" /></svg></span>
        <strong class="tile__state-title"></strong>
        <span class="tile__state-sub"></span>`;
      media.appendChild(veil);
    }
    veil.querySelector('.tile__state-title').textContent = opts?.title || 'Transmissão pausada';
    veil.querySelector('.tile__state-sub').textContent = opts?.subtitle || '';
    tile.classList.add('is-paused');
  }

  /** `tileId` no mesmo espaco de `showTile` ('me'/'cam-me' pro proprio,
   * peerId ou `cam-${peerId}` pro de um peer). `opts` e `{ title, subtitle }`
   * -- o tile local usa um texto diferente do de quem assiste (ver app.js). */
  function setPaused(tileId, paused, opts) {
    tilePaused.set(tileId, { paused, opts });
    redesenharUltimasPresencas();
    if (spyState.tileId() === tileId) updateSpyWindow();
    const tile = document.getElementById(`tile-${tileId}`);
    if (!tile) return; // tile pode ja ter sido removido (ex: parou de transmitir)
    renderPausedOverlay(tile, tile.querySelector('video'), paused, opts);
  }

  /** Contagem e hierarquia sao decisoes de estado, nao restos do auto-fit.
   * O modulo puro escolhe o palco; aqui so movemos os tiles para que a tira
   * tenha sua propria rolagem sem alargar ou apertar as colunas principais. */
  function syncGridCount() {
    const tiles = Array.from(gridEl.querySelectorAll('.tile'));
    const visiveis = tiles.filter((tile) => !tile.hidden);
    // Tela ao vivo nao assistida fica escondida mas viva, esperando o
    // Assistir da coluna: estacionada direto na grade, nunca dentro de
    // .grid-main/.grid-strip, que somem quando o layout muda.
    for (const tile of tiles) {
      if (tile.hidden && tile.parentElement !== gridEl) gridEl.appendChild(tile);
    }
    const plan = gridLayout.gridLayout(visiveis.map((tile) => {
      const id = tile.id.slice('tile-'.length);
      return {
        id,
        kind: tile.dataset.kind || null,
        // Sem registro de escolha o tile e assistido: e o caso de camera e
        // dos tiles proprios. So o false explicito vira o card de entrada.
        watched: tileWatch.get(id)?.watched !== false,
      };
    }));
    const n = plan.count;
    if (!n) gridEl.removeAttribute('data-count');
    // Sem fonte a mostra nao ha onde a reacao aparecer.
    const reagir = document.getElementById('btn-reactions');
    if (reagir) reagir.disabled = !visiveis.length;
    else gridEl.dataset.count = n > 6 ? 'many' : String(n);
    gridEl.dataset.layout = plan.layout;

    const mainEl = gridEl.querySelector(':scope > .grid-main');
    const stripEl = gridEl.querySelector(':scope > .grid-strip');
    if (plan.layout === 'spotlight') {
      const main = mainEl || document.createElement('div');
      const strip = stripEl || document.createElement('div');
      main.className = 'grid-main';
      strip.className = 'grid-strip';
      if (!main.isConnected) gridEl.appendChild(main);
      if (!strip.isConnected) gridEl.appendChild(strip);
      main.dataset.count = plan.main.length > 6 ? 'many' : String(plan.main.length);

      const stripIds = new Set(plan.strip);
      for (const tile of visiveis) {
        const slot = stripIds.has(tile.id.slice('tile-'.length)) ? strip : main;
        if (tile.parentElement !== slot) slot.appendChild(tile);
        if (slot === strip) tile.dataset.slot = 'strip';
        else delete tile.dataset.slot;
      }
    } else {
      for (const tile of visiveis) {
        if (tile.parentElement !== gridEl) gridEl.appendChild(tile);
        delete tile.dataset.slot;
      }
      mainEl?.remove();
      stripEl?.remove();
    }
  }

  function showTile(id, label, stream, { muted = false, avatar = null, kind = null, displayName = null } = {}) {
    // `:scope >` e obrigatorio, nao arrumacao: o `.empty` que tem de sair e
    // o cartao de "sala vazia", filho DIRETO da grade. Sem o escopo, este
    // querySelector varria a subarvore e encontrava primeiro o `.empty` de
    // um `.tile-watchers` sem audiencia -- e apagava, do tile de outra
    // pessoa, o elemento inteiro em que a lista de "quem esta assistindo"
    // e desenhada. Bastava um segundo tile aparecer pra matar o overlay do
    // primeiro, e nada o trazia de volta ate o tile ser recriado: era esta
    // a audiencia que "as vezes nao aparecia".
    gridEl.querySelector(':scope > .stage-empty')?.remove();

    let tile = document.getElementById(`tile-${id}`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.id = `tile-${id}`;
      tile.tabIndex = -1;
      // Anatomia do tile (05 §3.3): o video sangra no vazio; o HUD aparece
      // por cima com o mouse ou o foco e some parado; o que nao pode sumir
      // (pausa, sem sinal, recepcao ruim) mora fora do HUD.
      tile.innerHTML = `
        <div class="tile__media">
          <video class="tile__video" autoplay playsinline></video>
          <canvas class="tile__canvas"></canvas>
          <div class="tile__pops"></div>
          <div class="draw-bar" role="toolbar" aria-label="Rabisco" hidden></div>
          <div class="pip-strip"></div>
        </div>
        ${TILE_HUD_HTML}
        <span class="tile__warn hidden"></span>
        <div class="tile__stall hidden" role="status"></div>`;
      tile.addEventListener('dblclick', () => toggleTileFullscreen(tile, id));
      acompanharCaixaDoVideo(tile);
      wireTileAnnotations(tile, id);
      wireTileBar(tile, id);
      if (id !== 'me' && id !== 'cam-me') {
        tile.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openTileMenu(id, event.clientX, event.clientY);
        });
      }
      gridEl.appendChild(tile);
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
      // E pelo mesmo motivo de novo: a escolha de assistir (ou nao) aquela
      // tela e anterior a chegada da primeira track.
      renderWatchGate(tile, id);
    }

    if (!tile.hidden) ensureTileBar(tile, id);
    const video = tile.querySelector('video') || tile._videoOculto;
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
    renderTileWho(tile, id, displayName || label, kind, avatar);
    // Ordena a grade por CSS (`.tile[data-kind="camera"] { order: 1 }`):
    // tela e o conteudo, camera e o acompanhamento.
    if (kind) tile.dataset.kind = kind;
    else delete tile.dataset.kind;
    if (tile.hidden) delete tile.dataset.kind;

    // Tile criado enquanto a janela esta oculta nasce pausado (o atributo
    // autoplay do <video> tocaria sozinho, sem isto). Excecao: tile com o
    // veu de pausa ativo -- quem manda no video ali e o overlay, nao a
    // visibilidade da janela (ver renderPausedOverlay).
    if (!tilePaused.get(id)?.paused) applyPainting(video);

    tileRegistry.set(id, { label, stream, avatar, kind, displayName });
    redesenharUltimasPresencas();
    // `kind` chega junto da track e pode mudar numa renegociacao. A escolha
    // de palco precisa ver o kind novo, nao o que havia antes no DOM.
    syncGridCount();
    if (spyState.tileId() === id) updateSpyWindow();
    // A vista Mesa pega o tile para a janela dele (o mesmo <video>).
    onTileShown?.(id);
  }

  let onTileShown = null;

  // O HUD, o aviso de recepcao e a regua de rabisco ficam sobre a IMAGEM, nao
  // sobre as tarjas do letterbox: o tile publica o retangulo util do video
  // (mesma conta do rabisco, annotate.contentRect) em --vx/--vy/--vw/--vh.
  const observadorCaixa = new ResizeObserver((entradas) => {
    for (const entrada of entradas) publicarCaixaDoVideo(entrada.target);
  });

  function publicarCaixaDoVideo(tile) {
    const video = tile.querySelector('video');
    const r = annotate.contentRect(video?.videoWidth, video?.videoHeight, tile.clientWidth, tile.clientHeight);
    tile.style.setProperty('--vx', `${Math.round(r.left)}px`);
    tile.style.setProperty('--vy', `${Math.round(r.top)}px`);
    tile.style.setProperty('--vw', `${Math.round(r.width)}px`);
    tile.style.setProperty('--vh', `${Math.round(r.height)}px`);
  }

  function acompanharCaixaDoVideo(tile) {
    observadorCaixa.observe(tile);
    const video = tile.querySelector('video');
    for (const evento of ['loadedmetadata', 'resize']) {
      video?.addEventListener(evento, () => publicarCaixaDoVideo(tile));
    }
  }

  /** O palco se arruma de novo depois que a vista Mesa devolve os tiles:
   * tira o cartao de "ninguem transmitindo" que um removeTile possa ter
   * posto enquanto os tiles estavam fora, reorganiza e religa a pintura. */
  function resyncGrid() {
    if (gridEl.querySelector('.tile:not([hidden])')) gridEl.querySelector(':scope > .stage-empty')?.remove();
    syncGridCount();
    renderEmptyGrid();
    syncPainting();
    scheduleIdle();
  }

  /** Devolve ao palco um tile que estava numa janela da mesa. */
  function returnTile(tile) {
    if (tile && tile.parentElement !== gridEl) gridEl.appendChild(tile);
  }

  // Estado vazio da grade. So existe dentro da sala (a grade mora no
  // #room-view), entao o texto e sempre o da sala -- o "Entre ou crie uma
  // sala" do HTML ficava na tela ao entrar, porque so a remocao de um tile
  // redesenhava isto. E tem acao: o caso comum de sala vazia e ninguem ter
  // comecado ainda, e o botao de compartilhar la embaixo passa batido.
  /** Palco sem tile a mostra (05 §3.3): ninguem ao vivo, ou gente ao vivo
   * que voce deixou de assistir. A arte e o grafo do icone, em traco fino. */
  function renderEmptyGrid() {
    const vazio = gridEl.querySelector(':scope > .stage-empty');
    if (gridEl.querySelector('.tile:not([hidden])')) {
      vazio?.remove();
      return;
    }
    const aoVivo = [...tileRegistry.entries()]
      .filter(([id, t]) => !id.startsWith('cam-') && id !== 'me' && t.kind !== 'camera')
      .map(([id, t]) => ({ id, nome: t.displayName || t.label || 'Alguém' }));
    const chave = aoVivo.map((p) => p.id).join(',');
    if (vazio && vazio.dataset.chave === chave) return;
    vazio?.remove();
    const nomes = aoVivo.map((p) => p.nome);
    const titulo = !aoVivo.length
      ? 'Ninguém está transmitindo.'
      : `${nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)} estão` : `${nomes[0]} está`} ao vivo.`;
    const acoes = aoVivo.length
      ? aoVivo.slice(0, 3).map((p) => `<button type="button" class="btn btn--secondary" data-assistir="${escapeHtml(p.id)}">
          Assistir ${escapeHtml(p.nome)}</button>`).join('')
      : '<button type="button" class="btn btn--secondary" data-transmitir>Transmitir tela</button>';
    gridEl.insertAdjacentHTML('beforeend', `
      <div class="stage-empty blank" data-chave="${escapeHtml(chave)}">
        <svg class="blank__art graph-art" viewBox="0 0 32 32" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round">
            <path d="M20.71 14.20 L11.35 9.06" /><path d="M20.71 17.80 L11.35 22.94" />
            <circle class="ring" cx="8.5" cy="7.5" r="3.25" /><circle class="ring" cx="8.5" cy="24.5" r="3.25" />
            <circle cx="24" cy="16" r="3.75" stroke-dasharray="1.5 1.5" />
          </g>
        </svg>
        <p class="blank__title">${escapeHtml(titulo)}</p>
        <p class="blank__text">${aoVivo.length ? 'Escolha quem assistir aqui ou no barramento, embaixo.'
    : 'Quando alguém entrar ao vivo, aparece no barramento, embaixo.'}</p>
        <div class="stage-empty__acoes">${acoes}</div>
      </div>`);
  }

  // Os botoes do palco vazio: assistir alguem ou abrir o seletor de tela.
  gridEl.addEventListener('click', (event) => {
    const assistir = event.target.closest('.stage-empty [data-assistir]');
    if (assistir) onWatchIntent?.(assistir.dataset.assistir, 'only');
    if (event.target.closest('.stage-empty [data-transmitir]')) document.getElementById('btn-toggle-share')?.click();
  });

  function removeTile(id) {
    closeSpyWindow(id);
    const tileSaindo = document.getElementById(`tile-${id}`);
    if (tileSaindo) observadorCaixa.unobserve(tileSaindo);
    tileSaindo?.remove();
    // A lousa morre com a tela: parou de compartilhar, o desenho vai junto
    // (spec de 2026-09-04, secao 8) -- e o observador de tamanho tem de
    // soltar o elemento que acabou de sair do DOM.
    releaseTileAnnotations(id);
    syncGridCount();
    releaseTileAudio(id);
    tileRegistry.delete(id);
    tileWatchers.delete(id);
    tilePaused.delete(id);
    tileWatch.delete(id);
    tileHealth.delete(id);
    redesenharUltimasPresencas();
    pinnedPip.delete(id);
    pipLayout.delete(id);
    // A grade mudou: se o ultimo tile saiu, a sala nao pode mais ficar
    // ociosa (a barra de baixo vira a unica saida) -- e scheduleIdle e quem
    // sabe disso.
    scheduleIdle();
    if (id === fullscreenTileId) {
      // Quem estava em tela cheia parou de transmitir: a grade reaparece e
      // todo mundo que estava atras volta a ser pintado.
      fullscreenTileId = null;
      window.golive.setFullScreen(false);
      syncPainting();
    } else if (fullscreenTileId) {
      const fsTile = document.getElementById(`tile-${fullscreenTileId}`);
      if (fsTile) renderPipStrip(fsTile); // ja termina em syncPainting
    }
    renderEmptyGrid();
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
  // Cor do pincel. Nasce na cor da paleta derivada do meu id -- quem nunca
  // abrir o seletor continua desenhando na "sua" cor, como antes de a
  // escolha existir. Vale pra todos os tiles: e a MINHA tinta, nao uma
  // propriedade da lousa de alguem.
  let annotBrushColor = null;
  let onAnnotOp = null;

  // Laser e reacoes reaproveitam a MESMA barra/canvas do rabisco (spec de
  // 2026-09-12): o laser e uma terceira ferramenta de `annotTool`, e as duas
  // guardam o proprio estado em modulo puro (laser.js/reactions.js), igual
  // annotStore guarda o de rabisco. `laserStore` so tem UMA posicao por
  // pessoa (a mais recente) -- o "rastro" e efeito de desenho, nao lista de
  // pontos guardada. `reactionsStore` e indexado por tileId direto (nao por
  // surfaceId): reacao no tile NAO pede permissao nenhuma, entao nao precisa
  // do gate de `annotSurfaces` que o laser usa.
  const laserStore = laser?.createStore();
  const reactionsStore = reactions?.createStore();
  const reactionLimiter = reactions?.createBurstLimiter();
  let onLaserOp = null;
  let onReactionOp = null;
  let laserRafId = null; // requestAnimationFrame continuo enquanto ha ponto de laser vivo

  function brushColor() {
    return annotBrushColor || annotate.colorFor(annotSelfId);
  }

  const ANNOT_TOOLS = {
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    // Alvo com um ponto no meio -- o mesmo desenho que o proprio laser faz
    // na tela, so que virado icone.
    laser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    // Meio circulo com a seta pra tras. O icone antigo era o `rotate-ccw` do
    // Feather -- um arco de quase 360 graus, que le como "recarregar", nao
    // como "desfazer".
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h10a5 5 0 0 1 0 10h-3"/><polyline points="8 6 4 10 8 14"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    // Par ligado/desligado do toggle da barra: lapis inteiro e lapis cortado.
    // Mesma gramatica dos toggles da barra de controles (`.icon-off` /
    // `.icon-on`), e um so no com as duas formas dentro -- a classe `.hidden`
    // decide qual aparece (o atributo `hidden` nao esconde <svg>).
    penOn: '<svg class="icon-on hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    penOff: '<svg class="icon-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
  };

  // Emojis de reacao: conteudo da lista fechada de reactions.js, nao icone
  // de UI -- por isso NAO entram em ANNOT_TOOLS (que e so SVG de ferramenta).
  const REACTION_EMOJI_LABEL = {
    '👍': 'like', '😂': 'risada', '😮': 'surpresa', '🔥': 'fogo', '👏': 'palmas', '❤️': 'coração',
  };

  function annotSetSelf(id) {
    annotSelfId = id == null ? 'me' : String(id);
    for (const tileId of annotSurfaces.keys()) syncAnnotBar(tileId);
  }

  /** Liga (ou desliga) a lousa de um tile. `surfaceId` e o dono da tela --
   * a chave da lousa, igual dos dois lados do fio. `allowed: false` desliga
   * tudo e apaga: quem parou de compartilhar levou a lousa junto.
   *
   * `canDraw` e `canClearAll` sao os dois papeis, e sao mutuamente
   * exclusivos na pratica: a tela e sua (apaga tudo, nao desenha) ou e de
   * outra pessoa (desenha, nao apaga tudo). A regra de verdade mora em
   * `annotate.opAllowed`, que barra a op no deposito mesmo se a interface
   * deixar passar -- aqui e so o que a barra MOSTRA. */
  function setAnnotSurface(tileId, { surfaceId, allowed, canClearAll = false, canDraw = true } = {}) {
    const tile = document.getElementById(`tile-${tileId}`);
    if (!allowed || !surfaceId) {
      if (annotSurfaces.has(tileId)) {
        const old = annotSurfaces.get(tileId);
        annotStore.drop(old.surfaceId);
      }
      annotSurfaces.delete(tileId);
      if (annotDrawingTile === tileId) setAnnotDrawing(tileId, false);
      if (tile) {
        tile.classList.remove('annotatable', 'annot-on');
        tile.querySelector('.draw-bar').hidden = true;
        clearAnnotCanvas(tile);
      }
      return;
    }
    annotSurfaces.set(tileId, { surfaceId: String(surfaceId), canClearAll, canDraw });
    if (!tile) return;
    tile.classList.add('annotatable');
    // A barra nasce visivel: era ela que o lapis do canto do tile abria, e
    // esse lapis saiu. Quem some com ela agora e a ociosidade do mouse.
    tile.querySelector('.draw-bar').hidden = false;
    if (!canDraw && annotDrawingTile === tileId) setAnnotDrawing(tileId, false);
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
    // O dono sai da chave COMPOSTA ('7:screen'), nao da chave inteira:
    // comparar com a chave toda faria o "apagar tudo" do proprio dono ser
    // descartado aqui em silencio.
    if (op?.op === 'clear' && op.scope === 'all'
        && String(from) !== String(annotate.parseSurface(surfaceId).ownerId)) return;
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

  /** Um peer saiu da sala: apaga o que ele rabiscou na tela de todo mundo
   * que ficou. Redesenha so as superficies que de fato mudaram e devolve os
   * surfaceIds -- o app.js usa isso pra saber se precisa recarregar o
   * overlay da tela real. */
  function forgetAnnotAuthor(peerId) {
    const changed = annotStore.dropAuthor(peerId);
    if (!changed.length) return [];
    const alvo = new Set(changed.map(String));
    for (const [tileId, info] of annotSurfaces) {
      if (alvo.has(String(info.surfaceId))) {
        redrawAnnot(tileId);
        syncAnnotBar(tileId);
      }
    }
    return changed;
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

  function clearAnnotSurface(tileId) {
    emitAnnotOp(tileId, { op: 'clear', scope: 'all' });
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

  // ---------- Laser e reacoes (enderecamento tileId <-> surfaceId) ----------
  //
  // O protocolo endereca por '<dono>:<kind>' (surfaceKey), igual o rabisco --
  // mas quem desenha na tela pensa em tileId ('me', '7', 'cam-7'). Estas duas
  // funcoes sao o unico lugar que traduz entre os dois sentidos, espelhando
  // exatamente como app.js ja registra `annotSurfaces` pra cada tile (myId no
  // lugar do tileId local 'me').

  function surfaceForTile(tileId) {
    const id = String(tileId);
    const isCam = id.startsWith('cam-');
    const raw = isCam ? id.slice(4) : id;
    const owner = raw === 'me' ? annotSelfId : raw;
    return annotate.surfaceKey(owner, isCam ? 'camera' : 'screen');
  }

  function tileIdForSurface(surfaceId) {
    const { ownerId, kind } = annotate.parseSurface(surfaceId);
    const owner = String(ownerId) === String(annotSelfId) ? 'me' : ownerId;
    return kind === 'camera' ? `cam-${owner}` : owner;
  }

  // ---------- Laser ----------
  //
  // Terceira ferramenta da MESMA barra/canvas do rabisco (annotTool ===
  // 'laser'). So chega aqui quem o dono da tela ja deixou rabiscar -- o
  // gate e o mesmo `annotSurfaces`, e por isso `applyRemoteLaser` confere
  // que o tile ESTA registrado com ESTA superficie antes de desenhar
  // qualquer coisa: sem isso um laser pra uma tela sem permissao ainda
  // apareceria, so o rabisco de fato ficaria barrado.

  /** Um ponto de laser chegou da rede. Devolve o tileId onde ele deveria
   * aparecer, ou null se a superficie nao esta liberada (tile nao
   * registrado, ou registrado com outra superficie). */
  function applyRemoteLaser(surfaceId, from, op) {
    if (!laserStore) return;
    const tileId = tileIdForSurface(surfaceId);
    const info = annotSurfaces.get(tileId);
    if (!info || info.surfaceId !== String(surfaceId)) return; // dono nao permitiu, ou tile nao existe mais
    if (!laserStore.apply(surfaceId, from, op, Date.now())) return;
    scheduleLaserLoop();
    redrawAnnot(tileId);
  }

  /** Peer saiu da sala: o ponto dele para de existir em TODAS as
   * superficies -- mesmo padrao do rabisco orfao (forgetAnnotAuthor), so
   * que aqui nao ha nada pra redesenhar alem do proximo quadro do loop, que
   * ja vai rodar sozinho enquanto houver outros pontos vivos. */
  function forgetLaserAuthor(peerId) {
    laserStore?.dropAuthor(peerId);
  }

  /** A tela parou (ou trocou): o laser dela nao faz mais sentido. */
  function dropLaserSurface(surfaceId) {
    laserStore?.drop(String(surfaceId));
  }

  /** Loop de repintura barato: enquanto existir pelo menos um ponto de
   * laser vivo em QUALQUER superficie, um requestAnimationFrame redesenha
   * os tiles afetados pra o rastro desbotar mesmo sem pacote novo chegando
   * (o ponto morre por IDADE, nao por mensagem -- ver laser.js). Para
   * sozinho quando `active` volta vazio; so um loop por vez. */
  function scheduleLaserLoop() {
    if (laserRafId !== null || !laserStore) return;
    const step = () => {
      laserRafId = null;
      const now = Date.now();
      const ativos = laserStore.active(now, laser.TTL_MS);
      if (!ativos.length) return; // nada vivo: o loop se apaga sozinho
      const superficiesVivas = new Set(ativos.map((p) => String(p.surfaceId)));
      for (const [tileId, info] of annotSurfaces) {
        if (superficiesVivas.has(String(info.surfaceId))) redrawAnnot(tileId);
      }
      laserRafId = requestAnimationFrame(step);
    };
    laserRafId = requestAnimationFrame(step);
  }

  // ---------- Reacoes ----------
  //
  // Ao contrario do laser, reacao no tile NAO pede a permissao do rabisco
  // (spec, secao 2) -- por isso o deposito e indexado por tileId direto, e
  // NAO passa pelo gate de `annotSurfaces`. `surfaceForTile` so entra na
  // hora de mandar pra rede (o protocolo endereca por superficie, igual o
  // resto); o que chega da rede ja vem traduzido pro tileId por
  // `applyRemoteReaction`.

  /** `spawnReactionPop` e declarada mais abaixo (secao "desenho") -- chamada
   * aqui por nome, nao por variavel: `function` e hoisted no escopo do
   * modulo, e as duas coisas sao a MESMA reacao (dado + desenho), so que
   * fisicamente separadas pra ficar perto do resto de cada assunto. */
  function applyRemoteReaction(surfaceId, from, emoji) {
    if (!reactionsStore) return;
    const now = Date.now();
    reactionsStore.prune(now); // rega o deposito de bolhas mortas de qualquer tile, nao so deste
    const tileId = tileIdForSurface(surfaceId);
    if (!document.getElementById(`tile-${tileId}`)) return; // ninguem esta vendo essa tela agora
    const bolha = reactionsStore.apply(tileId, from, emoji, now);
    if (bolha) spawnReactionPop(tileId, bolha);
  }

  function forgetReactionAuthor(peerId) {
    reactionsStore?.dropAuthor(peerId);
    for (const el of document.querySelectorAll('.react-pop')) {
      if (el.dataset.author === String(peerId)) el.remove();
    }
  }

  /** Clique na barra de reacao de UM tile: aplica local na hora (quem
   * clicou ve a propria reacao subir sem esperar o servidor, mesmo padrao
   * de `emitAnnotOp`) e manda pra rede. */
  function emitReactionOp(tileId, emoji) {
    if (!reactionsStore) return;
    const now = Date.now();
    reactionsStore.prune(now);
    if (reactionLimiter && !reactionLimiter.hit(now)) return;
    const bolha = reactionsStore.apply(tileId, annotSelfId, emoji, now);
    if (!bolha) return; // emoji fora da lista fechada -- nem local nem rede
    spawnReactionPop(tileId, bolha);
    onReactionOp?.(surfaceForTile(tileId), emoji);
  }

  /** Botoes da barra de reacao: um por emoji da lista FECHADA de
   * reactions.js. O emoji e conteudo (aparece no botao), nao vira <svg> --
   * o `aria-label` que carrega o nome e o que mantem o botao acessivel. */
  function reactionBarButtonsHtml() {
    if (!reactions) return '';
    return reactions.REACTIONS.map((e) => {
      const nome = REACTION_EMOJI_LABEL[e] || e;
      return `<button type="button" class="react-btn" data-emoji="${e}" title="Reagir com ${nome}" aria-label="Reagir com ${nome}">${e}</button>`;
    }).join('');
  }

  /** Reagir pelo barramento: vai para a fonte principal do palco (a primeira
   * tela a mostra; sem tela, a primeira camera). */
  function tileDaReacao() {
    const visiveis = [...gridEl.querySelectorAll('.tile:not([hidden])')];
    const alvo = visiveis.find((tile) => tile.dataset.kind !== 'camera') || visiveis[0];
    return alvo ? alvo.id.slice('tile-'.length) : null;
  }
  const btnReacoesEl = $('btn-reactions');
  btnReacoesEl?.addEventListener('click', () => {
    const tileId = tileDaReacao();
    if (tileId) openReactionPopover(btnReacoesEl, tileId);
  });

  function openReactionPopover(anchor, tileId) {
    const list = document.createElement('div');
    list.className = 'react-list';
    list.innerHTML = reactionBarButtonsHtml();
    // Itens do menu: o popover so navega (setas, Home/End) e poe o foco
    // inicial em [role^="menuitem"]. Sem o papel, o foco nao ia ao 1o emoji.
    for (const botao of list.querySelectorAll('.react-btn')) botao.setAttribute('role', 'menuitem');
    const controller = openPopover({ anchor, content: list });
    list.addEventListener('click', (event) => {
      const button = event.target.closest('.react-btn');
      if (!button) return;
      emitReactionOp(tileId, button.dataset.emoji);
      controller.close();
    });
  }

  function wireTileBar(tile, tileId) {
    const hud = tile.querySelector('.tile__hud');
    hud?.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-acao]');
      if (!button) return;
      event.stopPropagation();
      switch (button.dataset.acao) {
        case 'reagir':
          openReactionPopover(button, tileId);
          break;
        case 'rabiscar':
          setAnnotDrawing(tileId, !tile.classList.contains('annot-on'));
          break;
        case 'volume':
          openTileMenu(tileId, button);
          break;
        case 'espiar':
          openSpyWindow(tileId);
          break;
        case 'tela-cheia':
          toggleTileFullscreen(tile, tileId);
          break;
        case 'menu':
          openTileMenu(tileId, button);
          break;
        case 'parar':
          onWatchIntent?.(tileId, 'remove');
          break;
        default:
          break;
      }
    });
    // Um clique no HUD nao pode virar o duplo-clique de tela cheia.
    hud?.addEventListener('dblclick', (event) => event.stopPropagation());
  }

  // Acoes do HUD (05 §3.3). As marcadas "extra" saem primeiro quando o tile
  // fica estreito (container query em shell.css); "opcional" sai depois. As
  // que somem continuam no menu ⋯ ou no duplo clique.
  const TILE_HUD_ACOES = [
    ['rabiscar', 'Rabiscar', 'pen-line', 'data-hud-extra'],
    ['reagir', 'Reagir', 'smile-plus', 'data-hud-extra'],
    ['espiar', 'Espiar numa janela por cima', 'picture-in-picture-2', 'data-hud-extra'],
    ['volume', 'Volume', 'volume-2', ''],
    ['tela-cheia', 'Tela cheia', 'maximize', 'data-hud-optional'],
    ['menu', 'Mais opções', 'ellipsis', ''],
    ['parar', 'Parar de assistir', 'x', 'hidden'],
  ];
  const TILE_HUD_HTML = `
    <div class="tile__hud">
      <div class="tile__who">
        <span class="node" data-size="24"></span>
        <span class="tile__label"><span class="tile__name"></span><span class="tile__what"></span></span>
        <span class="tile__watchers"></span>
      </div>
      <div class="tile__actions">${TILE_HUD_ACOES.map(([acao, nome, icone, extra]) => `
        <button class="btn btn--icon btn--sm" type="button" data-acao="${acao}" title="${nome}"
                aria-label="${nome}" ${extra}><svg class="i i--sm"><use href="#i-${icone}" /></svg></button>`)
    .join('')}
      </div>
    </div>`;

  /** Nome, o que transmite e o no da pessoa no HUD. Tela = no ao vivo;
   * camera = no ao vivo com a marca de camera. */
  function renderTileWho(tile, tileId, name, kind, avatar) {
    const node = tile.querySelector('.tile__who .node');
    const nameEl = tile.querySelector('.tile__name');
    const whatEl = tile.querySelector('.tile__what');
    if (!node || !nameEl) return;
    const personId = String(tileId).replace(/^cam-/, '');
    node.dataset.state = 'live';
    node.style.setProperty('--who', avatarColorFor(personId));
    node.innerHTML = avatarInnerHtml(personId, name, avatar);
    if (kind === 'camera') {
      node.insertAdjacentHTML('beforeend', '<span class="node__mark"><svg class="i"><use href="#i-video" /></svg></span>');
    }
    nameEl.textContent = name || 'Alguém';
    whatEl.textContent = kind === 'camera' ? 'câmera' : '';
  }

  /** Mantem o nome da funcao antiga: renderWatchGate e o PiP chamam depois
   * de mover o video de volta. O HUD agora nasce junto do tile. */
  function ensureTileBar(tile) {
    return tile.querySelector('.tile__hud');
  }

  /** Sobe um emoji sobre o tile e o remove sozinho quando a animacao
   * termina. `prefers-reduced-motion` troca a keyframe (CSS) por uma que so
   * aparece/some, sem subir -- entao aqui tambem troca o evento que espera:
   * uma animacao sem deslocamento ainda dispara `animationend`, entao o
   * mesmo listener serve pros dois casos. */
  function spawnReactionPop(tileId, bubble) {
    const tile = document.getElementById(`tile-${tileId}`);
    const host = tile?.querySelector('.tile__pops');
    if (!host) return;
    const el = document.createElement('span');
    el.className = 'react-pop';
    el.dataset.author = String(bubble.from);
    el.textContent = bubble.emoji;
    // Posicao horizontal aleatoria (dentro de uma faixa central) pra
    // reacoes simultaneas nao empilharem exatamente uma em cima da outra.
    el.style.left = `${28 + Math.round(Math.random() * 44)}%`;
    // 5vw era a largura da JANELA, nao a do tile: numa grade de seis o
    // emoji saia desproporcional, e na tira ficava maior que a miniatura
    // inteira. O clamp() do CSS fica de rede pra quando a medida vier 0
    // (tile ainda nao medido). Redimensionar a janela no meio da animacao
    // nao reajusta -- irrelevante: o emoji vive 1,4s.
    const larguraTile = tile.clientWidth || 0;
    if (larguraTile) {
      el.style.fontSize = `${Math.round(Math.min(72, Math.max(14, larguraTile * 0.12)))}px`;
    }
    host.appendChild(el);
    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    // Rede de seguranca: se por algum motivo a animacao nunca disparar
    // `animationend` (aba em segundo plano, por exemplo), o elemento nao
    // fica pendurado pra sempre.
    setTimeout(remove, reactions.TTL_MS + 500);
  }

  // ---- desenho ----

  function annotCanvasOf(tile) {
    return tile?.querySelector('.tile__canvas') || null;
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
      // colorOf e nao colorFor: a cor agora viaja no item. Sem cor escolhida
      // cai na de quem desenhou -- mesma regra, e o mesmo codigo, que o
      // canvas da tela real usa (overlay.js).
      const cor = annotate.colorOf(item);
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

    // Laser: MESMO canvas do rabisco (nao vale abrir um segundo elemento so
    // pra um ponto). O deposito guarda so a posicao mais recente de cada
    // pessoa (laser.js) -- o "rastro curto" e o brilho/desbote deste
    // desenho, nao uma lista de pontos historicos. `age` decide a opacidade:
    // 0 = acabou de chegar (cheio), TTL = a hora de sumir (zero).
    if (laserStore) {
      const now = Date.now();
      for (const pt of laserStore.active(now, laser.TTL_MS)) {
        if (pt.surfaceId !== String(surfaceId)) continue;
        const p = annotate.toPx(pt.x, pt.y, rect);
        const cor = annotate.colorFor(pt.from);
        const opacidade = Math.max(0, 1 - pt.age / laser.TTL_MS);
        ctx.globalAlpha = opacidade;
        ctx.fillStyle = cor;
        ctx.shadowColor = cor;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Liga/desliga o modo de desenho de um tile. Com ele desligado o canvas
   * e `pointer-events: none` -- o duplo clique do fullscreen, o botao
   * direito do mute e o arrasto do PiP continuam funcionando como sempre.
   * E a razao de o modo ser explicito: o tile ja tem quatro gestos, e
   * roubar todos eles pra caneta seria pior que um clique a mais. */
  function setAnnotDrawing(tileId, on) {
    // Quem e dono da tela nao arma a caneta na propria tela, nem por teclado
    // nem por um estado torto -- a mesma regra que `annotate.opAllowed` ja
    // garante no deposito.
    if (on && !annotSurfaces.get(tileId)?.canDraw) return;
    if (on && annotDrawingTile && annotDrawingTile !== tileId) setAnnotDrawing(annotDrawingTile, false);
    const tile = document.getElementById(`tile-${tileId}`);
    if (!tile) return;
    tile.classList.toggle('annot-on', on);
    annotDrawingTile = on ? tileId : (annotDrawingTile === tileId ? null : annotDrawingTile);
    // A barra continua ali dos dois jeitos -- e ela que carrega o toggle.
    // O que muda e o proprio toggle, as ferramentas travadas e o canvas
    // passando (ou nao) a receber ponteiro.
    syncAnnotBar(tileId);
    if (!on) closeAnnotTextInput(tile);
  }

  /** Remonta a barra a partir do estado. Duas barras diferentes, porque sao
   * dois papeis diferentes (spec de 2026-09-05, secao 2):
   *
   *   - Quem ASSISTE tem o toggle, as duas ferramentas, desfazer, apagar os
   *     seus e a bolinha da propria cor.
   *   - Quem e DONO da tela tem um botao so: apagar tudo. Ele nao rabisca na
   *     propria tela -- ja tem o cursor dele ali.
   *
   * O `✕` que existia no fim saiu: desligar e o toggle, e sair sem desligar
   * nao precisava de botao. */
  function syncAnnotBar(tileId) {
    const tile = document.getElementById(`tile-${tileId}`);
    const bar = tile?.querySelector('.draw-bar');
    const surfaceId = annotSurfaceOf(tileId);
    if (!bar || !surfaceId) return;
    const info = annotSurfaces.get(tileId);

    if (!info.canDraw) {
      bar.innerHTML = info.canClearAll
        ? `<button type="button" class="btn btn--danger btn--sm annot-tool" data-act="clear-all" title="Apagar tudo que a sala rabiscou na sua tela" aria-label="Apagar tudo que a sala rabiscou na sua tela">${ANNOT_TOOLS.clear}<span>Apagar tudo</span></button>`
        : '';
      return;
    }

    const desenhando = tile.classList.contains('annot-on');
    const temMeu = annotStore.hasFrom(surfaceId, annotSelfId);
    // As ferramentas ficam DESABILITADAS com o toggle desligado, nunca
    // removidas: a barra nao pode mudar de largura ao ligar e desligar.
    const travado = desenhando ? '' : ' disabled';
    bar.innerHTML = `
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool annot-toggle${desenhando ? ' active' : ''}" data-act="toggle"
              aria-pressed="${desenhando}"
              title="${desenhando ? 'Desativar rabisco' : 'Ativar rabisco'}"
              aria-label="${desenhando ? 'Desativar rabisco' : 'Ativar rabisco'}">${ANNOT_TOOLS.penOff}${ANNOT_TOOLS.penOn}</button>
      <span class="draw-bar__sep" aria-hidden="true"></span>
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool${annotTool === 'pen' ? ' active' : ''}" data-tool="pen" title="Caneta" aria-label="Caneta"${travado}>${ANNOT_TOOLS.pen}</button>
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool${annotTool === 'text' ? ' active' : ''}" data-tool="text" title="Escrever" aria-label="Escrever"${travado}>${ANNOT_TOOLS.text}</button>
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool${annotTool === 'laser' ? ' active' : ''}" data-tool="laser" title="Laser" aria-label="Laser"${travado}>${ANNOT_TOOLS.laser}</button>
      <span class="draw-bar__sep" aria-hidden="true"></span>
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool" data-act="undo" title="Desfazer o meu último" aria-label="Desfazer o meu último"${temMeu ? '' : ' disabled'}>${ANNOT_TOOLS.undo}</button>
      <button type="button" class="btn btn--quiet btn--icon btn--sm annot-tool" data-act="clear-mine" title="Apagar os meus" aria-label="Apagar os meus"${temMeu ? '' : ' disabled'}>${ANNOT_TOOLS.clear}</button>
      <span class="draw-bar__sep" aria-hidden="true"></span>
      <input type="color" class="annot-ink" data-act="ink" value="${brushColor()}"
             title="Cor do seu pincel" aria-label="Cor do seu pincel"${travado}>`;

    // O par de icones do toggle segue a mesma regra do resto do app: classe
    // `.hidden`, nunca o atributo -- `hidden` nao esconde um <svg>.
    const toggle = bar.querySelector('.annot-toggle');
    toggle.querySelector('.icon-off').classList.toggle('hidden', desenhando);
    toggle.querySelector('.icon-on').classList.toggle('hidden', !desenhando);
  }

  /** Amarra o tile ao sistema de anotacao, uma vez, na criacao dele. Todo
   * o resto e delegado (a barra e remontada a cada mudanca de estado, entao
   * ouvir no container e o que evita religar listener a cada render). */
  function wireTileAnnotations(tile, tileId) {
    const canvas = annotCanvasOf(tile);
    const bar = tile.querySelector('.draw-bar');

    // O seletor de cor e um <input>, nao um <button>: ouve 'input' (dispara
    // a cada arrasto dentro do seletor nativo), e de proposito NAO chama
    // syncAnnotBar -- ela reescreve o innerHTML da barra e fecharia o
    // seletor no meio da escolha. O proprio input ja mostra a cor nova, e
    // `annotBrushColor` e o unico estado que precisa mudar.
    bar.addEventListener('input', (e) => {
      const ink = e.target.closest('.annot-ink');
      if (!ink) return;
      annotBrushColor = annotate.normalizeColor(ink.value) || null;
    });

    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.dataset.tool) {
        annotTool = btn.dataset.tool;
        syncAnnotBar(tileId);
        return;
      }
      switch (btn.dataset.act) {
        case 'toggle': setAnnotDrawing(tileId, !tile.classList.contains('annot-on')); break;
        case 'undo': emitAnnotOp(tileId, { op: 'undo' }); break;
        case 'clear-mine': emitAnnotOp(tileId, { op: 'clear', scope: 'mine' }); break;
        case 'clear-all': emitAnnotOp(tileId, { op: 'clear', scope: 'all' }); break;
        default: break;
      }
    });

    // A barra vive por cima do video: um clique nela nao pode virar o
    // duplo-clique que joga o tile em fullscreen, nem o arrasto do PiP.
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('dblclick', (e) => e.stopPropagation());

    // Um traco por vez por tile. `pending` junta os pontos do quadro
    // corrente: um `points` por quadro de animacao, nao um por pointermove
    // (~180 mensagens num traco de 3s viram ~50).
    let stroke = null;
    let pending = [];
    let flushTimer = null;
    let lastLaserSentAt = 0; // throttle de envio do laser (laser.shouldEmit)

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
      // Laser nao comeca traco nenhum -- so o pointermove manda posicao (ver
      // abaixo). O clique aqui nao faz nada de proposito, senao um clique
      // acidental de quem so queria apontar abriria a caixa de texto ou um
      // traco de um ponto so.
      if (annotTool === 'laser') return;
      const p = pointOf(event);
      if (annotTool === 'text') {
        // preventDefault e o que faz a escrita funcionar. A acao padrao do
        // mousedown que vem logo depois deste pointerdown move o foco pro
        // elemento clicado -- o canvas, que nao e focavel, entao o foco ia
        // pro body e o campo recem-criado levava um `blur` no mesmo clique.
        // O listener de blur chamava commit(), que removia o campo vazio: a
        // caixa de texto abria e sumia antes de dar pra digitar uma letra.
        event.preventDefault();
        openAnnotTextInput(tile, tileId, p, event);
        return;
      }
      stroke = `${annotSelfId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      canvas.setPointerCapture(event.pointerId);
      emitAnnotOp(tileId, { op: 'begin', id: stroke, x: p.x, y: p.y, width: 4, color: brushColor() });
    });

    canvas.addEventListener('pointermove', (event) => {
      // Laser: SO manda, nunca desenha local -- o proprio cursor de quem
      // aponta ja mostra onde ele esta; desenhar de novo seria redundante
      // so pra quem esta apontando (ver spec, secao 5.1). Nao depende de
      // `stroke` (nao ha traco no laser) nem de pointerdown ter rodado.
      if (annotTool === 'laser') {
        if (!tile.classList.contains('annot-on')) return;
        const now = Date.now();
        if (!laser?.shouldEmit(lastLaserSentAt, now, laser.EMIT_HZ)) return;
        lastLaserSentAt = now;
        const p = pointOf(event);
        onLaserOp?.(annotSurfaceOf(tileId), { x: p.x, y: p.y });
        return;
      }
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
    // Na janela da Mesa o tile esta dentro do mundo com zoom (transform no
    // conteiner): o retangulo da tela e o de layout vezes a escala, e o
    // campo e posicionado em px de layout. No palco a escala e 1. (Os pontos
    // do rabisco nao precisam disto: sao normalizados pela caixa do video,
    // e a escala some na divisao.)
    const escala = tile.offsetWidth ? box.width / tile.offsetWidth : 1;
    input.style.left = `${(event.clientX - box.left) / escala}px`;
    input.style.top = `${(event.clientY - box.top) / escala}px`;
    input.style.color = annotate.colorFor(annotSelfId);
    tile.appendChild(input);
    // Focar no quadro seguinte, nao dentro do pointerdown: o preventDefault
    // acima ja impede o roubo de foco, e adiar tira a corrida do caminho de
    // qualquer navegador que ainda mova o foco por outra via.
    requestAnimationFrame(() => input.focus());

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
        color: brushColor(),
      });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // Esc aqui nao pode fechar modal nenhum
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') input.remove();
    });
    // "Clicar fora fecha" so passa a valer DEPOIS que o campo teve o foco de
    // verdade. Um blur que chegue antes do primeiro focus nao e a pessoa
    // desistindo -- e o navegador tirando o foco de um campo que ela ainda
    // nem viu, e apagar o campo ali e o bug que a escrita tinha.
    input.addEventListener('focus', () => input.addEventListener('blur', commit), { once: true });
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
    document.getElementById(`tile-${oldId}`)?.classList.remove('fullscreen', 'idle');
    newTile.classList.add('fullscreen');
    fullscreenTileId = newId;
    pinnedPip.delete(newId);
    if (oldId) pinnedPip.add(oldId);
    renderPipStrip(newTile); // ja termina em syncPainting
    scheduleIdle();
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
    addBtn.innerHTML = '<svg class="i i--sm" aria-hidden="true"><use href="#i-plus" /></svg>Miniatura';
    addBtn.setAttribute('aria-label', 'Mostrar outra fonte em miniatura');
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openPipPicker(addBtn, id);
    });
    strip.appendChild(addBtn);
    // As miniaturas sao <video> NOVOS, criados com autoplay: sem isto elas
    // comecariam a tocar mesmo com a janela minimizada (F1.4). Aqui, no fim
    // de renderPipStrip, cobre todos os caminhos que remontam a faixa --
    // entrar em fullscreen, trocar o foco, e adicionar ou remover uma
    // miniatura pelo seletor.
    syncPainting();
  }

  function closeTileMenu() {
    closePopover();
  }

  /** Menu de contexto do tile: o que e sobre AQUELA TELA -- silenciar e
   * volume, os dois locais (GainNode, sem passar pelo servidor).
   *
   * O cabecalho com nome e avatar nao e enfeite: "Silenciar" saiu do menu ⋮
   * do membro (2026-09-04, secao 3.2) e este virou o unico lugar onde se
   * silencia alguem. Sem dizer de QUEM e o menu, a resposta pra "silenciar
   * quem?" so viria depois do clique. */
  function openTileMenu(id, x, y, { mesa = false } = {}) {
    closeTileMenu();
    const anchor = x instanceof Element ? x : null;
    const point = anchor ? null : { x, y };
    const state = getOrCreateAudioState(id);
    const entry = tileRegistry.get(id);
    const nome = entry?.displayName || entry?.label || 'esta tela';
    const kind = entry?.kind || (String(id).startsWith('cam-') ? 'camera' : 'screen');

    // Parar (ou voltar) de assistir. Camera e opt-out: sem estado
    // registrado ela conta como assistida, entao o menu oferece "parar".
    // Tela e opt-in: so oferece "parar" quando de fato se esta assistindo
    // (quando nao, o proprio cartao do tile ja tem o "Assistir").
    const isCam = String(id).startsWith('cam-');
    const ws = tileWatch.get(id);
    const watched = !ws || ws.watched;
    let watchItem = '';
    if (isCam) {
      watchItem = watched
        ? '<button type="button" class="tile-menu-watch" data-watch="remove">Parar de assistir esta câmera</button>'
        : '<button type="button" class="tile-menu-watch" data-watch="only">Assistir câmera</button>';
    } else if (watched && ws && !mesa) {
      // Na Mesa quem decide se a tela chega e a janela estar a vista
      // (mesa-view `wants`): "parar de assistir" ali nao faria nada.
      watchItem = '<button type="button" class="tile-menu-watch" data-watch="remove">Parar de assistir esta tela</button>';
    }
    const items = tileMenu.menuItems({ id, kind, watched, mesa });
    const qualidadeBloqueada = items.includes('qualidade')
      && root.GoLive.tetoRecebido.bloqueado(`${id}:screen`);
    const spyItem = items.includes('espiar')
      ? '<button type="button" role="menuitem" class="menu__item tile-menu-spy">Espiar em janela</button>'
      : '';
    const qualityItem = items.includes('qualidade')
      ? `<button type="button" role="menuitem" class="menu__item tile-menu-quality"
          aria-haspopup="menu" aria-expanded="false">
          Qualidade que você recebe <span class="menu__hint">›</span>
        </button>`
      : '';
    const pararItem = watchItem
      ? watchItem.replace('class="tile-menu-watch"', 'class="menu__item tile-menu-watch" role="menuitem"')
      : '';
    const abrirGrupoVer = spyItem
      ? '<div class="menu__sep" role="separator"></div>'
        + '<div class="menu__group" role="group" aria-label="Ver">'
      : '';
    const abrirGrupoQualidade = qualityItem
      ? '<div class="menu__sep" role="separator"></div>'
        + '<div class="menu__group" role="group" aria-label="Qualidade">'
      : '';
    const abrirGrupoAssistir = pararItem
      ? '<div class="menu__sep" role="separator"></div>'
        + '<div class="menu__group" role="group" aria-label="Assistir">'
      : '';

    const menu = document.createElement('div');
    menu.className = 'tile-menu';
    menu.innerHTML = `
      <div class="menu__label">
        <span class="tile-menu-name" title="${escapeHtml(nome)}">${escapeHtml(nome)}</span>
      </div>
      <div class="menu__group" role="group" aria-label="Som">
      <label class="menu__volume">
        <span class="menu__volume-head"><span>Volume</span><b class="tile-menu-volume-label tx-data">${Math.round(state.volume * 100)}%</b></span>
        <input type="range" class="range" min="0" max="200" step="1" aria-label="Volume"
          value="${Math.round(state.volume * 100)}" style="--pct:${Math.round(state.volume * 50)}%" />
      </label>
      <label class="menu__item menu__item--check">
        <input type="checkbox" role="menuitemcheckbox" class="sr-only tile-menu-mute"
          aria-checked="${isMuted(id)}" ${isMuted(id) ? 'checked' : ''} />
        Silenciar <span class="menu__hint">M</span>
      </label>
      </div>
      ${abrirGrupoVer}
      ${spyItem}
      ${spyItem ? '</div>' : ''}
      ${abrirGrupoQualidade}
      ${qualityItem}
      ${qualityItem ? '</div>' : ''}
      ${abrirGrupoAssistir}
      ${pararItem}
      ${pararItem ? '</div>' : ''}`;
    menu.addEventListener('click', (event) => event.stopPropagation());
    let muteCheckbox;
    const popoverControl = openPopover({
      anchor,
      point,
      content: menu,
      onKeydown: (event) => {
        const texto = event.target.matches?.(
          'input:not([type="range"]):not([type="checkbox"]), textarea, select'
        );
        if (texto || event.key.toLowerCase() !== 'm') return;
        event.preventDefault();
        muteCheckbox.click();
      },
    });

    function applyGain() {
      if (state.gain) state.gain.gain.value = state.muted ? 0 : state.volume;
    }

    menu.querySelector('.tile-menu-watch')?.addEventListener('click', (event) => {
      if (event.currentTarget.dataset.watch === 'remove') closeSpyWindow(id);
      onWatchIntent?.(id, event.currentTarget.dataset.watch);
      closeTileMenu();
    });
    menu.querySelector('.tile-menu-spy')?.addEventListener('click', () => {
      openSpyWindow(id);
      closeTileMenu();
    });
    menu.querySelector('.tile-menu-quality')?.addEventListener('click', () => {
      const bloqueado = qualidadeBloqueada;
      const submenu = document.createElement('div');
      submenu.className = 'tile-quality-menu';
      const opcoes = root.GoLive.tetoRecebido.OPCOES;
      const escolha = root.GoLive.tetoRecebido.escolha(`${id}:screen`);
      const opcoesHtml = opcoes.map((opcao) => {
        const atual = escolha === opcao.id;
        return `<button type="button" role="menuitemradio" class="menu__item"`
          + ` data-quality="${opcao.id}" aria-checked="${atual}" aria-disabled="${bloqueado}">`
          + `<span aria-hidden="true">${atual ? '✓' : ''}</span>`
          + `<span>${tileMenu.qualityLabel(opcao.id)}</span></button>`;
      }).join('');
      submenu.innerHTML = `
        <div class="menu__label">
          <button type="button" role="menuitem" class="menu__item tile-menu-back">
            <span aria-hidden="true">‹</span> Qualidade que você recebe
          </button>
        </div>
        <div class="menu__group" role="group" aria-label="Qualidade que você recebe">
          ${opcoesHtml}
        </div>
        ${bloqueado ? '<p class="menu__note">Você repassa esta tela para outras pessoas</p>' : ''}`;
      menu.querySelector('.tile-menu-quality').setAttribute('aria-expanded', 'true');
      popoverControl.openSubmenu({
        content: submenu,
        focus: '[role="menuitemradio"][aria-checked="true"]',
        onReturn: () => menu.querySelector('.tile-menu-quality').setAttribute('aria-expanded', 'false'),
      });
      submenu.querySelector('.tile-menu-back').addEventListener('click', () => {
        popoverControl.voltar();
      });
      submenu.addEventListener('click', (click) => {
        const option = click.target.closest('[data-quality]');
        if (!option || bloqueado) return;
        root.GoLive.tetoRecebido.escolher(`${id}:screen`, option.dataset.quality);
        closeTileMenu();
      });
    });

    muteCheckbox = menu.querySelector('.tile-menu-mute');
    muteCheckbox.addEventListener('change', () => {
      // setMuted (e nao `state.muted = ...`) pra que exista UM caminho de
      // codigo pra silenciar, agora que este e o unico lugar da UI que o
      // oferece.
      setMuted(id, muteCheckbox.checked);
      muteCheckbox.setAttribute('aria-checked', String(muteCheckbox.checked));
    });

    const range = menu.querySelector('input[type=range]');
    range.addEventListener('wheel', (event) => {
      event.preventDefault();
      range.value = String(Math.max(0, Math.min(200, Number(range.value) + (event.deltaY < 0 ? 5 : -5))));
      range.dispatchEvent(new Event('input'));
    }, { passive: false });
    const volumeLabel = menu.querySelector('.tile-menu-volume-label');
    range.addEventListener('input', () => {
      state.volume = Number(range.value) / 100;
      volumeLabel.textContent = `${range.value}%`;
      range.style.setProperty('--pct', `${Number(range.value) / 2}%`);
      applyGain();
    });

    // Bubble phase (nao capture): o listener de `click` do proprio menu, que
    // chama stopPropagation, roda ANTES desse e impede que ele chegue aqui
    // quando o clique foi dentro do menu (botao de mute, slider). Em fase de
    // captura isso nao funcionaria -- stopPropagation na fase de bolha nao
    // afeta um listener de captura no document, que ja teria rodado antes.
  }

  // Tons neutros com um traco de matiz, nao as seis cores saturadas do
  // Discord que estavam aqui antes. O avatar diz QUEM, nao O QUE ESTA
  // ACONTECENDO -- e neste tema cor saturada quer dizer uma coisa so:
  // alguem esta ao vivo. Continua dando pra distinguir as pessoas de
  // relance, sem competir com o unico sinal que importa.
  // Cores de identidade (--who): claras sobre a tinta, nenhuma vermelha --
  // vermelho e so ao vivo. Pintam anel e inicial do no, nunca fundo de texto.
  const AVATAR_PALETTE = ['#7CC4FF', '#C7A2FF', '#FFD166', '#6EE7B7', '#F9A8D4', '#67E8F9', '#FDBA74', '#D9DCE6'];

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
      : `<span class="node__initial">${initial}</span>`;
  }


  // ---------- Lobby: lista de salas ----------

  const roomListLiveEl = $('room-list-live');
  const roomsCountEl = $('rooms-count');
  const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  // Sem sala, os tres nos ficam neutros: vermelho continua reservado ao ao vivo.

  let networkEmptyHint = null;

  function renderRoomAvatars(room) {
    const people = lobbyRoom.peopleForRoom(room);
    const avatars = people.avatars.map(() => '<span class="node" data-size="16" data-state="present" aria-hidden="true"></span>');
    const extra = people.extra ? `<span class="cluster__more">+${people.extra}</span>` : '';
    const label = room.peers === 1 ? '1 pessoa na sala' : `${room.peers || 0} pessoas na sala`;

    return `<span class="cluster" aria-label="${label}"><span class="cluster__nodes">${avatars.join('')}</span>${extra}</span>`;
  }

  function emptyRoomsHint() {
    return networkEmptyHint || 'Nenhuma sala anunciada na sua rede. Se seus amigos usam Tailscale, peça o endereço e entre por ele.';
  }

  function renderEmptyRooms(listEl) {
    const empty = document.createElement('div');
    empty.className = 'blank';
    empty.innerHTML = `
      <svg class="blank__art graph-art" viewBox="0 0 32 32" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
          <path d="M20.71 14.20 L11.35 9.06" /><path d="M20.71 17.80 L11.35 22.94" />
          <circle class="ring" cx="8.5" cy="7.5" r="3.25" /><circle class="ring" cx="8.5" cy="24.5" r="3.25" />
          <circle cx="24" cy="16" r="3.75" stroke-dasharray="1.5 1.5" />
        </g>
      </svg>
      <p class="blank__title">${networkEmptyHint ? 'Nenhuma rede encontrada' : 'Nenhuma sala na sua rede ainda'}</p>
      <p class="blank__text rooms-empty-hint">${escapeHtml(emptyRoomsHint())}</p>`;
    listEl.appendChild(empty);
  }

  function updateEmptyRoomsHint() {
    const hint = roomListLiveEl.querySelector('.rooms-empty-hint');
    if (hint) hint.textContent = emptyRoomsHint();
  }

  /** Coluna do meio da linha: cadeado de PIN ou a frase da versao diferente. */
  function roomMetaHtml(room, incompatible, appVersionAtual) {
    // Curta na linha (a frase completa fica na dica): quem precisa agir.
    if (incompatible) {
      const quem = version.compare(appVersionAtual, room.version) === 1
        ? 'quem criou precisa atualizar'
        : 'atualize o seu GoLive';
      return escapeHtml(`Versão ${room.version} — ${quem}`);
    }
    return room.protected ? '<svg class="i i--sm"><use href="#i-lock" /></svg>PIN' : '';
  }

  /** Coluna da acao: "Entrar", "Conectando…" na sala escolhida, nada quando nao da para entrar. */
  function roomGoHtml({ isActive, onCooldown, incompatible }) {
    if (isActive) return '<span class="room-row__go"><span class="spinner" aria-hidden="true"></span>Conectando…</span>';
    if (onCooldown || incompatible) return '<span></span>';
    return '<span class="room-row__go">Entrar <svg class="i i--sm"><use href="#i-chevron-right" /></svg></span>';
  }

  function fillRoomList(listEl, rooms, { onSelect, activeAddress, isOnCooldown, appVersion }) {
    listEl.innerHTML = '';
    if (!rooms.length) {
      renderEmptyRooms(listEl);
      return;
    }
    for (const room of rooms) {
      const isActive = activeAddress && room.address === activeAddress;
      const outraEntrando = Boolean(activeAddress) && !isActive;
      const onCooldown = !isActive && !!isOnCooldown && isOnCooldown(room.address);
      // Trava de versao: a sala so aceita quem estiver na MESMA versao (o
      // servidor recusa o 'join'). O beacon traz a versao de quem hospeda,
      // entao da pra dizer isso aqui, antes do clique, em vez de deixar a
      // pessoa conectar e voltar com um erro. Beacon sem versao (release
      // antiga anunciando) nao e marcado -- a recusa vem do servidor.
      const incompatible = !isActive && !!appVersion && !!room.version && !version.same(appVersion, room.version);
      const name = nomeDeSala(room.name || room.hostName || 'sala');
      const li = document.createElement('button');
      li.type = 'button';
      li.className = 'room-row';
      if (isActive) li.classList.add('active');
      if (incompatible) li.classList.add('incompatible');
      if (onCooldown) li.classList.add('cooldown');

      const versionNote = incompatible
        ? version.mismatchText({ mine: appVersion, theirs: room.version })
        : '';

      // A descoberta (beacon e probe-ok) ainda nao conta quem esta ao vivo:
      // sem o campo, a coluna fica vazia em vez de afirmar um "—" falso.
      li.innerHTML = `
        ${renderRoomAvatars(room)}
        <span class="room-row__main"><span class="room-row__name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="room-row__addr" title="${escapeHtml(room.address)}">${escapeHtml(room.address)} · ${room.peers === 1 ? '1 pessoa' : `${room.peers || 0} pessoas`}</span></span>
        <span class="room-row__meta${incompatible ? ' tx-warn' : ''}" title="${escapeHtml(versionNote)}">${roomMetaHtml(room, incompatible, appVersion)}</span>
        ${roomGoHtml({ isActive, onCooldown, incompatible })}`;

      if (isActive) li.setAttribute('aria-busy', 'true');
      if (isActive || onCooldown || incompatible || outraEntrando) {
        li.disabled = true;
      } else {
        li.setAttribute('aria-label', `Entrar em ${name}`);
        li.addEventListener('click', () => onSelect(room));
      }

      const item = document.createElement('li');
      item.appendChild(li);
      listEl.appendChild(item);
    }
  }

  // `liveRooms` = salas descobertas agora mesmo via broadcast UDP na LAN
  // (src/main/discovery.js) — nao ha historico local salvo em disco, so
  // "isso esta aberto agora"; a lista some sozinha quando o beacon para de
  // chegar.
  function renderRooms({ onSelect, activeAddress, liveRooms = [], isOnCooldown, appVersion = null }) {
    fillRoomList(roomListLiveEl, liveRooms, { onSelect, activeAddress, isOnCooldown, appVersion });
    roomsCountEl.textContent = liveRooms.length ? ` · ${liveRooms.length}` : '';
  }

  // ---------- Lobby: endereco desta maquina na rede ----------

  const NET_LABELS = { radmin: 'Radmin VPN', tailscale: 'Tailscale', lan: 'Rede local' };

  /** `info` e o { address, kind } do IPC network:address, ou null. Tres
   * estados: rede virtual (verde), so LAN (amarelo), nada (cinza). */
  function renderNetworkStatus(info) {
    const dot = $('lobby-net-dot');
    const kindEl = $('lobby-net-kind');
    const addrEl = $('lobby-net-addr');
    const homeNet = $('home-network');
    if (!dot || !kindEl || !addrEl) return;
    const copy = $('btn-copy-network');
    networkEmptyHint = null;
    addrEl.removeAttribute('title');
    // Tres barras: verde com rede virtual, atencao so com LAN, apagadas sem
    // rede. Vermelho nunca: ele e so "ao vivo".
    if (!info) {
      networkEmptyHint = 'Ligue o Radmin ou o Tailscale e procure de novo.';
      dot.dataset.level = 'none';
      kindEl.textContent = 'Nenhuma rede encontrada.';
      addrEl.textContent = '';
      if (copy) copy.hidden = true;
      if (homeNet) homeNet.textContent = 'Conecte o Radmin VPN ou o Tailscale.';
      updateEmptyRoomsHint();
      return;
    }
    dot.dataset.level = info.kind === 'lan' ? 'warn' : 'ok';
    kindEl.textContent = `${NET_LABELS[info.kind] || 'Rede'} ·`;
    addrEl.textContent = info.address;
    addrEl.title = info.iface ? `${info.address} (${info.iface})` : info.address;
    if (copy) copy.hidden = false;
    if (homeNet) {
      homeNet.textContent = info.kind === 'lan'
        ? '— amigos de fora precisam do Radmin VPN ou do Tailscale.'
        : '';
    }
    updateEmptyRoomsHint();
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
    $('in-room-name').disabled = busy;
  }

  function openCreateRoom({ onConfirm, advertise = true, roomNameDefault = '' }) {
    $('create-room-error').textContent = '';
    $('chk-protect-room').checked = false;
    // Ultima escolha do usuario (persistida no config) vira o padrao.
    $('chk-advertise-room').checked = advertise !== false;
    // P1: campo vem pre-preenchido com o padrao de hoje -- quem nao mexe
    // nao perde nada. Placeholder repete o valor pra sobreviver a pessoa
    // apagando tudo e deixando em branco de proposito.
    $('in-room-name').value = roomNameDefault;
    $('in-room-name').placeholder = roomNameDefault;
    setCreateRoomBusy(false);
    onCreateConfirm = onConfirm;
    dlgCreateEl.classList.remove('hidden');
    // O nome e o primeiro campo: abrir um dialogo nunca pode pular direto
    // para uma acao que muda o estado da sala.
    focusFirstInteractive(dlgCreateEl);
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
        // P1: mesma normalizacao do servidor (roomname.js, espelhado em
        // signaling-core.js) -- o servidor normaliza de novo de qualquer
        // jeito, isto so evita a viagem ida-e-volta com um nome sujo.
        roomName: roomname.normalizeRoomName($('in-room-name').value),
      });
    } finally {
      // closeCreateRoom ja zerou o estado quando deu certo; quando deu
      // erro o dialogo continua aberto e precisa voltar a ser usavel.
      if (!dlgCreateEl.classList.contains('hidden')) setCreateRoomBusy(false);
    }
  });
  dlgCreateEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !creatingRoom) closeCreateRoom(); });
  dlgCreateEl.addEventListener('click', (event) => {
    if (event.target === dlgCreateEl && !creatingRoom) closeCreateRoom();
  });

  // ---------- Dialogo: Entrar numa sala ----------
  const dlgJoinEl = $('dialog-join-room');
  const btnConnectEl = $('btn-connect');
  const btnJoinCancelEl = $('btn-join-room-cancel');
  let onJoinConnect = null;
  let connectingRoom = false;

  /** Estado ocupado do "Conectar" -- mesmo molde do setCreateRoomBusy: o
   * dialogo fica aberto e o botao ocupado ate a tentativa se resolver
   * (onOpen/onError/onClose em app.js), em vez de fechar na hora e deixar
   * "Conectando..." solto no lobby sem nenhum feedback no proprio dialogo
   * (ver A6 na auditoria de 2026-09-18). */
  function setJoinRoomBusy(busy) {
    connectingRoom = busy;
    btnConnectEl.disabled = busy;
    btnJoinCancelEl.disabled = busy;
    btnConnectEl.classList.toggle('busy', busy);
    btnConnectEl.querySelector('.btn-spinner').classList.toggle('hidden', !busy);
    btnConnectEl.querySelector('.btn-label').textContent = busy ? 'Conectando…' : 'Conectar';
    $('in-server').disabled = busy;
    $('in-pin').disabled = busy;
  }

  function openJoinRoom({ onConnect, address, showPinField = false }) {
    $('setup-error').textContent = '';
    $('in-server').value = address || '';
    $('in-pin').value = '';
    $('join-pin-field').classList.toggle('hidden', !showPinField);
    setJoinRoomBusy(false);
    onJoinConnect = onConnect;
    dlgJoinEl.classList.remove('hidden');
    // Com PIN pedido, o que falta e o PIN: o foco vai direto nele.
    if (showPinField) $('in-pin').focus();
    else focusFirstInteractive(dlgJoinEl);
  }
  function closeJoinRoom() {
    // Idempotente: app.js chama isto de dentro de joinRoom (sucesso, erro,
    // recusa por versao) mesmo quando o dialogo nao foi aberto por ele --
    // hospedar sala e reconexao automatica tambem passam por joinRoom. Sem
    // a guarda, fechar um dialogo ja fechado ainda disparava
    // restoreFocusAfterModal() e roubava o foco de volta pra quem abriu
    // OUTRO modal (o "ultimo foco salvo" e uma variavel só).
    if (dlgJoinEl.classList.contains('hidden')) return;
    setJoinRoomBusy(false);
    dlgJoinEl.classList.add('hidden');
    restoreFocusAfterModal();
    onJoinConnect = null;
  }
  function setJoinRoomPinVisible(visible) {
    $('join-pin-field').classList.toggle('hidden', !visible);
  }
  $('btn-join-room-cancel').addEventListener('click', () => { if (!connectingRoom) closeJoinRoom(); });
  btnConnectEl.addEventListener('click', async () => {
    if (connectingRoom || !onJoinConnect) return;
    // So exige PIN quando o campo esta visivel (sala anunciada como
    // protegida, ou reabertura apos join-denied por pin). O servidor so
    // aceita PIN de 6 digitos (ver signaling-core.js); cobrar isso aqui
    // evita a viagem ida-e-volta so pra descobrir que o PIN estava incompleto.
    const pinVisible = !$('join-pin-field').classList.contains('hidden');
    const pinDigits = $('in-pin').value.replace(/\D/g, '');
    if (pinVisible && pinDigits.length !== 6) {
      $('setup-error').textContent = 'Informe um PIN de 6 dígitos.';
      return;
    }
    const handler = onJoinConnect;
    setJoinRoomBusy(true);
    try {
      await handler({ address: $('in-server').value.trim(), pin: pinDigits || null });
    } finally {
      // closeJoinRoom ja zerou o estado quando a conexao pegou; nos demais
      // desfechos o dialogo continua aberto (ou foi reaberto por
      // openJoinRoom) e precisa voltar a ser usavel.
      if (!dlgJoinEl.classList.contains('hidden')) setJoinRoomBusy(false);
    }
  });
  dlgJoinEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !connectingRoom) closeJoinRoom(); });
  dlgJoinEl.addEventListener('click', (event) => {
    if (event.target === dlgJoinEl && !connectingRoom) closeJoinRoom();
  });

  // ---------- Lista de membros / moderacao ----------

  const peerListEl = $('peer-list');
  const memberMenuEl = $('member-menu');
  let memberPopover = null;
  const presenceButtonEl = $('btn-room-presence');
  const presencePopEl = $('presence-pop');

  presenceButtonEl?.addEventListener('click', () => {
    const open = presencePopEl.classList.contains('hidden');
    presencePopEl.classList.toggle('hidden', !open);
    presenceButtonEl.setAttribute('aria-expanded', String(open));
    if (open) peerListEl.querySelector('[tabindex="0"]')?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (presencePopEl.classList.contains('hidden')) return;
    if (event.target.closest?.('#presence-pop, #btn-room-presence, #member-menu')) return;
    presencePopEl.classList.add('hidden');
    presenceButtonEl.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || presencePopEl.classList.contains('hidden')) return;
    presencePopEl.classList.add('hidden');
    presenceButtonEl.setAttribute('aria-expanded', 'false');
    presenceButtonEl.focus({ preventScroll: true });
  });

  // O mesmo id tambem ancora o menu de temas salvo; preserva o fechamento dele.
  function closeMemberMenu() {
    if (memberPopover) {
      memberPopover.close();
      return;
    }
    memberMenuEl.classList.add('hidden');
    memberMenuEl.classList.remove('in-modal');
    memberMenuEl.replaceChildren();
    memberMenuEl.onkeydown = null;
  }
  document.addEventListener('click', (event) => {
    if (memberPopover) return;
    if (!memberMenuEl.contains(event.target) && !event.target.closest('.my-theme-menu-btn')) {
      closeMemberMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!memberPopover && event.key === 'Escape') closeMemberMenu();
  });

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
  function openMemberMenu(btn, id, name, {
    live = false,
    targetIsOwner = false,
    onModerate,
    canModerate = false,
    canAdd = false,
    onWatch,
  } = {}) {
    closeMemberMenu();
    memberMenuEl.classList.remove('hidden', 'in-modal');
    memberMenuEl.removeAttribute('role');
    memberMenuEl.innerHTML = `
      ${canAdd ? '<button class="menu__item" type="button" role="menuitem" data-watch="add">Ver junto</button>' : ''}
      ${live ? `<button class="menu__item menu__item--warn" type="button" role="menuitem" data-action="stop-share">${MODERATE_ICONS['stop-share']} Parar transmissão</button>` : ''}
      ${targetIsOwner ? '' : `<button class="menu__item" type="button" role="menuitem" data-action="transfer-owner">${MODERATE_ICONS['transfer-owner']} Passar a liderança</button>`}
      ${live || !targetIsOwner ? '<div class="menu__sep"></div>' : ''}
      <button class="menu__item" type="button" role="menuitem" data-action="kick">${MODERATE_ICONS.kick} Expulsar da sala</button>
      <button class="menu__item menu__item--danger" type="button" role="menuitem" data-action="ban">${MODERATE_ICONS.ban} Banir da sala</button>
      <div class="menu__note">Expulso pode voltar. Banido não, enquanto a sala existir.</div>
    `;
    if (!canModerate) {
      const moderacao = memberMenuEl.querySelectorAll(
        '[data-action], .menu-separador, .menu-motivo'
      );
      for (const item of moderacao) {
        item.remove();
      }
    }
    const fechar = openPopover({
      anchor: btn,
      content: memberMenuEl,
      onClose: () => {
        memberPopover = null;
        memberMenuEl.replaceChildren();
        memberMenuEl.classList.add('hidden');
        memberMenuEl.setAttribute('role', 'menu');
      },
    });
    memberPopover = fechar;
    for (const item of memberMenuEl.querySelectorAll('[data-action]')) {
      item.addEventListener('click', () => {
        onModerate?.(item.dataset.action, id, name);
        fechar.close();
      });
    }
    for (const item of memberMenuEl.querySelectorAll('[data-watch]')) {
      item.addEventListener('click', () => {
        onWatch?.(id, item.dataset.watch);
        fechar.close();
      });
    }
  }

  // `live` liga `.peer-avatar.on` (anel --live via box-shadow, o unico sinal
  // saturado do tema). Sem anel no estado normal -- "conectado" e "ao vivo"
  // sao a mesma afirmacao neste tema.
  function buildMemberRow({
    id,
    name,
    avatar,
    live,
    isSelf,
    qualityTag,
    strugglingTag,
    isOwner,
    canModerate,
    onModerate,
    watched,
    canAdd,
    estado,
    onWatch,
    cameraOn,
  }) {
    // O ⋮ so existe quando ha o que fazer: pra quem nao e dono da sala, o
    // menu inteiro ficou vazio quando "Silenciar" saiu dele, e um botao que
    // abre um menu vazio e pior do que botao nenhum.
    const showMenu = !isSelf && (canModerate || canAdd);
    const li = document.createElement('li');
    if (isSelf) li.dataset.self = '';
    li.classList.add('person');
    li.tabIndex = 0;
    const noEstado = estadoNo({ id, isSelf, live, cameraOn });
    const coroa = isOwner
      ? '<svg class="node__crown" viewBox="0 0 12 7" aria-hidden="true"><path d="M1 6 2 1l2.5 2L6 0l1.5 3L10 1l1 5z" fill="currentColor" /></svg>'
      : '';
    const extras = [qualityTag, strugglingTag ? 'travando' : ''].filter(Boolean).join(' · ');
    const linhaEstado = [estado, extras].filter(Boolean).join(' · ');
    const menuHtml = showMenu
      ? `<button class="btn btn--quiet btn--icon btn--sm member-menu-btn" type="button"
           aria-label="Opções de ${escapeHtml(name)}"><svg class="i i--sm"><use href="#i-ellipsis" /></svg></button>`
      : '';
    const estadoHtml = linhaEstado
      ? `<span class="person__state${strugglingTag ? ' tx-warn' : ''}">${escapeHtml(linhaEstado)}</span>`
      : '';
    li.innerHTML = `
      <span class="node" data-size="24" data-state="${noEstado}" style="--who:${avatarColorFor(String(id))}"
            title="${isOwner ? 'Líder da sala' : ''}">${avatarInnerHtml(String(id), name, avatar)}${coroa}</span>
      <span class="person__text">
        <span class="person__name" title="${escapeHtml(name)}">${escapeHtml(name)}${isSelf ? ' <span class="tx-3">(você)</span>' : ''}</span>
        ${estadoHtml}
      </span>
      <span class="person__actions">${menuHtml}</span>
    `;
    if (live && !watched) {
      const assistir = document.createElement('button');
      assistir.type = 'button';
      assistir.className = 'btn btn--quiet btn--sm';
      assistir.textContent = 'Assistir';
      assistir.addEventListener('click', (event) => {
        event.stopPropagation();
        onWatch?.(id, event.shiftKey && canAdd ? 'add' : 'only');
      });
      li.querySelector('.person__actions').prepend(assistir);
    }
    const focar = () => {
      const tela = document.getElementById(`tile-${id}`);
      const camera = document.getElementById(`tile-cam-${id}`);
      if (tela?.hidden && live && !watched) {
        onWatch?.(id, 'only');
        // A troca de assistida redesenha o tile no mesmo ciclo antes do foco.
        requestAnimationFrame(() => {
          const tile = document.getElementById(`tile-${id}`);
          if (!tile?.hidden) focarTile(tile);
        });
        return;
      }
      const alvo = tela && !tela.hidden ? tela : camera;
      focarTile(alvo);
    };
    const focarTile = (alvo) => {
      alvo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      alvo?.focus({ preventScroll: true });
    };
    li.addEventListener('click', (event) => {
      if (!event.target.closest('button')) focar();
    });
    li.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      focar();
    });
    if (showMenu) {
      const menuBtn = li.querySelector('.member-menu-btn');
      menuBtn.title = 'Opções';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMemberMenu(e.currentTarget, id, name, {
          live,
          targetIsOwner: isOwner,
          onModerate,
          canModerate,
          canAdd,
          onWatch,
        });
      });
    }
    return li;
  }

  let ultimasPresencas = null;

  function redesenharUltimasPresencas() {
    if (!ultimasPresencas) return;
    renderMembers(...ultimasPresencas);
  }

  /** Estado do no de uma pessoa, o mesmo em todo lugar: ao vivo (tela ou
   * camera no ar), pausado, assistindo alguma fonte, ou so na sala. */
  function estadoNo(pessoa) {
    const eu = pessoa.isSelf;
    const transmitindo = eu ? document.getElementById('btn-toggle-share')?.getAttribute('aria-pressed') === 'true'
      : Boolean(pessoa.live);
    const camera = eu ? document.getElementById('btn-toggle-camera')?.getAttribute('aria-pressed') === 'true'
      : Boolean(pessoa.cameraOn || tileRegistry.has(`cam-${pessoa.id}`));
    const pausado = eu ? document.getElementById('btn-pause-share')?.getAttribute('aria-pressed') === 'true'
      : Boolean(tilePaused.get(String(pessoa.id))?.paused);
    if (transmitindo && pausado) return 'paused';
    if (transmitindo || camera) return 'live';
    if (eu && [...tileWatch.values()].some((w) => w.watched)) return 'watching';
    return 'present';
  }
  const ORDEM_NO = { live: 0, paused: 1, watching: 2, present: 3 };

  function renderMembers(peers, self, qualityTags, opcoes = {}) {
    ultimasPresencas = [peers, self, qualityTags, opcoes];
    const { ownerId, myId, onModerate, healthTags, mesaPeople } = opcoes;
    peerListEl.innerHTML = '';
    if (!self && !peers.size) {
      peerListEl.innerHTML = '<li class="muted">você não está em nenhuma sala</li>';
      return;
    }
    const iAmOwner = ownerId != null && myId != null && ownerId === myId;
    const pessoas = [];
    if (self) pessoas.push({ ...self, id: 'me', isSelf: true });
    for (const peer of peers.values()) pessoas.push({ ...peer, isSelf: false });
    const presenceCount = pessoas.length;
    const presenceNodes = $('presence-nodes');
    if (presenceNodes) {
      // Ao vivo primeiro, depois pausado, assistindo e na sala; voce por ultimo.
      const nos = pessoas.map((pessoa) => ({ pessoa, estado: estadoNo(pessoa) }))
        .sort((a, b) => (a.pessoa.isSelf - b.pessoa.isSelf) || (ORDEM_NO[a.estado] - ORDEM_NO[b.estado]));
      presenceNodes.innerHTML = nos.slice(0, 5).map(({ estado }) => `<span class="node" data-size="16" data-state="${estado}"></span>`)
        .join('') + (nos.length > 5 ? `<span class="cluster__more">+${nos.length - 5}</span>` : '');
    }
    $('presence-count').textContent = String(presenceCount);
    renderBus(pessoas);
    renderMeNode(self);
    $('btn-room-presence')?.setAttribute('aria-label', `Pessoas na sala: ${presenceCount}`);
    const secoes = root.GoLive.salaLayout.ordenarPresencas(pessoas);
    for (const [titulo, lista] of [['AO VIVO', secoes.aoVivo], ['NA SALA', secoes.naSala]]) {
      if (!lista.length) continue;
      const secao = document.createElement('li');
      secao.className = 'menu__label';
      secao.textContent = titulo;
      peerListEl.appendChild(secao);
      for (const pessoa of lista) {
        const assistido = tileWatch.get(pessoa.id)?.watched !== false;
        const estado = estadoPresenca(pessoa, assistido, mesaPeople);
        peerListEl.appendChild(buildMemberRow({
          ...pessoa,
          live: Boolean(pessoa.live),
          qualityTag: qualityTags?.get(pessoa.id) || '',
          strugglingTag: Boolean(healthTags?.has(pessoa.id)),
          isOwner: ownerId != null && pessoa.id === ownerId,
          canModerate: iAmOwner,
          onModerate,
          watched: assistido,
          canAdd: Boolean(pessoa.live && !assistido && tileWatch.get(pessoa.id)?.opts?.canAdd),
          estado,
          onWatch: onWatchIntent,
        }));
      }
    }
  }

  // ---------- Barramento: fontes ao vivo (05 §3.2) ----------
  //
  // Tudo o que se pode assistir e uma fonte: a tela e a camera de cada pessoa
  // ao vivo. A Mesa e a sua propria fonte sao marcacao fixa do index.html; aqui
  // so as fontes das outras pessoas, redesenhadas junto com a presenca.
  const busLiveEl = $('bus-live');
  const busSourcesEl = $('bus-sources');
  const tileHealth = new Map(); // tileId -> nivel de recepcao ('ok' | 'atencao' | 'ruim')

  function fontesDoBarramento(pessoas) {
    const fontes = [];
    for (const pessoa of pessoas) {
      if (pessoa.isSelf) continue;
      if (pessoa.live) fontes.push({ tileId: String(pessoa.id), kind: 'screen', pessoa });
    }
    for (const pessoa of pessoas) {
      if (pessoa.isSelf) continue;
      if (pessoa.cameraOn || tileRegistry.has(`cam-${pessoa.id}`)) {
        fontes.push({ tileId: `cam-${pessoa.id}`, kind: 'camera', pessoa });
      }
    }
    return fontes;
  }

  function fonteHtml({ tileId, kind, pessoa }) {
    const watched = tileWatch.get(tileId)?.watched !== false && tileRegistry.has(tileId);
    const paused = Boolean(tilePaused.get(tileId)?.paused);
    const poor = ['atencao', 'ruim'].includes(tileHealth.get(tileId));
    const nome = pessoa.name || 'Alguém';
    const sub = paused ? 'Pausada' : (kind === 'camera' ? 'Câmera' : (tileRegistry.has(tileId) ? 'Tela' : 'Conectando…'));
    const quem = (tileWatchers.get(tileId) || []).slice(0, 4)
      .map((w) => `<span class="node" data-size="16" data-state="watching" title="${escapeHtml(w.name || '')}"></span>`)
      .join('');
    const podeJunto = kind === 'screen' && !watched && tileWatch.get(tileId)?.opts?.canAdd;
    const podeLargar = watched && (kind === 'camera' || tileWatch.get(tileId)?.opts?.canDrop);
    const estado = [paused ? 'pausada' : 'ao vivo', watched ? 'você está assistindo' : ''].filter(Boolean).join(', ');
    return `
      <div class="src" role="option" tabindex="-1" data-tile="${escapeHtml(tileId)}" data-kind="${kind}"
           aria-selected="${watched}" aria-label="${escapeHtml(`${nome}, ${sub}: ${estado}`)}"
           ${watched ? 'data-watching' : ''} ${paused ? 'data-paused' : ''} ${poor ? 'data-poor' : ''}>
        <span class="node" data-size="32" data-state="${paused ? 'paused' : 'live'}"
              style="--who:${avatarColorFor(String(pessoa.id))}">${avatarInnerHtml(String(pessoa.id), nome, pessoa.avatar)}${
  kind === 'camera' ? '<span class="node__mark"><svg class="i"><use href="#i-video" /></svg></span>' : ''}</span>
        <span class="src__text"><span class="src__name">${escapeHtml(nome)}</span><span class="src__sub">${sub}</span></span>
        <span class="cluster__nodes" aria-hidden="true">${quem}</span>
        ${podeJunto ? `<button class="btn btn--quiet btn--icon btn--sm src__add" type="button" tabindex="-1"
          data-intent="add" aria-label="Ver ${escapeHtml(nome)} junto" title="Ver junto"><svg class="i i--sm"><use href="#i-plus" /></svg></button>` : ''}
        ${podeLargar ? `<button class="btn btn--quiet btn--icon btn--sm src__drop" type="button" tabindex="-1"
          data-intent="remove" aria-label="Parar de assistir ${escapeHtml(nome)}" title="Parar de assistir"><svg class="i i--sm"><use href="#i-x" /></svg></button>` : ''}
      </div>`;
  }

  function renderBus(pessoas) {
    if (!busLiveEl) return;
    const focado = document.activeElement?.closest?.('#bus-live .src')?.dataset.tile;
    busLiveEl.innerHTML = fontesDoBarramento(pessoas).map(fonteHtml).join('');
    const opcoes = [...busSourcesEl.querySelectorAll('[role="option"]')];
    // Roving tabindex: a lista e um ponto so de Tab; setas andam dentro dela.
    const alvo = opcoes.find((o) => o.dataset.tile === focado)
      || opcoes.find((o) => o.hasAttribute('data-watching')) || opcoes[0];
    for (const o of opcoes) o.tabIndex = o === alvo ? 0 : -1;
    if (focado && alvo?.dataset.tile === focado) alvo.focus({ preventScroll: true });
  }

  /** Clique = assistir so esta; Ctrl+clique = somar; o × larga. Estando na
   * Mesa, escolher uma fonte de video volta para a Transmissao. */
  function escolherFonte(tileId, intent) {
    const vista = root.GoLive.salaVista;
    if (intent !== 'remove' && vista?.isMesa()) vista.setRoomView('tx');
    onWatchIntent?.(tileId, intent);
  }

  busLiveEl?.addEventListener('click', (event) => {
    const src = event.target.closest('.src');
    if (!src) return;
    const botao = event.target.closest('button[data-intent]');
    escolherFonte(src.dataset.tile, botao ? botao.dataset.intent : (event.ctrlKey ? 'add' : 'only'));
  });
  busLiveEl?.addEventListener('contextmenu', (event) => {
    const src = event.target.closest('.src');
    if (!src) return;
    event.preventDefault();
    openTileMenu(src.dataset.tile, event.clientX, event.clientY);
  });
  busSourcesEl?.addEventListener('keydown', (event) => {
    const atual = event.target.closest('[role="option"]');
    if (!atual) return;
    const opcoes = [...busSourcesEl.querySelectorAll('[role="option"]')];
    const i = opcoes.indexOf(atual);
    let proximo = null;
    if (event.key === 'ArrowRight') proximo = opcoes[Math.min(opcoes.length - 1, i + 1)];
    else if (event.key === 'ArrowLeft') proximo = opcoes[Math.max(0, i - 1)];
    else if (event.key === 'Home') proximo = opcoes[0];
    else if (event.key === 'End') proximo = opcoes[opcoes.length - 1];
    if (proximo) {
      event.preventDefault();
      for (const o of opcoes) o.tabIndex = o === proximo ? 0 : -1;
      proximo.focus();
      proximo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    const tileId = atual.dataset.tile;
    if (!tileId) return; // a Mesa trata o proprio Enter (app.js)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      escolherFonte(tileId, event.ctrlKey ? 'add' : 'only');
    } else if (event.key === 'Delete') {
      event.preventDefault();
      escolherFonte(tileId, 'remove');
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const caixa = atual.getBoundingClientRect();
      openTileMenu(tileId, caixa.left, caixa.top);
    }
  });

  /** O no da sua fonte: inicial e cor de voce. */
  function renderMeNode(self) {
    const node = $('me-node');
    const sub = $('me-source-sub');
    if (sub) {
      const pausado = $('btn-pause-share')?.getAttribute('aria-pressed') === 'true';
      const vendo = (tileWatchers.get('me') || []).length;
      sub.textContent = pausado ? 'Pausada'
        : [nomeFonteAoVivo || 'ao vivo', vendo ? `${vendo} vendo` : ''].filter(Boolean).join(' · ');
      sub.classList.toggle('tx-live', pausado);
    }
    if (!node || !self) return;
    node.style.setProperty('--who', avatarColorFor('me'));
    node.innerHTML = avatarInnerHtml('me', self.name, self.avatar);
  }

  /** Estado curto da linha de presenca, na ordem de prioridade da spec 3.1.
   * "vendo" e sobre voce assistir a pessoa: na propria linha nao se aplica. */
  function estadoPresenca(pessoa, assistido, mesaPeople) {
    const pausado = tilePaused.get(pessoa.id)?.paused || tilePaused.get(`cam-${pessoa.id}`)?.paused;
    if (pausado) return 'pausado';
    // Ao vivo e nao assistido: o botao Assistir ja diz o estado, e na coluna
    // de 232 px o texto a mais espremia o nome ate uma letra.
    if (pessoa.live && !assistido && !pessoa.isSelf) return '';
    if (pessoa.live && assistido && !pessoa.isSelf) return 'você assiste';
    if (tileRegistry.has(`cam-${pessoa.id}`)) return 'câmera';
    if (mesaPeople?.has(String(pessoa.id))) return 'na Mesa';
    return '';
  }

  // ---------- Banidos ----------
  const bannedSectionEl = $('banned-section');
  const bannedListEl = $('banned-list');
  // Amarrado uma vez so: renderBanned roda a cada mudanca da lista, e um
  // listener por chamada fazia cliques pares se anularem.
  const bannedToggleEl = bannedSectionEl.querySelector('.banned-toggle');
  bannedToggleEl?.addEventListener('click', () => {
    const aberto = bannedToggleEl.getAttribute('aria-expanded') === 'true';
    bannedToggleEl.setAttribute('aria-expanded', String(!aberto));
    bannedListEl.hidden = aberto;
  });

  function renderBanned(list, { onUnban } = {}) {
    bannedSectionEl.classList.toggle('hidden', !list || !list.length);
    bannedListEl.innerHTML = '';
    for (const entry of list || []) {
      const li = document.createElement('li');
      li.className = 'person';
      li.innerHTML = `
        <span class="node" data-size="24" style="--who:${avatarColorFor(String(entry.key))}">${avatarInnerHtml(String(entry.key), entry.name, null)}</span>
        <span class="person__text"><span class="person__name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span></span>
        <span class="person__actions"><button class="btn btn--secondary btn--sm banned-readmit" type="button">Readmitir</button></span>
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
  let lastChatEntry = null;
  let onChatSend = null;
  let onChatPut = null; // "Pôr na mesa" de um link do YouTube ou de uma imagem

  const SYSTEM_LABELS = {
    join: (actor) => `${actor} entrou`,
    leave: (actor) => `${actor} saiu`,
    'stop-share': (actor, target) => `${actor} parou a transmissão de ${target}`,
    kick: (actor, target) => `${actor} expulsou ${target}`,
    ban: (actor, target) => `${actor} baniu ${target}`,
    unban: (actor, target) => `${actor} readmitiu ${target}`,
  };
  const SYSTEM_TONE = { 'stop-share': 'warn', kick: 'danger', ban: 'danger' };
  // Icone da linha de evento: entrar, sair e moderacao.
  const SYSTEM_ICON = {
    join: 'log-in', leave: 'log-out', 'stop-share': 'square', kick: 'triangle-alert', ban: 'lock', unban: 'check',
  };

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  let lastChatDayKey = null;

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** "Hoje" / "Ontem" / "14 de setembro". Sem ano: o historico de uma sala
   * nao atravessa anos, e escrever 2026 em toda linha so faz ruido. */
  function dayLabel(ts) {
    const d = new Date(ts);
    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 86400000);
    if (dayKey(ts) === dayKey(hoje.getTime())) return 'Hoje';
    if (dayKey(ts) === dayKey(ontem.getTime())) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
  }

  function appendDaySeparatorIfNeeded(ts) {
    const key = dayKey(ts);
    if (key === lastChatDayKey) return;
    lastChatDayKey = key;
    const div = document.createElement('div');
    div.className = 'msg-day';
    div.textContent = dayLabel(ts);
    chatMessagesEl.appendChild(div);
    lastChatEntry = null;
  }

  function appendSystemLine(entry) {
    const div = document.createElement('div');
    const tone = SYSTEM_TONE[entry.event] || '';
    div.className = `msg-sys${tone ? ` msg-sys--${tone}` : ''}`;
    const label = SYSTEM_LABELS[entry.event]?.(entry.actor, entry.target) || entry.event;
    const hora = entry.ts ? `<span class="msg__time">${formatTime(entry.ts)}</span>` : '';
    div.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-${SYSTEM_ICON[entry.event] || 'info'}" /></svg><span>${escapeHtml(label)}</span>${hora}`;
    chatMessagesEl.appendChild(div);
    lastChatEntry = null;
  }

  /** Miniatura de imagem da linha do chat. As dimensoes viajam na mensagem
   * (ver o servidor), entao a caixa ja nasce com a altura certa e a lista
   * nao "pula" quando o bitmap decodifica.
   *
   * `src` vem de um data URL validado (chatmedia.isImageDataUrl), e ainda e
   * escapado como defesa em profundidade antes de entrar no HTML. */
  function chatImageHtml(entry) {
    if (!chatmedia.isImageDataUrl(entry.image)) return '';
    const box = chatmedia.thumbBox(entry.w, entry.h);
    const dims = box ? ` style="width:${box.w}px;height:${box.h}px"` : '';
    return `<button class="msg__img" type="button" title="Ver em tela cheia"${dims}><img src="${escapeHtml(entry.image)}" alt="imagem enviada por ${escapeHtml(entry.name)}" /></button>`;
  }

  const PUT_ICON = '<svg class="i i--sm" aria-hidden="true"><use href="#i-plus" /></svg>';

  /** Os botoes "Pôr na mesa" de uma linha do chat: um por link do YouTube
   * (no maximo 3) e um para a imagem (so com id, que e o que a janela
   * `imagem` guarda). Vazio se nao ha o que pôr, ou se o app nao pediu. */
  function chatPutHtml(entry) {
    if (!onChatPut) return '';
    const L = root.GoLive.mesaMidiaLinks;
    const lib = root.GoLive.chatImagensLib;
    const links = lib && L ? lib.youtubeLinks(entry.text, L.parseYouTube) : [];
    const out = links.map((l, i) => `<button type="button" class="btn btn--quiet btn--sm chat-put" data-put="youtube" data-i="${i}" title="Pôr este vídeo na mesa"${links.length > 1 ? ` aria-label="Pôr na mesa o vídeo ${i + 1}"` : ''}>${PUT_ICON}<span>Pôr na mesa${links.length > 1 ? ` (${i + 1})` : ''}</span></button>`);
    if (chatmedia.isImageDataUrl(entry.image) && lib?.isMsgId(entry.id)) {
      out.push(`<button type="button" class="btn btn--quiet btn--sm chat-put" data-put="imagem" title="Pôr esta imagem na mesa">${PUT_ICON}<span>Pôr na mesa</span></button>`);
    }
    return out.length ? `<span class="msg__put">${out.join('')}</span>` : '';
  }

  function wireChatPut(div, entry) {
    const btns = div.querySelectorAll('.chat-put');
    if (!btns.length) return;
    const L = root.GoLive.mesaMidiaLinks;
    const links = root.GoLive.chatImagensLib.youtubeLinks(entry.text, L?.parseYouTube);
    for (const b of btns) {
      b.addEventListener('click', () => {
        if (b.dataset.put === 'imagem') onChatPut?.({ type: 'imagem', msgId: entry.id });
        else {
          const link = links[Number(b.dataset.i)];
          if (link) onChatPut?.({ type: 'youtube', url: link.url });
        }
      });
    }
  }

  function appendMessage(entry) {
    const grouped = chatGrouping.deveAgrupar(lastChatEntry, entry);
    lastChatEntry = entry;
    const div = document.createElement('div');
    // Primeira do grupo leva o no (so identidade: cor da pessoa, sem estado),
    // nome e hora; as seguintes do mesmo autor em 5 min so o texto.
    div.className = `msg${grouped ? ' msg--cont' : ''}`;
    const cor = avatarColorFor(String(entry.from));
    div.innerHTML = `
      ${grouped
    ? `<span class="msg__gutter" aria-hidden="true">${formatTime(entry.ts)}</span>`
    : `<span class="node" style="--who:${cor}">${avatarInnerHtml(String(entry.from), entry.name, entry.avatar || null)}</span>
      <span class="msg__head"><span class="msg__author" style="color:${cor}">${escapeHtml(entry.name)}</span><span class="msg__time">${formatTime(entry.ts)}</span></span>`}
      ${entry.text ? `<p class="msg__body">${escapeHtml(entry.text)}</p>` : ''}
      ${chatImageHtml(entry)}
      ${chatPutHtml(entry)}`;
    const imgBtn = div.querySelector('.msg__img');
    if (imgBtn) imgBtn.addEventListener('click', () => openImageLightbox(entry.image));
    wireChatPut(div, entry);
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

  // Tolerancia pra "ja estava no fim". Zero seria fragil: subpixel de
  // zoom e a altura fracionaria da ultima linha fazem scrollTop quase
  // nunca bater exatamente no fundo.
  const FIM_TOLERANCIA_PX = 48;

  function estaNoFim() {
    const el = chatMessagesEl;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= FIM_TOLERANCIA_PX;
  }

  function descerParaOFim() {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    $('chat-jump-new').classList.add('hidden');
  }

  function appendEntry(entry) {
    // Decide ANTES de inserir: depois da insercao a lista ja cresceu e
    // "estava no fim" viraria sempre falso.
    const seguir = estaNoFim();
    const scrollTop = chatMessagesEl.scrollTop;
    const scrollHeight = chatMessagesEl.scrollHeight;
    if (entry.ts) appendDaySeparatorIfNeeded(entry.ts);
    if (entry.system) appendSystemLine(entry);
    else appendMessage(entry);
    const removed = chatlimit.pruneChatMessages(chatMessagesEl);
    if (seguir) descerParaOFim();
    else {
      if (removed) chatMessagesEl.scrollTop = scrollTop + chatMessagesEl.scrollHeight - scrollHeight;
      $('chat-jump-new').classList.remove('hidden');
    }
  }

  function append(entry, { received = false } = {}) {
    appendEntry(entry);
    // Historico, eco proprio e sistema nao sao mensagem nova de outra pessoa.
    if (received) {
      document.dispatchEvent(new CustomEvent('golive:chat-received'));
      if (!entry.system) espiarMensagem(entry);
    }
  }

  // Conversa espiando (05 §3.6): sem a coluna, a mensagem nova surge sobre o
  // programa e some sozinha em 6 s; no maximo 3 de uma vez. Clique abre a
  // conversa fixada.
  const chatPeekEl = $('chat-peek');
  const PEEK_MAX = 3;

  function espiarMensagem(entry) {
    if (!chatPeekEl || $('app')?.dataset.conv !== 'peek') return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'peek__msg';
    const cor = avatarColorFor(String(entry.from));
    const texto = entry.text || (entry.image ? 'mandou uma imagem' : '');
    item.innerHTML = `<span class="node" style="--who:${cor}">${avatarInnerHtml(String(entry.from), entry.name, entry.avatar || null)}</span>`
      + `<span class="peek__text"><b style="color:${cor}">${escapeHtml(entry.name)}</b>${escapeHtml(texto)}</span>`;
    item.addEventListener('click', () => document.dispatchEvent(new CustomEvent('golive:conv-open')));
    item.addEventListener('animationend', () => item.remove());
    chatPeekEl.appendChild(item);
    while (chatPeekEl.children.length > PEEK_MAX) chatPeekEl.firstElementChild.remove();
  }

  function setHistory(entries) {
    chatMessagesEl.innerHTML = '';
    lastChatEntry = null;
    lastChatDayKey = null;
    for (const entry of entries || []) {
      if (entry.ts) appendDaySeparatorIfNeeded(entry.ts);
      if (entry.system) appendSystemLine(entry);
      else appendMessage(entry);
    }
    chatlimit.pruneChatMessages(chatMessagesEl);
    descerParaOFim();
  }

  function setEnabled(enabled) {
    chatInputEl.disabled = !enabled;
    chatComposeEl.classList.toggle('disabled', !enabled);
    chatOfflineBarEl.classList.toggle('hidden', enabled);
    syncComposeState();
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
    } else {
      attachmentImgEl.src = pendingAttachment.dataUrl;
      attachmentInfoEl.textContent = pendingAttachment.label || '';
      attachmentEl.classList.remove('hidden');
      chatInputEl.focus();
    }
    syncComposeState();
  }
  function clearAttachment() {
    setAttachment(null);
    syncComposeState();
  }
  $('chat-attachment-remove').addEventListener('click', clearAttachment);

  /** O campo nasce com rows="1" e nada ajustava a altura: o `max-height: 88px`
   * do CSS era regra morta e uma mensagem longa virava uma fresta que rolava
   * por dentro. Zerar pra `auto` antes de ler `scrollHeight` e o que permite
   * a caixa ENCOLHER de volta ao apagar texto -- sem isso ela so cresce. */
  function autoResizeInput() {
    chatInputEl.style.height = 'auto';
    chatInputEl.style.height = `${chatInputEl.scrollHeight}px`;
    chatComposeEl.classList.toggle('is-multiline', chatInputEl.scrollHeight > 30);
  }

  /** O botao de enviar so acende quando ha o que mandar -- texto aparado ou
   * anexo. Mesma condicao que `sendCurrentInput` ja usa pra decidir se sai
   * alguma coisa, pra as duas nunca discordarem. */
  function syncComposeState() {
    const temTexto = chatInputEl.value.trim().length > 0;
    $('btn-chat-send').disabled = chatInputEl.disabled || (!temTexto && !pendingAttachment);
  }

  function sendCurrentInput() {
    const text = chatInputEl.value.trim();
    if (!text && !pendingAttachment) return;
    onChatSend?.(text, pendingAttachment);
    chatInputEl.value = '';
    autoResizeInput();
    syncComposeState();
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

  function render({ onSend, onPickImage, getEmojiRecents, onEmojiUsed, onPut }) {
    onChatSend = onSend;
    onChatPut = typeof onPut === 'function' ? onPut : null;
    onChatPickImage = onPickImage;
    initEmojiPanel({ getEmojiRecents, onEmojiUsed });
    $('chat-jump-new').addEventListener('click', descerParaOFim);
    chatMessagesEl.addEventListener('scroll', () => {
      if (estaNoFim()) $('chat-jump-new').classList.add('hidden');
    });
    // #chat-compose e um <form> sem action -- um submit acidental (Enter num
    // futuro <input>, extensao) navegaria o renderer pra file://.../?. Corta.
    chatComposeEl.addEventListener('submit', (e) => e.preventDefault());
    chatInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendCurrentInput();
      }
    });
    $('btn-chat-send').addEventListener('click', sendCurrentInput);
    chatInputEl.addEventListener('input', () => {
      autoResizeInput();
      syncComposeState();
      const len = chatInputEl.value.length;
      chatCountEl.textContent = `${len}/500`;
      chatCountEl.classList.toggle('hidden', len < 450);
      chatCountEl.classList.toggle('near-limit', len >= 500);
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

    // Arrastar em cima da conversa inteira.
    const dropZone = chatMessagesEl.closest('.conv') || chatMessagesEl;
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
      .map((t) => `<button type="button" class="emoji__tab" data-group="${t.id}" title="${escapeHtml(t.label)}" aria-label="${escapeHtml(t.label)}">${t.icon}</button>`)
      .join('');
    emojiTabsEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.emoji__tab');
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
      ? chars.map((c) => `<button type="button" class="emoji__item" data-emoji="${c}" title="${escapeHtml(emoji.labelFor(c))}">${c}</button>`).join('')
      : `<p class="emoji__empty">${vazio}</p>`;
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
    if (emojiPanelEl.classList.contains('hidden')) return;
    emojiPanelEl.classList.add('hidden');
    emojiBtnEl.setAttribute('aria-expanded', 'false');
    emojiBtnEl.focus({ preventScroll: true });
  }

  emojiListEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.emoji__item');
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
    dot.dataset.level = level === 'live' ? 'live' : 'idle';
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
    $('stage-room-name').textContent = nomeDeSala(name);
    $('room-screen-title').textContent = nomeDeSala(name);
    $('stage-room-address').textContent = address || '';
    const pinEl = $('stage-room-pin');
    if (pin) {
      pinEl.innerHTML = LOCK_ICON;
      const pinText = document.createElement('span');
      pinText.textContent = `PIN ${pin}`;
      pinEl.append(pinText);
      pinEl.classList.remove('hidden');
    } else {
      pinEl.classList.add('hidden');
      pinEl.textContent = '';
    }
    // Troca de tela: Lobby fora, Sala dentro -- unico ponto de alternancia
    // entre as duas (ver a spec, secao 5). clearStageHeader faz o inverso.
    lobbyViewEl.classList.add('hidden');
    roomViewEl.classList.remove('hidden');
    $('app').dataset.place = 'room';
    document.querySelector('.head__group--room')?.removeAttribute('hidden');
    document.querySelector('.head__room-actions')?.removeAttribute('hidden');
    renderEmptyGrid();
  }

  /** So o nome, sem mexer em endereco/PIN/visibilidade -- usado quando o
   * welcome chega com o nome de verdade da sala (P1) depois que joinRoom ja
   * abriu a tela com o palpite otimista de setStageHeader. */
  function setStageHeaderName(name) {
    $('stage-room-name').textContent = nomeDeSala(name);
    $('room-screen-title').textContent = nomeDeSala(name);
  }

  function clearStageHeader() {
    $('stage-header').classList.add('hidden');
    $('stage-room-name').textContent = '';
    $('room-screen-title').textContent = '';
    $('stage-room-address').textContent = '';
    $('stage-room-pin').classList.add('hidden');
    $('stage-status-badge').classList.add('hidden');
    roomViewEl.classList.add('hidden');
    lobbyViewEl.classList.remove('hidden');
    $('app').dataset.place = 'lobby';
    document.querySelector('.head__group--room')?.setAttribute('hidden', '');
    document.querySelector('.head__room-actions')?.setAttribute('hidden', '');
    // A sala saiu da tela: a vista Mesa (se aberta) desmonta junto.
    document.dispatchEvent(new CustomEvent('golive:room-hidden'));
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
  const settingsTitleEl = $('settings-section-title');
  const settingsLiveTallyEl = $('settings-live-tally');
  let settingsUnderlayEl = null;
  $('settings-veil').addEventListener('click', () => closeSettings());

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

  const settingsNavEl = document.querySelector('.settings__nav');

  function syncSettingsIndicator(animate = true) {
    moveIndicator(settingsNavEl, settingsCatButtons.find((b) => b.classList.contains('active')), 'y', animate);
  }

  function selectSettingsCategory(btn, animate = true) {
    const category = btn.dataset.cat;
    settingsCatButtons.forEach((item) => {
      const active = item === btn;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    Object.entries(settingsPanes).forEach(([key, pane]) => {
      pane.classList.toggle('hidden', key !== category);
    });
    settingsTitleEl.textContent = btn.textContent.trim();
    syncSettingsIndicator(animate);
  }

  settingsCatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectSettingsCategory(btn);
      btn.focus();
    });
  });

  $('btn-close-settings').addEventListener('click', closeSettings);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape'
      && !settingsModalEl.classList.contains('hidden')
      && $('dialog-confirm').classList.contains('hidden')
      && $('dialog-text').classList.contains('hidden')) closeSettings();
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
    $('settings-veil').classList.add('hidden');
    if (settingsUnderlayEl) settingsUnderlayEl.inert = false;
    settingsUnderlayEl = null;
    stopSettingsCameraPreview();
    restoreFocusAfterModal();
  }

  // Gestao de foco dos modais (§5.6). Antes nao havia nenhuma: abrir um
  // dialogo deixava o foco no botao que ficou escondido atras do overlay,
  // entao um Tab levava pra tras da caixa em vez de pra dentro dela.
  const FOCUSABLE =
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
  let lastFocusedBeforeModal = null;
  let lastFocusedBeforeDialog = null;

  function focusFirstInteractive(modalEl) {
    lastFocusedBeforeModal = document.activeElement;
    modalEl.querySelector(FOCUSABLE)?.focus();
  }

  function restoreFocusAfterModal() {
    lastFocusedBeforeModal?.focus?.();
    lastFocusedBeforeModal = null;
  }

  function restoreFocusAfterDialog() {
    lastFocusedBeforeDialog?.focus?.();
    lastFocusedBeforeDialog = null;
  }

  function esconderVistaAnterior() {
    const salaVisivel = !roomViewEl.classList.contains('hidden');
    settingsUnderlayEl = salaVisivel ? roomViewEl : lobbyViewEl;
    settingsUnderlayEl.inert = true;
  }


  function bandwidthLine(quality) {
    const screenMbps = quality.bitrate / 1_000_000;
    // Virgula: a linha inteira e em portugues, e "2.5 Mbps" no meio dela
    // era o unico numero do app com ponto decimal.
    const texto = screenMbps.toFixed(1).replace(/\.0$/, '').replace('.', ',');
    return `≈${texto} Mbps por pessoa assistindo enquanto você estiver transmitindo`;
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
  // o padrao Estudio primeiro, depois do escuro neutro ao unico claro.
  // Array explicito, nao Object.keys(theme.PRESETS) -- a ordem de exibicao
  // nao deveria depender da ordem de insercao de theme.js. O preco e ter de
  // lembrar de acrescentar aqui cada predefinicao nova: theme.test.js cobra.
  const THEME_PRESET_ORDER = ['sinal', 'sinal-claro', 'marca', 'signal', 'midnight', 'carvao', 'amber', 'forest', 'paper'];

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
  /** Miniatura de um tema: a propria sala do Sinal em pequeno -- cabeca,
   * programa no vazio e barramento com o no ao vivo e a acao em giz. As cores
   * sao dado do tema (preset ou salvo), por isso entram inline. */
  function amostraTema(s, act) {
    return `<span class="theme-mini" style="--m-bg:${s.bg};--m-s1:${s.s1};--m-line:${s.line2};--m-tx:${s.tx};--m-act:${act}">
        <span class="theme-mini__head"><i></i><b></b></span>
        <span class="theme-mini__program"></span>
        <span class="theme-mini__bus"><i class="theme-mini__live"></i><b></b><u></u></span>
      </span>`;
  }

  function renderThemePresetCard(id, activeId) {
    const preset = theme.PRESETS[id];
    const active = id === activeId;
    return `
      <button type="button" class="theme-card${active ? ' active' : ''}" data-preset="${id}" aria-pressed="${active}">
        ${amostraTema(preset.surfaces, preset.act)}
        <span class="theme-card__label">${escapeHtml(preset.label)}</span>
      </button>`;
  }

  function renderThemePresets(activeId) {
    $('theme-presets').innerHTML = THEME_PRESET_ORDER.map((id) => renderThemePresetCard(id, activeId)).join('');
  }

  let myThemes = [];
  let onThemesChange = null;

  /** Cartao de tema proprio. Reaproveita o desenho dos fixos: a diferenca
   * e so quem desenhou o tema; clicar no cartao continua significando usar. */
  function renderMyThemes(ativoId) {
    const host = $('my-themes');
    if (!host) return;
    if (!myThemes.length) {
      host.innerHTML = '<p class="field__help">Nenhum tema salvo ainda.</p>';
      return;
    }
    host.innerHTML = myThemes.map((t) => {
      const tokens = theme.tokensFor({ preset: 'custom', base: t.base, act: t.act });
      const s = tokens.surfaces;
      const active = t.id === ativoId;
      return `
        <div class="theme-slot">
          <button type="button" class="theme-card${active ? ' active' : ''}" data-theme-id="${escapeHtml(t.id)}" aria-pressed="${active}">
            ${amostraTema(s, tokens.act)}
            <span class="theme-card__label">${escapeHtml(t.name)}</span>
          </button>
          <button class="btn btn--quiet btn--icon btn--sm my-theme-menu-btn" type="button" data-theme-menu="${escapeHtml(t.id)}"
                  title="Opções de ${escapeHtml(t.name)}" aria-label="Opções de ${escapeHtml(t.name)}"><svg class="i i--sm"><use href="#i-ellipsis" /></svg></button>
        </div>`;
    }).join('');
  }

  function renderThemeMenu(itens, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    memberMenuEl.classList.toggle('in-modal', Boolean(anchorEl.closest('.modal')));
    memberMenuEl.innerHTML = itens.map((item, index) => `
      <button type="button" class="menu__item${item.tom === 'danger' ? ' menu__item--danger' : ''}" role="menuitem" data-theme-action="${index}">${escapeHtml(item.rotulo)}</button>
    `).join('');
    memberMenuEl.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
    memberMenuEl.style.top = `${rect.bottom + 4}px`;
    memberMenuEl.classList.remove('hidden');
    for (const item of memberMenuEl.querySelectorAll('[data-theme-action]')) {
      item.addEventListener('click', () => {
        closeThemeMenu(anchorEl);
        itens[Number(item.dataset.themeAction)].acao();
      });
    }
    const items = Array.from(memberMenuEl.querySelectorAll('[data-theme-action]'));
    items[0]?.focus();
    memberMenuEl.onkeydown = (event) => {
      const current = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeThemeMenu(anchorEl);
      }
    };
  }

  function closeThemeMenu(anchorEl) {
    closeMemberMenu();
    anchorEl?.focus();
  }

  function themeName(nome) {
    return Array.from(nome).slice(0, 24).join('');
  }

  function openMyThemeMenu(id, anchorEl) {
    const t = myThemes.find((x) => x.id === id);
    if (!t) return;
    const itens = [
      { rotulo: 'Renomear', acao: () => {
        openText({
          title: 'Renomear tema',
          value: t.name,
          onAccept: (nome) => {
            t.name = themeName(nome);
            onThemesChange?.(myThemes);
            renderMyThemes(id);
          },
        });
      } },
      { rotulo: 'Copiar código', acao: () => copiarCodigoDoTema(t, anchorEl) },
      { rotulo: 'Apagar', tom: 'danger', acao: () => {
        openConfirm({
          title: 'Apagar tema',
          text: `"${t.name}" some da lista. Quem já tem o código continua podendo usar.`,
          confirmLabel: 'Apagar',
          onConfirm: () => {
            myThemes = myThemes.filter((x) => x.id !== id);
            onThemesChange?.(myThemes);
            renderMyThemes(null);
          },
        });
      } },
    ];
    renderThemeMenu(itens, anchorEl);
  }

  /** Confirmacao NO LUGAR (motion #4): o botao vira "Copiado" onde o dedo
   * ja esta, em vez de um toast num canto que ninguem esta olhando --
   * mesmo caminho que o endereco da sala usa. */
  function copiarCodigoDoTema(t, anchorEl) {
    const codigo = themecode.encode({ base: t.base, act: t.act });
    void navigator.clipboard.writeText(codigo).then(() => {
      anchorEl.classList.add('copied-flash');
      const status = $('theme-code-status');
      if (status) status.textContent = 'Código copiado.';
      setTimeout(() => anchorEl.classList.remove('copied-flash'), 1200);
    }).catch(() => {});
  }

  /** Qual cartao de predefinicao esta marcado agora. A cor de acao e um
   * acento POR CIMA de uma predefinicao -- nunca um estado sem predefinicao
   * nenhuma --, entao sempre ha uma resposta; 'marca' (o padrao) e a rede de
   * seguranca se o DOM ainda nao foi montado. */
  function selectedThemePreset() {
    const card = $('theme-presets')?.querySelector('.theme-card.active');
    return card?.dataset.preset || 'marca';
  }

  function hasActiveThemePreset() {
    return Boolean($('theme-presets')?.querySelector('.theme-card.active'));
  }

  function updateThemeSaveState() {
    const button = $('btn-theme-save');
    const hint = $('theme-save-hint');
    if (!button || !hint) return;
    const custom = !hasActiveThemePreset();
    button.disabled = !custom;
    hint.classList.toggle('hidden', custom);
  }

  function themeCfgFromControls({ comSuperficies = false } = {}) {
    const act = $('theme-act').value;
    if (!comSuperficies) return { preset: selectedThemePreset(), act };
    return {
      preset: 'custom',
      base: { temp: Number($('theme-temp').value) / 100, level: Number($('theme-level').value) / 100 },
      act,
    };
  }

  /** Le os controles e aplica ao vivo. Chamada a cada `input`: arrastar e
   * ver o app mudar e o unico jeito de avaliar um tema. Aplica mesmo quando
   * a validacao reprova; o aviso abaixo do controle mostra a reprovacao. */
  function applyCustomThemeFromControls(deps, opcoes) {
    const themeCfg = themeCfgFromControls(opcoes);
    const result = theme.validate(theme.tokensFor(themeCfg));
    deps.onThemeChange(themeCfg);

    const warningEl = $('theme-warning');
    warningEl.textContent = '';
    if (result.ok) return themeCfg;

    warningEl.append(result.failures[0]);
    if (result.nearestAct) {
      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'btn btn--secondary btn--sm theme-warning-fix';
      fixBtn.textContent = `usar ${result.nearestAct}`;
      fixBtn.addEventListener('click', () => {
        $('theme-act').value = result.nearestAct;
        applyCustomThemeFromControls(deps, opcoes);
      });
      warningEl.append(' ', fixBtn);
    }
    return themeCfg;
  }

  /** Inicializa a aba Aparencia a partir de `cfg.theme`. */
  function initThemeControls(config) {
    const themeCfg = (config && config.theme) || { preset: 'marca' };
    const knownPreset = theme.PRESETS[themeCfg.preset] ? themeCfg.preset : 'marca';

    renderThemePresets(themeCfg.preset === 'custom' ? null : knownPreset);
    $('theme-act').value = isHexColor(themeCfg.act) ? themeCfg.act : theme.PRESETS[knownPreset].act;
    $('theme-warning').textContent = '';
    if (config && Array.isArray(config.themes)) myThemes = config.themes;
    const base = themeCfg.preset === 'custom' && themeCfg.base ? themeCfg.base : { temp: 0.5, level: 0.2 };
    $('theme-temp').value = String(Math.round(base.temp * 100));
    $('theme-level').value = String(Math.round(base.level * 100));
    renderMyThemes(null);
    updateThemeSaveState();
  }

  function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
  }

  async function openSettings(config, deps) {
    const estavaFechada = settingsModalEl.classList.contains('hidden');
    if (estavaFechada) lastFocusedBeforeModal = document.activeElement;
    settingsPanes.profile.innerHTML = `
      <div class="settings__block">
        <div class="settings__profile">
          <button id="settings-profile-avatar" class="settings__avatar" type="button"
            title="Trocar a foto" aria-label="Trocar a foto de perfil">
            <span class="node" data-size="56">
              <img id="settings-profile-avatar-img" class="hidden" alt="" />
              <span id="settings-profile-avatar-fallback"></span>
            </span>
            <span class="tx-meta">Trocar foto</span>
          </button>
          <input id="settings-profile-avatar-input" type="file" accept="image/*" class="hidden" />
          <div class="field">
            <label class="field__label" for="settings-profile-name">Apelido</label>
            <input id="settings-profile-name" class="input" type="text" placeholder="Como te chamam no grupo"
              spellcheck="false" maxlength="32" />
            <p class="field__help">Aparece para quem está na sala a partir da próxima entrada.</p>
          </div>
        </div>
      </div>`;

    settingsPanes.appearance.innerHTML = `
      <div class="settings__block">
        <h3 class="settings__h">Tema</h3>
        <p class="field__help">O vermelho continua sendo só "ao vivo" e o âmbar, só aviso, em qualquer tema.</p>
        <div id="theme-presets" class="theme-grid"></div>
      </div>

      <div class="settings__block">
        <h3 class="settings__h">Personalizar</h3>
        <div class="field">
          <label class="field__label" for="theme-act">Cor de ação</label>
          <p class="field__help">Botão principal e seleção. Tem de passar no contraste com o fundo.</p>
          <input id="theme-act" class="settings__color" type="color" value="#EDEDF2" aria-describedby="theme-warning" />
        </div>
        <div class="field">
          <label class="field__label" for="theme-temp">Temperatura das superfícies</label>
          <input id="theme-temp" class="range" type="range" min="0" max="100" value="50" />
        </div>
        <div class="field">
          <label class="field__label" for="theme-level">Claridade das superfícies</label>
          <input id="theme-level" class="range" type="range" min="0" max="100" value="20" />
        </div>
        <p id="theme-warning" class="field__error" role="alert"></p>
        <div class="settings__actions">
          <button id="btn-theme-reset" type="button" class="btn btn--quiet btn--sm">Voltar ao padrão</button>
        </div>
      </div>

      <div class="settings__block">
        <h3 class="settings__h">Meus temas</h3>
        <p class="field__help">Guarde a combinação que você montou e mande o código para quem quiser usar igual.</p>
        <div id="my-themes" class="theme-grid"></div>
        <div class="settings__actions">
          <button id="btn-theme-save" type="button" class="btn btn--secondary btn--sm">Salvar tema atual</button>
          <p id="theme-save-hint" class="field__help hidden">Mexa na temperatura ou na claridade para montar um tema seu.</p>
        </div>
        <div class="field">
          <label class="field__label" for="theme-code-input">Usar um código</label>
          <div class="combo">
            <input id="theme-code-input" class="input input--mono" type="text" placeholder="GL-XXXX-XXXX-XXXX"
              spellcheck="false" autocomplete="off" />
            <button id="btn-theme-code-use" type="button" class="btn btn--secondary" disabled>Salvar como…</button>
          </div>
          <p id="theme-code-status" class="field__help" role="status"></p>
        </div>
      </div>`;

    settingsPanes.voice.innerHTML = `
      <div class="settings__block">
        <h3 class="settings__h">Câmera</h3>
        <div class="field">
          <label class="field__label" for="settings-camera-device">Dispositivo</label>
          <select id="settings-camera-device" class="input"></select>
        </div>
        <video id="settings-camera-preview" class="settings__preview" autoplay playsinline muted></video>
      </div>
      <div class="settings__block">
        <h3 class="settings__h">Sons e avisos</h3>
        <label class="opt">
          <span class="opt__text"><span class="opt__title">Sons do app</span>
            <span class="opt__desc">Entrada, saída, conversa, transmissão começando e moderação.</span></span>
          <input id="settings-sounds" class="switch" type="checkbox" />
        </label>
        <label class="opt">
          <span class="opt__text"><span class="opt__title">Avisar quando alguém ficar ao vivo</span>
            <span class="opt__desc">Notificação do Windows quando a janela do GoLive não está em foco.</span></span>
          <input id="settings-live-notify" class="switch" type="checkbox" />
        </label>
      </div>
      <div class="settings__block sound-check" aria-labelledby="sound-check-title">
        <div class="settings__row">
          <h3 id="sound-check-title" class="settings__h">Testar os sons</h3>
          <button id="btn-test-sounds" type="button" class="btn btn--secondary btn--sm">Tocar todos</button>
        </div>
        <p id="sound-test-current" class="field__help" aria-live="polite">Toca cada aviso, inclusive o da conversa com a
          janela em foco.</p>
        <ul id="sound-recent" class="sound-recent" aria-live="polite"></ul>
      </div>`;

    settingsPanes.stats.innerHTML = `
      <div class="settings__block">
        <p class="field__help">Números de cada fonte, enviando e recebendo. Atualiza sozinho enquanto está aberto.</p>
        <div id="settings-stats-body" class="stats"></div>
      </div>
      <div class="settings__block settings__row">
        <p class="field__help">Para mandar a quem for investigar um problema.</p>
        <button id="btn-open-logs" type="button" class="btn btn--secondary btn--sm">
          <svg class="i i--sm"><use href="#i-folder-open" /></svg>Abrir pasta de logs</button>
      </div>`;
    setStatsHtml(lastStatsHtml, { force: true });

    renderProfilePreview(config);
    $('settings-sounds').checked = config.soundsEnabled;
    $('settings-live-notify').checked = config.liveNotifyEnabled;

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
    $('settings-live-notify').addEventListener('change', () => {
      deps.onLiveNotifyChange($('settings-live-notify').checked);
    });

    const renderRecentSounds = () => {
      const list = $('sound-recent');
      const entries = deps.getRecentSounds ? deps.getRecentSounds() : [];
      if (!entries.length) {
        list.innerHTML = '<li class="sound-recent-empty">Nenhuma tentativa nesta sessão.</li>';
        return;
      }
      list.innerHTML = entries.slice().reverse().map((entry) => {
        const status = entry.status === 'NAO tocou' ? 'não tocou' : entry.status;
        const hour = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return `<li><time>${hour}</time><span>${entry.name}</span><b class="sound-${entry.status === 'tocou' ? 'played' : 'skipped'}">${status}</b><em>${entry.reason}</em></li>`;
      }).join('');
    };
    renderRecentSounds();
    $('btn-test-sounds').addEventListener('click', async () => {
      const button = $('btn-test-sounds');
      button.disabled = true;
      try {
        await deps.onTestSounds((name) => {
          $('sound-test-current').textContent = `Tocando: ${name}.`;
          renderRecentSounds();
        });
        $('sound-test-current').textContent = 'Teste concluído.';
      } finally {
        button.disabled = false;
        renderRecentSounds();
      }
    });

    initThemeControls(config);
    $('theme-presets').addEventListener('click', (event) => {
      const card = event.target.closest('.theme-card');
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
      renderMyThemes(null);
      updateThemeSaveState();
    });
    $('theme-act').addEventListener('input', () => {
      const comSuperficies = !hasActiveThemePreset();
      applyCustomThemeFromControls(deps, { comSuperficies });
      if (comSuperficies) renderMyThemes(null);
      updateThemeSaveState();
    });
    for (const id of ['theme-temp', 'theme-level']) {
      $(id).addEventListener('input', () => {
        Array.from($('theme-presets').children).forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        applyCustomThemeFromControls(deps, { comSuperficies: true });
        renderMyThemes(null);
        updateThemeSaveState();
      });
    }

    onThemesChange = deps.onThemesChange;
    let temaColado = null;
    function aplicarPreviaImportada(importado) {
      $('theme-act').value = importado.act;
      $('theme-temp').value = String(Math.round(importado.base.temp * 100));
      $('theme-level').value = String(Math.round(importado.base.level * 100));
      Array.from($('theme-presets').children).forEach((c) => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      applyCustomThemeFromControls(deps, { comSuperficies: true });
      renderMyThemes(null);
      updateThemeSaveState();
    }
    $('theme-code-input').addEventListener('input', () => {
      const status = $('theme-code-status');
      temaColado = themecode.decode($('theme-code-input').value);
      $('btn-theme-code-use').disabled = !temaColado;
      if (!$('theme-code-input').value.trim()) {
        status.textContent = '';
        return;
      }
      // Codigo invalido nao muda NADA na tela: a pessoa colou errado, nao
      // pediu tema novo.
      if (!temaColado) {
        status.textContent = 'Esse código não parece certo.';
        return;
      }
      status.textContent = 'Código válido. Dê um nome para salvar.';
      aplicarPreviaImportada(temaColado);
    });
    $('btn-theme-code-use').addEventListener('click', () => {
      if (!temaColado) return;
      if (myThemes.length >= 12) {
        deps.onToast('Você já tem 12 temas salvos. Apague um pra guardar este.');
        return;
      }
      openText({
        title: 'Nome do tema',
        value: 'Tema importado',
        onAccept: (nome) => {
          const novo = { id: `t${Date.now()}`, name: themeName(nome), base: temaColado.base, act: temaColado.act };
          myThemes = [...myThemes, novo];
          onThemesChange?.(myThemes);
          renderMyThemes(novo.id);
          $('theme-code-input').value = '';
          $('theme-code-status').textContent = '';
          $('btn-theme-code-use').disabled = true;
          temaColado = null;
        },
      });
    });
    $('btn-theme-save').addEventListener('click', () => {
      if (myThemes.length >= 12) {
        deps.onToast('Você já tem 12 temas salvos. Apague um pra guardar outro.');
        return;
      }
      const cfg = themeCfgFromControls({ comSuperficies: true });
      openText({
        title: 'Nome do tema',
        value: 'Meu tema',
        onAccept: (nome) => {
          const novo = { id: `t${Date.now()}`, name: themeName(nome), base: cfg.base, act: cfg.act };
          myThemes = [...myThemes, novo];
          onThemesChange?.(myThemes);
          renderMyThemes(novo.id);
        },
      });
    });

    $('my-themes').addEventListener('click', (event) => {
      const card = event.target.closest('[data-theme-id]');
      if (card) {
        const t = myThemes.find((x) => x.id === card.dataset.themeId);
        if (!t) return;
        Array.from($('theme-presets').children).forEach((c) => {
          c.classList.remove('active');
          c.setAttribute('aria-pressed', 'false');
        });
        $('theme-act').value = t.act;
        $('theme-temp').value = String(Math.round(t.base.temp * 100));
        $('theme-level').value = String(Math.round(t.base.level * 100));
        deps.onThemeChange({ preset: 'custom', base: t.base, act: t.act });
        renderMyThemes(t.id);
        updateThemeSaveState();
        return;
      }
      const menuBtn = event.target.closest('[data-theme-menu]');
      if (menuBtn) openMyThemeMenu(menuBtn.dataset.themeMenu, menuBtn);
    });

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

    if (estavaFechada) esconderVistaAnterior();
    $('settings-veil').classList.remove('hidden');
    settingsLiveTallyEl.classList.toggle('hidden', !deps.isLive?.());
    settingsModalEl.classList.remove('hidden');
    // Sem animar: o indicador aparece ja no lugar em vez de deslizar sozinho
    // toda vez que o dialogo abre. offsetTop/offsetHeight so valem depois de
    // o modal sair de display:none, dai a leitura ser aqui.
    selectSettingsCategory(settingsCatButtons.find((btn) => btn.classList.contains('active')), false);
    settingsCatButtons.find((btn) => btn.classList.contains('active'))?.focus();
    void startSettingsCameraPreview($('settings-camera-device').value);
  }

  // Ultimo HTML de estatisticas recebido do app.js. openSettings remonta a
  // aba inteira a cada abertura (com o corpo vazio), e o app so escreve de
  // novo no proximo tique da sala -- ou nunca, fora dela. Sem guardar, fora
  // da sala o estado vazio nao aparecia, e dentro dela a aba abria em branco.
  let lastStatsHtml = '';
  // Contadores leves para confirmar que a atualizacao normal nao derruba a
  // arvore inteira; ficam acessiveis so pela API interna de configuracoes.
  const statsDomOps = { rebuilds: 0, text: 0, attributes: 0, structure: 0 };

  function isStatsVisible() {
    return !settingsModalEl.classList.contains('hidden')
      && !settingsPanes.stats.classList.contains('hidden');
  }

  function syncStatsNode(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next.cloneNode(true));
      statsDomOps.structure += 1;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.data !== next.data) {
        current.data = next.data;
        statsDomOps.text += 1;
      }
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    for (const name of current.getAttributeNames()) {
      if (!next.hasAttribute(name)) {
        current.removeAttribute(name);
        statsDomOps.attributes += 1;
      }
    }
    for (const name of next.getAttributeNames()) {
      if (current.getAttribute(name) !== next.getAttribute(name)) {
        current.setAttribute(name, next.getAttribute(name));
        statsDomOps.attributes += 1;
      }
    }
    const limit = Math.min(current.childNodes.length, next.childNodes.length);
    for (let i = 0; i < limit; i += 1) syncStatsNode(current.childNodes[i], next.childNodes[i]);
    while (current.childNodes.length > next.childNodes.length) {
      current.lastChild.remove();
      statsDomOps.structure += 1;
    }
    for (let i = limit; i < next.childNodes.length; i += 1) {
      current.appendChild(next.childNodes[i].cloneNode(true));
      statsDomOps.structure += 1;
    }
  }

  function setStatsHtml(html, { force = false } = {}) {
    lastStatsHtml = html || '';
    const body = $('settings-stats-body');
    if (!body || (!force && !isStatsVisible())) return;
    if (body.childNodes.length) {
      const template = document.createElement('template');
      template.innerHTML = html || '<p class="stats-empty"></p>';
      const limit = Math.min(body.childNodes.length, template.content.childNodes.length);
      for (let i = 0; i < limit; i += 1) syncStatsNode(body.childNodes[i], template.content.childNodes[i]);
      while (body.childNodes.length > template.content.childNodes.length) {
        body.lastChild.remove();
        statsDomOps.structure += 1;
      }
      for (let i = limit; i < template.content.childNodes.length; i += 1) {
        body.appendChild(template.content.childNodes[i].cloneNode(true));
        statsDomOps.structure += 1;
      }
      return;
    }
    if (html) {
      body.innerHTML = html;
      statsDomOps.rebuilds += 1;
      return;
    }
    const empty = document.createElement('p');
    empty.className = 'stats-empty';
    empty.textContent = 'As estatísticas de envio e recepção aparecem aqui enquanto você está numa sala.';
    body.replaceChildren(empty);
  }

  // ---------- Dialogo de compartilhar ----------

  const pickerEl = $('picker');
  const pickerGridEl = $('picker-grid');
  const pickerTabsEl = $('picker-tabs');
  const pickerWindowHintEl = $('picker-window-hint');
  const pickerQualityEl = $('picker-quality');
  const pickerQualityBandwidthEl = $('picker-quality-bandwidth');
  const pickerQualityTitleEl = pickerQualityEl.previousElementSibling;
  const pickerAnnotationsEl = $('allow-annotations').closest('.picker__opt');
  const pickerAnnotationsTitleEl = pickerAnnotationsEl.querySelector('.tx-tag');
  const shareSoundEl = $('share-sound');
  const shareDiscordRowEl = $('share-discord-row');
  const shareDiscordEl = $('share-discord');
  const btnGoLiveEl = $('btn-go-live');
  const pickerGoLiveHintEl = $('picker-go-live-hint');
  let selectedSourceId = null;
  let pickerMode = 'start';
  // O que voce esta transmitindo, para o subtitulo da sua fonte no barramento.
  let nomeFonteAoVivo = '';

  /** D3 (analise de 2026-09-23): o botao desabilitado diz por que esta
   * desabilitado -- sem isto, "Ir ao vivo" apagado nao explica nada. */
  function setGoLiveEnabled(enabled) {
    btnGoLiveEl.disabled = !enabled;
    pickerGoLiveHintEl.classList.toggle('hidden', enabled);
  }
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
      `<button class="seg__opt quality-seg-opt" type="button" role="radio" aria-checked="false" tabindex="-1" data-value="${escapeHtml(valor)}">${escapeHtml(text(valor))}</button>`
    )).join('');
    return `<div class="picker__axis">
      <span class="sr-only" id="${labelId}">${escapeHtml(label)}</span>
      <div class="seg quality-seg" role="radiogroup" aria-labelledby="${labelId}" data-axis="${axis}" style="--seg-count: ${values.length}">${opcoes}</div>
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
    // "de 1080p pra direita" nao existe, e pular pro 720p desfaz exatamente
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

  /** Rotulo do botao principal: a acao com o nome da fonte (05 §5). */
  function rotuloTransmitir(fonte) {
    const nome = fonte?.name ? (fonte.name.length > 28 ? `${fonte.name.slice(0, 27)}…` : fonte.name) : '';
    if (pickerMode === 'swap') return nome ? `Trocar para ${nome}` : 'Trocar';
    return nome ? `Transmitir ${nome}` : 'Transmitir';
  }

  function escolherFonteDoSeletor(fonte, card) {
    selectedSourceId = fonte.id;
    setGoLiveEnabled(true);
    btnGoLiveEl.textContent = rotuloTransmitir(fonte);
    pickerGridEl.querySelectorAll('.src-card').forEach((c) => {
      c.classList.remove('selected');
      c.setAttribute('aria-selected', 'false');
      c.tabIndex = -1;
    });
    card.classList.add('selected');
    card.setAttribute('aria-selected', 'true');
    card.tabIndex = 0;
  }

  function renderPickerGrid() {
    pickerGridEl.innerHTML = '';
    syncPickerCounts();
    const filtered = sortSources(pickerSources.filter((s) => (pickerTab === 'screen' ? s.isScreen : !s.isScreen)));
    if (!filtered.length) {
      if (pickerLoading[pickerTab]) {
        // Esqueleto na forma do que vem: cartoes 16:9.
        pickerGridEl.innerHTML = Array.from({ length: pickerTab === 'screen' ? 2 : 6 },
          () => '<div class="src-card src-card--skel" aria-hidden="true"><span class="src-card__thumb skel"></span>'
            + '<span class="skel src-card__skel-line"></span></div>').join('')
          + `<p class="sr-only" role="status">${pickerTab === 'screen' ? 'Procurando telas…' : 'Procurando janelas…'}</p>`;
        return;
      }
      pickerGridEl.innerHTML = `<p class="picker__empty">${
        pickerTab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta para mostrar.'
      } <button type="button" class="btn btn--secondary btn--sm" data-picker-refresh>Procurar de novo</button></p>`;
      return;
    }
    for (const source of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'src-card';
      card.setAttribute('role', 'option');
      const escolhida = source.id === selectedSourceId;
      card.classList.toggle('selected', escolhida);
      card.setAttribute('aria-selected', String(escolhida));
      card.tabIndex = escolhida ? 0 : -1;
      const tag = qualityTagFor(source);
      card.title = source.name;
      card.innerHTML = `
        <span class="src-card__thumb">
          <img src="${source.thumbnail}" alt="" />
          ${tag ? `<span class="tag src-card__tag">${escapeHtml(tag)}</span>` : ''}
        </span>
        <span class="src-card__name">
          ${source.appIcon ? `<img class="src-card__icon" src="${source.appIcon}" alt="" />` : ''}
          <span class="ellipsis">${escapeHtml(source.name)}</span>
        </span>`;
      card.addEventListener('click', () => escolherFonteDoSeletor(source, card));
      // Duplo clique: escolhe e ja transmite.
      card.addEventListener('dblclick', () => {
        escolherFonteDoSeletor(source, card);
        btnGoLiveEl.click();
      });
      pickerGridEl.appendChild(card);
    }
    if (!pickerGridEl.querySelector('.src-card[tabindex="0"]')) pickerGridEl.querySelector('.src-card').tabIndex = 0;
  }

  // Setas andam pela grade de fontes; Enter/duplo clique transmitem.
  pickerGridEl.addEventListener('keydown', (event) => {
    const cards = [...pickerGridEl.querySelectorAll('.src-card:not(.src-card--skel)')];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    const colunas = Math.max(1, Math.round(pickerGridEl.clientWidth / (cards[0].offsetWidth || 1)));
    const passo = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: colunas, ArrowUp: -colunas }[event.key];
    if (!passo) return;
    event.preventDefault();
    const alvo = cards[Math.min(cards.length - 1, Math.max(0, i + passo))];
    cards.forEach((c) => { c.tabIndex = c === alvo ? 0 : -1; });
    alvo.focus();
    alvo.click();
  });
  pickerGridEl.addEventListener('click', (event) => {
    if (event.target.closest('[data-picker-refresh]')) $('picker-refresh').click();
  });

  pickerTabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.picker-tab');
    if (!btn || btn.classList.contains('active')) return;
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
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
      // D3: com um monitor so (o caso comum), a escolha ja esta feita.
      // Nao na troca de fonte: la a unica tela e quase sempre a que ja
      // esta no ar.
      const telas = sources.filter((src) => src.isScreen);
      if (tab === 'screen' && pickerMode !== 'swap' && !selectedSourceId && telas.length === 1) {
        selectedSourceId = telas[0].id;
        setGoLiveEnabled(true);
        btnGoLiveEl.textContent = rotuloTransmitir(telas[0]);
      }
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
    setGoLiveEnabled(false);
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
  pickerEl.addEventListener('click', (event) => {
    if (event.target === pickerEl) closePicker();
  });

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

  async function openPicker({ onGoLive, nativeAudioAvailable = true, quality, onQualityChange, allowAnnotations = false, mode = 'start', currentShareSound = true, currentIncludeDiscord = false }) {
    selectedSourceId = null;
    pickerMode = mode;
    setGoLiveEnabled(false);
    pickerTab = 'screen';
    pickerTabsEl.querySelectorAll('.picker-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === 'screen');
      t.setAttribute('aria-selected', String(t.dataset.tab === 'screen'));
    });
    syncWindowHint();
    pickerGridEl.innerHTML = '';
    pickerOnQualityChange = onQualityChange;
    // Sem animar: os dois polegares aparecem ja no lugar, como o indicador
    // das abas (ver syncPickerIndicator).
    syncQualityAxes(quality.preset, false);
    pickerQualityBandwidthEl.innerHTML = bandwidthLineHtml(quality);
    const swapping = mode === 'swap';
    $('picker-title').textContent = swapping ? 'Trocar fonte' : 'Transmitir';
    btnGoLiveEl.textContent = rotuloTransmitir(null);
    pickerQualityTitleEl.classList.toggle('hidden', swapping);
    pickerQualityEl.classList.toggle('hidden', swapping);
    pickerQualityBandwidthEl.classList.toggle('hidden', swapping);
    pickerAnnotationsTitleEl.classList.toggle('hidden', swapping);
    pickerAnnotationsEl.classList.toggle('hidden', swapping);
    shareSoundEl.checked = swapping ? Boolean(currentShareSound) : true;
    shareSoundEl.disabled = swapping;
    // Vem da ULTIMA escolha (config), nao de um padrao fixo: e a mesma
    // regra do "anunciar na rede" no dialogo de criar sala.
    $('allow-annotations').checked = Boolean(allowAnnotations);
    shareDiscordEl.checked = swapping && shareSoundEl.checked && Boolean(currentIncludeDiscord);
    shareDiscordRowEl.classList.toggle('hidden', !shareSoundEl.checked);
    // Sem o addon nativo (Windows apenas), nao ha como excluir o Discord do
    // audio capturado -- a checkbox nao teria efeito nenhum, entao fica
    // desabilitada em vez de prometer algo que nao entrega.
    shareDiscordEl.disabled = !nativeAudioAvailable;
    shareDiscordRowEl.title = nativeAudioAvailable
      ? ''
      : 'Indisponível nesta máquina (requer o addon nativo de áudio, só existe no Windows)';

    btnGoLiveEl.onclick = async () => {
      nomeFonteAoVivo = pickerSources.find((s) => s.id === selectedSourceId)?.name || nomeFonteAoVivo;
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
    okBtn.className = tone === 'destructive' ? 'btn btn--danger-solid' : 'btn btn--primary';
    onConfirmAccept = onConfirm;
    dlgConfirmEl.classList.remove('hidden');
    lastFocusedBeforeDialog = document.activeElement;
    // Foco no Cancelar, nunca no botao que age (ver a spec de 2026-09-02, 8.3).
    $('btn-confirm-cancel').focus();
  }
  function closeConfirm() {
    dlgConfirmEl.classList.add('hidden');
    restoreFocusAfterDialog();
    onConfirmAccept = null;
  }
  $('btn-confirm-cancel').addEventListener('click', closeConfirm);
  $('btn-confirm-ok').addEventListener('click', () => { onConfirmAccept?.(); closeConfirm(); });
  dlgConfirmEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeConfirm();
    }
  });
  dlgConfirmEl.addEventListener('click', (event) => {
    if (event.target === dlgConfirmEl) closeConfirm();
  });

  const dlgTextEl = $('dialog-text');
  let onTextAccept = null;

  function openText({ title, value = '', confirmLabel = 'Salvar', onAccept }) {
    $('dialog-text-title').textContent = title;
    $('dialog-text-input').value = value;
    $('btn-text-ok').textContent = confirmLabel;
    onTextAccept = onAccept;
    dlgTextEl.classList.remove('hidden');
    lastFocusedBeforeDialog = document.activeElement;
    $('dialog-text-input').focus();
    $('dialog-text-input').select();
  }
  function closeText() {
    dlgTextEl.classList.add('hidden');
    restoreFocusAfterDialog();
    onTextAccept = null;
  }
  $('btn-text-cancel').addEventListener('click', closeText);
  $('btn-text-ok').addEventListener('click', () => {
    const valor = themeName($('dialog-text-input').value.trim());
    const aceitar = onTextAccept;
    closeText();
    if (valor) aceitar?.(valor);
  });
  dlgTextEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeText();
    }
  });
  dlgTextEl.addEventListener('click', (event) => {
    if (event.target === dlgTextEl) closeText();
  });

  function openBan({ name, onConfirm }) {
    openConfirm({
      title: `Banir ${name} da sala?`,
      text: `${name} sai agora e não consegue entrar de novo enquanto esta sala existir. Você pode readmitir depois, na lista de pessoas.`,
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

  // ---------- Medidor de som (P7) ----------
  // Decorativo: quatro barrinhas coladas no botao de pausa que acendem com
  // o NIVEL (pico 0..1, ja calculado por audiometer.level em app.js -- este
  // modulo so pinta). O aviso de verdade vai para a central; ver
  // renderHostWarning em app.js.
  const soundMeterEl = $('sound-meter');
  const soundMeterBars = soundMeterEl ? [...soundMeterEl.querySelectorAll('.sound-meter-bar')] : [];
  // Quatro degraus grosseiros -- o suficiente pra "ta saindo som", nao um
  // medidor de VU de verdade.
  const SOUND_METER_THRESHOLDS = [0.02, 0.15, 0.35, 0.6];

  function setSoundMeterVisible(visible) {
    soundMeterEl?.classList.toggle('hidden', !visible);
  }

  function setSoundMeterLevel(peak) {
    const p = Number(peak) || 0;
    soundMeterBars.forEach((bar, i) => bar.classList.toggle('is-lit', p >= SOUND_METER_THRESHOLDS[i]));
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
    share: { off: 'Transmitir tela', on: 'Parar de transmitir' },
    camera: { off: 'Câmera', loading: 'Abrindo…', on: 'Desligar câmera' },
    pause: { off: 'Pausar', on: 'Retomar' },
  };

  function setToggleState(id, state) {
    const btn = $(TOGGLE_BUTTON_IDS[id]);
    if (!btn) return;
    const label = TOGGLE_LABELS[id][state] || TOGGLE_LABELS[id].off;
    btn.querySelector('.btn-label').textContent = label;
    // O .btn-label do dock fica com display:none (sai da arvore de
    // acessibilidade): o nome do botao mora no aria-label e acompanha o estado.
    btn.setAttribute('aria-label', label);
    btn.title = label;
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
    if (id === 'share' || id === 'pause' || id === 'camera') setTimeout(redesenharUltimasPresencas, 0);
    // A sua fonte no barramento acompanha a pausa: no tracejado e 'Pausada'.
    if (id === 'pause') {
      const node = $('me-node');
      if (node) node.dataset.state = state === 'on' ? 'paused' : 'live';
    }
  }


  // ---------- Painel de comando (Ctrl+K, 05 §4) ----------
  //
  // Atalho para quem ja sabe o que quer. Cada acao aciona o MESMO controle da
  // tela (botao, fonte, menu), entao nao existe um segundo caminho de logica.
  const cmdLayerEl = $('command-palette');
  const cmdInputEl = $('command-input');
  const cmdListEl = $('command-list');
  let cmdAcoes = [];
  let cmdAtiva = 0;
  let cmdFocoAntes = null;

  function estadoParaComando() {
    const app = $('app');
    const fontes = [...document.querySelectorAll('#bus-live .src')].map((src) => ({
      tileId: src.dataset.tile,
      nome: src.querySelector('.src__name')?.textContent || 'Alguém',
      assistindo: src.hasAttribute('data-watching'),
    }));
    const salas = [...document.querySelectorAll('#room-list-live .room-row:not(:disabled)')].map((row, indice) => ({
      indice,
      nome: row.querySelector('.room-row__name')?.textContent || 'sala',
    }));
    return {
      lugar: app?.dataset.place === 'room' ? 'room' : 'lobby',
      fontes,
      salas,
      transmitindo: $('btn-toggle-share')?.getAttribute('aria-pressed') === 'true',
      pausado: $('btn-pause-share')?.getAttribute('aria-pressed') === 'true',
      cameraLigada: $('btn-toggle-camera')?.getAttribute('aria-pressed') === 'true',
      naMesa: Boolean(root.GoLive.salaVista?.isMesa()),
      conversaAberta: app?.dataset.conv === 'pinned',
    };
  }

  function executarComando(acao) {
    const clicar = (sel) => document.querySelector(sel)?.click();
    const naSala = $('app')?.dataset.place === 'room';
    switch (acao.id) {
      case 'assistir': escolherFonte(acao.alvo, 'only'); break;
      case 'ver-junto': escolherFonte(acao.alvo, 'add'); break;
      case 'parar-assistir': escolherFonte(acao.alvo, 'remove'); break;
      case 'transmitir':
      case 'parar-transmitir': clicar('#btn-toggle-share'); break;
      case 'pausar': clicar('#btn-pause-share'); break;
      case 'trocar-fonte': clicar('#btn-swap-share'); break;
      case 'camera': clicar('#btn-toggle-camera'); break;
      case 'mesa': clicar('#view-mesa'); break;
      case 'por-na-mesa': clicar('#btn-mesa-add'); break;
      case 'conversa': clicar('#btn-conv-toggle'); break;
      case 'teatro': $('app')?.toggleAttribute('data-theater'); break;
      case 'copiar-endereco': clicar('#room-more [data-copy="address"]'); break;
      case 'diagnostico': clicar('#btn-room-health'); break;
      case 'configuracoes': clicar(naSala ? '#btn-room-settings' : '#btn-open-settings'); break;
      case 'sair': clicar('#btn-disconnect'); break;
      case 'entrar':
        document.querySelectorAll('#room-list-live .room-row:not(:disabled)')[acao.alvo]?.click();
        break;
      case 'criar-sala': clicar('#btn-create-room'); break;
      case 'procurar': clicar('#btn-refresh-discovery'); break;
      default: break;
    }
  }

  function renderComando() {
    const visiveis = root.GoLive.comando.filtrar(cmdAcoes, cmdInputEl.value);
    cmdAtiva = Math.min(cmdAtiva, Math.max(0, visiveis.length - 1));
    cmdListEl.innerHTML = visiveis.length
      ? visiveis.map((acao, i) => `<li id="cmd-${i}" class="menu__item${i === cmdAtiva ? ' is-active' : ''}" role="option"
          aria-selected="${i === cmdAtiva}" data-i="${i}">${escapeHtml(acao.rotulo)}${acao.dica
  ? `<span class="menu__hint">${escapeHtml(acao.dica)}</span>` : ''}</li>`).join('')
      : '<li class="menu__note" role="presentation">Nada com esse nome.</li>';
    cmdInputEl.setAttribute('aria-activedescendant', visiveis.length ? `cmd-${cmdAtiva}` : '');
    cmdListEl._visiveis = visiveis;
    cmdListEl.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  function abrirComando() {
    if (!cmdLayerEl || !cmdLayerEl.classList.contains('hidden')) return;
    cmdFocoAntes = document.activeElement;
    cmdAcoes = root.GoLive.comando.acoesDisponiveis(estadoParaComando());
    cmdAtiva = 0;
    cmdInputEl.value = '';
    cmdLayerEl.classList.remove('hidden');
    renderComando();
    cmdInputEl.focus();
  }

  function fecharComando({ devolverFoco = true } = {}) {
    if (!cmdLayerEl || cmdLayerEl.classList.contains('hidden')) return;
    cmdLayerEl.classList.add('hidden');
    if (devolverFoco) cmdFocoAntes?.focus?.({ preventScroll: true });
  }

  function escolherComando(i) {
    const acao = cmdListEl._visiveis?.[i];
    if (!acao) return;
    fecharComando({ devolverFoco: false });
    executarComando(acao);
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (cmdLayerEl?.classList.contains('hidden')) abrirComando();
      else fecharComando();
    }
  });
  cmdInputEl?.addEventListener('input', () => {
    cmdAtiva = 0;
    renderComando();
  });
  cmdInputEl?.addEventListener('keydown', (event) => {
    const total = cmdListEl._visiveis?.length || 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!total) return;
      cmdAtiva = (cmdAtiva + (event.key === 'ArrowDown' ? 1 : total - 1)) % total;
      renderComando();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      escolherComando(cmdAtiva);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      fecharComando();
    }
  });
  cmdListEl?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-i]');
    if (item) escolherComando(Number(item.dataset.i));
  });
  cmdLayerEl?.addEventListener('click', (event) => {
    if (event.target === cmdLayerEl) fecharComando();
  });

  root.GoLive = root.GoLive || {};
  root.GoLive.ui = {
    escapeHtml,
    grid: {
      showTile, removeTile, setPainting, setWatchers, setPaused, setWatched, forgetWatched,
      refreshWatchGates: redesenharPortoesAssistir, onWatchIntent: setWatchIntentHandler, framesShown,
      setHealthChip, setStallNote,
      element: () => gridEl,
      tileEl: (id) => document.getElementById(`tile-${id}`),
      returnTile,
      openTileMenu,
      resync: resyncGrid,
      onTileShown: (fn) => { onTileShown = fn; },
    },
    annotations: {
      setSelf: annotSetSelf,
      setSurface: setAnnotSurface,
      applyOp: applyAnnotOp,
      clearSurface: clearAnnotSurface,
      load: loadAnnotSnapshot,
      snapshot: annotSnapshot,
      forgetAuthor: forgetAnnotAuthor,
      render: ({ onOp }) => { onAnnotOp = onOp; },
      colorFor: annotate.colorFor,
    },
    laser: {
      apply: applyRemoteLaser,
      dropAuthor: forgetLaserAuthor,
      drop: dropLaserSurface,
      render: ({ onOp }) => { onLaserOp = onOp; },
    },
    reactions: {
      apply: applyRemoteReaction,
      dropAuthor: forgetReactionAuthor,
      render: ({ onOp }) => { onReactionOp = onOp; },
    },
    rooms: {
      render: renderRooms,
      setNetworkStatus: renderNetworkStatus,
    },
    dialogs: {
      openCreateRoom, closeCreateRoom, setCreateRoomError,
      openJoinRoom, closeJoinRoom, setJoinRoomPinVisible,
      openBan, openTransferOwner, openConfirm, closeConfirm,
    },
    stageHeader: { set: setStageHeader, clear: clearStageHeader, setStatus: setStageStatus, setName: setStageHeaderName },
    settings: {
      open: openSettings, close: closeSettings, setStatsHtml, isStatsVisible,
      statsDomOps: () => ({ ...statsDomOps }),
    },
    picker: { open: openPicker },
    members: { render: renderMembers, renderBanned },
    chat: { render, append, setHistory, setEnabled, setAttachment, clearAttachment },
    soundMeter: { setVisible: setSoundMeterVisible, setLevel: setSoundMeterLevel },
    warnings: warningCenter,
    setToggleState,
  };
})(window);

/*
 * Maquina de estados da abertura: liga a tela de carregamento (splash) a um
 * ciclo checando -> baixando -> instalando, ou libera o app direto quando
 * nao ha atualizacao, a checagem estoura o tempo, o download trava ou da
 * erro. Ver docs/superpowers/specs/2026-09-12-abertura-com-atualizacao-design.md.
 *
 * Puro de proposito: quem fala com o autoUpdater de verdade (`driver`) e
 * com o relogio de verdade (`scheduler`/`now`) e injetado, entao o teste
 * roda sem Electron e sem esperar segundo nenhum -- mesmo padrao de
 * `deps.dgram` em main/discovery.js.
 *
 * Fluxo:
 *   start() -> onPhase('checking')
 *     'available'   -> onPhase('downloading', {version, progress:0}) + baixa
 *     'downloading' -> onPhase('downloading', {version, progress})
 *     'downloaded'  -> onPhase('installing', {version}) + instala (o
 *                       processo fecha sozinho a partir daqui -- nunca
 *                       chega a emitir 'release')
 *     'not-available' / 'error' -> libera
 *   timeout de checagem (checkTimeoutMs) sem resposta nenhuma -> libera
 *   download sem progresso novo por stallTimeoutMs -> libera
 *
 * `onPhase('release', { reason })` e sempre a ULTIMA chamada (idempotente:
 * so dispara uma vez, e nenhum evento depois dela muda mais nada aqui --
 * quem trata o que vier depois e a janela principal, ja aberta).
 * `minDisplayMs` so segura essa chamada final -- nunca atrasa
 * 'downloading'/'installing', que ja tem progresso de verdade pra mostrar.
 */

'use strict';

function createBootUpdater({
  driver,
  onPhase,
  scheduler = { setTimeout, clearTimeout },
  now = Date.now,
  checkTimeoutMs = 5000,
  stallTimeoutMs = 30000,
  minDisplayMs = 0,
} = {}) {
  let released = false;
  let releasePending = false;
  let downloadAbandoned = false;
  let timer = null;
  let startedAt = 0;

  function clearTimer() {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  }

  function armTimer(ms, onFire) {
    clearTimer();
    timer = scheduler.setTimeout(onFire, ms);
  }

  function finishRelease(reason) {
    released = true;
    clearTimer();
    onPhase('release', { reason });
  }

  // Nao libera antes do piso de exibicao (so importa em dev -- ver decisao
  // 7 da spec): se o resultado chegou cedo demais, agenda a liberacao pro
  // tempo que falta em vez de flashar a tela e sumir.
  function release(reason) {
    if (released || releasePending) return;
    if (reason === 'download-travado') downloadAbandoned = true;
    const wait = minDisplayMs - (now() - startedAt);
    if (wait > 0) {
      releasePending = true;
      armTimer(wait, () => finishRelease(reason));
    } else {
      finishRelease(reason);
    }
  }

  function start() {
    startedAt = now();
    onPhase('checking', {});
    armTimer(checkTimeoutMs, () => release('timeout-checagem'));
    driver.checkForUpdates(false);
  }

  function handleStatus(payload) {
    // Depois de liberado (ou com a liberacao ja agendada pelo piso), quem
    // trata evento novo e a janela principal -- nao esta janela.
    if (released || releasePending) return;
    const { status, version, progress, reason } = payload || {};
    switch (status) {
      case 'available':
        clearTimer();
        onPhase('downloading', { version, progress: 0 });
        armTimer(stallTimeoutMs, () => release('download-travado'));
        driver.downloadUpdate('boot');
        break;
      case 'downloading':
        // Progresso novo reseta o relogio de travamento -- so libera se
        // ficar stallTimeoutMs SEM nenhum avanco, nao stallTimeoutMs desde
        // o inicio do download.
        clearTimer();
        armTimer(stallTimeoutMs, () => release('download-travado'));
        onPhase('downloading', { version, progress: progress ?? 0 });
        break;
      case 'downloaded':
        // Marca liberado direto (sem passar por release()/onPhase('release')):
        // a partir daqui o processo vai fechar sozinho pro instalador, entao
        // nunca faz sentido abrir a janela principal neste caminho.
        clearTimer();
        released = true;
        onPhase('installing', { version });
        driver.quitAndInstall();
        break;
      case 'not-available':
        release('sem-atualizacao');
        break;
      case 'error':
        release(reason || 'erro');
        break;
      default:
        break; // 'checking' do proprio autoUpdater -- ja emitimos em start()
    }
  }

  return { start, handleStatus, isDownloadAbandoned: () => downloadAbandoned };
}

module.exports = { createBootUpdater };

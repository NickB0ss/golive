/*
 * Decide o destino de `downloaded` sem depender do Electron. A origem e a
 * fase do boot precisam viajar juntas: download abandonado na abertura pode
 * ficar pronto, mas nunca pode instalar com uma sala aberta.
 */

'use strict';

function createUpdatePolicy() {
  let bootReleased = false;
  let roomActive = false;

  return {
    markBootReleased() {
      bootReleased = true;
    },
    setRoomActive(active) {
      roomActive = active === true;
    },
    requestManualUpdate(hasDownloadedUpdate) {
      if (roomActive) return 'blocked';
      return hasDownloadedUpdate ? 'install-manual' : 'download-manual';
    },
    handleStatus(payload) {
      if (payload?.status !== 'downloaded') return 'forward';
      if (payload.downloadSource === 'boot') return bootReleased ? 'ready' : 'boot-installing';
      if (payload.downloadSource === 'manual') return roomActive ? 'ready' : 'install-manual';
      return 'forward';
    },
  };
}

module.exports = { createUpdatePolicy };

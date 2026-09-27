'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined') module.exports = api;
  root.GoLiveLobbyRoom = api;
}(typeof window !== 'undefined' ? window : globalThis, () => {
  function peopleForRoom(room) {
    const total = Number.isInteger(room?.peers) && room.peers > 0 ? room.peers : 0;
    const shown = Math.min(total, 4);

    return {
      avatars: Array.from({ length: shown }, (_, index) => index),
      extra: total - shown,
    };
  }

  return { peopleForRoom };
}));

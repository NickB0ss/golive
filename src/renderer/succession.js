'use strict';

(function (root) {
  const SUCCESSOR_TIMEOUT_MS = 15000;

  function survivorsInOrder(candidates, hostId) {
    if (!Array.isArray(candidates)) return [];
    return candidates
      .filter((id) => typeof id === 'string' && id !== hostId)
      .sort((a, b) => Number(a) - Number(b));
  }

  function chooseSuccessor(candidates, hostId) {
    return survivorsInOrder(candidates, hostId)[0] || null;
  }

  function chooseNewOwner(survivors, currentOwnerId, successorId) {
    if (Array.isArray(survivors) && survivors.includes(currentOwnerId)) return currentOwnerId;
    return successorId || null;
  }

  function successorRank(candidates, hostId, myId) {
    if (myId === hostId) return -1;
    return survivorsInOrder(candidates, hostId).indexOf(myId);
  }

  function successorTimeoutMs(rank) {
    return rank <= 0 ? 0 : rank * SUCCESSOR_TIMEOUT_MS;
  }

  const api = {
    SUCCESSOR_TIMEOUT_MS,
    chooseSuccessor,
    chooseNewOwner,
    successorRank,
    successorTimeoutMs,
  };
  root.GoLive = root.GoLive || {};
  root.GoLive.succession = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

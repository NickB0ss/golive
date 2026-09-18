'use strict';

(function (root) {
  function parseRelayKind(kind) {
    if (typeof kind !== 'string') return null;
    const parts = kind.split('@');
    if (parts.length > 2 || !parts[0] || (parts.length === 2 && !parts[1])) return null;
    return { baseKind: parts[0], sourceId: parts[1] || null };
  }

  function isCurrentEpoch(startedAt, currentEpoch) {
    return startedAt === currentEpoch;
  }

  function canAcceptOffer({ kind, from, knownKinds, rolesByKind }) {
    const parsed = parseRelayKind(kind);
    if (!parsed || !knownKinds.includes(parsed.baseKind) || from == null) return false;
    if (!parsed.sourceId) return kind === parsed.baseKind;
    const role = rolesByKind?.[parsed.baseKind]?.get(parsed.sourceId);
    return role?.paiId != null && String(role.paiId) === String(from);
  }

  function canAcceptTree({ kind, peer }) {
    return kind === 'screen' ? peer?.live === true : peer?.cameraOn === true;
  }

  // A sinalizacao e ordenada por conexao, mas o welcome de quem acabou de
  // entrar ainda pode descreve-la como nao-live quando a tree chega. Guarda
  // somente a atribuicao mais nova por origem/kind ate o estado live chegar.
  function createPendingTrees() {
    const byOriginAndKind = new Map();
    const keyOf = (origin, kind) => `${String(origin)}|${kind}`;

    function remember(tree) {
      if (!tree || !Number.isInteger(tree.epoch) || tree.epoch < 0 || tree.from == null) return;
      const key = keyOf(tree.from, tree.kind);
      const previous = byOriginAndKind.get(key);
      if (!previous || tree.epoch >= previous.epoch) byOriginAndKind.set(key, tree);
    }

    function takeWhenLive({ origin, kind, live, latestEpoch = 0 }) {
      const key = keyOf(origin, kind);
      const tree = byOriginAndKind.get(key);
      if (!tree || !live) return null;
      byOriginAndKind.delete(key);
      return tree.epoch >= latestEpoch ? tree : null;
    }

    function forgetOrigin(origin) {
      const prefix = `${String(origin)}|`;
      for (const key of byOriginAndKind.keys()) if (key.startsWith(prefix)) byOriginAndKind.delete(key);
    }

    function clear() {
      byOriginAndKind.clear();
    }

    return { remember, takeWhenLive, forgetOrigin, clear };
  }

  const api = { isCurrentEpoch, canAcceptOffer, canAcceptTree, createPendingTrees };
  root.GoLive = root.GoLive || {};
  root.GoLive.broadcastguards = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

'use strict';
/* Pedras do domino duplo-seis. A sorte entra por argumento, como em
 * baralho.js; a escolha classica foi guardar cada pedra em ordem crescente. */
(function (root) {
  function newSet() {
    const out = [];
    for (let a = 0; a <= 6; a += 1) for (let b = a; b <= 6; b += 1) out.push([a, b]);
    return out;
  }
  function shuffle(stones, random) {
    const out = stones.map((p) => p.slice());
    for (let i = out.length - 1; i > 0; i -= 1) {
      let r = Number(typeof random === 'function' ? random() : 0);
      if (!Number.isFinite(r) || r < 0 || r >= 1) r = 0;
      const j = Math.floor(r * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function valid(p) { return Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 6); }
  function points(p) { return valid(p) ? p[0] + p[1] : 0; }
  const api = { newSet, shuffle, valid, points };
  root.GoLive = root.GoLive || {}; root.GoLive.mesaPedras = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

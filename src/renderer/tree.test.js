'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeTree, allDirect, isAllDirect, sameAssignments,
  FANOUT_ORIGEM, FANOUT_RELAY, PROFUNDIDADE_MAX,
} = require('./tree');

test('constantes batem com a spec de 2026-08-23 (F2)', () => {
  assert.equal(FANOUT_ORIGEM, 1);
  assert.equal(FANOUT_RELAY, 2);
  assert.equal(PROFUNDIDADE_MAX, 2);
});

test('sala de 4 (origem + 3): 1 relay, 2 folhas -- cenario de validacao da spec', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 40, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 10, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 90, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);

  assert.equal(out.get('c').role, 'relay'); // menor RTT vence
  assert.deepEqual(out.get('c').paiId, 'a');
  assert.deepEqual(out.get('c').filhosIds.sort(), ['b', 'd']);

  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('b').paiId, 'c');
  assert.equal(out.get('d').role, 'folha');
  assert.equal(out.get('d').paiId, 'c');
});

test('desempate por quem entrou ha mais tempo quando RTT e igual ou desconhecido', () => {
  const candidates = [
    { id: 'b', joinedAt: 5, rtt: null, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 1, rtt: null, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay'); // entrou primeiro
  assert.equal(out.get('b').role, 'folha');
});

test('quem esta transmitindo ou suspenso nao e candidato a relay', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },  // ja e origem de outra arvore
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: false, suspended: true },  // minimizou (F1.3)
    { id: 'd', joinedAt: 3, rtt: 999, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('d').role, 'relay'); // unico elegivel, mesmo com RTT ruim
  assert.equal(out.get('b').role, 'folha');
  assert.equal(out.get('c').role, 'folha');
});

test('sem nenhum candidato elegivel, todo mundo cai pra direct (malha)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 5, transmitting: true, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'direct');
  assert.equal(out.get('c').role, 'direct');
  assert.equal(out.get('b').paiId, 'a');
});

test('overflow alem da capacidade do relay (fanout 2) cai pra direct com a origem', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false }, // vira relay
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
    { id: 'e', joinedAt: 4, rtt: 40, transmitting: false, suspended: false }, // excedente
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'relay');
  assert.deepEqual(out.get('b').filhosIds.sort(), ['c', 'd']);
  assert.equal(out.get('e').role, 'direct');
  assert.equal(out.get('e').paiId, 'a');
});

test('lista de candidatos vazia devolve mapa vazio', () => {
  assert.equal(computeTree('a', []).size, 0);
});

// ---------- Revisao final F2 ----------

test('relayIneligible tira o no da eleicao de relay sem tira-lo da arvore (#2)', () => {
  const candidates = [
    // Melhor RTT da sala, mas acabou de falhar como relay: nao pode ser
    // reeleito na hora, senao a arvore fica batendo entre dois estados.
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false, relayIneligible: true },
    { id: 'c', joinedAt: 2, rtt: 40, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 50, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay');
  assert.notEqual(out.get('b').role, 'relay');
  // Continua na arvore -- so nao como relay.
  assert.ok(out.has('b'));
});

test('todos vetados como relay caem pra direct (malha)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false, relayIneligible: true },
    { id: 'c', joinedAt: 2, rtt: 6, transmitting: false, suspended: false, relayIneligible: true },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'direct');
  assert.equal(out.get('c').role, 'direct');
  assert.equal(out.get('b').paiId, 'a');
});

test('allDirect poe todo mundo direto na origem (dissolve a arvore, #5)', () => {
  const out = allDirect('a', [{ id: 'b' }, { id: 'c' }]);
  assert.equal(out.size, 2);
  for (const id of ['b', 'c']) {
    assert.equal(out.get(id).role, 'direct');
    assert.equal(out.get(id).paiId, 'a');
    assert.deepEqual(out.get(id).filhosIds, []);
  }
});

// ---------- Malha degenerada como modo de falha (H3) ----------

test('isAllDirect: malha degenerada (nenhum elegivel) e verdadeira', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: true, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 6, transmitting: false, suspended: false, relayIneligible: true },
  ];
  assert.equal(isAllDirect(computeTree('a', candidates)), true);
  // E o mesmo pra dissolucao explicita da arvore (interruptor desligado).
  assert.equal(isAllDirect(allDirect('a', [{ id: 'b' }])), true);
});

test('isAllDirect: arvore com relay de verdade e falsa, mesmo com excedente direct', () => {
  const comRelay = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
  ];
  assert.equal(isAllDirect(computeTree('a', comRelay)), false);

  // Overflow: 'e' e direct, mas ha relay -- a origem paga 2 out-conns, nao 4.
  const comExcedente = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
    { id: 'e', joinedAt: 4, rtt: 40, transmitting: false, suspended: false },
  ];
  assert.equal(isAllDirect(computeTree('a', comExcedente)), false);
});

test('isAllDirect: mapa vazio e falso -- sala vazia nao e modo degradado', () => {
  assert.equal(isAllDirect(computeTree('a', [])), false);
  assert.equal(isAllDirect(new Map()), false);
  assert.equal(isAllDirect(null), false);
});

test('sameAssignments: topologia igual e igual, com filhos em qualquer ordem (#4)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false },
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false },
    { id: 'd', joinedAt: 3, rtt: 30, transmitting: false, suspended: false },
  ];
  const a = computeTree('a', candidates);
  const b = computeTree('a', candidates);
  assert.equal(sameAssignments(a, b), true);

  // Mesma topologia, filhos invertidos -- a ORDEM nao e informacao.
  const reordered = new Map(b);
  reordered.set('b', { ...b.get('b'), filhosIds: [...b.get('b').filhosIds].reverse() });
  assert.equal(sameAssignments(a, reordered), true);
});

// ---------- Saude de encode na eleicao de relay (H2) ----------

test('encoder de software e vetado quando ha alternativa que nao e software', () => {
  const candidates = [
    // Melhor RTT da sala, mas codifica em software: NVENC saturado, encode
    // cai pra CPU. Nao pode carregar 2 encoders + 1 decoder do relay.
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: true, msPerFrame: 22 } },
    { id: 'c', joinedAt: 2, rtt: 40, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: false, msPerFrame: 6 } },
    { id: 'd', joinedAt: 3, rtt: 50, transmitting: false, suspended: false },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay'); // RTT pior, mas encoder de hardware
  assert.notEqual(out.get('b').role, 'relay');
});

test('sem alternativa, encoder de software NAO e excluido -- cai pro resto do criterio', () => {
  const candidates = [
    { id: 'b', joinedAt: 2, rtt: 40, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: true, msPerFrame: 12 } },
    { id: 'c', joinedAt: 1, rtt: 40, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: true, msPerFrame: 12 } },
  ];
  const out = computeTree('a', candidates);
  // Todos software: nao inventa exclusao, ordena por RTT/joinedAt.
  assert.equal(out.get('c').role, 'relay'); // mesmo RTT, entrou primeiro
  assert.equal(out.get('b').role, 'folha');
});

test('msPerFrame alto e penalidade: perde pra msPerFrame baixo mesmo com RTT pior', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: false, msPerFrame: 30 } }, // acima do orcamento (~16.6)
    { id: 'c', joinedAt: 2, rtt: 35, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: false, msPerFrame: 4 } },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('c').role, 'relay'); // GPU livre vence RTT melhor
  assert.equal(out.get('b').role, 'folha');
});

test('candidato sem encodeHealth e neutro: nao penalizado, nao favorecido', () => {
  // Sem dado NAO perde pra um comprovadamente ruim...
  const vsRuim = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: true, msPerFrame: 40 } },
    { id: 'c', joinedAt: 2, rtt: 40, transmitting: false, suspended: false }, // sem encodeHealth
  ];
  assert.equal(computeTree('a', vsRuim).get('c').role, 'relay');

  // ...mas tambem nao ganha de graca de um comprovadamente bom com RTT melhor.
  const vsBom = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false,
      encodeHealth: { softwareEncoder: false, msPerFrame: 4 } },
    { id: 'c', joinedAt: 2, rtt: 40, transmitting: false, suspended: false },
  ];
  assert.equal(computeTree('a', vsBom).get('b').role, 'relay'); // RTT decide
});

test('encodeHealth null e tratado igual a ausente (cliente de versao antiga)', () => {
  const candidates = [
    { id: 'b', joinedAt: 1, rtt: 10, transmitting: false, suspended: false, encodeHealth: null },
    { id: 'c', joinedAt: 2, rtt: 20, transmitting: false, suspended: false, encodeHealth: null },
  ];
  const out = computeTree('a', candidates);
  assert.equal(out.get('b').role, 'relay'); // so RTT/joinedAt, como hoje
});

test('sameAssignments detecta mudanca de papel, de pai, de filhos e de tamanho', () => {
  const base = new Map([
    ['b', { role: 'relay', paiId: 'a', filhosIds: ['c', 'd'] }],
    ['c', { role: 'folha', paiId: 'b', filhosIds: [] }],
    ['d', { role: 'folha', paiId: 'b', filhosIds: [] }],
  ]);
  const roleChanged = new Map(base);
  roleChanged.set('c', { role: 'direct', paiId: 'a', filhosIds: [] });
  assert.equal(sameAssignments(base, roleChanged), false);

  const paiChanged = new Map(base);
  paiChanged.set('c', { role: 'folha', paiId: 'x', filhosIds: [] });
  assert.equal(sameAssignments(base, paiChanged), false);

  const filhosChanged = new Map(base);
  filhosChanged.set('b', { role: 'relay', paiId: 'a', filhosIds: ['c', 'e'] });
  assert.equal(sameAssignments(base, filhosChanged), false);

  const smaller = new Map(base);
  smaller.delete('d');
  assert.equal(sameAssignments(base, smaller), false);

  // Mapa vazio (estado inicial) nunca e igual a uma arvore de verdade --
  // e o que garante que o PRIMEIRO recalculo sempre se aplica.
  assert.equal(sameAssignments(base, new Map()), false);
});

// --- Invariantes de computeTree sob entrada aleatoria -------------------
// Nao ha fast-check no projeto; PRNG com semente fixa pra ser reproduzivel.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('computeTree respeita as invariantes da spec pra qualquer sala (1000 casos aleatorios)', () => {
  const rand = mulberry32(0xC0FFEE);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let caso = 0; caso < 1000; caso += 1) {
    const n = Math.floor(rand() * 9); // 0..8 espectadores
    const candidates = [];
    for (let i = 0; i < n; i += 1) {
      const health = pick([
        null,
        undefined,
        { softwareEncoder: rand() < 0.5, msPerFrame: pick([null, 5, 12, 20, 40]) },
      ]);
      candidates.push({
        id: `p${i}`,
        joinedAt: Math.floor(rand() * 1000),
        rtt: pick([null, 5, 20, 50, 120, 300]),
        transmitting: rand() < 0.2,
        suspended: rand() < 0.2,
        relayIneligible: rand() < 0.2,
        encodeHealth: health,
      });
    }

    const out = computeTree('origem', candidates);
    const ctx = `caso ${caso}, n=${n}`;

    // 1. todo candidato aparece exatamente uma vez; nada alem deles.
    assert.equal(out.size, candidates.length, `${ctx}: todo candidato atribuido`);
    for (const c of candidates) assert.ok(out.has(c.id), `${ctx}: ${c.id} presente`);

    const relays = [...out.entries()].filter(([, a]) => a.role === 'relay');
    const folhas = [...out.entries()].filter(([, a]) => a.role === 'folha');

    // 2. no maximo um relay (FANOUT_ORIGEM).
    assert.ok(relays.length <= FANOUT_ORIGEM, `${ctx}: <=1 relay, veio ${relays.length}`);

    if (relays.length === 0) {
      // sem relay: ou sala vazia, ou todo mundo direct (malha degenerada).
      for (const [, a] of out) {
        assert.equal(a.role, 'direct', `${ctx}: sem relay => tudo direct`);
        assert.equal(a.paiId, 'origem', `${ctx}: direct pendura na origem`);
      }
      assert.equal(folhas.length, 0, `${ctx}: sem relay => sem folha`);
      continue;
    }

    const [relayId, relayA] = relays[0];
    const relayCand = candidates.find((c) => c.id === relayId);

    // 3. o relay eleito nao pode ser inelegivel.
    assert.ok(
      !relayCand.transmitting && !relayCand.suspended && !relayCand.relayIneligible,
      `${ctx}: relay elegivel`
    );

    // 4. profundidade <= 2: relay pendura na origem, folha pendura no relay.
    assert.equal(relayA.paiId, 'origem', `${ctx}: relay.paiId === origem`);
    assert.ok(relayA.filhosIds.length <= FANOUT_RELAY, `${ctx}: relay com <=${FANOUT_RELAY} filhos`);
    for (const [, a] of folhas) {
      assert.equal(a.paiId, relayId, `${ctx}: folha pendura no relay`);
      assert.deepEqual(a.filhosIds, [], `${ctx}: folha nao tem filho`);
    }

    // 5. filhosIds do relay === exatamente o conjunto de folhas.
    assert.deepEqual(
      [...relayA.filhosIds].sort(),
      folhas.map(([id]) => id).sort(),
      `${ctx}: filhosIds do relay casa com as folhas`
    );

    // 6. o excedente e direct pendurado na origem -- nunca folha orfa.
    for (const [, a] of out) {
      if (a.role === 'direct') assert.equal(a.paiId, 'origem', `${ctx}: direct na origem`);
    }

    // 7. ninguem e pai de si mesmo.
    for (const [id, a] of out) assert.notEqual(a.paiId, id, `${ctx}: ${id} nao e pai de si`);
  }
});

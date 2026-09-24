'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeTree, allDirect, isAllDirect, sameAssignments,
  FANOUT_ORIGEM, FANOUT_RELAY,
} = require('./tree');

// Sala de `espectadores` pessoas alem da origem, todos elegiveis, RTT
// crescente na ordem de chegada (p0 e o melhor candidato a relay).
function sala(espectadores, extra = () => ({})) {
  const out = [];
  for (let i = 0; i < espectadores; i += 1) {
    out.push({ id: `p${i}`, joinedAt: i, rtt: 10 + i, transmitting: false, suspended: false, ...extra(i) });
  }
  return out;
}

function porPapel(assignments, role) {
  return [...assignments].filter(([, a]) => a.role === role).map(([id]) => id).sort();
}

// ---------- Fanout 2 na origem (auditoria 2026-09-18, anexo 3) ----------
//
// As constantes sao conferidas pelo COMPORTAMENTO: quantos relays saem,
// quantos filhos cabem em cada um, quando comeca o 'direct'. A auditoria
// achou FANOUT_ORIGEM e PROFUNDIDADE_MAX "decorativas" -- computeTree nao lia
// nenhuma, e o teste so conferia o valor escrito. Um teste de valor passaria
// com a constante morta de novo; estes nao.

test('fanout das constantes e o que computeTree de fato monta na sala cheia', () => {
  const capacidade = FANOUT_ORIGEM * (1 + FANOUT_RELAY);
  const out = computeTree('a', sala(capacidade + 3));
  const relays = porPapel(out, 'relay');
  assert.equal(relays.length, FANOUT_ORIGEM, 'relays pendurados na origem');
  for (const id of relays) assert.equal(out.get(id).filhosIds.length, FANOUT_RELAY, `${id} lotado`);
  assert.equal(porPapel(out, 'folha').length, FANOUT_ORIGEM * FANOUT_RELAY);
  assert.equal(porPapel(out, 'direct').length, 3, 'so o que nao cabe vira direct');
});

// Tabela da sala de 2 a 8 pessoas (origem inclusa). A coluna que importa e
// "encoders na origem" = relays + direct: a sala de 6 tinha 3, agora tem 2.
const TABELA_SALAS = [
  // filhos: quantos filhos cada relay tem, ordenado
  { pessoas: 2, relays: 1, folhas: 0, direct: 0, filhos: [0] },
  { pessoas: 3, relays: 1, folhas: 1, direct: 0, filhos: [1] },
  { pessoas: 4, relays: 1, folhas: 2, direct: 0, filhos: [2] },
  { pessoas: 5, relays: 2, folhas: 2, direct: 0, filhos: [1, 1] },
  { pessoas: 6, relays: 2, folhas: 3, direct: 0, filhos: [1, 2] },
  { pessoas: 7, relays: 2, folhas: 4, direct: 0, filhos: [2, 2] },
  { pessoas: 8, relays: 2, folhas: 4, direct: 1, filhos: [2, 2] },
];

for (const linha of TABELA_SALAS) {
  test(`sala de ${linha.pessoas}: ${linha.relays} relay(s), ${linha.folhas} folha(s), ${linha.direct} direct`, () => {
    const out = computeTree('a', sala(linha.pessoas - 1));
    const relays = porPapel(out, 'relay');
    assert.equal(out.size, linha.pessoas - 1);
    assert.equal(relays.length, linha.relays);
    assert.equal(porPapel(out, 'folha').length, linha.folhas);
    assert.equal(porPapel(out, 'direct').length, linha.direct);
    assert.deepEqual(relays.map((id) => out.get(id).filhosIds.length).sort(), linha.filhos);
    // Profundidade 2: relay e direct na origem, folha num relay, folha sem filho.
    for (const [id, a] of out) {
      if (a.role === 'folha') {
        assert.equal(out.get(a.paiId).role, 'relay', `${id} pendura num relay`);
        assert.deepEqual(a.filhosIds, []);
      } else {
        assert.equal(a.paiId, 'a', `${id} pendura na origem`);
      }
    }
  });
}

test('sala de 6: a origem paga 2 encoders em vez de 3 (anexo 3)', () => {
  const out = computeTree('a', sala(5));
  const encodersNaOrigem = [...out.values()].filter((a) => a.role !== 'folha').length;
  assert.equal(encodersNaOrigem, 2);
});

test('os dois relays sao os dois melhores do ranking, nao os dois primeiros da lista', () => {
  const candidatos = sala(5, (i) => ({ rtt: [90, 80, 5, 70, 6][i] }));
  const out = computeTree('a', candidatos);
  assert.deepEqual(porPapel(out, 'relay'), ['p2', 'p4']);
});

test('segundo relay respeita carga: quem ja repassa pra outra origem fica de fora', () => {
  // p0 e p1 teriam o melhor RTT, mas p1 ja e relay de outra origem.
  const candidatos = sala(5, (i) => ({ relayLoad: i === 1 ? 2 : 0 }));
  const out = computeTree('a', candidatos);
  assert.deepEqual(porPapel(out, 'relay'), ['p0', 'p2']);
  assert.equal(out.get('p1').role, 'folha');
});

test('segundo relay respeita saude de encode: software fica de fora havendo alternativa', () => {
  const candidatos = sala(5, (i) => ({
    encodeHealth: i === 1 ? { softwareEncoder: true, msPerFrame: 22 } : null,
  }));
  const out = computeTree('a', candidatos);
  assert.deepEqual(porPapel(out, 'relay'), ['p0', 'p2']);
});

test('um so elegivel numa sala de 6: 1 relay lotado e o resto direct', () => {
  const candidatos = sala(5, (i) => ({ suspended: i !== 3 }));
  const out = computeTree('a', candidatos);
  assert.deepEqual(porPapel(out, 'relay'), ['p3']);
  assert.equal(out.get('p3').filhosIds.length, FANOUT_RELAY);
  assert.equal(porPapel(out, 'direct').length, 5 - 1 - FANOUT_RELAY);
});

// ---------- Estabilidade (opts.anterior) e reeleicao ----------

test('mesma entrada e mesma anterior: sameAssignments da igual (nao re-emite tree)', () => {
  const candidatos = sala(6);
  const primeira = computeTree('a', candidatos);
  const segunda = computeTree('a', candidatos, { anterior: primeira });
  assert.equal(sameAssignments(primeira, segunda), true);
});

test('um dos dois relays cai: as folhas do outro NAO trocam de pai', () => {
  const antes = computeTree('a', sala(6)); // p0[p2,p4] p1[p3,p5]
  const [relayA, relayB] = porPapel(antes, 'relay');
  const filhosDeA = [...antes.get(relayA).filhosIds].sort();
  // relayB falhou: continua na sala (a conexao caiu, ele nao saiu), mas vetado.
  const depois = computeTree('a', sala(6, (i) => ({ relayIneligible: `p${i}` === relayB })), { anterior: antes });

  assert.equal(depois.get(relayA).role, 'relay');
  assert.deepEqual([...depois.get(relayA).filhosIds].sort(), filhosDeA, 'sub-arvore intacta');
  for (const id of filhosDeA) assert.equal(depois.get(id).paiId, relayA);
  assert.notEqual(depois.get(relayB).role, 'relay');
  // Continuam 2 relays e ninguem virou direct: a arvore se refez inteira.
  assert.equal(porPapel(depois, 'relay').length, 2);
  assert.equal(porPapel(depois, 'direct').length, 0);
});

test('um dos dois relays SAI da sala: o outro fica com os mesmos filhos e as orfas acham pai', () => {
  const antes = computeTree('a', sala(6));
  const [relayA, relayB] = porPapel(antes, 'relay');
  const orfas = antes.get(relayB).filhosIds;
  const restantes = sala(6).filter((c) => c.id !== relayB);
  const depois = computeTree('a', restantes, { anterior: antes });

  assert.deepEqual(
    [...depois.get(relayA).filhosIds].sort(),
    [...antes.get(relayA).filhosIds].sort(),
  );
  for (const id of orfas) {
    const a = depois.get(id);
    assert.ok(a.role === 'relay' || depois.get(a.paiId)?.role === 'relay', `${id} tem pai relay`);
  }
  assert.equal(porPapel(depois, 'direct').length, 0);
});

test('alguem entra: quem ja era folha de um relay que segue relay nao troca de pai', () => {
  const antes = computeTree('a', sala(5)); // p0[p2,p4] p1[p3]
  const depois = computeTree('a', sala(6), { anterior: antes });
  for (const [id, a] of antes) {
    if (a.role !== 'folha') continue;
    assert.equal(depois.get(id).paiId, a.paiId, `${id} continua com ${a.paiId}`);
  }
  assert.equal(depois.get('p5').role, 'folha');
  assert.equal(depois.get('p5').paiId, 'p1'); // unica vaga que sobrou
});

test('sala de 4 cresce pra 5: quem chega vira o segundo relay, as folhas do primeiro ficam', () => {
  const antes = computeTree('a', sala(3)); // p0[p1,p2]
  const depois = computeTree('a', sala(4), { anterior: antes });
  // p1 e p2 tem RTT melhor que o recem-chegado p3, mas promover uma delas
  // tiraria uma folha de p0 sem ganho nenhum. Sem `anterior` seria p1.
  assert.equal(computeTree('a', sala(4)).get('p1').role, 'relay');
  assert.deepEqual(porPapel(depois, 'relay'), ['p0', 'p3']);
  assert.deepEqual([...depois.get('p0').filhosIds].sort(), ['p1', 'p2']);
  assert.deepEqual(depois.get('p3').filhosIds, []);
});

test('estabilidade nao segura relay que piorou de saude de encode', () => {
  const antes = computeTree('a', sala(5)); // p0 e p1 relays
  const pior = sala(5, (i) => ({
    encodeHealth: i === 0 ? { softwareEncoder: true, msPerFrame: 25 } : null,
  }));
  const depois = computeTree('a', pior, { anterior: antes });
  assert.notEqual(depois.get('p0').role, 'relay');
  assert.equal(depois.get('p1').role, 'relay'); // o outro, saudavel, fica
});

test('estabilidade vence RTT: relay de pe nao e trocado por quem mediu RTT melhor', () => {
  const antes = computeTree('a', sala(5)); // p0 e p1 relays
  const rttMudou = sala(5, (i) => ({ rtt: [40, 50, 3, 4, 5][i] }));
  assert.deepEqual(porPapel(computeTree('a', rttMudou), 'relay'), ['p2', 'p3']);
  const depois = computeTree('a', rttMudou, { anterior: antes });
  assert.equal(sameAssignments(antes, depois), true);
});

test('anterior nao prende folha a quem deixou de ser relay nem estoura o fanout', () => {
  // Anterior forjada: tres folhas no mesmo pai (acima do fanout) e uma
  // folha de alguem que agora esta suspenso.
  const anterior = new Map([
    ['p0', { role: 'relay', paiId: 'a', filhosIds: ['p2', 'p3', 'p4'] }],
    ['p2', { role: 'folha', paiId: 'p0', filhosIds: [] }],
    ['p3', { role: 'folha', paiId: 'p0', filhosIds: [] }],
    ['p4', { role: 'folha', paiId: 'p0', filhosIds: [] }],
    ['p5', { role: 'folha', paiId: 'p1', filhosIds: [] }],
  ]);
  const out = computeTree('a', sala(6, (i) => ({ suspended: i === 1 })), { anterior });
  for (const id of porPapel(out, 'relay')) assert.ok(out.get(id).filhosIds.length <= FANOUT_RELAY);
  assert.notEqual(out.get('p5').paiId, 'p1');
});

test('anterior invalida (nao-Map) e ignorada', () => {
  const semAnterior = computeTree('a', sala(6));
  assert.equal(sameAssignments(semAnterior, computeTree('a', sala(6), { anterior: {} })), true);
  assert.equal(sameAssignments(semAnterior, computeTree('a', sala(6), { anterior: null })), true);
});

test('segunda origem prefere relay sem carga anunciada por outra arvore', () => {
  const pool = [
    { id: 'b', joinedAt: 1, rtt: 5, transmitting: false, suspended: false, relayLoad: 0 },
    { id: 'c', joinedAt: 2, rtt: 10, transmitting: false, suspended: false, relayLoad: 0 },
    { id: 'd', joinedAt: 3, rtt: 20, transmitting: false, suspended: false, relayLoad: 0 },
  ];
  const first = computeTree('a', pool);
  const firstRelay = [...first].find(([, assignment]) => assignment.role === 'relay')[0];
  const secondPool = pool.map((candidate) => ({
    ...candidate,
    relayLoad: candidate.id === firstRelay ? first.get(firstRelay).filhosIds.length : 0,
  }));

  const second = computeTree('x', secondPool);
  const secondRelay = [...second].find(([, assignment]) => assignment.role === 'relay')[0];

  assert.notEqual(secondRelay, firstRelay);
  assert.equal(secondPool.find((candidate) => candidate.id === secondRelay).relayLoad, 0);
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

test('overflow alem da capacidade dos dois relays cai pra direct com a origem', () => {
  const out = computeTree('a', sala(8)); // sala de 9: 2 relays x 2 folhas + 2
  assert.deepEqual(porPapel(out, 'relay'), ['p0', 'p1']);
  assert.deepEqual(porPapel(out, 'direct'), ['p6', 'p7']);
  for (const id of ['p6', 'p7']) assert.equal(out.get(id).paiId, 'a');
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

function conferirInvariantes(out, candidates, ctx) {
  // 1. todo candidato aparece exatamente uma vez; nada alem deles.
  assert.equal(out.size, candidates.length, `${ctx}: todo candidato atribuido`);
  for (const c of candidates) assert.ok(out.has(c.id), `${ctx}: ${c.id} presente`);

  const relays = [...out.entries()].filter(([, a]) => a.role === 'relay');
  const folhas = [...out.entries()].filter(([, a]) => a.role === 'folha');

  // 2. no maximo FANOUT_ORIGEM relays.
  assert.ok(relays.length <= FANOUT_ORIGEM, `${ctx}: <=${FANOUT_ORIGEM} relays, veio ${relays.length}`);

  if (relays.length === 0) {
    // sem relay: ou sala vazia, ou todo mundo direct (malha degenerada).
    for (const [, a] of out) {
      assert.equal(a.role, 'direct', `${ctx}: sem relay => tudo direct`);
      assert.equal(a.paiId, 'origem', `${ctx}: direct pendura na origem`);
    }
    assert.equal(folhas.length, 0, `${ctx}: sem relay => sem folha`);
    return;
  }

  const relayIds = new Set(relays.map(([id]) => id));
  const elegiveis = candidates.filter((c) => !c.transmitting && !c.suspended && !c.relayIneligible);

  for (const [relayId, relayA] of relays) {
    const relayCand = candidates.find((c) => c.id === relayId);
    // 3. o relay eleito nao pode ser inelegivel.
    assert.ok(
      !relayCand.transmitting && !relayCand.suspended && !relayCand.relayIneligible,
      `${ctx}: relay elegivel`
    );
    // 4. profundidade <= 2: relay pendura na origem, com <= FANOUT_RELAY filhos.
    assert.equal(relayA.paiId, 'origem', `${ctx}: relay.paiId === origem`);
    assert.ok(relayA.filhosIds.length <= FANOUT_RELAY, `${ctx}: relay com <=${FANOUT_RELAY} filhos`);
  }
  for (const [, a] of folhas) {
    assert.ok(relayIds.has(a.paiId), `${ctx}: folha pendura num relay`);
    assert.deepEqual(a.filhosIds, [], `${ctx}: folha nao tem filho`);
  }

  // 5. a uniao dos filhosIds === exatamente o conjunto de folhas, sem repetir,
  //    e cada folha esta na lista do PROPRIO pai.
  const todosFilhos = relays.flatMap(([, a]) => a.filhosIds).sort();
  assert.deepEqual(todosFilhos, folhas.map(([id]) => id).sort(), `${ctx}: filhosIds casam com as folhas`);
  for (const [id, a] of folhas) {
    assert.ok(out.get(a.paiId).filhosIds.includes(id), `${ctx}: ${id} esta na lista do pai`);
  }

  // 5b. direct so existe com todo relay lotado, e o numero de relays e o
  //     que a sala pede: um segundo so quando o primeiro nao cobre todos.
  const directs = [...out.values()].filter((a) => a.role === 'direct');
  if (directs.length) {
    for (const [, a] of relays) assert.equal(a.filhosIds.length, FANOUT_RELAY, `${ctx}: direct com relay com vaga`);
  }
  const esperados = Math.min(elegiveis.length, FANOUT_ORIGEM, Math.max(1, Math.ceil(candidates.length / (1 + FANOUT_RELAY))));
  assert.equal(relays.length, esperados, `${ctx}: numero de relays`);

  // 6. o excedente e direct pendurado na origem -- nunca folha orfa.
  for (const [, a] of out) {
    if (a.role === 'direct') assert.equal(a.paiId, 'origem', `${ctx}: direct na origem`);
  }

  // 7. ninguem e pai de si mesmo.
  for (const [id, a] of out) assert.notEqual(a.paiId, id, `${ctx}: ${id} nao e pai de si`);
}

// Perturba uma sala como a vida real faz entre dois recalculos: alguem sai,
// alguem entra, alguem minimiza, alguem acabou de falhar como relay.
function perturbar(candidates, rand, n0) {
  const out = candidates
    .filter(() => rand() >= 0.2)
    .map((c) => ({
      ...c,
      suspended: rand() < 0.15 ? !c.suspended : c.suspended,
      relayIneligible: rand() < 0.15,
    }));
  const novos = Math.floor(rand() * 3);
  for (let i = 0; i < novos; i += 1) {
    out.push({ id: `n${n0 + i}`, joinedAt: 2000 + i, rtt: null, transmitting: false, suspended: false });
  }
  return out;
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
    conferirInvariantes(out, candidates, `caso ${caso}, n=${n}`);

    // Segundo recalculo sobre a sala perturbada, com a anterior: as mesmas
    // invariantes valem, e nenhuma folha troca de pai a toa -- se o pai
    // dela continua relay e ela nao foi promovida, ela fica com ele.
    const depoisCands = perturbar(candidates, rand, caso);
    const depois = computeTree('origem', depoisCands, { anterior: out });
    const ctx2 = `caso ${caso} (recalculo), n=${depoisCands.length}`;
    conferirInvariantes(depois, depoisCands, ctx2);
    for (const [id, a] of out) {
      if (a.role !== 'folha' || !depois.has(id)) continue;
      const agora = depois.get(id);
      if (agora.role === 'relay' || depois.get(a.paiId)?.role !== 'relay') continue;
      assert.equal(agora.paiId, a.paiId, `${ctx2}: ${id} ficou com ${a.paiId}`);
    }
    // E recalcular sem mudar nada nao muda nada.
    assert.equal(sameAssignments(depois, computeTree('origem', depoisCands, { anterior: depois })), true, `${ctx2}: ponto fixo`);
  }
});

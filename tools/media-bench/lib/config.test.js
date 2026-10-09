'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgv, buildPlan, validateConfig, SCENARIOS, DEFAULTS, QUICK, HELP_TEXT } = require('./config');

const plan = (argv) => {
  const p = parseArgv(argv);
  return { parsed: p, plan: buildPlan(p.options) };
};

test('padrao: 4 cenarios x viewers 1 e 4 = 8, todos validos', () => {
  const { parsed, plan: p } = plan([]);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(p.errors, []);
  assert.equal(p.scenarios.length, SCENARIOS.length * 2);
  assert.deepEqual(p.scenarios.map((s) => s.key).slice(0, 2), ['direct-nohint@v1', 'direct-nohint@v4']);
  for (const s of p.scenarios) assert.deepEqual(validateConfig(s.config), []);
  assert.equal(p.scenarios[0].config.width, DEFAULTS.width);
});

test('a matriz cobre direct/nohint, direct/motion, canvas/motion e relay/motion', () => {
  const ids = SCENARIOS.map((s) => [s.pipeline, s.hint, s.topology].join('/'));
  assert.deepEqual(ids, ['direct//p2p', 'direct/motion/p2p', 'canvas/motion/p2p', 'canvas/motion/relay']);
});

test('--quick reduz formato e tempos, e argumento explicito vence', () => {
  const { plan: p } = plan(['--quick', '--fps=24']);
  const c = p.scenarios[0].config;
  assert.equal(c.width, QUICK.width);
  assert.equal(c.durationMs, QUICK.durationMs);
  assert.equal(c.fps, 24);
});

test('--only e --viewers filtram', () => {
  const { plan: p } = plan(['--only=relay-motion,direct-motion', '--viewers=2']);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.scenarios.map((s) => s.key), ['relay-motion@v2', 'direct-motion@v2']);
});

test('cenario desconhecido, viewers fora do limite e numero invalido sao erro', () => {
  assert.match(plan(['--only=nada']).plan.errors.join(), /desconhecido/);
  assert.match(plan(['--viewers=0']).plan.errors.join(), /viewers/);
  assert.match(plan(['--viewers=17']).plan.errors.join(), /viewers/);
  assert.match(plan(['--viewers=a']).plan.errors.join(), /viewers/);
  assert.match(plan(['--fps=abc']).plan.errors.join(), /inteiro/);
  assert.match(plan(['--fps=500']).plan.errors.join(), /fps/);
  assert.match(plan(['--width=1921']).plan.errors.join(), /pares/);
  assert.match(plan(['--codec=h265']).plan.errors.join(), /codec/);
  assert.match(plan(['--duration-ms=1500', '--sample-ms=1000']).plan.errors.join(), /durationMs/);
});

test('argumento desconhecido e flag sem valor viram erro, sem lancar', () => {
  assert.match(parseArgv(['--bogus']).errors.join(), /desconhecido/);
  assert.match(parseArgv(['--fps']).errors.join(), /exige um valor/);
  assert.match(parseArgv(['--quick=1']).errors.join(), /nao recebe valor/);
  assert.deepEqual(parseArgv(['--fps', '30']).options, { fps: '30' });
  assert.deepEqual(parseArgv(undefined).errors, []);
});

test('cenario personalizado: canvas assume motion; canvas sem motion e recusado', () => {
  const ok = plan(['--pipeline=canvas', '--topology=relay', '--viewers=2']).plan;
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.scenarios[0].config.hint, 'motion');
  const ruim = plan(['--pipeline=canvas', '--hint=']).plan;
  assert.match(ruim.errors.join(), /canvas/);
  assert.match(plan(['--only=direct-motion', '--pipeline=direct']).plan.errors.join(), /nao combina/);
});

test('owned-window exige opt-in explicito', () => {
  const sem = plan(['--source=owned-window']).plan;
  assert.equal(sem.errors.filter((e) => /allow-own-window-capture/.test(e)).length, 1, 'erro comum aparece uma vez');
  const com = plan(['--source=owned-window', '--allow-own-window-capture']).plan;
  assert.deepEqual(com.errors, []);
  assert.equal(com.scenarios[0].config.source, 'owned-window');
});

test('o padrao NUNCA e captura de janela', () => {
  assert.equal(DEFAULTS.source, 'synthetic');
  for (const s of plan(['--quick']).plan.scenarios) assert.equal(s.config.source, 'synthetic');
});

test('timeout calculado cobre todos os cenarios; explicito e validado', () => {
  const { plan: p } = plan(['--quick']);
  assert.ok(p.timeoutMs >= p.scenarios.length * (QUICK.warmupMs + QUICK.durationMs));
  assert.equal(plan(['--timeout-ms=90000']).plan.timeoutMs, 90000);
  assert.match(plan(['--timeout-ms=10']).plan.errors.join(), /timeoutMs/);
});

test('rotulo e sanitizado', () => {
  assert.equal(plan(['--label=a b/c:d']).plan.label, 'a_b_c_d');
});

test('ajuda documenta saidas e o opt-in', () => {
  assert.match(HELP_TEXT, /--quick/);
  assert.match(HELP_TEXT, /--allow-own-window-capture/);
  assert.match(HELP_TEXT, /NAO e captura WGC real/);
});

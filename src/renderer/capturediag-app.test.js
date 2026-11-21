'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function setup() {
  let sample = { nowMs: 1000, sourceFrames: 30, drawnFrames: 30, repeatedFrames: 0,
    drawMsTotal: 6, lastSourceFrameAtMs: 1000, lastOutputFrameAtMs: 1000, contextResets: 0, loopRunning: true };
  const lines = [];
  const ctx = vm.createContext({ screenRelay: { stats: () => sample }, captureDiagPrev: null,
    encodediag: { HEARTBEAT_MS: 15000 }, console: { info: line => lines.push(line) } });
  const start = source.indexOf('  function logCaptureDiag(');
  assert.ok(start >= 0, 'diagnostico de captura carregado');
  vm.runInContext(source.slice(start, source.indexOf('\n  }', start) + 4), ctx);
  return { ctx, lines, set: next => { sample = { ...sample, ...next }; } };
}

test('diagnostico mede entrada e canvas por delta sem inventar taxa na primeira amostra', () => {
  const f = setup();
  f.ctx.logCaptureDiag();
  assert.match(f.lines[0], /entrada=\?fps canvas=\?fps/);
  f.set({ nowMs: 16000, sourceFrames: 480, drawnFrames: 450, drawMsTotal: 906,
    lastSourceFrameAtMs: 15900, lastOutputFrameAtMs: 15950 });
  f.ctx.logCaptureDiag();
  assert.match(f.lines[1], /entrada=30fps canvas=28fps/);
  assert.match(f.lines[1], /desenhoMs=2\.0/);
  assert.match(f.lines[1], /entradaHa=100ms saidaHa=50ms/);
});

test('diagnostico separa repeticao estatica de entrada e acusa loop encerrado imediatamente', () => {
  const f = setup();
  f.ctx.logCaptureDiag();
  f.set({ nowMs: 16000, repeatedFrames: 75, lastOutputFrameAtMs: 16000 });
  f.ctx.logCaptureDiag();
  assert.match(f.lines[1], /entrada=0fps canvas=0fps repete=5fps/);
  f.set({ nowMs: 16500, loopRunning: false });
  f.ctx.logCaptureDiag();
  assert.match(f.lines[2], /loop=parado/);
});

test('diagnostico tem heartbeat e nova saida nao herda contador anterior', () => {
  const f = setup();
  f.ctx.logCaptureDiag();
  f.set({ nowMs: 2000 });
  f.ctx.logCaptureDiag();
  assert.equal(f.lines.length, 1);
  const previous = f.ctx.screenRelay;
  f.ctx.screenRelay = { stats: previous.stats };
  f.ctx.logCaptureDiag();
  assert.match(f.lines[1], /entrada=\?fps canvas=\?fps/);
});

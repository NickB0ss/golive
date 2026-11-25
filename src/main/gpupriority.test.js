'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  criarPrioridadeGpu, lerModo, querCpu, descreverResultado,
  GPU_NORMAL, GPU_HIGH, GPU_REALTIME, CPU_NORMAL, CPU_ACIMA,
} = require('./gpupriority');

function montar({ procs, modo, addon, pidPrincipal = 300 } = {}) {
  const chamadas = [];
  const logs = [];
  const erros = [];
  let tick = null;
  const lista = { atual: procs || [
    { pid: 100, type: 'Browser' },
    { pid: 200, type: 'GPU' },
    { pid: 300, type: 'Tab' },
    { pid: 400, type: 'Tab' },
    { pid: 500, type: 'Utility', serviceName: 'video_capture.mojom.VideoCaptureService' },
  ] };
  const ctl = criarPrioridadeGpu({
    addon: addon === undefined ? {
      setProcessGpuPriority: (pid, gpu, cpu) => {
        chamadas.push({ pid, gpu, cpu });
        return { status: 0, win32Error: 0, cpuApplied: cpu !== 0, readBack: gpu };
      },
    } : addon,
    listarProcessos: () => lista.atual,
    pidPrincipal: () => pidPrincipal,
    logger: { log: (m) => logs.push(m), error: (m) => erros.push(m) },
    modo,
    agendar: (fn) => { tick = fn; return 1; },
    desagendar: () => { tick = null; },
  });
  return { ctl, chamadas, logs, erros, lista, rodarTick: () => tick?.(), temTick: () => tick !== null };
}

test('lerModo: padrao high, aceita realtime e off', () => {
  assert.equal(lerModo(undefined), 'high');
  assert.equal(lerModo(''), 'high');
  assert.equal(lerModo('REALTIME'), 'realtime');
  assert.equal(lerModo('off'), 'off');
  assert.equal(lerModo('0'), 'off');
  assert.equal(lerModo('qualquer'), 'high');
});

test('querCpu: navegador, GPU, utilitarios e o renderer principal; nao os outros renderers', () => {
  assert.equal(querCpu({ pid: 1, type: 'Browser' }, 9), true);
  assert.equal(querCpu({ pid: 1, type: 'GPU' }, 9), true);
  assert.equal(querCpu({ pid: 1, type: 'Utility' }, 9), true);
  assert.equal(querCpu({ pid: 9, type: 'Tab' }, 9), true);
  assert.equal(querCpu({ pid: 8, type: 'Tab' }, 9), false);
  assert.equal(querCpu({ pid: 8, type: 'Tab' }, null), false);
});

test('ao ativar, sobe GPU para HIGH em todos e CPU so nos que tocam a imagem', () => {
  const { ctl, chamadas, logs, erros } = montar();
  ctl.definirAtivo(true);
  assert.deepEqual(chamadas, [
    { pid: 100, gpu: GPU_HIGH, cpu: CPU_ACIMA },
    { pid: 200, gpu: GPU_HIGH, cpu: CPU_ACIMA },
    { pid: 300, gpu: GPU_HIGH, cpu: CPU_ACIMA },
    { pid: 400, gpu: GPU_HIGH, cpu: 0 },
    { pid: 500, gpu: GPU_HIGH, cpu: CPU_ACIMA },
  ]);
  assert.equal(erros.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[gpu\] prioridade high: Browser pid=100 gpu=ok\(lida=4\) cpu=ok/);
});

test('modo realtime usa a classe 5', () => {
  const { ctl, chamadas } = montar({ modo: 'realtime' });
  ctl.definirAtivo(true);
  assert.ok(chamadas.every((c) => c.gpu === GPU_REALTIME));
});

test('ativar duas vezes nao reaplica', () => {
  const { ctl, chamadas } = montar();
  ctl.definirAtivo(true);
  const n = chamadas.length;
  ctl.definirAtivo(true);
  assert.equal(chamadas.length, n);
});

test('a revisao periodica pega o processo de GPU recriado depois de cair', () => {
  const { ctl, chamadas, lista, rodarTick } = montar();
  ctl.definirAtivo(true);
  chamadas.length = 0;
  lista.atual = lista.atual.filter((p) => p.pid !== 200).concat([{ pid: 201, type: 'GPU' }]);
  rodarTick();
  assert.deepEqual(chamadas, [{ pid: 201, gpu: GPU_HIGH, cpu: CPU_ACIMA }]);
  rodarTick();
  assert.equal(chamadas.length, 1, 'processo ja ajustado nao e tocado de novo');
});

test('ao desativar, volta para NORMAL so os processos vivos e para a revisao', () => {
  const { ctl, chamadas, lista, temTick } = montar();
  ctl.definirAtivo(true);
  chamadas.length = 0;
  lista.atual = lista.atual.filter((p) => p.pid !== 400);
  ctl.definirAtivo(false);
  assert.equal(temTick(), false);
  assert.deepEqual(chamadas, [
    { pid: 100, gpu: GPU_NORMAL, cpu: CPU_NORMAL },
    { pid: 200, gpu: GPU_NORMAL, cpu: CPU_NORMAL },
    { pid: 300, gpu: GPU_NORMAL, cpu: CPU_NORMAL },
    { pid: 500, gpu: GPU_NORMAL, cpu: CPU_NORMAL },
  ]);
  assert.equal(ctl.ativo, false);
});

test('modo off nunca chama o addon', () => {
  const { ctl, chamadas } = montar({ modo: 'off' });
  ctl.definirAtivo(true);
  ctl.definirAtivo(false);
  assert.equal(chamadas.length, 0);
});

test('sem addon, avisa uma vez e segue sem erro', () => {
  const { ctl, erros } = montar({ addon: null });
  ctl.definirAtivo(true);
  ctl.definirAtivo(false);
  ctl.definirAtivo(true);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /addon nativo indisponivel/);
});

test('falha do D3DKMT vai para o log de erro com o NTSTATUS em hexa e nao e repetida', () => {
  const chamadas = [];
  const { ctl, erros, rodarTick } = montar({
    procs: [{ pid: 200, type: 'GPU' }],
    addon: {
      setProcessGpuPriority: (pid, gpu, cpu) => {
        chamadas.push(pid);
        return { status: -1073741727, win32Error: 0, cpuApplied: cpu !== 0, readBack: -1 };
      },
    },
  });
  ctl.definirAtivo(true);
  rodarTick();
  assert.equal(chamadas.length, 1);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /GPU pid=200 gpu=falhou\(0xc0000061\) cpu=ok/);
});

test('addon que lanca nao derruba o controle', () => {
  const { ctl, erros } = montar({
    procs: [{ pid: 200, type: 'GPU' }],
    addon: { setProcessGpuPriority: () => { throw new Error('boom'); } },
  });
  assert.doesNotThrow(() => ctl.definirAtivo(true));
  assert.ok(erros.some((e) => /boom/.test(e)));
});

test('descreverResultado cobre indisponivel e sem acesso', () => {
  const p = { pid: 7, type: 'GPU' };
  assert.equal(descreverResultado(p, { status: -1 }), 'GPU pid=7 indisponivel');
  assert.equal(descreverResultado(p, { status: -2, win32Error: 5 }), 'GPU pid=7 sem-acesso(win32=5)');
  assert.equal(descreverResultado(p, null), 'GPU pid=7 erro');
});

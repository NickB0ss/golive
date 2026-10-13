'use strict';

/*
 * CPU por cenario a partir de amostras de app.getAppMetrics().
 *
 * `percentCPUUsage` e a unidade do Electron: soma sobre os processos do
 * proprio app (navegador, renderer, GPU, utilitarios). NAO mede o resto da
 * maquina nem a GPU de verdade (o encoder de hardware nao aparece como CPU), e
 * a primeira leitura de cada processo costuma vir 0 -- por isso a janela
 * descarta amostras sem processo e o chamador deve medir depois do
 * aquecimento.
 */

/** Soma por tipo de processo de uma leitura de getAppMetrics(). */
function bucketMetrics(metrics) {
  const byType = {};
  let total = 0;
  for (const m of Array.isArray(metrics) ? metrics : []) {
    const v = Number(m?.cpu?.percentCPUUsage);
    if (!Number.isFinite(v)) continue;
    const type = String(m.type || 'Unknown');
    byType[type] = (byType[type] || 0) + v;
    total += v;
  }
  return { byType, total };
}

function mean(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

/**
 * `samples`: [{ t, byType, total }] (t = Date.now()). Considera so
 * from <= t <= to. Sem amostra na janela => null (nunca 0 inventado).
 */
function summarizeCpu(samples, fromMs, toMs) {
  const inside = (samples || []).filter((s) => s && s.t >= fromMs && s.t <= toMs && Number.isFinite(s.total));
  if (!inside.length) return null;
  const types = new Set(inside.flatMap((s) => Object.keys(s.byType || {})));
  const byType = {};
  for (const type of types) {
    byType[type] = mean(inside.map((s) => s.byType?.[type] ?? 0));
  }
  return {
    samples: inside.length,
    totalMean: mean(inside.map((s) => s.total)),
    totalMax: Math.max(...inside.map((s) => s.total)),
    byTypeMean: byType,
  };
}

module.exports = { bucketMetrics, summarizeCpu };

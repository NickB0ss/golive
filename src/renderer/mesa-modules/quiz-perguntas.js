'use strict';

/*
 * Banco do Quiz (spec 2026-10-03-idiomas, secao 5): 8 temas x 60, cada
 * pergunta nas tres linguas, com a MESMA resposta certa. A sala sorteia ids;
 * cada pessoa monta o texto no proprio idioma (texto()).
 */

(function (root) {
  const TEMAS = Object.freeze(['games', 'anime', 'futebol', 'esportes', 'musica', 'filmes', 'ciencia', 'mundo']);
  const LINGUAS = { 'pt-BR': 'pt', en: 'en', es: 'es' };

  function carregar(tema) {
    const g = root.GoLive && root.GoLive.mesaQuizBanco && root.GoLive.mesaQuizBanco[tema];
    if (g) return g;
    if (typeof module !== 'undefined') return require(`./quiz-banco/${tema}`);
    return [];
  }

  const perguntas = Object.freeze(TEMAS.flatMap((tema) =>
    carregar(tema).map((q) => Object.freeze({ ...q, tema }))));
  const indice = new Map(perguntas.map((q) => [q.id, q]));

  function porId(id) { return indice.get(id) || null; }

  function texto(q, idioma) {
    const [pergunta, alternativas] = q[LINGUAS[idioma] || 'pt'];
    return { pergunta, alternativas };
  }

  function validarBanco(minimoPorTema = 60) {
    const ids = new Set();
    for (const tema of TEMAS) {
      const doTema = perguntas.filter((q) => q.tema === tema);
      if (doTema.length < minimoPorTema) throw new Error(`Tema ${tema}: ${doTema.length} de ${minimoPorTema}`);
    }
    for (const q of perguntas) {
      if (typeof q.id !== 'string' || !q.id.startsWith(`${q.tema}-`) || ids.has(q.id)) throw new Error(`id: ${q.id}`);
      ids.add(q.id);
      if (![1, 2, 3].includes(q.nivel)) throw new Error(`nivel: ${q.id}`);
      if (!Number.isInteger(q.certa) || q.certa < 0 || q.certa > 3) throw new Error(`certa: ${q.id}`);
      for (const l of ['pt', 'en', 'es']) {
        const par = q[l];
        if (!Array.isArray(par) || typeof par[0] !== 'string' || !par[0].trim()) throw new Error(`${l}: ${q.id}`);
        const alts = par[1];
        const invalidas = !Array.isArray(alts) || alts.length !== 4 || new Set(alts).size !== 4
          || alts.some((a) => !String(a).trim());
        if (invalidas) throw new Error(`alternativas ${l}: ${q.id}`);
      }
    }
    for (const l of ['pt', 'en', 'es']) {
      const vistas = new Set();
      for (const q of perguntas) {
        if (vistas.has(q[l][0])) throw new Error(`repetida ${l}: ${q.id}`);
        vistas.add(q[l][0]);
      }
    }
    return true;
  }

  const api = { TEMAS, perguntas, porId, texto, validarBanco };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizPerguntas = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

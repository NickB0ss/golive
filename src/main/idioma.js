'use strict';

// Idioma do app (spec 2026-10-03-idiomas, secao 2). Puro e testavel sem
// Electron: quem chama passa os idiomas do sistema e o caminho de idioma.json.
// A preferencia mora aqui, e nao no config.js, porque a splash e o processo
// principal nao enxergam o localStorage da janela.

const IDIOMAS = ['pt-BR', 'en', 'es'];
const PREFERENCIAS = ['auto', ...IDIOMAS];
const POR_PREFIXO = { pt: 'pt-BR', en: 'en', es: 'es' };

function normalizarPreferencia(preferencia) {
  return PREFERENCIAS.includes(preferencia) ? preferencia : 'auto';
}

function resolverIdioma(preferencia, idiomasDoSistema) {
  const normalizada = normalizarPreferencia(preferencia);
  if (normalizada !== 'auto') return normalizada;

  const idiomas = Array.isArray(idiomasDoSistema) ? idiomasDoSistema : [];
  for (const tag of idiomas) {
    const prefixo = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (POR_PREFIXO[prefixo]) return POR_PREFIXO[prefixo];
  }
  return 'en';
}

function lerPreferencia(arquivo, fsMod = require('fs')) {
  try {
    const conteudo = fsMod.readFileSync(arquivo, 'utf8');
    return normalizarPreferencia(JSON.parse(conteudo).preferencia);
  } catch {
    return 'auto';
  }
}

function gravarPreferencia(arquivo, preferencia, fsMod = require('fs')) {
  const normalizada = normalizarPreferencia(preferencia);
  fsMod.writeFileSync(arquivo, JSON.stringify({ preferencia: normalizada }), 'utf8');
  return normalizada;
}

module.exports = {
  IDIOMAS,
  PREFERENCIAS,
  resolverIdioma,
  lerPreferencia,
  gravarPreferencia,
};

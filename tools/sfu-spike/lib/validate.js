'use strict';

/*
 * Validacao de forma dos parametros que chegam da pagina. O mediasoup valida
 * o conteudo fino de rtpParameters/dtlsParameters; aqui so se barra o que
 * nao tem o formato esperado ANTES de chegar a ele (tipo errado, tamanho
 * absurdo, chave de prototipo).
 */

const { SfuError } = require('./errors');

const MAX_ID = 128;
const MAX_JSON = 64 * 1024;

function bad(message) {
  return new SfuError('BAD_REQUEST', message);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function objectParam(v, name) {
  if (!isPlainObject(v)) throw bad(`${name} deve ser um objeto`);
  return v;
}

function idParam(v, name) {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ID) throw bad(`${name} deve ser texto de 1 a ${MAX_ID} caracteres`);
  return v;
}

function oneOf(v, allowed, name) {
  if (typeof v !== 'string' || !allowed.includes(v)) throw bad(`${name} deve ser um de: ${allowed.join(', ')}`);
  return v;
}

function arrayParam(v, name, max) {
  if (!Array.isArray(v) || v.length > max) throw bad(`${name} deve ser uma lista de ate ${max} itens`);
  return v;
}

/** Tamanho serializado limitado: params acima disso nao sao legitimos. */
function checkSize(params) {
  let size;
  try {
    size = JSON.stringify(params ?? null).length;
  } catch {
    throw bad('parametros nao serializaveis');
  }
  if (size > MAX_JSON) throw bad('parametros grandes demais');
}

function rtpCapabilitiesParam(v, name) {
  objectParam(v, name);
  arrayParam(v.codecs, `${name}.codecs`, 64);
  if (v.headerExtensions !== undefined) arrayParam(v.headerExtensions, `${name}.headerExtensions`, 64);
  return v;
}

function rtpParametersParam(v, name) {
  objectParam(v, name);
  arrayParam(v.codecs, `${name}.codecs`, 16);
  if (v.codecs.length === 0) throw bad(`${name}.codecs vazio`);
  if (v.encodings !== undefined) arrayParam(v.encodings, `${name}.encodings`, 16);
  if (v.headerExtensions !== undefined) arrayParam(v.headerExtensions, `${name}.headerExtensions`, 32);
  return v;
}

function dtlsParametersParam(v, name) {
  objectParam(v, name);
  arrayParam(v.fingerprints, `${name}.fingerprints`, 8);
  if (v.fingerprints.length === 0) throw bad(`${name}.fingerprints vazio`);
  if (v.role !== undefined) oneOf(v.role, ['auto', 'client', 'server'], `${name}.role`);
  return v;
}

module.exports = {
  MAX_ID, MAX_JSON, isPlainObject, objectParam, idParam, oneOf, arrayParam, checkSize,
  rtpCapabilitiesParam, rtpParametersParam, dtlsParametersParam,
};

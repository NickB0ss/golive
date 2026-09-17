'use strict';

/*
 * Codigo curto de tema, pra mandar pro amigo pelo Discord. Modulo puro --
 * sem DOM, sem rede, e sem importar theme.js (que continua desacoplado).
 *
 * A carga util e de 7 bytes:
 *
 *   0    versao do formato
 *   1    temp  (0-1 quantizado em 0-255)
 *   2    level (0-1 quantizado em 0-255)
 *   3-5  cor de acao (r, g, b)
 *   6    checksum dos seis anteriores
 *
 * O que ele NAO carrega e o ponto principal: nao ha campo pra --live,
 * --warn nem --danger. A trava semantica da spec de 2026-09-03 sobrevive
 * POR CONSTRUCAO, nao por uma checagem que alguem possa esquecer de rodar.
 *
 * Alfabeto base32 de Crockford e nao base64 porque o codigo vai ser colado
 * no Discord e as vezes DITADO: nao diferencia maiuscula de minuscula, nao
 * usa +, / nem =, e tira I, L, O e U pra nao confundir com 1 e 0. Na
 * leitura, I e L viram 1 e O vira 0 -- quem errou por confusao visual
 * ainda acerta.
 *
 * O checksum nao e seguranca, e ergonomia: rejeita um caractere trocado
 * antes de a pessoa ver um tema aleatorio e achar que o amigo tem pessimo
 * gosto. A versao permite mudar o formato depois sem aplicar um codigo
 * velho com significado novo.
 */

(function (root) {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const PREFIX = 'GL';
  const VERSION = 1;
  const CHARS = 12; // 7 bytes = 56 bits -> ceil(56/5) = 12 caracteres

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  function quantizar(v) {
    return Math.round(clamp01(v) * 255);
  }

  function checksum(bytes) {
    let soma = 0;
    for (const b of bytes) soma = (soma + b) & 255;
    return soma;
  }

  /** Bytes -> base32. `value` nunca passa de 12 bits (drenamos 5 a cada
   * volta antes de somar 8), entao nao ha risco de estourar o inteiro de
   * 32 bits dos operadores bit a bit do JS. */
  function bytesParaBase32(bytes) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const b of bytes) {
      value = (value << 8) | b;
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  function base32ParaBytes(texto) {
    let bits = 0;
    let value = 0;
    const out = [];
    let ultimoIndice = 0;
    for (const ch of texto) {
      const idx = ALPHABET.indexOf(ch);
      if (idx < 0) return null;
      ultimoIndice = idx;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    if (out.length === 7 && ultimoIndice !== 0 && ultimoIndice !== 16) return null;
    return out;
  }

  function agrupar(texto) {
    return `${PREFIX}-${texto.slice(0, 4)}-${texto.slice(4, 8)}-${texto.slice(8, 12)}`;
  }

  /** Normaliza o que a pessoa colou: tira o prefixo, tira tudo que nao e
   * do alfabeto (hifen, espaco, quebra de linha de um copiar torto), e
   * desfaz as confusoes visuais. */
  function normalizar(texto) {
    if (typeof texto !== 'string') return null;
    const cru = texto
      .trim()
      .toUpperCase()
      .replace(/^GL[-\s]*/, '')
      .replace(/[\s-]/g, '')
      .replace(/[IL]/g, '1')
      .replace(/O/g, '0');
    return cru.length === CHARS ? cru : null;
  }

  function rgbDe(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return [0, 0, 0];
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexDe(r, g, b) {
    const p = (c) => c.toString(16).padStart(2, '0');
    return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
  }

  /** So pro teste forjar uma versao desconhecida sem reimplementar a conta.
   * Recebe os SEIS primeiros bytes e acrescenta o checksum. */
  function encodeRaw(seisBytes) {
    const bytes = [...seisBytes];
    bytes.push(checksum(bytes));
    return agrupar(bytesParaBase32(bytes));
  }

  function encode(tema) {
    const base = (tema && tema.base) || {};
    const [r, g, b] = rgbDe(tema && tema.act);
    return encodeRaw([VERSION, quantizar(base.temp), quantizar(base.level), r, g, b]);
  }

  function decode(texto) {
    const limpo = normalizar(texto);
    if (!limpo) return null;
    const bytes = base32ParaBytes(limpo);
    if (!bytes || bytes.length !== 7) return null;
    if (bytes[0] !== VERSION) return null;
    if (checksum(bytes.slice(0, 6)) !== bytes[6]) return null;
    return {
      base: { temp: bytes[1] / 255, level: bytes[2] / 255 },
      act: hexDe(bytes[3], bytes[4], bytes[5]),
    };
  }

  const api = { encode, decode, encodeRaw, PREFIX, VERSION, ALPHABET };

  root.GoLive = root.GoLive || {};
  root.GoLive.themecode = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

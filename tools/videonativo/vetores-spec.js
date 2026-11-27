'use strict';
// Vetores V1-V4 da secao 12 de docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, copiados
// do hex da spec (nao recalculados), e os campos de cada um. Usados pelos testes de
// src/main/videonativo/ e pelo teste cruzado com o golive-media. Fica em tools/ para nao ir no pacote.

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

const CHAVE = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');

const V1 = {
  campos: { tipo: 1, sessao: 0x12345678, seq: 1, tempo: 1000000, quadro: 1, indice: 0, total: 1, flags: 0x03 },
  payload: hex('00 00 00 01 65 88 84 00'),
  hex: hex(`47 4c 01 01 12 34 56 78 00 00 00 01 00 0f 42 40
            00 00 00 01 00 00 00 01 03 00 00 08 00 00 00 01
            65 88 84 00 8d e1 f6 1a c6 0f 92 c1 b5 b6 4f 6a
            57 86 2b 90`),
  hmac32: hex('8de1f61ac60f92c1b5b64f6a57862b90b5f7939f78c7c5128089af12e231d9aa'),
};

const V2 = {
  campos: { tipo: 3, sessao: 0x12345678, seq: 7, tempo: 2000000, flags: 0x08 },
  entradas: [{ quadro: 2, primeiro: 3, quantidade: 2 }],
  hex: hex(`47 4c 01 03 12 34 56 78 00 00 00 07 00 1e 84 80
            00 00 00 00 00 00 00 00 08 00 00 0a 01 00 00 00
            00 02 00 03 00 02 11 45 fa c4 86 70 dc 09 d7 16
            e7 2e 4d 4e c8 08`),
};

const V3 = {
  campos: { tipo: 5, sessao: 0x12345678, seq: 8, tempo: 2000100, flags: 0x08 },
  relatorio: {
    intervaloUs: 200000, esperados: 240, recebidos: 235, kbps: 9850, atrasoMedioUs: 1500, atrasoMaxUs: 4200,
    maiorSeq: 1200, ecoTempo: 0x001e8000, ecoEsperaUs: 350, quadrosCompletos: 12, quadrosVencidos: 0,
    recuperadosFec: 3, nacks: 2,
  },
  hex: hex(`47 4c 01 05 12 34 56 78 00 00 00 08 00 1e 84 e4
            00 00 00 00 00 00 00 00 08 00 00 28 00 03 0d 40
            00 f0 00 eb 00 00 26 7a 00 00 05 dc 00 00 10 68
            00 00 04 b0 00 1e 80 00 00 00 01 5e 00 0c 00 00
            00 03 00 02 7c 4f 3a 02 24 81 a1 0c 5b 97 2a 1b
            1a 1c 60 ce`),
};

// V4: a spec mostra o comeco, a etiqueta e o SHA-256 do datagrama inteiro (1200 bytes).
const fragmento0 = Buffer.alloc(1152);
for (let j = 0; j < 1152; j++) fragmento0[j] = j & 0xff;
const V4 = {
  campos: { tipo: 2, sessao: 0x12345678, seq: 16, tempo: 3000000, quadro: 5, indice: 0, total: 2, flags: 0x00 },
  quadro: Buffer.concat([fragmento0, hex('aa bb cc dd ee')]),
  fragmento0,
  fragmento1: hex('aa bb cc dd ee'),
  inicio: hex(`47 4c 01 02 12 34 56 78 00 00 00 10 00 2d c6 c0
               00 00 00 05 00 00 00 02 00 00 04 84 02 00 04 85
               aa ba ce de ea 05 06 07 08 09 0a 0b 0c 0d 0e 0f`),
  hmac: hex('34 c7 a8 3a 2c 00 5a ca 3e e5 c2 07 f4 4e 11 75'),
  sha256: '13534af7549571596d40603b921d2fa3e0e7c90dd8343f9da215333f09445d25',
  tamanho: 1200,
};

module.exports = { CHAVE, V1, V2, V3, V4, hex };

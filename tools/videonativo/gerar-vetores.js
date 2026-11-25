'use strict';
const crypto = require('crypto');
const CHAVE = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
function pacote({ tipo, sessao, seq, tempo, quadro = 0, frag = 0, total = 0, flags = 0, payload }) {
  const h = Buffer.alloc(28);
  h.write('GL', 0, 'latin1'); h[2] = 1; h[3] = tipo;
  h.writeUInt32BE(sessao, 4); h.writeUInt32BE(seq, 8); h.writeUInt32BE(tempo, 12);
  h.writeUInt32BE(quadro, 16); h.writeUInt16BE(frag, 20); h.writeUInt16BE(total, 22);
  h[24] = flags; h[25] = 0; h.writeUInt16BE(payload.length, 26);
  const corpo = Buffer.concat([h, payload]);
  const tag = crypto.createHmac('sha256', CHAVE).update(corpo).digest().subarray(0, 16);
  return Buffer.concat([corpo, tag]);
}
const hex = (b) => b.toString('hex').replace(/(..)/g, '$1 ').trim();
const linhas = (b) => { const out = []; for (let i = 0; i < b.length; i += 16) out.push(i.toString(16).padStart(4, '0') + '  ' + hex(b.subarray(i, i + 16))); return out.join('\n'); };

const v1 = pacote({ tipo: 1, sessao: 0x12345678, seq: 1, tempo: 1000000, quadro: 1, frag: 0, total: 1, flags: 0x03,
  payload: Buffer.from('0000000165888400', 'hex') });
const nack = Buffer.alloc(10); nack[0] = 1; nack[1] = 0; nack.writeUInt32BE(2, 2); nack.writeUInt16BE(3, 6); nack.writeUInt16BE(2, 8);
const v2 = pacote({ tipo: 3, sessao: 0x12345678, seq: 7, tempo: 2000000, flags: 0x08, payload: nack });
const r = Buffer.alloc(40);
r.writeUInt32BE(200000, 0); r.writeUInt16BE(240, 4); r.writeUInt16BE(235, 6); r.writeUInt32BE(9850, 8);
r.writeUInt32BE(1500, 12); r.writeUInt32BE(4200, 16); r.writeUInt32BE(1200, 20); r.writeUInt32BE(0x001E8000, 24);
r.writeUInt32BE(350, 28); r.writeUInt16BE(12, 32); r.writeUInt16BE(0, 34); r.writeUInt16BE(3, 36); r.writeUInt16BE(2, 38);
const v3 = pacote({ tipo: 5, sessao: 0x12345678, seq: 8, tempo: 2000100, flags: 0x08, payload: r });

// FEC: quadro 5, 2 fragmentos, grupo [0,1]
const f0 = Buffer.alloc(1152); for (let j = 0; j < 1152; j++) f0[j] = j & 0xff;
const f1 = Buffer.from('aabbccddee', 'hex');
const L = Math.max(f0.length, f1.length);
const fec = Buffer.alloc(4 + L); fec[0] = 2; fec[1] = 0; fec.writeUInt16BE(f0.length ^ f1.length, 2);
for (let j = 0; j < L; j++) fec[4 + j] = (f0[j] || 0) ^ (f1[j] || 0);
const v4 = pacote({ tipo: 2, sessao: 0x12345678, seq: 16, tempo: 3000000, quadro: 5, frag: 0, total: 2, flags: 0x00, payload: fec });
// recuperacao de f1 a partir de f0 + fec
const lenRec = fec.readUInt16BE(2) ^ f0.length;
const rec = Buffer.alloc(L); for (let j = 0; j < L; j++) rec[j] = fec[4 + j] ^ f0[j];
console.log('V1', v1.length); console.log(linhas(v1));
console.log('V2', v2.length); console.log(linhas(v2));
console.log('V3', v3.length); console.log(linhas(v3));
console.log('V4', v4.length, 'sha256', crypto.createHash('sha256').update(v4).digest('hex'));
console.log(linhas(v4.subarray(0, 48))); console.log('hmac', hex(v4.subarray(v4.length - 16)));
console.log('rec ok', lenRec, rec.subarray(0, lenRec).equals(f1));
// negativo: v1 com um bit trocado no payload
const neg = Buffer.from(v1); neg[30] ^= 0x01;
const tagNeg = crypto.createHmac('sha256', CHAVE).update(neg.subarray(0, neg.length - 16)).digest().subarray(0, 16);
console.log('neg confere?', tagNeg.equals(neg.subarray(neg.length - 16)));
// HMAC completo do V1 (32 bytes) pra conferir truncamento
console.log('V1 hmac32', crypto.createHmac('sha256', CHAVE).update(v1.subarray(0, v1.length - 16)).digest('hex'));

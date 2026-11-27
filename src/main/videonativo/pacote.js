/*
 * Pacote do video nativo: cabecalho, payloads, HMAC e janela de replay.
 * Contrato: docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md (secoes 4, 5, 6.1, 7 e 8).
 *
 * Dois lados:
 *   - quem manda: `fragmentarQuadro` (6.1 + FEC da 7) gera os pacotes ainda sem sessao/sequencia/tempo,
 *     e `montarDatagrama` sela cada um (sequencia e tempo entram na hora do envio, porque o reenvio
 *     ganha sequencia nova e o relay reescreve por salto). Os `payload*` codificam os outros tipos.
 *   - quem recebe: `Verificador` segue a ordem da 4.5 e para no primeiro erro, contando o descarte
 *     pelo nome da spec. Nada antes do HMAC aloca estado ou responde.
 *
 * O espelho em C++ do lado de quem manda esta em native/media/pacote.{h,cc}.
 * Puro Node, sem Electron.
 */

'use strict';

const crypto = require('node:crypto');
const C = require('./constantes');

const { TIPO, FLAG } = C;
const VAZIO = Buffer.alloc(0);

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

function hmac16(chave, corpo) {
  return crypto.createHmac('sha256', chave).update(corpo).digest().subarray(0, C.TAM_HMAC);
}

function u32(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

/**
 * Monta o datagrama inteiro: cabecalho (28) + payload + HMAC (16). Nao valida a semantica do tipo
 * (os testes precisam montar pacotes invalidos de proposito); so o que impede escrever o buffer.
 * @param {{tipo:number, sessao:number, seq:number, tempo:number, quadro?:number, indice?:number,
 *   total?:number, flags?:number, reservado?:number, payload?:Buffer}} p
 * @param {Buffer} chave 32 bytes da sessao
 */
function montarDatagrama(p, chave) {
  const payload = p.payload || VAZIO;
  if (payload.length > C.TAM_MAX_PAYLOAD) throw new RangeError(`payload de ${payload.length} bytes`);
  for (const k of ['sessao', 'seq', 'tempo']) if (!u32(p[k])) throw new RangeError(`${k} invalido: ${p[k]}`);
  const quadro = p.quadro || 0;
  if (!u32(quadro)) throw new RangeError(`quadro invalido: ${quadro}`);
  const buf = Buffer.allocUnsafe(C.TAM_CABECALHO + payload.length + C.TAM_HMAC);
  buf.writeUInt16BE(C.MAGIA, 0);
  buf[2] = C.VERSAO_PROTOCOLO;
  buf[3] = p.tipo;
  buf.writeUInt32BE(p.sessao, 4);
  buf.writeUInt32BE(p.seq, 8);
  buf.writeUInt32BE(p.tempo, 12);
  buf.writeUInt32BE(quadro, 16);
  buf.writeUInt16BE(p.indice || 0, 20);
  buf.writeUInt16BE(p.total || 0, 22);
  buf[24] = p.flags || 0;
  buf[25] = p.reservado || 0;
  buf.writeUInt16BE(payload.length, 26);
  payload.copy(buf, C.TAM_CABECALHO);
  const fim = C.TAM_CABECALHO + payload.length;
  hmac16(chave, buf.subarray(0, fim)).copy(buf, fim);
  return buf;
}

/**
 * Payload de um FEC (5.2) sobre os fragmentos de um grupo, na ordem de indice.
 * @param {Buffer[]} frags
 */
function payloadFec(frags) {
  const L = Math.max(...frags.map((f) => f.length));
  const out = Buffer.alloc(4 + L);
  out[0] = frags.length;
  let xorTam = 0;
  for (const f of frags) {
    xorTam ^= f.length;
    for (let j = 0; j < f.length; j++) out[4 + j] ^= f[j];
  }
  out.writeUInt16BE(xorTam, 2);
  return out;
}

/**
 * Quebra um quadro Annex B em pacotes (6.1), com o FEC de cada grupo logo depois do ultimo
 * fragmento dele (7). Devolve os pacotes sem sessao, sequencia e tempo, que `montarDatagrama`
 * acrescenta na hora de mandar. Quadro acima de MAX_FRAGMENTOS: devolve null (6.2: nao manda).
 * @param {Buffer} dados
 * @param {{quadro:number, keyframe:boolean, fecN?:number}} op fecN 0 = sem FEC
 */
function fragmentarQuadro(dados, { quadro, keyframe, fecN = C.FEC_N_PADRAO }) {
  if (!dados || dados.length < 1) throw new RangeError('quadro vazio');
  if (!u32(quadro) || quadro === 0) throw new RangeError(`quadro invalido: ${quadro}`);
  if (!Number.isInteger(fecN) || fecN < 0 || fecN > C.FEC_N_MAX) throw new RangeError(`fecN invalido: ${fecN}`);
  const n = Math.ceil(dados.length / C.TAM_FRAGMENTO);
  if (n > C.MAX_FRAGMENTOS) return null;
  const base = keyframe ? FLAG.KEYFRAME : 0;
  const passo = fecN || n;
  const out = [];
  for (let ini = 0; ini < n; ini += passo) {
    const fim = Math.min(ini + passo, n);
    const grupo = [];
    for (let i = ini; i < fim; i++) {
      const payload = dados.subarray(i * C.TAM_FRAGMENTO, Math.min((i + 1) * C.TAM_FRAGMENTO, dados.length));
      grupo.push(payload);
      const flags = base | (i === n - 1 ? FLAG.FIM_DE_QUADRO : 0);
      out.push({ tipo: TIPO.VIDEO, quadro, indice: i, total: n, flags, payload });
    }
    if (fecN > 0) out.push({ tipo: TIPO.FEC, quadro, indice: ini, total: n, flags: base, payload: payloadFec(grupo) });
  }
  return out;
}

/** @param {{quadro:number, primeiro:number, quantidade:number}[]} entradas */
function payloadNack(entradas) {
  if (entradas.length < 1 || entradas.length > C.NACK_MAX_ENTRADAS) throw new RangeError('NACK com 1 a 64 entradas');
  const out = Buffer.alloc(2 + 8 * entradas.length);
  out[0] = entradas.length;
  entradas.forEach((e, k) => {
    out.writeUInt32BE(e.quadro, 2 + 8 * k);
    out.writeUInt16BE(e.primeiro, 6 + 8 * k);
    out.writeUInt16BE(e.quantidade, 8 + 8 * k);
  });
  return out;
}

function payloadPedirKeyframe({ motivo, ultimoQuadro }) {
  const out = Buffer.alloc(8);
  out[0] = motivo;
  out.writeUInt32BE(ultimoQuadro, 4);
  return out;
}

// Ordem e largura dos campos do RELATORIO (5.5).
const CAMPOS_RELATORIO = [
  ['intervaloUs', 4], ['esperados', 2], ['recebidos', 2], ['kbps', 4], ['atrasoMedioUs', 4], ['atrasoMaxUs', 4],
  ['maiorSeq', 4], ['ecoTempo', 4], ['ecoEsperaUs', 4], ['quadrosCompletos', 2], ['quadrosVencidos', 2],
  ['recuperadosFec', 2], ['nacks', 2],
];

/** Contadores de 16 bits saturam em 65535 (5.5). */
function payloadRelatorio(r) {
  const out = Buffer.alloc(40);
  let off = 0;
  for (const [nome, tam] of CAMPOS_RELATORIO) {
    const v = r[nome] || 0;
    if (tam === 2) out.writeUInt16BE(Math.min(v, 0xffff), off);
    else out.writeUInt32BE(v >>> 0, off);
    off += tam;
  }
  return out;
}

function payloadOla({ estado = 0, ecoTempo = 0, ecoEsperaUs = 0 } = {}) {
  const out = Buffer.alloc(12);
  out[0] = estado;
  out.writeUInt32BE(ecoTempo >>> 0, 4);
  out.writeUInt32BE(ecoEsperaUs >>> 0, 8);
  return out;
}

function payloadTchau({ motivo }) {
  const out = Buffer.alloc(4);
  out[0] = motivo;
  return out;
}

// ---------------------------------------------------------------------------
// Recepcao: leitura e validacao (passo 8 da 4.5)
// ---------------------------------------------------------------------------

/** Le o cabecalho sem validar nada. `buf` tem ao menos 28 bytes. */
function lerCabecalho(buf) {
  return {
    versao: buf[2],
    tipo: buf[3],
    sessao: buf.readUInt32BE(4),
    seq: buf.readUInt32BE(8),
    tempo: buf.readUInt32BE(12),
    quadro: buf.readUInt32BE(16),
    indice: buf.readUInt16BE(20),
    total: buf.readUInt16BE(22),
    flags: buf[24],
    reservado: buf[25],
    tamanho: buf.readUInt16BE(26),
  };
}

const zeros = (p, de, ate) => {
  for (let j = de; j < ate; j++) if (p[j] !== 0) return false;
  return true;
};

function lerFec(c, p, fecN) {
  const N = fecN;
  if (!(N >= 1) || c.indice % N !== 0 || c.indice >= c.total) return null;
  if (p.length < 5 || p[1] !== 0) return null;
  const k = p[0];
  if (k !== Math.min(N, c.total - c.indice)) return null;
  const L = p.length - 4;
  if (c.indice < c.total - 1 ? L !== C.TAM_FRAGMENTO : L > C.TAM_FRAGMENTO) return null;
  return { k, xorTamanhos: p.readUInt16BE(2), xorDados: p.subarray(4) };
}

function lerNack(p) {
  if (p.length < 10 || p.length > 514 || p[1] !== 0) return null;
  const qtd = p[0];
  if (qtd < 1 || qtd > C.NACK_MAX_ENTRADAS || p.length !== 2 + 8 * qtd) return null;
  const entradas = [];
  for (let k = 0; k < qtd; k++) {
    const quadro = p.readUInt32BE(2 + 8 * k);
    const primeiro = p.readUInt16BE(6 + 8 * k);
    const quantidade = p.readUInt16BE(8 + 8 * k);
    if (quadro < 1) return null;
    if (quantidade === C.NACK_QUADRO_INTEIRO) {
      if (primeiro !== 0) return null;
    } else if (quantidade < 1 || quantidade > C.MAX_FRAGMENTOS || primeiro + quantidade > C.MAX_FRAGMENTOS) {
      return null;
    }
    entradas.push({ quadro, primeiro, quantidade });
  }
  return { entradas };
}

function lerRelatorio(p) {
  if (p.length !== 40) return null;
  const r = {};
  let off = 0;
  for (const [nome, tam] of CAMPOS_RELATORIO) {
    r[nome] = tam === 2 ? p.readUInt16BE(off) : p.readUInt32BE(off);
    off += tam;
  }
  return r;
}

/**
 * Passo 8: campos de quadro/fragmento/flags do tipo e o payload (4.3, 4.4, 5). Devolve os campos
 * do payload (VIDEO: `{}`; o fragmento fica em `payload`) ou null (descarta, conta `campo`).
 * @param {ReturnType<typeof lerCabecalho>} c
 * @param {Buffer} p payload
 * @param {number} fecN o N anunciado na sessao (5.2)
 */
function validarCampos(c, p, fecN) {
  const f = c.flags;
  if (f & 0xf0 || c.reservado !== 0) return null;
  const volta = (f & FLAG.VOLTA) !== 0;
  if (c.tipo === TIPO.VIDEO || c.tipo === TIPO.FEC) {
    if (c.quadro < 1 || c.total < 1 || c.total > C.MAX_FRAGMENTOS || c.indice >= c.total || volta) return null;
    if (c.tipo === TIPO.VIDEO) {
      if (((f & FLAG.FIM_DE_QUADRO) !== 0) !== (c.indice === c.total - 1)) return null;
      if (p.length < 1 || p.length > C.TAM_FRAGMENTO) return null;
      if (c.indice < c.total - 1 && p.length !== C.TAM_FRAGMENTO) return null;
      return {};
    }
    if (f & (FLAG.FIM_DE_QUADRO | FLAG.RETRANSMISSAO)) return null;
    return lerFec(c, p, fecN);
  }
  if (c.quadro !== 0 || c.indice !== 0 || c.total !== 0 || (f & ~FLAG.VOLTA)) return null;
  switch (c.tipo) {
    case TIPO.NACK:
      return volta ? lerNack(p) : null;
    case TIPO.PEDIR_KEYFRAME:
      if (!volta || p.length !== 8 || p[0] < 1 || p[0] > 4 || !zeros(p, 1, 4)) return null;
      return { motivo: p[0], ultimoQuadro: p.readUInt32BE(4) };
    case TIPO.RELATORIO:
      return volta ? lerRelatorio(p) : null;
    case TIPO.OLA:
      if (p.length !== 12 || p[0] > 1 || (p[0] === 1 && volta) || !zeros(p, 1, 4)) return null;
      return { estado: p[0], ecoTempo: p.readUInt32BE(4), ecoEsperaUs: p.readUInt32BE(8) };
    case TIPO.TCHAU:
      if (p.length !== 4 || p[0] < 1 || p[0] > 6 || !zeros(p, 1, 4)) return null;
      return { motivo: p[0] };
    default:
      return null;
  }
}

/**
 * Recuperacao por FEC (7): reconstroi o unico fragmento `j` que falta no grupo a partir do FEC e
 * dos outros `k - 1`. Devolve o payload ou null se o tamanho nao fecha (quem chama conta `campo`).
 * @param {{xorTamanhos:number, xorDados:Buffer}} fec
 * @param {Buffer[]} outros os fragmentos presentes do grupo
 * @param {number} j indice do faltante
 * @param {number} total n do quadro
 */
function recuperarFec(fec, outros, j, total) {
  const L = fec.xorDados.length;
  let tam = fec.xorTamanhos;
  const dados = Buffer.from(fec.xorDados);
  for (const f of outros) {
    tam ^= f.length;
    for (let x = 0; x < f.length && x < L; x++) dados[x] ^= f[x];
  }
  if (tam < 1 || tam > L || (j < total - 1 && tam !== C.TAM_FRAGMENTO)) return null;
  return dados.subarray(0, tam);
}

// ---------------------------------------------------------------------------
// Janela de replay (8.4)
// ---------------------------------------------------------------------------

const REPLAY = Object.freeze({ REJEITA: 0, DENTRO: 1, AVANCOU: 2 });

class JanelaReplay {
  constructor() {
    this.maior = 0;
    this.bits = new Uint32Array(C.JANELA_REPLAY / 32);
  }

  _bit(seq) {
    const pos = seq % C.JANELA_REPLAY;
    return [pos >>> 5, 1 << (pos & 31)];
  }

  /**
   * Aceita e marca, ou rejeita. AVANCOU = `seq > maior` (o que ensina o endereco de volta, 9.2).
   * `seq` 0 nunca chega aqui (o Verificador conta `campo` antes).
   */
  aceitar(seq) {
    if (seq > this.maior) {
      if (seq - this.maior >= C.JANELA_REPLAY) {
        this.bits.fill(0);
      } else {
        for (let s = this.maior + 1; s < seq; s++) {
          const [w, m] = this._bit(s);
          this.bits[w] &= ~m;
        }
      }
      const [w, m] = this._bit(seq);
      this.bits[w] |= m;
      this.maior = seq;
      return REPLAY.AVANCOU;
    }
    if (this.maior - seq >= C.JANELA_REPLAY) return REPLAY.REJEITA;
    const [w, m] = this._bit(seq);
    if (this.bits[w] & m) return REPLAY.REJEITA;
    this.bits[w] |= m;
    return REPLAY.DENTRO;
  }
}

// ---------------------------------------------------------------------------
// Verificador (4.5)
// ---------------------------------------------------------------------------

function novosContadores() {
  return Object.fromEntries(C.MOTIVOS_DESCARTE.map((m) => [m, 0]));
}

const INTERVALO_LOG_VERSAO_MS = 60000;

/**
 * Tabela de sessoes de um PC (todas as do socket da sala, nos dois papeis) e a verificacao de cada
 * datagrama na ordem da 4.5. Cada sessao tem uma janela de replay so: o sentido que este PC recebe.
 */
class Verificador {
  /**
   * @param {{agora?: () => number, log?: ((linha: string) => void) | null}} [op]
   *   agora em ms (injetavel para teste); log recebe no maximo uma linha de versao a cada 60 s.
   */
  constructor({ agora = () => performance.now(), log = null } = {}) {
    this.agora = agora;
    this.log = log;
    this.contadores = novosContadores();
    this.sessoes = new Map();
    this._ultimoLogVersao = -Infinity;
  }

  /**
   * @param {number} sessao 1 - 2^32-1
   * @param {{chave:Buffer, papel:'receptor'|'emissor', fecN?:number}} op
   *   papel: receptor so aceita VOLTA = 0; emissor so aceita VOLTA = 1 (4.4).
   */
  adicionarSessao(sessao, { chave, papel, fecN = C.FEC_N_PADRAO }) {
    if (!u32(sessao) || sessao === 0) throw new RangeError(`sessao invalida: ${sessao}`);
    if (!Buffer.isBuffer(chave) || chave.length !== C.TAM_CHAVE) throw new RangeError('chave de 32 bytes');
    if (papel !== 'receptor' && papel !== 'emissor') throw new RangeError(`papel invalido: ${papel}`);
    if (!Number.isInteger(fecN) || fecN < 0 || fecN > C.FEC_N_MAX) throw new RangeError(`fecN invalido: ${fecN}`);
    if (this.sessoes.has(sessao)) throw new Error(`sessao ${sessao} ja existe`);
    this.sessoes.set(sessao, { chave: Buffer.from(chave), papel, fecN, replay: new JanelaReplay() });
  }

  temSessao(sessao) {
    return this.sessoes.has(sessao);
  }

  /** Apaga a sessao e zera a copia da chave (8.2: apagada quando a sessao termina). */
  removerSessao(sessao) {
    const s = this.sessoes.get(sessao);
    if (!s) return false;
    s.chave.fill(0);
    this.sessoes.delete(sessao);
    return true;
  }

  _descarta(motivo) {
    this.contadores[motivo]++;
    return { ok: false, motivo };
  }

  /**
   * @param {Buffer} buf o datagrama como chegou
   * @param {string} [endereco] so para a linha de log de versao
   * @returns {{ok:false, motivo:string} | {ok:true, sessao:number, avancou:boolean, pacote:object}}
   *   `pacote`: campos do cabecalho, `payload` (subarray de `buf`) e `campos` do tipo.
   */
  verificar(buf, endereco) {
    const len = buf.length;
    // 1. Tamanho do datagrama.
    if (len < C.TAM_MIN_DATAGRAMA || len > C.TAM_MAX_DATAGRAMA) return this._descarta('tamanho');
    // 2. Magia, versao, tipo.
    if (buf.readUInt16BE(0) !== C.MAGIA) return this._descarta('magia');
    if (buf[2] !== C.VERSAO_PROTOCOLO) {
      const agora = this.agora();
      if (this.log && agora - this._ultimoLogVersao >= INTERVALO_LOG_VERSAO_MS) {
        this._ultimoLogVersao = agora;
        this.log(`[videonativo] versao ${buf[2]} no fio (esperada ${C.VERSAO_PROTOCOLO}) de ${endereco || '?'}`);
      }
      return this._descarta('versao');
    }
    if (buf[3] < TIPO.VIDEO || buf[3] > TIPO.TCHAU) return this._descarta('tipo');
    // 3. Campo tamanho contra o datagrama.
    if (buf.readUInt16BE(26) !== len - C.TAM_MIN_DATAGRAMA) return this._descarta('tamanho');
    // 4. Sessao na tabela local.
    const s = this.sessoes.get(buf.readUInt32BE(4));
    if (!s) return this._descarta('sessao');
    // 5. HMAC, em tempo constante.
    const fim = len - C.TAM_HMAC;
    if (!crypto.timingSafeEqual(hmac16(s.chave, buf.subarray(0, fim)), buf.subarray(fim))) {
      return this._descarta('hmac');
    }
    // 6. VOLTA contra o papel local.
    const volta = (buf[24] & FLAG.VOLTA) !== 0;
    if (volta !== (s.papel === 'emissor')) return this._descarta('direcao');
    // 7. Sequencia 0 (campo) e janela de replay; so aqui a janela avanca.
    const c = lerCabecalho(buf);
    if (c.seq === 0) return this._descarta('campo');
    const r = s.replay.aceitar(c.seq);
    if (r === REPLAY.REJEITA) return this._descarta('replay');
    // 8. Campos do tipo e payload.
    const payload = buf.subarray(C.TAM_CABECALHO, fim);
    const campos = validarCampos(c, payload, s.fecN);
    if (!campos) return this._descarta('campo');
    return { ok: true, sessao: c.sessao, avancou: r === REPLAY.AVANCOU, pacote: { ...c, payload, campos } };
  }
}

module.exports = {
  montarDatagrama, fragmentarQuadro, payloadFec, payloadNack, payloadPedirKeyframe, payloadRelatorio,
  payloadOla, payloadTchau, lerCabecalho, validarCampos, recuperarFec, JanelaReplay, REPLAY, Verificador,
  novosContadores,
};

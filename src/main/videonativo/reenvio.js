/*
 * Buffer de reenvio do emissor do video nativo (P2.3).
 * Contrato: docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, secao 5.3 (o que o emissor
 * faz com um NACK) e secao 2 (BUFFER_REENVIO_MS).
 *
 * O emissor de verdade e o golive-media.exe (C++, ainda a portar). Esta e a implementacao de
 * referencia em JS: serve a simulacao de perda (simulacao.test.js), ao relay da Fase 3 (que reenvia
 * o que recebeu) e como especificacao executavel para o porte em C++.
 *
 *   - `guardar(p)`: cada VIDEO mandado (como sai de `fragmentarQuadro`), por (quadro, indice), por
 *     BUFFER_REENVIO_MS; FEC nao entra (5.2: FEC nao e pedido nem reenviado).
 *   - `atender(entradas, bitrateBps)`: devolve os pacotes a reenviar, com a flag RETRANSMISSAO.
 *     Quem chama monta o datagrama com sequencia nova e manda sempre para o endereco da sessao.
 *
 * Tetos por sessao (5.3), para um receptor com defeito nao virar amplificador de banda:
 *   - no maximo NACK_MAX_POR_S (250) NACKs processados em qualquer janela de 1 s (excesso: `nack_excesso`);
 *   - cada (quadro, indice) reenviado uma vez so (`repetidos`);
 *   - bytes reenviados em 1 s <= 25 % do bitrate alvo (`pulados_banda`).
 * O que foi pedido e nao esta mais no buffer e ignorado em silencio (`ausentes`).
 * Puro Node, sem Electron.
 */

'use strict';

const C = require('./constantes');

const { FLAG } = C;

const NACK_MAX_POR_S = 250;
const FRACAO_BANDA_REENVIO = 0.25;
const JANELA_TETO_MS = 1000;

function novosContadoresReenvio() {
  return { nacks: 0, nack_excesso: 0, reenviados: 0, bytes_reenviados: 0, ausentes: 0, repetidos: 0,
    pulados_banda: 0 };
}

class BufferReenvio {
  /** @param {{agora?:() => number, janelaMs?:number}} [op] */
  constructor({ agora = () => performance.now(), janelaMs = C.BUFFER_REENVIO_MS } = {}) {
    this.agora = agora;
    this.janelaMs = janelaMs;
    this.quadros = new Map(); // quadro -> {em, frags: Array(n) de {p, reenviado}}; ordem de insercao = de envio
    this._nackEm = []; // instantes dos NACKs processados no ultimo 1 s
    this._bytes = []; // {em, bytes} reenviados no ultimo 1 s
    this._somaBytes = 0;
    this.contadores = novosContadoresReenvio();
  }

  /** @param {{tipo:number, quadro:number, indice:number, total:number, flags:number, payload:Buffer}} p */
  guardar(p) {
    if (p.tipo !== C.TIPO.VIDEO) return;
    const agora = this.agora();
    this._expirar(agora);
    let q = this.quadros.get(p.quadro);
    if (!q) {
      q = { em: agora, frags: new Array(p.total).fill(null) };
      this.quadros.set(p.quadro, q);
    }
    if (p.indice < q.frags.length) q.frags[p.indice] = { p, reenviado: false };
  }

  /**
   * @param {{quadro:number, primeiro:number, quantidade:number}[]} entradas de um NACK ja validado
   * @param {number} bitrateBps bitrate alvo atual (no relay: a taxa de ida recebida no ultimo 1 s)
   * @returns {object[]} pacotes a reenviar, na ordem pedida, com FLAG.RETRANSMISSAO
   */
  atender(entradas, bitrateBps) {
    const agora = this.agora();
    this._expirar(agora);
    while (this._nackEm.length && agora - this._nackEm[0] >= JANELA_TETO_MS) this._nackEm.shift();
    while (this._bytes.length && agora - this._bytes[0].em >= JANELA_TETO_MS) this._somaBytes -= this._bytes.shift().bytes;
    if (this._nackEm.length >= NACK_MAX_POR_S) {
      this.contadores.nack_excesso++;
      return [];
    }
    this._nackEm.push(agora);
    this.contadores.nacks++;
    const teto = (FRACAO_BANDA_REENVIO * bitrateBps) / 8;
    const out = [];
    for (const ent of entradas) {
      const q = this.quadros.get(ent.quadro);
      if (!q) {
        this.contadores.ausentes += ent.quantidade === C.NACK_QUADRO_INTEIRO ? 1 : ent.quantidade;
        continue;
      }
      const ini = ent.quantidade === C.NACK_QUADRO_INTEIRO ? 0 : ent.primeiro;
      const fim = ent.quantidade === C.NACK_QUADRO_INTEIRO ? q.frags.length : ent.primeiro + ent.quantidade;
      for (let i = ini; i < fim; i++) {
        const f = i < q.frags.length ? q.frags[i] : null;
        if (!f) {
          this.contadores.ausentes++;
          continue;
        }
        if (f.reenviado) {
          this.contadores.repetidos++;
          continue;
        }
        const bytes = f.p.payload.length + C.TAM_MIN_DATAGRAMA;
        if (this._somaBytes + bytes > teto) {
          this.contadores.pulados_banda++;
          continue;
        }
        f.reenviado = true;
        this._somaBytes += bytes;
        this._bytes.push({ em: agora, bytes });
        this.contadores.reenviados++;
        this.contadores.bytes_reenviados += bytes;
        out.push({ ...f.p, flags: f.p.flags | FLAG.RETRANSMISSAO });
      }
    }
    return out;
  }

  _expirar(agora) {
    for (const [quadro, q] of this.quadros) {
      if (agora - q.em < this.janelaMs) break;
      this.quadros.delete(quadro);
    }
  }
}

module.exports = { BufferReenvio, novosContadoresReenvio, NACK_MAX_POR_S, FRACAO_BANDA_REENVIO };

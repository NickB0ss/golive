/*
 * Controle de taxa do video nativo (P2.4).
 * Contrato: docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, secao 5.5 (RELATORIO) e
 * secao 11 (o que o relatorio da ao controle de taxa). Regra do plano (P2.4): perda > 5 % ou atraso
 * subindo -> -20 %; folga por 5 s -> +10 % ate o teto.
 *
 *   - `MedidorRelatorio` (quem assiste): recebe cada pacote de ida aceito (`aoPacote`) e, a cada
 *     INTERVALO_RELATORIO_MS, `gerar(contadoresDoRemontador)` devolve os campos do RELATORIO
 *     (os nomes de `payloadRelatorio`).
 *   - `ControleTaxa` (quem transmite): recebe os RELATORIOs ja verificados e devolve o novo alvo em
 *     kbps quando ele muda; o main repassa ao exe com `{"cmd":"kbps","valor":N}`.
 *
 * Relogios injetaveis em ms (`agora`), convertidos para us mod 2^32 onde o fio pede.
 * Puro Node, sem Electron.
 */

'use strict';

const C = require('./constantes');

const JANELA_D_MIN_MS = 10000; // 5.5: menor d dos ultimos 10 s
const RELATORIO_MIN_MS = 100; // 5.5: o emissor processa no maximo 1 por 100 ms

// Regra (plano P2.4 e sugestao da secao 11).
const PERDA_CORTE = 0.05;
const RELATORIOS_PERDA = 5; // perda medida na soma dos ultimos 5 (1 s)
const SUBIDAS_ATRASO = 3; // atraso medio crescendo em 3 relatorios seguidos...
const ATRASO_ALTO_US = 10000; // ...e o ultimo acima de 10 ms
const FATOR_CORTE = 0.8;
const FATOR_RECEBIDO = 0.85; // no corte, o alvo tambem fica abaixo do que de fato chegou (o GCC do WebRTC faz igual)
const FATOR_SUBIDA = 1.1;
const FOLGA_MS = 5000;
const ESPERA_POS_CORTE_MS = 1000; // um corte so mostra efeito na janela de perda seguinte
const PERDA_FOLGA = 0.01;
const KBPS_PISO_PADRAO = 1500;

const us32 = (ms) => Math.floor(ms * 1000) >>> 0;

class MedidorRelatorio {
  /** @param {{agora?:() => number}} [op] */
  constructor({ agora = () => performance.now() } = {}) {
    this.agora = agora;
    this._inicio = agora();
    this._primeiroSeq = null;
    this._maiorSeq = 0;
    this._maiorSeqAnterior = null;
    this._recebidos = 0;
    this._bytes = 0;
    this._somaAtraso = 0;
    this._maxAtraso = 0;
    this._ultimoTempo = 0;
    this._ultimoEm = null;
    this._dMin = []; // fila monotona {em, d} para o minimo deslizante de 10 s
    this._contAnterior = null;
  }

  /** Um pacote de ida aceito (passo 7 da 4.5). @param {{seq:number, tempo:number, bytes:number}} p */
  aoPacote({ seq, tempo, bytes }) {
    const agora = this.agora();
    if (this._primeiroSeq === null) this._primeiroSeq = seq;
    if (seq > this._maiorSeq) this._maiorSeq = seq;
    this._recebidos++;
    this._bytes += bytes;
    // 5.5: d = (relogio local - tempo de envio) mod 2^32; atraso relativo = (d - d_min) | 0.
    const d = (us32(agora) - tempo) >>> 0;
    while (this._dMin.length && ((d - this._dMin[this._dMin.length - 1].d) | 0) <= 0) this._dMin.pop();
    this._dMin.push({ em: agora, d });
    while (agora - this._dMin[0].em > JANELA_D_MIN_MS) this._dMin.shift();
    const atraso = Math.max(0, (d - this._dMin[0].d) | 0);
    this._somaAtraso += atraso;
    if (atraso > this._maxAtraso) this._maxAtraso = atraso;
    this._ultimoTempo = tempo;
    this._ultimoEm = agora;
  }

  /**
   * Fecha o periodo e devolve os campos do RELATORIO.
   * @param {{quadros_completos?:number, quadros_vencidos?:number, recuperados_fec?:number,
   *   pedidos_nack?:number}} [cont] contadores acumulados do Remontador (vira delta do periodo)
   */
  gerar(cont = {}) {
    const agora = this.agora();
    const intervaloUs = Math.max(1, Math.round((agora - this._inicio) * 1000));
    let esperados = 0;
    if (this._primeiroSeq !== null) {
      esperados = this._maiorSeqAnterior === null
        ? this._maiorSeq - this._primeiroSeq + 1
        : this._maiorSeq - this._maiorSeqAnterior;
      this._maiorSeqAnterior = this._maiorSeq;
    }
    const ant = this._contAnterior || {};
    const delta = (k) => Math.max(0, (cont[k] || 0) - (ant[k] || 0));
    const r = {
      intervaloUs,
      esperados,
      recebidos: this._recebidos,
      kbps: Math.floor((this._bytes * 8 * 1000) / intervaloUs),
      atrasoMedioUs: this._recebidos ? Math.round(this._somaAtraso / this._recebidos) : 0,
      atrasoMaxUs: this._maxAtraso,
      maiorSeq: this._maiorSeq,
      ecoTempo: this._ultimoTempo,
      ecoEsperaUs: this._ultimoEm === null ? 0 : Math.round((agora - this._ultimoEm) * 1000),
      quadrosCompletos: delta('quadros_completos'),
      quadrosVencidos: delta('quadros_vencidos'),
      recuperadosFec: delta('recuperados_fec'),
      nacks: delta('pedidos_nack'),
    };
    this._contAnterior = { ...cont };
    this._inicio = agora;
    this._recebidos = 0;
    this._bytes = 0;
    this._somaAtraso = 0;
    this._maxAtraso = 0;
    return r;
  }
}

class ControleTaxa {
  /**
   * @param {{kbps:number, teto:number, piso?:number, agora?:() => number,
   *   log?:(linha:string) => void}} op
   */
  constructor({ kbps, teto, piso = KBPS_PISO_PADRAO, agora = () => performance.now(), log = null }) {
    this.agora = agora;
    this.log = log;
    this.teto = teto;
    this.piso = Math.min(piso, teto);
    this.kbps = Math.min(Math.max(kbps, this.piso), teto);
    this.historico = []; // ultimos relatorios processados
    this.rttUs = null;
    this.perda = 0;
    this.contadores = { relatorios: 0, relatorio_excesso: 0, cortes: 0, subidas: 0 };
    const t = agora();
    this._ultimoEm = -Infinity;
    this._corteEm = -Infinity;
    this._folgaDesde = t;
  }

  /** Teto novo (qualidade escolhida ou escada de resolucao). Devolve o alvo novo se mudou. */
  definirTeto(teto) {
    this.teto = teto;
    this.piso = Math.min(this.piso, teto);
    return this._mudar(Math.min(this.kbps, teto), 'teto');
  }

  /**
   * Um RELATORIO verificado (campos de `lerRelatorio`). Devolve o novo alvo em kbps, ou null se
   * nao mudou (ou se o relatorio veio cedo demais e foi descartado).
   */
  relatorio(r) {
    const agora = this.agora();
    if (agora - this._ultimoEm < RELATORIO_MIN_MS) {
      this.contadores.relatorio_excesso++;
      return null;
    }
    this._ultimoEm = agora;
    this.contadores.relatorios++;
    this.rttUs = (us32(agora) - r.ecoTempo - r.ecoEsperaUs) | 0;
    this.historico.push(r);
    if (this.historico.length > RELATORIOS_PERDA) this.historico.shift();

    let esperados = 0;
    let recebidos = 0;
    for (const h of this.historico) {
      esperados += h.esperados;
      recebidos += h.recebidos;
    }
    this.perda = esperados > 0 ? Math.min(1, Math.max(0, 1 - recebidos / esperados)) : 0;
    const perdaPeriodo = r.esperados > 0 ? Math.min(1, Math.max(0, 1 - r.recebidos / r.esperados)) : 0;

    const ult = this.historico.slice(-(SUBIDAS_ATRASO + 1));
    let subindo = ult.length === SUBIDAS_ATRASO + 1 && r.atrasoMedioUs > ATRASO_ALTO_US;
    for (let i = 1; subindo && i < ult.length; i++) if (ult[i].atrasoMedioUs <= ult[i - 1].atrasoMedioUs) subindo = false;

    const congestao = this.perda > PERDA_CORTE || subindo;
    if (congestao || perdaPeriodo > PERDA_FOLGA || r.atrasoMedioUs > ATRASO_ALTO_US) this._folgaDesde = agora;

    if (congestao && agora - this._corteEm >= ESPERA_POS_CORTE_MS && this.kbps > this.piso) {
      this._corteEm = agora;
      this.contadores.cortes++;
      const motivo = subindo ? 'atraso' : `perda ${(100 * this.perda).toFixed(1)}%`;
      // Queda grande de banda: -20 % por segundo demoraria; o kbps recebido diz quanto passa.
      const novo = Math.min(this.kbps * FATOR_CORTE, r.kbps > 0 ? r.kbps * FATOR_RECEBIDO : Infinity);
      return this._mudar(Math.max(this.piso, Math.round(novo)), motivo);
    }
    if (!congestao && agora - this._folgaDesde >= FOLGA_MS && this.kbps < this.teto) {
      this._folgaDesde = agora;
      this.contadores.subidas++;
      return this._mudar(Math.min(this.teto, Math.round(this.kbps * FATOR_SUBIDA)), 'folga');
    }
    return null;
  }

  _mudar(kbps, motivo) {
    if (kbps === this.kbps) return null;
    if (this.log) this.log(`[nativo] taxa ${this.kbps} -> ${kbps} kbps (${motivo})`);
    this.kbps = kbps;
    return kbps;
  }
}

module.exports = {
  MedidorRelatorio, ControleTaxa, KBPS_PISO_PADRAO, PERDA_CORTE, FOLGA_MS, ATRASO_ALTO_US,
  INTERVALO_RELATORIO_MS: C.INTERVALO_RELATORIO_MS,
};

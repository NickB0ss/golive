/*
 * Remontagem de quadros no receptor do video nativo.
 * Contrato: docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, secao 6 (regras 6.3, 6.4 e
 * 6.6 como ficaram na Revisao) e 9.3 (troca de sessao).
 *
 *   - `Remontador`: o estado de UMA sessao (6.3): U, modo e ate 8 quadros em montagem. Recebe os
 *     VIDEO/FEC ja aceitos pelo Verificador (pacote.js) e entrega quadros inteiros, em ordem.
 *   - `ReceptorVideo`: a tabela de sessoes de ida de um PC, com o Verificador na frente, uma sessao
 *     por (origem, kind) e a substituicao da 9.3.
 *
 * O relogio e injetavel (ms). Nada aqui tem timer proprio: quem usa chama `tick()` (o P2.3 vai
 * chamar a cada ESPERA_NACK_MS); `receber()` tambem confere os vencimentos antes de cada pacote.
 *
 * Ganchos para o P2.3 (NACK, FEC, PEDIR_KEYFRAME de verdade):
 *   - `entradas()` lista o que esta em montagem com os faltantes, `criadoEm`, `ultimoEm`, `maiorIndice`
 *     e `maiorQuadroVisto` (6.5: "suspeito"); o campo `pedidos` de cada entrada e reservado para
 *     marcar o que ja foi pedido por NACK;
 *   - `recuperarFec(quadro, inicio)` aplica a recuperacao da secao 7 quando o P2.3 decidir (6.5, passo 1);
 *   - `aoPedirKeyframe({motivo, ultimoQuadro})` ja sai aqui, no maximo 1 a cada 500 ms (5.4), repetindo
 *     enquanto o modo for ESPERANDO_KEYFRAME sem keyframe em montagem; `pedirKeyframe(motivo)` e a
 *     entrada do decoder (P2.5, motivos 2 e 4).
 * Puro Node, sem Electron.
 */

'use strict';

const C = require('./constantes');
const { Verificador, recuperarFec } = require('./pacote');

const { TIPO, FLAG, MODO, MOTIVO_KEYFRAME } = C;

function novosContadoresRemontagem() {
  return {
    atrasados: 0, // regra 1
    sem_referencia: 0, // regra 2
    duplicados: 0, // regra 4
    campo: 0, // regra 3 e recuperacao por FEC que nao fecha
    quadros_completos: 0, // entregues ao decoder
    quadros_vencidos: 0, // 6.6
    quadros_descartados: 0, // jogados fora sem vencer: atras de um keyframe, deltas de um vencido, lacuna
    lacunas: 0, // regra 7 com lacuna > MAX_QUADROS_EM_MONTAGEM
    recuperados_fec: 0,
  };
}

class Remontador {
  /**
   * @param {{fecN?:number, agora?:() => number,
   *   aoQuadro?:(q:{quadro:number, keyframe:boolean, dados:Buffer}) => void,
   *   aoPedirKeyframe?:(p:{motivo:number, ultimoQuadro:number}) => void}} [op]
   */
  constructor({ fecN = C.FEC_N_PADRAO, agora = () => performance.now(), aoQuadro = () => {},
    aoPedirKeyframe = () => {} } = {}) {
    this.fecN = fecN;
    this.agora = agora;
    this.aoQuadro = aoQuadro;
    this.aoPedirKeyframe = aoPedirKeyframe;
    this.modo = MODO.ESPERANDO_KEYFRAME;
    this.U = null; // ultimo quadro entregue
    this.montagem = new Map(); // quadro -> entrada
    this.maiorQuadroVisto = 0;
    this.contadores = novosContadoresRemontagem();
    this._pedido = null; // motivo do PEDIR_KEYFRAME pendente
    this._ultimoPedidoEm = -Infinity;
  }

  /** Um VIDEO ou FEC aceito pelo Verificador (`resultado.pacote`). */
  receber(p) {
    const agora = this.agora();
    this._vencer(agora);
    if (p.quadro > this.maiorQuadroVisto) this.maiorQuadroVisto = p.quadro;
    this._receber(p, agora);
    this._talvezPedir(agora);
  }

  /** Vencimentos (6.6) e repeticao do PEDIR_KEYFRAME (5.4). */
  tick() {
    const agora = this.agora();
    this._vencer(agora);
    this._talvezPedir(agora);
  }

  /** Entrada do decoder (P2.5): sem referencia, pede keyframe (respeitando os 500 ms). */
  pedirKeyframe(motivo) {
    this.modo = MODO.ESPERANDO_KEYFRAME;
    this._marcarPedido(motivo);
    this._talvezPedir(this.agora());
  }

  /**
   * Recupera por FEC o unico faltante do grupo `[inicio, inicio + N)` do quadro (secao 7).
   * Devolve o indice recuperado, ou -1 (sem FEC, nada faltando, mais de um faltando, ou tamanho que
   * nao fecha, que conta `campo`).
   */
  recuperarFec(quadro, inicio) {
    const e = this.montagem.get(quadro);
    if (!e || e.n === null || e.completo) return -1;
    const fec = e.fec.get(inicio);
    if (!fec) return -1;
    const fim = Math.min(inicio + fec.k, e.n);
    let j = -1;
    const outros = [];
    for (let i = inicio; i < fim; i++) {
      if (e.tamanhos[i] === 0) {
        if (j !== -1) return -1;
        j = i;
      } else {
        outros.push(this._fragmento(e, i));
      }
    }
    if (j === -1) return -1;
    const dados = recuperarFec(fec, outros, j, e.n);
    if (!dados) {
      this.contadores.campo++;
      return -1;
    }
    this.contadores.recuperados_fec++;
    this._colocar(e, j, dados);
    return j;
  }

  /** Retrato do que esta em montagem, para o P2.3 (NACK) e para diagnostico. */
  entradas() {
    return [...this.montagem.values()].sort((a, b) => a.quadro - b.quadro).map((e) => ({
      quadro: e.quadro,
      n: e.n,
      keyframe: e.keyframe,
      completo: e.completo,
      criadoEm: e.criadoEm,
      ultimoEm: e.ultimoEm,
      maiorIndice: e.maiorIndice,
      faltantes: e.n === null ? null : faltantes(e),
      gruposComFec: [...e.fec.keys()],
    }));
  }

  // --- interno ---

  _fragmento(e, i) {
    const ini = i * C.TAM_FRAGMENTO;
    return e.buf.subarray(ini, ini + e.tamanhos[i]);
  }

  _maiorKeyframeAbaixo(q) {
    let k = null;
    for (const e of this.montagem.values()) {
      if (e.keyframe === true && e.quadro < q && (k === null || e.quadro > k)) k = e.quadro;
    }
    return k;
  }

  _temKeyframeAcima(q) {
    for (const e of this.montagem.values()) if (e.keyframe === true && e.quadro > q) return true;
    return false;
  }

  _descartarAbaixo(q) {
    for (const e of [...this.montagem.values()]) {
      if (e.quadro < q) {
        this.montagem.delete(e.quadro);
        this.contadores.quadros_descartados++;
      }
    }
  }

  /** Cria a entrada; com 8 em montagem, vence a de menor numero e devolve null (refazer a decisao). */
  _criar(q, agora) {
    if (this.montagem.size >= C.MAX_QUADROS_EM_MONTAGEM) {
      let velho = null;
      for (const e of this.montagem.values()) if (velho === null || e.quadro < velho.quadro) velho = e;
      this._vencerQuadro(velho);
      return null;
    }
    const e = {
      quadro: q, n: null, keyframe: null, buf: null, tamanhos: null, recebidos: 0, completo: false,
      fec: new Map(), criadoEm: agora, ultimoEm: agora, maiorIndice: -1,
      pedidos: null, // P2.3: fragmentos ja pedidos por NACK (6.5: cada um uma vez so)
    };
    this.montagem.set(q, e);
    return e;
  }

  _receber(p, agora) {
    const q = p.quadro;
    const kf = (p.flags & FLAG.KEYFRAME) !== 0;
    // O laco so repete quando a regra 6 venceu um quadro no meio do caminho: o modo pode ter mudado.
    for (;;) {
      // Regra 1: atrasado.
      if (this.U !== null && q <= this.U) {
        this.contadores.atrasados++;
        return;
      }
      let e = this.montagem.get(q);
      // Regra 2 e a referencia da regra 7 (U em NORMAL; o keyframe em montagem para um delta em
      // ESPERANDO_KEYFRAME; nenhuma para keyframe em ESPERANDO_KEYFRAME).
      let base = this.U;
      if (this.modo === MODO.ESPERANDO_KEYFRAME) {
        if (kf) {
          base = null;
        } else {
          base = this._maiorKeyframeAbaixo(q);
          if (base === null) {
            this.contadores.sem_referencia++;
            this._marcarPedido(MOTIVO_KEYFRAME.SEM_REFERENCIA);
            return;
          }
        }
      }
      // Regra 7: lacuna entre a referencia e q.
      if (!e && base !== null && q > base + 1) {
        const faltam = [];
        for (let m = base + 1; m < q; m++) if (!this.montagem.has(m)) faltam.push(m);
        if (faltam.length > 0 && q - base - 1 > C.MAX_QUADROS_EM_MONTAGEM) {
          this.contadores.lacunas++;
          this._descartarAbaixo(q);
          this.modo = MODO.ESPERANDO_KEYFRAME;
          if (!kf) {
            this._marcarPedido(MOTIVO_KEYFRAME.VENCIDO);
            return;
          }
        } else {
          let refazer = false;
          for (const m of faltam) {
            if (!this._criar(m, agora)) {
              refazer = true;
              break;
            }
          }
          if (refazer) continue;
        }
      }
      // Regra 6 (dentro de _criar).
      if (!e) {
        e = this._criar(q, agora);
        if (!e) continue;
      }
      // Regra 3: o primeiro pacote fixa n e KEYFRAME.
      if (e.n === null) {
        e.n = p.total;
        e.keyframe = kf;
        e.buf = Buffer.alloc(e.n * C.TAM_FRAGMENTO);
        e.tamanhos = new Uint16Array(e.n);
      } else if (e.n !== p.total || e.keyframe !== kf) {
        this.contadores.campo++;
        return;
      }
      e.ultimoEm = agora;
      if (p.tipo === TIPO.FEC) {
        // Regra 4 (FEC repetido do grupo).
        if (e.fec.has(p.indice)) {
          this.contadores.duplicados++;
          return;
        }
        const f = p.campos;
        e.fec.set(p.indice, { k: f.k, xorTamanhos: f.xorTamanhos, xorDados: Buffer.from(f.xorDados) });
        return;
      }
      // Regra 4 (fragmento repetido) e 5 (fora de ordem vai para i x 1152).
      if (e.tamanhos[p.indice] !== 0) {
        this.contadores.duplicados++;
        return;
      }
      if (p.indice > e.maiorIndice) e.maiorIndice = p.indice;
      this._colocar(e, p.indice, p.payload);
      return;
    }
  }

  _colocar(e, i, dados) {
    dados.copy(e.buf, i * C.TAM_FRAGMENTO);
    e.tamanhos[i] = dados.length;
    e.recebidos++;
    if (e.recebidos === e.n) {
      e.completo = true;
      this._completou(e);
    }
  }

  // 6.4: entrega.
  _completou(e) {
    if (e.keyframe) {
      this._descartarAbaixo(e.quadro);
      this._entregar(e);
      this.modo = MODO.NORMAL;
      this._pedido = null;
      this._cascata();
    } else if (this.modo === MODO.NORMAL && e.quadro === this.U + 1) {
      this._entregar(e);
      this._cascata();
    }
  }

  _cascata() {
    for (let e = this.montagem.get(this.U + 1); e && e.completo; e = this.montagem.get(this.U + 1)) this._entregar(e);
  }

  _entregar(e) {
    this.montagem.delete(e.quadro);
    this.U = e.quadro;
    this.contadores.quadros_completos++;
    const tam = (e.n - 1) * C.TAM_FRAGMENTO + e.tamanhos[e.n - 1];
    // Buffer proprio (Buffer.alloc nao usa o pool), pronto para virar ArrayBuffer transferido no P2.5.
    this.aoQuadro({ quadro: e.quadro, keyframe: e.keyframe, dados: e.buf.subarray(0, tam) });
  }

  // 6.6: vencimento por tempo, do menor numero para o maior.
  _vencer(agora) {
    if (this.montagem.size === 0) return;
    const lista = [...this.montagem.values()].sort((a, b) => a.quadro - b.quadro);
    for (const e of lista) {
      if (!e.completo && this.montagem.get(e.quadro) === e && agora - e.criadoEm >= C.VENCIMENTO_QUADRO_MS) {
        this._vencerQuadro(e);
      }
    }
  }

  _vencerQuadro(e) {
    const q = e.quadro;
    this.montagem.delete(q);
    this.contadores.quadros_vencidos++;
    // Deltas posteriores dependem dele; entrada vazia (tipo desconhecido) conta como delta.
    for (const x of [...this.montagem.values()]) {
      if (x.quadro > q && x.keyframe !== true) {
        this.montagem.delete(x.quadro);
        this.contadores.quadros_descartados++;
      }
    }
    this.modo = MODO.ESPERANDO_KEYFRAME;
    if (!this._temKeyframeAcima(q)) this._marcarPedido(MOTIVO_KEYFRAME.VENCIDO);
  }

  _marcarPedido(motivo) {
    if (this._pedido === null) this._pedido = motivo;
  }

  // 5.4: no maximo 1 a cada 500 ms; repete enquanto espera e nenhum keyframe esta a caminho.
  _talvezPedir(agora) {
    if (this._pedido === null || this.modo !== MODO.ESPERANDO_KEYFRAME) return;
    if (this._temKeyframeAcima(this.U === null ? 0 : this.U)) return;
    if (agora - this._ultimoPedidoEm < C.INTERVALO_MIN_KEYFRAME_MS) return;
    this._ultimoPedidoEm = agora;
    this.aoPedirKeyframe({ motivo: this._pedido, ultimoQuadro: this.U === null ? 0 : this.U });
  }
}

function faltantes(e) {
  const out = [];
  for (let i = 0; i < e.n; i++) if (e.tamanhos[i] === 0) out.push(i);
  return out;
}

/**
 * As sessoes de ida de um PC (o main de quem assiste), com o Verificador na frente.
 * Uma sessao por (origem, kind) (9.3): abrir outra para o mesmo par apaga a anterior na hora, e quem
 * chamou manda TCHAU motivo 6 e `nativo-fim` 'substituida' ao emissor dela.
 */
class ReceptorVideo {
  /**
   * @param {{agora?:() => number, log?:(l:string) => void,
   *   aoQuadro?:(sessao:number, q:object) => void,
   *   aoPedirKeyframe?:(sessao:number, p:{motivo:number, ultimoQuadro:number}) => void,
   *   aoOla?:(sessao:number, ola:object) => void,
   *   aoFim?:(sessao:number, motivo:number) => void}} [op]
   */
  constructor({ agora = () => performance.now(), log = null, aoQuadro = () => {}, aoPedirKeyframe = () => {},
    aoOla = () => {}, aoFim = () => {} } = {}) {
    this.agora = agora;
    this.verificador = new Verificador({ agora, log });
    this.sessoes = new Map();
    this.cb = { aoQuadro, aoPedirKeyframe, aoOla, aoFim };
  }

  /**
   * @param {{sessao:number, chave:Buffer, fecN?:number, origem:string, kind?:string}} op
   * @returns {{aceita:true, substituida:number|null} | {aceita:false, motivo:'sessao'}}
   */
  abrirSessao({ sessao, chave, fecN = C.FEC_N_PADRAO, origem, kind = 'screen' }) {
    // 9.3: sessao que ja existe na tabela, em qualquer papel, e recusada.
    if (this.verificador.temSessao(sessao)) return { aceita: false, motivo: 'sessao' };
    let substituida = null;
    for (const s of this.sessoes.values()) {
      if (s.origem === origem && s.kind === kind) substituida = s.sessao;
    }
    // Primeiro a nova (valida chave e fecN e pode lancar), depois apaga a velha.
    this.verificador.adicionarSessao(sessao, { chave, papel: 'receptor', fecN });
    if (substituida !== null) this.fecharSessao(substituida);
    const remontador = new Remontador({
      fecN,
      agora: this.agora,
      aoQuadro: (q) => this.cb.aoQuadro(sessao, q),
      aoPedirKeyframe: (p) => this.cb.aoPedirKeyframe(sessao, p),
    });
    this.sessoes.set(sessao, {
      sessao, origem, kind, remontador,
      endereco: null, // 9.2: so de pacote que avancou a janela de replay
      estado: 0, // do OLA: 1 = pausado
      ultimoEm: this.agora(), // ultimo pacote autenticado (silencio, 5.8)
    });
    return { aceita: true, substituida };
  }

  fecharSessao(sessao) {
    this.verificador.removerSessao(sessao);
    return this.sessoes.delete(sessao);
  }

  sessao(sessao) {
    return this.sessoes.get(sessao) || null;
  }

  /** @param {Buffer} buf @param {string} [endereco] "ip:porta" de origem do datagrama */
  receber(buf, endereco) {
    const r = this.verificador.verificar(buf, endereco);
    if (!r.ok) return r;
    const s = this.sessoes.get(r.sessao);
    if (!s) return r; // sessao de outro papel na mesma tabela (relay, Fase 3)
    s.ultimoEm = this.agora();
    if (r.avancou && endereco) s.endereco = endereco;
    const p = r.pacote;
    switch (p.tipo) {
      case TIPO.VIDEO:
      case TIPO.FEC:
        s.remontador.receber(p);
        break;
      case TIPO.OLA:
        s.estado = p.campos.estado;
        this.cb.aoOla(r.sessao, { ...p.campos, tempo: p.tempo });
        break;
      case TIPO.TCHAU:
        this.fecharSessao(r.sessao);
        this.cb.aoFim(r.sessao, p.campos.motivo);
        break;
      default:
        break;
    }
    return r;
  }

  tick() {
    for (const s of this.sessoes.values()) s.remontador.tick();
  }
}

module.exports = { Remontador, ReceptorVideo, novosContadoresRemontagem };

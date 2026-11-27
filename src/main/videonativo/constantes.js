/*
 * Constantes do protocolo de video nativo (UDP). Contrato:
 * docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, secao 2 (tabela) e secoes 4-5.
 *
 * Os mesmos nomes existem no C++ em native/media/protocolo.h; o teste cruzado
 * (cruzado.test.js) compara os valores com o que o golive-media imprime.
 * Puro Node, sem Electron.
 */

'use strict';

// --- Tabela da secao 2 (mesmos nomes da spec) ---
const MAGIA = 0x474c; // "GL", bytes 0-1 de todo pacote
const VERSAO_PROTOCOLO = 1;
const TAM_CABECALHO = 28;
const TAM_HMAC = 16;
const TAM_MAX_DATAGRAMA = 1200;
const TAM_MAX_PAYLOAD = 1156; // 1200 - 28 - 16
const TAM_FRAGMENTO = 1152; // payload de todo VIDEO que nao e o ultimo do quadro
const MAX_FRAGMENTOS = 1024;
const FEC_N_PADRAO = 10;
const FEC_N_MAX = 32;
const JANELA_REPLAY = 1024;
const ESPERA_NACK_MS = 5;
const SUSPEITA_MS = 20;
const VENCIMENTO_QUADRO_MS = 100;
const MAX_QUADROS_EM_MONTAGEM = 8;
const BUFFER_REENVIO_MS = 300;
const INTERVALO_RELATORIO_MS = 200;
const INTERVALO_MIN_KEYFRAME_MS = 500;
const OLA_INICIAL_MS = 250;
const OLA_MS = 1000;
const SILENCIO_MAX_MS = 5000;

// --- Derivadas e enumeracoes das secoes 4 e 5 ---
const TAM_MIN_DATAGRAMA = TAM_CABECALHO + TAM_HMAC; // 44: datagrama sem payload
const TAM_CHAVE = 32; // 8.2
const SEQ_LIMITE = 0xffff0000; // 4.6: chegou aqui, TCHAU motivo 4

const TIPO = Object.freeze({ VIDEO: 1, FEC: 2, NACK: 3, PEDIR_KEYFRAME: 4, RELATORIO: 5, OLA: 6, TCHAU: 7 });

const FLAG = Object.freeze({ KEYFRAME: 0x01, FIM_DE_QUADRO: 0x02, RETRANSMISSAO: 0x04, VOLTA: 0x08 });

// 5.3: entrada de NACK que pede o quadro inteiro (n desconhecido).
const NACK_QUADRO_INTEIRO = 0xffff;
const NACK_MAX_ENTRADAS = 64;

// 5.4: motivo do PEDIR_KEYFRAME.
const MOTIVO_KEYFRAME = Object.freeze({ VENCIDO: 1, ERRO_DECODE: 2, SEM_REFERENCIA: 3, SEM_SPS_PPS: 4 });

// 5.7: motivo do TCHAU; o indice casa com o `motivo` texto de `nativo-fim` (9.3).
const MOTIVO_TCHAU = Object.freeze({ FIM: 1, FALHA: 2, WEBRTC: 3, LIMITE: 4, SILENCIO: 5, SUBSTITUIDA: 6 });
const MOTIVO_FIM_TEXTO = Object.freeze([null, 'fim', 'falha', 'webrtc', 'limite', 'silencio', 'substituida']);

// 6.3: modos do receptor por sessao.
const MODO = Object.freeze({ ESPERANDO_KEYFRAME: 'ESPERANDO_KEYFRAME', NORMAL: 'NORMAL' });

// 4.5: contadores de descarte, com os nomes da spec (vao para a linha [diag], P4.4).
const MOTIVOS_DESCARTE = Object.freeze(['tamanho', 'magia', 'versao', 'tipo', 'sessao', 'hmac', 'direcao',
  'replay', 'campo']);

module.exports = {
  MAGIA, VERSAO_PROTOCOLO, TAM_CABECALHO, TAM_HMAC, TAM_MAX_DATAGRAMA, TAM_MAX_PAYLOAD, TAM_FRAGMENTO,
  MAX_FRAGMENTOS, FEC_N_PADRAO, FEC_N_MAX, JANELA_REPLAY, ESPERA_NACK_MS, SUSPEITA_MS, VENCIMENTO_QUADRO_MS,
  MAX_QUADROS_EM_MONTAGEM, BUFFER_REENVIO_MS, INTERVALO_RELATORIO_MS, INTERVALO_MIN_KEYFRAME_MS,
  OLA_INICIAL_MS, OLA_MS, SILENCIO_MAX_MS,
  TAM_MIN_DATAGRAMA, TAM_CHAVE, SEQ_LIMITE, TIPO, FLAG, NACK_QUADRO_INTEIRO, NACK_MAX_ENTRADAS,
  MOTIVO_KEYFRAME, MOTIVO_TCHAU, MOTIVO_FIM_TEXTO, MODO, MOTIVOS_DESCARTE,
};

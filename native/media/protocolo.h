#pragma once

// Constantes do protocolo de video nativo (UDP). Contrato:
// docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md, secao 2 (tabela) e secoes 4-5.
//
// Os nomes sao os da spec, iguais aos de src/main/videonativo/constantes.js (fogem do kNome do
// resto do exe de proposito: o teste cruzado compara nome a nome). `--gerar-vetores` imprime
// todos para o JS conferir.

#include <cstddef>
#include <cstdint>

namespace protocolo {

// --- Tabela da secao 2 ---
inline constexpr std::uint16_t MAGIA = 0x474C;  // "GL"
inline constexpr std::uint8_t VERSAO_PROTOCOLO = 1;
inline constexpr std::size_t TAM_CABECALHO = 28;
inline constexpr std::size_t TAM_HMAC = 16;
inline constexpr std::size_t TAM_MAX_DATAGRAMA = 1200;
inline constexpr std::size_t TAM_MAX_PAYLOAD = 1156;  // 1200 - 28 - 16
inline constexpr std::size_t TAM_FRAGMENTO = 1152;
inline constexpr int MAX_FRAGMENTOS = 1024;
inline constexpr int FEC_N_PADRAO = 10;
inline constexpr int FEC_N_MAX = 32;
inline constexpr int JANELA_REPLAY = 1024;
inline constexpr int ESPERA_NACK_MS = 5;
inline constexpr int SUSPEITA_MS = 20;
inline constexpr int VENCIMENTO_QUADRO_MS = 100;
inline constexpr int MAX_QUADROS_EM_MONTAGEM = 8;
inline constexpr int BUFFER_REENVIO_MS = 300;
inline constexpr int INTERVALO_RELATORIO_MS = 200;
inline constexpr int INTERVALO_MIN_KEYFRAME_MS = 500;
inline constexpr int OLA_INICIAL_MS = 250;
inline constexpr int OLA_MS = 1000;
inline constexpr int SILENCIO_MAX_MS = 5000;

static_assert(TAM_MAX_PAYLOAD == TAM_MAX_DATAGRAMA - TAM_CABECALHO - TAM_HMAC);
static_assert(TAM_FRAGMENTO + 4 == TAM_MAX_PAYLOAD, "um FEC cheio e 4 de cabecalho + 1152");

// --- Derivadas e enumeracoes (secoes 4 e 5) ---
inline constexpr std::size_t TAM_MIN_DATAGRAMA = TAM_CABECALHO + TAM_HMAC;
inline constexpr std::size_t TAM_CHAVE = 32;
inline constexpr std::uint32_t SEQ_LIMITE = 0xFFFF0000u;  // 4.6: chegou aqui, TCHAU motivo 4

inline constexpr std::uint8_t TIPO_VIDEO = 1;
inline constexpr std::uint8_t TIPO_FEC = 2;
inline constexpr std::uint8_t TIPO_NACK = 3;
inline constexpr std::uint8_t TIPO_PEDIR_KEYFRAME = 4;
inline constexpr std::uint8_t TIPO_RELATORIO = 5;
inline constexpr std::uint8_t TIPO_OLA = 6;
inline constexpr std::uint8_t TIPO_TCHAU = 7;

inline constexpr std::uint8_t FLAG_KEYFRAME = 0x01;
inline constexpr std::uint8_t FLAG_FIM_DE_QUADRO = 0x02;
inline constexpr std::uint8_t FLAG_RETRANSMISSAO = 0x04;
inline constexpr std::uint8_t FLAG_VOLTA = 0x08;

inline constexpr std::uint16_t NACK_QUADRO_INTEIRO = 0xFFFF;
inline constexpr int NACK_MAX_ENTRADAS = 64;

}  // namespace protocolo

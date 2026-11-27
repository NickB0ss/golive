#pragma once

// Empacotador do video nativo: quadro Annex B -> datagramas com cabecalho e HMAC.
// Contrato: docs/superpowers/specs/2026-11-25-protocolo-video-nativo.md (secoes 4, 5, 6.1, 6.2 e 7).
// Espelho do lado de envio de src/main/videonativo/pacote.js; o teste cruzado compara os bytes.
//
// Dois passos, de proposito separados:
//   1. FragmentarQuadro: quadro -> pacotes "abertos" (sem sessao, sequencia, tempo e HMAC), com o
//      FEC de cada grupo logo depois do ultimo fragmento dele. E o que o buffer de reenvio (P2.3)
//      guarda, com chave (quadro, indice).
//   2. SessaoEnvio::Selar: na hora de mandar, poe sessao, a proxima sequencia, o tempo e o HMAC.
//      Reenvio (RETRANSMISSAO = 1) e FEC tambem gastam sequencia (4.6), e o pacing (P2.2/P2.3,
//      com Winsock) carimba o tempo de quando sai de fato, por isso nada disso e fixado no passo 1.
//
// Portavel (C++20 padrao): o envio por Winsock fica para quando o exe tiver encoder.

#include <cstddef>
#include <cstdint>
#include <vector>

#include "protocolo.h"
#include "sha256.h"

// Pacote ainda sem sessao/sequencia/tempo/HMAC.
struct PacoteAberto {
  std::uint8_t tipo = 0;
  std::uint32_t quadro = 0;
  std::uint16_t indice = 0;
  std::uint16_t total = 0;
  std::uint8_t flags = 0;
  std::vector<std::uint8_t> payload;
};

enum class ResultadoFragmentar { kOk, kVazio, kGrandeDemais, kFecInvalido };

// Quebra um quadro (6.1). fecN 0 = sem FEC; 1..FEC_N_MAX. kGrandeDemais: mais de MAX_FRAGMENTOS
// fragmentos; o chamador segue a 6.2 (nao manda, nao manda deltas ate o proximo keyframe, baixa o
// bitrate, forca keyframe, conta `quadros_grandes`). `saida` e limpo e preenchido em ordem de envio.
ResultadoFragmentar FragmentarQuadro(const std::uint8_t* dados, std::size_t tam, std::uint32_t quadro,
                                     bool keyframe, int fecN, std::vector<PacoteAberto>* saida);

// Payload do FEC (5.2) sobre os fragmentos do grupo, em ordem de indice.
std::vector<std::uint8_t> PayloadFec(const std::vector<const std::vector<std::uint8_t>*>& grupo);

// Payloads dos outros tipos (5.3 a 5.7). Os campos fora de faixa sao responsabilidade de quem chama.
struct EntradaNack {
  std::uint32_t quadro;
  std::uint16_t primeiro;
  std::uint16_t quantidade;  // NACK_QUADRO_INTEIRO com primeiro = 0: o quadro inteiro
};
std::vector<std::uint8_t> PayloadNack(const std::vector<EntradaNack>& entradas);
std::vector<std::uint8_t> PayloadPedirKeyframe(std::uint8_t motivo, std::uint32_t ultimoQuadro);

struct Relatorio {
  std::uint32_t intervaloUs = 0;
  std::uint16_t esperados = 0, recebidos = 0;
  std::uint32_t kbps = 0, atrasoMedioUs = 0, atrasoMaxUs = 0, maiorSeq = 0, ecoTempo = 0, ecoEsperaUs = 0;
  std::uint16_t quadrosCompletos = 0, quadrosVencidos = 0, recuperadosFec = 0, nacks = 0;
};
std::vector<std::uint8_t> PayloadRelatorio(const Relatorio& r);
std::vector<std::uint8_t> PayloadOla(std::uint8_t estado, std::uint32_t ecoTempo, std::uint32_t ecoEsperaUs);
std::vector<std::uint8_t> PayloadTchau(std::uint8_t motivo);

// Um sentido de envio de uma sessao: id, chave e a sequencia (comeca em 1, 4.6).
class SessaoEnvio {
 public:
  // `primeiraSequencia` != 1 so em teste (os vetores da spec usam sequencias soltas).
  SessaoEnvio(std::uint32_t sessao, const std::uint8_t chave[protocolo::TAM_CHAVE],
              std::uint32_t primeiraSequencia = 1);

  // Escreve o datagrama em `saida` (TAM_MAX_DATAGRAMA bytes livres) com a proxima sequencia e
  // devolve o tamanho; 0 se o payload nao cabe. `flagsExtra` entra em OU com as do pacote
  // (RETRANSMISSAO no reenvio, VOLTA no sentido de volta).
  std::size_t Selar(const PacoteAberto& p, std::uint32_t tempoUs, std::uint8_t* saida, std::uint8_t flagsExtra = 0);

  std::uint32_t sessao() const { return sessao_; }
  std::uint32_t proximaSequencia() const { return seq_; }
  // 4.6: chegou ao limite, manda TCHAU motivo 4 e a sinalizacao refaz a sessao com chave nova.
  bool NoLimite() const { return seq_ >= protocolo::SEQ_LIMITE; }

 private:
  std::uint32_t sessao_;
  std::uint32_t seq_;
  HmacSha256 hmac_;
};

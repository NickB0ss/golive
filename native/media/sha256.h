#pragma once

// SHA-256 (FIPS 180-4) e HMAC-SHA256 (RFC 2104), proprios e pequenos.
//
// Por que proprio nos dois sistemas e nao BCrypt no Windows (spec 8.3): o HMAC e a parte do
// pacote que o teste cruzado mais precisa cobrir, e com um codigo so o que roda no exe do Windows e
// exatamente o que passa nos vetores FIPS 180-4 / RFC 4231 e nos V1-V4 aqui no Linux. O custo e
// pequeno (~1.500 pacotes/s x 1,2 KB = ~2 MB/s de hash) e nao e biblioteca de terceiros (D-04).
// BCrypt continua sendo o caminho para BCryptGenRandom (chave da sessao, P2.6).

#include <array>
#include <cstddef>
#include <cstdint>

class Sha256 {
 public:
  static constexpr std::size_t kTamBloco = 64;
  static constexpr std::size_t kTamResumo = 32;
  using Resumo = std::array<std::uint8_t, kTamResumo>;

  Sha256();
  void Atualizar(const std::uint8_t* dados, std::size_t tam);
  Resumo Finalizar();  // o objeto fica inutil depois; copie antes se precisar reusar o estado

 private:
  void Bloco(const std::uint8_t* p);

  std::array<std::uint32_t, 8> h_;
  std::array<std::uint8_t, kTamBloco> buf_{};
  std::size_t usados_ = 0;
  std::uint64_t total_ = 0;  // bytes
};

Sha256::Resumo CalcularSha256(const std::uint8_t* dados, std::size_t tam);

// HMAC com a chave fixada uma vez (como o BCRYPT_HASH_REUSABLE_FLAG da 8.3): os estados internos
// de ipad e opad ficam prontos, e cada `Calcular` so copia e segue.
class HmacSha256 {
 public:
  HmacSha256(const std::uint8_t* chave, std::size_t tam);
  Sha256::Resumo Calcular(const std::uint8_t* dados, std::size_t tam) const;

 private:
  Sha256 interno_;
  Sha256 externo_;
};

// Compara em tempo constante (laco com OR acumulado, spec 8.3).
bool IguaisTempoConstante(const std::uint8_t* a, const std::uint8_t* b, std::size_t tam);

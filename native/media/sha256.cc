#include "sha256.h"

#include <cstring>

namespace {

constexpr std::uint32_t kK[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};

constexpr std::uint32_t Rotd(std::uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }

}  // namespace

Sha256::Sha256()
    : h_{0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19} {}

void Sha256::Bloco(const std::uint8_t* p) {
  std::uint32_t w[64];
  for (int t = 0; t < 16; ++t) {
    w[t] = (std::uint32_t{p[4 * t]} << 24) | (std::uint32_t{p[4 * t + 1]} << 16) |
           (std::uint32_t{p[4 * t + 2]} << 8) | std::uint32_t{p[4 * t + 3]};
  }
  for (int t = 16; t < 64; ++t) {
    const std::uint32_t s0 = Rotd(w[t - 15], 7) ^ Rotd(w[t - 15], 18) ^ (w[t - 15] >> 3);
    const std::uint32_t s1 = Rotd(w[t - 2], 17) ^ Rotd(w[t - 2], 19) ^ (w[t - 2] >> 10);
    w[t] = w[t - 16] + s0 + w[t - 7] + s1;
  }
  std::uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3], e = h_[4], f = h_[5], g = h_[6], h = h_[7];
  for (int t = 0; t < 64; ++t) {
    const std::uint32_t t1 = h + (Rotd(e, 6) ^ Rotd(e, 11) ^ Rotd(e, 25)) + ((e & f) ^ (~e & g)) + kK[t] + w[t];
    const std::uint32_t t2 = (Rotd(a, 2) ^ Rotd(a, 13) ^ Rotd(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  h_[0] += a;
  h_[1] += b;
  h_[2] += c;
  h_[3] += d;
  h_[4] += e;
  h_[5] += f;
  h_[6] += g;
  h_[7] += h;
}

void Sha256::Atualizar(const std::uint8_t* dados, std::size_t tam) {
  total_ += tam;
  if (usados_ > 0) {
    const std::size_t n = tam < kTamBloco - usados_ ? tam : kTamBloco - usados_;
    std::memcpy(buf_.data() + usados_, dados, n);
    usados_ += n;
    dados += n;
    tam -= n;
    if (usados_ < kTamBloco) return;
    Bloco(buf_.data());
    usados_ = 0;
  }
  for (; tam >= kTamBloco; dados += kTamBloco, tam -= kTamBloco) Bloco(dados);
  if (tam > 0) {
    std::memcpy(buf_.data(), dados, tam);
    usados_ = tam;
  }
}

Sha256::Resumo Sha256::Finalizar() {
  const std::uint64_t bits = total_ * 8;
  // Padding: 0x80, zeros ate sobrar 8 bytes no bloco, e o tamanho em bits (big-endian).
  std::uint8_t pad[kTamBloco + 8] = {0x80};
  const std::size_t resto = usados_ < 56 ? 56 - usados_ : 120 - usados_;
  for (int i = 0; i < 8; ++i) pad[resto + i] = static_cast<std::uint8_t>(bits >> (56 - 8 * i));
  Atualizar(pad, resto + 8);
  Resumo r;
  for (int i = 0; i < 8; ++i) {
    r[4 * i] = static_cast<std::uint8_t>(h_[i] >> 24);
    r[4 * i + 1] = static_cast<std::uint8_t>(h_[i] >> 16);
    r[4 * i + 2] = static_cast<std::uint8_t>(h_[i] >> 8);
    r[4 * i + 3] = static_cast<std::uint8_t>(h_[i]);
  }
  return r;
}

Sha256::Resumo CalcularSha256(const std::uint8_t* dados, std::size_t tam) {
  Sha256 s;
  s.Atualizar(dados, tam);
  return s.Finalizar();
}

HmacSha256::HmacSha256(const std::uint8_t* chave, std::size_t tam) {
  std::uint8_t k[Sha256::kTamBloco] = {};
  if (tam > Sha256::kTamBloco) {
    const Sha256::Resumo r = CalcularSha256(chave, tam);
    std::memcpy(k, r.data(), r.size());
  } else if (tam > 0) {
    std::memcpy(k, chave, tam);
  }
  std::uint8_t ipad[Sha256::kTamBloco], opad[Sha256::kTamBloco];
  for (std::size_t i = 0; i < Sha256::kTamBloco; ++i) {
    ipad[i] = static_cast<std::uint8_t>(k[i] ^ 0x36);
    opad[i] = static_cast<std::uint8_t>(k[i] ^ 0x5c);
  }
  interno_.Atualizar(ipad, sizeof ipad);
  externo_.Atualizar(opad, sizeof opad);
}

Sha256::Resumo HmacSha256::Calcular(const std::uint8_t* dados, std::size_t tam) const {
  Sha256 in = interno_;
  in.Atualizar(dados, tam);
  const Sha256::Resumo r = in.Finalizar();
  Sha256 ex = externo_;
  ex.Atualizar(r.data(), r.size());
  return ex.Finalizar();
}

bool IguaisTempoConstante(const std::uint8_t* a, const std::uint8_t* b, std::size_t tam) {
  std::uint8_t dif = 0;
  for (std::size_t i = 0; i < tam; ++i) dif |= static_cast<std::uint8_t>(a[i] ^ b[i]);
  return dif == 0;
}

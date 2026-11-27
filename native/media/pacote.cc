#include "pacote.h"

#include <algorithm>
#include <cstring>

using namespace protocolo;

namespace {

void Poe16(std::uint8_t* p, std::uint16_t v) {
  p[0] = static_cast<std::uint8_t>(v >> 8);
  p[1] = static_cast<std::uint8_t>(v);
}

void Poe32(std::uint8_t* p, std::uint32_t v) {
  p[0] = static_cast<std::uint8_t>(v >> 24);
  p[1] = static_cast<std::uint8_t>(v >> 16);
  p[2] = static_cast<std::uint8_t>(v >> 8);
  p[3] = static_cast<std::uint8_t>(v);
}

}  // namespace

std::vector<std::uint8_t> PayloadFec(const std::vector<const std::vector<std::uint8_t>*>& grupo) {
  std::size_t L = 0;
  for (const auto* f : grupo) L = std::max(L, f->size());
  std::vector<std::uint8_t> out(4 + L, 0);
  out[0] = static_cast<std::uint8_t>(grupo.size());
  std::uint16_t xorTam = 0;
  for (const auto* f : grupo) {
    xorTam = static_cast<std::uint16_t>(xorTam ^ f->size());
    for (std::size_t j = 0; j < f->size(); ++j) out[4 + j] ^= (*f)[j];
  }
  Poe16(out.data() + 2, xorTam);
  return out;
}

ResultadoFragmentar FragmentarQuadro(const std::uint8_t* dados, std::size_t tam, std::uint32_t quadro,
                                     bool keyframe, int fecN, std::vector<PacoteAberto>* saida) {
  saida->clear();
  if (tam == 0 || quadro == 0) return ResultadoFragmentar::kVazio;
  if (fecN < 0 || fecN > FEC_N_MAX) return ResultadoFragmentar::kFecInvalido;
  const std::size_t n = (tam + TAM_FRAGMENTO - 1) / TAM_FRAGMENTO;
  if (n > static_cast<std::size_t>(MAX_FRAGMENTOS)) return ResultadoFragmentar::kGrandeDemais;

  const std::uint8_t base = keyframe ? FLAG_KEYFRAME : 0;
  const std::size_t passo = fecN > 0 ? static_cast<std::size_t>(fecN) : n;
  saida->reserve(n + (fecN > 0 ? (n + passo - 1) / passo : 0));
  for (std::size_t ini = 0; ini < n; ini += passo) {
    const std::size_t fim = std::min(ini + passo, n);
    const std::size_t primeiroDoGrupo = saida->size();
    for (std::size_t i = ini; i < fim; ++i) {
      PacoteAberto p;
      p.tipo = TIPO_VIDEO;
      p.quadro = quadro;
      p.indice = static_cast<std::uint16_t>(i);
      p.total = static_cast<std::uint16_t>(n);
      p.flags = static_cast<std::uint8_t>(base | (i == n - 1 ? FLAG_FIM_DE_QUADRO : 0));
      const std::size_t de = i * TAM_FRAGMENTO;
      const std::size_t ate = std::min(de + TAM_FRAGMENTO, tam);
      p.payload.assign(dados + de, dados + ate);
      saida->push_back(std::move(p));
    }
    if (fecN > 0) {
      std::vector<const std::vector<std::uint8_t>*> grupo;
      for (std::size_t k = primeiroDoGrupo; k < saida->size(); ++k) grupo.push_back(&(*saida)[k].payload);
      PacoteAberto f;
      f.tipo = TIPO_FEC;
      f.quadro = quadro;
      f.indice = static_cast<std::uint16_t>(ini);
      f.total = static_cast<std::uint16_t>(n);
      f.flags = base;
      f.payload = PayloadFec(grupo);
      saida->push_back(std::move(f));
    }
  }
  return ResultadoFragmentar::kOk;
}

std::vector<std::uint8_t> PayloadNack(const std::vector<EntradaNack>& entradas) {
  std::vector<std::uint8_t> out(2 + 8 * entradas.size(), 0);
  out[0] = static_cast<std::uint8_t>(entradas.size());
  for (std::size_t k = 0; k < entradas.size(); ++k) {
    Poe32(out.data() + 2 + 8 * k, entradas[k].quadro);
    Poe16(out.data() + 6 + 8 * k, entradas[k].primeiro);
    Poe16(out.data() + 8 + 8 * k, entradas[k].quantidade);
  }
  return out;
}

std::vector<std::uint8_t> PayloadPedirKeyframe(std::uint8_t motivo, std::uint32_t ultimoQuadro) {
  std::vector<std::uint8_t> out(8, 0);
  out[0] = motivo;
  Poe32(out.data() + 4, ultimoQuadro);
  return out;
}

std::vector<std::uint8_t> PayloadRelatorio(const Relatorio& r) {
  std::vector<std::uint8_t> out(40, 0);
  std::uint8_t* p = out.data();
  Poe32(p + 0, r.intervaloUs);
  Poe16(p + 4, r.esperados);
  Poe16(p + 6, r.recebidos);
  Poe32(p + 8, r.kbps);
  Poe32(p + 12, r.atrasoMedioUs);
  Poe32(p + 16, r.atrasoMaxUs);
  Poe32(p + 20, r.maiorSeq);
  Poe32(p + 24, r.ecoTempo);
  Poe32(p + 28, r.ecoEsperaUs);
  Poe16(p + 32, r.quadrosCompletos);
  Poe16(p + 34, r.quadrosVencidos);
  Poe16(p + 36, r.recuperadosFec);
  Poe16(p + 38, r.nacks);
  return out;
}

std::vector<std::uint8_t> PayloadOla(std::uint8_t estado, std::uint32_t ecoTempo, std::uint32_t ecoEsperaUs) {
  std::vector<std::uint8_t> out(12, 0);
  out[0] = estado;
  Poe32(out.data() + 4, ecoTempo);
  Poe32(out.data() + 8, ecoEsperaUs);
  return out;
}

std::vector<std::uint8_t> PayloadTchau(std::uint8_t motivo) {
  std::vector<std::uint8_t> out(4, 0);
  out[0] = motivo;
  return out;
}

SessaoEnvio::SessaoEnvio(std::uint32_t sessao, const std::uint8_t chave[TAM_CHAVE], std::uint32_t primeiraSequencia)
    : sessao_(sessao), seq_(primeiraSequencia), hmac_(chave, TAM_CHAVE) {}

std::size_t SessaoEnvio::Selar(const PacoteAberto& p, std::uint32_t tempoUs, std::uint8_t* saida,
                               std::uint8_t flagsExtra) {
  const std::size_t tam = p.payload.size();
  if (tam > TAM_MAX_PAYLOAD) return 0;
  saida[0] = static_cast<std::uint8_t>(MAGIA >> 8);
  saida[1] = static_cast<std::uint8_t>(MAGIA & 0xFF);
  saida[2] = VERSAO_PROTOCOLO;
  saida[3] = p.tipo;
  Poe32(saida + 4, sessao_);
  Poe32(saida + 8, seq_++);
  Poe32(saida + 12, tempoUs);
  Poe32(saida + 16, p.quadro);
  Poe16(saida + 20, p.indice);
  Poe16(saida + 22, p.total);
  saida[24] = static_cast<std::uint8_t>(p.flags | flagsExtra);
  saida[25] = 0;
  Poe16(saida + 26, static_cast<std::uint16_t>(tam));
  if (tam > 0) std::memcpy(saida + TAM_CABECALHO, p.payload.data(), tam);
  const std::size_t fim = TAM_CABECALHO + tam;
  const Sha256::Resumo r = hmac_.Calcular(saida, fim);
  std::memcpy(saida + fim, r.data(), TAM_HMAC);
  return fim + TAM_HMAC;
}

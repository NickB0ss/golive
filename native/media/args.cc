#include "args.h"

#include <cerrno>
#include <cstdlib>

namespace {

// Limites aceitos. O teto de kbps cobre 4K60 com folga; abaixo do piso o
// encoder de hardware costuma recusar.
constexpr int kFpsMin = 1, kFpsMax = 240;
constexpr int kKbpsMin = 100, kKbpsMax = 200000;
constexpr int kSegundosMax = 86400;
constexpr int kMonitorMax = 64;

// Inteiro estrito: so digitos (com sinal opcional), sem lixo no fim.
bool ParaInt(const std::string& s, long long* v) {
  if (s.empty()) return false;
  char* fim = nullptr;
  errno = 0;
  const long long r = std::strtoll(s.c_str(), &fim, 10);
  if (errno != 0 || fim == s.c_str() || *fim != '\0') return false;
  *v = r;
  return true;
}

// HWND aceita decimal ou 0x... (o Electron entrega decimal).
bool ParaHwnd(const std::string& s, std::uint64_t* v) {
  if (s.empty() || s[0] == '-') return false;
  char* fim = nullptr;
  errno = 0;
  const unsigned long long r = std::strtoull(s.c_str(), &fim, 0);
  if (errno != 0 || fim == s.c_str() || *fim != '\0' || r == 0) return false;
  *v = r;
  return true;
}

}  // namespace

const char* TextoDeUso() {
  return "uso: golive-media (--janela <hwnd> | --monitor <indice>) [--fps 1..240] [--kbps 100..200000]\n"
         "                   [--saida <arquivo.h264>] [--segundos <n>]\n"
         "  sem origem: monitor 0. --segundos 0 (padrao): roda ate 'parar' ou EOF no stdin.\n"
         "  codigos de saida: 0 ok, 2 argumentos invalidos, 3 sem encoder de hardware (reservado)\n";
}

ResultadoArgs LerArgumentos(int argc, char** argv, Argumentos* out, std::string* erro) {
  bool temJanela = false, temMonitor = false;
  auto falha = [&](const std::string& msg) {
    *erro = msg;
    return ResultadoArgs::kErro;
  };

  for (int i = 1; i < argc; ++i) {
    const std::string opt = argv[i];
    if (opt == "--ajuda" || opt == "--help" || opt == "-h") return ResultadoArgs::kAjuda;

    const bool conhecida = opt == "--janela" || opt == "--monitor" || opt == "--fps" || opt == "--kbps" ||
                           opt == "--saida" || opt == "--segundos";
    if (!conhecida) return falha("argumento desconhecido: " + opt);
    if (i + 1 >= argc) return falha("faltou o valor de " + opt);
    const std::string valor = argv[++i];

    long long n = 0;
    if (opt == "--janela") {
      if (!ParaHwnd(valor, &out->janela)) return falha("--janela precisa de um hwnd valido: " + valor);
      temJanela = true;
    } else if (opt == "--monitor") {
      if (!ParaInt(valor, &n) || n < 0 || n > kMonitorMax) {
        return falha("--monitor fora de 0.." + std::to_string(kMonitorMax) + ": " + valor);
      }
      out->monitor = static_cast<int>(n);
      temMonitor = true;
    } else if (opt == "--fps") {
      if (!ParaInt(valor, &n) || n < kFpsMin || n > kFpsMax) return falha("--fps fora de 1..240: " + valor);
      out->fps = static_cast<int>(n);
    } else if (opt == "--kbps") {
      if (!ParaInt(valor, &n) || n < kKbpsMin || n > kKbpsMax) return falha("--kbps fora de 100..200000: " + valor);
      out->kbps = static_cast<int>(n);
    } else if (opt == "--segundos") {
      if (!ParaInt(valor, &n) || n < 0 || n > kSegundosMax) return falha("--segundos fora de 0..86400: " + valor);
      out->segundos = static_cast<int>(n);
    } else {  // --saida
      if (valor.empty()) return falha("--saida nao pode ser vazio");
      out->saida = valor;
    }
  }

  if (temJanela && temMonitor) return falha("--janela e --monitor sao mutuamente exclusivos");
  if (temJanela) out->origem = TipoOrigem::kJanela;
  return ResultadoArgs::kOk;
}

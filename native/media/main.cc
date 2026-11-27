// golive-media: processo auxiliar de captura e encode (D-03). Controlado pelo
// main do Electron por stdin/stdout, uma linha JSON por mensagem.
//
// Neste passo (P1.1) e so o esqueleto: le argumentos, emite metricas e atende
// comandos. Captura (P1.3), conversao (P1.4) e encode (P1.5) entram depois.
//
// Codigos de saida:
//   0  ok (--segundos cumprido, comando "parar" ou EOF no stdin)
//   2  argumentos invalidos (mensagem no stderr)
//   3  reservado: sem encoder H.264 de hardware (P1.5)
//   1  so com --gerar-vetores: o autoteste de SHA-256/HMAC falhou
//
// stdout: so metricas, uma linha JSON por segundo. stderr: so avisos e erros.
// Portavel (C++20 padrao); o que e do Windows fica atras de _WIN32.

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

#include "args.h"
#include "controle.h"
#include "metricas.h"
#include "pacote_vetores.h"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

namespace {

constexpr int kSaidaOk = 0;
constexpr int kSaidaArgumentos = 2;

void PrepararPlataforma() {
#ifdef _WIN32
  // Sem conversao \n -> \r\n: o main do Electron divide o stdout por '\n'.
  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
  // Sem janela de erro do Windows se algo falhar: o main ve o codigo de saida.
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
#endif
}

}  // namespace

int main(int argc, char** argv) {
  Argumentos args;
  std::string erro;
  switch (LerArgumentos(argc, argv, &args, &erro)) {
    case ResultadoArgs::kAjuda:
      std::fputs(TextoDeUso(), stdout);
      return kSaidaOk;
    case ResultadoArgs::kErro:
      std::fprintf(stderr, "golive-media: %s\n%s", erro.c_str(), TextoDeUso());
      return kSaidaArgumentos;
    case ResultadoArgs::kGerarVetores:
      PrepararPlataforma();
      return GerarVetores();
    case ResultadoArgs::kOk:
      break;
  }

  PrepararPlataforma();

  Metricas metricas;
  metricas.fpsAlvo = args.fps;
  metricas.kbpsAlvo = args.kbps;

  Controle controle;
  controle.kbps = &metricas.kbpsAlvo;
  // Desanexada: o getline bloqueia ate chegar uma linha, e nao ha como acorda-la
  // de forma portavel. O processo termina com _Exit abaixo.
  std::thread(LacoStdin, &controle).detach();

  using Relogio = std::chrono::steady_clock;
  const auto inicio = Relogio::now();
  int t = 0;
  while (!controle.parar) {
    const auto proximo = inicio + std::chrono::seconds(t + 1);
    // Dorme em fatias curtas para reagir a `parar` em ate ~20 ms.
    while (!controle.parar && Relogio::now() < proximo) {
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    if (controle.parar) break;
    ++t;
    EscreverLinha(FormatarLinha(t, metricas));
    if (args.segundos > 0 && t >= args.segundos) break;
  }

  std::fflush(stdout);
  std::fflush(stderr);
  std::_Exit(kSaidaOk);
}

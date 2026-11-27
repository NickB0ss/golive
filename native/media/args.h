#pragma once

#include <cstdint>
#include <string>

// Argumentos de linha de comando do golive-media.
//
//   golive-media (--janela <hwnd> | --monitor <indice>) [--fps N] [--kbps N]
//                [--saida arquivo.h264] [--segundos N]
//   golive-media --gerar-vetores
//
// Neste passo (P1.1) a origem e so validada; a captura entra no P1.3.
// Sem nenhuma origem, assume o monitor 0 (o esqueleto precisa rodar sem jogo).

enum class TipoOrigem { kMonitor, kJanela };

struct Argumentos {
  TipoOrigem origem = TipoOrigem::kMonitor;
  std::uint64_t janela = 0;  // HWND, so quando origem == kJanela
  int monitor = 0;           // indice, so quando origem == kMonitor
  int fps = 60;
  int kbps = 6000;
  std::string saida;         // vazio = sem arquivo
  int segundos = 0;          // 0 = roda ate `parar`/EOF no stdin
};

// kGerarVetores: `--gerar-vetores` sozinho, modo de teste do pacote (pacote_vetores.h).
enum class ResultadoArgs { kOk, kAjuda, kErro, kGerarVetores };

// Preenche `out`. Em kErro, `erro` traz a mensagem para o stderr.
ResultadoArgs LerArgumentos(int argc, char** argv, Argumentos* out, std::string* erro);

// Texto de uso, para --ajuda e para erros.
const char* TextoDeUso();

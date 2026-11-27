#pragma once

#include <atomic>
#include <string>

// Linha de metricas (uma por segundo, JSON no stdout).
//
// Os campos de captura/encode/rede entram nos passos P1.3 a P1.6; ate la ficam
// `null`. As chaves existem desde ja para o main do Electron poder fixar o formato.

struct Metricas {
  int fpsAlvo = 0;
  std::atomic<int> kbpsAlvo{0};
  // Preenchidos pelos modulos futuros; negativo = ainda nao medido.
  // captura: P1.3, encode: P1.5.
  double capturaFps = -1;
  double encodeFps = -1;
};

// Monta a linha para o segundo `t` (sem o '\n').
std::string FormatarLinha(int t, const Metricas& m);

// Escreve no stdout com flush; serializado para nao misturar com outras threads.
void EscreverLinha(const std::string& linha);

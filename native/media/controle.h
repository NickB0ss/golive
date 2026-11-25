#pragma once

#include <atomic>
#include <string>

// Comandos recebidos pelo stdin (uma linha JSON por comando).
//
//   {"cmd":"keyframe"}            pede um quadro-chave no proximo quadro
//   {"cmd":"kbps","valor":6000}   muda a taxa-alvo
//   {"cmd":"parar"}               encerra com codigo 0

enum class TipoComando { kInvalido, kKeyframe, kKbps, kParar };

struct Comando {
  TipoComando tipo = TipoComando::kInvalido;
  long long valor = 0;  // so para kKbps
  std::string erro;     // motivo, quando kInvalido
};

// Parser minimo, so para o formato acima: um objeto plano com valores string
// ou numero. Nao e um parser JSON geral; chaves desconhecidas sao ignoradas.
Comando InterpretarLinha(const std::string& linha);

// Estado compartilhado entre a thread de controle e o laco principal.
struct Controle {
  std::atomic<bool> parar{false};
  std::atomic<bool> keyframePedido{false};  // consumido pelo encoder (P1.5)
  std::atomic<int>* kbps = nullptr;         // aponta para Metricas::kbpsAlvo
};

// Aplica um comando valido. Retorna false se `c` for invalido (o chamador avisa).
bool Aplicar(const Comando& c, Controle* ctl);

// Laco da thread de controle: le o stdin ate EOF ou `parar`. EOF = parar.
void LacoStdin(Controle* ctl);

#pragma once

#include <windows.h>

// Prioridade de agendamento de GPU (WDDM) e de CPU de um processo.
//
// POR QUE EXISTE: com um jogo pesado em primeiro plano a GPU fica em ~99%, e
// o agendador do Windows serve primeiro o processo do jogo. Os processos do
// GoLive (navegador, GPU e captura do Chromium) disputam a mesma fila: a
// copia do quadro do WGC, o desenho no canvas e o envio ao NVENC esperam o
// jogo terminar cada quadro dele. O sintoma e o dos logs de 21/11: `cap=10fps`
// na origem com banda sobrando e perda zero. OBS e Sunshine resolvem a mesma
// coisa subindo a prioridade de GPU do proprio processo
// (D3DKMTSetProcessSchedulingPriorityClass).
//
// A funcao e exportada pelo gdi32.dll desde o Windows 7, mas nao tem
// cabecalho no SDK de usuario (mora no d3dkmthk.h do WDK); por isso e
// carregada em tempo de execucao.

// Valores do enum D3DKMT_SCHEDULINGPRIORITYCLASS (d3dkmthk.h).
enum GoLiveGpuPriorityClass : int {
  kGpuPriorityIdle = 0,
  kGpuPriorityBelowNormal = 1,
  kGpuPriorityNormal = 2,
  kGpuPriorityAboveNormal = 3,
  kGpuPriorityHigh = 4,
  kGpuPriorityRealtime = 5,
};

struct GpuPriorityResult {
  // NTSTATUS devolvido pelo D3DKMT (0 = sucesso). Valores especiais:
  // -1 = funcao indisponivel neste Windows; -2 = OpenProcess falhou (ver
  // win32Error).
  long status = -1;
  // GetLastError do OpenProcess/SetPriorityClass quando falharam, ou 0.
  DWORD win32Error = 0;
  // A prioridade de CPU tambem foi aplicada.
  bool cpuApplied = false;
  // Classe lida de volta depois de aplicar, ou -1 se a leitura falhou.
  int readBack = -1;
};

// Aplica a classe de GPU `gpuClass` ao processo `pid` e, se `cpuClass` for
// diferente de 0, a classe de CPU (ex: ABOVE_NORMAL_PRIORITY_CLASS). Nunca
// lanca excecao.
GpuPriorityResult SetProcessGpuPriority(DWORD pid, int gpuClass, DWORD cpuClass);

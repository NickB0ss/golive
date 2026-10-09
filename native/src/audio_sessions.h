#pragma once

#include <windows.h>
#include <vector>

// PIDs de todo processo com uma sessao de audio ATIVA (tocando som agora,
// nao so aberta em silencio) no dispositivo de saida padrao do sistema.
// Usado pro modo "lista de inclusao" do compartilhamento de tela sem o
// Discord: em vez de excluir um processo so (o WASAPI Process Loopback so
// aceita excluir UMA arvore por captura), sobe uma captura INCLUDE por PID
// desta lista, pulando a arvore do proprio GoLive e a do Discord.
//
// Lista vazia significa enumeracao valida sem sessao ativa. Falha de API
// lanca excecao e deve ser propagada ate o resultado estruturado do IPC.
std::vector<DWORD> ListAudioRenderPids();

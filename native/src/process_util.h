#pragma once

#include <windows.h>
#include <string>
#include <vector>

struct ProcessInfo {
  DWORD pid;
  DWORD ppid;
  std::wstring name;
};

// Snapshot de todos os processos rodando agora (via CreateToolhelp32Snapshot).
// Devolve lista vazia em caso de falha (sem lancar excecao).
std::vector<ProcessInfo> ListProcesses();

// PID do processo "raiz" do Discord (Discord.exe / DiscordPTB.exe /
// DiscordCanary.exe / DiscordDevelopment.exe cujo pai nao e outro processo
// Discord -- o launcher/updater nao conta). Devolve 0 se o Discord nao
// estiver rodando.
DWORD FindDiscordRootPid();

// PID dono da janela identificada por um HWND (recebido como numero, ja que
// e assim que o id de fonte do desktopCapturer do Electron representa a
// janela no Windows: "window:<hwnd>:0"). Devolve 0 se a janela nao existe.
DWORD PidForWindowHandle(long long hwndValue);

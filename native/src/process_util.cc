#include "process_util.h"

#include <tlhelp32.h>

#include <algorithm>
#include <cwctype>
#include <unordered_set>

std::vector<ProcessInfo> ListProcesses() {
  std::vector<ProcessInfo> out;
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snap == INVALID_HANDLE_VALUE) return out;

  PROCESSENTRY32W entry;
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snap, &entry)) {
    do {
      ProcessInfo info;
      info.pid = entry.th32ProcessID;
      info.ppid = entry.th32ParentProcessID;
      info.name = entry.szExeFile;
      out.push_back(std::move(info));
    } while (Process32NextW(snap, &entry));
  }
  CloseHandle(snap);
  return out;
}

namespace {

bool IsDiscordExeName(const std::wstring& name) {
  std::wstring lower = name;
  std::transform(lower.begin(), lower.end(), lower.begin(),
                  [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
  // Cobre Discord.exe, DiscordPTB.exe, DiscordCanary.exe, DiscordDevelopment.exe.
  const std::wstring suffix = L".exe";
  if (lower.size() < suffix.size()) return false;
  bool endsWithExe = lower.compare(lower.size() - suffix.size(), suffix.size(), suffix) == 0;
  return endsWithExe && lower.rfind(L"discord", 0) == 0;
}

}  // namespace

DWORD FindDiscordRootPid() {
  auto procs = ListProcesses();

  std::unordered_set<DWORD> discordPids;
  for (const auto& p : procs) {
    if (IsDiscordExeName(p.name)) discordPids.insert(p.pid);
  }
  if (discordPids.empty()) return 0;

  // "Raiz" = processo Discord cujo pai nao e outro processo Discord (o
  // launcher/updater, que costuma morrer logo depois de subir o app
  // principal, nao entra nessa arvore). ActivateAudioInterfaceAsync com
  // PROCESS_LOOPBACK ja inclui/exclui a arvore inteira a partir desse PID.
  for (const auto& p : procs) {
    if (discordPids.count(p.pid) && !discordPids.count(p.ppid)) {
      return p.pid;
    }
  }
  // Nao achamos uma raiz clara (ex: todos os pais ja sairam da lista) --
  // qualquer um da arvore serve como alvo razoavel.
  return *discordPids.begin();
}

DWORD PidForWindowHandle(long long hwndValue) {
  HWND hwnd = reinterpret_cast<HWND>(static_cast<INT_PTR>(hwndValue));
  if (!IsWindow(hwnd)) return 0;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return pid;
}

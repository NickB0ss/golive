#include "gpu_priority.h"

namespace {

// Assinaturas do gdi32.dll (d3dkmthk.h). O enum vai como int: mesmo tamanho
// e mesma convencao de chamada.
typedef LONG(APIENTRY* SetSchedulingPriorityFn)(HANDLE, int);
typedef LONG(APIENTRY* GetSchedulingPriorityFn)(HANDLE, int*);

struct D3dkmt {
  SetSchedulingPriorityFn set = nullptr;
  GetSchedulingPriorityFn get = nullptr;
};

const D3dkmt& Funcoes() {
  static const D3dkmt funcoes = [] {
    D3dkmt f;
    HMODULE gdi = GetModuleHandleW(L"gdi32.dll");
    if (!gdi) gdi = LoadLibraryW(L"gdi32.dll");
    if (!gdi) return f;
    f.set = reinterpret_cast<SetSchedulingPriorityFn>(
        GetProcAddress(gdi, "D3DKMTSetProcessSchedulingPriorityClass"));
    f.get = reinterpret_cast<GetSchedulingPriorityFn>(
        GetProcAddress(gdi, "D3DKMTGetProcessSchedulingPriorityClass"));
    return f;
  }();
  return funcoes;
}

}  // namespace

GpuPriorityResult SetProcessGpuPriority(DWORD pid, int gpuClass, DWORD cpuClass) {
  GpuPriorityResult r;
  const D3dkmt& f = Funcoes();
  if (!f.set) return r;  // status -1: indisponivel

  const bool proprio = pid == 0 || pid == GetCurrentProcessId();
  HANDLE processo = GetCurrentProcess();
  if (!proprio) {
    // PROCESS_SET_INFORMATION serve ao SetPriorityClass e ao D3DKMT;
    // QUERY_LIMITED, a leitura de volta. Sao processos filhos do proprio
    // GoLive, mesmo usuario.
    processo = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!processo) {
      r.status = -2;
      r.win32Error = GetLastError();
      return r;
    }
  }

  r.status = f.set(processo, gpuClass);

  if (cpuClass != 0) {
    if (SetPriorityClass(processo, cpuClass)) {
      r.cpuApplied = true;
    } else if (r.win32Error == 0) {
      r.win32Error = GetLastError();
    }
  }

  if (f.get) {
    int lida = -1;
    if (f.get(processo, &lida) == 0) r.readBack = lida;
  }

  if (!proprio) CloseHandle(processo);
  return r;
}

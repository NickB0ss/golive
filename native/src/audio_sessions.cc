#include "audio_sessions.h"

#include <objbase.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>

#include <algorithm>

#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

std::vector<DWORD> ListAudioRenderPids() {
  std::vector<DWORD> pids;

  // Chamado a partir do processo principal do Electron, que normalmente ja
  // tem COM inicializado em STA (dialogos nativos, etc). Se
  // CoInitializeEx devolver RPC_E_CHANGED_MODE, a thread ja esta num
  // apartment (de qualquer tipo) e podemos so seguir usando ele -- so
  // chamamos CoUninitialize no fim se essa chamada de fato criou/incrementou
  // o apartment (S_OK ou S_FALSE).
  HRESULT hrInit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  bool needsUninit = SUCCEEDED(hrInit);

  ComPtr<IMMDeviceEnumerator> enumerator;
  HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
  if (SUCCEEDED(hr)) {
    ComPtr<IMMDevice> device;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    if (SUCCEEDED(hr)) {
      ComPtr<IAudioSessionManager2> sessionManager;
      hr = device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, &sessionManager);
      if (SUCCEEDED(hr)) {
        ComPtr<IAudioSessionEnumerator> sessionEnum;
        hr = sessionManager->GetSessionEnumerator(&sessionEnum);
        if (SUCCEEDED(hr)) {
          int count = 0;
          sessionEnum->GetCount(&count);
          for (int i = 0; i < count; i++) {
            ComPtr<IAudioSessionControl> control;
            if (FAILED(sessionEnum->GetSession(i, &control)) || !control) continue;
            ComPtr<IAudioSessionControl2> control2;
            if (FAILED(control.As(&control2)) || !control2) continue;
            // Sessao de sons de sistema do proprio Windows (nao ligada a um
            // processo especifico do usuario) -- nao entra na lista.
            if (control2->IsSystemSoundsSession() == S_OK) continue;
            AudioSessionState state = AudioSessionStateInactive;
            // So sessoes ATIVAS (tocando som agora); uma sessao "Inactive"
            // existe mas nao esta produzindo audio nesse instante.
            if (FAILED(control2->GetState(&state)) || state != AudioSessionStateActive) continue;
            DWORD pid = 0;
            if (FAILED(control2->GetProcessId(&pid)) || pid == 0) continue;
            pids.push_back(pid);
          }
        }
      }
    }
  }

  if (needsUninit) CoUninitialize();

  std::sort(pids.begin(), pids.end());
  pids.erase(std::unique(pids.begin(), pids.end()), pids.end());
  return pids;
}

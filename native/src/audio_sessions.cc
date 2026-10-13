#include "audio_sessions.h"

#include <objbase.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>

#include <algorithm>
#include <stdexcept>
#include <string>

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
  if (FAILED(hrInit) && hrInit != RPC_E_CHANGED_MODE) {
    throw std::runtime_error("CoInitializeEx falhou: " + std::to_string(hrInit));
  }

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
          hr = sessionEnum->GetCount(&count);
          for (int i = 0; SUCCEEDED(hr) && i < count; i++) {
            ComPtr<IAudioSessionControl> control;
            hr = sessionEnum->GetSession(i, &control);
            if (FAILED(hr)) break;
            ComPtr<IAudioSessionControl2> control2;
            hr = control.As(&control2);
            if (FAILED(hr)) break;
            // Sessao de sons de sistema do proprio Windows (nao ligada a um
            // processo especifico do usuario) -- nao entra na lista.
            hr = control2->IsSystemSoundsSession();
            if (FAILED(hr)) break;
            if (hr == S_OK) continue;
            AudioSessionState state = AudioSessionStateInactive;
            // So sessoes ATIVAS (tocando som agora); uma sessao "Inactive"
            // existe mas nao esta produzindo audio nesse instante.
            hr = control2->GetState(&state);
            if (FAILED(hr)) break;
            if (state != AudioSessionStateActive) continue;
            DWORD pid = 0;
            hr = control2->GetProcessId(&pid);
            if (FAILED(hr)) break;
            if (pid == 0) continue;
            pids.push_back(pid);
          }
        }
      }
    }
  }

  if (needsUninit) CoUninitialize();
  if (FAILED(hr)) throw std::runtime_error("Enumeracao WASAPI falhou: " + std::to_string(hr));

  std::sort(pids.begin(), pids.end());
  pids.erase(std::unique(pids.begin(), pids.end()), pids.end());
  return pids;
}

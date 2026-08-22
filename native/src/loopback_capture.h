#pragma once

#include <napi.h>
#include <windows.h>
#include <audioclient.h>

#include <atomic>
#include <string>
#include <thread>

#include <wrl/client.h>

// Captura, via WASAPI Process Loopback (Windows 10 2004+ / build 19041+), o
// audio renderizado por um processo especifico (e sua arvore de filhos), ou
// o audio do sistema inteiro EXCLUINDO esse processo. Ver
// AUDIOCLIENT_ACTIVATION_PARAMS::ProcessLoopbackMode.
//
// Toda a ativacao COM e o loop de captura rodam numa thread dedicada, nunca
// na thread principal do Electron -- o processo principal costuma ja ter COM
// inicializado em modo STA (por causa de dialogos nativos), e
// CoInitializeEx(MTA) na mesma thread quebraria com RPC_E_CHANGED_MODE.
class LoopbackCapture : public Napi::ObjectWrap<LoopbackCapture> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  explicit LoopbackCapture(const Napi::CallbackInfo& info);
  ~LoopbackCapture() override;

 private:
  Napi::Value Stop(const Napi::CallbackInfo& info);

  void CaptureThreadMain();

  DWORD targetPid_ = 0;
  bool exclude_ = false;

  std::thread thread_;
  std::atomic<bool> running_{false};
  // true so depois que a captura de fato comecou (client_->Start() ok) --
  // evita Stop() chamar client_->Stop() num client que nunca chegou a rodar.
  std::atomic<bool> started_{false};

  Napi::ThreadSafeFunction tsfnData_;
  Napi::ThreadSafeFunction tsfnReady_;
};

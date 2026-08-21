#include "loopback_capture.h"

#include <objbase.h>
#include <objidl.h>
#include <mmdeviceapi.h>
#include <audioclientactivationparams.h>

#include <algorithm>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {

// Pacote de amostras entregue pra JS a cada GetBuffer/ReleaseBuffer da
// thread de captura. Alocado com `new` na thread nativa, desalocado no
// callback que roda na thread JS (ver DeliverAudioChunk).
struct AudioChunk {
  std::vector<float> samples;  // intercalado (LRLRLR...), ja em float32
  UINT32 channels;
  UINT32 sampleRate;
};

void DeliverAudioChunk(Napi::Env env, Napi::Function jsCallback, AudioChunk* chunk) {
  if (env != nullptr && jsCallback != nullptr) {
    Napi::Float32Array arr = Napi::Float32Array::New(env, chunk->samples.size());
    if (!chunk->samples.empty()) {
      memcpy(arr.Data(), chunk->samples.data(), chunk->samples.size() * sizeof(float));
    }
    jsCallback.Call({arr, Napi::Number::New(env, chunk->channels), Napi::Number::New(env, chunk->sampleRate)});
  }
  delete chunk;
}

// Resultado da tentativa de ativar+iniciar a captura, entregue de volta pra
// JS uma unica vez (sucesso ou erro) via tsfnReady_.
struct ReadyResult {
  bool ok;
  std::string message;
};

void DeliverReady(Napi::Env env, Napi::Function jsCallback, ReadyResult* result) {
  if (env != nullptr && jsCallback != nullptr) {
    jsCallback.Call({Napi::Boolean::New(env, result->ok), Napi::String::New(env, result->message)});
  }
  delete result;
}

// Implementacao minima de IActivateAudioInterfaceCompletionHandler --
// so guarda o resultado e sinaliza um evento; toda a logica de verdade
// continua na thread que chamou ActivateAudioInterfaceAsync (ela que espera
// nesse evento).
//
// Tambem implementa IAgileObject (interface marcadora, sem metodos): sem
// isso, ActivateAudioInterfaceAsync devolve E_ILLEGAL_METHOD_CALL na hora,
// porque ela entrega o callback numa thread do pool da MTA e exige que o
// objeto seja "free-threaded" (dispensa marshaling entre apartments) --
// nao basta ele ja estar rodando dentro de uma thread MTA.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  ActivationHandler() { event_ = CreateEventW(nullptr, TRUE, FALSE, nullptr); }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount_); }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG r = InterlockedDecrement(&refCount_);
    if (r == 0) delete this;
    return r;
  }

  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hrActivate = E_FAIL;
    IUnknown* iface = nullptr;
    HRESULT hr = op->GetActivateResult(&hrActivate, &iface);
    result_ = SUCCEEDED(hr) ? hrActivate : hr;
    if (SUCCEEDED(result_) && iface) {
      iface->QueryInterface(IID_PPV_ARGS(&client_));
    }
    if (iface) iface->Release();
    SetEvent(event_);
    return S_OK;
  }

  HANDLE event_ = nullptr;
  HRESULT result_ = E_FAIL;
  ComPtr<IAudioClient> client_;

 private:
  ~ActivationHandler() {
    if (event_) CloseHandle(event_);
  }
  LONG refCount_ = 1;
};

std::string HResultToMessage(HRESULT hr) {
  char buf[32];
  snprintf(buf, sizeof(buf), "HRESULT 0x%08lX", static_cast<unsigned long>(hr));
  return std::string(buf);
}

}  // namespace

Napi::Object LoopbackCapture::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "LoopbackCapture", {InstanceMethod("stop", &LoopbackCapture::Stop)});
  exports.Set("LoopbackCapture", func);
  return exports;
}

LoopbackCapture::LoopbackCapture(const Napi::CallbackInfo& info) : Napi::ObjectWrap<LoopbackCapture>(info) {
  Napi::Env env = info.Env();
  // (pid: number, exclude: boolean, onData: fn, onReady: fn)
  if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsBoolean() || !info[2].IsFunction() ||
      !info[3].IsFunction()) {
    Napi::TypeError::New(env, "esperado (pid, exclude, onData, onReady)").ThrowAsJavaScriptException();
    return;
  }

  targetPid_ = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
  exclude_ = info[1].As<Napi::Boolean>().Value();

  tsfnData_ = Napi::ThreadSafeFunction::New(env, info[2].As<Napi::Function>(), "LoopbackCaptureData", 0, 1);
  tsfnReady_ = Napi::ThreadSafeFunction::New(env, info[3].As<Napi::Function>(), "LoopbackCaptureReady", 0, 1);

  running_.store(true);
  thread_ = std::thread(&LoopbackCapture::CaptureThreadMain, this);
}

LoopbackCapture::~LoopbackCapture() {
  running_.store(false);
  if (thread_.joinable()) thread_.join();
}

Napi::Value LoopbackCapture::Stop(const Napi::CallbackInfo& info) {
  running_.store(false);
  if (thread_.joinable()) thread_.join();
  return info.Env().Undefined();
}

void LoopbackCapture::CaptureThreadMain() {
  HRESULT hrInit = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool comOwned = hrInit == S_OK || hrInit == S_FALSE;

  auto reportReady = [this](bool ok, const std::string& message) {
    tsfnReady_.BlockingCall(new ReadyResult{ok, message}, DeliverReady);
    tsfnReady_.Release();
  };

  // ActivationHandler comeca com refCount_ = 1 -- essa e a referencia que
  // esta funcao possui e precisa soltar (Release) exatamente uma vez em
  // todo caminho de saida. ActivateAudioInterfaceAsync faz seu proprio
  // AddRef/Release interno enquanto guarda o ponteiro pra chamar
  // ActivateCompleted mais tarde.
  ActivationHandler* handler = new ActivationHandler();

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = targetPid_;
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      exclude_ ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activateParams;
  PropVariantInit(&activateParams);
  activateParams.vt = VT_BLOB;
  activateParams.blob.cbSize = sizeof(params);
  activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
                                            &activateParams, handler, &asyncOp);
  if (FAILED(hr)) {
    handler->Release();
    reportReady(false, "ActivateAudioInterfaceAsync falhou: " + HResultToMessage(hr));
    running_.store(false);
    tsfnData_.Release();
    if (comOwned) CoUninitialize();
    return;
  }

  // Ativacao costuma resolver em poucos ms; 5s cobre uma maquina sob carga
  // pesada sem deixar a UI travada indefinidamente se algo travar na COM.
  DWORD waitResult = WaitForSingleObject(handler->event_, 5000);
  if (waitResult != WAIT_OBJECT_0 || FAILED(handler->result_) || !handler->client_) {
    std::string message = waitResult != WAIT_OBJECT_0 ? "tempo esgotado esperando ativacao"
                                                        : "ativacao falhou: " + HResultToMessage(handler->result_);
    handler->Release();
    reportReady(false, message);
    running_.store(false);
    tsfnData_.Release();
    if (comOwned) CoUninitialize();
    return;
  }

  ComPtr<IAudioClient> client = handler->client_;
  handler->Release();

  WAVEFORMATEX wfx = {};
  wfx.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
  wfx.nChannels = 2;
  wfx.nSamplesPerSec = 48000;
  wfx.wBitsPerSample = 32;
  wfx.nBlockAlign = static_cast<WORD>(wfx.nChannels * wfx.wBitsPerSample / 8);
  wfx.nAvgBytesPerSec = wfx.nSamplesPerSec * wfx.nBlockAlign;
  wfx.cbSize = 0;

  // 200ms de buffer -- generoso o bastante pra nao estourar mesmo se a
  // thread JS atrasar por um instante, sem segurar audio demais.
  const REFERENCE_TIME bufferDuration = 200 * 10000;  // 100ns units
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, bufferDuration, 0, &wfx, nullptr);
  if (FAILED(hr)) {
    reportReady(false, "IAudioClient::Initialize falhou: " + HResultToMessage(hr));
    running_.store(false);
    tsfnData_.Release();
    if (comOwned) CoUninitialize();
    return;
  }

  ComPtr<IAudioCaptureClient> captureClient;
  hr = client->GetService(IID_PPV_ARGS(&captureClient));
  if (FAILED(hr)) {
    reportReady(false, "GetService(IAudioCaptureClient) falhou: " + HResultToMessage(hr));
    running_.store(false);
    tsfnData_.Release();
    if (comOwned) CoUninitialize();
    return;
  }

  hr = client->Start();
  if (FAILED(hr)) {
    reportReady(false, "IAudioClient::Start falhou: " + HResultToMessage(hr));
    running_.store(false);
    tsfnData_.Release();
    if (comOwned) CoUninitialize();
    return;
  }

  started_.store(true);
  reportReady(true, "");

  const UINT32 channels = wfx.nChannels;
  const UINT32 sampleRate = wfx.nSamplesPerSec;

  while (running_.load()) {
    UINT32 packetLength = 0;
    if (FAILED(captureClient->GetNextPacketSize(&packetLength))) break;
    if (packetLength == 0) {
      Sleep(5);
      continue;
    }

    while (packetLength != 0) {
      BYTE* data = nullptr;
      UINT32 numFrames = 0;
      DWORD flags = 0;
      hr = captureClient->GetBuffer(&data, &numFrames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        running_.store(false);
        break;
      }

      auto* chunk = new AudioChunk();
      chunk->channels = channels;
      chunk->sampleRate = sampleRate;
      size_t sampleCount = static_cast<size_t>(numFrames) * channels;
      chunk->samples.resize(sampleCount);
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        std::fill(chunk->samples.begin(), chunk->samples.end(), 0.0f);
      } else if (sampleCount > 0) {
        memcpy(chunk->samples.data(), data, sampleCount * sizeof(float));
      }
      captureClient->ReleaseBuffer(numFrames);

      tsfnData_.NonBlockingCall(chunk, DeliverAudioChunk);

      if (FAILED(captureClient->GetNextPacketSize(&packetLength))) {
        packetLength = 0;
        running_.store(false);
      }
    }
  }

  client->Stop();
  tsfnData_.Release();
  if (comOwned) CoUninitialize();
}

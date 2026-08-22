#include <napi.h>
#include <windows.h>

#include <string>

#include "loopback_capture.h"
#include "process_util.h"

namespace {

Napi::Value FindDiscordRootPidBinding(const Napi::CallbackInfo& info) {
  DWORD pid = ::FindDiscordRootPid();
  return Napi::Number::New(info.Env(), pid);
}

Napi::Value PidForWindowHandleBinding(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "esperado (hwndValue: number)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  long long hwndValue = info[0].As<Napi::Number>().Int64Value();
  DWORD pid = ::PidForWindowHandle(hwndValue);
  return Napi::Number::New(env, pid);
}

Napi::Value ListProcessNames(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto procs = ListProcesses();
  Napi::Array out = Napi::Array::New(env, procs.size());
  for (size_t i = 0; i < procs.size(); i++) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("pid", Napi::Number::New(env, procs[i].pid));
    item.Set("ppid", Napi::Number::New(env, procs[i].ppid));
    // szExeFile e ASCII/ANSI de sistema na pratica (nomes de executavel),
    // mas ta declarado wchar_t -- convertemos com WideCharToMultiByte pra
    // nao perder acentos em nomes exoticos.
    const std::wstring& wname = procs[i].name;
    int len = WideCharToMultiByte(CP_UTF8, 0, wname.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string name(len > 0 ? len - 1 : 0, '\0');
    if (len > 0) WideCharToMultiByte(CP_UTF8, 0, wname.c_str(), -1, name.data(), len, nullptr, nullptr);
    item.Set("name", Napi::String::New(env, name));
    out[i] = item;
  }
  return out;
}

}  // namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  exports.Set("findDiscordRootPid", Napi::Function::New(env, FindDiscordRootPidBinding));
  exports.Set("pidForWindowHandle", Napi::Function::New(env, PidForWindowHandleBinding));
  exports.Set("listProcessNames", Napi::Function::New(env, ListProcessNames));
  return LoopbackCapture::Init(env, exports);
}

NODE_API_MODULE(golive_audio, InitAll)

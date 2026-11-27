#include "metricas.h"

#include <cstdio>
#include <mutex>

namespace {

std::mutex g_saida;

std::string NumOuNulo(double v) {
  if (v < 0) return "null";
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.1f", v);
  return buf;
}

}  // namespace

std::string FormatarLinha(int t, const Metricas& m) {
  std::string s = "{\"t\":" + std::to_string(t);
  s += ",\"fps_alvo\":" + std::to_string(m.fpsAlvo);
  s += ",\"kbps_alvo\":" + std::to_string(m.kbpsAlvo.load());
  s += ",\"captura\":" + NumOuNulo(m.capturaFps);
  s += ",\"encode\":" + NumOuNulo(m.encodeFps);
  s += "}";
  return s;
}

void EscreverLinha(const std::string& linha) {
  std::lock_guard<std::mutex> lock(g_saida);
  std::fwrite(linha.data(), 1, linha.size(), stdout);
  std::fputc('\n', stdout);
  std::fflush(stdout);
}

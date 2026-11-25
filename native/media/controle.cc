#include "controle.h"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <iostream>

namespace {

constexpr int kKbpsMin = 100, kKbpsMax = 200000;  // mesmos limites de --kbps
constexpr size_t kLinhaMax = 4096;                // linha maior que isso e lixo

struct Leitor {
  const std::string& s;
  size_t i = 0;
  void Espaco() {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r')) ++i;
  }
  bool Consome(char c) {
    Espaco();
    if (i < s.size() && s[i] == c) {
      ++i;
      return true;
    }
    return false;
  }
};

// String JSON simples. Escapes \" \\ \/ \n \t \r \b \f; \uXXXX nao e aceito
// (nenhum comando legitimo precisa).
bool LerString(Leitor& l, std::string* out) {
  if (!l.Consome('"')) return false;
  out->clear();
  while (l.i < l.s.size()) {
    const char c = l.s[l.i++];
    if (c == '"') return true;
    if (c != '\\') {
      out->push_back(c);
      continue;
    }
    if (l.i >= l.s.size()) return false;
    const char e = l.s[l.i++];
    switch (e) {
      case '"': case '\\': case '/': out->push_back(e); break;
      case 'n': out->push_back('\n'); break;
      case 't': out->push_back('\t'); break;
      case 'r': out->push_back('\r'); break;
      case 'b': out->push_back('\b'); break;
      case 'f': out->push_back('\f'); break;
      default: return false;
    }
  }
  return false;  // sem aspa de fechamento
}

// Numero: aceita "6000", "6000.0" ou "6e3", desde que o resultado seja inteiro exato.
bool LerNumero(Leitor& l, long long* out) {
  l.Espaco();
  const char* ini = l.s.c_str() + l.i;
  char* fim = nullptr;
  errno = 0;
  const double d = std::strtod(ini, &fim);
  if (fim == ini || errno != 0) return false;
  if (d < -1e12 || d > 1e12 || d != static_cast<double>(static_cast<long long>(d))) return false;
  l.i += static_cast<size_t>(fim - ini);
  *out = static_cast<long long>(d);
  return true;
}

// Pula o valor de uma chave desconhecida: string ou literal/numero simples.
bool PularValor(Leitor& l) {
  l.Espaco();
  if (l.i >= l.s.size()) return false;
  if (l.s[l.i] == '"') {
    std::string tmp;
    return LerString(l, &tmp);
  }
  if (l.s[l.i] == '{' || l.s[l.i] == '[') return false;  // aninhado nao e suportado
  const size_t ini = l.i;
  while (l.i < l.s.size() && l.s[l.i] != ',' && l.s[l.i] != '}') ++l.i;
  return l.i > ini;
}

Comando Invalido(const std::string& motivo) {
  Comando c;
  c.erro = motivo;
  return c;
}

}  // namespace

Comando InterpretarLinha(const std::string& linha) {
  if (linha.size() > kLinhaMax) return Invalido("linha grande demais");
  Leitor l{linha};
  if (!l.Consome('{')) return Invalido("JSON malformado: esperava '{'");

  std::string cmd;
  bool temCmd = false, temValor = false;
  long long valor = 0;

  if (!l.Consome('}')) {
    for (;;) {
      std::string chave;
      if (!LerString(l, &chave)) return Invalido("JSON malformado: chave invalida");
      if (!l.Consome(':')) return Invalido("JSON malformado: esperava ':'");
      if (chave == "cmd") {
        if (!LerString(l, &cmd)) return Invalido("\"cmd\" precisa ser texto");
        temCmd = true;
      } else if (chave == "valor") {
        if (!LerNumero(l, &valor)) return Invalido("\"valor\" precisa ser um numero inteiro");
        temValor = true;
      } else if (!PularValor(l)) {
        return Invalido("JSON malformado: valor invalido em \"" + chave + "\"");
      }
      if (l.Consome(',')) continue;
      if (l.Consome('}')) break;
      return Invalido("JSON malformado: esperava ',' ou '}'");
    }
  }
  l.Espaco();
  if (l.i != linha.size()) return Invalido("JSON malformado: sobrou texto depois do objeto");
  if (!temCmd) return Invalido("faltou \"cmd\"");

  Comando c;
  if (cmd == "keyframe") {
    c.tipo = TipoComando::kKeyframe;
  } else if (cmd == "parar") {
    c.tipo = TipoComando::kParar;
  } else if (cmd == "kbps") {
    if (!temValor) return Invalido("\"kbps\" exige \"valor\"");
    if (valor < kKbpsMin || valor > kKbpsMax) return Invalido("\"valor\" fora de 100..200000");
    c.tipo = TipoComando::kKbps;
    c.valor = valor;
  } else {
    return Invalido("comando desconhecido: " + cmd);
  }
  return c;
}

bool Aplicar(const Comando& c, Controle* ctl) {
  switch (c.tipo) {
    case TipoComando::kKeyframe:
      ctl->keyframePedido = true;
      return true;
    case TipoComando::kKbps:
      if (ctl->kbps) *ctl->kbps = static_cast<int>(c.valor);
      return true;
    case TipoComando::kParar:
      ctl->parar = true;
      return true;
    case TipoComando::kInvalido:
      break;
  }
  return false;
}

void LacoStdin(Controle* ctl) {
  std::string linha;
  while (!ctl->parar && std::getline(std::cin, linha)) {
    if (linha.empty() || linha == "\r") continue;
    const Comando c = InterpretarLinha(linha);
    if (!Aplicar(c, ctl)) std::fprintf(stderr, "golive-media: comando ignorado (%s)\n", c.erro.c_str());
  }
  ctl->parar = true;  // EOF ou parar
}

// `golive-media --gerar-vetores`: imprime, uma linha JSON por item, o que o teste cruzado do JS
// (src/main/videonativo/cruzado.test.js) le:
//   {"constantes":{...}}            as da spec, com os nomes de protocolo.h
//   {"cripto":{...}}                autoteste do SHA-256/HMAC proprio (FIPS 180-4 e RFC 4231)
//   {"sha256":[...],"hmac":[...]}   resumos de mensagens de 0 a 200 bytes (o JS confere com o Node)
//   {"vetor":"V1","hex":...}        V1-V4 da secao 12 da spec, montados a partir dos campos
//   {"cenario":{...}}               sessao, chave e fecN do cenario fixo, e depois
//   {"quadro":...,"datagramas":[]}  um por quadro do cenario, os datagramas em ordem de envio
//   {"limite":{...}}                6.2: o maior quadro aceito e o primeiro recusado
// Sai com 0, ou 1 se o autoteste de cripto falhar.

#include "pacote_vetores.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "pacote.h"
#include "protocolo.h"
#include "sha256.h"

using namespace protocolo;

namespace {

using Bytes = std::vector<std::uint8_t>;

std::string Hex(const std::uint8_t* p, std::size_t n) {
  static const char* d = "0123456789abcdef";
  std::string s(2 * n, '0');
  for (std::size_t i = 0; i < n; ++i) {
    s[2 * i] = d[p[i] >> 4];
    s[2 * i + 1] = d[p[i] & 15];
  }
  return s;
}

std::string Hex(const Bytes& b) { return Hex(b.data(), b.size()); }

Bytes DeTexto(const char* s) { return Bytes(s, s + std::strlen(s)); }

void Linha(const std::string& s) {
  std::fwrite(s.data(), 1, s.size(), stdout);
  std::fputc('\n', stdout);
}

// Chave de exemplo da secao 12: 00 01 ... 1f.
Bytes ChaveExemplo() {
  Bytes k(TAM_CHAVE);
  for (std::size_t i = 0; i < k.size(); ++i) k[i] = static_cast<std::uint8_t>(i);
  return k;
}

// Conteudo deterministico de um quadro do cenario (o JS gera igual): LCG de 32 bits, byte alto.
Bytes ConteudoQuadro(std::uint32_t quadro, std::size_t tam) {
  Bytes b(tam);
  std::uint32_t x = quadro * 2654435761u;
  for (auto& c : b) {
    x = x * 1664525u + 1013904223u;
    c = static_cast<std::uint8_t>(x >> 24);
  }
  return b;
}

Bytes Selar(SessaoEnvio* s, const PacoteAberto& p, std::uint32_t tempo) {
  Bytes out(TAM_MAX_DATAGRAMA);
  out.resize(s->Selar(p, tempo, out.data()));
  return out;
}

PacoteAberto Aberto(std::uint8_t tipo, std::uint8_t flags, Bytes payload) {
  PacoteAberto p;
  p.tipo = tipo;
  p.flags = flags;
  p.payload = std::move(payload);
  return p;
}

// --- autoteste de cripto ---

struct CasoHmac {
  Bytes chave;
  Bytes dados;
  const char* esperado;  // hex; mais curto que 64 = truncado (RFC 4231, caso 5)
};

std::string Autoteste(int* casos, bool* ok) {
  std::vector<std::string> falhas;
  auto confere = [&](const std::string& nome, const std::string& obtido, const char* esperado) {
    ++*casos;
    if (obtido.compare(0, std::strlen(esperado), esperado) != 0) falhas.push_back(nome);
  };
  // FIPS 180-4 (exemplos do NIST) e a mensagem vazia.
  const struct {
    const char* msg;
    const char* esperado;
  } sha[] = {
      {"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},
      {"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"},
      {"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"},
      {"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn"
       "hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
       "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1"},
  };
  for (const auto& c : sha) {
    const Bytes m = DeTexto(c.msg);
    const auto r = CalcularSha256(m.data(), m.size());
    confere(std::string("sha256 \"") + c.msg + "\"", Hex(r.data(), r.size()), c.esperado);
  }
  {
    // Um milhao de 'a', em pedacos de tamanho irregular (exercita o buffer parcial).
    Sha256 s;
    const Bytes bloco(997, 'a');
    std::size_t falta = 1000000;
    while (falta > 0) {
      const std::size_t n = falta < bloco.size() ? falta : bloco.size();
      s.Atualizar(bloco.data(), n);
      falta -= n;
    }
    const auto r = s.Finalizar();
    confere("sha256 1e6 x 'a'", Hex(r.data(), r.size()),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  }
  // RFC 4231, casos 1 a 7.
  Bytes k4(25);
  for (std::size_t i = 0; i < k4.size(); ++i) k4[i] = static_cast<std::uint8_t>(i + 1);
  const std::vector<CasoHmac> hm = {
      {Bytes(20, 0x0b), DeTexto("Hi There"), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"},
      {DeTexto("Jefe"), DeTexto("what do ya want for nothing?"),
       "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"},
      {Bytes(20, 0xaa), Bytes(50, 0xdd), "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"},
      {k4, Bytes(50, 0xcd), "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"},
      {Bytes(20, 0x0c), DeTexto("Test With Truncation"), "a3b6167473100ee06e0c796c2955552b"},
      {Bytes(131, 0xaa), DeTexto("Test Using Larger Than Block-Size Key - Hash Key First"),
       "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"},
      {Bytes(131, 0xaa),
       DeTexto("This is a test using a larger than block-size key and a larger than block-size data. The key needs "
               "to be hashed before being used by the HMAC algorithm."),
       "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"},
  };
  for (std::size_t i = 0; i < hm.size(); ++i) {
    const HmacSha256 h(hm[i].chave.data(), hm[i].chave.size());
    const auto r = h.Calcular(hm[i].dados.data(), hm[i].dados.size());
    confere("rfc4231 caso " + std::to_string(i + 1), Hex(r.data(), r.size()), hm[i].esperado);
  }
  // Comparacao em tempo constante: igual, e diferente so no ultimo byte.
  const std::uint8_t a[4] = {1, 2, 3, 4}, b[4] = {1, 2, 3, 5};
  ++*casos;
  if (!IguaisTempoConstante(a, a, 4) || IguaisTempoConstante(a, b, 4)) falhas.push_back("tempo constante");

  *ok = falhas.empty();
  std::string lista;
  for (const auto& f : falhas) lista += (lista.empty() ? "\"" : ",\"") + f + "\"";
  return "[" + lista + "]";
}

// --- V1 a V4 (secao 12) ---

void Vetores(const Bytes& chave) {
  // V1: VIDEO, keyframe de um fragmento.
  {
    SessaoEnvio s(0x12345678, chave.data(), 1);
    const Bytes payload = {0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00};
    std::vector<PacoteAberto> ps;
    FragmentarQuadro(payload.data(), payload.size(), 1, true, 0, &ps);
    const Bytes d = Selar(&s, ps.at(0), 1000000);
    const auto inteiro = HmacSha256(chave.data(), chave.size()).Calcular(d.data(), d.size() - TAM_HMAC);
    Linha("{\"vetor\":\"V1\",\"hex\":\"" + Hex(d) + "\",\"hmac32\":\"" + Hex(inteiro.data(), inteiro.size()) + "\"}");
  }
  // V2: NACK do quadro 2, fragmentos 3 e 4.
  {
    SessaoEnvio s(0x12345678, chave.data(), 7);
    const Bytes d = Selar(&s, Aberto(TIPO_NACK, FLAG_VOLTA, PayloadNack({{2, 3, 2}})), 2000000);
    Linha("{\"vetor\":\"V2\",\"hex\":\"" + Hex(d) + "\"}");
  }
  // V3: RELATORIO.
  {
    Relatorio r;
    r.intervaloUs = 200000;
    r.esperados = 240;
    r.recebidos = 235;
    r.kbps = 9850;
    r.atrasoMedioUs = 1500;
    r.atrasoMaxUs = 4200;
    r.maiorSeq = 1200;
    r.ecoTempo = 0x001E8000;
    r.ecoEsperaUs = 350;
    r.quadrosCompletos = 12;
    r.quadrosVencidos = 0;
    r.recuperadosFec = 3;
    r.nacks = 2;
    SessaoEnvio s(0x12345678, chave.data(), 8);
    const Bytes d = Selar(&s, Aberto(TIPO_RELATORIO, FLAG_VOLTA, PayloadRelatorio(r)), 2000100);
    Linha("{\"vetor\":\"V3\",\"hex\":\"" + Hex(d) + "\"}");
  }
  // V4: o FEC do quadro 5 (n = 2, N = 10). Os dois VIDEO gastam as sequencias 14 e 15; o FEC sai com 16.
  {
    Bytes q(1152 + 5);
    for (std::size_t j = 0; j < 1152; ++j) q[j] = static_cast<std::uint8_t>(j & 0xFF);
    const std::uint8_t fim[5] = {0xaa, 0xbb, 0xcc, 0xdd, 0xee};
    std::memcpy(q.data() + 1152, fim, 5);
    std::vector<PacoteAberto> ps;
    FragmentarQuadro(q.data(), q.size(), 5, false, FEC_N_PADRAO, &ps);
    SessaoEnvio s(0x12345678, chave.data(), 14);
    Bytes d;
    for (const auto& p : ps) d = Selar(&s, p, 3000000);
    const auto resumo = CalcularSha256(d.data(), d.size());
    Linha("{\"vetor\":\"V4\",\"tipo\":" + std::to_string(ps.back().tipo) + ",\"hex\":\"" + Hex(d) +
          "\",\"sha256\":\"" + Hex(resumo.data(), resumo.size()) + "\"}");
  }
}

// --- cenario fixo para remontar no JS ---

struct QuadroCenario {
  std::uint32_t numero;
  bool keyframe;
  std::size_t tamanho;
};

void Cenario() {
  Bytes chave(TAM_CHAVE);
  for (std::size_t i = 0; i < chave.size(); ++i) chave[i] = static_cast<std::uint8_t>(0x20 + i);
  const std::uint32_t sessao = 0x0A0B0C0D;
  Linha("{\"cenario\":{\"sessao\":" + std::to_string(sessao) + ",\"chave\":\"" + Hex(chave) +
        "\",\"fecN\":" + std::to_string(FEC_N_PADRAO) + "}}");
  // Numeros que nao comecam em 1 (4.6); tamanhos que pegam os cantos: 22 fragmentos e 3 grupos,
  // multiplo exato de 1152, 1 byte, e grupo final de k = 1 com L = 1.
  const QuadroCenario quadros[] = {
      {100, true, 25000}, {101, false, 3456}, {102, false, 1}, {103, false, 11521}, {104, true, 1152},
  };
  SessaoEnvio s(sessao, chave.data());
  for (const auto& q : quadros) {
    const Bytes dados = ConteudoQuadro(q.numero, q.tamanho);
    std::vector<PacoteAberto> ps;
    FragmentarQuadro(dados.data(), dados.size(), q.numero, q.keyframe, FEC_N_PADRAO, &ps);
    std::string lista;
    for (const auto& p : ps) {
      const std::uint32_t tempo = 5000000u + 100u * s.proximaSequencia();
      lista += (lista.empty() ? "\"" : ",\"") + Hex(Selar(&s, p, tempo)) + "\"";
    }
    const auto resumo = CalcularSha256(dados.data(), dados.size());
    Linha("{\"quadro\":" + std::to_string(q.numero) + ",\"keyframe\":" + (q.keyframe ? "true" : "false") +
          ",\"tamanho\":" + std::to_string(q.tamanho) + ",\"sha256\":\"" + Hex(resumo.data(), resumo.size()) +
          "\",\"datagramas\":[" + lista + "]}");
  }
}

void Limite() {
  const std::size_t maior = static_cast<std::size_t>(MAX_FRAGMENTOS) * TAM_FRAGMENTO;
  const Bytes q(maior + 1, 0x11);
  std::vector<PacoteAberto> ps;
  const bool aceita = FragmentarQuadro(q.data(), maior, 1, true, 0, &ps) == ResultadoFragmentar::kOk;
  const std::size_t n = ps.size();
  const bool recusa = FragmentarQuadro(q.data(), maior + 1, 1, true, 0, &ps) == ResultadoFragmentar::kGrandeDemais;
  Linha("{\"limite\":{\"maior\":" + std::to_string(maior) + ",\"aceita\":" + (aceita ? "true" : "false") +
        ",\"fragmentos\":" + std::to_string(n) + ",\"recusa_maior_mais_1\":" + (recusa ? "true" : "false") + "}}");
}

std::string Par(const char* nome, long long v) { return std::string("\"") + nome + "\":" + std::to_string(v); }

}  // namespace

int GerarVetores() {
  Linha("{\"constantes\":{" + Par("MAGIA", MAGIA) + "," + Par("VERSAO_PROTOCOLO", VERSAO_PROTOCOLO) + "," +
        Par("TAM_CABECALHO", TAM_CABECALHO) + "," + Par("TAM_HMAC", TAM_HMAC) + "," +
        Par("TAM_MAX_DATAGRAMA", TAM_MAX_DATAGRAMA) + "," + Par("TAM_MAX_PAYLOAD", TAM_MAX_PAYLOAD) + "," +
        Par("TAM_FRAGMENTO", TAM_FRAGMENTO) + "," + Par("MAX_FRAGMENTOS", MAX_FRAGMENTOS) + "," +
        Par("FEC_N_PADRAO", FEC_N_PADRAO) + "," + Par("FEC_N_MAX", FEC_N_MAX) + "," +
        Par("JANELA_REPLAY", JANELA_REPLAY) + "," + Par("ESPERA_NACK_MS", ESPERA_NACK_MS) + "," +
        Par("SUSPEITA_MS", SUSPEITA_MS) + "," + Par("VENCIMENTO_QUADRO_MS", VENCIMENTO_QUADRO_MS) + "," +
        Par("MAX_QUADROS_EM_MONTAGEM", MAX_QUADROS_EM_MONTAGEM) + "," + Par("BUFFER_REENVIO_MS", BUFFER_REENVIO_MS) +
        "," + Par("INTERVALO_RELATORIO_MS", INTERVALO_RELATORIO_MS) + "," +
        Par("INTERVALO_MIN_KEYFRAME_MS", INTERVALO_MIN_KEYFRAME_MS) + "," + Par("OLA_INICIAL_MS", OLA_INICIAL_MS) +
        "," + Par("OLA_MS", OLA_MS) + "," + Par("SILENCIO_MAX_MS", SILENCIO_MAX_MS) + "," +
        Par("TAM_MIN_DATAGRAMA", TAM_MIN_DATAGRAMA) + "," + Par("TAM_CHAVE", TAM_CHAVE) + "," +
        Par("SEQ_LIMITE", SEQ_LIMITE) + "," + Par("NACK_QUADRO_INTEIRO", NACK_QUADRO_INTEIRO) + "," +
        Par("NACK_MAX_ENTRADAS", NACK_MAX_ENTRADAS) + "},\"TIPO\":{" + Par("VIDEO", TIPO_VIDEO) + "," +
        Par("FEC", TIPO_FEC) + "," + Par("NACK", TIPO_NACK) + "," + Par("PEDIR_KEYFRAME", TIPO_PEDIR_KEYFRAME) + "," +
        Par("RELATORIO", TIPO_RELATORIO) + "," + Par("OLA", TIPO_OLA) + "," + Par("TCHAU", TIPO_TCHAU) +
        "},\"FLAG\":{" + Par("KEYFRAME", FLAG_KEYFRAME) + "," + Par("FIM_DE_QUADRO", FLAG_FIM_DE_QUADRO) + "," +
        Par("RETRANSMISSAO", FLAG_RETRANSMISSAO) + "," + Par("VOLTA", FLAG_VOLTA) + "}}");

  int casos = 0;
  bool ok = false;
  const std::string falhas = Autoteste(&casos, &ok);
  Linha(std::string("{\"cripto\":{\"ok\":") + (ok ? "true" : "false") + ",\"casos\":" + std::to_string(casos) +
        ",\"falhas\":" + falhas + "}}");

  // Mensagens de 0 a 200 bytes (pega as bordas do padding: 55, 56, 63, 64, 119, 120...).
  const Bytes chave = ChaveExemplo();
  const HmacSha256 h(chave.data(), chave.size());
  std::string sha, hm;
  for (std::size_t n = 0; n <= 200; ++n) {
    Bytes m(n);
    for (std::size_t i = 0; i < n; ++i) m[i] = static_cast<std::uint8_t>(i * 7 + 3);
    const auto a = CalcularSha256(m.data(), m.size());
    const auto b = h.Calcular(m.data(), m.size());
    sha += (n ? ",\"" : "\"") + Hex(a.data(), a.size()) + "\"";
    hm += (n ? ",\"" : "\"") + Hex(b.data(), b.size()) + "\"";
  }
  Linha("{\"sha256\":[" + sha + "],\"hmac\":[" + hm + "]}");

  Vetores(chave);
  Cenario();
  Limite();
  std::fflush(stdout);
  return ok ? 0 : 1;
}

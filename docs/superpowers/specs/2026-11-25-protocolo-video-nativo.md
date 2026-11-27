# Protocolo de vídeo nativo (UDP) — especificação

Data: 2026-11-25. Passo **P2.1** do plano
[`2026-11-25-pipeline-nativo.md`](../plans/2026-11-25-pipeline-nativo.md).
Decisões de base: [[D-06-transporte-udp-proprio|D-06]] (UDP próprio),
[[D-10-recepcao-udp-no-main|D-10]] (recepção no main),
[[D-13-formato-do-pacote-udp|D-13]] (formato do pacote, resume esta spec).

Este documento é o contrato entre o envio em C++ (Winsock, dentro do
`golive-media.exe`) e a recepção/repasse em JS (`src/main/videonativo/`).
Tudo o que está aqui é normativo, exceto o que está marcado como
**(sugestão)**. As palavras "deve" e "não deve" são obrigatórias; quem
implementa não precisa decidir nada que esteja escrito aqui.

## 1. Escopo e vocabulário

- **Emissor:** quem manda vídeo num salto. É o exe na origem, ou o main de
  um relay para os filhos dele.
- **Receptor:** quem recebe vídeo num salto. É o main de quem assiste, ou o
  main de um relay em relação à origem.
- **Sessão:** um salto, num sentido de vídeo: **um** emissor → **um**
  receptor, com chave própria. A origem com dois relays tem duas sessões; um
  relay com dois filhos tem mais duas. Uma sessão nunca é compartilhada entre
  receptores (seção 8.2 diz por quê).
- **Sentido de ida:** emissor → receptor (`VIDEO`, `FEC`, `OLA`, `TCHAU`).
  **Sentido de volta:** receptor → emissor (`NACK`, `PEDIR_KEYFRAME`,
  `RELATORIO`, `OLA`, `TCHAU`). Cada sentido de cada sessão tem a própria
  numeração de sequência e a própria janela de replay.
- **Quadro:** uma unidade de acesso H.264 em Annex B, como sai do encoder
  (no keyframe: SPS + PPS + IDR, ver P1.5).
- **Fragmento:** um pedaço contíguo de um quadro que cabe num pacote.

Só vídeo da **tela** na versão 1. Câmera e áudio continuam no WebRTC
([[D-08-audio-continua-no-webrtc|D-08]]).

## 2. Constantes

Os mesmos nomes devem existir no JS (`src/main/videonativo/protocolo.js`) e
no C++ (um header do exe). Os testes cruzados do P2.2 comparam os valores.

| Constante | Valor | Onde aparece |
|---|---|---|
| `MAGIA` | `0x47 0x4C` (`"GL"`) | bytes 0–1 de todo pacote |
| `VERSAO_PROTOCOLO` | `1` | byte 2; `nativo-oferta.protocolo`; métrica do exe |
| `TAM_CABECALHO` | 28 bytes | |
| `TAM_HMAC` | 16 bytes | fim de todo pacote |
| `TAM_MAX_DATAGRAMA` | 1200 bytes | payload UDP inteiro (cabeçalho + payload + HMAC) |
| `TAM_MAX_PAYLOAD` | 1156 bytes | 1200 − 28 − 16 |
| `TAM_FRAGMENTO` | 1152 bytes | payload de todo `VIDEO` que não é o último do quadro |
| `MAX_FRAGMENTOS` | 1024 | fragmentos por quadro |
| `FEC_N_PADRAO` | 10 | fragmentos por grupo de FEC |
| `FEC_N_MAX` | 32 | |
| `JANELA_REPLAY` | 1024 sequências | |
| `ESPERA_NACK_MS` | 5 | também o intervalo mínimo entre dois `NACK` da sessão |
| `SUSPEITA_MS` | 20 | seção 6.5 |
| `VENCIMENTO_QUADRO_MS` | 100 | |
| `MAX_QUADROS_EM_MONTAGEM` | 8 | |
| `BUFFER_REENVIO_MS` | 300 | emissor e relay |
| `INTERVALO_RELATORIO_MS` | 200 | |
| `INTERVALO_MIN_KEYFRAME_MS` | 500 | |
| `OLA_INICIAL_MS` / `OLA_MS` | 250 / 1000 | |
| `SILENCIO_MAX_MS` | 5000 | igual ao "nada em 5 s" de [[D-09-webrtc-continua-como-fallback\|D-09]] |

## 3. Tamanho do pacote

O datagrama (payload UDP) tem no máximo **1200 bytes**. Com os cabeçalhos de
fora: IPv4 + UDP = 1228 bytes, IPv6 + UDP = 1248 bytes. Os dois cabem no MTU
de 1280 do Tailscale (WireGuard) e no do Radmin VPN, sem fragmentação IP.
Fragmentação IP não é aceitável: perder um pedaço perde o datagrama todo, e
algumas VPNs descartam fragmentos.

Conta por pacote de vídeo:

```
1200  datagrama máximo
- 28  cabeçalho comum
- 16  HMAC
----
1156  payload máximo (é o que um FEC usa: 4 de cabeçalho + 1152)
1152  payload de um VIDEO cheio (TAM_FRAGMENTO) → datagrama de 1196 bytes
```

Eficiência de um `VIDEO` cheio: 1152 / 1196 = **96,3 %**. A 1080p60 com
12 Mbps (o preset atual de `config.js`): quadro médio de 25.000 bytes =
22 fragmentos; ~1.300 pacotes `VIDEO`/s, mais 3 `FEC` por quadro com N = 10
(~180/s), ≈ 1.480 pacotes/s no total.

Conferir no PC real **(sugestão, P2.9)**: `ping -f -l 1200 <ip-do-outro>` manda
pacotes IPv4 de 1228 bytes com "não fragmentar"; se falhar, o MTU da VPN é
menor do que o assumido aqui e a spec precisa mudar antes do código.

## 4. Cabeçalho comum

Todo pacote, de todo tipo, é `cabeçalho (28) + payload (tamanho) + HMAC (16)`.

### 4.1 Ordem dos bytes

**Big-endian** (ordem de rede) em todo campo de mais de um byte, no cabeçalho
e nos payloads. Motivos: é a convenção de todo protocolo IETF (RTP, SRTP,
QUIC), o Winsock já tem `htonl`/`htons` e o Node tem `readUInt32BE` e
`DataView` (que é big-endian por padrão), e o hex dos vetores de teste se lê
da esquerda para a direita. O custo da troca de bytes no x86 é uma instrução.

### 4.2 Diagrama

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+---------------+---------------+---------------+---------------+
|  magia 0x47   |  magia 0x4C   |  versão = 1   |     tipo      |   0
+---------------+---------------+---------------+---------------+
|                            sessão                             |   4
+---------------------------------------------------------------+
|                           sequência                           |   8
+---------------------------------------------------------------+
|                 tempo de envio (µs, mod 2^32)                 |  12
+---------------------------------------------------------------+
|                       número do quadro                        |  16
+-------------------------------+-------------------------------+
|   índice do fragmento (i)     |   total de fragmentos (n)     |  20
+---------------+---------------+-------------------------------+
|     flags     | reservado = 0 |      tamanho do payload       |  24
+---------------+---------------+-------------------------------+
|                  payload (0 a 1156 bytes) ...                 |  28
+---------------------------------------------------------------+
|           HMAC-SHA256 truncado em 16 bytes ...                | 28 + tamanho
+---------------------------------------------------------------+

flags (byte 24):
 7 6 5 4 3 2 1 0
+-+-+-+-+-+-+-+-+
|0|0|0|0|V|R|F|K|    K = KEYFRAME (0x01)        F = FIM_DE_QUADRO (0x02)
+-+-+-+-+-+-+-+-+    R = RETRANSMISSAO (0x04)   V = VOLTA (0x08)
```

### 4.3 Campos

| Off | Tam | Campo | Faixa | Regra de validação no receptor do pacote |
|---|---|---|---|---|
| 0 | 2 | magia | `0x47 0x4C` | Diferente: descarta em silêncio, conta `magia`. |
| 2 | 1 | versão | `1` | Diferente: descarta, conta `versao`; no máximo uma linha de log a cada 60 s **no total** (com o endereço do pacote que a disparou), sem tabela por endereço (4.5: nada de alocação antes do HMAC). |
| 3 | 1 | tipo | 1–7 (seção 5) | Fora da faixa: descarta, conta `tipo`. |
| 4 | 4 | sessão | 1 – 2³²−1 | 0 ou desconhecida na tabela local: descarta em silêncio, conta `sessao`. Escolhe a chave do HMAC. |
| 8 | 4 | sequência | 1 – 2³²−1 | 0: descarta, conta `campo`. Fora da janela ou repetida: descarta, conta `replay` (seção 8.4). |
| 12 | 4 | tempo de envio | qualquer | Sem validação. Relógio monotônico de quem manda **neste salto** em µs, mod 2³² (`QueryPerformanceCounter` no C++, convertido sem estourar 64 bits: `(q / f) × 10⁶ + (q % f) × 10⁶ / f`; `process.hrtime.bigint() / 1000n` no JS). |
| 16 | 4 | número do quadro | 1 – 2³²−1 em `VIDEO`/`FEC`; 0 nos outros | Fora disso: descarta, conta `campo`. |
| 20 | 2 | índice do fragmento | 0 – n−1 em `VIDEO`/`FEC`; 0 nos outros | Idem. |
| 22 | 2 | total de fragmentos | 1 – 1024 em `VIDEO`/`FEC`; 0 nos outros | Idem. |
| 24 | 1 | flags | ver 4.4 | Bits 4–7 ≠ 0 ou combinação proibida: descarta, conta `campo`. |
| 25 | 1 | reservado | 0 | ≠ 0: descarta, conta `campo`. |
| 26 | 2 | tamanho do payload | 0 – 1156 | Deve ser igual a `tamanho do datagrama − 44`; senão descarta, conta `tamanho`. |
| 28 | — | payload | por tipo | Seção 5. |
| fim | 16 | HMAC | — | Seção 8.3. |

Datagrama com menos de 44 bytes ou mais de 1200: descarta, conta `tamanho`.
Os bits de flags e o byte reservado são estritos (e não "ignorados") porque
não há compatibilidade entre versões a manter: um bit inesperado só pode ser
bug do outro lado, e queremos vê-lo no contador.

### 4.4 Flags

| Bit | Nome | Significado | Onde vale |
|---|---|---|---|
| 0x01 | `KEYFRAME` | O quadro é IDR. Vai em **todos** os fragmentos e no `FEC` do quadro. | `VIDEO`, `FEC` |
| 0x02 | `FIM_DE_QUADRO` | Último fragmento. Deve ser 1 se e só se `i == n−1`. | `VIDEO` (em `FEC` deve ser 0) |
| 0x04 | `RETRANSMISSAO` | Reenvio pedido por `NACK` **neste salto**. Só estatística. | `VIDEO` |
| 0x08 | `VOLTA` | Pacote do sentido de volta (receptor → emissor). | todos |

`VOLTA` deve ser 0 em `VIDEO` e `FEC`, 1 em `NACK`, `PEDIR_KEYFRAME` e
`RELATORIO`, e diz quem mandou nos `OLA` e `TCHAU`. Ele entra no HMAC; é o
que impede devolver a um lado um `OLA`/`TCHAU` que ele mesmo mandou. Quem é
receptor na sessão só aceita `VOLTA = 0`; quem é emissor só aceita
`VOLTA = 1`. Contrário: descarta, conta `direcao`.

Nos tipos que não são `VIDEO`/`FEC`, só `VOLTA` pode estar ligado.

### 4.5 Ordem de verificação

O receptor de qualquer pacote deve seguir esta ordem e parar no primeiro
erro. Nada antes do passo 6 gera resposta, log por pacote ou alocação.

1. Tamanho do datagrama (44 a 1200).
2. Magia, versão, tipo.
3. Campo `tamanho` contra o tamanho do datagrama.
4. Sessão existe na tabela local.
5. HMAC (comparação em tempo constante).
6. `VOLTA` contra o papel local na sessão.
7. Janela de replay; só aqui a janela avança.
8. Campos de quadro/fragmento/flags do tipo, e o payload (seção 5).

Pacote descartado nunca é respondido. Contadores (todos na linha `[diag]`,
P4.4): `tamanho`, `magia`, `versao`, `tipo`, `sessao`, `hmac`, `direcao`,
`replay`, `campo`.

### 4.6 Wraparound

- **Sequência:** 32 bits, começa em 1 em cada sentido de cada sessão e sobe
  de 1 em 1 em **todo** datagrama enviado naquele sentido (inclusive `FEC`,
  `OLA`, reenvio). **Não dá a volta.** Quando a sequência de qualquer um
  dos sentidos chega a `0xFFFF0000`, quem a está usando manda `TCHAU`
  (motivo 4) e a sessão é refeita pela sinalização com chave
  nova. Na prática não acontece: a 2.000 pacotes/s são 24 dias. Comparação
  sem sinal, direta.
- **Número do quadro:** 32 bits, é o contador do encoder da **origem**
  (um por execução do exe), comum a todas as sessões dela: começa em 1 no
  primeiro quadro que o exe manda e sobe de 1 em 1, **sem buracos** (seção
  6.4). Por isso uma sessão aberta depois (segundo receptor, filho de relay,
  sessão substituída) começa num número qualquer, e o receptor **não deve**
  supor que o primeiro quadro é 1 (o modo `ESPERANDO_KEYFRAME` cuida disso).
  Não dá a volta (2,2 anos a 60 fps); no limite a origem encerra a
  transmissão como num fim normal (`TCHAU` motivo 1) e recomeça com exe
  novo. Comparação sem
  sinal, direta. O relay preserva o número da origem.
- **Tempo de envio:** dá a volta a cada 71,6 min. Toda conta com ele é
  diferença de 32 bits com sinal: `(a - b) | 0` no JS, `(int32_t)(a - b)` no
  C++. Diferenças reais ficam sempre muito abaixo de 35 min.

## 5. Tipos de pacote

| Tipo | Nome | Sentido | Payload |
|---|---|---|---|
| 1 | `VIDEO` | ida | 1–1152 bytes de Annex B |
| 2 | `FEC` | ida | 5–1156 bytes |
| 3 | `NACK` | volta | 10–514 bytes |
| 4 | `PEDIR_KEYFRAME` | volta | 8 bytes |
| 5 | `RELATORIO` | volta | 40 bytes |
| 6 | `OLA` | os dois | 12 bytes |
| 7 | `TCHAU` | os dois | 4 bytes |

Payload de tamanho diferente do da tabela (ou fora da faixa): descarta,
conta `campo`. Campos "reservado" dentro de payloads devem ser 0, com a mesma
regra.

### 5.1 `VIDEO` (1)

- **Cabeçalho:** quadro, `i`, `n`, `KEYFRAME`, `FIM_DE_QUADRO`,
  `RETRANSMISSAO`.
- **Payload:** os bytes `[i × 1152, i × 1152 + tamanho)` do quadro em Annex B.
  Todo fragmento com `i < n−1` tem exatamente 1152 bytes; o último tem de 1
  a 1152. Fragmento que não é o último com tamanho ≠ 1152: descarta, conta
  `campo`.
- **Quando:** cada quadro do encoder, fragmentos em ordem de índice, com o
  `FEC` de cada grupo logo depois do último fragmento do grupo. Reenvio a
  pedido de `NACK`, com `RETRANSMISSAO = 1` e sequência e tempo novos (o
  resto do cabeçalho e o payload idênticos ao original).
- **Receptor:** remonta (seção 6).

### 5.2 `FEC` (2)

- **Cabeçalho:** quadro, `i` = índice do **primeiro** fragmento do grupo,
  `n` = total do quadro, `KEYFRAME` igual ao do quadro; `FIM_DE_QUADRO` e
  `RETRANSMISSAO` = 0.
- **Payload:**

  | Off | Tam | Campo | Regra |
  |---|---|---|---|
  | 0 | 1 | `k` | fragmentos cobertos; deve ser `min(N, n − i)` |
  | 1 | 1 | reservado | 0 |
  | 2 | 2 | `xor_tamanhos` | XOR dos `tamanho` dos `k` fragmentos |
  | 4 | L | `xor_dados` | XOR dos `k` payloads, cada um completado com zeros até L |

  `L` = maior tamanho entre os `k` fragmentos: 1152, exceto quando o grupo
  é só o último fragmento do quadro (`i == n−1`, então `k = 1`), em que `L`
  é o tamanho dele. Validação: `N ≥ 1` (com `fecN = 0` anunciado, todo `FEC`
  é descartado e conta `campo`; nada de `i % 0`), `i % N == 0`, `i < n`,
  `k` como acima, `tamanho do payload == 4 + L` com `L == 1152` se
  `i < n−1` e `1 ≤ L ≤ 1152` se `i == n−1`.
- **Quando e o que o receptor faz:** seção 7.
- `FEC` não é pedido em `NACK` nem reenviado.

### 5.3 `NACK` (3)

- **Payload:**

  | Off | Tam | Campo | Regra |
  |---|---|---|---|
  | 0 | 1 | `qtd` | 1–64 entradas |
  | 1 | 1 | reservado | 0 |
  | 2 | 8 × qtd | entradas | cada uma: `quadro` (u32), `primeiro` (u16), `quantidade` (u16) |

  Entrada = fragmentos `[primeiro, primeiro + quantidade)` do quadro. Regras:
  `quadro ≥ 1`; `quantidade` de 1 a 1024 com `primeiro + quantidade ≤ 1024`,
  ou `0xFFFF` com `primeiro = 0` para "o quadro inteiro" (quando nenhum
  fragmento dele chegou e `n` é desconhecido). Tamanho do payload deve ser
  `2 + 8 × qtd`.
- **Quando:** seção 6.5, no máximo 1 `NACK` a cada 5 ms por sessão (os
  faltantes que vencem no intervalo esperam o próximo). Cada fragmento
  faltante é pedido **uma vez** só por sessão; depois de um `0xFFFF`, todos
  os fragmentos daquele quadro contam como pedidos. Vários fragmentos e
  quadros vão no mesmo `NACK`.
- **Emissor:** reenvia do buffer de reenvio (últimos 300 ms, chave
  `(quadro, índice)`) o que tiver; o que não tiver é ignorado em silêncio.
  O reenvio vai sempre para o endereço da sessão (9.3), **nunca** para o
  endereço de origem do `NACK`.
  Limites por sessão: no máximo 250 `NACK`/s processados (acima do que um
  receptor correto manda, 200/s; excesso descartado, conta `nack_excesso`);
  cada `(quadro, índice)` reenviado no máximo uma vez;
  bytes reenviados em qualquer janela de 1 s ≤ 25 % do bitrate alvo atual
  (no relay, que não tem encoder: 25 % da taxa de ida recebida da origem no
  último 1 s; o que passar é pulado e contado). Esses tetos existem para um
  receptor com defeito não virar amplificador de banda.

### 5.4 `PEDIR_KEYFRAME` (4)

- **Payload:** `motivo` (u8), reservado (3 bytes, 0), `ultimo_quadro` (u32).
  `motivo`: 1 = quadro vencido, 2 = erro de decode, 3 = início da sessão ou
  sem referência, 4 = SPS/PPS faltando. Outro valor: descarta, conta `campo`.
  `ultimo_quadro` = último quadro entregue ao decoder (0 se nenhum).
- **Quando:** sempre que o receptor fica sem referência (seção 6.3) ou o
  decoder do renderer reclama (P2.5). **No máximo 1 a cada 500 ms por
  sessão**; enquanto nenhum keyframe novo chegar, repete a cada 500 ms.
- **Emissor:** força um IDR (`{"cmd":"keyframe"}`, P1.1), **no máximo 1 a
  cada 500 ms somando todas as sessões**. Pedido que chega dentro da janela
  marca um IDR pendente para o fim dela. Pedido é ignorado se um keyframe com
  número > `ultimo_quadro` saiu há menos de 500 ms (ele está a caminho).

### 5.5 `RELATORIO` (5)

- **Payload (40 bytes):**

  | Off | Tam | Campo | Definição |
  |---|---|---|---|
  | 0 | 4 | `intervalo_us` | duração real do período coberto |
  | 4 | 2 | `esperados` | `maior_seq` agora − `maior_seq` do relatório anterior; no primeiro relatório, `maior_seq` − (sequência do primeiro pacote aceito) + 1 |
  | 6 | 2 | `recebidos` | pacotes de ida aceitos (passo 7 da 4.5) no período |
  | 8 | 4 | `kbps` | bytes de datagrama de ida aceitos no período × 8 / `intervalo_us` × 1000, arredondado para baixo |
  | 12 | 4 | `atraso_medio_us` | média do atraso relativo (abaixo) dos pacotes do período (0 sem pacotes) |
  | 16 | 4 | `atraso_max_us` | máximo do atraso relativo no período (0 sem pacotes) |
  | 20 | 4 | `maior_seq` | maior sequência de ida aceita até agora |
  | 24 | 4 | `eco_tempo` | `tempo de envio` do pacote de ida mais recente |
  | 28 | 4 | `eco_espera_us` | tempo entre a chegada dele e o envio deste relatório |
  | 32 | 2 | `quadros_completos` | no período |
  | 34 | 2 | `quadros_vencidos` | no período |
  | 36 | 2 | `recuperados_fec` | fragmentos recuperados por FEC no período |
  | 38 | 2 | `nacks` | fragmentos pedidos por `NACK` no período |

  Contadores de 16 bits saturam em 65535. Perda do período =
  `1 − recebidos / esperados` (com `esperados = 0`, perda 0); um pacote
  atrasado que cai no período seguinte pode deixar `recebidos > esperados`,
  e o emissor limita a perda a [0, 1].
- **Atraso relativo de chegada:** para cada pacote de ida aceito,
  `d = (relógio_local_us − tempo_de_envio) mod 2³²`. O receptor guarda
  `d_min`, o menor `d` dos últimos 10 s (comparando com
  `(d − d_min) | 0 < 0`), e o atraso relativo é `(d − d_min) | 0`. Não
  precisa de relógios sincronizados: o deslocamento entre eles some na
  subtração, e a janela de 10 s absorve a deriva.
- **Quando:** a cada 200 ms por sessão, enquanto a sessão existir (inclusive
  pausada, com contadores zerados).
- **Emissor:** processa no máximo 1 por 100 ms por sessão (excesso
  descartado, conta `relatorio_excesso`). RTT =
  `(agora − eco_tempo − eco_espera_us) | 0`. Uso na seção 10.

### 5.6 `OLA` (6)

- **Payload (12 bytes):** `estado` (u8: 0 = transmitindo, 1 = pausado; o
  receptor sempre manda 0), reservado (3 bytes), `eco_tempo` (u32: `tempo de
  envio` do último `OLA` recebido do outro lado, 0 se nenhum),
  `eco_espera_us` (u32). `estado` diferente de 0 e 1 (ou 1 com `VOLTA = 1`):
  descarta, conta `campo`.
- **Emissor:** manda o primeiro assim que a sessão é aceita na sinalização,
  depois a cada 250 ms até receber um `OLA` de volta; daí em diante a cada
  1 s, e na hora quando `estado` muda (pausa e volta, `Ctrl+Alt+P`). **Não
  manda `VIDEO` antes do primeiro `OLA` de volta.** No exe, o primeiro quadro
  que uma sessão recebe é keyframe (no relay, ver 10, regra 4), e o primeiro
  quadro depois de uma pausa também (o encoder pode ter seguido codificando
  durante a pausa, e 6.2 proíbe mandar delta cuja referência não foi
  mandada). Sem `OLA` de volta em 5 s: sessão falha (`nativo-fim`
  motivo `silencio`, volta para WebRTC por [[D-09-webrtc-continua-como-fallback|D-09]]).
- **Receptor:** responde a cada `OLA` recebido com um `OLA` (`VOLTA = 1`),
  no máximo 10 por segundo por sessão. Guarda `estado`: com 1, a falta de
  quadros não conta para a volta automática.
- Serve de prova de que a porta passa pelo firewall, de keepalive do estado
  UDP do firewall do lado do exe (seção 9.2) e de medida de RTT para os dois
  lados.

### 5.7 `TCHAU` (7)

- **Payload (4 bytes):** `motivo` (u8), reservado (3 bytes).
  1 = fim normal (parou de transmitir, saiu da sala), 2 = falha do emissor
  (encoder ou exe), 3 = volta para WebRTC, 4 = sequência no limite (4.6),
  5 = silêncio (o outro lado sumiu), 6 = substituída por sessão
  nova. Outro valor: descarta, conta `campo`.
- **Quando:** ao encerrar, 3 vezes com 20 ms de intervalo (não há
  confirmação). Sempre acompanhado de `nativo-fim` na sinalização, que é o
  caminho garantido.
- **Quem recebe:** apaga a sessão e a chave na hora. Pacotes atrasados dela
  caem no contador `sessao`.

### 5.8 Silêncio

Qualquer lado que passe 5 s sem nenhum pacote autenticado da sessão a dá por
morta: manda `TCHAU` motivo 5 (pode não chegar), `nativo-fim` motivo
`silencio`, e o app segue [[D-09-webrtc-continua-como-fallback|D-09]].

## 6. Fragmentação e remontagem

### 6.1 Do quadro aos fragmentos

Quadro de `T` bytes → `n = ceil(T / 1152)` fragmentos; o fragmento `i` leva
os bytes `[i × 1152, min((i+1) × 1152, T))`. A concatenação dos payloads em
ordem de índice é o quadro original, byte a byte. Nada de prefixo ou
cabeçalho dentro do payload: o quadro remontado vai direto para um
`EncodedVideoChunk` (`type: 'key'` se `KEYFRAME`, senão `'delta'`), sem
`description` no `VideoDecoder`, o que no WebCodecs significa Annex B.
O `codec` vem do SPS de cada keyframe; SPS diferente do anterior (mudança de
resolução) → reconfigurar o decoder antes de entregar.

### 6.2 Limite de fragmentos

`n ≤ 1024`, ou seja, quadro de até 1.179.648 bytes. Um keyframe 1080p com
CBR de baixa latência a 12 Mbps costuma ficar entre 5× e 10× o quadro médio
(125–250 KB, 109–218 fragmentos), então sobra margem de 4× a 9×.

Se o encoder entregar um quadro maior que isso, o emissor:

1. não manda o quadro;
2. não manda nenhum delta seguinte até o próximo keyframe (eles
   referenciam o que foi descartado);
3. baixa o bitrate em 20 % e força um keyframe;
4. conta `quadros_grandes` na métrica do exe.

Como nenhum número de quadro é gasto com o que não foi mandado, o receptor
só vê um intervalo maior entre quadros.

**Pacing (sugestão, P2.2):** um keyframe de 200 fragmentos espalhado em
2 ms seria uma rajada de ~1 Gbps; espalhar keyframes por até 8 ms (meio
quadro a 60 fps).

### 6.3 Estado do receptor por sessão

- `U` = último quadro entregue ao decoder (nenhum no começo).
- Modo `ESPERANDO_KEYFRAME` (inicial) ou `NORMAL`.
- Até 8 quadros em montagem, cada um com `n`, `KEYFRAME`, os fragmentos
  recebidos e o instante do primeiro pacote.

Regras para cada `VIDEO` ou `FEC` aceito (todas valem para os dois, exceto a 5,
que é só de `VIDEO`):

1. `quadro ≤ U`: atrasado. Descarta, conta `atrasados`.
2. Em `ESPERANDO_KEYFRAME`, pacote sem `KEYFRAME`: só segue se já houver em
   montagem um keyframe com número menor que o dele (é um delta que vai
   valer quando aquele keyframe completar); senão descarta, conta
   `sem_referencia`, não gera `NACK`.
3. Primeiro pacote de um quadro fixa `n` e `KEYFRAME`. Pacote seguinte do
   mesmo quadro com `n` ou `KEYFRAME` diferente: descarta, conta `campo`.
4. Fragmento já presente, ou `FEC` de um grupo que já tem `FEC`: duplicado.
   Descarta, conta `duplicados`. (A
   sequência é nova em cada reenvio, então o duplicado de fragmento é
   tratado aqui e não na janela de replay.)
5. Fora de ordem é normal: o fragmento vai para a posição `i × 1152`.
6. Quadro novo quando já há 8 em montagem: o mais antigo vence na hora
   (regra 6.6).
7. Em `NORMAL`: chegou pacote do quadro `q > U + 1` e quadros entre
   `U + 1` e `q − 1` não estão em montagem: cria entradas vazias para eles
   (com `n` desconhecido), com o instante de agora. Se a lacuna tiver mais de
   8 quadros (`MAX_QUADROS_EM_MONTAGEM`), não cria nenhuma e descarta tudo o
   que está em montagem com número `< q`; aí, se o pacote é de keyframe,
   vai para `ESPERANDO_KEYFRAME` **sem** pedir e segue com ele (o keyframe
   resolve a lacuna, e os deltas seguintes entram pela regra 2); senão descarta
   também o pacote, vai para `ESPERANDO_KEYFRAME` e manda `PEDIR_KEYFRAME`
   motivo 1. Em `ESPERANDO_KEYFRAME` ela só vale para os deltas aceitos pela
   regra 2, com o número do keyframe em montagem no lugar de `U`; para o
   resto não vale: lá `U` é velho ou não existe, e a lacuna até o keyframe é
   esperada.

### 6.4 Entrega

- Quadro completo `q` com `KEYFRAME`: entrega na hora, descarta tudo o que
  estiver em montagem com número `< q` (sem pedir keyframe), `U = q`, modo
  `NORMAL`, e em seguida entrega os seguintes que já estiverem completos
  (regra 2 de 6.3), como no delta.
- Quadro completo delta em `NORMAL`: entrega se `q == U + 1`, e em seguida
  entrega os seguintes que já estiverem completos. Se `q > U + 1`, espera
  os anteriores completarem ou vencerem.
- O emissor numera só o que manda, sem buracos, e nunca manda um delta cuja
  referência ele não mandou (6.2). Por isso "buraco no número" sempre quer
  dizer perda.

### 6.5 Quando um fragmento é dado como faltante

Um fragmento é **suspeito** quando: chegou um fragmento de índice maior do
mesmo quadro, ou chegou pacote de um quadro posterior (aí o fim do quadro
também é suspeito), ou passaram `SUSPEITA_MS` (20 ms) do último pacote do
quadro sem ele completar. Um quadro vazio criado pela regra 7 é suspeito por inteiro.

`ESPERA_NACK_MS` (5 ms) depois de virar suspeito, se ainda faltar:

1. se o grupo de FEC dele tem exatamente um faltante e o `FEC` chegou,
   recupera (seção 7) e não pede nada;
2. senão, entra no próximo `NACK` (todos os faltantes vencidos no mesmo
   instante vão juntos). Quadro inteiro desconhecido vai como `0xFFFF`.

Um fragmento pedido não é pedido de novo. Se o reenvio também se perder, o
quadro vence.

### 6.6 Vencimento

Um quadro incompleto vence 100 ms depois do primeiro pacote dele (ou da
criação da entrada vazia), ou antes pela regra 6. Quadro vencido `q`:
descarta, e descarta também os deltas em montagem com número `> q` (dependem
dele); conta `quadros_vencidos`, modo `ESPERANDO_KEYFRAME`. Um keyframe em
montagem com número `> q` continua, e se completar encerra a espera; só se
não houver nenhum o receptor manda `PEDIR_KEYFRAME` motivo 1 (respeitando
500 ms). Deltas que chegarem depois seguem a regra 2.

100 ms cabem um `NACK` e o reenvio com RTT de até ~80 ms, que cobre a
LAN virtual medida (3–4 ms) e o Radmin passando por relay.

## 7. FEC XOR por grupo

- **N** (fragmentos por grupo) é escolhido pelo emissor por sessão,
  anunciado em `nativo-oferta.fecN`: 0 = sem FEC, 1–32. Padrão 10 (~10 % a
  mais de pacotes). O receptor usa o `N` anunciado para validar (5.2).
- **Grupos:** dentro de um quadro, o grupo `g` são os fragmentos
  `[g × N, min(g × N + N, n) − 1]`. O grupo é identificado por
  `(quadro, g × N)`, que é o que vai no cabeçalho do `FEC`. Grupos não
  atravessam quadros, para nenhum quadro esperar pelo seguinte. Um quadro de
  um fragmento só tem um grupo de `k = 1` (o `FEC` é uma cópia; custa pouco
  porque esses quadros são pequenos).
- **Envio:** o `FEC` do grupo sai logo depois do último fragmento dele.
- **Tamanhos diferentes:** só o último fragmento do quadro pode ser menor.
  Cada payload é completado com zeros até `L` antes do XOR, e
  `xor_tamanhos` guarda o XOR dos tamanhos.
- **Recuperação:** com exatamente um fragmento `j` faltando no grupo e o
  `FEC` presente: `tamanho_j = xor_tamanhos XOR (tamanhos dos outros)`;
  `dados_j = xor_dados XOR (outros completados com zeros até L)`, cortado em
  `tamanho_j`. Valida: `1 ≤ tamanho_j ≤ L`, e `= 1152` se `j < n−1`;
  senão descarta a recuperação e conta `campo`. O fragmento recuperado entra
  na montagem como se tivesse chegado (com `KEYFRAME` do `FEC`), e conta
  `recuperados_fec`. Dois ou mais faltando: `NACK`.

## 8. Autenticação

### 8.1 Modelo de ameaça

**Atacante:** outra pessoa na LAN virtual (participante da sala ou só membro
da mesma rede Radmin, que muitas vezes é pública entre jogadores). Ela pode
mandar qualquer datagrama UDP para qualquer IP e porta da rede virtual,
repetir pacotes que tenha visto, e participar da sala com o app modificado.
Ela **não** vê o tráfego unicast entre outros dois PCs (o túnel do
Tailscale/Radmin é por par e cifrado) nem as mensagens de sinalização
endereçadas a outros (`offer`, `nativo-oferta` etc. vão só ao destino).
Atenção: essa segunda garantia vem **só** do túnel da VPN. O WebSocket da
sala é `ws://` sem TLS (`new WebSocketServer({ port })` em
`server/signaling-core.js`), então numa LAN física sem VPN quem consegue
escutar a rede (Wi-Fi compartilhado, espelhamento de porta) lê a `chave` e
passa a forjar pacotes da sessão. Ver o custo aceito em 8.5.

**O que tem de ser impossível:**

- injetar ou alterar o vídeo na tela de outra pessoa;
- forjar `NACK` para fazer o emissor reenviar (amplificação de banda);
- forjar `PEDIR_KEYFRAME` (keyframe em rajada derruba a qualidade de todos);
- forjar `RELATORIO` (derrubar o bitrate) ou `TCHAU` (cortar a transmissão);
- repetir pacotes capturados.

**Fora do modelo, de propósito:**

- **O dono da sala.** O servidor de sinalização roda no PC dele e repassa
  as mensagens, então ele vê as chaves. Hoje ele já vê e poderia trocar as
  impressões digitais DTLS do WebRTC: o nativo não piora isso.
- **O relay.** Ele vê e repassa o vídeo dos filhos por definição (hoje ele
  recodifica). Pode alterar o que manda aos filhos; não pode falar pela
  origem com ninguém.
- **Inundação da porta.** Não dá para impedir; o custo é limitado (4.5:
  filtros baratos antes do HMAC, nenhuma resposta, só contadores).
- **Sigilo contra quem está no caminho.** Ver 8.5.
- **Receptor legítimo mal-intencionado.** Com a chave da própria sessão ele
  pode pedir keyframe a cada 500 ms e relatar perda falsa (derrubando o
  bitrate de quem segue o pior caminho, P3.2). Os tetos de 5.3–5.5 limitam
  o estrago ao que uma rede ruim já faria; ele não consegue mandar o
  emissor transmitir para um terceiro, porque o endereço de envio vem do
  servidor (9.3), não dele.

### 8.2 Chave por sessão

- 32 bytes aleatórios (`crypto.randomBytes(32)` no JS; `BCryptGenRandom` no
  C++), gerados pelo **emissor** de cada sessão, e só por ele.
- Viaja em `nativo-oferta` (seção 9.3), em base64 (44 caracteres), pelo
  WebSocket da sala, só para o receptor daquela sessão.
- Uma chave por receptor, nunca por sala nem por origem: com chave
  compartilhada, qualquer espectador poderia forjar pacotes para os outros
  espectadores da mesma origem, que é exatamente o ataque a impedir.
- A mesma chave serve aos dois sentidos da sessão; o bit `VOLTA` (no HMAC)
  separa os sentidos.
- Do main para o exe, a chave vai pelo **stdin** (comando JSON do P2.6),
  nunca pela linha de comando, que outros processos podem ler.
- Nunca entra em log (nem do app, nem do servidor de sinalização, nem do
  exe, nem em eco de comando). Os testes do P2.6 devem conferir isso no
  `signaling-core.js` e no caminho renderer → main → exe (o console do
  renderer vai para o log do main, `src/main/consolelog.js`).
- Apagada quando a sessão termina. Nunca reutilizada.

### 8.3 HMAC

- **Algoritmo:** HMAC-SHA256 com a chave da sessão.
- **Entrada:** os bytes `[0, 28 + tamanho)` do datagrama, exatamente como
  saem no fio: cabeçalho inteiro (inclusive sessão, sequência, flags) e
  payload.
- **Etiqueta:** os **16 primeiros bytes** do resultado, nos últimos 16 bytes
  do datagrama. É o HMAC-SHA-256-128 do RFC 4868 (IPsec), uma truncagem
  padrão: acima do mínimo de 80 bits do RFC 2104 e com folga enorme contra
  tentativa online (cada chute é um datagrama; 2¹²⁸ chutes). Custa 16 bytes
  de 1200 (1,3 %); 8 bytes economizariam 0,7 % e exigiriam defender um
  tamanho fora do padrão.
- **Comparação:** em tempo constante (`crypto.timingSafeEqual` no JS; laço
  com OR acumulado no C++).
- **C++ (D-04):** `BCryptOpenAlgorithmProvider(BCRYPT_SHA256_ALGORITHM, …,
  BCRYPT_ALG_HANDLE_HMAC_FLAG)`, um `BCryptCreateHash` por sessão com
  `BCRYPT_HASH_REUSABLE_FLAG`, `BCryptHashData` + `BCryptFinishHash` por
  pacote. **JS:** `crypto.createHmac('sha256', chave).update(bytes).digest()`
  e os 16 primeiros bytes.

### 8.4 Replay

Por sessão e por sentido, quem recebe guarda `maior` (maior sequência
aceita, 0 no começo) e um bitmap das últimas 1024:

- `seq > maior`: aceita, desloca o bitmap, `maior = seq`.
- `maior − 1024 < seq ≤ maior` e bit apagado: aceita, liga o bit.
- Senão (repetida ou mais velha que a janela): descarta, conta `replay`.

A janela só é consultada **depois** do HMAC; senão um pacote forjado
avançaria a janela e faria descartar os verdadeiros. 1024 sequências são
0,5–1 s de tráfego a 1080p60, muito mais que a reordenação de uma LAN
virtual. Reenvios ganham sequência nova, então nunca caem aqui.

### 8.5 Por que não cifra (versão 1)

Decisão: **só autentica, não cifra.** Motivos:

1. A ameaça do plano é injeção, que o HMAC resolve sozinho.
2. Quem está na sala vai ver a tela de qualquer jeito, e quem está fora não
   recebe o unicast dos outros: o túnel do Tailscale (WireGuard) e o do
   Radmin já são cifrados.
3. Cifra autenticada (AES-GCM) depende de nonce único por chave. Com
   reenvio, FEC recuperado e relay reescrevendo pacotes, um nonce repetido
   por bug quebra sigilo **e** integridade de uma vez. HMAC não tem essa
   armadilha.
4. Vídeo em claro dá para inspecionar no Wireshark e despejar em `.h264`
   durante o desenvolvimento.
5. Com a trava de versão, ligar AES-GCM depois (`BCRYPT_AES_ALGORITHM` com
   `BCRYPT_CHAIN_MODE_GCM` no exe, `aes-256-gcm` no Node) é só subir
   `VERSAO_PROTOCOLO`, sem compatibilidade a manter.

Custo aceito: é uma regressão em relação ao DTLS-SRTP do WebRTC para quem
usa o app numa LAN física sem VPN e tem alguém capaz de espelhar o tráfego.
A regressão é de sigilo **e de integridade**: a chave passa em claro pelo
`ws://` da sala (8.1), então quem só escuta já consegue injetar, enquanto no
WebRTC precisaria de um ataque ativo (trocar a impressão digital DTLS no
meio da sinalização). Cifrar o UDP não resolve isso; resolveria TLS no
WebSocket ou troca de chave autenticada. Rever se o app passar a ser usado
fora de LAN virtual.

## 9. Porta, sinalização e versão

### 9.1 Uma porta UDP por sala

Cada PC que usa o modo nativo numa sala abre **uma** porta UDP de recepção,
no main (`dgram`), que atende todas as sessões dele nos dois papéis (como
receptor e, num relay, como emissor para os filhos). As sessões se separam
pelo campo `sessão`. Faixa proposta: **UDP 9020–9030**, a primeira livre
(`findFreeServer` de `ports.js` serve), fora da faixa TCP 9000–9010 da
sinalização e da 41235 da descoberta. Abre quando a primeira sessão nativa
começa e fecha quando a última termina (P2.6). O socket é `udp6` com
`ipv6Only: false` (recebe IPv4 e IPv6, porque o `endereco` de 9.3 pode ser
dos dois); sem IPv6 no sistema, `udp4`. Tudo o que o main manda (volta como
receptor, ida como relay) sai **deste mesmo socket**: é o par endereço/porta
que o outro lado conhece, e é o que casa com o estado do firewall do exe
(9.2).

### 9.2 O exe não escuta porta fixa

O exe da origem manda de um socket próprio numa porta efêmera (um socket
por família de endereço de destino, IPv4 ou IPv6, sem `bind` explícito numa
porta fixa). Quem responde (receptor) manda o sentido de volta **para o
endereço e porta de origem do último pacote de ida que avançou a janela de
replay** da sessão (aceito no passo 7 da 4.5 com `seq > maior`), nunca para
um endereço vindo de pacote não autenticado ou repetido (assim ninguém usa o
receptor como refletor reenviando um pacote capturado de outro endereço). O
firewall do Windows deixa passar a resposta a um fluxo UDP de saída, e o
`OLA` a cada 1 s mantém esse estado vivo; só a porta do main precisa de regra
(`firewall.js`, protocolo UDP). **Confirmar no P2.6**: se o firewall barrar a
volta, a regra passa a cobrir também o exe.

Um PC pode ao mesmo tempo transmitir (exe, porta efêmera) e assistir outra
tela (main, porta da sala): são dois processos e duas portas, sem conflito.

### 9.3 Mensagens novas de sinalização (implementadas no P2.6)

Todas seguem o padrão do `reoffer` em `server/signaling-core.js`: `to`
obrigatório, destino na mesma sala, mensagem **reconstruída campo a campo**
(nada arbitrário passa junto), `from` carimbado pelo servidor, limite de
frequência próprio, `chave` nunca no log.

| Mensagem | Sentido | Campos |
|---|---|---|
| `nativo-oferta` | emissor → receptor | `to`, `kind` (`'screen'`), `origem` (peerId da origem do vídeo; igual a `from` sem relay), `sessao` (inteiro 1 – 2³²−1), `chave` (base64 de 32 bytes), `protocolo` (= `VERSAO_PROTOCOLO`), `fecN` (0–32) |
| `nativo-resposta` | receptor → emissor | `to`, `sessao`, `aceita` (bool), `porta` (1–65535, se aceita), `motivo` (se recusa: `'sessao'`, `'protocolo'`, `'sem-decoder'`, `'desligado'`); o servidor acrescenta `endereco` (endereço do socket de quem respondeu, `normalizeAddress`) |
| `nativo-fim` | qualquer lado | `to`, `sessao`, `motivo` (`'fim'`, `'falha'`, `'webrtc'`, `'limite'`, `'silencio'`, `'substituida'`, os mesmos do `TCHAU`) |

Regras que dependem delas:

- O receptor recusa (`motivo: 'sessao'`) uma `sessao` que já exista na
  tabela dele, em qualquer papel; o emissor sorteia outra e oferece de novo.
  Assim a tabela por `sessão` nunca tem dois donos, mesmo com duas origens
  ou um relay escolhendo números.
- O receptor tem **no máximo uma sessão de ida por `(origem, kind)`**. Ao
  aceitar uma `nativo-oferta` para um par que já tem sessão (exe
  reiniciado, sessão refeita no limite de 4.6, troca de relay na árvore), a
  anterior é apagada na hora, o emissor dela recebe `TCHAU` motivo 6 e
  `nativo-fim` `'substituida'`, e a nova começa do zero em
  `ESPERANDO_KEYFRAME` (estado de 6.3 é por sessão; nada passa de uma para
  a outra).
- Endereço de envio: o emissor usa `endereco` da resposta. Se ele for de
  loopback (o receptor é quem hospeda a sala e entrou por `127.0.0.1`), usa o
  endereço da sala por onde o próprio emissor entrou.
- Provável no P2.6 **(sugestão)**: um campo `nativo: true` no
  `broadcast-state`, para quem assiste saber que deve esperar uma
  `nativo-oferta` em vez de uma `offer` de vídeo.

### 9.4 Versão do protocolo e trava de versão

- A sala só aceita a mesma `appVersion` (`join-denied` motivo `version`), e
  o JS do protocolo vem no mesmo pacote do app. Logo, entre dois mains da
  mesma sala a versão do protocolo é sempre a mesma, e **não há negociação**.
- O exe é um binário à parte e pode estar velho (build de desenvolvimento
  esquecido). Por isso o exe imprime `"protocolo": 1` na primeira linha de
  métrica (P1.6), e o main não usa um exe com valor diferente (volta para
  WebRTC e registra no log). No release, o P4.1 garante que o exe vai junto.
- `nativo-oferta.protocolo` diferente: recusa com `motivo: 'protocolo'`.
- No fio, versão diferente só pode ser lixo ou exe velho: descarta e conta
  (4.3).
- Qualquer mudança de formato, por menor que seja, sobe `VERSAO_PROTOCOLO`
  junto com a versão do app.

## 10. Relay (Fase 3)

O relay é receptor de uma sessão (com a origem) e emissor de uma sessão por
filho. Ele repassa sem decodificar para isso.

**Reescreve por salto** (copia o datagrama, troca e refaz o HMAC):

| Campo | No repasse |
|---|---|
| sessão | a da sessão com aquele filho |
| sequência | a próxima daquela sessão |
| tempo de envio | relógio do relay na hora de mandar |
| `RETRANSMISSAO` | 1 só se for reenvio pedido por `NACK` **do filho**; 0 em todo o resto (inclusive no que chegou da origem como reenvio) |
| HMAC | com a chave da sessão com aquele filho |

**Preserva bit a bit:** magia, versão, tipo, número do quadro, `i`, `n`,
`KEYFRAME`, `FIM_DE_QUADRO`, `VOLTA` (= 0), reservado, tamanho e payload.
Isso inclui o payload dos `FEC`: o relay anuncia ao filho o **mesmo `fecN`**
da sessão de cima.

Regras:

1. O relay só repassa o que passou por toda a verificação (4.5). Nunca
   repassa pacote não autenticado.
2. Repassa **cada fragmento uma vez por filho**, assim que o obtém, venha
   ele direto, de reenvio da origem ou de recuperação por FEC. Fragmento
   recuperado por FEC vira um `VIDEO` montado pelo relay (cabeçalho a partir
   do `FEC`: quadro, `i = j`, `n`, `KEYFRAME`, `FIM_DE_QUADRO` se
   `j = n−1`). Repassa `FEC` da origem uma vez por filho, também.
3. Repassa independentemente do próprio estado de decode (o relay pode
   estar em `ESPERANDO_KEYFRAME` e mesmo assim repassar deltas).
4. Só manda `VIDEO` a um filho depois do `OLA` de volta dele (5.6). Ao
   contrário do exe, o relay não garante que o primeiro quadro do filho seja
   keyframe: repassa o que vier, e o filho descarta os deltas até o keyframe
   pedido pela regra 6 (6.3, regra 2).
5. **`NACK` do filho:** responde do buffer próprio (últimos 300 ms, chave
   `(quadro, índice)`, um só para todos os filhos), com os mesmos limites do
   emissor (5.3). O que ele não tem é ignorado: o próprio relay também
   percebeu a perda, pediu à origem, e pela regra 2 o fragmento segue para o
   filho quando chegar. `NACK` de filho nunca sobe para a origem.
6. **`PEDIR_KEYFRAME` do filho:** agregado; o relay manda à origem no
   máximo 1 a cada 500 ms (ignora se um keyframe mais novo que o
   `ultimo_quadro` do filho já passou por ele há menos de 500 ms). Ao abrir
   sessão com um filho novo, o relay pede keyframe à origem (motivo 3).
7. **`RELATORIO` do filho:** fica no relay (decisão de tirar um filho lento,
   P3.2). O relay manda à origem o próprio `RELATORIO`, que descreve só o
   salto origem → relay.
8. **`OLA`/`TCHAU`:** por salto. `estado` do `OLA` de cima é propagado aos
   filhos na hora. `TCHAU` de cima vira `TCHAU` com o mesmo motivo para cada
   filho, exceto o motivo 4: a sequência no limite é só do salto de cima, a
   sessão nova de cima segue com o mesmo contador de quadros da origem (4.6)
   e as sessões com os filhos continuam. Com o motivo 6 (por exemplo, exe da
   origem reiniciado, contador de quadros de volta a 1) o relay também
   substitui a sessão de cada filho, com `nativo-oferta` nova.

## 11. O que o `RELATORIO` dá ao controle de taxa (P2.4)

O protocolo só carrega medidas; a regra fica no emissor. Para a regra do
plano ("perda > 5 % ou atraso subindo → −20 %; folga por 5 s → +10 % até o
teto"), o `RELATORIO` traz:

- **perda:** `esperados` e `recebidos` do período (5.5);
- **atraso subindo:** `atraso_medio_us` e `atraso_max_us`, relativos ao
  mínimo de 10 s, então sobem quando a fila de algum ponto do caminho
  cresce;
- **kbps recebidos:** para comparar com o que foi mandado (se o recebido
  fica abaixo do enviado por vários períodos, há fila);
- **RTT:** por `eco_tempo`/`eco_espera_us`.

**(sugestão, P2.4)** "Atraso subindo" = `atraso_medio_us` cresce em 3
relatórios seguidos (600 ms) e o último passa de 10 ms. Perda medida na soma
dos últimos 5 relatórios (1 s), para um pacote perdido isolado não derrubar
20 %. Com dois relays, a origem segue o pior dos dois (P3.2).

## 12. Vetores de teste

Chave de exemplo (32 bytes, hex): `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`.
HMACs calculados com `crypto.createHmac('sha256', chave)` do Node e
truncados em 16 bytes. Os testes cruzados do P2.2 devem: gerar estes bytes
no C++ e no JS a partir dos campos, comparar com o hex abaixo, e validar com
o leitor do outro lado.

### V1 — `VIDEO`, keyframe de um fragmento (52 bytes)

Sessão `0x12345678`, sequência 1, tempo 1.000.000 µs, quadro 1, fragmento
0 de 1, flags `KEYFRAME | FIM_DE_QUADRO` (`0x03`), payload de 8 bytes
`00 00 00 01 65 88 84 00` (início de um NAL IDR; não decodifica, é só
formato).

```
0000  47 4c 01 01 12 34 56 78 00 00 00 01 00 0f 42 40
0010  00 00 00 01 00 00 00 01 03 00 00 08 00 00 00 01
0020  65 88 84 00 8d e1 f6 1a c6 0f 92 c1 b5 b6 4f 6a
0030  57 86 2b 90
```

HMAC-SHA256 completo (para conferir a truncagem):
`8de1f61ac60f92c1b5b64f6a57862b90b5f7939f78c7c5128089af12e231d9aa`.

**Negativo:** trocar o bit 0 do byte 30 (`00` → `01`, dentro do payload) e
manter a etiqueta: o HMAC não confere e o pacote cai em `hmac`.

### V2 — `NACK` (54 bytes)

Sessão `0x12345678`, sequência 7 (sentido de volta), tempo 2.000.000 µs,
flags `VOLTA` (`0x08`), payload: `qtd = 1`, entrada quadro 2, fragmentos 3 e
4 (`primeiro = 3`, `quantidade = 2`).

```
0000  47 4c 01 03 12 34 56 78 00 00 00 07 00 1e 84 80
0010  00 00 00 00 00 00 00 00 08 00 00 0a 01 00 00 00
0020  00 02 00 03 00 02 11 45 fa c4 86 70 dc 09 d7 16
0030  e7 2e 4d 4e c8 08
```

### V3 — `RELATORIO` (84 bytes)

Sessão `0x12345678`, sequência 8, tempo 2.000.100 µs, flags `VOLTA`.
Payload: `intervalo_us` 200000, `esperados` 240, `recebidos` 235, `kbps`
9850, `atraso_medio_us` 1500, `atraso_max_us` 4200, `maior_seq` 1200,
`eco_tempo` `0x001E8000`, `eco_espera_us` 350, `quadros_completos` 12,
`quadros_vencidos` 0, `recuperados_fec` 3, `nacks` 2.

```
0000  47 4c 01 05 12 34 56 78 00 00 00 08 00 1e 84 e4
0010  00 00 00 00 00 00 00 00 08 00 00 28 00 03 0d 40
0020  00 f0 00 eb 00 00 26 7a 00 00 05 dc 00 00 10 68
0030  00 00 04 b0 00 1e 80 00 00 00 01 5e 00 0c 00 00
0040  00 03 00 02 7c 4f 3a 02 24 81 a1 0c 5b 97 2a 1b
0050  1a 1c 60 ce
```

### V4 — `FEC` de um datagrama cheio (1200 bytes, por regra)

Quadro 5, `n = 2`, `N = 10` → um grupo `[0, 1]`, `k = 2`, sem keyframe.
Fragmento 0: 1152 bytes, byte `j` = `j & 0xFF`. Fragmento 1: 5 bytes
`aa bb cc dd ee`. `FEC`: sessão `0x12345678`, sequência 16, tempo
3.000.000 µs, quadro 5, `i = 0`, `n = 2`, flags `0x00`, tamanho 1156
(`k = 2`, reservado 0, `xor_tamanhos = 1152 XOR 5 = 0x0485`, `xor_dados` de
1152 bytes).

```
0000  47 4c 01 02 12 34 56 78 00 00 00 10 00 2d c6 c0
0010  00 00 00 05 00 00 00 02 00 00 04 84 02 00 04 85
0020  aa ba ce de ea 05 06 07 08 09 0a 0b 0c 0d 0e 0f
...   (xor_dados segue igual ao fragmento 0 até o fim)
04a0  HMAC: 34 c7 a8 3a 2c 00 5a ca 3e e5 c2 07 f4 4e 11 75
```

SHA-256 do datagrama inteiro:
`13534af7549571596d40603b921d2fa3e0e7c90dd8343f9da215333f09445d25`.
Recuperar o fragmento 1 a partir do fragmento 0 e deste `FEC` deve dar
tamanho 5 e os bytes `aa bb cc dd ee`.

## 13. Decisões em aberto

- **MTU do Radmin VPN:** assumido ≥ 1280. Conferir com o `ping -f` da seção
  3 antes do P2.2 sair do laboratório.
- **Firewall e a porta efêmera do exe (9.2):** confirmar no P2.6 que a volta
  passa sem regra para o exe.
- **Tempo de captura por quadro:** não está na versão 1. O P2.8 (desvio
  áudio/vídeo) e uma medida de latência ponta a ponta precisariam dele; se
  precisar, entra como prefixo de 8 bytes no quadro e sobe a versão. Até lá
  o `timestamp` do `EncodedVideoChunk` sai de `quadro × 1e6 / fps`.
- **Vencimento fixo de 100 ms:** se o Radmin por relay mostrar RTT acima de
  ~80 ms, trocar por `clamp(2 × RTT + 30, 60, 200)` ms no P2.3 (é regra do
  receptor, não muda o fio).
- **Faixa UDP 9020–9030:** proposta; o P2.6 pode mudar sem mexer nesta spec
  além da seção 9.1.
- **Migração da sala e reconexão da sinalização:** a sessão UDP não depende
  do WebSocket depois de aberta, mas o `nativo-fim` e a regra de uma sessão
  por `(origem, kind)` usam peerIds. O P2.6 decide se as sessões sobrevivem a
  uma migração de dono (peerId retomado) ou se são refeitas; o fio não muda.

## Revisão (2026-11-25)

Revisão independente do P2.1. Os vetores V1–V4 (inclusive HMAC completo do
V1, SHA-256 do V4, o negativo e a recuperação por FEC) foram refeitos do zero
a partir só do texto e conferem byte a byte; `tools/videonativo/gerar-vetores.js`
produz o mesmo hex. Nenhuma mudança altera o formato no fio nem os vetores.

- **6.3 regra 7:** em `ESPERANDO_KEYFRAME` (ou sem `U`), a lacuna até o keyframe de recuperação disparava "descarta tudo e pede keyframe" para sempre; agora a regra só vale em `NORMAL` (e para deltas atrás de um keyframe em montagem), e lacuna > 8 com keyframe não pede nada.
- **6.3 regra 2:** delta que chega depois de um keyframe ainda em montagem não é mais descartado (antes, perda num keyframe custava um `NACK` de quadro inteiro do delta seguinte).
- **6.3 cabeçalho das regras:** "1, 2, 3 e 6 valem para os dois" deixava de fora a 4 (que cita `FEC`) e a 7; agora todas valem, exceto a 5.
- **6.4:** depois de entregar um keyframe, entrega os deltas seguintes já completos (antes só o delta fazia isso).
- **6.6:** o vencimento diz o que fazer com os deltas posteriores em montagem (descartar) e com um keyframe posterior em montagem (manter, sem pedir outro).
- **4.6 número do quadro:** é o contador da origem, comum às sessões dela; o receptor não pode supor que a sessão começa no quadro 1. Limite de quadro encerra com motivo 1 (o motivo 4 fica só para sequência, que é por salto).
- **5.6 pausa:** o primeiro quadro depois de uma pausa é keyframe (senão o encoder que seguiu rodando manda delta com referência não enviada, contra 6.2).
- **5.3 NACK:** o receptor manda no máximo 1 a cada 5 ms (até 200/s) e o emissor processava só 50/s, perdendo pedidos legítimos com perda alta; teto do emissor passa a 250/s.
- **5.3 NACK:** reenvio vai sempre ao endereço da sessão, nunca à origem do `NACK`; `primeiro + quantidade ≤ 1024`; depois de `0xFFFF` todos os fragmentos do quadro contam como pedidos.
- **5.3 relay:** "25 % do bitrate alvo" não existia no relay; passa a ser 25 % da taxa recebida da origem.
- **5.2/7 FEC:** regra de `L` estava errada para `N = 1`; `fecN = 0` deixava `i % N` indefinido (divisão por zero no C++); recuperação valida `tamanho_j ≤ L`.
- **5.6/5.7:** valores inválidos de `estado` (`OLA`) e `motivo` (`TCHAU`) passam a ter regra (descarta, `campo`).
- **5.5:** `atraso_medio_us`/`atraso_max_us` = 0 num período sem pacotes.
- **4.3 versão:** log "por endereço de origem" exigia tabela por endereço antes do HMAC, contra 4.5; passa a um log global a cada 60 s.
- **4.3 tempo:** conversão de `QueryPerformanceCounter` para µs sem estouro de 64 bits; `hrtime` em ns dividido por 1000.
- **2:** `SUSPEITA_MS` (20 ms) entra na tabela de constantes; `ESPERA_NACK_MS` também é o intervalo mínimo entre `NACK`.
- **8.1/8.5:** o WebSocket da sala é `ws://` sem TLS; numa LAN física sem VPN quem escuta lê a chave, então a regressão é de integridade também, não só de sigilo.
- **8.1:** registrado o que um receptor legítimo mal-intencionado ainda consegue (keyframe a cada 500 ms, perda falsa) e o que não consegue (refletir para terceiros).
- **8.2:** teste de "chave fora do log" cobre também o console do renderer, que vai para o log do main.
- **9.1:** socket `udp6` dual-stack (o `endereco` pode ser IPv6) e todo envio do main sai do mesmo socket (casa com o estado do firewall do lado do exe).
- **9.2:** o endereço de volta é aprendido só de pacote que avançou a janela de replay (antes "autenticado" deixava um pacote repetido de outro endereço redirecionar a volta).
- **9.3:** uma sessão de ida por `(origem, kind)` no receptor; sessão nova substitui a velha (`TCHAU` 6), com estado zerado.
- **10 regras 4 e 8:** o relay não garante keyframe no primeiro quadro do filho; `TCHAU` motivo 4 de cima não derruba os filhos, motivo 6 substitui as sessões deles.
- **13:** acrescentada a migração de dono da sala como questão em aberto do P2.6.
- **Implementação P2.2 (2026-11-26):** nada muda no fio; decisões tomadas no código: constantes em `src/main/videonativo/constantes.js` (a seção 2 dizia `protocolo.js`) e `native/media/protocolo.h`; sequência 0 é conferida no passo 7 da 4.5 (depois do HMAC e do `VOLTA`, antes da janela) e conta `campo`; HMAC do C++ é SHA-256/HMAC próprio (`native/media/sha256.cc`) nos dois sistemas em vez de BCrypt (8.3), para o código testado no Linux contra FIPS 180-4/RFC 4231 e V1–V4 ser o mesmo do Windows; regra 6 de 6.3: "o mais antigo" é o de menor número, e o pacote em curso é reavaliado desde a regra 1 depois do vencimento (por isso uma lacuna de exatamente 8 cria 8 vazias + `q` e vence a mais antiga na hora); regra 7 em `ESPERANDO_KEYFRAME`: a referência é o maior keyframe em montagem abaixo de `q`, e "lacuna" é `q − referência − 1`; 6.6: entrada vazia (tipo desconhecido) cai junto com os deltas; regra 2 + 5.4: delta descartado por `sem_referencia` sem keyframe em montagem marca `PEDIR_KEYFRAME` motivo 3 (senão um keyframe inicial perdido por inteiro parava a sessão), e a repetição a cada 500 ms fica calada enquanto há keyframe em montagem; a recuperação por FEC fica num gancho (`recuperarFec`) que o P2.3 chama no tempo da 6.5.

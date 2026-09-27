# 03 — Três conceitos de experiência e a escolha

Base: os briefs funcionais `01-functional-brief-app.md` e `02-functional-brief-mesa.md`. Nenhum conceito parte
da interface anterior; a pergunta foi "se o GoLive nascesse hoje, como seria a sala?".

Quem usa: um grupo de amigos numa LAN virtual, no Windows, quase sempre **enquanto joga**. A sala fica aberta num
segundo monitor ou atrás do jogo; a pessoa volta a ela aos relances. As tarefas que importam, em ordem de
frequência: entrar na sala dos amigos, ver quem está ao vivo e assistir, transmitir a própria tela, conversar,
jogar na Mesa.

## Conceito A — "Sinal" (mesa de corte)

Metáfora: a mesa de corte de uma transmissão ao vivo. Tudo o que se pode assistir é uma **fonte** — a tela de
cada pessoa, a câmera, e a própria Mesa. As fontes ficam num **barramento** único; o que está no palco é o
**programa**. Levar uma fonte ao palco é um clique; somar outra ao palco (multi) é um segundo gesto explícito.

```
┌ GoLive · Sala do Nick      ○○●○ 5 na sala   ● 2 ao vivo        ⚙  Sair ┐
│                                                                        │
│                          PROGRAMA (palco)                              │
│                  vídeo sangrando no vazio, sem moldura                 │
│                                                                        │
│  (conversa em modo espiar: as últimas mensagens surgem e somem aqui)   │
├────────────────────────────────────────────────────────────────────────┤
│ ● Ana · Valorant  ○○   ● Bia · Chrome ○   ◇ Mesa ○○○   ＋ Transmitir  │ Conversa 3 │
└────────────────────────────────────────────────────────────────────────┘
```

- Pessoas não têm lista própria: aparecem **onde está o papel delas** — quem transmite é uma fonte; quem assiste
  é um anel ligado à fonte que assiste; o elenco completo e a moderação abrem sob demanda.
- A sua transmissão é a sua fonte no barramento; pausar, trocar e parar ficam nela.
- A conversa tem três estados: fechada, **espiando** (mensagens novas aparecem sobre o palco e somem) e fixada.

## Conceito B — "Rede" (tudo num plano)

Metáfora: o próprio ícone. A sala é um plano com zoom onde cada pessoa é um nó; as telas são janelas presas ao nó
de quem transmite, e a Mesa é uma região do mesmo plano. Assistir é aproximar; multi-stream é enquadrar dois nós.

```
┌ Sala do Nick ─────────────────────────────── zoom ─ + ┐
│     ○ Caio           ┌──────────┐                     │
│         ╲            │ tela Ana │── ● Ana             │
│          ● Bia ──┐   └──────────┘                     │
│     ┌────────┐   │        ◇ Mesa ░░░░░░░░             │
│     │tela Bia│───┘                                    │
└───────────────────────────────────────────────────────┘
```

- Unifica Mesa e transmissões numa linguagem espacial só.
- Custa caro para quem joga: assistir exige enquadrar; "o que estou assistindo" depende do zoom; o chat não tem
  lugar natural; decodificar vídeo em janelas pequenas desperdiça banda.

## Conceito C — "Foco" (teatro e comando)

Metáfora: um player de cinema. A janela é só o palco; todo o resto mora num **painel de comando** (Ctrl+K) e em
bordas que se revelam com o mouse.

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                  vídeo, e nada mais                    │
│                                                        │
│              ┌ Ctrl+K ─────────────────────┐           │
│              │ > assistir bia              │           │
│              └─────────────────────────────┘           │
└────────────────────────────────────────────────────────┘
```

- Distração mínima durante o jogo; ótimo para quem já sabe o que quer.
- Pouco descobrível: quem chega não vê quem está ao vivo nem como transmitir; estados ficam escondidos.

## Avaliação

Nota de 1 a 5 (5 é melhor).

| Critério | A Sinal | B Rede | C Foco |
|---|---|---|---|
| Entrar numa sala rápido | 5 | 4 | 3 |
| Começar a transmitir rápido | 5 | 3 | 3 |
| Saber quem transmite | 5 | 4 | 2 |
| Saber o que estou assistindo | 5 | 2 | 4 |
| Várias transmissões | 4 | 4 | 2 |
| Chat sem competir com o vídeo | 4 | 2 | 4 |
| Quem é novo entende | 4 | 2 | 1 |
| Densidade de desktop | 4 | 3 | 3 |
| Usar durante o jogo | 4 | 2 | 5 |
| Pouca distração | 4 | 2 | 5 |
| Descobrível | 4 | 3 | 1 |
| Coerência (Mesa, câmera, telas) | 5 | 5 | 3 |
| Acessível (teclado, leitor) | 4 | 2 | 4 |
| Personalidade | 4 | 5 | 3 |
| **Total** | **61** | **43** | **43** |

## Escolha

**A — Sinal**, com duas ideias emprestadas, cada uma com motivo:

- de **B**, a **linguagem de nós do ícone** como sistema de estado das pessoas: anel vazado = está na sala, anel
  com ponto = está assistindo, nó vermelho sólido = ao vivo. Não é enfeite: é o estado real, lido de relance, e
  liga a interface ao ícone sem pintar nada de vermelho à toa.
- de **C**, o **modo teatro** (a moldura some e só o palco fica, uma tecla) e um **painel de comando** (Ctrl+K)
  como atalho para quem já sabe o que quer — nunca como único caminho.

O que foi descartado de propósito: lista fixa de pessoas ao lado do palco (a informação de quem está ao vivo passa
a morar nas fontes), barra de controles separada da fonte (a sua transmissão é controlada na sua fonte) e
configurações como destino de navegação (viram uma folha sobre a tela atual).

# Redesign visual — inspirado em Discord / apps profissionais de transmissão — design

Data: 2026-09-02
**Status: EM ANDAMENTO — brainstorm parte 1 apresentada e não confirmada pelo
usuário (troca de máquina interrompeu antes da resposta). Parte 2 nem começou.**
Retomar: reapresentar o resumo da Parte 1 abaixo, pedir confirmação explícita,
depois seguir para a Parte 2 (componentes, motion, acessibilidade, contrato de
`ui.js`, plano de teste) antes de escrever o doc final e chamar
`writing-plans`.

---

## Pedido original

> "estava pensando em fazer um redesign do projeto, quero que voce esqueça
> totalmente o design do projeto atual, mas mantendo suas funcionalidades,
> quero que planeje algo parecido com o discord, ou algum outro aplicativo de
> transmissao de tela profissional que possa ser utilizado por muitas pessaos
> tranquilamente"

## Decisões já travadas com o usuário (perguntadas via AskUserQuestion)

1. **"Muitas pessoas tranquilamente" não é sobre escala de transporte.**
   O teto real de participantes simultâneos (~4, arquitetura de árvore
   P2P — ver `docs/2026-08-27-auditoria-de-fragilidade.md` e a spec
   `2026-08-23-performance-e-redesign-design.md`) **fica como está**. O
   pedido é: a interface tem que ser óbvia pra gente não-técnica. Nada de
   SFU, nada de mexer em `mesh.js`/`tree.js`/sinalização.
2. **Profundidade da mudança: "Nova IA + novo visual".** Reescreve
   `index.html`, `style.css` e `ui.js` do zero — telas novas, fluxo novo,
   linguagem visual nova. `app.js` (3163 linhas, orquestra tudo) e o resto
   (`mesh.js`, `tree.js`, `autoquality.js`, `signaling.js`, `main.js`, etc.)
   **ficam intactos**: só os pontos onde `app.js` chama `ui.*` mudam de
   assinatura/uso. Os 266 testes de lógica continuam valendo — nenhum deles
   testa DOM/CSS.
3. **Primeiro uso: lobby auto-explicativo, sem wizard de onboarding.** Nada
   de passos numerados. A tela inicial já é a explicação: duas ações
   grandes (Criar sala / Entrar numa sala), salas da rede em destaque,
   painel de perfil pedindo o apelido de forma óbvia. Ajuda mora em texto
   inline e empty states escritos de verdade — não em um fluxo separado.
   Ficou fora de escopo (rejeitado explicitamente): trazer o teste de rede
   de `tools/testar-radmin.ps1` pra dentro do app — isso exigiria IPC novo
   no processo `main` e estouraria o limite "só renderer" da decisão 2.
4. **Direção de arquitetura de interface: "A + barra do C".** Ver wireframes
   abaixo. Rejeitado: "B — Discord literal" (rail de servidores não faz
   sentido pra uma LAN com 0 ou 1 sala — seria copiar a forma sem o
   conteúdo, e é estruturalmente o layout que já existe hoje); "C puro —
   palco primeiro" (density alta demais, contra o objetivo de ser óbvio pra
   leigo).

## Restrição inegociável herdada do sistema atual

**Nada de `backdrop-filter` / vidro fosco em lugar nenhum.** Não é gosto —
é físico: blur é trabalho contínuo de GPU por camada, na mesma GPU que o
encoder de vídeo (NVENC/AMF/QuickSync) e o jogo de quem transmite disputam.
Um visual "Discord glassy" custaria exatamente o recurso que
`2026-08-23-performance-e-redesign-design.md` (Parte I) tenta liberar. Dá pra
parecer moderno sem isso: opacidade sólida, elevação por luminosidade
(superfícies em degradê de cinza-escuro), bordas em alpha. Esta restrição
**se mantém** no redesign novo, mesmo esquecendo o resto do sistema visual
antigo.

---

## Parte 1 — Telas e regra visual (apresentada ao usuário, aguardando OK)

### A regra que organiza o tema novo

O sistema atual reserva cor de acento a **uma coisa só** (alguém ao vivo) e
distingue botão primário/aba ativa/seleção por elevação, não por cor —
elegante pra quem já conhece o app, mas ilegível pra quem abre pela primeira
vez ("Criar sala" e "Compartilhar tela" ficam cinza sobre cinza, iguais a
"Cancelar"). **O redesign inverte essa regra:**

| Cor | Emprego | Onde aparece |
|---|---|---|
| **Ação** — índigo `#4F46E5` | "é isso que você clica" | Criar sala, Conectar, Compartilhar tela, Ir ao vivo |
| **Ao vivo** — vermelho `#FF4D4F` | alguém está transmitindo | ponto no cabeçalho, selo AO VIVO, anel pulsante, borda do tile |
| **Atenção** — âmbar `#F5B544` | degradou, mas funciona | reconectando, qualidade baixada, firewall não liberado |

Vermelho pra "ao vivo" (não pra "perigo") é deliberado: é o símbolo de
gravação que todo mundo já lê, técnico ou não — e funciona porque o app
quase não tem ação destrutiva de verdade ("Desconectar" é reversível, vira
botão neutro rotulado "Sair da sala", não um botão de alarme). Nenhum estado
depende só de cor: selo ao vivo sempre traz ícone + palavra junto.

### As duas telas

**Lobby** (fora de sala) — janela inteira, coluna centrada:

```
┌──────────────────────────────────────────────────────┐
│  GoLive LAN                                 ↻  ⚙     │
│                                                        │
│         ┌────────────────┐  ┌────────────────┐       │
│         │  ▣ Criar sala  │  │  ⇥ Entrar numa │       │  ← índigo cheio
│         │                │  │     sala       │       │     e contorno
│         └────────────────┘  └────────────────┘       │
│                                                        │
│  Salas abertas na sua rede                    ↻       │
│  ┌────────────────────────────────────────────────┐  │
│  │ ●  Sala do João        2 pessoas    [Entrar]   │  │
│  ├────────────────────────────────────────────────┤  │
│  │ 🔒 Sala da Ana         3 pessoas    [Entrar]   │  │
│  └────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────┐    │
│  │ ◯  Nicolas                              ⚙    │    │
│  └──────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

**Sala** (dentro de sala) — palco toma tudo, membros à direita, controles
embaixo:

```
┌──────────────────────────────────────────┬───────────┐
│ ● Sala do Nicolas  26.7.1.3:9000 [Copiar]│  Na sala  │
│   🔒 PIN 4821                            │  ─────────│
├──────────────────────────────────────────┤ ◯ Nicolas │
│ ⚠ A porta não está liberada no firewall  │   (você)  │
│   [Permitir acesso à rede]               │ ◉ João ●AO│
├──────────────────────────────────────────┤   VIVO    │
│                                           │ ◯ Ana     │
│            [   vídeo do João   ]          │           │
│                                           │           │
├──────────────────────────────────────────┤           │
│  [▣ Compartilhar tela]  [🎥 Câmera]      │           │
│  [⏸ Pausar]                [Sair da sala]│           │
└──────────────────────────────────────────┴───────────┘
```

Coração da mudança: barra de controle inferior com **rótulo em texto em
todo botão**, alvo ≥44px, ação primária como única colorida. Hoje esses
quatro controles são ícones de 20px sem rótulo, empilhados no canto
inferior esquerdo junto do avatar do usuário.

### Mapa de continuidade — nada sai, tudo tem endereço novo

| Hoje | Depois |
|---|---|
| Lista "Ao vivo agora" na coluna esquerda | Cartões de sala no Lobby: nome, nº de pessoas, cadeado, botão "Entrar", estado de cooldown |
| Botão atualizar descoberta | Ícone ↻ no cabeçalho da seção de salas do Lobby |
| "Criar sala" (ghost pequeno) | Ação primária do Lobby |
| Checkbox "Proteger com PIN" solto entre botões | Dentro do fluxo de Criar sala — deixa de flutuar sem dono |
| "Entrar por endereço" + form revelado inline | Diálogo "Entrar numa sala", rótulo visível por campo (hoje é placeholder-only), campo de PIN só aparece quando a sala pede |
| Painel de usuário (avatar, nome, 4 ícones) | Lobby: cartão de perfil + ⚙. Sala: câmera/pausar/compartilhar migram pra barra de controle rotulada |
| Cabeçalho do palco (dot, nome, endereço, PIN, badge, copiar, desconectar) | Cabeçalho da Sala; "Desconectar" vira "Sair da sala", desce pra barra de controle |
| `stage-warning` do firewall | Faixa âmbar abaixo do cabeçalho, mesma posição, mesmo botão de retry |
| Grid de tiles, avatar, badge de tipo, rótulo, overlay "quem está assistindo", fullscreen, duplo clique | Idênticos em comportamento, re-vestidos |
| Fullscreen com PiP arrastável, strip, fixar, menu de escolha | Mantido inteiro — feature mais sofisticada do app, sem redesenho de interação |
| Menu de contexto do tile (mute + volume) | Mantido, alvos maiores, alternativa por teclado (pendente detalhar na Parte 2) |
| Lista de membros (borda de estado, AO VIVO com pulso, tag de qualidade) | Coluna direita da Sala; tag de qualidade ganha texto explicativo |
| Diálogo de compartilhar (abas Telas/Janelas, dica, grade, preset, banda, som, som do Discord) | Mantido inteiro, re-desenhado; preset ganha rótulo humano além do técnico |
| Configurações: Perfil / Voz e Vídeo / Rede / Estatísticas | Mantidas as 4 abas e todo conteúdo |
| Painel de estatísticas (enviando + recebendo + "Limitado por" + logs) | Mantido; números em fonte tabular; resumo de uma linha no topo |
| Banner de atualização com progresso, toast, `Ctrl+Alt+P` | Globais, inalterados em comportamento |

O status derivado (`offline / reconnecting / degraded / paused / live /
idle`, hoje em `src/renderer/status.js`) **continua vindo de `status.js`
sem mudar a lógica** — o redesign só muda como é pintado, e reescreve os
quatro rótulos de motivo (`REASON_LABELS`: "encoder em software", "sem
retransmissor", "máquina no limite", "sala cheia") pra linguagem menos
técnica — texto exato a fechar na Parte 2.

### Levantamento de strings voltadas ao usuário (feito, não decidido)

A maior parte do texto do app já está em português natural e claro (ex.:
`'Não consegui conectar. Confira o IP, se o servidor está rodando e se a
porta está liberada no firewall.'` em `app.js`). O jargão técnico real está
concentrado em dois pontos, a revisar na Parte 2:

- `src/renderer/status.js` → `REASON_LABELS` (encoder/malha/auto/sala).
- Tabela de estatísticas em `app.js` (`renderStats`): cabeçalhos como
  "encode", "rtt", "perda rede" pressupõem vocabulário de rede.

---

## Parte 2 — NÃO INICIADA

Falta cobrir antes de escrever o spec final e chamar `writing-plans`:

- Componentes: botões, cards, inputs, modais, tiles — estados (hover,
  pressed, disabled, focus) e tokens de espaçamento/raio/tipografia.
- Sistema de motion (durações, easing) substituindo o antigo
  `--ease-enter`/`--ease-move`/`--ease-drawer`.
- Acessibilidade: contraste dos três tons de superfície contra o texto,
  navegação por teclado no grid de tiles e no PiP, `aria-label` nos ícones
  sem rótulo que sobrarem (ex. ↻ de atualizar descoberta), respeito a
  `prefers-reduced-motion` (o CSS atual já zera durações nesse media query
  — replicar).
- Contrato de `ui.js`: como o módulo novo expõe as mesmas funções que
  `app.js` chama hoje (`showTile`, `removeTile`, `renderMembers`,
  `renderRooms`, `setStageHeader`, `setStageStatus`, `openSettings`,
  `setStatsHtml`, API do picker, etc.) — decidir se a assinatura muda ou só
  a implementação interna.
- Diálogo "Criar sala" (novo — hoje é um checkbox solto) e diálogo "Entrar
  numa sala" (novo — hoje é um form revelado inline na coluna esquerda):
  campos, validação, mensagens de erro.
- Plano de teste: os 266 testes existentes não tocam DOM, então continuam
  passando sem alteração; decidir se este redesign adiciona algum teste
  novo (ex. snapshot de `ui.js` puro) ou fica só validado a olho
  (`npm start`) antes de mergear — provável decisão: só a olho, dado que o
  projeto já registra em `STATUS.md` o hábito de "sem rodar o app à mão"
  como dívida a evitar repetir.
- Depois de tudo acima aprovado: escrever o design doc final consolidado,
  autorrevisão (placeholders, contradição, escopo, ambiguidade), pedir
  revisão do usuário, e só então invocar `superpowers:writing-plans`.

## Próximo passo imediato ao retomar

1. Reler este arquivo.
2. Reapresentar o resumo da Parte 1 (regra de cor, duas telas, mapa de
   continuidade) e pedir confirmação explícita do usuário antes de seguir —
   ele foi interrompido por troca de máquina antes de responder.
3. Seguir pra Parte 2 pergunta por pergunta (uma de cada vez, como manda
   `superpowers:brainstorming`).

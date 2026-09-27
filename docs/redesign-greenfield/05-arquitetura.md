# 05 — Arquitetura da experiência "Sinal"

Spec congelada em 2026-09-27. Fontes: `01`/`02` (o que o produto faz), `03` (conceito), `04` (sistema visual).
Nada aqui vem da interface anterior. A implementação pode consultar o código antigo só para achar pontos de
ligação (eventos, ids, funções); se algo do código antigo não couber aqui, muda o código, não a spec.

## 0. Princípios

1. **Uma coisa no palco por vez, e sempre dá para saber qual.** O programa mostra ou transmissões, ou a Mesa.
   O que você está assistindo tem o fio (`--c-wire`) nos dois lugares: na fonte e no tile.
2. **O estado mora no objeto.** Quem está ao vivo é uma fonte; a sua transmissão se controla na sua fonte; o
   volume de alguém se ajusta no tile dessa pessoa. Não há painel de controle genérico.
3. **Relance antes de leitura.** Tudo o que muda durante o jogo (ao vivo, pausado, recepção ruim, mensagem nova)
   é legível em meio segundo por forma e posição, não por texto longo.
4. **O vídeo não tem moldura.** Nada fica por cima de um vídeo parado; controles aparecem com o mouse ou o foco e
   saem sozinhos. Estado que não pode sumir (pausado, sem sinal) ocupa o tile inteiro com uma frase.
5. **Configuração é folha, não lugar.** Abrir preferências nunca tira você da sala nem para mídia.
6. **Toda ação tem teclado.** E todo contexto temporário devolve o foco para quem o abriu.

## 1. Mapa

```
Janela principal (quadro próprio no Windows: a cabeça é a barra de título)
├─ Início ............................ fora de sala
│   ├─ saudação + identidade (vira "como te chamam?" se não há apelido)
│   ├─ ações: Criar sala · Entrar por endereço
│   └─ Na sua rede: salas encontradas (ou estado vazio / sem rede)
├─ Sala
│   ├─ Cabeça: sala · endereço · PIN · menu da sala │ presença · avisos · saúde │ Configurações · Sair
│   ├─ Programa: vista Transmissão (tiles) OU vista Mesa
│   ├─ Barramento: fontes ao vivo · Mesa · sua fonte │ câmera · reagir · pôr na mesa · conversa
│   └─ Conversa: fechada · espiando · fixada
├─ Folhas (sobre qualquer lugar): Configurações · Diagnóstico
├─ Diálogos: Transmitir (seletor) · Criar sala · PIN · Confirmações · Imagem ampliada · Código de tema
├─ Popovers: Presença · Avisos · Menu da sala · Menu do tile · Emoji · Reações · Pôr na Mesa
├─ Painel de comando (Ctrl+K)
└─ Faixas e avisos rápidos
Janelas auxiliares: Splash · Espiar · Overlay (rabisco no monitor físico)
```

## 2. Início

Único trabalho: pôr você numa sala.

```
┌ ◦ GoLive          Radmin · 26.12.4.8 ⧉                         (N) ⚙  — □ × ┐
│                                                                             │
│   Boa noite, Nick.                                                          │
│   ┌──────────────┐  ┌───────────────────────────────┬────────┐              │
│   │ ＋ Criar sala │  │ 26.0.0.5:47800                │ Entrar │              │
│   └──────────────┘  └───────────────────────────────┴────────┘              │
│                                                                             │
│   NA SUA REDE · 2                                            ↻ Procurar     │
│   ─────────────────────────────────────────────────────────────────────────  │
│   ○○●○  Sala do Caio        26.3.1.9:47800   ● 1 ao vivo   🔒     Entrar ›  │
│   ○○    Churras             26.1.0.2:47810                        Entrar ›  │
│   ○○○   Sala antiga         26.8.0.1:47800   versão 0.20 — peça p/ atualizar│
└─────────────────────────────────────────────────────────────────────────────┘
```

- Composição ancorada à esquerda que ocupa a janela (revisto em 2026-09-27 a pedido do Nicolas: a coluna
  centrada de 760 px deixava tudo "no meio" e desperdiçava a largura). Abertura com a saudação à esquerda e a rede
  alinhada à direita; ações logo abaixo; lista de salas de ponta a ponta; rodapé com a versão no pé da janela; sem
  salas, o grafo do ícone ocupa o espaço que sobra. A saudação usa `--t-display`.
- **Sem apelido**: no lugar da saudação, "Como seus amigos vão te ver?" com campo de nome e o nó de avatar
  (clique troca a foto). Salvar é imediato ao sair do campo/Enter. Não bloqueia nada.
- **Criar sala** abre o diálogo (seção 7.2). **Endereço**: campo `host:porta` com `Entrar`; Enter envia;
  endereço inválido mostra erro abaixo do campo.
- **Linha de sala**: aglomerado de nós (até 5, depois "+n") com a contagem de pessoas; nome (`--t-heading`);
  endereço (`--t-data`); cadeado se pede PIN; versão diferente desabilita a linha e diz quem precisa atualizar.
  A linha inteira é um botão; `Entrar ›` fica visível sempre (não só no hover).
  O beacon não traz quem está ao vivo: a linha só mostra o que a descoberta sabe (pessoas, PIN, versão).
- **Entrando**: a linha escolhida vira "Conectando a Sala do Caio…" com o anel tracejado e `Cancelar`;
  as outras ficam desabilitadas. Recusa (PIN, cheia, banido, versão) volta aqui com a frase exata sob as ações.
- **Estados da lista**: procurando (esqueleto de 2 linhas + "Procurando salas…"), vazia ("Nenhuma sala anunciada
  na sua rede. Se seus amigos usam Tailscale, peça o endereço e entre por ele."), sem rede ("Nenhuma rede
  encontrada. Conecte o Radmin VPN ou o Tailscale."), só LAN (aviso curto sob o endereço de rede).
- Cabeça: marca (o grafo do ícone em 18 px) + "GoLive"; rede e IP (`--t-data`) com copiar; à direita o seu nó
  (abre o perfil na folha de Configurações), Configurações, e os controles de janela.
- Atualização disponível/baixada: faixa sob a cabeça (seção 9.3).

## 3. Sala — estrutura

```
┌ Sala do Nick ▾  26.12.4.8:47800 ⧉  PIN 482193     ○○●●○ 5 · ⚠1 · ▮▮▮   ⚙  Sair  — □ × ┐  cabeça 44
├──────────────────────────────────────────────────────────────┬──────────────────────┤
│                                                              │ Conversa      ◧  ×   │
│                         PROGRAMA                             │                      │
│                                                              │ Ana 21:04            │
│                                                              │ bora mais uma        │
│                                                              │                      │
│                                                              │ ┌──────────────────┐ │
│                                                              │ │ Mensagem…     ☺ ⎘│ │
├──────────────────────────────────────────────────────────────┴──┴──────────────────┤
│ ●Ana·Valorant ○○  ●Bia·câmera  ◇Mesa 4 ○○  │ ●Você·Tela 1 ⏸ ⇄ ■ │  ◉  ☺  ▭ 3      │  barramento 72
└────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Cabeça (44 px, arrastável)

- **Nome da sala ▾** (`--t-heading`) abre o **menu da sala**: Copiar endereço · Copiar PIN · Diagnóstico ·
  Mostrar ponteiros na Mesa (marca) · [líder] Só o líder mexe na Mesa · [líder] Travar tamanho das janelas ·
  [criador] Tentar liberar o firewall de novo · Encerrar sala / Sair.
- Endereço (`--t-data`, clique copia, confirmação "Copiado" no próprio lugar por 1,5 s) e PIN quando existir.
- **Presença**: aglomerado dos nós de todos (estado desenhado, seção 6 do `04`) + número. Abre o popover de
  presença (3.5).
- **Avisos**: só aparece quando há aviso; ícone + número na cor da severidade mais alta. Abre a central.
- **Saúde da conexão**: três barras (ok/atenção/perigo). Dica com o resumo; clique abre Diagnóstico.
- **Configurações** e **Sair** (texto, `quiet`). Sair pede confirmação só quando há consequência (você é o
  criador e a sala acaba, ou está transmitindo).
- Estados da sala mostrados como faixa sob a cabeça: reconectando ("Conexão perdida. Tentando voltar… 00:12"),
  migrando ("Nick saiu. Passando a sala para outra pessoa…"), firewall pendente (criador).

### 3.2 Barramento (72 px)

Da esquerda para a direita:

1. **Fontes ao vivo** — uma por mídia ao vivo de outra pessoa (tela e câmera são fontes distintas). Ordem: telas
   por ordem de início, depois câmeras. Rolagem horizontal quando não cabem (setas aparecem nas pontas).
2. **Mesa** — sempre presente: losango, "Mesa", nº de janelas, nós de quem está nela. Escolher = trocar o
   programa para a vista Mesa. Estando na Mesa, escolher qualquer fonte de vídeo volta para Transmissão.
3. Separador.
4. **Sua fonte** — sem transmitir: botão `primary` "＋ Transmitir tela". Transmitindo: nó vermelho, "Você",
   nome da fonte, número de quem assiste, e três botões compactos: Pausar/Retomar (⏸/▶, `Ctrl+Alt+P`), Trocar
   fonte, Parar. Pausada: nó tracejado e "Pausada" em `--c-live`.
5. Separador; à direita: **Câmera** (alternância com estado: desligada / abrindo / ligada), **Reagir**,
   **Pôr na Mesa** (só na vista Mesa), **Conversa** (com contador de não lidas em `--c-wire`).

**Fonte** (item): 56 px de altura. Nó 32 + nome (`--t-label`) + subtítulo (`--t-meta`: o que transmite, ou
"pausada", ou "sem sinal") + aglomerado de quem assiste. Estados:
- assistindo = fundo `--c-wire-soft` + fio de 2 px embaixo; não assistindo = neutro;
- pausada = subtítulo "Pausada" + nó tracejado; recepção ruim = marca `--c-warn` no canto do nó.

Interação:
- **Clique** = assistir só esta (vira a principal; as outras que você assistia saem do palco e liberam banda).
- **Ctrl+clique** ou o botão "＋ Ver junto" que aparece no hover/foco = somar ao palco.
- Hover/foco numa fonte assistida mostra "×" = parar de assistir.
- Menu de contexto / Shift+F10 = mesmo menu do tile (3.3).
- Teclado: o barramento é uma lista com setas ←/→, Enter = assistir, Ctrl+Enter = ver junto, Delete = parar.

### 3.3 Programa — vista Transmissão

- Fundo `--c-void`. Tiles com raio 4 e 8 px de respiro entre eles.
- **Arranjo**: 1 fonte = ocupa tudo (proporção preservada); 2 = lado a lado; 3–4 = grade 2×2; 5+ = grade
  calculada. Com 2+ fontes, o controle **Grade / Destaque** aparece no canto superior direito do programa
  (com o mouse). Destaque = a principal grande e as outras numa fileira de miniaturas embaixo.
  Duplo clique num tile = destacar esse; duplo clique no destacado = tela cheia.
- **HUD do tile** (aparece com mouse/foco, some 2 s depois de parado; nunca some com foco de teclado dentro):
  - faixa superior sobre um degradê `--c-scrim` curto: nó + nome + o que transmite · à direita: Rabiscar,
    Laser, Volume (ícone; hover abre o controle deslizante com %), Espiar, Tela cheia, ⋯, × (parar de assistir);
  - **menu ⋯**: Qualidade que você recebe (Auto / 1080p / 720p / 480p, com o motivo quando travado),
    Estatísticas desta fonte, Destacar, [líder] Pedir para parar.
- **Estados que não somem** (ocupam o tile, centrados, sobre o último quadro escurecido):
  - pausada: "Ana pausou a transmissão" + o nó tracejado;
  - conectando: nó da pessoa + "Conectando à tela da Ana…";
  - sem sinal / recuperando: frase do diagnóstico traduzido ("Sem contato com o computador da Ana. Tentando de
    novo…", "A Ana parou de enviar imagem.", "Recuperando a imagem…");
  - recepção ruim sem perder imagem: marca `--c-warn` fixa no canto inferior esquerdo com dica.
- **Palco vazio** (ninguém ao vivo): o grafo do ícone desenhado em traço fino `--c-line-strong`, e "Ninguém
  está transmitindo." + botão "Transmitir tela" + linha `--t-meta` "Quando alguém entrar ao vivo, aparece no
  barramento."
- **Ao vivo mas nada no palco** (você parou de assistir tudo): "Ana e Bia estão ao vivo." + um botão
  "Assistir Ana" por fonte (máx. 3).
- **Sua própria tela** não aparece no palco por padrão (eco visual). Um item "Ver minha prévia" no menu da sua
  fonte mostra um tile com o selo "Sua prévia".
- **Rabiscar**: ativa a camada de desenho do tile e uma régua flutuante no pé do tile: Caneta · Texto ·
  Desfazer (seu) · Apagar tudo (só a dona) · Concluir. Sua cor é a sua cor de pessoa. Fonte sem permissão: o
  botão fica desabilitado com dica "A Ana não liberou rabiscos."
- **Reações**: popover de 8 reações a partir do barramento; aparecem subindo no tile da fonte principal.
- **Tela cheia**: o tile ocupa o monitor; HUD igual; Esc sai.
- **Modo teatro** (`T` fora de campo de texto, ou menu da sala): cabeça, barramento e conversa se recolhem; ao
  encostar o mouse na borda superior/inferior eles voltam por cima. `T` ou Esc volta.

### 3.4 Programa — vista Mesa

A Mesa ocupa todo o programa. Os detalhes internos seguem o `02`; aqui, a forma:

- **Superfície**: fundo `--c-bg` com uma grade de pontos `--c-line` a cada 48 unidades (dá noção de escala
  ao aproximar). Carregando: "Abrindo a Mesa…" com o anel tracejado; nenhuma janela interativa até o retrato.
- **Janela**: superfície `--c-raised`, raio 10, fio `--c-line`; em foco, fio `--c-wire`. **Barra da janela**
  (32 px, a alça de arrastar): glifo do tipo · título (`--t-label`) · status curto (`--t-meta`) · marca
  **"Sua vez"** (fundo `--c-wire-soft`, texto `--c-wire`, anunciada ao leitor) · nó de quem pôs · ⋯ · ⤢ · ×.
  Abaixo de 60 % de zoom a barra mostra só o título. Quem está movendo aparece como contorno na cor da pessoa
  + nome dela na barra.
- **Controles da Mesa** (canto inferior esquerdo do programa, flutuando): − 100% + · Ver tudo · Mapa (liga e
  desliga o mapa, lembrado). O mapa abre acima deles: retângulos das janelas, sua moldura de vista em
  `--c-wire`, ponteiros das pessoas.
- **Travas ativas**: faixa fina fixa no topo do programa: "Só o Nick mexe nas janelas agora." / "Tamanhos
  travados pelo Nick."
- **Mesa vazia**: "A Mesa está vazia." + "Pôr na Mesa" + os 6 tipos mais usados como atalhos.
- **Pôr na Mesa**: popover do barramento (e `N` com a Mesa em foco) com busca e as categorias do `02` §8
  (Assistir e ouvir · Ferramentas · Noite de jogo · Jogos).
- **Área segura** para a Mesa = o programa menos os controles da Mesa e a faixa de trava.
- Avisos da Mesa usam o aviso rápido global (seção 9.2).

### 3.5 Presença (popover da cabeça)

```
┌ Na sala · 5 ──────────────────────────┐
│ AO VIVO                               │
│ ● Ana     Valorant · 3 vendo   Assistir│
│ ● Bia     câmera                 ⋯     │
│ NA MESA                               │
│ ◇ Caio    jogando Truco          ⋯     │
│ NA SALA                               │
│ ◉ Você    vendo Ana  ♛                │
│ ○ Duda    reconectando…          ⋯     │
│ ─────────────────────────────────────  │
│ Banidos (1)                      ▸    │   (só líder)
└───────────────────────────────────────┘
```

- Grupos por estado (ao vivo, na Mesa, na sala). Linha = nó + nome + estado curto + ação principal (Assistir,
  quando ao vivo) + ⋯. Coroa marca o líder.
- ⋯ : Assistir · Ver junto · Ir até na Mesa · [líder] Transferir liderança · Pedir para parar a tela · Expulsar
  · Banir. Ações destrutivas abrem confirmação com foco em Cancelar.
- Banidos (líder): lista com Readmitir.

### 3.6 Conversa

- **Fixada**: coluna de 340 px à direita do programa, entre cabeça e barramento. **Espiando**: sem coluna; as
  mensagens novas surgem empilhadas (máx. 3) no canto inferior esquerdo do programa, somem em 6 s, clique abre
  a conversa. **Fechada**: nada; só o contador no barramento.
- Botão Conversa no barramento alterna aberta/fechada; o botão ◧ no topo da conversa alterna fixada/espiando.
  Padrão: fixada acima de 1180 px de largura; espiando abaixo (a escolha manual fica guardada).
- Mensagens: agrupadas por autor em 5 min; primeira do grupo leva nó 24 + nome + hora (`--t-data`); eventos
  de sistema numa linha `--t-meta` com ícone; separador de dia. Imagens em miniatura (clique amplia; ⋯ tem
  "Pôr na Mesa").
- Compositor: campo que cresce até 5 linhas; ☺ emoji (popover com busca e recentes); ⎘ imagem (arquivo, colar,
  arrastar para a conversa); contador aparece a partir de 400/500; Enter envia, Shift+Enter quebra.
  Offline: campo desabilitado com "Sem conexão com a sala — as mensagens voltam quando reconectar."
- Não lidas: marca "Novas mensagens" na lista e contador no barramento.

## 4. Painel de comando (Ctrl+K)

Campo + lista filtrada de ações possíveis agora: Assistir <pessoa> · Ver junto <pessoa> · Transmitir tela ·
Pausar/Retomar · Parar de transmitir · Ligar/Desligar câmera · Abrir a Mesa · Voltar para Transmissão · Pôr na
Mesa: <tipo> · Abrir conversa · Modo teatro · Configurações: <seção> · Copiar endereço · Sair da sala.
Setas + Enter; Esc fecha. Fora de sala: Criar sala · Entrar em <sala> · Procurar salas · Configurações.

## 5. Transmitir (seletor)

Diálogo grande (até 960 × 640).

```
┌ Transmitir ─────────────────────────────── [ Telas | Janelas ] ── × ┐
│ ┌────────┐ ┌────────┐ ┌────────┐                                     │
│ │ ▓▓▓▓▓▓ │ │ ▓▓▓▓▓▓ │ │ ▓▓▓▓▓▓ │   miniaturas 16:9, nome embaixo      │
│ └────────┘ └────────┘ └────────┘                                     │
├──────────────────────────────────────────────────────────────────────┤
│ Qualidade [720p30 | 720p60 | 1080p30 | 1080p60]  12 Mb/s             │
│ Som  [Sem som ▾]     ☐ Deixar rabiscar                               │
│                                      Cancelar   [ Transmitir Tela 1 ] │
└──────────────────────────────────────────────────────────────────────┘
```

- Abre na hora; miniaturas chegam depois (esqueleto 16:9). Monitor único vem pré-selecionado.
- Seleção com `--c-wire`; duplo clique ou Enter transmite. O botão principal diz o nome da fonte.
- Som: Sem som · Som do PC · Som do PC sem o Discord · Só o Discord (as duas últimas só quando o complemento
  nativo existe; senão não aparecem).
- Trocar fonte: mesmo diálogo, título "Trocar fonte", botão "Trocar para <nome>"; qualidade e som não mudam.
- Lista vencida: "Essa fonte não existe mais. Atualize a lista." com botão Atualizar.

## 6. Folhas

Entram pela direita (560 px), com véu sobre o resto; o resto continua vivo por baixo (medido e tocando).
Esc/véu fecham; foco volta a quem abriu.

### 6.1 Configurações

Cabeçalho: "Configurações" + (se ao vivo) selo "AO VIVO" + ×. Navegação: segmentado rolável no topo com as
seções; a página é uma rolagem única com cabeçalhos fixos.

Seções: **Perfil** (nó 56 + trocar/remover foto, apelido) · **Transmissão** (qualidade padrão, deixar rabiscar
por padrão, som padrão) · **Câmera** (dispositivo, prévia) · **Som e avisos** (sons do app, avisar quando
alguém ficar ao vivo, testar sons com o histórico) · **Aparência** (temas: grade de amostras dos temas prontos,
acento próprio, tema próprio, temas salvos, importar/exportar código; erro de contraste com o primeiro problema
e o acento sugerido) · **Rede** (endereço, tipo de rede, anunciar novas salas) · **Atualizações** (versão,
procurar, estado do download, instalar — bloqueado em sala com o motivo) · **Sobre e suporte** (abrir pasta de
logs, versão).

### 6.2 Diagnóstico

Folha com uma tabela por fonte (enviando e recebendo): codec, resolução, fps, taxa, RTT, perda, jitter, caminho
(direto/retransmitido), encoder/decoder, qualidade escolhida × efetiva, alertas. Números em `--t-data`.

## 7. Diálogos

- **7.1 Genérico**: título, texto, ações à direita (principal por último), Esc/véu cancelam, foco preso,
  destrutivo começa em Cancelar e usa `danger`.
- **7.2 Criar sala**: nome (máx. 40), "Anunciar na minha rede" (lembrado), "Proteger com PIN". Estados:
  Criar → "Preparando a sala…" → "Aguardando a permissão do Windows…" → pronto (fecha e entra). Erro de porta
  ou servidor fica no diálogo.
- **7.3 PIN**: 6 dígitos em campo mono grande, erro "PIN errado. Restam N tentativas." / bloqueio com prazo.
- **7.4 Imagem ampliada**: imagem sobre o véu, Esc fecha, ⋯ Pôr na Mesa.
- **7.5 Transferir liderança / Expulsar / Banir / Encerrar sala**: frase com a consequência exata.

## 8. Janelas auxiliares

- **Splash** (360 × 240): o grafo do ícone se desenha (anéis, fios, nó vermelho acende), "GoLive" em Sora,
  e o estado em `--t-data`: "Procurando atualização…", "Baixando 42%", "Instalando…", "Abrindo…".
- **Espiar**: janela sempre-por-cima só com o vídeo; com o mouse, uma faixa com nó + nome e ×.
- **Overlay**: só traços, laser e reações, nas cores de pessoa; nenhum outro elemento.

## 9. Avisos

- **9.1 Central de avisos** (popover da cabeça): lista por severidade (grave `--c-danger`, atenção `--c-warn`,
  info `--c-text-2`), título + detalhe + ação + dispensar.
- **9.2 Aviso rápido**: acima do barramento, centrado, uma linha + ação opcional; um por vez (o novo
  substitui); `aria-live=polite`.
- **9.3 Faixas**: sob a cabeça, largura total, para estado que persiste — atualização (disponível: "Versão
  0.22 disponível." + Baixar; baixando: barra fina `--c-text` com %; pronta: "Pronta para instalar — reinicia
  o app." + Instalar agora, desabilitado em sala com o motivo), reconexão, migração, firewall.

## 10. Teclado

| Tecla | Onde | Ação |
|---|---|---|
| Ctrl+K | sempre | painel de comando |
| Ctrl+Alt+P | global | pausar/retomar sua transmissão |
| T | sala, fora de campo | modo teatro |
| C | sala, fora de campo | abrir/fechar conversa |
| M | sala, fora de campo | alternar Transmissão/Mesa |
| F | tile em foco | tela cheia |
| ←/→, Enter, Ctrl+Enter, Delete | barramento | navegar, assistir, ver junto, parar de assistir |
| Esc | sempre | fecha o contexto mais recente (popover → folha → diálogo → teatro → tela cheia) |
| + − 0, setas, N, F, Delete, Alt+setas, Shift+F10 | Mesa | como no `02` |

Atalhos de uma letra nunca disparam com foco em campo de texto.

## 11. Tamanhos

- Mínimo 900 × 600 (o app já impõe). Abaixo de 1180 de largura: conversa espiando. Abaixo de 1024: a sua fonte
  mostra só o nó e os três botões; fontes mostram só nó + nome. Abaixo de 720 de altura: barramento 60 px.
- Escala do Windows (125%, 150%): tudo em px CSS; ícones SVG; nada de imagem rasterizada na interface.

## 12. O que foi deixado de fora, de propósito

- Lista fixa de pessoas: substituída pelas fontes + presença.
- Configurações como tela: viraram folha.
- Controles permanentes sobre o vídeo: viraram HUD que some.
- Vermelho para qualquer coisa além de ao vivo (inclusive "sua vez", erro e botão de sair).

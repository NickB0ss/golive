# Roteiro manual — repasse de compartilhamento de tela

Data: 2026-09-11  
Escopo: GoLive LAN em 3 PCs Windows na LAN virtual (Radmin/Tailscale)

## Objetivo

Confirmar ou refutar se o repasse sem canvas cai em OpenH264 mesmo em 640x360 e 960x540, enquanto o repasse com canvas usa o encoder de hardware MediaFoundation. A comparação deve ser feita no app real, observando as linhas `[diag] tela->...` gravadas no log de cada PC.

## Preparação

1. Identifique os PCs como **A (origem/hospedeiro)**, **B (relay)** e **C (folha/espectador)**. Neste roteiro, A cria a sala e compartilha a tela; B recebe de A e repassa para C; C apenas assiste.

2. Instale exatamente a mesma versão do GoLive LAN nos três PCs. Registre a versão exibida pelo app e o commit/build usado em cada rodada. Não misture a build de baseline com a build candidata.

3. Confirme que os três PCs estão na mesma LAN virtual e que a sala conecta sem VPN adicional. Anote data, hora local e se Radmin ou Tailscale foi usado.

4. Use duas variantes da aplicação:

   - **Baseline/sem canvas no relay:** a variante em que `relayTo` envia a track remota recebida diretamente.
   - **Candidata/com canvas no relay:** a variante P4 em que o chamador cria `screenrelay.create(inbound.getVideoTracks()[0])`, envia a track do canvas e encerra o relay-canvas no ciclo de vida correto.

   O código consultado não mostra um seletor de runtime para alternar essas variantes. Se não houver esse seletor na build entregue, faça duas rodadas com builds/variantes identificadas; não trate a captura própria em canvas como prova de que o relay também passou pelo canvas.

5. Na configuração, deixe `cfg.network.tree` habilitado. O valor padrão em `config.js` é `tree: true`; confirme na configuração efetiva, pois a configuração salva pode ser antiga. Com a árvore ligada, a origem envia para um relay e o relay atende até dois filhos (`FANOUT_ORIGEM=1`, `FANOUT_RELAY=2`).

6. Para obter a topologia desejada, mantenha B e C elegíveis: nenhum deve estar transmitindo, minimizado/suspenso ou em cooldown por falha recente. Entre os candidatos, o código prioriza encoder não-software; depois penalidade de `msPerFrame`, menor RTT e, por fim, quem entrou primeiro (`joinedAt`). Não há no código consultado um comando para fixar manualmente “B” como relay. Se a eleição escolher C, registre isso e repita ajustando a ordem de entrada ou as condições de rede; a escolha por ordem de entrada/RTT não é garantia de um PC específico.

7. Feche sessões anteriores do GoLive nos três PCs antes de cada rodada, para não confundir arquivos. O logger cria um arquivo novo por execução em `app.getPath('userData')\logs`, com nome `golive-<timestamp>.log`; no Windows, descubra o caminho efetivo pelo diretório de dados do GoLive LAN, sem coletar nem enviar o nome de usuário do Windows.

8. Use uma atividade visual contínua e conhecida (por exemplo, mover uma janela e reproduzir um vídeo). Não altere a resolução manualmente durante a coleta, salvo nos passos em que isso for explicitamente anotado.

## Passos da rodada normal

Repita os passos 1–9 para a baseline e para a candidata, sempre registrando a variante e o build.

1. Inicie A, crie a sala e anote o horário `T0`. Inicie B e C, faça ambos entrarem e confirme que A é a origem do compartilhamento.

   **Esperado:** os três aparecem na mesma sala, sem tela preta persistente.  
   **Anotar:** horário, IDs exibidos quando disponíveis, quem foi eleito relay e qual PC ficou como folha.

2. Em A, inicie o compartilhamento de tela. Aguarde pelo menos 2 minutos sem minimizar as janelas. Em C, confirme que a tela chega por B; B deve continuar recebendo de A e enviando para C.

   **Esperado:** imagem contínua em C e uma linha de diagnóstico de saída em B identificada como repasse.  
   **Anotar:** horário do início efetivo, resolução observada no tile e qualquer congelamento, tela preta, renegociação ou erro.

3. Colete pelo menos 10 minutos de estabilidade, ou no mínimo 30 linhas de diagnóstico do repasse, o que for maior. Como o logger usa heartbeat de aproximadamente 15 s, não espere necessariamente uma linha a cada segundo.

   **Esperado na baseline:** em 640x360/960x540, confirmar se as linhas de B mostram `enc=OpenH264` e `SOFTWARE(CPU)`.  
   **Esperado na candidata:** confirmar se as mesmas faixas mostram `enc=MediaFoundation` (ou o nome exato de encoder MediaFoundation exposto no build) e `hardware`.

   **Anotar:** arquivo e PC, horário de cada mudança de encoder, `out=`, `cap=`, `limite=`, `alvoKbps=`, `realKbps=`, `msFrame=` e `degraus=`.

4. Em A, faça uma mudança visual intensa por 30–60 s e depois deixe a tela quase parada por 30–60 s.

   **Esperado:** C continua recebendo vídeo; o encoder não deve alternar repetidamente sem uma mudança de condição.  
   **Anotar:** intervalo da atividade, fps percebido e linhas que mudaram com `MUDOU`.

5. Encerre o compartilhamento em A e confirme que B e C deixam de exibir a tela. Reabra o compartilhamento e repita a coleta por pelo menos 2 minutos.

   **Esperado:** o repasse volta sem duplicação de imagem, sem transceptores aparentando acumular e sem tela preta persistente.  
   **Anotar:** horários de parar/voltar, primeira linha válida após o retorno e eventuais erros `[diag] relay de tela falhou`.

6. Opcionalmente, repita com B entrando antes de C e depois com C entrando antes de B, mantendo o mesmo tipo de rede.

   **Esperado:** a topologia pode mudar conforme RTT, saúde do encoder e `joinedAt`; isso não é falha por si só.  
   **Anotar:** topologia escolhida e motivo observável, sem afirmar que uma ordem “forçou” B se o log/topologia não confirmar.

## Rodada com banda limitada

1. Use clumsy ou NetLimiter no Windows para limitar o tráfego relevante da LAN virtual a aproximadamente **2 Mbps**, conforme a validação proposta no plano. Aplique a limitação de forma consistente durante toda a rodada; deixe atraso e perda desativados se a ferramenta permitir, pois o objetivo aqui é isolar o limite de banda.

2. Mantenha um espectador em `p2` (B ou C conforme o papel efetivamente eleito), A transmitindo e os outros dois na sala. Aguarde a adaptação estabilizar por pelo menos 10 minutos.

   **Esperado:** o app pode reduzir fps/qualidade por banda, mas não deve produzir `853x...` nem `427x...` numa build que já tenha a correção P1 (fator de escala só potência de 2); numa build sem P1, registre se essas dimensões aparecem.  
   **Anotar:** horário de ativação/desativação do limitador, valor configurado, `limite=bandwidth`, `cap=`, `out=`, `msFrame=` e todas as transições de `degraus=`.

3. Remova a limitação, aguarde pelo menos 2 minutos e confirme recuperação sem reiniciar o app.

   **Esperado:** a imagem recupera qualidade sem ciclo contínuo de degradação.  
   **Anotar:** tempo até a recuperação e a primeira linha posterior com `limite=nenhum`.

## Como ler e extrair o log

Cada linha é escrita pelo logger com timestamp ISO, nível e a mensagem do renderer. O formato da mensagem é:

```text
[2026-09-11T14:22:31.456Z] [info] [diag] tela->B (repasse de #17) enc=MediaFoundation hardware efic=sim cap=30fps out=640x360@30fps limite=nenhum alvoKbps=12000 escala=1 realKbps=2180 msFrame=8.4 degraus=g0/p0
```

(Formato a partir da correção P3 de 2026-09-11. Em builds anteriores não há o campo `escala=`, o encoder desconhecido aparece como `enc=? hardware` e `alvoKbps` é o alvo global, não o do espectador.)

Exemplo bom para a hipótese P4:

```text
[2026-09-11T14:22:31.456Z] [info] [diag] tela->C (repasse de #17) enc=MediaFoundation hardware efic=sim cap=30fps out=960x540@30fps limite=nenhum alvoKbps=12000 escala=1 realKbps=4200 msFrame=9.1 degraus=g0/p0
```

Exemplos ruins para a hipótese P4:

```text
[2026-09-11T14:25:02.000Z] [warn] [diag] tela->C (repasse de #17) enc=OpenH264 SOFTWARE(CPU) efic=sim cap=30fps out=640x360@30fps limite=cpu alvoKbps=12000 escala=1 realKbps=2100 msFrame=42.7 degraus=g0/p0
[2026-09-11T14:25:17.000Z] [info] [diag] tela->C (repasse de #17) enc=desconhecido desconhecido efic=sim cap=15fps out=640x360@15fps limite=bandwidth alvoKbps=2500 escala=1 realKbps=1900 msFrame=18.2 degraus=g1/p2
```

`enc=desconhecido` (ou `enc=?` em builds antigas) não é evidência de hardware nem de software: o Chromium não expôs `encoderImplementation`. `alvoKbps` é o alvo do espectador daquela linha (em builds antigas era o alvo global). `escala=` é o fator que o app calcula para aquele espectador, não o valor lido do sender. `cap` é a taxa observada da mídia, não a taxa garantida da captura. Para aceitar hardware, exija um nome conhecido e explícito.

No PowerShell, extraia somente linhas de repasse de um arquivo:

```powershell
Select-String -Path .\golive-2026-09-11T*.log -Pattern '\[diag\].*tela->.*\(repasse de #[^)]+\)'
```

No Prompt de Comando:

```cmd
findstr /R /C:"[diag]" golive-*.log | findstr /C:"(repasse de #"
```

Se o `findstr` não casar os colchetes como desejado, use apenas o segundo filtro por texto literal ou faça a extração pelo PowerShell.

## Critérios de aceitação

Considere uma condição válida somente com pelo menos 30 linhas de repasse com encoder conhecido (`enc` diferente de `?`) e com topologia A→B→C confirmada.

- **Com canvas:** pelo menos 95% das linhas de repasse com encoder conhecido devem indicar explicitamente `enc=MediaFoundation` e `hardware`. As demais devem ser investigadas; não as classifique como hardware por `enc=?`.
- **Sem canvas:** a hipótese é confirmada se pelo menos 95% das linhas conhecidas em 640x360 ou 960x540 indicarem `enc=OpenH264 SOFTWARE(CPU)`; é refutada se pelo menos 80% indicarem MediaFoundation/hardware nessas mesmas faixas.
- Em cada condição, pelo menos 90% das linhas devem ter `msFrame` dentro do orçamento do fps-alvo: 16,7 ms a 60 fps, 33,3 ms a 30 fps, 66,7 ms a 15 fps. Se o `cap` não refletir o fps-alvo, marque o caso como inconclusivo e envie os dados para análise.
- Não deve haver `limite=cpu` persistente: no máximo duas linhas consecutivas ou cerca de 60 s, salvo justificativa documentada de banda/CPU. Registre qualquer ciclo de `degraus`.
- Na rodada a ~2 Mbps, não deve haver `853x` nem `427x` em nenhuma linha de uma build com P1. Compare o resultado da baseline separadamente; a presença na baseline é evidência do problema, não falha do teste.
- O vídeo deve permanecer visível em C durante a coleta, sem tela preta persistente após iniciar, parar e reiniciar o compartilhamento.

Se houver menos de 30 linhas conhecidas, topologia diferente de A→B→C, ou `enc=?` na maioria das linhas, marque a rodada como **inconclusiva**, não como aprovada ou reprovada.

## O que enviar de volta

Para cada rodada (baseline e candidata), envie apenas:

- o(s) arquivo(s) `golive-*.log` completo(s) de A, B e C, preservando o nome do arquivo;
- a versão/build da aplicação e a variante testada (sem canvas ou com canvas no relay);
- uma tabela curta com horário T0, horários de início/fim, topologia observada A→B→C, limitador usado e limite configurado;
- as linhas extraídas de repasse, se for útil, além dos logs completos;
- observações de tela preta, congelamento, troca de encoder, `limite=cpu`, `limite=bandwidth`, `degraus` e reconexões.

Não envie nomes de usuário, caminhos completos que contenham dados pessoais, conteúdo capturado da tela, tokens, convites, endereços IP públicos ou qualquer outro dado pessoal. Se o caminho do log contiver o nome do usuário Windows, copie o arquivo para uma pasta de coleta neutra antes de compartilhar, mantendo o nome original do arquivo.

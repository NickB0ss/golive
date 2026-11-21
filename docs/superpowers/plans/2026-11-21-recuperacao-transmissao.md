# Correção da recuperação de transmissão

> Execução nesta conversa com subagentes e revisão integrada, autorizada pelo usuário.

**Objetivo:** recuperar vídeo sem reconexão manual, liberar negociações obsoletas,
repetir ajustes de captura que falharam e distinguir a entrada de frames do custo do canvas.
**Base:** `7afe308`, GoLive 0.28.0.
**Especificação:** `docs/2026-11-21-diagnostico-lags-jogos.md`.

## Restrições globais

- Preservar a árvore, o protocolo, o design, a versão e as alterações locais preexistentes.
- Sem dependências novas, commit, push ou release nesta entrega.
- Uma falha antiga nunca pode fechar ou alterar o estado de uma conexão nova.
- Recuperação direta respeita sessão, peer, papel na árvore e pausa; folhas recebem do relay.
- Novas rotinas assíncronas têm cancelamento lógico e testes de conclusão tardia.
- Cada responsável edita só os arquivos que lhe foram atribuídos; integração em `app.js` é do coordenador.
- A evidência principal é vídeo chegando e sendo exibido no Electron, além dos testes unitários.

## Divisão e modelos

| Tarefa | Responsável | Modelo e esforço | Arquivos |
|---|---|---|---|
| 1. Negociação com prazo e invalidação | Subagente negociação | GPT 6.2 Astra, high | `mesh.js`, testes de mesh |
| 2. Aplicação confiável de constraints | Subagente captura | GPT 6.2 Sol, high | Novo `capturequality.js` e seu teste |
| 3. Telemetria dos estágios locais | Subagente frames | GPT 6.2 Sol, high | `screenrelay.js`, seu teste |
| 4. Recuperação e integração | Coordenador | Modelo desta conversa | `app.js`, `broadcastguards.js`, bootstrap e testes de integração |
| 5. Revisão do conjunto | Subagente independente | GPT 6.2 Astra, xhigh | Somente leitura do diff e relatório |

## Atenção na revisão

- Fechar ou substituir PC durante um await, seguido de rejeição/conclusão antiga.
- Uma oferta sem resposta, troca de fonte ou peer que sai durante recuperação.
- Um pedido direto de folha e recuperação de câmera/tela com pausa ativa.
- `applyConstraints` rejeitar, receber outro alvo durante a espera ou terminar depois do reset.
- Entrada de frames estática versus pipeline encerrado; métricas ausentes não viram zero inventado.

## Tarefa 1

- [x] Reproduzir travas de negociação que sobrevivem a fechamento e operação pendente.
- [x] Usar identidade de operação/PC, prazo limitado e limpeza por identidade.
- [x] Proteger todo efeito após await; resposta antiga não derruba PC nova.
- [x] Exercitar oferta, remoção de track, ICE restart e encerramento.

## Tarefa 2

- [x] Testar falha, retry, serialização, coalescência e reset antes da implementação.
- [x] Expor `capturequality.create(opts)` com `request(track, constraints)` e `reset()`.
- [x] Confirmar aplicação somente após sucesso; retentar falha transitória com backoff limitado.
- [x] Produzir contexto de erro com constraint e tentativa; parar retry ao encerrar a track/resetar.

## Tarefa 3

- [x] Testar contadores, tempos, troca de fonte, contexto perdido e erro/stop do loop.
- [x] Expor `screenRelay.stats()` com contadores acumulados e relógio monotônico.
- [x] Manter a semântica de repetição, fechamento de VideoFrame e track de saída.
- [x] Nenhum log nem objeto de telemetria criado por frame.

## Tarefa 4

- [x] Reproduzir recuperação ausente em teste do adaptador e bloquear folha/peer/sessão inválidos.
- [x] Recriar conexão esperada mesmo ausente, reaplicando pausa e qualidade por destinatário.
- [x] Integrar controlador de constraints no início, troca e encerramento da captura.
- [x] Registrar entrada/canvas em heartbeat, com deltas e sem confundir com captura WGC nativa.
- [x] Executar bancada no Electron com conexão ausente, oferta interrompida e recuperação de frames.

## Tarefa 5 e validação

- [x] Revisão independente de conformidade e concorrência; resolver achados relevantes.
- [x] Suíte de testes, lint, smoke de boot e bancada real apropriada às mudanças.
- [x] Registrar resultados e limites no repo e atualizar a nota durável existente no vault.

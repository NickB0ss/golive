# Transmissão e arquitetura — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute as tarefas com revisão independente. Não criar commits: as alterações serão integradas ao workspace original após revisão.

**Goal:** corrigir ambiente, adaptação e áudio, extrair os núcleos testáveis e entregar bancadas executáveis para decidir captura e SFU local com evidência.

**Architecture:** preservar Electron/WebRTC e a compatibilidade do protocolo atual. Extrair política de qualidade, telemetria e ciclo de captura em módulos puros/adaptadores. Manter experimentos de mídia separados do aplicativo de produção.

**Tech Stack:** JavaScript, Electron, WebRTC, Node test runner, WASAPI/N-API; mediasoup apenas no experimento opcional.

**Spec:** `C:/Users/nicol/Desktop/golive/02-research/2026-10-05-transmissao-e-arquitetura.md`, autorizado pelo usuário em 05/10/2026.

## Global Constraints

- Workspace de implementação: `C:/Users/nicol/Desktop/golive/.worktrees/transmissao-2026-10-05`.
- Não alterar prints, logs pessoais ou outros worktrees; não criar commits, publicar, fazer push ou mudar firewall.
- O usuário autorizou expressamente mídia, captura e arquitetura; a regra de preservação da lógica no AGENTS do redesign não proíbe estas mudanças solicitadas agora.
- UI mantém o visual; novas frases usam `t()` e os dicionários pt-BR, en, es juntos.
- Não substituir o transporte de produção por SFU, remover canvas globalmente ou prometer novos codecs sem benchmark.
- Captura pessoal é opt-in na bancada. Testes automatizados usam conteúdo sintético ou janela criada pela própria bancada.
- Uma implementação por vez; pesquisa somente leitura pode ocorrer em paralelo. Revisão por tarefa antes da próxima implementação.
- Testes focados durante cada tarefa; suíte completa, lint e smoke ao integrar. Nunca mascarar indisponibilidade do runtime como teste aprovado.
- Cada agente deixa relatório e arquivos alterados em `.superpowers/sdd/2026-10-05-transmissao-e-arquitetura/task-N-report.md`.

## Review Focus

- Membros ociosos e streams suspensas não diminuem qualidade; descendants de relay ainda têm custo real (T2).
- Destinatário lento não impõe sua BWE aos demais; múltiplas origens continuam isoladas (T2/T4).
- Captura nativa recusada não produz falsa confirmação de som; cancelamento libera recursos (T3).
- Reinício ou troca de conexão não contamina taxas/deltas com estatísticas antigas (T4).
- Experimentos não anunciam sala, alteram firewall nem capturam desktop sem escolha explícita (T5/T6).

## Task 1: Ambiente reproduzível e diagnóstico do runtime

**Files:** criar `scripts/check-environment.js`, teste correspondente, módulo puro `src/main/runtime-info.js` e teste; modificar package/lock, `.github/workflows/ci.yml`, `.github/workflows/lab.yml` se necessário, `eslint.config.js`, `src/main.js`, README.

**Interfaces:** `checkEnvironment(rootDir, opts)` retorna diagnósticos estruturados comparando manifesto, lock e Electron instalado; CLI `npm run env:check` retorna erro em divergência real. `runtimeInfo()` produz metadados de versão/plataforma sem importar Electron em Node.

- [ ] Escrever testes: pacotes ausentes, instalação divergente, coerência, lock inválido; runtime sem Electron no Node.
- [ ] Implementar verificação sem depender de pacote transitivo não declarado. Comparar versão exata instalada de Electron com a resolvida; raiz do lock deve concordar com manifesto. Binary check, se houver, é explícito, pois a CI instala sem scripts.
- [ ] Alinhar Node suportado por ferramentas e CI; usar versões 22/24 se compatíveis com os requisitos reais das dependências. Não atualizar Electron para versão distinta da lock por conveniência.
- [ ] Acrescentar metadados ao log inicial, preservar redaction existente.
- [ ] Excluir `.worktrees/**`, `.claude/**`, `.superpowers/**` e artefatos próprios do lint; documentar instalação reprodutível com addon explícito.
- [ ] Rodar testes focados e lint dos arquivos mudados, registrar resultado e diagnóstico real (Electron local desatualizado deve ser detectado, não ocultado).

## Task 2: Política de qualidade por carga e orçamento por conexão

**Files:** criar `src/renderer/qualitypolicy.js` e teste; modificar `config.js`/testes, `tree.js`/testes, `app.js`, `index.html`; alterar helpers relacionados apenas se necessário à integração.

**Interfaces:** módulo puro `GoLive.qualitypolicy` decide carga de encode local e orçamento de relay; recebe snapshots de senders/demanda. `qualityFor(kind)` mantém formato existente. Nunca inferir capacidade global pela menor BWE de conexões independentes.

- [ ] Testes de quatro/seis membros com um envio ativo versus vários envios, sender suspenso, câmera fora da política de tela, relay servindo filhos e ausência inicial de stats.
- [ ] Substituir desconto por presença por custo local efetivo ou planejado de senders; a regra de proteção inicial pode usar três envios ativos, nunca três membros ociosos. Preservar autoquality e fallback conservador.
- [ ] Retirar `myAvailableBps = min(BWE)` da política global. BWE por sender permanece aplicada somente à conexão correspondente; orçamento agregado, se presente, deve ser explícito e distinto. Preservar uma proteção inicial documentada para múltiplos filhos sem inventar upload global.
- [ ] Usar carga normalizada ao alvo de FPS na eleição de relay, com fallback compatível para saúde antiga/ausente. Testar 20 ms em 30 FPS versus 60 FPS.
- [ ] Integrar sem mudar mensagens do protocolo. Definir ciclo de reaplicação na entrada/saída, suspensão/retomada e árvore; evitar lógica circular entre contagem e oferta.
- [ ] Testar cenários relevantes e registrar decisões e limites. Não colocar toda a implementação nova dentro de app.js.

## Task 3: Captura de áudio com falha explícita e ciclo de vida seguro

**Files:** criar helper puro `src/renderer/audio-capture.js` e teste; modificar `app.js`, `index.html`, dicionários, comentários de suporte em `src/main.js` e `native/src/loopback_capture.h`; módulo main de capacidade se necessário.

**Interfaces:** helper monta e acompanha fontes nativas, reportando se alguma captura iniciou, falhas parciais e stop idempotente. Track só é anexada após origem válida; modo dinâmico include-list distingue ausência momentânea de som de falha de API.

- [ ] Testes de recusa na captura base, mistura parcial com Discord, nenhum processo tocando ainda, processo desaparecendo, cancelamento durante await, stop repetido.
- [ ] Em falha nativa, mostrar aviso localizado e seguir vídeo sem afirmar que o áudio selecionado funciona. Nunca ampliar automaticamente a captura da janela para sistema inteiro.
- [ ] Aplicar a mesma regra em início e troca de fonte, preservando a transmissão anterior quando troca fracassa. Uma lista vazia de processos não prova incapacidade: continuar polling quando válido.
- [ ] Verificar suporte WASAPI real/erro estruturado; corrigir referência de build mínimo para 20348 sem confundir addon carregado com captura funcional.
- [ ] Extrair o gerenciamento necessário do app.js e garantir liberação dos nós, tracks e capturas em falha/cancelamento.
- [ ] Rodar testes de áudio/sourceswap/i18n e lint focado; registrar resultado.

## Task 4: Telemetria extraída e contratos compartilhados

**Files:** criar módulo `src/renderer/txstats.js` e testes; modificar `rxstats.js`/testes, `app.js`, `index.html`; criar `src/shared/` para domínio compartilhado de sucessão, com adaptação dos consumidores/testes; documentar arquitetura vigente.

**Interfaces:** leitura de sender e derivação de taxas deixam app.js; amostras recebem relógio explícito. RX oferece métricas recentes por delta com ausência explícita após reset; preservar compatibilidade das APIs usadas na UI.

- [ ] Testar reset de contadores/conexão, zero frames, codec apontado por codecId e par ICE selecionado por transportId/selectedCandidatePairId, além de fallback quando campos faltam.
- [ ] Extrair readSenderReport/deriveRates sem duplicação, isolando estado por conexão, kind completo e geração quando disponível.
- [ ] Mostrar/registrar buffer de jitter recente por delta; não interpretar média acumulada como atraso atual nem RTT como latência de imagem.
- [ ] Mover um domínio puro compartilhado completo (sucessão) para `src/shared/`, manter adaptador compatível se necessário e mudar servidor para importação correta. Não fazer renomeação em massa de modelos Mesa nesta entrega.
- [ ] Documentar fronteiras mídia/sessão/UI, caminho de migração gradual para imports explícitos e protocolo versionado; não relaxar trava de versão atual sem matriz de compatibilidade.
- [ ] Rodar testes de telemetria, sucessão e sinalização afetados; registrar resultado.

## Task 5: Bancada Windows para captura e teste de abertura

**Files:** `tools/media-bench/` (launcher, Electron main/preload/renderer, métricas, testes e README), scripts npm e workflow de smoke se executável na CI.

**Interfaces:** CLI lista cenários; modo sintético produz relatório JSON com runtime, estratégia, quadros, resolução, codec/encoder, encode/decode/buffer, CPU quando disponível e falhas. Comparar direct/canvas e relay; captura de janela própria em modo explícito.

- [ ] Consultar o parecer do agente de arquitetura antes de fechar APIs.
- [ ] Criar conteúdo animado determinístico, contexto isolado, perfis temporários, fechamento no timeout e nenhuma alteração de firewall ou anúncio na rede.
- [ ] Implementar caminhos direta/canvas/relay usando os módulos de produção sempre que possível; não confundir canvas sintético com captura WGC real.
- [ ] Adicionar modo de captura da janela criada pela bancada e instruções de execução em múltiplos PCs; tela pessoal fica fora do modo automático.
- [ ] Acrescentar smoke do app que detecta renderer morto/erro de boot, sem forçar auto-update ou sobrescrever perfil pessoal.
- [ ] Testar agregação/configuração e executar os modos permitidos no runtime disponível. Reportar indisponibilidade honestamente e manter resultados identificáveis.

## Task 6: Prova de conceito de SFU local sem transcodificação

**Files:** `tools/sfu-spike/` com package/lock próprios, main/controlador, cliente e README; integrar saída de métricas com a bancada quando possível. Dependências do experimento não entram no instalador do app.

**Interfaces:** executar origem sintética e N consumidores em loopback, encaminhando via mediasoup local; relatório evidencia RTP recebido, frames e ausência de encoder no SFU. Todas as portas fecham ao terminar.

- [ ] Implementar uma representação inicial H.264 preferencial com negociação efetiva registrada; não declarar hardware a partir de capabilities.
- [ ] Criar consumidores pausados até cliente pronto, tratar encerramento de producer/consumer/transport/worker, erros e timeout.
- [ ] Suportar isolamento de consumidor lento/desligado sem parar os demais; descrever limite de representação única.
- [ ] Dependências e binários opcionais: instalar e executar com aprovação de rede quando necessária, sem mudar transporte de produção.
- [ ] Testes de orquestração e execução sintética se suporte local permitir. Registrar resultados e critérios de comparação, sem substituir benchmark multi-PC.

## Integração final

- [ ] Revisão independente por tarefa, com diff completo e relatório do implementador.
- [ ] Revisão ampla final por GPT-6 Astra/high, correção dos achados e revisão das correções.
- [ ] Testes e lint globais após integração; validar entradas HTML e scripts do pacote.
- [ ] Aplicar os diffs revisados ao workspace original com contexto, preservando mudanças alheias.
- [ ] Entregar inventário de mudanças, resultados, comandos de bancada e limites de hardware/rede que ainda exigem PCs reais.

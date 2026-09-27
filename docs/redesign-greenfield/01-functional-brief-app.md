# GoLive LAN — Functional brief sanitizado

## Escopo e princípios de produto

- Produto: aplicativo desktop Windows para uma sala temporária em rede local ou rede virtual privada, sem conta e sem serviço de mídia em nuvem.
- Necessidade principal: uma pessoa transmite a tela de um jogo ou aplicativo em até 1080p60 e outras acompanham com baixa latência, áudio opcional e interação social.
- A sinalização é hospedada pela pessoa que cria a sala; a mídia é WebRTC P2P. Retransmissão é automática quando necessária.
- A sala só aceita instalações na mesma versão. Compatibilidade deve ser conhecida antes de tentar entrar quando houver anúncio de rede e validada novamente no servidor.
- Papéis são cumulativos e mudam durante a sessão: criador da sala, líder da sala, pessoa transmitindo tela, pessoa com câmera ligada, pessoa assistindo uma origem e pessoa que apenas está na sala.
- “Criador” é a instalação que abriu a sala originalmente. “Líder” é quem tem autoridade de moderação naquele instante; pode ser transferida e pode sobreviver a uma migração. Não presumir que líder e criador são sempre a mesma pessoa.
- Importância: primária.

## Estados globais

- Fora de sala: descoberta, endereço local, perfil, criação, entrada manual, atualização e configurações continuam disponíveis.
- Entrando: a tentativa deve ter estado pendente; impedir duplicação, permitir cancelamento quando ainda não houver conexão estabelecida e explicar o alvo.
- Em sala sem mídia: mantém presença, chat, Mesa, moderação e possibilidade de iniciar tela/câmera.
- Em sala com mídia: transmissão e recepção são estados independentes por origem e por tipo de mídia.
- Reconectando: a sessão anterior, sua mídia local e o último quadro recebido podem ser preservados enquanto a reconexão é viável; ações que exigem sinalização devem informar indisponibilidade temporária.
- Migrando: a sala perdeu o líder e tenta eleger/achar sucessor; preservar pessoas, PIN, banidos, chat e estado da Mesa quando a migração tiver êxito.
- Encerrando/encerrada: interromper captura local, recepção, áudio, presença e bloqueio de suspensão; retornar ao estado fora de sala com motivo compreensível.
- Atualização em andamento: a instalação pode baixar atualização, mas não pode reiniciar/instalar enquanto estiver numa sala.

## Primeira execução e perfil

### Entrada inicial

- Quem pode: qualquer pessoa fora de sala.
- Gatilho: primeira abertura ou abertura sem configuração válida.
- Pré-condições: nenhuma conta, convite ou conexão externa é exigida.
- Resultado: gerar e persistir um identificador único de instalação; iniciar com apelido vazio, avatar ausente, sons e avisos de transmissão ligados, descoberta habilitada, retransmissão habilitada e qualidade 1080p60.
- Estados: configuração nova; configuração legada migrada; configuração inválida/corrompida recuperada com valores seguros.
- Feedback: explicar que é preciso criar ou entrar numa sala e mostrar se existe endereço IPv4 utilizável.
- Casos de borda: não há assistente obrigatório; apelido ausente é aceito e aparece como identidade anônima até ser definido.
- Importância: primária.

### Editar perfil

- Quem pode: qualquer pessoa; pode ser aberto dentro ou fora da sala.
- Gatilho: ação de editar identidade.
- Dados recebidos: apelido textual e foto opcional.
- Pré-condições: nenhuma para editar; a identidade atual deve ser preservada se a foto falhar.
- Resultado: persistir apelido e avatar e atualizar a identidade local imediatamente. A mudança de nome durante a sala deve seguir o contrato atual de sinalização ao entrar novamente; o redesign deve deixar claro quando uma alteração não rebatiza presença já anunciada.
- Estados: sem avatar, avatar carregando, avatar válido, avatar recusado, avatar removido.
- Limites: avatar serializado até 64 KiB; imagens não GIF podem ser reduzidas/recompactadas; GIF acima do teto é recusado para não perder a animação silenciosamente.
- Feedback: prévia da identidade e erro específico de tipo/tamanho quando aplicável.
- Importância: secundária.

## Rede, descoberta e entrada

### Estado de rede e endereço

- Quem pode: qualquer pessoa fora de sala.
- Gatilho: abertura, atualização da descoberta ou consulta de rede.
- Dados exibidos: IPv4 escolhido, tipo de rede (Radmin, Tailscale ou LAN) e nome da interface quando disponível.
- Regra de escolha: preferir Radmin, depois Tailscale, depois LAN; não usar loopback.
- Estados: rede virtual detectada; somente LAN detectada; nenhuma IPv4 externa detectada.
- Feedback: quando não houver rede ou houver apenas LAN, informar que redes virtuais podem ser necessárias para amigos remotos e que descoberta automática pode não atravessar Tailscale.
- Importância: primária.

### Descobrir salas anunciadas

- Quem pode: qualquer pessoa fora de sala.
- Gatilho: início do aplicativo, atualização explícita ou chegada/expiração de beacon UDP.
- Pré-condições: descoberta local ativa; não requer servidor central.
- Resultado: listar somente salas vivas, removendo anúncio que não se renova dentro de 7 s.
- Dados de cada sala anunciada: nome, endereço IPv4, porta, quantidade de pessoas, se exige PIN e versão do aplicativo de quem criou.
- Protocolo: beacon UDP `golive-room`, enviado a cada 2 s para broadcasts das interfaces e broadcast global; porta de descoberta 41235; no máximo 64 salas conhecidas; atualizações da lista limitadas a 4 por segundo.
- Estados: procurando; lista vazia; salas encontradas; sala expirou; atualização solicitada; anúncio malformado ignorado.
- Feedback: a lista vazia deve distinguir ausência de salas de ausência de rede e explicar que Tailscale pode exigir endereço manual.
- Erros e bordas: beacon não traz PIN; versão ausente não substitui a validação do servidor; salas incompatíveis não podem iniciar entrada.
- Importância: primária.

### Atualizar descoberta

- Quem pode: qualquer pessoa fora de sala.
- Gatilho: ação explícita de procurar novamente.
- Resultado: recriar o socket UDP, descartar resultados conhecidos e reanunciar a própria sala se existir.
- Estados: em atualização; êxito com lista nova; falha de socket; sem rede.
- Feedback: manter o estado anterior até haver resultado novo ou comunicar a falha sem ocultar a possibilidade de entrada manual.
- Importância: secundária.

### Entrar por descoberta ou endereço manual

- Quem pode: qualquer pessoa fora de sala.
- Gatilho: escolher uma sala descoberta ou informar endereço.
- Dados recebidos: endereço `host:porta` ou URL WebSocket equivalente; PIN se a sala pedir; versão e identidade locais são enviados automaticamente.
- Pré-condições: endereço válido; versão compatível; vaga disponível; não estar banido; PIN correto quando aplicável.
- Resultado: conectar à sinalização, receber retrato inicial de presença, líder, chat, banidos se for líder, estado resumido da Mesa, e iniciar negociações de mídia necessárias.
- Estados: aguardando dados; conectando; conectado; recusado; cancelado; falhou; reconectando após queda.
- Recusas obrigatórias: PIN ausente/incorreto, banimento, sala cheia, versão diferente. Mostrar qual versão precisa ser atualizada quando o servidor informa as duas versões.
- Proteção contra PIN: até 5 erros por endereço em 60 s causam bloqueio de 60 s; explicar prazo quando conhecido e não reenviar automaticamente.
- Feedback: mostrar destino, progresso e motivo estável. Nunca tratar PIN incorreto como queda de rede.
- Importância: primária.

### Criar sala

- Quem pode: qualquer pessoa fora de sala; ela se torna criadora e líder inicial.
- Gatilho: ação de criar sala.
- Dados recebidos: nome de sala, opção de anunciar na rede e opção de proteção por PIN. O PIN é gerado/exibido para compartilhamento privado e não é uma garantia criptográfica.
- Pré-condições: nome normalizável; porta disponível; endereço local utilizável para convites manuais.
- Resultado: iniciar servidor de sinalização embutido, escolher porta na faixa suportada, criar segredo de sala, tentar regra de firewall do Windows, iniciar anúncio opcional e entrar na própria sala.
- Limites: nome normalizado até 40 caracteres; até 16 conexões simultâneas na sala; até 32 conexões pendentes.
- Estados: preparando; aguardando UAC/firewall; criada com acesso de rede permitido; criada com acesso externo incerto; porta indisponível; erro de servidor.
- Feedback: fornecer endereço copiável, estado da regra de firewall e PIN quando existir. Se UAC falhar/cancelar, a sala pode existir localmente, mas deve haver ação para repetir a tentativa e instrução segura para permissão manual.
- Restrições: a regra de firewall limita TCP a perfis privado/domínio e ao executável do app; não abrir rede pública.
- Importância: primária.

### Sair e encerrar sala

- Quem pode: qualquer pessoa; criador também pode encerrar o servidor local.
- Gatilho: ação explícita, fechamento da janela ou encerramento remoto.
- Resultado para pessoa comum: abandonar presença, liberar mídia e recursos locais.
- Resultado para criador que sai sem migração: parar anúncio e servidor local para não deixar sala fantasma.
- Resultado em fechamento inesperado: notificar sobreviventes e iniciar reconexão/migração conforme o caso.
- Estados: confirmando ação potencialmente destrutiva; saindo; migrando; encerrada; retorno ao estado fora de sala.
- Feedback: se houver sala sendo mantida localmente, explicar o efeito para as demais pessoas.
- Importância: primária.

## Presença, liderança e moderação

### Informações por pessoa

- Dados que devem estar disponíveis: id de sessão, apelido, avatar ou derivação consistente, se é você, se é líder, se está transmitindo tela, se a tela está pausada, se a câmera está ligada, se você escolheu assistir à tela dela, qualidade efetiva quando relevante, alerta de recepção degradada e se está na Mesa.
- Estados possíveis: entrou; presente sem mídia; transmitindo; transmitindo pausado; câmera ligada sem tela; tela e câmera ligadas; pessoa assistindo; pessoa cuja transmissão você liberou; retransmitindo; reconectando/retomada; saiu; removida; banida; líder; criadora ausente após transferência.
- Importância: primária.

### Liderança

- Quem pode: líder atual transfere liderança para outra pessoa presente; sucessão automática escolhe entre sobreviventes quando o líder se perde.
- Gatilho: transferência explícita; perda prolongada de líder; migração concluída.
- Pré-condições: alvo presente e diferente do líder; para sucessão, haver candidatos com dados de retomada válidos.
- Resultado: novo líder passa a moderar, recebe lista de banidos e controla travas da Mesa. A transferência deve sobreviver à reconexão e à migração.
- Bordas: se o líder original sair após ter transferido, não retoma automaticamente o poder ao reconectar. Se a liderança havia voltado ao criador, a transferência persistida é limpa.
- Feedback: evento de sistema e atualização imediata das permissões.
- Importância: secundária.

### Moderação

- Quem pode: somente líder da sala.
- Ações: pedir para uma pessoa parar a própria tela; expulsar; banir; readmitir banido; transferir liderança.
- Dados recebidos: alvo e, para transferência, confirmação inequívoca; para readmissão, chave do banimento.
- Resultado: parar tela preserva a conexão; expulsar encerra a sessão atual mas permite voltar; banir encerra e impede novo ingresso enquanto a sala existir; readmissão remove a regra.
- Pré-condições: alvo na mesma sala, não ser o próprio líder; somente há ação de parar tela para alguém efetivamente ao vivo.
- Estados: disponível; confirmação pendente; aplicado; alvo já saiu; sem permissão; falha de sinalização.
- Feedback: confirmar ações irreversíveis no contexto da sala e emitir mensagem de sistema para ações efetivadas.
- Importância: secundária.

## Compartilhar tela e áudio do sistema

### Escolher e iniciar tela

- Quem pode: qualquer pessoa na sala.
- Gatilho: iniciar compartilhamento.
- Dados recebidos: origem de captura (monitor ou janela), preset de qualidade, incluir áudio do sistema, incluir/excluir áudio do Discord quando disponível e permitir rabiscos naquela origem.
- Pré-condições: estar em sala; origem de captura existir na confirmação; permissão de captura concedida.
- Resultado: capturar origem, anunciar estado de transmissão, oferecer mídia a quem precisa recebê-la, iniciar telemetria e bloquear suspensão enquanto houver atividade pertinente.
- Estados: buscando origens; monitores prontos; janelas ainda carregando; nenhuma origem; origem selecionada; pronto para iniciar; iniciando; ao vivo; interrompida pela origem; interrompida por moderação; falha.
- Feedback: iniciar o diálogo imediatamente e preencher origens de forma assíncrona; não prometer uma origem que sumiu. Se a seleção falhar por lista vencida, orientar atualizar e escolher novamente.
- Bordas: monitor único pode ser pré-selecionado; compartilhar janela e monitor são capacidades distintas; perda da trilha de captura encerra a transmissão com explicação.
- Importância: primária.

### Qualidade de tela

- Quem pode: transmissor antes de iniciar; a configuração é persistida para próxima transmissão.
- Dados e valores: 720p30 a 2,5 Mb/s; 720p60 a 4 Mb/s; 1080p30 a 6 Mb/s; 1080p60 a 12 Mb/s, padrão.
- Resultado: a escolha é teto, não garantia. Codec de tela é H.264 e a captura nunca deve pedir acima de 1920×1080.
- Ajustes automáticos: com 3 ou mais pessoas assistindo, reduzir um degrau; ao encoder ficar pressionado por 3 s, reduzir até dois degraus; recuperar após 30 s saudáveis; reduzir por pessoa quando sua rede/recepção pedir; retransmissor divide orçamento de upload com 20% de folga.
- Feedback: mostrar qualidade escolhida e efetiva, motivo de redução e recuperação. Distinguir teto escolhido de qualidade recebida por cada pessoa.
- Alertas: encoder por software, captura instável, restrição de resolução, saturação de upload, qualidade em malha direta e recepção ruim.
- Importância: primária.

### Áudio compartilhado

- Quem pode: transmissor ao iniciar nova tela.
- Dados recebidos: incluir áudio do sistema; quando o complemento nativo estiver disponível no Windows, incluir Discord explicitamente ou capturar o restante do sistema excluindo Discord e o próprio app.
- Pré-condições: origem de captura e modo de áudio suportados pelo sistema; complemento nativo para filtragem por processo.
- Resultado: áudio segue com a mídia em Opus estéreo, com teto anunciado de 160 kb/s.
- Estados: desligado; áudio de sistema; filtragem por processo disponível; filtragem indisponível; captura nativa atrasada; falha de dispositivo.
- Feedback: não oferecer filtragem como efetiva fora do Windows/complemento; informar que amostras atrasadas são descartadas para não atrasar a conversa.
- Importância: secundária.

### Pausar, retomar, trocar e parar tela

- Quem pode: somente a pessoa que transmite; líder pode solicitar que ela pare.
- Gatilhos: ação explícita, atalho global `Ctrl+Alt+P`, troca de origem ou fim da trilha.
- Pré-condições: pausa/troca exigem transmissão ativa; trocar exige nova origem válida.
- Resultado da pausa: manter a sessão e a origem, mas impedir envio ativo; quem assiste vê que a transmissão foi pausada e não deve interpretar último quadro como imagem atual.
- Resultado da retomada: restaurar envio da mesma origem e atualizar estado para a sala.
- Resultado da troca: substituir a trilha preservando qualidade e escolhas compatíveis; falha não pode deixar a origem anterior sem estado explícito.
- Resultado de parar: encerrar captura, ofertas/retransmissão correspondentes, áudio de captura e estado de rabisco da origem.
- Estados: ativa; pausada; retomando; trocando; parada; parada por moderação; encerrada por falha.
- Importância: primária.

## Câmera

- Quem pode: qualquer pessoa na sala.
- Gatilho: ligar/desligar câmera; trocar dispositivo nas configurações.
- Dados recebidos: dispositivo de vídeo escolhido; permissão do sistema.
- Configuração padrão: 1280×720, 30 fps, 2 Mb/s, codec VP8; dispositivo inicial indefinido.
- Pré-condições: driver e permissão disponíveis. Câmera não depende de tela compartilhada.
- Resultado: anunciar estado independente, enviar a quem a deseja receber, disponibilizar como conteúdo da Mesa quando ligada e removê-la ao desligar.
- Estados: desligada; abrindo; ligada; trocando dispositivo; permissão negada; sem dispositivo; driver falhou; encerrada ao sair.
- Feedback: o comando deve refletir abertura em progresso e evitar clique duplo; explicar falha de permissão/dispositivo.
- Qualidade: não seguir a cadeia de redução de tela; pode adaptar escala/bitrate por recebedor conforme espaço lógico disponível, com mínimo de 150 kb/s.
- Rabiscos: só podem ser permitidos se a pessoa que transmite os autorizou; quem é dona da câmera não desenha sobre a própria origem.
- Importância: secundária.

## Assistir mídia e liberar recursos

### Escolher telas

- Quem pode: qualquer pessoa na sala.
- Gatilho: chegada de uma transmissão, escolha explícita, ação de ver junto, saída de uma origem ou troca entre vistas pessoais.
- Regra inicial: a primeira tela disponível é selecionada automaticamente; depois, a pessoa escolhe uma tela principal e pode acrescentar outras sem teto funcional no cliente.
- Dados exibidos por origem: pessoa de origem, estado ao vivo/pausado/falha, se você está assistindo, quem assiste, qualidade/saúde recebida e ações disponíveis.
- Resultado: enviar `view-state` à cadeia de mídia. Ao parar de assistir uma tela, a pessoa transmite essa intenção para que a origem/retransmissor libere encoder e banda quando ninguém depende dela.
- Estados: aguardando origem; recebendo; assistindo; não assistindo deliberadamente; adicionada junto; removida; origem parou; origem pausou; recuperação de conexão; indisponível.
- Bordas: câmera é opt-out por padrão; tela é opt-in depois da seleção inicial. Não reativar automaticamente mídia que a pessoa removeu de propósito.
- Importância: primária.

### Foco, tela cheia e Espiar

- Quem pode: qualquer pessoa que esteja recebendo uma origem.
- Gatilhos: focar uma origem, entrar/sair de tela cheia, abrir/fechar Espiar, escolher miniaturas de outras origens.
- Resultado: ampliar a atenção em uma origem sem interromper outras seleções; com múltiplas origens, permitir apresentação simultânea em grade ou foco de uma delas; Espiar mantém uma cópia de visualização independente e pode ser fechada sem parar a mídia.
- Estados: visão normal; uma origem em foco; tela cheia; Espiar aberto; Espiar bloqueado pelo navegador; origem removida enquanto estava em foco/Espiar.
- Feedback: saída por Escape e por controles do sistema deve manter estado coerente; se Espiar não abrir, não alterar a seleção de mídia.
- Importância: secundária.

### Saúde de recepção e recuperação

- Quem pode: automaticamente para quem recebe; qualquer pessoa pode usar dados de diagnóstico.
- Gatilho: sem quadros, sem RTP, perda, caminho vivo sem mídia, decoder sem produzir imagem, ou reconexão ICE.
- Resultado: classificar a falha como rede, origem sem enviar, decoder ou apresentação; tentar reinício ICE após 1 s em `disconnected`; evitar recriar conexão cedo em falha de rede.
- Prazos: ausência de heartbeat por 15 s considera sinalização morta; vigia pode segurar reoferta de rede até 25 s; histórico de reofertas tem teto de 128; uma reoferta em voo e uma enfileirada por folha.
- Feedback: dizer se não há contato com o computador de origem, se a origem parou de enviar ou se a imagem está recuperando; não exibir diagnóstico técnico sem tradução.
- Importância: primária.

### Volume e silêncio

- Quem pode: cada pessoa localmente, para cada origem remota.
- Gatilho: ajustar volume ou silenciar uma origem.
- Resultado: aplicar ganho local, inclusive acima de 100%, sem anunciar alteração à sala; mídia própria permanece silenciosa localmente para evitar eco.
- Estados: volume padrão 100%; volume ajustado; silencioso; sem trilha de áudio; grafo de áudio indisponível/recuperando.
- Bordas: liberar nós de áudio quando origem/tela é removida para não manter recursos nem áudio residual.
- Importância: secundária.

## Rabiscos, laser e reações

### Rabiscos e escrita

- Quem pode: quem assiste a uma tela/câmera que autorizou rabiscos; a pessoa dona da origem pode apagar tudo. A regra deve ser reforçada no servidor, não só no cliente.
- Gatilho: começar traço, enviar pontos, escrever texto, desfazer próprio item, apagar todos os itens pela origem.
- Dados: superfície identificada por dona e tipo; coordenadas normalizadas na área útil do vídeo; identificação de traço por pessoa; pontos; texto; autor; ordem.
- Pré-condições: origem ao vivo/recebida, permissão da origem e pessoa assistindo a superfície correta.
- Resultado: replicar em tempo real e sincronizar para quem chega depois. O servidor não persiste o desenho; a origem atende a sincronização.
- Limites: 400 itens por superfície; 2.000 pontos por traço; 200 pontos por mensagem; 120 caracteres por texto; até 60 mensagens por segundo; sincronização até 400 itens.
- Estados: indisponível; permitido; desenhando; escrevendo; sincronizando; desfeito; apagado; origem saiu; permissão revogada.
- Feedback: dizer quando não é permitido, quando a origem não aceita rabiscos e quando a sincronização ainda não terminou.
- Importância: secundária.

### Rabisco na tela física da origem

- Quem pode: efeito automático na máquina que compartilha monitor inteiro e autorizou rabiscos.
- Pré-condições: origem de captura deve ser um monitor ainda presente; a pessoa dona continua sendo a única que pode apagar tudo.
- Resultado: janela auxiliar transparente e sem foco reproduz rabiscos, laser e reações sobre o monitor físico sem entrar na própria captura.
- Restrições: não aplicar para captura de janela, pois o retângulo pode mudar; se o monitor desaparecer entre seleção e início, seguir somente com a representação dentro do aplicativo e avisar.
- Estados: disponível; iniciando; ativa; indisponível para janela; monitor ausente; falha de carregamento; encerrada com a transmissão.
- Importância: rara.

### Laser e reações

- Quem pode: pessoa assistindo uma superfície ativa; efeitos também podem alcançar a representação física elegível.
- Gatilho: apontar laser ou enviar reação.
- Dados: superfície, autor, posição normalizada quando aplicável e tipo de reação permitido.
- Resultado: efeito efêmero, sem entrar no histórico de rabiscos.
- Limites: laser até 24 emissões por segundo e vida de 1 s; reação permanece cerca de 1,4 s; servidor limita explosões de reações.
- Estados: emitindo; recebido; expirado; descartado por limite; indisponível por superfície/permissão.
- Feedback: interação imediata, sem confirmação persistente.
- Importância: rara.

## Chat

- Quem pode: qualquer pessoa conectada à sala.
- Gatilhos: enviar texto, emoji, imagem por arquivo, colagem ou arraste; abrir imagem; colocar uma imagem do chat na Mesa quando permitido por essa integração.
- Dados recebidos: texto, imagem opcional, dimensões da imagem, autor, nome, data/hora e id de mensagem.
- Texto: até 500 caracteres após aparar extremos; mensagem precisa conter texto ou imagem.
- Emoji: catálogo pesquisável em português, categorias e até 24 recentes persistidos localmente.
- Imagens aceitas: PNG, JPEG, GIF e WebP em `data:`; URL remota é recusada. PNG/JPEG/WebP podem ser redimensionados e recompactados; GIF não deve ser achatado.
- Limites de imagem: até 200 KiB em caracteres de data URL, no máximo 3 imagens em 5 s por pessoa; histórico do servidor guarda no máximo 50 mensagens e 8 imagens; cliente mantém no máximo 200 linhas renderizadas.
- Estados: pronto; digitando; imagem sendo processada; pronto para envio; enviando; recebido; falha de validação; excedeu limite; offline/reconectando; histórico carregado; mensagens novas não lidas.
- Agrupamento: mensagens consecutivas do mesmo autor podem ser agrupadas; mudança de dia cria separador de data; preservar ordem temporal do servidor.
- Offline: não inventar fila persistente. Enquanto sem sinalização, impedir ou indicar que o envio não será entregue; após retomada, usar o histórico confirmado pelo servidor.
- Feedback: contador de caracteres, estado de anexo, motivo de imagem recusada e indicação de mensagens novas quando a conversa não estiver ativa.
- Sons: não tocar para a própria mensagem; para chat remoto, não tocar com a janela em foco e respeitar intervalo mínimo de 2 s.
- Importância: primária.

## Mesa: encaixe na sala

- A especificação funcional interna da Mesa pertence a `02-functional-brief-mesa.md`; este documento define apenas sua relação com a sala.
- Cada pessoa pode alternar individualmente entre acompanhar transmissões e abrir a Mesa. Isso não muda o tipo da sala nem obriga outras pessoas a trocar.
- Abrir a Mesa envia presença `mesa-view` e recebe sincronização completa somente então; quem não a abriu recebe apenas contagem de janelas, pessoas que a abriram e travas atuais. Fechar retira essa presença e libera dados específicos da Mesa.
- A sala deve mostrar: quantas janelas a Mesa contém, quem está nela, se a Mesa está vazia, e se as travas de somente líder ou de tamanho estão ativas.
- Tela e câmera ligadas entram como janelas de mídia da Mesa automaticamente; desligá-las as remove. Uma pessoa pode tirar para si uma origem da Mesa sem que ela volte automaticamente numa atualização posterior.
- Entrar/sair da Mesa não interrompe presença, chat, câmera, transmissão ou escolha de telas. A preferência de assistir uma origem deve continuar sendo respeitada dentro da Mesa.
- Quem pode manipular: toda pessoa que abriu a Mesa, salvo trava de somente líder; somente líder alterna travas. Operações também exigem estar na Mesa.
- Concorrência: uma janela manipulável tem posse temporária de 5 s, renovada durante interação; outra pessoa recebe quem a está manipulando e não pode disputar até soltar ou expirar.
- Eventos de sala relevantes: pessoa abriu/fechou Mesa, sincronização recebida, janela adicionada/removida/movida/alterada, trava alterada, posse concedida/negada/liberada, pessoa saiu e seu estado foi limpo.
- Limites de integração: até 32 janelas; operações de Mesa até 20 por segundo por pessoa; atualização contínua até 30 por segundo; ação serializada até 8 KiB. Erros incluem não estar na Mesa, janela ausente, Mesa cheia, trava ativa, posse de outra pessoa, sobreposição/limite de mundo, estado grande demais e excesso de taxa.
- Migração da sala inclui retrato completo da Mesa e travas; banidos e chat também migram. A ordem de sequência permite detectar lacuna e pedir nova sincronização.
- Restrição para a casca: a representação da Mesa precisa continuar mensurável e capaz de receber/restituir os elementos de mídia quando a pessoa alterna sua vista. Não destruir nem esconder de forma que medidas, reprodução ou sincronização precisem ser recriadas indevidamente.
- Importância: secundária.

## Avisos, notificações, sons e diagnóstico

### Central de avisos

- Quem pode: toda pessoa; avisos podem ter ação ou dispensa.
- Dados: id estável, severidade grave/atenção/informação, título, detalhe, resumo curto, ação opcional e se é dispensável.
- Resultado: ordenar por severidade e chegada; a dispensa vale só enquanto a assinatura do conteúdo for igual. Mudança material faz o aviso reaparecer.
- Casos obrigatórios: firewall pendente, Tailscale/descoberta, encoder por software, captura instável, qualidade reduzida, rede/recepção problemática, erro de atualização e necessidade de ação de moderação.
- Importância: secundária.

### Notificações e sons

- Quem pode: preferência local de qualquer pessoa.
- Eventos sonoros: entrada, saída, mensagem, início/parada de transmissão e moderação; retomada não deve duplicar evento de entrada.
- Eventos de notificação do sistema: alguém começa a transmitir quando a janela não está em foco, se a preferência estiver ligada.
- Estados: habilitado/desabilitado, tocou, não tocou com motivo, testando e histórico da sessão.
- Valores padrão: sons ligados; aviso de alguém ao vivo ligado.
- Feedback: teste percorre eventos e registra tentativa, horário, resultado e motivo; falha de áudio não bloqueia a sala.
- Importância: secundária.

### Estatísticas e logs

- Quem pode: qualquer pessoa; dados locais, sem expor IP de terceiros em texto de rota.
- Dados: linhas de envio e recepção por origem/tipo, codec, resolução, fps, bitrate, RTT, perda, jitter, caminho/retransmissão, encoder/decoder, taxa de quadros, qualidade escolhida/efetiva e alertas de saúde.
- Estados: sem sala; coletando; atualizado periodicamente; origem encerrada; diagnóstico indisponível.
- Ação: abrir a pasta de logs da sessão para suporte.
- Importância: secundária.

## Configurações persistentes

### Perfil

- Apelido: padrão vazio; string livre tratada pelo produto; usado na próxima entrada/anúncio.
- Avatar: padrão ausente; imagem opcional até 64 KiB serializados; pode remover/substituir.

### Transmissão

- Qualidade de tela: padrão 1080p60/12 Mb/s; opções 720p30/2,5 Mb/s, 720p60/4 Mb/s, 1080p30/6 Mb/s e 1080p60/12 Mb/s.
- Árvore de retransmissão: sempre ligada, sem controle de desligamento; fanout 2 e profundidade alvo 2. É requisito de proteção de encoder, não uma preferência exposta.
- Permitir rabiscos: lembrar a última escolha do início de transmissão; padrão desligado; vale por origem iniciada, não como autorização global permanente.

### Câmera, sons e avisos

- Dispositivo de câmera: padrão nenhum; listar dispositivos de vídeo disponíveis, permitir troca e prévia; alteração com câmera ativa exige reinício seguro da captura.
- Câmera: padrão 1280×720 a 30 fps e 2 Mb/s.
- Sons do aplicativo: padrão ligado.
- Avisar quando alguém ficar ao vivo: padrão ligado.

### Rede e sala

- Anunciar nova sala na descoberta: padrão ligado; a última escolha é lembrada para próxima criação.
- PIN de sala: opcional por criação; não é preferência global e não deve ser salvo/exposto no beacon.

### Temas

- Existe um sistema de temas com oito presets reconhecidos pelo armazenamento, além de tema personalizado e acento personalizado em preset.
- Contrato semântico travado: os papéis de estado ao vivo, aviso e perigo não podem ser reinterpretados por um tema; os papéis de superfície permanecem protegidos quando a pessoa altera apenas o acento.
- Contraste: validar antes de aceitar combinação; texto e ação precisam cumprir contraste mínimo de 4,5:1 nos pares relevantes. Quando inválido, informar o primeiro problema e oferecer acento próximo válido quando calculável.
- Personalização: acento em hexadecimal de seis dígitos; tema completo usa temperatura e claridade em escala 0–1; armazenar no máximo 12 temas nomeados.
- Nomes de temas salvos: 1–24 caracteres, ids únicos. Permitir aplicar, renomear/excluir conforme contrato local, exportar/importar código e salvar importação só após nomear.
- Migração: configuração legada de presets anteriores deve migrar uma única vez apenas quando era padrão implícito e sem acento próprio. Configuração inválida recua ao padrão seguro; entrada inválida não destrói outros temas salvos válidos.

### Dados locais e migração

- Persistir em armazenamento local: identificador de instalação, perfil, preferências acima, qualidade, câmera, tema, temas salvos, últimos emojis e escolhas lembradas.
- Configuração inválida deve ser sanitizada campo a campo. Preferências não reconhecidas não podem quebrar inicialização.

## Atualizações e splash

### Abertura

- Quem pode: automática na abertura.
- Fluxo: mostrar splash; procurar atualização; se houver, baixar; ao concluir, instalar e reiniciar; se não houver, ocorrer erro ou a consulta exceder prazo, abrir aplicativo.
- Prazos: liberar após 5 s sem resposta de consulta; liberar após 30 s sem progresso de download; em desenvolvimento, manter splash por pelo menos 600 ms para evitar lampejo.
- Estados: procurando; atualização disponível; baixando com 0–100%; instalando; abrindo; consulta expirada; download travado; erro; sem atualização.
- Bordas: download de abertura abandonado pode terminar tarde, mas não pode forçar instalação no meio de uma sala.
- Importância: secundária.

### Atualização após abertura

- Quem pode: qualquer pessoa fora de sala para instalar; busca pode ocorrer em segundo plano a cada 60 min e manualmente.
- Gatilho: busca manual, resultado periódico ou atualização identificada antes de liberar o app.
- Resultado: encontrar não baixa automaticamente; ação explícita inicia download. Quando pronto, a ação instala/reinicia se fora de sala.
- Estados: procurando, disponível, não disponível, baixando, baixada, instalando, ocupada, cancelada, erro.
- Erros distinguíveis: sem rede, limite do provedor, release incompleto, nenhuma release e feed quebrado; não mostrar mensagem crua como explicação principal.
- Restrição: durante sala ativa, a solicitação de instalar é bloqueada; explicar que deve sair antes.
- Importância: secundária.

## Janela, atalhos e acessibilidade operacional

- Janela principal Windows: controles próprios para minimizar, alternar maximização/restauração e fechar; outras plataformas usam controles nativos. Estado de maximização deve voltar ao renderer.
- Tamanho mínimo da janela principal: 900×600. Tamanho inicial: 1280×800. Persistir/restaurar limites de janela apenas se ainda couberem em monitor disponível.
- Atalho global: `Ctrl+Alt+P` alterna pausa da própria transmissão mesmo com outro aplicativo em foco. Se o sistema já o reservou, registrar falha e manter o controle normal utilizável.
- Atalhos de interação existentes: Escape fecha contextos transitórios, diálogos de seleção e visualização ampliada; Enter confirma origem selecionada e envia chat sem Shift; Shift+Enter insere linha no chat; Enter/Espaço ativa itens de presença; setas/Home/End percorrem listas e opções; `+`, `-` e `0` ajustam/restauram a escala da Mesa; `f` alterna foco ampliado de janela da Mesa; Delete tenta tirar janela da Mesa; setas movem janela e Alt+setas redimensionam quando permitido; Menu de contexto ou Shift+F10 abre ações de janela da Mesa.
- Requisitos de teclado: nenhum controle temporariamente invisível pode continuar alcançável por Tab; fechamento deve devolver foco ao ponto que abriu o contexto; ações destrutivas devem iniciar foco em cancelar.
- Importância: secundária.

## Restrições técnicas do produto

- Limite prático validado de pessoas com mídia é cerca de 6–7; o servidor aceita no máximo 16 conexões. O redesign deve não sugerir capacidade superior como garantida.
- A retransmissão de tela/câmera é sempre ligada e reduz encoders da origem. Fanout é 2 por retransmissor e profundidade alvo é 2; quando falhar, pode haver malha direta com aviso e teto de qualidade adicional.
- A sessão mantém computador acordado quando está em sala e compartilhando ou assistindo; sair/encerrar deve liberar o bloqueio.
- Heartbeat de sinalização ocorre a cada 5 s; 15 s de silêncio inicia recuperação. Queda curta deve tentar ICE antes de abandonar sala.
- Migração abrupta pode iniciar cedo após duas recusas TCP consecutivas da porta do líder; ausência de rota deve aguardar escada completa de reconexão para não dividir a sala. O pior caso é aproximadamente 134 s quando o computador/rota do líder apenas some.
- Segurança: renderer isolado de Node; IPC expõe apenas operações necessárias; links externos da Mesa são validados, só podem ser abertos pela origem principal e são limitados a um por segundo; imagens de chat não fazem solicitações externas.
- O estado remoto é não confiável e precisa de validação no servidor e no cliente: versão, PIN, banimento, limites, autores de rabisco, permissões, origem de retransmissão e operações da Mesa.

## Requisitos técnicos da camada de interface

### Fronteiras de execução

- `window.golive` é a ponte IPC exposta pelo preload. Não confundir com `window.GoLive`, que é o namespace de módulos puros do renderer.
- `window.golive` fornece origens de captura, escolha de origem/áudio, criar/parar/abortar sala, firewall, endereço e descoberta, migração e teste TCP, tela cheia, visibilidade, atalho global, captura WASAPI, atualizador, logs, links externos da Mesa, overlay e controles de janela.
- Eventos recebidos pela ponte: salas descobertas, beacon de migração, mudança de tela cheia, visibilidade da janela, retorno de Espiar, atalho, blocos PCM e estados de atualização/maximização.
- `window.GoLive.ui` existe e é a camada que cria e atualiza DOM. `app.js` orquestra sessão, sinalização, mídia, estados e chama seus submódulos: `grid`, `chat`, `members`, `rooms`, `dialogs`, `settings`, `warnings`, `annotations`, `laser`, `reactions`, `soundMeter`, `stageHeader` e `setToggleState`.
- `ui.js` também abre Espiar, mantém áudio de reprodução por origem, traduz interações de teclado, constrói seletores de captura e controla os contextos transitórios. O redesign deve preservar essas responsabilidades ou criar adaptador compatível.

### Contrato DOM atual que precisa ser tratado como API

- `app.js` acessa diretamente 49 ids por meio de `$()`: `app-version`, `btn-check-update`, `btn-copy-address`, `btn-create-room`, `btn-disconnect`, `btn-join-address`, `btn-mesa-add`, `btn-open-settings`, `btn-pause-share`, `btn-refresh-discovery`, `btn-room-more`, `btn-room-settings`, `btn-swap-share`, `btn-toggle-camera`, `btn-toggle-people`, `btn-toggle-share`, `btn-toggle-side`, `btn-update-available`, `chat-unread-dot`, `copy-address-status`, `lobby-error`, `lobby-status`, `opt-mesa-cursors`, `opt-mesa-leader-only`, `opt-mesa-leader-only-row`, `opt-mesa-locks-hint`, `opt-mesa-lock-size`, `opt-mesa-lock-size-row`, `room-more`, `room-people-count`, `room-view`, `setup-error`, `stage-member-count`, `stage-mesa-people`, `tab-chat`, `toast`, `toast-text`, `update-bar`, `update-bar-fill`, `update-bar-progress`, `update-bar-sub`, `update-bar-title`, `user-panel-avatar`, `user-panel-avatar-fallback`, `user-panel-avatar-img`, `user-panel-name`, `view-mesa`, `view-mesa-count` e `view-tx`.
- Esses ids são usados para: eventos de ação, texto/estado de atualização, mensagens de erro, presença, seleção entre vistas, estado de Mesa, alerta transitório, perfil e sincronização de preferências. Renomear/remover sem adaptador quebra `app.js` mesmo que a função visual pareça equivalente.
- `ui.js` usa muitos ids adicionais definidos em `src/renderer/ids-contrato.json`; esse arquivo é a lista canônica para migração. A nova casca deve manter ids ou atualizar código e contrato atomicamente.
- O DOM também é parte do contrato de mídia: elementos de vídeo e canvas de rabisco podem ser movidos entre a seleção de transmissão e a Mesa sem perder `MediaStream`, áudio, estado de pausa, escolhas de recepção ou foco.

### Testes e bancadas que restringem a casca

- `src/renderer/ids-contrato.test.js` confere que ids obrigatórios existem e correspondem ao contrato esperado.
- `src/renderer/css-rules.test.js` verifica regras de estado, inclusive que elementos inicialmente ocultos não reapareçam por conflito de CSS, que controles invisíveis não recebam Tab e que toda superfície transitória siga regras de ociosidade. Ao trocar a casca, preservar o comportamento, não necessariamente a implementação atual.
- `src/renderer/theme.test.js`, `themecode.test.js` e `theme-grid.test.js` travam tokens, contraste, presets, importação/exportação e migração de tema.
- `src/renderer/glossario.test.js` valida textos visíveis em `app.js`, `ui.js`, `mesa-view.js` e HTML; mudanças de nomenclatura precisam respeitar o glossário.
- `src/renderer/titlebar.test.js`, `sala-layout.test.js`, `gridlayout.test.js`, `espiar.test.js`, `mesa-vista.test.js`, `mesa-tile.test.js` e testes de Mesa protegem navegação, transições de conteúdo e acessibilidade operacional.
- Bancadas que dependem de seletores/DOM: `tools/bancada-sala/`, `tools/bancada-telas/`, `tools/bancada-janelas/`, `tools/mesa-prints/` e `tools/midia/`. Atualizações na casca exigem revisar seus seletores e cenários, preservando suas verificações funcionais.
- A suíte `node --test` cobre módulos puros e servidor, mas não carrega `app.js` como aplicação Electron. Toda alteração dessa integração exige abrir o aplicativo real além da suíte automatizada.

## Tarefas-chave por frequência

1. Entrar em uma sala descoberta ou por endereço e assistir à tela que aparece.
2. Criar sala, copiar endereço/PIN e permitir acesso no firewall se necessário.
3. Iniciar, pausar, retomar, trocar ou parar compartilhamento de tela.
4. Conversar por texto, emoji e imagem.
5. Escolher outras telas para assistir e parar de assistir as irrelevantes.
6. Ligar/desligar câmera e ajustar volume de origens remotas.
7. Alternar entre transmissão e Mesa, incluindo entrar/sair da Mesa.
8. Resolver aviso de rede, encoder, captura ou recepção.
9. Transferir liderança e moderar pessoas.
10. Consultar estatísticas, logs, atualização e preferências.

## Limites numéricos consolidados

| Domínio | Limite/regra |
| --- | --- |
| Pessoas na sala | 16 conexões; uso de mídia validado na prática em cerca de 6–7 |
| Conexões pendentes | 32 |
| Retransmissão | fanout 2; profundidade alvo 2 |
| Descoberta | 64 salas, beacon 2 s, expiração 7 s, 4 atualizações/s |
| PIN | 5 falhas/60 s; bloqueio 60 s |
| Tela | até 1920×1080; 30 ou 60 fps; 2,5–12 Mb/s |
| Câmera | 1280×720, 30 fps, 2 Mb/s; mínimo adaptativo 150 kb/s |
| Chat | 500 caracteres; 5 mensagens/s; 50 no histórico; 200 exibidas |
| Imagem de chat | 200 KiB; 3 imagens/5 s; 8 imagens no histórico |
| Avatar | 64 KiB |
| Rabiscos | 400 itens, 2.000 pontos/traço, 120 caracteres, 60 mensagens/s |
| Laser | 24 emissões/s; vida de 1 s |
| Mesa | 32 janelas; 20 operações/s; 30 atualizações/s; posse por 5 s; ação até 8 KiB |
| Temas salvos | 12; nome de 1–24 caracteres |
| Reconexão | heartbeat 5 s; silêncio 15 s; retenção de rede até 25 s |
| Janela principal | mínimo 900×600; inicial 1280×800 |

// src/renderer/emoji.js
'use strict';

/*
 * Emoji do chat: a lista e a busca.
 *
 * Mora num arquivo proprio porque e DADO, e dado grande no meio da UI e
 * como o ui.js chegou a 2100 linhas. A busca e pura e testada; o painel
 * (ancoragem, teclado, insercao no cursor) fica no ui.js.
 *
 * Palavras-chave em portugues e sem acento: quem digita "coracao" e quem
 * digita "coração" tem de achar a mesma coisa, e normalizar na busca (e
 * nao na lista) e o que garante isso pros dois lados.
 *
 * Ver docs/superpowers/specs/2026-09-04-anotacoes-lideranca-e-chat-rico-design.md, secao 7.
 */

(function (root) {
  // [emoji, 'palavras chave', peso?]. A primeira palavra e a mais obvia --
  // e a que aparece no `title` do botao.
  //
  // O `peso` (opcional, so onde ha empate confuso) desempata a busca: sem
  // ele, "coracao" devolve o coracao-orgao e o coracao-com-as-maos antes do
  // ❤️, porque os tres casam na primeira palavra-chave e o desempate cai na
  // ordem da lista. Peso e a forma de dizer "este e o obvio", e ele so
  // aparece nos poucos casos em que ha um obvio.
  const GROUPS = [
    {
      id: 'rostos',
      label: 'Rostos',
      icon: '😀',
      items: [
        ['😀', 'sorriso feliz alegre', 1],
        ['😃', 'sorriso animado feliz'],
        ['😄', 'sorriso rindo feliz'],
        ['😁', 'sorriso dentes alegre'],
        ['😆', 'risada gargalhada rindo'],
        ['😅', 'risada nervoso suor alivio'],
        ['🤣', 'rolando de rir gargalhada chao'],
        ['😂', 'chorando de rir lagrima risada', 1],
        ['🙂', 'sorriso leve simpatico'],
        ['🙃', 'de cabeca para baixo ironia'],
        ['😉', 'piscada flerte'],
        ['😊', 'sorriso timido fofo'],
        ['😇', 'anjo aureola inocente'],
        ['🥰', 'apaixonado coracoes amor'],
        ['😍', 'olhos de coracao amor paixao'],
        ['🤩', 'estrelas uau incrivel'],
        ['😘', 'beijo mandando beijo'],
        ['😗', 'beijo assobio'],
        ['😙', 'beijo sorriso'],
        ['😋', 'delicioso lingua gostoso'],
        ['😛', 'lingua brincadeira'],
        ['😜', 'lingua piscada zoeira'],
        ['🤪', 'louco doido maluco'],
        ['🤨', 'sobrancelha duvida desconfiado'],
        ['🧐', 'monoculo analisando curioso'],
        ['🤓', 'nerd oculos estudioso'],
        ['😎', 'oculos de sol estiloso legal'],
        ['🥸', 'disfarce bigode oculos'],
        ['🤯', 'explodindo mente chocado'],
        ['😏', 'malicioso sorrisinho'],
        ['😒', 'sem graca entediado'],
        ['🙄', 'revirando os olhos ironia'],
        ['😬', 'careta constrangido'],
        ['😮‍💨', 'suspiro alivio cansaco'],
        ['🤔', 'pensando duvida'],
        ['🤫', 'silencio segredo shh'],
        ['🤭', 'ops risadinha vergonha'],
        ['😴', 'dormindo sono cansado'],
        ['😪', 'sono cansado'],
        ['🥱', 'bocejo tedio sono'],
        ['😷', 'mascara doente'],
        ['🤒', 'febre doente termometro'],
        ['🤕', 'machucado curativo'],
        ['🤢', 'enjoado nojo'],
        ['🤮', 'vomitando nojo passando mal'],
        ['🥵', 'calor quente derretendo'],
        ['🥶', 'frio congelando'],
        ['😵‍💫', 'tonto confuso'],
        ['🤠', 'cauboi chapeu'],
        ['🥳', 'festa comemorando aniversario'],
        ['😤', 'bufando irritado determinado'],
        ['😡', 'bravo raiva furioso'],
        ['🤬', 'xingando palavrao raiva'],
        ['😞', 'decepcionado triste'],
        ['😔', 'pensativo triste'],
        ['😢', 'chorando triste lagrima'],
        ['😭', 'chorando muito desesperado'],
        ['😱', 'grito susto medo'],
        ['😨', 'medo assustado'],
        ['😰', 'ansioso suor nervoso'],
        ['😥', 'aliviado triste'],
        ['😓', 'suor derrota cansado'],
        ['🥹', 'emocionado segurando lagrima'],
        ['😳', 'corado surpreso envergonhado'],
        ['🫠', 'derretendo constrangido'],
        ['🥲', 'sorriso com lagrima emocionado'],
        ['😶', 'sem boca calado'],
        ['😐', 'neutro sem reacao'],
        ['😑', 'inexpressivo sem paciencia'],
        ['🫡', 'continencia salve respeito'],
        ['🤝', 'aperto de mao acordo combinado'],
        ['💀', 'caveira morri morto'],
        ['👻', 'fantasma assombracao'],
        ['👽', 'alien et'],
        ['🤖', 'robo bot'],
        ['💩', 'coco merda ruim'],
        ['🤡', 'palhaco'],
        ['😈', 'diabo travesso'],
        ['🫶', 'coracao com as maos amor'],
      ],
    },
    {
      id: 'gestos',
      label: 'Gestos',
      icon: '👍',
      items: [
        ['👍', 'joia positivo curti ok', 1],
        ['👎', 'negativo nao ruim'],
        ['👌', 'ok perfeito certo'],
        ['🤌', 'italiano dedos gesto'],
        ['✌️', 'paz vitoria dois'],
        ['🤞', 'dedos cruzados sorte torcendo'],
        ['🤟', 'te amo rock'],
        ['🤘', 'rock chifres metal'],
        ['🤙', 'me liga shaka'],
        ['👈', 'aponta esquerda'],
        ['👉', 'aponta direita'],
        ['👆', 'aponta cima'],
        ['👇', 'aponta baixo'],
        ['☝️', 'atencao um dedo'],
        ['✋', 'mao parada alto'],
        ['🖐️', 'mao aberta dedos'],
        ['🖖', 'vulcano spock'],
        ['👋', 'tchau oi aceno'],
        ['🤚', 'mao costas'],
        ['🙏', 'obrigado por favor reza', 1],
        ['✍️', 'escrevendo anotando'],
        ['👏', 'palmas aplauso parabens'],
        ['🙌', 'maos pro alto comemorando'],
        ['👐', 'maos abertas abraco'],
        ['🤲', 'maos juntas pedido'],
        ['💪', 'forca biceps musculo'],
        ['🦾', 'braco robotico forte'],
        ['🫵', 'voce aponta'],
        ['👀', 'olhos olhando vendo'],
        ['👁️', 'olho vendo'],
        ['🧠', 'cerebro ideia inteligente'],
        ['🫀', 'coracao orgao'],
        ['👶', 'bebe crianca'],
        ['🧒', 'crianca'],
        ['🧑', 'pessoa'],
        ['👨', 'homem'],
        ['👩', 'mulher'],
        ['🧓', 'idoso velho'],
        ['👮', 'policia guarda'],
        ['🕵️', 'detetive investigando'],
        ['👨‍💻', 'programador dev computador'],
        ['👩‍💻', 'programadora dev computador'],
        ['🧑‍🍳', 'cozinheiro chef'],
        ['🦸', 'heroi super'],
        ['🧙', 'mago feiticeiro'],
        ['🧟', 'zumbi'],
        ['🎅', 'papai noel natal'],
        ['🕺', 'dancando homem festa'],
        ['💃', 'dancando mulher festa'],
        ['🏃', 'correndo fugindo pressa'],
        ['🧘', 'meditando calma yoga'],
        ['🤦', 'facepalm nao acredito'],
        ['🤷', 'sei la ombros duvida'],
        ['🙋', 'levantando a mao eu'],
        ['🙅', 'nao pode proibido'],
        ['🙆', 'ok certo'],
      ],
    },
    {
      id: 'natureza',
      label: 'Natureza',
      icon: '🐶',
      items: [
        ['🐶', 'cachorro dog', 1],
        ['🐱', 'gato cat'],
        ['🐭', 'rato'],
        ['🐹', 'hamster'],
        ['🐰', 'coelho'],
        ['🦊', 'raposa'],
        ['🐻', 'urso'],
        ['🐼', 'panda'],
        ['🐨', 'coala'],
        ['🐯', 'tigre'],
        ['🦁', 'leao'],
        ['🐮', 'vaca boi'],
        ['🐷', 'porco'],
        ['🐸', 'sapo'],
        ['🐵', 'macaco'],
        ['🙈', 'macaco olhos nao vejo'],
        ['🐔', 'galinha'],
        ['🐧', 'pinguim'],
        ['🐦', 'passaro'],
        ['🦆', 'pato'],
        ['🦅', 'aguia'],
        ['🦉', 'coruja'],
        ['🐺', 'lobo'],
        ['🐗', 'javali'],
        ['🐴', 'cavalo'],
        ['🦄', 'unicornio'],
        ['🐝', 'abelha'],
        ['🐛', 'lagarta bug'],
        ['🦋', 'borboleta'],
        ['🐌', 'lesma devagar'],
        ['🐞', 'joaninha bug'],
        ['🐜', 'formiga'],
        ['🕷️', 'aranha'],
        ['🐢', 'tartaruga lento'],
        ['🐍', 'cobra'],
        ['🦎', 'lagartixa'],
        ['🐙', 'polvo'],
        ['🦑', 'lula'],
        ['🦐', 'camarao'],
        ['🐠', 'peixe tropical'],
        ['🐟', 'peixe'],
        ['🐬', 'golfinho'],
        ['🐳', 'baleia'],
        ['🦈', 'tubarao'],
        ['🐊', 'jacare crocodilo'],
        ['🐘', 'elefante'],
        ['🦒', 'girafa'],
        ['🦘', 'canguru'],
        ['🐄', 'vaca'],
        ['🌵', 'cacto deserto'],
        ['🌲', 'pinheiro arvore'],
        ['🌳', 'arvore'],
        ['🌴', 'coqueiro palmeira praia'],
        ['🍀', 'trevo sorte'],
        ['🍁', 'folha outono'],
        ['🌺', 'flor hibisco'],
        ['🌸', 'flor cerejeira'],
        ['🌻', 'girassol flor'],
        ['🌹', 'rosa flor'],
        ['🌼', 'margarida flor'],
        ['🌷', 'tulipa flor'],
        ['🌞', 'sol dia'],
        ['🌝', 'lua cheia rosto'],
        ['🌙', 'lua noite'],
        ['⭐', 'estrela'],
        ['🌟', 'estrela brilhante'],
        ['✨', 'brilho magia faisca'],
        ['⚡', 'raio energia rapido'],
        ['🔥', 'fogo top incrivel', 1],
        ['💧', 'gota agua'],
        ['🌊', 'onda mar'],
        ['🌈', 'arco iris'],
        ['☀️', 'sol ensolarado'],
        ['⛅', 'nublado sol nuvem'],
        ['☁️', 'nuvem nublado'],
        ['🌧️', 'chuva chovendo'],
        ['⛈️', 'tempestade raio chuva'],
        ['❄️', 'neve floco frio'],
        ['⛄', 'boneco de neve'],
        ['🌪️', 'tornado furacao'],
      ],
    },
    {
      id: 'comida',
      label: 'Comida',
      icon: '🍔',
      items: [
        ['🍏', 'maca verde fruta'],
        ['🍎', 'maca fruta'],
        ['🍐', 'pera fruta'],
        ['🍊', 'laranja fruta'],
        ['🍋', 'limao fruta'],
        ['🍌', 'banana fruta'],
        ['🍉', 'melancia fruta'],
        ['🍇', 'uva fruta'],
        ['🍓', 'morango fruta'],
        ['🫐', 'mirtilo fruta'],
        ['🍒', 'cereja fruta'],
        ['🍑', 'pessego bunda fruta'],
        ['🥭', 'manga fruta'],
        ['🍍', 'abacaxi fruta'],
        ['🥥', 'coco fruta'],
        ['🥝', 'kiwi fruta'],
        ['🍅', 'tomate'],
        ['🥑', 'abacate'],
        ['🌽', 'milho'],
        ['🥕', 'cenoura'],
        ['🥔', 'batata'],
        ['🍞', 'pao'],
        ['🥐', 'croissant pao'],
        ['🥖', 'baguete pao'],
        ['🧀', 'queijo'],
        ['🥚', 'ovo'],
        ['🍳', 'ovo frito cafe da manha'],
        ['🥓', 'bacon'],
        ['🍔', 'hamburguer lanche'],
        ['🍟', 'batata frita'],
        ['🍕', 'pizza'],
        ['🌭', 'cachorro quente hot dog'],
        ['🥪', 'sanduiche lanche'],
        ['🌮', 'taco'],
        ['🌯', 'burrito wrap'],
        ['🥗', 'salada'],
        ['🍝', 'macarrao massa'],
        ['🍜', 'lamen sopa macarrao'],
        ['🍲', 'panela ensopado'],
        ['🍛', 'curry arroz'],
        ['🍣', 'sushi'],
        ['🍤', 'camarao frito'],
        ['🍚', 'arroz'],
        ['🍦', 'sorvete casquinha'],
        ['🍩', 'rosquinha donut'],
        ['🍪', 'biscoito cookie'],
        ['🎂', 'bolo aniversario'],
        ['🍰', 'fatia de bolo'],
        ['🧁', 'cupcake bolinho'],
        ['🍫', 'chocolate'],
        ['🍬', 'bala doce'],
        ['🍿', 'pipoca filme'],
        ['🧂', 'sal'],
        ['☕', 'cafe'],
        ['🍵', 'cha'],
        ['🧃', 'suco caixinha'],
        ['🥤', 'refrigerante copo'],
        ['🍺', 'cerveja chopp'],
        ['🍻', 'brinde cerveja saude'],
        ['🍷', 'vinho taca'],
        ['🥂', 'brinde champanhe comemorar'],
        ['🍾', 'champanhe comemoracao'],
        ['🥃', 'whisky dose'],
        ['🧉', 'chimarrao mate'],
      ],
    },
    {
      id: 'atividades',
      label: 'Atividades',
      icon: '🎮',
      items: [
        ['🎮', 'jogo videogame controle'],
        ['🕹️', 'joystick arcade jogo'],
        ['🎲', 'dado sorte jogo'],
        ['🃏', 'coringa carta'],
        ['🎯', 'alvo mira acerto'],
        ['🎰', 'caca niquel sorte'],
        ['🧩', 'quebra cabeca peca'],
        ['♟️', 'xadrez peao'],
        ['⚽', 'futebol bola'],
        ['🏀', 'basquete bola'],
        ['🏈', 'futebol americano'],
        ['⚾', 'beisebol'],
        ['🎾', 'tenis'],
        ['🏐', 'volei'],
        ['🏓', 'ping pong tenis de mesa'],
        ['🏸', 'badminton'],
        ['🥅', 'gol trave'],
        ['🏆', 'trofeu campeao vitoria'],
        ['🥇', 'ouro primeiro medalha'],
        ['🥈', 'prata segundo medalha'],
        ['🥉', 'bronze terceiro medalha'],
        ['🎖️', 'medalha honra'],
        ['🏅', 'medalha esporte'],
        ['🎽', 'corrida camiseta'],
        ['🛹', 'skate'],
        ['🚴', 'bicicleta ciclismo'],
        ['🏋️', 'academia musculacao peso'],
        ['🤺', 'esgrima'],
        ['🥊', 'boxe luva'],
        ['🎣', 'pescaria vara'],
        ['🎸', 'guitarra violao musica'],
        ['🎹', 'piano teclado musica'],
        ['🥁', 'bateria tambor musica'],
        ['🎺', 'trompete musica'],
        ['🎤', 'microfone cantar karaoke'],
        ['🎧', 'fone de ouvido musica'],
        ['🎬', 'claquete filme cinema'],
        ['🎨', 'arte pintura paleta'],
        ['🎭', 'teatro mascaras'],
        ['🎪', 'circo'],
        ['🎉', 'festa comemoracao parabens', 1],
        ['🎊', 'confete festa'],
        ['🎈', 'balao festa'],
        ['🎁', 'presente'],
        ['🎃', 'halloween abobora'],
        ['🎄', 'natal arvore'],
        ['🧨', 'dinamite explosivo'],
        ['📸', 'foto camera flash'],
      ],
    },
    {
      id: 'viagem',
      label: 'Lugares',
      icon: '🚗',
      items: [
        ['🚗', 'carro automovel', 1],
        ['🚕', 'taxi'],
        ['🚙', 'suv carro'],
        ['🚌', 'onibus'],
        ['🏎️', 'corrida formula 1 carro'],
        ['🚓', 'viatura policia'],
        ['🚑', 'ambulancia'],
        ['🚒', 'bombeiro caminhao'],
        ['🚚', 'caminhao entrega'],
        ['🚜', 'trator'],
        ['🏍️', 'moto'],
        ['🛵', 'scooter moto'],
        ['🚲', 'bicicleta bike'],
        ['✈️', 'aviao voo viagem'],
        ['🚀', 'foguete lancamento rapido'],
        ['🛸', 'disco voador ovni'],
        ['🚁', 'helicoptero'],
        ['⛵', 'veleiro barco'],
        ['🚢', 'navio'],
        ['🚂', 'trem locomotiva'],
        ['🚇', 'metro'],
        ['🗺️', 'mapa'],
        ['🧭', 'bussola direcao'],
        ['🏔️', 'montanha neve'],
        ['🌋', 'vulcao'],
        ['🏝️', 'ilha praia'],
        ['🏖️', 'praia guarda sol'],
        ['🏕️', 'acampamento barraca'],
        ['🏠', 'casa'],
        ['🏢', 'predio escritorio'],
        ['🏥', 'hospital'],
        ['🏦', 'banco'],
        ['🏫', 'escola'],
        ['🏭', 'fabrica industria'],
        ['🗼', 'torre'],
        ['🗽', 'estatua da liberdade'],
        ['⛲', 'fonte chafariz'],
        ['🌉', 'ponte noite'],
        ['🌃', 'cidade noite'],
        ['🌆', 'cidade entardecer'],
        ['🗿', 'moai estatua'],
        ['🧱', 'tijolo parede'],
      ],
    },
    {
      id: 'objetos',
      label: 'Objetos',
      icon: '💻',
      items: [
        ['💻', 'notebook computador laptop'],
        ['🖥️', 'monitor computador pc'],
        ['⌨️', 'teclado'],
        ['🖱️', 'mouse'],
        ['🖨️', 'impressora'],
        ['💾', 'disquete salvar'],
        ['💿', 'cd disco'],
        ['📱', 'celular telefone'],
        ['☎️', 'telefone fixo'],
        ['📞', 'ligacao telefone'],
        ['🔋', 'bateria energia'],
        ['🔌', 'tomada plugue'],
        ['💡', 'ideia lampada'],
        ['🔦', 'lanterna luz'],
        ['🕯️', 'vela'],
        ['📷', 'camera foto'],
        ['📹', 'filmadora video'],
        ['📺', 'tv televisao'],
        ['📻', 'radio'],
        ['⏰', 'despertador alarme hora'],
        ['⏳', 'ampulheta tempo esperando'],
        ['⌛', 'tempo acabou ampulheta'],
        ['🔍', 'lupa procurar busca'],
        ['🔒', 'cadeado trancado seguro'],
        ['🔓', 'cadeado aberto destrancado'],
        ['🔑', 'chave'],
        ['🔨', 'martelo'],
        ['🪛', 'chave de fenda'],
        ['🔧', 'chave inglesa ferramenta'],
        ['⚙️', 'engrenagem configuracao'],
        ['🧰', 'caixa de ferramentas'],
        ['🧲', 'ima'],
        ['💊', 'remedio pilula'],
        ['💉', 'injecao vacina'],
        ['🧪', 'tubo de ensaio experimento'],
        ['🔬', 'microscopio ciencia'],
        ['🔭', 'telescopio'],
        ['📡', 'antena satelite sinal'],
        ['📌', 'alfinete fixar'],
        ['📎', 'clipe anexo'],
        ['✂️', 'tesoura cortar'],
        ['📝', 'anotacao escrever nota'],
        ['📄', 'documento folha'],
        ['📁', 'pasta arquivo'],
        ['📦', 'caixa pacote entrega'],
        ['📬', 'caixa de correio mensagem'],
        ['✉️', 'envelope email carta'],
        ['💰', 'dinheiro saco grana'],
        ['💵', 'dinheiro nota'],
        ['💳', 'cartao de credito'],
        ['🛒', 'carrinho compras'],
        ['🎒', 'mochila'],
        ['👕', 'camiseta roupa'],
        ['👟', 'tenis sapato'],
        ['👑', 'coroa rei lider'],
        ['💎', 'diamante joia'],
        ['🛡️', 'escudo protecao'],
        ['⚔️', 'espadas batalha luta'],
        ['🧹', 'vassoura limpar'],
        ['🗑️', 'lixeira apagar excluir'],
        ['🛏️', 'cama dormir'],
        ['🚪', 'porta'],
        ['🪟', 'janela'],
      ],
    },
    {
      id: 'simbolos',
      label: 'Símbolos',
      icon: '❤️',
      items: [
        ['❤️', 'coracao amor vermelho', 1],
        ['🧡', 'coracao laranja'],
        ['💛', 'coracao amarelo'],
        ['💚', 'coracao verde'],
        ['💙', 'coracao azul'],
        ['💜', 'coracao roxo'],
        ['🖤', 'coracao preto'],
        ['🤍', 'coracao branco'],
        ['💔', 'coracao partido triste'],
        ['❣️', 'coracao exclamacao'],
        ['💕', 'dois coracoes amor'],
        ['💖', 'coracao brilhante amor'],
        ['💘', 'coracao flecha paixao'],
        ['💯', 'cem nota maxima top'],
        ['✅', 'certo ok feito confirmado', 1],
        ['☑️', 'marcado caixa feito'],
        ['❌', 'errado nao cancelar'],
        ['⭕', 'circulo certo'],
        ['❗', 'exclamacao atencao'],
        ['❓', 'interrogacao duvida'],
        ['⚠️', 'aviso atencao cuidado'],
        ['🚫', 'proibido bloqueado'],
        ['🔕', 'sem som silencioso mudo'],
        ['🔔', 'sino notificacao'],
        ['🔇', 'mudo sem audio'],
        ['🔊', 'som alto audio'],
        ['📢', 'megafone anuncio aviso'],
        ['♻️', 'reciclar'],
        ['🔄', 'atualizar recarregar sincronizar'],
        ['➕', 'mais adicionar'],
        ['➖', 'menos remover'],
        ['✖️', 'vezes multiplicar'],
        ['➗', 'dividir'],
        ['🔺', 'triangulo vermelho subir'],
        ['🔻', 'triangulo vermelho descer'],
        ['⏸️', 'pausa pausar'],
        ['▶️', 'play tocar iniciar'],
        ['⏹️', 'parar stop'],
        ['⏭️', 'proximo pular'],
        ['🔀', 'aleatorio embaralhar'],
        ['🔁', 'repetir loop'],
        ['🆕', 'novo'],
        ['🆗', 'ok'],
        ['🆘', 'socorro sos ajuda'],
        ['🔝', 'topo cima'],
        ['💤', 'sono dormindo zzz'],
        ['💥', 'explosao boom'],
        ['💫', 'tontura estrelas'],
        ['🕐', 'hora relogio'],
        ['🇧🇷', 'brasil bandeira'],
        ['🏳️', 'bandeira branca rendicao'],
        ['🏁', 'bandeira quadriculada fim chegada'],
      ],
    },
  ];

  const MAX_RECENTS = 24;

  // Indice plano, montado uma vez: a busca varre isto, nao a arvore de
  // grupos. `keys` ja vem normalizado -- normalizar 400 strings a cada
  // tecla digitada seria trabalho jogado fora.
  const INDEX = [];
  for (const group of GROUPS) {
    for (const [char, keywords, weight] of group.items) {
      INDEX.push({ char, keywords, group: group.id, weight: weight || 0, keys: normalize(keywords).split(/\s+/) });
    }
  }

  const BY_CHAR = new Map(INDEX.map((e) => [e.char, e]));

  /** Minusculas e sem acento. E o que faz "coracao" e "coração" acharem a
   * mesma coisa -- a lista de palavras-chave ja e escrita sem acento, e a
   * consulta do usuario passa por aqui. */
  function normalize(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /** Busca por PREFIXO de palavra, nao por substring: "car" acha "carro" e
   * "carta", e nao acha "placar". Substring transformava toda consulta
   * curta numa lista aleatoria de 80 emoji.
   *
   * Ordena por onde o prefixo casou: quem casa na PRIMEIRA palavra-chave
   * (a mais obvia) vem antes de quem casa numa palavra do fim. */
  function search(query, limit = 60) {
    const q = normalize(query);
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const entry of INDEX) {
      let score = 0;
      let all = true;
      for (const term of terms) {
        const pos = entry.keys.findIndex((k) => k.startsWith(term));
        if (pos < 0) {
          all = false;
          break;
        }
        score += pos;
      }
      if (all) hits.push({ entry, score: score * 10 - entry.weight });
    }
    hits.sort((a, b) => a.score - b.score);
    return hits.slice(0, limit).map((h) => h.entry.char);
  }

  /** Primeira palavra-chave -- vira o `title` do botao ("carro", "pizza"). */
  function labelFor(char) {
    const entry = BY_CHAR.get(char);
    return entry ? entry.keywords.split(' ')[0] : '';
  }

  function isKnown(char) {
    return BY_CHAR.has(char);
  }

  /** Recentes: o usado agora vai pra frente, sem repetir, com teto. Puro de
   * proposito -- quem guarda e o config (localStorage), quem decide a ordem
   * e isto. */
  function pushRecent(list, char, max = MAX_RECENTS) {
    const base = Array.isArray(list) ? list.filter((c) => c !== char && isKnown(c)) : [];
    if (!isKnown(char)) return base.slice(0, max);
    return [char, ...base].slice(0, max);
  }

  /** Limpa uma lista de recentes vinda do config: descarta o que nao existe
   * mais na lista (emoji removido numa versao futura) e o repetido. */
  function loadRecents(list, max = MAX_RECENTS) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const char of list) {
      if (typeof char !== 'string' || !isKnown(char) || out.includes(char)) continue;
      out.push(char);
      if (out.length >= max) break;
    }
    return out;
  }

  const api = { GROUPS, MAX_RECENTS, normalize, search, labelFor, isKnown, pushRecent, loadRecents };

  root.GoLive = root.GoLive || {};
  root.GoLive.emoji = api;

  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : global);

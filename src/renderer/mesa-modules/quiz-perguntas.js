'use strict';

/*
 * Banco autoral e estavel do Quiz. Cada entrada tem pergunta, quatro respostas
 * distintas e o indice da resposta certa. O modulo valida o banco ao carregar.
 */

(function (root) {
  const ACENTOS = Object.freeze({
    area: 'área', agua: 'água', alguem: 'alguém', America: 'América',
    angulo: 'ângulo', arquipelago: 'arquipélago', arvore: 'árvore', Asia: 'Ásia',
    Atlantico: 'Atlântico', audicao: 'audição', basica: 'básica', basquete: 'basquete',
    bissexto: 'bissexto', Brasilia: 'Brasília', bussola: 'bússola', cafe: 'café',
    calendario: 'calendário', camaleao: 'camaleão', Canada: 'Canadá', capitao: 'capitão',
    celula: 'célula', Celula: 'Célula', Ceara: 'Ceará', cidade: 'cidade', circulo: 'círculo',
    Colombia: 'Colômbia', Comedia: 'Comédia', coracao: 'coração', Cordoba: 'Córdoba',
    cronometro: 'cronômetro', Damas: 'Damas', decagono: 'decágono', deserto: 'deserto',
    dioxido: 'dióxido', Dioxido: 'Dióxido', domino: 'dominó', edificio: 'edifício', edificios: 'edifícios', equipe: 'equipe',
    expressao: 'expressão', fenomeno: 'fenômeno', fisico: 'físico', Franca: 'França',
    fracao: 'fração', geometrica: 'geométrica', Goiania: 'Goiânia', Goias: 'Goiás', Golfo: 'Golfo',
    hexagono: 'hexágono', historia: 'história', ideia: 'ideia',
    Iguacu: 'Iguaçu', ima: 'ímã', Indico: 'Índico', instrumento: 'instrumento',
    India: 'Índia', Japao: 'Japão', Joao: 'João', Jupiter: 'Júpiter', Kalahari: 'Kalahari', licao: 'lição',
    linha: 'linha', litosfera: 'litosfera', Luis: 'Luís',
    Lusiadas: 'Lusíadas', Macapa: 'Macapá', mamifero: 'mamífero', Maranhao: 'Maranhão',
    materia: 'matéria', Mexico: 'México', Mediterraneo: 'Mediterrâneo', Mercurio: 'Mercúrio',
    montanha: 'montanha', musico: 'músico', nao: 'não', natural: 'natural',
    numero: 'número', orgao: 'órgão', Orgao: 'Órgão', Pacifico: 'Pacífico', Para: 'Pará',
    Parana: 'Paraná', periodo: 'período', peca: 'peça', pecas: 'peças',
    Pelourinho: 'Pelourinho', Pernambuco: 'Pernambuco', poligono: 'polígono',
    Portugues: 'Português', pinguim: 'pinguim',
    primeiro: 'primeiro', produzem: 'produzem', profissao: 'profissão',
    proximo: 'próximo', quadrada: 'quadrada', regiao: 'região', relatorio: 'relatório',
    Sao: 'São', satelite: 'satélite', Sinfonia: 'Sinfonia', sistema: 'sistema',
    solido: 'sólido', sinonimo: 'sinônimo', Sol: 'Sol', Tailandia: 'Tailândia',
    Tiete: 'Tietê', Toquio: 'Tóquio', tres: 'três',
    unidade: 'unidade', Venus: 'Vênus', Vitoria: 'Vitória', voleibol: 'voleibol',
    xadrez: 'xadrez', xeque: 'xeque', zoologico: 'zoológico',
    Atlantica: 'Mata Atlântica', Africa: 'África',
    Aluminio: 'Alumínio', Azeite: 'Azeite',
    Belem: 'Belém', Cafe: 'Café', Cancer: 'Câncer',
    Candido: 'Cândido', Camberra: 'Camberra',
    Contrabaixo: 'Contrabaixo', Cronometro: 'Cronômetro',
    Cricket: 'Críquete',
    Equinocio: 'Equinócio', Evaporacao: 'Evaporação',
    Eolica: 'Eólica', Espanhol: 'Espanhol',
    Fisica: 'Física', Fotossintese: 'Fotossíntese',
    Frances: 'Francês', Fermentacao: 'Fermentação', Fusao: 'Fusão',
    Gasoso: 'Gasoso', Grecia: 'Grécia', Gize: 'Gizé',
    Hidrogenio: 'Hidrogênio', Higrometro: 'Higrômetro',
    Ingles: 'Inglês', Islandia: 'Islândia', Italia: 'Itália',
    Liquido: 'Líquido', Maremotriz: 'Maremotriz',
    Maringa: 'Maringá', Mata: 'Mata', Molecula: 'Molécula',
    Nitrogenio: 'Nitrogênio', Nevoa: 'Névoa',
    Oxigenio: 'Oxigênio', Oboe: 'Oboé',
    Pandeiro: 'Pandeiro', Parnaiba: 'Parnaíba', Pao: 'Pão', pao: 'pão',
    Paes: 'Pães', Paoes: 'Pães', Paos: 'Pães', Piramides: 'Pirâmides',
    Poker: 'Pôquer', Polaris: 'Polaris',
    Recife: 'Recife', Rondonia: 'Rondônia',
    SaoLuis: 'São Luís',
    Solidificacao: 'Solidificação', Solsticio: 'Solstício',
    Tenis: 'Tênis', Titan: 'Titã', Tubarao: 'Tubarão',
    Tropico: 'Trópico', Triangulo: 'Triângulo',
    Velocimetro: 'Velocímetro', Verissimo: 'Veríssimo',
    Virgilio: 'Virgílio', Visao: 'Visão',
    Australia: 'Austrália', Aconcagua: 'Aconcágua',
    Audicao: 'Audição', Agronomo: 'Agrônomo',
    Barometro: 'Barômetro',
    Circulo: 'Círculo', Condensacao: 'Condensação',
    Constituicao: 'Constituição', Contrario: 'contrário',
    Decagono: 'Decágono', Distancia: 'distância',
    Digestao: 'Digestão',
    Edificios: 'Edifícios', Fisionomia: 'Fisionomia',
    Geotermica: 'Geotérmica', Heptagono: 'Heptágono',
    Liquida: 'líquida', Mont: 'Mont',
    Onca: 'Onça', OncaPintada: 'Onça-pintada',
    Pentagono: 'Pentágono', Peca: 'Peça',
    Sinais: 'Sinais', Sistema: 'Sistema',
    Algodao: 'Algodão', Amazonico: 'amazônico', amazonico: 'amazônico',
    Artico: 'Ártico', Economico: 'Econômico',
    economico: 'econômico', Exposicao: 'exposição', Figado: 'Fígado',
    Gas: 'Gás', gas: 'gás', Planetario: 'planetário',
    planetario: 'planetário', Pulmao: 'Pulmão', Sirius: 'Sirius',
    Uberlandia: 'Uberlândia', nivel: 'nível', Atraido: 'atraído',
    atraido: 'atraído', As: '\u00c1s',
    pais: 'pa\u00eds', piramides: 'pir\u00e2mides',
    Groenlandia: 'Groenl\u00e2ndia', combustao: 'combust\u00e3o', liquida: 'l\u00edquida',
    pulmao: 'pulm\u00e3o', figado: 'f\u00edgado',
    liquido: 'l\u00edquido', molecula: 'mol\u00e9cula',
    solsticio: 'solst\u00edcio', equinocio: 'equin\u00f3cio',
    artistico: 'art\u00edstico', musicais: 'musicais',
    Principe: 'Pr\u00edncipe',
    Exupery: 'Exup\u00e9ry', Jose: 'Jos\u00e9', Julio: 'J\u00falio',
    Cortico: 'Corti\u00e7o', Fabula: 'F\u00e1bula', Cronica: 'Cr\u00f4nica',
    Buscape: 'Buscap\u00e9', Danubio: 'Dan\u00fabio',
    Galileu: 'Galileu', Saint: 'Saint', frances: 'francês',
    Altimetro: 'Altímetro', Atmosfera: 'Atmosfera', Americas: 'Américas',
    Bussola: 'Bússola', Camaleao: 'Camaleão', Combustao: 'Combustão',
    Coracao: 'Coração', direcoes: 'direções', distancia: 'distância',
    Octogono: 'Octógono',
    Solido: 'Sólido', Termometro: 'Termômetro', exposicao: 'exposição',
    imaginaria: 'imaginária', hemisferios: 'hemisférios', ha: 'há',
    Erico: 'Érico', contrario: 'contrário', Russia: 'Rússia',
  });

  function acentuar(texto) {
    let saida = texto;
    for (const [semAcento, comAcento] of Object.entries(ACENTOS)) {
      saida = saida.replace(new RegExp(`\\b${semAcento}\\b`, 'g'), comAcento);
    }
    return saida
      .replace(/\b(Qual|Quem) e\b/g, '$1 é')
      .replace(/\b e (?=(a|conhecida|tradicionalmente|jogado|conhecido|associado|mais|liquido|produzida|planetario|abundante|um|feito|atraido)\b)/g, ' é ')
      .replace(/\bCidade Maravilhosa\b/g, 'Cidade Maravilhosa');
  }

  function corrigirFrases(texto) {
    return texto
      .replace(/\b e \b/g, ' \u00e9 ')
      .replace(/azul \u00e9 amarelo/g, 'azul e amarelo')
      .replace(/torre \u00e9 bispo/g, 'torre e bispo')
      .replace(/samba \u00e9 choro/g, 'samba e choro')
      .replace(/raquete \u00e9 uma/g, 'raquete e uma')
      .replace(/brancas \u00e9 pretas/g, 'brancas e pretas')
      .replace(/Terra \u00e9 o Sol/g, 'Terra e o Sol')
      .replace(/norte \u00e9 sul/g, 'norte e sul')
      .replace(/\u00e1s Cataratas/g, 'as Cataratas')
      .replace(/\u00e1s pe\u00e7as/g, 'as pe\u00e7as')
      .replace(/Mata Mata Atl\u00e2ntica/g, 'Mata Atl\u00e2ntica');
  }

  const raw = [
    ['Qual e a capital do Brasil?', ['Brasilia', 'Goiania', 'Salvador', 'Recife'], 0],
    ['Qual e o maior estado brasileiro em area?', ['Amazonas', 'Para', 'Mato Grosso', 'Minas Gerais'], 0],
    ['Qual bioma ocupa grande parte do Nordeste brasileiro?', ['Caatinga', 'Pampa', 'Pantanal', 'Mata Atlantica'], 0],
    ['Em que estado fica o arquipelago de Fernando de Noronha?', ['Pernambuco', 'Bahia', 'Ceara', 'Alagoas'], 0],
    ['Qual rio passa pela cidade de Manaus?', ['Negro', 'Tietê', 'Sao Francisco', 'Parana'], 0],
    ['Qual e a capital de Minas Gerais?', ['Belo Horizonte', 'Vitoria', 'Uberlandia', 'Ouro Preto'], 0],
    ['Qual oceano banha a costa brasileira?', ['Atlantico', 'Pacifico', 'Indico', 'Artico'], 0],
    ['Qual foi a primeira capital do Brasil?', ['Salvador', 'Rio de Janeiro', 'Olinda', 'Brasilia'], 0],
    ['Qual cidade e conhecida como Cidade Maravilhosa?', ['Rio de Janeiro', 'Sao Paulo', 'Curitiba', 'Natal'], 0],
    ['Qual e a moeda oficial do Brasil?', ['Real', 'Cruzeiro', 'Peso', 'Escudo'], 0],
    ['Qual e o maior rio inteiramente brasileiro?', ['Sao Francisco', 'Amazonas', 'Parnaiba', 'Araguaia'], 0],
    ['Qual cidade brasileira é conhecida como a capital do frevo?',
      ['Recife', 'Olinda', 'Salvador', 'Natal'], 0],
    ['Em qual cidade fica o Pelourinho?', ['Salvador', 'Recife', 'Sao Luis', 'Belem'], 0],
    ['Qual e a capital do estado do Para?', ['Belem', 'Macapa', 'Boa Vista', 'Palmas'], 0],
    ['Qual festa popular acontece no periodo junino?',
      ['Festas de Sao Joao', 'Carnaval', 'Bumba meu boi', 'Lavagem do Bonfim'], 0],
    ['Qual objeto colorido os passistas levam na mão ao dançar frevo?',
      ['Sombrinha', 'Leque', 'Bandeira', 'Lenço'], 0],
    ['Qual e o estado brasileiro conhecido pela sigla RJ?',
      ['Rio de Janeiro', 'Rondonia', 'Roraima', 'Rio Grande do Sul'], 0],
    ['Qual cidade abriga as Cataratas do Iguacu no lado brasileiro?',
      ['Foz do Iguacu', 'Cascavel', 'Londrina', 'Maringa'], 0],
    ['Qual e a maior regiao brasileira em area?', ['Norte', 'Nordeste', 'Centro-Oeste', 'Sul'], 0],
    ['Qual produto e tradicionalmente associado ao ciclo economico amazonico?',
      ['Borracha', 'Cacau', 'Cafe', 'Algodao'], 0],
    ['Quantos jogadores formam um time de futebol em campo?', ['11', '9', '10', '12'], 0],
    ['Quantas casas tem um tabuleiro de xadrez?', ['64', '32', '48', '72'], 0],
    ['Qual peca do xadrez se move em L?', ['Cavalo', 'Bispo', 'Torre', 'Dama'], 0],
    ['No truco paulista, quantas cartas cada jogador recebe?', ['3', '2', '4', '5'], 0],
    ['Quantas faces tem um dado comum?', ['6', '4', '8', '12'], 0],
    ['Qual jogo usa as pecas rei, dama, torre e bispo?', ['Xadrez', 'Damas', 'Gamão', 'Dominó'], 0],
    ['Quantas pecas tem o jogo de domino duplo-seis?', ['28', '24', '30', '32'], 0],
    ['Em qual esporte se marca um touchdown?', ['Futebol americano', 'Rugby', 'Beisebol', 'Hóquei'], 0],
    ['Qual carta costuma valer 11 no blackjack?', ['As', 'Rei', 'Dama', 'Coringa'], 0],
    ['No voleibol, quantos jogadores de cada equipe ficam em quadra?', ['6', '5', '7', '8'], 0],
    ['Qual peca do jogo de damas anda na diagonal?',
      ['Todas as pecas', 'Apenas a dama', 'Apenas a peca vermelha', 'Nenhuma'], 0],
    ['Quantos buracos tem uma rodada tradicional de golfe?', ['18', '9', '12', '21'], 0],
    ['Qual esporte usa uma peteca?', ['Badminton', 'Tenis', 'Squash', 'Handebol'], 0],
    ['No basquete, quantos pontos vale uma cesta de lance livre?', ['1', '2', '3', '4'], 0],
    ['Em qual jogo se usa a expressao xeque-mate?', ['Xadrez', 'Truco', 'Poker', 'Bilhar'], 0],
    ['Qual e a peca mais valiosa do xadrez depois do rei?', ['Dama', 'Torre', 'Bispo', 'Cavalo'], 0],
    ['Quantas cartas tem um baralho frances sem coringas?', ['52', '48', '54', '40'], 0],
    ['Qual esporte e jogado com raquete e uma bolinha amarela?', ['Tenis', 'Voleibol', 'Cricket', 'Golfe'], 0],
    ['Em qual jogo se tenta formar uma linha de quatro?', ['Ligue quatro', 'Velha', 'Damas', 'Batalha naval'], 0],
    ['Qual e a peca de maior valor no domino?', ['Duplo-seis', 'Duplo-cinco', 'Seis-cinco', 'Duplo-zero'], 0],
    ['Qual planeta e conhecido como planeta vermelho?', ['Marte', 'Venus', 'Jupiter', 'Mercurio'], 0],
    ['Qual e o satelite natural da Terra?', ['Lua', 'Fobos', 'Europa', 'Titan'], 0],
    ['Qual gas e mais abundante na atmosfera terrestre?',
      ['Nitrogenio', 'Oxigenio', 'Dioxido de carbono', 'Hidrogenio'], 0],
    ['Qual orgao bombeia o sangue pelo corpo?', ['Coracao', 'Pulmao', 'Figado', 'Rim'], 0],
    ['Qual e o maior planeta do Sistema Solar?', ['Jupiter', 'Saturno', 'Terra', 'Netuno'], 0],
    ['Qual e o processo pelo qual plantas produzem alimento?',
      ['Fotossintese', 'Digestao', 'Fermentacao', 'Combustao'], 0],
    ['Quantos ossos tem aproximadamente o corpo humano adulto?', ['206', '106', '306', '406'], 0],
    ['Qual metal e liquido em temperatura ambiente?', ['Mercurio', 'Ferro', 'Cobre', 'Aluminio'], 0],
    ['Qual e a unidade basica da vida?', ['Celula', 'Tecido', 'Orgao', 'Molecula'], 0],
    ['Qual fenomeno ocorre quando a Lua fica entre a Terra e o Sol?',
      ['Eclipse solar', 'Eclipse lunar', 'Solsticio', 'Equinocio'], 0],
    ['Qual e o ponto de congelamento da agua ao nivel do mar?',
      ['0 graus Celsius', '10 graus Celsius', '32 graus Celsius', '100 graus Celsius'], 0],
    ['Qual animal e conhecido por mudar de cor para se camuflar?', ['Camaleao', 'Elefante', 'Golfinho', 'Pinguim'], 0],
    ['Qual e a estrela do nosso sistema planetario?', ['Sol', 'Sirius', 'Polaris', 'Vega'], 0],
    ['Qual vitamina e produzida pela pele com exposicao ao sol?',
      ['Vitamina D', 'Vitamina C', 'Vitamina B12', 'Vitamina K'], 0],
    ['Qual e o maior animal conhecido?', ['Baleia-azul', 'Elefante africano', 'Girafa', 'Tubarao-baleia'], 0],
    ['Qual parte da planta absorve agua do solo?', ['Raiz', 'Flor', 'Fruto', 'Semente'], 0],
    ['Qual e o nome da passagem da agua liquida para vapor?',
      ['Evaporacao', 'Condensacao', 'Fusao', 'Solidificacao'], 0],
    ['Qual cientista formulou a teoria da relatividade?',
      ['Albert Einstein', 'Isaac Newton', 'Charles Darwin', 'Galileu Galilei'], 0],
    ['Qual e o continente com maior area?', ['Asia', 'Africa', 'Europa', 'America'], 0],
    ['Qual e o maior deserto quente do mundo?', ['Saara', 'Atacama', 'Gobi', 'Kalahari'], 0],
    ['Qual pais tem formato aproximado de uma bota?', ['Italia', 'Grecia', 'Espanha', 'Portugal'], 0],
    ['Qual e a capital da Franca?', ['Paris', 'Lyon', 'Marselha', 'Nice'], 0],
    ['Em qual pais ficam as piramides de Gize?', ['Egito', 'Mexico', 'Peru', 'India'], 0],
    ['Qual oceano e o maior do planeta?', ['Pacifico', 'Atlantico', 'Indico', 'Artico'], 0],
    ['Qual montanha e a mais alta do mundo acima do nivel do mar?',
      ['Everest', 'Aconcagua', 'Kilimanjaro', 'Mont Blanc'], 0],
    ['Qual e a capital do Japao?', ['Toquio', 'Quioto', 'Osaka', 'Hiroshima'], 0],
    ['Qual pais e famoso pelo formato de longa faixa na costa do Pacifico?',
      ['Chile', 'Canada', 'India', 'Noruega'], 0],
    ['Qual linha imaginaria divide a Terra em hemisferios norte e sul?',
      ['Equador', 'Greenwich', 'Tropico de Cancer', 'Circulo Polar'], 0],
    ['Qual mar separa a Europa da Africa?', ['Mediterraneo', 'Caribe', 'Vermelho', 'Bering'], 0],
    ['Qual e a capital de Portugal?', ['Lisboa', 'Porto', 'Coimbra', 'Braga'], 0],
    ['Qual e o maior pais do mundo em area?', ['Russia', 'Canada', 'China', 'Estados Unidos'], 0],
    ['Qual e a capital da Argentina?', ['Buenos Aires', 'Cordoba', 'Rosario', 'Mendoza'], 0],
    ['Qual rio atravessa a cidade de Londres?', ['Tâmisa', 'Sena', 'Reno', 'Danubio'], 0],
    ['Qual e o idioma oficial do Mexico?', ['Espanhol', 'Portugues', 'Ingles', 'Frances'], 0],
    ['Qual pais e conhecido como Terra do Sol Nascente?', ['Japao', 'China', 'Coreia do Sul', 'Tailandia'], 0],
    ['Qual e a capital da Australia?', ['Camberra', 'Sydney', 'Melbourne', 'Perth'], 0],
    ['Qual e o maior pais da America do Sul em area?', ['Brasil', 'Argentina', 'Peru', 'Colombia'], 0],
    ['Qual e a capital do Canada?', ['Ottawa', 'Toronto', 'Vancouver', 'Montreal'], 0],
    ['Quem escreveu Dom Casmurro?', ['Machado de Assis', 'Jose de Alencar', 'Carlos Drummond', 'Graciliano Ramos'], 0],
    ['Quem escreveu O Pequeno Principe?',
      ['Antoine de Saint-Exupery', 'Victor Hugo', 'Julio Verne', 'Albert Camus'], 0],
    ['Qual obra e de William Shakespeare?', ['Hamlet', 'Os Lusiadas', 'A Moreninha', 'O Cortico'], 0],
    ['Quem pintou a Mona Lisa?', ['Leonardo da Vinci', 'Michelangelo', 'Rafael', 'Van Gogh'], 0],
    ['Qual movimento artistico e associado a Tarsila do Amaral?',
      ['Modernismo', 'Barroco', 'Romantismo', 'Realismo'], 0],
    ['Qual instrumento tem teclas brancas e pretas?', ['Piano', 'Violino', 'Flauta', 'Trompete'], 0],
    ['Qual e a cor obtida da mistura de azul e amarelo?', ['Verde', 'Roxo', 'Laranja', 'Marrom'], 0],
    ['Quantas notas musicais ha na escala natural?', ['7', '5', '8', '12'], 0],
    ['Qual e o nome da arte japonesa de dobrar papel?', ['Origami', 'Ikebana', 'Kabuki', 'Haicai'], 0],
    ['Qual escritor brasileiro criou Capitu?',
      ['Machado de Assis', 'Jorge Amado', 'Monteiro Lobato', 'Erico Verissimo'], 0],
    ['Qual e o idioma original de Os Lusiadas?', ['Portugues', 'Espanhol', 'Latim', 'Italiano'], 0],
    ['Quem compôs a Nona Sinfonia?', ['Beethoven', 'Mozart', 'Bach', 'Chopin'], 0],
    ['Qual estilo musical nasceu em comunidades afro-americanas nos EUA?', ['Jazz', 'Fado', 'Tango', 'Samba'], 0],
    ['Qual artista brasileiro e associado ao Abaporu?',
      ['Tarsila do Amaral', 'Anita Malfatti', 'Candido Portinari', 'Di Cavalcanti'], 0],
    ['Qual e o nome de uma historia curta com uma licao moral?', ['Fabula', 'Epopeia', 'Biografia', 'Cronica'], 0],
    ['Quem escreveu A Divina Comedia?', ['Dante Alighieri', 'Homero', 'Virgilio', 'Cervantes'], 0],
    ['Qual instrumento de cordas pequeno é presença constante nas rodas de samba e choro?',
      ['Cavaquinho', 'Violino', 'Harpa', 'Contrabaixo'], 0],
    ['Qual filme brasileiro acompanha a historia de Buscape?',
      ['Cidade de Deus', 'Central do Brasil', 'O Pagador de Promessas', 'Carandiru'], 0],
    ['Qual e o nome do conjunto de leis fundamentais de um pais?',
      ['Constituicao', 'Tratado', 'Decreto', 'Manifesto'], 0],
    ['Quantos lados tem um hexagono?', ['6', '5', '7', '8'], 0],
    ['Quanto e 12 vezes 12?', ['144', '124', '132', '156'], 0],
    ['Qual e o menor numero primo?', ['2', '1', '0', '3'], 0],
    ['Quantos minutos tem uma hora?', ['60', '30', '100', '90'], 0],
    ['Qual figura geometrica tem tres lados?', ['Triangulo', 'Quadrado', 'Pentagono', 'Circulo'], 0],
    ['Qual e a raiz quadrada de 81?', ['9', '8', '7', '6'], 0],
    ['Quantos graus tem um angulo reto?', ['90', '45', '180', '360'], 0],
    ['Qual fracao representa metade?', ['1/2', '1/3', '2/3', '1/4'], 0],
    ['Qual numero vem depois de 999?', ['1000', '9990', '1001', '990'], 0],
    ['Quantos dias tem um ano comum?', ['365', '360', '364', '366'], 0],
    ['Qual unidade mede distancia no Sistema Internacional?', ['Metro', 'Litro', 'Quilo', 'Segundo'], 0],
    ['Qual e o dobro de 37?', ['74', '64', '77', '84'], 0],
    ['Qual poligono tem oito lados?', ['Octogono', 'Heptagono', 'Decagono', 'Pentagono'], 0],
    ['Qual e o valor aproximado de pi?', ['3,14', '2,14', '4,13', '1,41'], 0],
    ['Em que ano tem um dia extra no calendario?', ['Ano bissexto', 'Ano solar', 'Ano fiscal', 'Ano lunar'], 0],
    ['Qual e o coletivo de peixes?', ['Cardume', 'Manada', 'Alcateia', 'Rebanho'], 0],
    ['Qual palavra e sinonimo de feliz?', ['Contente', 'Distante', 'Vazio', 'Lento'], 0],
    ['Qual e o contrario de aumentar?', ['Diminuir', 'Somar', 'Crescer', 'Multiplicar'], 0],
    ['Qual animal e um mamifero?', ['Baleia', 'Tartaruga', 'Sapo', 'Galinha'], 0],
    ['Qual animal bota ovos?', ['Galinha', 'Cachorro', 'Gato', 'Cavalo'], 0],
    ['Qual alimento e feito tradicionalmente de leite fermentado?', ['Iogurte', 'Arroz', 'Pao', 'Azeite'], 0],
    ['Qual planta produz o fruto chamado banana?', ['Bananeira', 'Laranjeira', 'Macieira', 'Mangueira'], 0],
    ['Qual e o sentido usado para ouvir?', ['Audicao', 'Visao', 'Tato', 'Olfato'], 0],
    ['Qual profissional projeta edificios?', ['Arquiteto', 'Dentista', 'Agronomo', 'Jornalista'], 0],
    ['Qual objeto indica direcoes usando uma agulha?', ['Bussola', 'Termometro', 'Barometro', 'Cronometro'], 0],
    ['Qual material e atraido por um ima?', ['Ferro', 'Madeira', 'Vidro', 'Borracha'], 0],
    ['Qual aparelho mede a temperatura?', ['Termometro', 'Velocimetro', 'Higrometro', 'Altimetro'], 0],
    ['Qual e o estado fisico do gelo?', ['Solido', 'Liquido', 'Gasoso', 'Plasma'], 0],
    ['Qual e o nome dado a agua que cai das nuvens?', ['Chuva', 'Nevoa', 'Orvalho', 'Geada'], 0],
    ['Qual e a camada de gas que envolve a Terra?', ['Atmosfera', 'Litosfera', 'Hidrosfera', 'Biosfera'], 0],
    ['Qual fonte de energia usa a luz do Sol?', ['Solar', 'Eolica', 'Geotermica', 'Maremotriz'], 0],
    ['Qual e o maior felino das Americas?', ['Onca-pintada', 'Gato-do-mato', 'Puma', 'Jaguatirica'], 0],
  ];

  const perguntas = raw.map(([pergunta, alternativas, certa], id) => Object.freeze({
    id,
    pergunta: corrigirFrases(acentuar(pergunta)),
    alternativas: Object.freeze(alternativas.map((texto) => corrigirFrases(acentuar(texto)))),
    certa,
  }));

  function validarBanco() {
    const vistas = new Set();
    if (perguntas.length < 120) throw new Error('O banco do Quiz precisa de 120 perguntas');
    for (const q of perguntas) {
      if (vistas.has(q.pergunta)) throw new Error(`Pergunta repetida: ${q.pergunta}`);
      vistas.add(q.pergunta);
      if (q.alternativas.length !== 4 || new Set(q.alternativas).size !== 4) {
        throw new Error(`Alternativas invalidas: ${q.pergunta}`);
      }
      if (!Number.isInteger(q.certa) || q.certa < 0 || q.certa >= 4) {
        throw new Error(`Resposta certa invalida: ${q.pergunta}`);
      }
    }
    return true;
  }

  validarBanco();
  const api = { perguntas, validarBanco };
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizPerguntas = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);

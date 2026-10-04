// PROVISORIO -- substituir na Tarefa 14a
'use strict';

/* Quiz -- tema "games". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'games-001', nivel: 1, certa: 0,
      pt: ['Qual encanador é o mascote da Nintendo?', ['Mario', 'Luigi', 'Wario', 'Toad']],
      en: ["Which plumber is Nintendo's mascot?", ['Mario', 'Luigi', 'Wario', 'Toad']],
      es: ['¿Qué fontanero es la mascota de Nintendo?', ['Mario', 'Luigi', 'Wario', 'Toad']] },
    { id: 'games-002', nivel: 1, certa: 2,
      pt: ['Qual jogo tem monstros verdes chamados Creepers?', ['Roblox', 'Terraria', 'Minecraft', 'Fortnite']],
      en: ['Which game has green monsters called Creepers?', ['Roblox', 'Terraria', 'Minecraft', 'Fortnite']],
      es: ['¿Qué juego tiene monstruos verdes llamados Creepers?', ['Roblox', 'Terraria', 'Minecraft', 'Fortnite']] },
    { id: 'games-003', nivel: 1, certa: 1,
      pt: ['Qual é o nome do herói da série The Legend of Zelda?', ['Zelda', 'Link', 'Ganon', 'Epona']],
      en: ['What is the name of the hero of The Legend of Zelda series?', ['Zelda', 'Link', 'Ganon', 'Epona']],
      es: ['¿Cómo se llama el héroe de la serie The Legend of Zelda?', ['Zelda', 'Link', 'Ganon', 'Epona']] },
    { id: 'games-004', nivel: 1, certa: 3,
      pt: ['Qual empresa criou o console PlayStation?', ['Sega', 'Microsoft', 'Atari', 'Sony']],
      en: ['Which company created the PlayStation console?', ['Sega', 'Microsoft', 'Atari', 'Sony']],
      es: ['¿Qué empresa creó la consola PlayStation?', ['Sega', 'Microsoft', 'Atari', 'Sony']] },
    { id: 'games-005', nivel: 2, certa: 1,
      pt: [
        'Qual console da Nintendo, lançado em 2006, tinha um controle sensível a movimentos?',
        ['GameCube', 'Wii', 'Nintendo DS', 'Nintendo 64']],
      en: [
        'Which Nintendo console, released in 2006, had a motion-sensing controller?',
        ['GameCube', 'Wii', 'Nintendo DS', 'Nintendo 64']],
      es: [
        '¿Qué consola de Nintendo, lanzada en 2006, tenía un mando sensible al movimiento?',
        ['GameCube', 'Wii', 'Nintendo DS', 'Nintendo 64']] },
    { id: 'games-006', nivel: 2, certa: 2,
      pt: ['Em que ano saiu no Japão o primeiro jogo da série Pokémon?', ['1994', '1995', '1996', '1998']],
      en: ['In what year was the first Pokémon game released in Japan?', ['1994', '1995', '1996', '1998']],
      es: ['¿En qué año salió en Japón el primer juego de la serie Pokémon?', ['1994', '1995', '1996', '1998']] },
    { id: 'games-007', nivel: 2, certa: 1,
      pt: ['Quantos fantasmas perseguem o jogador no Pac-Man clássico?', ['3', '4', '5', '6']],
      en: ['How many ghosts chase the player in classic Pac-Man?', ['3', '4', '5', '6']],
      es: ['¿Cuántos fantasmas persiguen al jugador en el Pac-Man clásico?', ['3', '4', '5', '6']] },
    { id: 'games-008', nivel: 2, certa: 0,
      pt: ['Qual estúdio criou The Witcher 3: Wild Hunt?', ['CD Projekt Red', 'BioWare', 'Bethesda', 'Ubisoft']],
      en: ['Which studio created The Witcher 3: Wild Hunt?', ['CD Projekt Red', 'BioWare', 'Bethesda', 'Ubisoft']],
      es: ['¿Qué estudio creó The Witcher 3: Wild Hunt?', ['CD Projekt Red', 'BioWare', 'Bethesda', 'Ubisoft']] },
    { id: 'games-009', nivel: 2, certa: 3,
      pt: [
        'Qual jogo de quebra-cabeça com peças de quatro blocos foi criado por Alexey Pajitnov?',
        ['Columns', 'Puyo Puyo', 'Bejeweled', 'Tetris']],
      en: [
        'Which puzzle game with four-block pieces was created by Alexey Pajitnov?',
        ['Columns', 'Puyo Puyo', 'Bejeweled', 'Tetris']],
      es: [
        '¿Qué juego de rompecabezas con piezas de cuatro bloques creó Alexey Pajitnov?',
        ['Columns', 'Puyo Puyo', 'Bejeweled', 'Tetris']] },
    { id: 'games-010', nivel: 3, certa: 2,
      pt: [
        'Qual é o protagonista da série Half-Life?',
        ['Master Chief', 'Marcus Fenix', 'Gordon Freeman', 'Duke Nukem']],
      en: [
        'Who is the protagonist of the Half-Life series?',
        ['Master Chief', 'Marcus Fenix', 'Gordon Freeman', 'Duke Nukem']],
      es: [
        '¿Quién es el protagonista de la serie Half-Life?',
        ['Master Chief', 'Marcus Fenix', 'Gordon Freeman', 'Duke Nukem']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.games = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

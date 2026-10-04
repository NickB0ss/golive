// PROVISORIO -- substituir na Tarefa 14d
'use strict';

/* Quiz -- tema "esportes". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'esportes-001', nivel: 1, certa: 1,
      pt: ['Quantos jogadores de cada time ficam em quadra no basquete?', ['4', '5', '6', '7']],
      en: ['How many players per team are on the court in basketball?', ['4', '5', '6', '7']],
      es: ['¿Cuántos jugadores de cada equipo están en la cancha en el baloncesto?', ['4', '5', '6', '7']] },
    { id: 'esportes-002', nivel: 1, certa: 2,
      pt: ['Qual esporte é disputado no torneio de Wimbledon?', ['Golfe', 'Críquete', 'Tênis', 'Rúgbi']],
      en: ['Which sport is played at the Wimbledon tournament?', ['Golf', 'Cricket', 'Tennis', 'Rugby']],
      es: ['¿Qué deporte se juega en el torneo de Wimbledon?', ['Golf', 'Críquet', 'Tenis', 'Rugby']] },
    { id: 'esportes-003', nivel: 1, certa: 2,
      pt: ['Quantos anéis tem a bandeira olímpica?', ['3', '4', '5', '6']],
      en: ['How many rings does the Olympic flag have?', ['3', '4', '5', '6']],
      es: ['¿Cuántos aros tiene la bandera olímpica?', ['3', '4', '5', '6']] },
    { id: 'esportes-004', nivel: 1, certa: 1,
      pt: ['Qual país sediou os Jogos Olímpicos de 2008?', ['Austrália', 'China', 'Grécia', 'Reino Unido']],
      en: ['Which country hosted the 2008 Olympic Games?', ['Australia', 'China', 'Greece', 'United Kingdom']],
      es: ['¿Qué país fue sede de los Juegos Olímpicos de 2008?', ['Australia', 'China', 'Grecia', 'Reino Unido']] },
    { id: 'esportes-005', nivel: 1, certa: 0,
      pt: [
        'Qual astro do basquete ficou conhecido pelo apelido "Air"?',
        ['Michael Jordan', 'Kobe Bryant', "Shaquille O'Neal", 'Larry Bird']],
      en: [
        'Which basketball star was known by the nickname "Air"?',
        ['Michael Jordan', 'Kobe Bryant', "Shaquille O'Neal", 'Larry Bird']],
      es: [
        '¿Qué estrella del baloncesto era conocida por el apodo "Air"?',
        ['Michael Jordan', 'Kobe Bryant', "Shaquille O'Neal", 'Larry Bird']] },
    { id: 'esportes-006', nivel: 2, certa: 3,
      pt: ['Qual é a distância oficial de uma maratona?', ['10 km', '21,097 km', '50 km', '42,195 km']],
      en: ['What is the official distance of a marathon?', ['10 km', '21.097 km', '50 km', '42.195 km']],
      es: ['¿Cuál es la distancia oficial de un maratón?', ['10 km', '21,097 km', '50 km', '42,195 km']] },
    { id: 'esportes-007', nivel: 3, certa: 2,
      pt: [
        'Quem tinha mais títulos de Grand Slam no tênis masculino ao fim de 2022?',
        ['Roger Federer', 'Novak Djokovic', 'Rafael Nadal', 'Pete Sampras']],
      en: [
        "Who had the most men's tennis Grand Slam titles at the end of 2022?",
        ['Roger Federer', 'Novak Djokovic', 'Rafael Nadal', 'Pete Sampras']],
      es: [
        '¿Quién tenía más títulos de Grand Slam en el tenis masculino a finales de 2022?',
        ['Roger Federer', 'Novak Djokovic', 'Rafael Nadal', 'Pete Sampras']] },
    { id: 'esportes-008', nivel: 2, certa: 0,
      pt: [
        'Qual equipe de Fórmula 1 tem um cavalo empinado como símbolo?',
        ['Ferrari', 'McLaren', 'Williams', 'Renault']],
      en: [
        'Which Formula 1 team has a prancing horse as its symbol?',
        ['Ferrari', 'McLaren', 'Williams', 'Renault']],
      es: [
        '¿Qué equipo de Fórmula 1 tiene un caballo rampante como símbolo?',
        ['Ferrari', 'McLaren', 'Williams', 'Renault']] },
    { id: 'esportes-009', nivel: 2, certa: 3,
      pt: ['Em qual esporte aparecem os termos "birdie" e "eagle"?', ['Críquete', 'Beisebol', 'Boliche', 'Golfe']],
      en: ['In which sport do the terms "birdie" and "eagle" appear?', ['Cricket', 'Baseball', 'Bowling', 'Golf']],
      es: ['¿En qué deporte aparecen los términos "birdie" y "eagle"?', ['Críquet', 'Béisbol', 'Bolos', 'Golf']] },
    { id: 'esportes-010', nivel: 3, certa: 1,
      pt: [
        'Em qual cidade foram realizados os primeiros Jogos Olímpicos da era moderna, em 1896?',
        ['Paris', 'Atenas', 'Londres', 'Roma']],
      en: [
        'In which city were the first modern Olympic Games held, in 1896?',
        ['Paris', 'Athens', 'London', 'Rome']],
      es: [
        '¿En qué ciudad se celebraron los primeros Juegos Olímpicos de la era moderna, en 1896?',
        ['París', 'Atenas', 'Londres', 'Roma']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.esportes = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

// PROVISORIO -- substituir na Tarefa 14c
'use strict';

/* Quiz -- tema "futebol". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'futebol-001', nivel: 1, certa: 3,
      pt: ['Qual seleção venceu a Copa do Mundo de 2014?', ['Argentina', 'Brasil', 'Holanda', 'Alemanha']],
      en: ['Which national team won the 2014 World Cup?', ['Argentina', 'Brazil', 'Netherlands', 'Germany']],
      es: ['¿Qué selección ganó la Copa del Mundo de 2014?', ['Argentina', 'Brasil', 'Países Bajos', 'Alemania']] },
    { id: 'futebol-002', nivel: 1, certa: 2,
      pt: ['Quantos jogadores de cada time ficam em campo, contando o goleiro?', ['9', '10', '11', '12']],
      en: ['How many players per team are on the field, counting the goalkeeper?', ['9', '10', '11', '12']],
      es: ['¿Cuántos jugadores de cada equipo están en el campo, contando al portero?', ['9', '10', '11', '12']] },
    { id: 'futebol-003', nivel: 1, certa: 1,
      pt: ['Qual país sediou a Copa do Mundo de 2022?', ['Rússia', 'Catar', 'Arábia Saudita', 'Emirados Árabes']],
      en: ['Which country hosted the 2022 World Cup?', ['Russia', 'Qatar', 'Saudi Arabia', 'United Arab Emirates']],
      es: [
        '¿Qué país fue sede de la Copa del Mundo de 2022?',
        ['Rusia', 'Catar', 'Arabia Saudita', 'Emiratos Árabes']] },
    { id: 'futebol-004', nivel: 1, certa: 2,
      pt: ['Quantas Copas do Mundo o Brasil tinha vencido até 2022?', ['3', '4', '5', '6']],
      en: ['How many World Cups had Brazil won up to 2022?', ['3', '4', '5', '6']],
      es: ['¿Cuántas Copas del Mundo había ganado Brasil hasta 2022?', ['3', '4', '5', '6']] },
    { id: 'futebol-005', nivel: 2, certa: 0,
      pt: [
        'Qual clube mais venceu a Liga dos Campeões da UEFA até 2023?',
        ['Real Madrid', 'Milan', 'Barcelona', 'Bayern de Munique']],
      en: [
        'Which club had won the most UEFA Champions League titles up to 2023?',
        ['Real Madrid', 'Milan', 'Barcelona', 'Bayern Munich']],
      es: [
        '¿Qué club había ganado más Ligas de Campeones de la UEFA hasta 2023?',
        ['Real Madrid', 'Milan', 'Barcelona', 'Bayern de Múnich']] },
    { id: 'futebol-006', nivel: 3, certa: 3,
      pt: [
        'Quem foi o artilheiro da Copa do Mundo de 2014?',
        ['Thomas Müller', 'Lionel Messi', 'Neymar', 'James Rodríguez']],
      en: [
        'Who was the top scorer of the 2014 World Cup?',
        ['Thomas Müller', 'Lionel Messi', 'Neymar', 'James Rodríguez']],
      es: [
        '¿Quién fue el máximo goleador de la Copa del Mundo de 2014?',
        ['Thomas Müller', 'Lionel Messi', 'Neymar', 'James Rodríguez']] },
    { id: 'futebol-007', nivel: 2, certa: 0,
      pt: ['Qual país venceu a primeira Copa do Mundo, em 1930?', ['Uruguai', 'Argentina', 'Itália', 'Brasil']],
      en: ['Which country won the first World Cup, in 1930?', ['Uruguay', 'Argentina', 'Italy', 'Brazil']],
      es: ['¿Qué país ganó la primera Copa del Mundo, en 1930?', ['Uruguay', 'Argentina', 'Italia', 'Brasil']] },
    { id: 'futebol-008', nivel: 2, certa: 2,
      pt: ['Quantas Bolas de Ouro Lionel Messi tinha ganhado até 2023?', ['6', '7', '8', '9']],
      en: ["How many Ballon d'Or awards had Lionel Messi won up to 2023?", ['6', '7', '8', '9']],
      es: ['¿Cuántos Balones de Oro había ganado Lionel Messi hasta 2023?', ['6', '7', '8', '9']] },
    { id: 'futebol-009', nivel: 2, certa: 1,
      pt: [
        'Quem marcou o "gol da Mão de Deus" contra a Inglaterra na Copa do Mundo de 1986?',
        ['Pelé', 'Diego Maradona', 'Zico', 'Johan Cruyff']],
      en: [
        'Who scored the "Hand of God" goal against England in the 1986 World Cup?',
        ['Pelé', 'Diego Maradona', 'Zico', 'Johan Cruyff']],
      es: [
        '¿Quién marcó el gol de la "Mano de Dios" contra Inglaterra en la Copa del Mundo de 1986?',
        ['Pelé', 'Diego Maradona', 'Zico', 'Johan Cruyff']] },
    { id: 'futebol-010', nivel: 3, certa: 1,
      pt: [
        'Quem era o maior artilheiro da história das Copas do Mundo masculinas até 2022?',
        ['Ronaldo', 'Miroslav Klose', 'Gerd Müller', 'Pelé']],
      en: [
        "Who was the all-time top scorer in men's World Cups up to 2022?",
        ['Ronaldo', 'Miroslav Klose', 'Gerd Müller', 'Pelé']],
      es: [
        '¿Quién era el máximo goleador histórico de las Copas del Mundo masculinas hasta 2022?',
        ['Ronaldo', 'Miroslav Klose', 'Gerd Müller', 'Pelé']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.futebol = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

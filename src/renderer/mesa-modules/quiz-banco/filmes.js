// PROVISORIO -- substituir na Tarefa 14f
'use strict';

/* Quiz -- tema "filmes". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'filmes-001', nivel: 1, certa: 1,
      pt: ['Qual estúdio produziu "Toy Story"?', ['DreamWorks', 'Pixar', 'Illumination', 'Blue Sky']],
      en: ['Which studio produced "Toy Story"?', ['DreamWorks', 'Pixar', 'Illumination', 'Blue Sky']],
      es: ['¿Qué estudio produjo "Toy Story"?', ['DreamWorks', 'Pixar', 'Illumination', 'Blue Sky']] },
    { id: 'filmes-002', nivel: 2, certa: 2,
      pt: [
        'Quem dirigiu "Titanic", de 1997?',
        ['Steven Spielberg', 'Ridley Scott', 'James Cameron', 'Christopher Nolan']],
      en: [
        'Who directed "Titanic", from 1997?',
        ['Steven Spielberg', 'Ridley Scott', 'James Cameron', 'Christopher Nolan']],
      es: [
        '¿Quién dirigió "Titanic", de 1997?',
        ['Steven Spielberg', 'Ridley Scott', 'James Cameron', 'Christopher Nolan']] },
    { id: 'filmes-003', nivel: 1, certa: 0,
      pt: [
        'Qual bruxinho criado por J. K. Rowling estuda em Hogwarts?',
        ['Harry Potter', 'Percy Jackson', 'Merlin', 'Gandalf']],
      en: [
        'Which young wizard created by J. K. Rowling studies at Hogwarts?',
        ['Harry Potter', 'Percy Jackson', 'Merlin', 'Gandalf']],
      es: [
        '¿Qué joven mago creado por J. K. Rowling estudia en Hogwarts?',
        ['Harry Potter', 'Percy Jackson', 'Merlin', 'Gandalf']] },
    { id: 'filmes-004', nivel: 2, certa: 3,
      pt: [
        'Qual série é baseada nos livros "As Crônicas de Gelo e Fogo", de George R. R. Martin?',
        ['Vikings', 'The Witcher', 'Outlander', 'Game of Thrones']],
      en: [
        'Which series is based on the books "A Song of Ice and Fire", by George R. R. Martin?',
        ['Vikings', 'The Witcher', 'Outlander', 'Game of Thrones']],
      es: [
        '¿Qué serie está basada en los libros "Canción de hielo y fuego", de George R. R. Martin?',
        ['Vikings', 'The Witcher', 'Outlander', 'Juego de tronos']] },
    { id: 'filmes-005', nivel: 1, certa: 2,
      pt: [
        'Qual personagem de Star Wars é o pai de Luke Skywalker?',
        ['Obi-Wan Kenobi', 'Han Solo', 'Darth Vader', 'Yoda']],
      en: [
        'Which Star Wars character is the father of Luke Skywalker?',
        ['Obi-Wan Kenobi', 'Han Solo', 'Darth Vader', 'Yoda']],
      es: [
        '¿Qué personaje de Star Wars es el padre de Luke Skywalker?',
        ['Obi-Wan Kenobi', 'Han Solo', 'Darth Vader', 'Yoda']] },
    { id: 'filmes-006', nivel: 2, certa: 0,
      pt: [
        'Qual filme sul-coreano venceu o Oscar de Melhor Filme na cerimônia de 2020?',
        ['Parasita', 'Jojo Rabbit', '1917', 'Coringa']],
      en: [
        'Which South Korean film won the Oscar for Best Picture at the 2020 ceremony?',
        ['Parasite', 'Jojo Rabbit', '1917', 'Joker']],
      es: [
        '¿Qué película surcoreana ganó el Óscar a la mejor película en la ceremonia de 2020?',
        ['Parásitos', 'Jojo Rabbit', '1917', 'Joker']] },
    { id: 'filmes-007', nivel: 2, certa: 1,
      pt: [
        'Quem dirigiu "O Poderoso Chefão"?',
        ['Martin Scorsese', 'Francis Ford Coppola', 'Brian De Palma', 'Sidney Lumet']],
      en: [
        'Who directed "The Godfather"?',
        ['Martin Scorsese', 'Francis Ford Coppola', 'Brian De Palma', 'Sidney Lumet']],
      es: [
        '¿Quién dirigió "El padrino"?',
        ['Martin Scorsese', 'Francis Ford Coppola', 'Brian De Palma', 'Sidney Lumet']] },
    { id: 'filmes-008', nivel: 1, certa: 3,
      pt: [
        'Qual ator interpreta Jack Sparrow em "Piratas do Caribe"?',
        ['Orlando Bloom', 'Geoffrey Rush', 'Brad Pitt', 'Johnny Depp']],
      en: [
        'Which actor plays Jack Sparrow in "Pirates of the Caribbean"?',
        ['Orlando Bloom', 'Geoffrey Rush', 'Brad Pitt', 'Johnny Depp']],
      es: [
        '¿Qué actor interpreta a Jack Sparrow en "Piratas del Caribe"?',
        ['Orlando Bloom', 'Geoffrey Rush', 'Brad Pitt', 'Johnny Depp']] },
    { id: 'filmes-009', nivel: 2, certa: 0,
      pt: [
        'Quem dirigiu a trilogia "O Senhor dos Anéis" no cinema?',
        ['Peter Jackson', 'Tim Burton', 'Sam Raimi', 'George Lucas']],
      en: [
        'Who directed "The Lord of the Rings" film trilogy?',
        ['Peter Jackson', 'Tim Burton', 'Sam Raimi', 'George Lucas']],
      es: [
        '¿Quién dirigió la trilogía cinematográfica de "El señor de los anillos"?',
        ['Peter Jackson', 'Tim Burton', 'Sam Raimi', 'George Lucas']] },
    { id: 'filmes-010', nivel: 3, certa: 2,
      pt: [
        'Qual diretor japonês dirigiu "Os Sete Samurais"?',
        ['Hayao Miyazaki', 'Yasujirō Ozu', 'Akira Kurosawa', 'Takeshi Kitano']],
      en: [
        'Which Japanese director directed "Seven Samurai"?',
        ['Hayao Miyazaki', 'Yasujirō Ozu', 'Akira Kurosawa', 'Takeshi Kitano']],
      es: [
        '¿Qué director japonés dirigió "Los siete samuráis"?',
        ['Hayao Miyazaki', 'Yasujirō Ozu', 'Akira Kurosawa', 'Takeshi Kitano']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.filmes = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

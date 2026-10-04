// PROVISORIO -- substituir na Tarefa 14e
'use strict';

/* Quiz -- tema "musica". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'musica-001', nivel: 1, certa: 2,
      pt: [
        'Qual banda de Liverpool lançou "Hey Jude"?',
        ['The Rolling Stones', 'Queen', 'The Beatles', 'Led Zeppelin']],
      en: [
        'Which Liverpool band released "Hey Jude"?',
        ['The Rolling Stones', 'Queen', 'The Beatles', 'Led Zeppelin']],
      es: [
        '¿Qué banda de Liverpool lanzó "Hey Jude"?',
        ['The Rolling Stones', 'Queen', 'The Beatles', 'Led Zeppelin']] },
    { id: 'musica-002', nivel: 1, certa: 0,
      pt: [
        'Quem é conhecido como o "Rei do Pop"?',
        ['Michael Jackson', 'Elvis Presley', 'Prince', 'Justin Timberlake']],
      en: [
        'Who is known as the "King of Pop"?',
        ['Michael Jackson', 'Elvis Presley', 'Prince', 'Justin Timberlake']],
      es: [
        '¿Quién es conocido como el "Rey del Pop"?',
        ['Michael Jackson', 'Elvis Presley', 'Prince', 'Justin Timberlake']] },
    { id: 'musica-003', nivel: 1, certa: 3,
      pt: ['Qual instrumento tem 88 teclas na versão padrão?', ['Violino', 'Flauta', 'Harpa', 'Piano']],
      en: ['Which instrument has 88 keys in its standard version?', ['Violin', 'Flute', 'Harp', 'Piano']],
      es: ['¿Qué instrumento tiene 88 teclas en su versión estándar?', ['Violín', 'Flauta', 'Arpa', 'Piano']] },
    { id: 'musica-004', nivel: 1, certa: 2,
      pt: ['De qual país vem o grupo BTS?', ['Japão', 'China', 'Coreia do Sul', 'Tailândia']],
      en: ['Which country is the group BTS from?', ['Japan', 'China', 'South Korea', 'Thailand']],
      es: ['¿De qué país es el grupo BTS?', ['Japón', 'China', 'Corea del Sur', 'Tailandia']] },
    { id: 'musica-005', nivel: 1, certa: 0,
      pt: [
        'Qual cantora colombiana lançou "Hips Don\'t Lie"?',
        ['Shakira', 'Jennifer Lopez', 'Beyoncé', 'Rihanna']],
      en: [
        'Which Colombian singer released "Hips Don\'t Lie"?',
        ['Shakira', 'Jennifer Lopez', 'Beyoncé', 'Rihanna']],
      es: [
        '¿Qué cantante colombiana lanzó "Hips Don\'t Lie"?',
        ['Shakira', 'Jennifer Lopez', 'Beyoncé', 'Rihanna']] },
    { id: 'musica-006', nivel: 3, certa: 1,
      pt: [
        'Qual banda lançou o álbum "The Dark Side of the Moon" em 1973?',
        ['Led Zeppelin', 'Pink Floyd', 'Genesis', 'Yes']],
      en: [
        'Which band released the album "The Dark Side of the Moon" in 1973?',
        ['Led Zeppelin', 'Pink Floyd', 'Genesis', 'Yes']],
      es: [
        '¿Qué banda lanzó el álbum "The Dark Side of the Moon" en 1973?',
        ['Led Zeppelin', 'Pink Floyd', 'Genesis', 'Yes']] },
    { id: 'musica-007', nivel: 2, certa: 1,
      pt: ['Quantas cordas tem um violino?', ['3', '4', '5', '6']],
      en: ['How many strings does a violin have?', ['3', '4', '5', '6']],
      es: ['¿Cuántas cuerdas tiene un violín?', ['3', '4', '5', '6']] },
    { id: 'musica-008', nivel: 2, certa: 2,
      pt: [
        'Qual artista porto-riquenho lançou "Tití Me Preguntó"?',
        ['Daddy Yankee', 'J Balvin', 'Bad Bunny', 'Ozuna']],
      en: [
        'Which Puerto Rican artist released "Tití Me Preguntó"?',
        ['Daddy Yankee', 'J Balvin', 'Bad Bunny', 'Ozuna']],
      es: [
        '¿Qué artista puertorriqueño lanzó "Tití Me Preguntó"?',
        ['Daddy Yankee', 'J Balvin', 'Bad Bunny', 'Ozuna']] },
    { id: 'musica-009', nivel: 2, certa: 3,
      pt: [
        'Qual álbum de Michael Jackson, de 1982, está entre os mais vendidos da história?',
        ['Bad', 'Dangerous', 'Off the Wall', 'Thriller']],
      en: [
        'Which Michael Jackson album, from 1982, is among the best-selling of all time?',
        ['Bad', 'Dangerous', 'Off the Wall', 'Thriller']],
      es: [
        '¿Qué álbum de Michael Jackson, de 1982, está entre los más vendidos de la historia?',
        ['Bad', 'Dangerous', 'Off the Wall', 'Thriller']] },
    { id: 'musica-010', nivel: 2, certa: 0,
      pt: [
        'Qual compositor alemão escreveu a Nona Sinfonia, com a "Ode à Alegria"?',
        ['Beethoven', 'Mozart', 'Bach', 'Schubert']],
      en: [
        'Which German composer wrote the Ninth Symphony, with the "Ode to Joy"?',
        ['Beethoven', 'Mozart', 'Bach', 'Schubert']],
      es: [
        '¿Qué compositor alemán escribió la Novena Sinfonía, con la "Oda a la alegría"?',
        ['Beethoven', 'Mozart', 'Bach', 'Schubert']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.musica = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

// PROVISORIO -- substituir na Tarefa 14g
'use strict';

/* Quiz -- tema "ciencia". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'ciencia-001', nivel: 1, certa: 1,
      pt: ['Qual planeta é conhecido como "planeta vermelho"?', ['Vênus', 'Marte', 'Júpiter', 'Mercúrio']],
      en: ['Which planet is known as the "Red Planet"?', ['Venus', 'Mars', 'Jupiter', 'Mercury']],
      es: ['¿Qué planeta es conocido como el "planeta rojo"?', ['Venus', 'Marte', 'Júpiter', 'Mercurio']] },
    { id: 'ciencia-002', nivel: 1, certa: 2,
      pt: [
        'Qual gás as plantas absorvem na fotossíntese?',
        ['Oxigênio', 'Nitrogênio', 'Dióxido de carbono', 'Hidrogênio']],
      en: ['Which gas do plants absorb in photosynthesis?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen']],
      es: [
        '¿Qué gas absorben las plantas en la fotosíntesis?',
        ['Oxígeno', 'Nitrógeno', 'Dióxido de carbono', 'Hidrógeno']] },
    { id: 'ciencia-003', nivel: 2, certa: 3,
      pt: ['Qual é o símbolo químico do ouro?', ['Ag', 'Fe', 'Pb', 'Au']],
      en: ['What is the chemical symbol for gold?', ['Ag', 'Fe', 'Pb', 'Au']],
      es: ['¿Cuál es el símbolo químico del oro?', ['Ag', 'Fe', 'Pb', 'Au']] },
    { id: 'ciencia-004', nivel: 2, certa: 0,
      pt: ['Quantos ossos tem o corpo de um humano adulto?', ['206', '186', '226', '306']],
      en: ['How many bones are in an adult human body?', ['206', '186', '226', '306']],
      es: ['¿Cuántos huesos tiene el cuerpo de un humano adulto?', ['206', '186', '226', '306']] },
    { id: 'ciencia-005', nivel: 1, certa: 2,
      pt: ['Qual é o maior planeta do Sistema Solar?', ['Saturno', 'Netuno', 'Júpiter', 'Urano']],
      en: ['What is the largest planet in the Solar System?', ['Saturn', 'Neptune', 'Jupiter', 'Uranus']],
      es: ['¿Cuál es el planeta más grande del Sistema Solar?', ['Saturno', 'Neptuno', 'Júpiter', 'Urano']] },
    { id: 'ciencia-006', nivel: 2, certa: 1,
      pt: ['Quem descobriu a penicilina?', ['Louis Pasteur', 'Alexander Fleming', 'Marie Curie', 'Robert Koch']],
      en: ['Who discovered penicillin?', ['Louis Pasteur', 'Alexander Fleming', 'Marie Curie', 'Robert Koch']],
      es: ['¿Quién descubrió la penicilina?', ['Louis Pasteur', 'Alexander Fleming', 'Marie Curie', 'Robert Koch']] },
    { id: 'ciencia-007', nivel: 2, certa: 2,
      pt: ['Quem propôs, em 1989, a World Wide Web?', ['Bill Gates', 'Steve Jobs', 'Tim Berners-Lee', 'Vint Cerf']],
      en: [
        'Who proposed the World Wide Web in 1989?',
        ['Bill Gates', 'Steve Jobs', 'Tim Berners-Lee', 'Vint Cerf']],
      es: [
        '¿Quién propuso la World Wide Web en 1989?',
        ['Bill Gates', 'Steve Jobs', 'Tim Berners-Lee', 'Vint Cerf']] },
    { id: 'ciencia-008', nivel: 2, certa: 0,
      pt: ['Qual elemento químico tem número atômico 1?', ['Hidrogênio', 'Hélio', 'Lítio', 'Oxigênio']],
      en: ['Which chemical element has atomic number 1?', ['Hydrogen', 'Helium', 'Lithium', 'Oxygen']],
      es: ['¿Qué elemento químico tiene número atómico 1?', ['Hidrógeno', 'Helio', 'Litio', 'Oxígeno']] },
    { id: 'ciencia-009', nivel: 3, certa: 1,
      pt: [
        'Qual cientista ganhou Prêmios Nobel de Física e de Química?',
        ['Albert Einstein', 'Marie Curie', 'Niels Bohr', 'Rosalind Franklin']],
      en: [
        'Which scientist won Nobel Prizes in both Physics and Chemistry?',
        ['Albert Einstein', 'Marie Curie', 'Niels Bohr', 'Rosalind Franklin']],
      es: [
        '¿Qué científica ganó premios Nobel de Física y de Química?',
        ['Albert Einstein', 'Marie Curie', 'Niels Bohr', 'Rosalind Franklin']] },
    { id: 'ciencia-010', nivel: 2, certa: 1,
      pt: [
        'Quem foi a primeira pessoa a viajar ao espaço, em 1961?',
        ['Neil Armstrong', 'Yuri Gagarin', 'Alan Shepard', 'Buzz Aldrin']],
      en: [
        'Who was the first person to travel to space, in 1961?',
        ['Neil Armstrong', 'Yuri Gagarin', 'Alan Shepard', 'Buzz Aldrin']],
      es: [
        '¿Quién fue la primera persona en viajar al espacio, en 1961?',
        ['Neil Armstrong', 'Yuri Gagarin', 'Alan Shepard', 'Buzz Aldrin']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.ciencia = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

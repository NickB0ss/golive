// PROVISORIO -- substituir na Tarefa 14h
'use strict';

/* Quiz -- tema "mundo". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'mundo-001', nivel: 1, certa: 1,
      pt: ['Qual é a capital da França?', ['Lyon', 'Paris', 'Marselha', 'Bruxelas']],
      en: ['What is the capital of France?', ['Lyon', 'Paris', 'Marseille', 'Brussels']],
      es: ['¿Cuál es la capital de Francia?', ['Lyon', 'París', 'Marsella', 'Bruselas']] },
    { id: 'mundo-002', nivel: 1, certa: 2,
      pt: ['Qual é o maior oceano do mundo?', ['Atlântico', 'Índico', 'Pacífico', 'Ártico']],
      en: ['What is the largest ocean in the world?', ['Atlantic', 'Indian', 'Pacific', 'Arctic']],
      es: ['¿Cuál es el océano más grande del mundo?', ['Atlántico', 'Índico', 'Pacífico', 'Ártico']] },
    { id: 'mundo-003', nivel: 1, certa: 3,
      pt: ['Qual é a capital do Japão?', ['Osaka', 'Quioto', 'Seul', 'Tóquio']],
      en: ['What is the capital of Japan?', ['Osaka', 'Kyoto', 'Seoul', 'Tokyo']],
      es: ['¿Cuál es la capital de Japón?', ['Osaka', 'Kioto', 'Seúl', 'Tokio']] },
    { id: 'mundo-004', nivel: 2, certa: 0,
      pt: [
        'Qual rio atravessa o Egito de sul a norte e deságua no Mediterrâneo?',
        ['Nilo', 'Danúbio', 'Tigre', 'Jordão']],
      en: [
        'Which river flows through Egypt from south to north into the Mediterranean?',
        ['Nile', 'Danube', 'Tigris', 'Jordan']],
      es: [
        '¿Qué río atraviesa Egipto de sur a norte y desemboca en el Mediterráneo?',
        ['Nilo', 'Danubio', 'Tigris', 'Jordán']] },
    { id: 'mundo-005', nivel: 1, certa: 1,
      pt: [
        'Qual é a montanha mais alta do mundo acima do nível do mar?',
        ['K2', 'Everest', 'Kilimanjaro', 'Mont Blanc']],
      en: [
        'What is the highest mountain in the world above sea level?',
        ['K2', 'Everest', 'Kilimanjaro', 'Mont Blanc']],
      es: [
        '¿Cuál es la montaña más alta del mundo sobre el nivel del mar?',
        ['K2', 'Everest', 'Kilimanjaro', 'Mont Blanc']] },
    { id: 'mundo-006', nivel: 1, certa: 2,
      pt: ['Qual país tem o formato de uma bota?', ['Grécia', 'Portugal', 'Itália', 'Espanha']],
      en: ['Which country is shaped like a boot?', ['Greece', 'Portugal', 'Italy', 'Spain']],
      es: ['¿Qué país tiene forma de bota?', ['Grecia', 'Portugal', 'Italia', 'España']] },
    { id: 'mundo-007', nivel: 2, certa: 3,
      pt: ['Qual é a moeda oficial do Japão?', ['Won', 'Yuan', 'Rupia', 'Iene']],
      en: ['What is the official currency of Japan?', ['Won', 'Yuan', 'Rupee', 'Yen']],
      es: ['¿Cuál es la moneda oficial de Japón?', ['Won', 'Yuan', 'Rupia', 'Yen']] },
    { id: 'mundo-008', nivel: 2, certa: 1,
      pt: ['Qual é a capital da Austrália?', ['Sydney', 'Camberra', 'Melbourne', 'Brisbane']],
      en: ['What is the capital of Australia?', ['Sydney', 'Canberra', 'Melbourne', 'Brisbane']],
      es: ['¿Cuál es la capital de Australia?', ['Sídney', 'Canberra', 'Melbourne', 'Brisbane']] },
    { id: 'mundo-009', nivel: 1, certa: 0,
      pt: ['Qual é o maior país do mundo em área?', ['Rússia', 'Canadá', 'China', 'Estados Unidos']],
      en: ['What is the largest country in the world by area?', ['Russia', 'Canada', 'China', 'United States']],
      es: ['¿Cuál es el país más grande del mundo por superficie?', ['Rusia', 'Canadá', 'China', 'Estados Unidos']] },
    { id: 'mundo-010', nivel: 3, certa: 1,
      pt: [
        'Qual é o menor país do mundo em área?',
        ['Mônaco', 'Cidade do Vaticano', 'San Marino', 'Liechtenstein']],
      en: [
        'What is the smallest country in the world by area?',
        ['Monaco', 'Vatican City', 'San Marino', 'Liechtenstein']],
      es: [
        '¿Cuál es el país más pequeño del mundo por superficie?',
        ['Mónaco', 'Ciudad del Vaticano', 'San Marino', 'Liechtenstein']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.mundo = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

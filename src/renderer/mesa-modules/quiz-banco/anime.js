// PROVISORIO -- substituir na Tarefa 14b
'use strict';

/* Quiz -- tema "anime". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const perguntas = [
    { id: 'anime-001', nivel: 1, certa: 1,
      pt: ['Quem é o protagonista de One Piece?', ['Roronoa Zoro', 'Monkey D. Luffy', 'Sanji', 'Usopp']],
      en: ['Who is the protagonist of One Piece?', ['Roronoa Zoro', 'Monkey D. Luffy', 'Sanji', 'Usopp']],
      es: ['¿Quién es el protagonista de One Piece?', ['Roronoa Zoro', 'Monkey D. Luffy', 'Sanji', 'Usopp']] },
    { id: 'anime-002', nivel: 2, certa: 1,
      pt: [
        'Qual raposa de nove caudas vive selada dentro de Naruto Uzumaki?',
        ['Shukaku', 'Kurama', 'Matatabi', 'Gyūki']],
      en: ['Which nine-tailed fox is sealed inside Naruto Uzumaki?', ['Shukaku', 'Kurama', 'Matatabi', 'Gyūki']],
      es: [
        '¿Qué zorro de nueve colas está sellado dentro de Naruto Uzumaki?',
        ['Shukaku', 'Kurama', 'Matatabi', 'Gyūki']] },
    { id: 'anime-003', nivel: 1, certa: 2,
      pt: ['Quantas esferas do dragão são necessárias para invocar Shenlong em Dragon Ball?', ['5', '6', '7', '8']],
      en: ['How many Dragon Balls are needed to summon Shenron in Dragon Ball?', ['5', '6', '7', '8']],
      es: ['¿Cuántas esferas del dragón hacen falta para invocar a Shenlong en Dragon Ball?', ['5', '6', '7', '8']] },
    { id: 'anime-004', nivel: 1, certa: 0,
      pt: [
        'Qual estúdio de animação foi cofundado por Hayao Miyazaki?',
        ['Studio Ghibli', 'Toei Animation', 'Madhouse', 'Bones']],
      en: [
        'Which animation studio was co-founded by Hayao Miyazaki?',
        ['Studio Ghibli', 'Toei Animation', 'Madhouse', 'Bones']],
      es: [
        '¿Qué estudio de animación cofundó Hayao Miyazaki?',
        ['Studio Ghibli', 'Toei Animation', 'Madhouse', 'Bones']] },
    { id: 'anime-005', nivel: 1, certa: 3,
      pt: ['Qual Pokémon é o mascote da franquia?', ['Eevee', 'Charmander', 'Jigglypuff', 'Pikachu']],
      en: ["Which Pokémon is the franchise's mascot?", ['Eevee', 'Charmander', 'Jigglypuff', 'Pikachu']],
      es: ['¿Qué Pokémon es la mascota de la franquicia?', ['Eevee', 'Charmander', 'Jigglypuff', 'Pikachu']] },
    { id: 'anime-006', nivel: 2, certa: 2,
      pt: [
        'Quem criou o mangá Dragon Ball?',
        ['Eiichiro Oda', 'Masashi Kishimoto', 'Akira Toriyama', 'Hajime Isayama']],
      en: [
        'Who created the Dragon Ball manga?',
        ['Eiichiro Oda', 'Masashi Kishimoto', 'Akira Toriyama', 'Hajime Isayama']],
      es: [
        '¿Quién creó el manga de Dragon Ball?',
        ['Eiichiro Oda', 'Masashi Kishimoto', 'Akira Toriyama', 'Hajime Isayama']] },
    { id: 'anime-007', nivel: 2, certa: 0,
      pt: [
        'Quem é o protagonista de Attack on Titan?',
        ['Eren Yeager', 'Armin Arlert', 'Mikasa Ackerman', 'Levi Ackerman']],
      en: [
        'Who is the protagonist of Attack on Titan?',
        ['Eren Yeager', 'Armin Arlert', 'Mikasa Ackerman', 'Levi Ackerman']],
      es: [
        '¿Quién es el protagonista de Attack on Titan?',
        ['Eren Yeager', 'Armin Arlert', 'Mikasa Ackerman', 'Levi Ackerman']] },
    { id: 'anime-008', nivel: 2, certa: 1,
      pt: [
        'Quem é o autor do mangá One Piece?',
        ['Tite Kubo', 'Eiichiro Oda', 'Hajime Isayama', 'Yoshihiro Togashi']],
      en: [
        'Who is the author of the One Piece manga?',
        ['Tite Kubo', 'Eiichiro Oda', 'Hajime Isayama', 'Yoshihiro Togashi']],
      es: [
        '¿Quién es el autor del manga One Piece?',
        ['Tite Kubo', 'Eiichiro Oda', 'Hajime Isayama', 'Yoshihiro Togashi']] },
    { id: 'anime-009', nivel: 3, certa: 3,
      pt: ['Qual shinigami acompanha Light Yagami em Death Note?', ['Rem', 'Sidoh', 'Gelus', 'Ryuk']],
      en: ['Which shinigami accompanies Light Yagami in Death Note?', ['Rem', 'Sidoh', 'Gelus', 'Ryuk']],
      es: ['¿Qué shinigami acompaña a Light Yagami en Death Note?', ['Rem', 'Sidoh', 'Gelus', 'Ryuk']] },
    { id: 'anime-010', nivel: 3, certa: 1,
      pt: [
        'Qual estúdio produziu o anime original de Neon Genesis Evangelion, de 1995?',
        ['Madhouse', 'Gainax', 'Sunrise', 'Production I.G']],
      en: [
        'Which studio produced the original 1995 Neon Genesis Evangelion anime?',
        ['Madhouse', 'Gainax', 'Sunrise', 'Production I.G']],
      es: [
        '¿Qué estudio produjo el anime original de Neon Genesis Evangelion, de 1995?',
        ['Madhouse', 'Gainax', 'Sunrise', 'Production I.G']] },
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.anime = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

'use strict';

/* Quiz -- tema "anime". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  const q = (id, nivel, certa, textos, alternativas) => ({
    id, nivel, certa,
    pt: [textos[0], alternativas[0]], en: [textos[1], alternativas[1]], es: [textos[2], alternativas[2]],
  });
  const mesmas = (alternativas) => [alternativas, alternativas, alternativas];
  const perguntas = [
    q('anime-001', 1, 0,
[
        "Quem é o protagonista de One Piece?",
        "Who is the protagonist of One Piece?",
        "¿Quién es el protagonista de One Piece?"
      ],
      mesmas([
        "Monkey D. Luffy",
        "Roronoa Zoro",
        "Sanji",
        "Usopp"
      ])),
    q('anime-002', 1, 1,
[
        "Quantas Esferas do Dragão invocam Shenlong?",
        "How many Dragon Balls summon Shenron?",
        "¿Cuántas esferas del dragón invocan a Shenlong?"
      ],
      mesmas([
        "6",
        "7",
        "8",
        "9"
      ])),
    q('anime-003', 1, 2,
[
        "Qual Pokémon é o mascote da franquia?",
        "Which Pokémon is the franchise mascot?",
        "¿Qué Pokémon es la mascota de la franquicia?"
      ],
      mesmas([
        "Eevee",
        "Charmander",
        "Pikachu",
        "Jigglypuff"
      ])),
    q('anime-004', 1, 3,
[
        "Qual estúdio foi cofundado por Hayao Miyazaki?",
        "Which studio was co-founded by Hayao Miyazaki?",
        "¿Qué estudio cofundó Hayao Miyazaki?"
      ],
      mesmas([
        "Toei Animation",
        "Madhouse",
        "Bones",
        "Studio Ghibli"
      ])),
    q('anime-005', 1, 0,
[
        "Quem criou o mangá Dragon Ball?",
        "Who created the Dragon Ball manga?",
        "¿Quién creó el manga Dragon Ball?"
      ],
      mesmas([
        "Akira Toriyama",
        "Eiichiro Oda",
        "Masashi Kishimoto",
        "Hajime Isayama"
      ])),
    q('anime-006', 1, 1,
[
        "Quem é o protagonista de Naruto?",
        "Who is the protagonist of Naruto?",
        "¿Quién es el protagonista de Naruto?"
      ],
      mesmas([
        "Sasuke Uchiha",
        "Naruto Uzumaki",
        "Kakashi Hatake",
        "Gaara"
      ])),
    q('anime-007', 1, 2,
[
        "Quem usa o caderno mortal em Death Note?",
        "Who uses the deadly notebook in Death Note?",
        "¿Quién usa el cuaderno mortal en Death Note?"
      ],
      mesmas([
        "L Lawliet",
        "Misa Amane",
        "Light Yagami",
        "Soichiro Yagami"
      ])),
    q('anime-008', 1, 3,
[
        "Que tipo de criatura é Totoro?",
        "What kind of creature is Totoro?",
        "¿Qué tipo de criatura es Totoro?"
      ],
      [
        ["Um robô","Um dragão","Um gato","Um espírito da floresta"],
        ["A robot","A dragon","A cat","A forest spirit"],
        ["Un robot","Un dragón","Un gato","Un espíritu del bosque"]
      ]),
    q('anime-009', 1, 0,
[
        "Qual é o nome do irmão de Edward Elric?",
        "What is the name of Edward Elric’s brother?",
        "¿Cómo se llama el hermano de Edward Elric?"
      ],
      mesmas([
        "Alphonse Elric",
        "Roy Mustang",
        "Maes Hughes",
        "Alex Louis Armstrong"
      ])),
    q('anime-010', 1, 1,
[
        "Que arma os caçadores usam em Demon Slayer?",
        "Which weapon do demon slayers use?",
        "¿Qué arma usan los cazadores en Demon Slayer?"
      ],
      [
        ["Arcos","Espadas Nichirin","Lanças","Machados"],
        ["Bows","Nichirin swords","Spears","Axes"],
        ["Arcos","Espadas Nichirin","Lanzas","Hachas"]
      ]),
    q('anime-011', 1, 2,
[
        "Qual é o sobrenome de Satoru em Jujutsu Kaisen?",
        "What is Satoru’s surname in Jujutsu Kaisen?",
        "¿Cuál es el apellido de Satoru en Jujutsu Kaisen?"
      ],
      mesmas([
        "Fushiguro",
        "Itadori",
        "Gojo",
        "Geto"
      ])),
    q('anime-012', 1, 3,
[
        "Qual destes filmes foi dirigido por Hayao Miyazaki?",
        "Which film was directed by Hayao Miyazaki?",
        "¿Cuál de estas películas fue dirigida por Hayao Miyazaki?"
      ],
      mesmas([
        "Your Name.",
        "Wolf Children",
        "The Girl Who Leapt Through Time",
        "Spirited Away"
      ])),
    q('anime-013', 1, 0,
[
        "Qual é o nome civil de Sailor Moon?",
        "What is Sailor Moon’s civilian name?",
        "¿Cuál es el nombre civil de Sailor Moon?"
      ],
      mesmas([
        "Usagi Tsukino",
        "Rei Hino",
        "Ami Mizuno",
        "Makoto Kino"
      ])),
    q('anime-014', 1, 1,
[
        "Qual é a espécie de Happy em Fairy Tail?",
        "What species is Happy in Fairy Tail?",
        "¿Cuál es la especie de Happy en Fairy Tail?"
      ],
      [
        ["Dragão","Exceed","Humano","Espírito Celestial"],
        ["Dragon","Exceed","Human","Celestial Spirit"],
        ["Dragón","Exceed","Humano","Espíritu Celestial"]
      ]),
    q('anime-015', 1, 2,
[
        "Que esporte aparece em Haikyu!!?",
        "Which sport is featured in Haikyu!!?",
        "¿Qué deporte aparece en Haikyu!!?"
      ],
      [
        ["Basquete","Futebol","Vôlei","Beisebol"],
        ["Basketball","Soccer","Volleyball","Baseball"],
        ["Baloncesto","Fútbol","Voleibol","Béisbol"]
      ]),
    q('anime-016', 1, 3,
[
        "Qual é o nome do gato robótico azul?",
        "What is the blue robotic cat’s name?",
        "¿Cómo se llama el gato robótico azul?"
      ],
      mesmas([
        "Nobita",
        "Suneo",
        "Gian",
        "Doraemon"
      ])),
    q('anime-017', 1, 0,
[
        "Qual é o tipo principal de Pikachu?",
        "What is Pikachu’s primary type?",
        "¿Cuál es el tipo principal de Pikachu?"
      ],
      [
        ["Elétrico","Fogo","Água","Planta"],
        ["Electric","Fire","Water","Grass"],
        ["Eléctrico","Fuego","Agua","Planta"]
      ]),
    q('anime-018', 1, 1,
[
        "Quem é o protagonista de My Hero Academia?",
        "Who is the protagonist of My Hero Academia?",
        "¿Quién es el protagonista de My Hero Academia?"
      ],
      mesmas([
        "Katsuki Bakugo",
        "Izuku Midoriya",
        "Shoto Todoroki",
        "Tenya Iida"
      ])),
    q('anime-019', 1, 2,
[
        "Que jogo de cartas Yugi joga?",
        "Which card game does Yugi play?",
        "¿Qué juego de cartas juega Yugi?"
      ],
      mesmas([
        "Magic: The Gathering",
        "Cardfight!! Vanguard",
        "Duel Monsters",
        "Weiss Schwarz"
      ])),
    q('anime-020', 1, 3,
[
        "Qual personagem é conhecido como One-Punch Man?",
        "Which character is known as One-Punch Man?",
        "¿Qué personaje es conocido como One-Punch Man?"
      ],
      mesmas([
        "Genos",
        "King",
        "Mumen Rider",
        "Saitama"
      ])),
    q('anime-021', 2, 0,
[
        "Quem é o autor do mangá One Piece?",
        "Who is the author of the One Piece manga?",
        "¿Quién es el autor del manga One Piece?"
      ],
      mesmas([
        "Eiichiro Oda",
        "Tite Kubo",
        "Yoshihiro Togashi",
        "Rumiko Takahashi"
      ])),
    q('anime-022', 2, 1,
[
        "Qual besta com cauda está em Naruto Uzumaki?",
        "Which tailed beast is inside Naruto Uzumaki?",
        "¿Qué bestia con cola está dentro de Naruto Uzumaki?"
      ],
      mesmas([
        "Shukaku",
        "Kurama",
        "Matatabi",
        "Gyūki"
      ])),
    q('anime-023', 2, 2,
[
        "Que estúdio produziu Neon Genesis Evangelion, de 1995?",
        "Which studio produced 1995 Neon Genesis Evangelion?",
        "¿Qué estudio produjo Neon Genesis Evangelion, de 1995?"
      ],
      mesmas([
        "Madhouse",
        "Sunrise",
        "Gainax",
        "Production I.G"
      ])),
    q('anime-024', 2, 3,
[
        "Em qual cidade se passa One-Punch Man?",
        "In which city does One-Punch Man take place?",
        "¿En qué ciudad transcurre One-Punch Man?"
      ],
      mesmas([
        "Fuyuki City",
        "Karakura Town",
        "Academy City",
        "City Z"
      ])),
    q('anime-025', 2, 0,
[
        "Quem escreveu o mangá Attack on Titan?",
        "Who wrote the Attack on Titan manga?",
        "¿Quién escribió el manga Attack on Titan?"
      ],
      mesmas([
        "Hajime Isayama",
        "Gege Akutami",
        "Kohei Horikoshi",
        "Naoki Urasawa"
      ])),
    q('anime-026', 2, 1,
[
        "Quem é o melhor amigo de Gon Freecss?",
        "Who is Gon Freecss’s best friend?",
        "¿Quién es el mejor amigo de Gon Freecss?"
      ],
      mesmas([
        "Leorio Paradinight",
        "Killua Zoldyck",
        "Kurapika",
        "Hisoka Morow"
      ])),
    q('anime-027', 2, 2,
[
        "Qual respiração Tanjiro usa principalmente?",
        "Which breathing style does Tanjiro primarily use?",
        "¿Qué respiración usa principalmente Tanjiro?"
      ],
      [
        ["Respiração do Trovão", "Respiração do Vento", "Respiração da Água", "Respiração das Chamas"],
        ["Thunder Breathing", "Wind Breathing", "Water Breathing", "Flame Breathing"],
        ["Respiración del Trueno", "Respiración del Viento", "Respiración del Agua", "Respiración de las Llamas"],
      ]),
    q('anime-028', 2, 3,
[
        "Quem lidera os Piratas do Ruivo?",
        "Who leads the Red Hair Pirates?",
        "¿Quién lidera a los Piratas del Pelirrojo?"
      ],
      mesmas([
        "Marshall D. Teach",
        "Dracule Mihawk",
        "Buggy",
        "Shanks"
      ])),
    q('anime-029', 2, 0,
[
        "Como se chamam as armas dos shinigami em Bleach?",
        "What are shinigami weapons called in Bleach?",
        "¿Cómo se llaman las armas de los shinigami en Bleach?"
      ],
      mesmas([
        "Zanpakutō",
        "Bankai",
        "Quincy",
        "Hollow"
      ])),
    q('anime-030', 2, 1,
[
        "Quem dirigiu Your Name.?",
        "Who directed Your Name.?",
        "¿Quién dirigió Your Name.?"
      ],
      mesmas([
        "Mamoru Hosoda",
        "Makoto Shinkai",
        "Satoshi Kon",
        "Mamoru Oshii"
      ])),
    q('anime-031', 2, 2,
[
        "Como se chama a guilda de magos de Fairy Tail?",
        "What is the wizards’ guild called in Fairy Tail?",
        "¿Cómo se llama el gremio de magos en Fairy Tail?"
      ],
      mesmas([
        "Black Bulls",
        "Phantom Troupe",
        "Fairy Tail",
        "Survey Corps"
      ])),
    q('anime-032', 2, 3,
[
        "A que corpo militar Levi Ackerman pertence?",
        "Which military branch does Levi Ackerman belong to?",
        "¿A qué cuerpo militar pertenece Levi Ackerman?"
      ],
      mesmas([
        "Military Police",
        "Garrison",
        "Training Corps",
        "Survey Corps"
      ])),
    q('anime-033', 2, 0,
[
        "Quem criou o mangá Sailor Moon?",
        "Who created the Sailor Moon manga?",
        "¿Quién creó el manga Sailor Moon?"
      ],
      mesmas([
        "Naoko Takeuchi",
        "CLAMP",
        "Hiromu Arakawa",
        "Ai Yazawa"
      ])),
    q('anime-034', 2, 1,
[
        "Qual shinigami acompanha Light Yagami?",
        "Which shinigami accompanies Light Yagami?",
        "¿Qué shinigami acompaña a Light Yagami?"
      ],
      mesmas([
        "Rem",
        "Ryuk",
        "Sidoh",
        "Gelus"
      ])),
    q('anime-035', 2, 2,
[
        "Que estúdio produziu a 1ª temporada de One-Punch Man?",
        "Which studio produced One-Punch Man season 1?",
        "¿Qué estudio produjo la temporada 1 de One-Punch Man?"
      ],
      mesmas([
        "MAPPA",
        "ufotable",
        "Madhouse",
        "Kyoto Animation"
      ])),
    q('anime-036', 2, 3,
[
        "Como se chama a nave de Cowboy Bebop?",
        "What is the crew’s spaceship called in Cowboy Bebop?",
        "¿Cómo se llama la nave de Cowboy Bebop?"
      ],
      mesmas([
        "Arcadia",
        "Going Merry",
        "Bebop II",
        "Bebop"
      ])),
    q('anime-037', 2, 0,
[
        "Como se chama o sistema de energia de Hunter x Hunter?",
        "What is Hunter x Hunter’s power system called?",
        "¿Cómo se llama el sistema de energía de Hunter x Hunter?"
      ],
      mesmas([
        "Nen",
        "Ki",
        "Reiatsu",
        "Chakra"
      ])),
    q('anime-038', 2, 1,
[
        "Qual personagem de Dragon Ball treina Goku e Kuririn na Kame House?",
        "Which Dragon Ball character trains Goku and Krillin at Kame House?",
        "¿Qué personaje de Dragon Ball entrena a Goku y a Krilin en la Kame House?"
      ],
      mesmas([
        "Piccolo",
        "Master Roshi",
        "Yamcha",
        "Vegeta"
      ])),
    q('anime-039', 2, 2,
[
        "Quem dirigiu Perfect Blue?",
        "Who directed Perfect Blue?",
        "¿Quién dirigió Perfect Blue?"
      ],
      mesmas([
        "Mamoru Hosoda",
        "Makoto Shinkai",
        "Satoshi Kon",
        "Hayao Miyazaki"
      ])),
    q('anime-040', 2, 3,
[
        "Quem lidera o Time 7 no início de Naruto?",
        "Who leads Team 7 at the beginning of Naruto?",
        "¿Quién lidera al Equipo 7 al inicio de Naruto?"
      ],
      mesmas([
        "Might Guy",
        "Asuma Sarutobi",
        "Kurenai Yuhi",
        "Kakashi Hatake"
      ])),
    q('anime-041', 2, 0,
[
        "Quem escreveu Demon Slayer: Kimetsu no Yaiba?",
        "Who wrote Demon Slayer: Kimetsu no Yaiba?",
        "¿Quién escribió Demon Slayer: Kimetsu no Yaiba?"
      ],
      mesmas([
        "Koyoharu Gotouge",
        "Natsuki Takaya",
        "Hirohiko Araki",
        "Ken Wakui"
      ])),
    q('anime-042', 2, 1,
[
        "Qual é o nome de herói de Toshinori Yagi?",
        "What is Toshinori Yagi’s hero name?",
        "¿Cuál es el nombre de héroe de Toshinori Yagi?"
      ],
      mesmas([
        "Endeavor",
        "All Might",
        "Hawks",
        "Eraser Head"
      ])),
    q('anime-043', 2, 2,
[
        "Quem criou JoJo’s Bizarre Adventure?",
        "Who created JoJo’s Bizarre Adventure?",
        "¿Quién creó JoJo’s Bizarre Adventure?"
      ],
      mesmas([
        "Tite Kubo",
        "Yoshihiro Togashi",
        "Hirohiko Araki",
        "Yuki Tabata"
      ])),
    q('anime-044', 2, 3,
[
        "Qual é a evolução final de Charmander?",
        "What is Charmander’s final evolution?",
        "¿Cuál es la evolución final de Charmander?"
      ],
      mesmas([
        "Charmeleon",
        "Blastoise",
        "Venusaur",
        "Charizard"
      ])),
    q('anime-045', 2, 0,
[
        "Que estúdio produziu Violet Evergarden?",
        "Which studio produced Violet Evergarden?",
        "¿Qué estudio produjo Violet Evergarden?"
      ],
      mesmas([
        "Kyoto Animation",
        "Wit Studio",
        "A-1 Pictures",
        "Trigger"
      ])),
    q('anime-046', 3, 1,
[
        "Qual mangaká criou Astro Boy?",
        "Which manga artist created Astro Boy?",
        "¿Qué mangaka creó Astro Boy?"
      ],
      mesmas([
        "Go Nagai",
        "Osamu Tezuka",
        "Shotaro Ishinomori",
        "Rumiko Takahashi"
      ])),
    q('anime-047', 3, 2,
[
        "Que estúdio animou a 1ª temporada de Attack on Titan?",
        "Which studio animated Attack on Titan season 1?",
        "¿Qué estudio animó la temporada 1 de Attack on Titan?"
      ],
      mesmas([
        "MAPPA",
        "Bones",
        "Wit Studio",
        "P.A. Works"
      ])),
    q('anime-048', 3, 3,
[
        "Qual foi o primeiro longa dirigido por Hayao Miyazaki?",
        "What was Hayao Miyazaki’s first directed feature film?",
        "¿Cuál fue el primer largometraje dirigido por Hayao Miyazaki?"
      ],
      [
        ["Nausicaä do Vale do Vento", "Meu Amigo Totoro", "O Castelo no Céu", "O Castelo de Cagliostro"],
        ["Nausicaä of the Valley of the Wind", "My Neighbor Totoro", "Castle in the Sky", "The Castle of Cagliostro"],
        ["Nausicaä del Valle del Viento", "Mi vecino Totoro", "El castillo en el cielo", "El castillo de Cagliostro"],
      ]),
    q('anime-049', 3, 0,
[
        "Qual unidade Shinji Ikari pilota?",
        "Which unit does Shinji Ikari pilot?",
        "¿Qué unidad pilota Shinji Ikari?"
      ],
      mesmas([
        "Evangelion Unit-01",
        "Evangelion Unit-00",
        "Evangelion Unit-02",
        "Evangelion Unit-03"
      ])),
    q('anime-050', 3, 1,
[
        "Quem dirigiu Ghost in the Shell, de 1995?",
        "Who directed 1995 Ghost in the Shell?",
        "¿Quién dirigió Ghost in the Shell, de 1995?"
      ],
      mesmas([
        "Satoshi Kon",
        "Mamoru Oshii",
        "Katsuhiro Otomo",
        "Rintaro"
      ])),
    q('anime-051', 3, 2,
[
        "Quem faz contratos com garotas mágicas em Madoka Magica?",
        "Who makes contracts with magical girls in Madoka Magica?",
        "¿Quién hace contratos con chicas mágicas en Madoka Magica?"
      ],
      mesmas([
        "Homura Akemi",
        "Mami Tomoe",
        "Kyubey",
        "Sayaka Miki"
      ])),
    q('anime-052', 3, 3,
[
        "Quem criou o mangá Berserk?",
        "Who created the Berserk manga?",
        "¿Quién creó el manga Berserk?"
      ],
      mesmas([
        "Naoki Urasawa",
        "Takehiko Inoue",
        "Yoshihiro Togashi",
        "Kentaro Miura"
      ])),
    q('anime-053', 3, 0,
[
        "Qual é o sobrenome de Spike em Cowboy Bebop?",
        "What is Spike’s surname in Cowboy Bebop?",
        "¿Cuál es el apellido de Spike en Cowboy Bebop?"
      ],
      mesmas([
        "Spiegel",
        "Spears",
        "Spencer",
        "Spade"
      ])),
    q('anime-054', 3, 1,
[
        "Qual estúdio animou Fullmetal Alchemist: Brotherhood, de 2009?",
        "Which studio animated Fullmetal Alchemist: Brotherhood (2009)?",
        "¿Qué estudio animó Fullmetal Alchemist: Brotherhood, de 2009?"
      ],
      mesmas([
        "Madhouse",
        "Bones",
        "Sunrise",
        "Studio Pierrot"
      ])),
    q('anime-055', 3, 2,
[
        "Qual estúdio Hideaki Anno fundou em 2006?",
        "Which studio did Hideaki Anno found in 2006?",
        "¿Qué estudio fundó Hideaki Anno en 2006?"
      ],
      mesmas([
        "Gainax",
        "Trigger",
        "Khara",
        "Shaft"
      ])),
    q('anime-056', 3, 3,
[
        "Quem criou o mangá The Rose of Versailles?",
        "Who created the manga The Rose of Versailles?",
        "¿Quién creó el manga The Rose of Versailles?"
      ],
      mesmas([
        "Moto Hagio",
        "Keiko Takemiya",
        "Rumiko Takahashi",
        "Riyoko Ikeda"
      ])),
    q('anime-057', 3, 0,
[
        "Quem compôs a trilha de Cowboy Bebop?",
        "Who composed the Cowboy Bebop soundtrack?",
        "¿Quién compuso la banda sonora de Cowboy Bebop?"
      ],
      mesmas([
        "Yoko Kanno",
        "Joe Hisaishi",
        "Hiroyuki Sawano",
        "Kenji Kawai"
      ])),
    q('anime-058', 3, 1,
[
        "Quem dirigiu The Girl Who Leapt Through Time, de 2006?",
        "Who directed 2006 The Girl Who Leapt Through Time?",
        "¿Quién dirigió The Girl Who Leapt Through Time, de 2006?"
      ],
      mesmas([
        "Makoto Shinkai",
        "Mamoru Hosoda",
        "Satoshi Kon",
        "Masaaki Yuasa"
      ])),
    q('anime-059', 3, 2,
[
        "Quem criou o mangá Slam Dunk?",
        "Who created the Slam Dunk manga?",
        "¿Quién creó el manga Slam Dunk?"
      ],
      mesmas([
        "Naoki Urasawa",
        "Masashi Kishimoto",
        "Takehiko Inoue",
        "Tsugumi Ohba"
      ])),
    q('anime-060', 3, 3,
[
        "Quem dirigiu Akira, de 1988?",
        "Who directed 1988 Akira?",
        "¿Quién dirigió Akira, de 1988?"
      ],
      mesmas([
        "Mamoru Oshii",
        "Satoshi Kon",
        "Hayao Miyazaki",
        "Katsuhiro Otomo"
      ])),
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.anime = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

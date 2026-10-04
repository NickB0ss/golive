'use strict';

/* Quiz -- tema "musica". Cada pergunta: id estavel, nivel (1 facil, 2 medio,
 * 3 dificil; nao aparece na tela), indice da certa (vale nas tres linguas)
 * e o texto por lingua. Criterios na spec 2026-10-03-idiomas, secao 5.1. */

(function (root) {
  let numero = 0;
  function lancou(nivel, certa, titulo, alternativas) {
    numero += 1;
    const id = `musica-${String(numero).padStart(3, '0')}`;
    return { id, nivel, certa,
      pt: [`Qual artista ou grupo lançou "${titulo}"?`, alternativas],
      en: [`Which artist or group released "${titulo}"?`, alternativas],
      es: [`¿Qué artista o grupo lanzó "${titulo}"?`, alternativas] };
  }

  /* Pergunta livre (instrumento, genero, autoria): textos por lingua. */
  function livre(nivel, certa, pt, en, es) {
    numero += 1;
    const id = `musica-${String(numero).padStart(3, '0')}`;
    return { id, nivel, certa, pt, en, es };
  }

  const perguntas = [
    lancou(1, 0, 'Hey Jude', ['The Beatles', 'The Rolling Stones', 'The Kinks', 'The Who']),
    lancou(1, 1, 'Billie Jean', ['Prince', 'Michael Jackson', 'Stevie Wonder', 'Bruno Mars']),
    lancou(1, 2, 'Hips Don\'t Lie', ['Jennifer Lopez', 'Beyoncé', 'Shakira', 'Rihanna']),
    lancou(1, 3, 'Bohemian Rhapsody', ['ABBA', 'U2', 'The Police', 'Queen']),
    lancou(1, 0, 'Rolling in the Deep', ['Adele', 'Dua Lipa', 'Lorde', 'Sia']),
    lancou(1, 1, 'Dancing Queen', ['Boney M.', 'ABBA', 'Bee Gees', 'A-ha']),
    lancou(1, 2, 'Firework', ['Pink', 'Taylor Swift', 'Katy Perry', 'Miley Cyrus']),
    lancou(1, 3, 'Smells Like Teen Spirit', ['Pearl Jam', 'Radiohead', 'Oasis', 'Nirvana']),
    lancou(1, 0, 'Like a Prayer', ['Madonna', 'Cyndi Lauper', 'Whitney Houston', 'Janet Jackson']),
    lancou(1, 1, 'Shape of You', ['Sam Smith', 'Ed Sheeran', 'Shawn Mendes', 'James Arthur']),
    lancou(1, 2, 'Blinding Lights', ['Drake', 'Bruno Mars', 'The Weeknd', 'Post Malone']),
    lancou(1, 3, 'Purple Rain', ['David Bowie', 'George Michael', 'Lenny Kravitz', 'Prince']),
    lancou(1, 0, 'Havana', ['Camila Cabello', 'Selena Gomez', 'Demi Lovato', 'Rosalía']),
    lancou(1, 1, 'Poker Face', ['Rihanna', 'Lady Gaga', 'Katy Perry', 'Kesha']),
    lancou(1, 2, 'Umbrella', ['Beyoncé', 'Alicia Keys', 'Rihanna', 'Nelly Furtado']),
    lancou(1, 3, 'Despacito', ['J Balvin', 'Bad Bunny', 'Maluma', 'Luis Fonsi']),
    lancou(1, 0, 'Viva la Vida', ['Coldplay', 'Keane', 'Muse', 'The Killers']),
    lancou(1, 1, 'Bad Guy', ['Lorde', 'Billie Eilish', 'Olivia Rodrigo', 'Halsey']),
    lancou(1, 2, 'Wonderwall', ['Blur', 'Pulp', 'Oasis', 'Suede']),
    lancou(1, 3, 'Girls Just Want to Have Fun', ['Tina Turner', 'Belinda Carlisle', 'Pat Benatar', 'Cyndi Lauper']),
    lancou(2, 0, 'The Dark Side of the Moon', ['Pink Floyd', 'Genesis', 'Yes', 'Led Zeppelin']),
    lancou(2, 1, 'Tití Me Preguntó', ['Daddy Yankee', 'Bad Bunny', 'J Balvin', 'Ozuna']),
    lancou(2, 2, 'Back to Black', ['Duffy', 'Adele', 'Amy Winehouse', 'Lana Del Rey']),
    lancou(2, 3, 'Hotel California', ['Fleetwood Mac', 'The Doobie Brothers', 'The Doors', 'Eagles']),
    livre(2, 0,
      ['Qual destes gêneros musicais nasceu na Jamaica?', ['Reggae', 'Flamenco', 'Tango', 'Jazz']],
      ['Which of these music genres was born in Jamaica?', ['Reggae', 'Flamenco', 'Tango', 'Jazz']],
      ['¿Cuál de estos géneros musicales nació en Jamaica?', ['Reggae', 'Flamenco', 'Tango', 'Jazz']]),
    lancou(2, 1, 'Random Access Memories', ['Justice', 'Daft Punk', 'Air', 'Cassius']),
    lancou(2, 2, 'Future Nostalgia', ['Doja Cat', 'Halsey', 'Dua Lipa', 'Charli XCX']),
    livre(2, 3,
      ['Qual destes instrumentos faz parte da família das cordas?', ['Flauta', 'Trompete', 'Clarinete', 'Violoncelo']],
      ['Which of these instruments belongs to the string family?', ['Flute', 'Trumpet', 'Clarinet', 'Cello']],
      ['¿Cuál de estos instrumentos pertenece a la familia de las cuerdas?',
        ['Flauta', 'Trompeta', 'Clarinete', 'Violonchelo']]),
    lancou(2, 0, 'Dynamite', ['BTS', 'EXO', 'Blackpink', 'Seventeen']),
    lancou(2, 1, 'How You Like That', ['TWICE', 'Blackpink', 'Red Velvet', 'NewJeans']),
    lancou(2, 2, 'Take On Me', ['Duran Duran', 'Depeche Mode', 'A-ha', 'Erasure']),
    lancou(2, 3, 'Sweet Dreams (Are Made of This)', ['The Human League', 'Soft Cell', 'Depeche Mode', 'Eurythmics']),
    lancou(2, 0, 'Lemonade', ['Beyoncé', 'Rihanna', 'Alicia Keys', 'Solange']),
    lancou(2, 1, 'The Miseducation of Lauryn Hill', ['Erykah Badu', 'Lauryn Hill', 'Mary J. Blige', 'Missy Elliott']),
    lancou(2, 2, 'Born to Die', ['Lorde', 'Florence Welch', 'Lana Del Rey', 'Sia']),
    lancou(2, 3, 'Mr. Brightside', ['Arctic Monkeys', 'Franz Ferdinand', 'The Strokes', 'The Killers']),
    lancou(2, 0, 'Feel Good Inc.', ['Gorillaz', 'Blur', 'Oasis', 'Radiohead']),
    livre(2, 1,
      ['Quem compôs "I Will Always Love You", sucesso de Whitney Houston?',
        ['Whitney Houston', 'Dolly Parton', 'Linda Ronstadt', 'Barbra Streisand']],
      ['Who wrote "I Will Always Love You", a hit for Whitney Houston?',
        ['Whitney Houston', 'Dolly Parton', 'Linda Ronstadt', 'Barbra Streisand']],
      ['¿Quién escribió "I Will Always Love You", éxito de Whitney Houston?',
        ['Whitney Houston', 'Dolly Parton', 'Linda Ronstadt', 'Barbra Streisand']]),
    lancou(2, 2, 'No Woman, No Cry', [
      'Peter Tosh', 'Jimmy Cliff', 'Bob Marley & The Wailers', 'Toots and the Maytals']),
    lancou(2, 3, 'Kashmir', ['Deep Purple', 'Black Sabbath', 'The Who', 'Led Zeppelin']),
    livre(2, 0,
      ['Quem compôs a Nona Sinfonia, que termina com o "Hino à Alegria"?',
        ['Beethoven', 'Mozart', 'Bach', 'Chopin']],
      ['Who composed the Ninth Symphony, which ends with the "Ode to Joy"?',
        ['Beethoven', 'Mozart', 'Bach', 'Chopin']],
      ['¿Quién compuso la Novena Sinfonía, que termina con la "Oda a la alegría"?',
        ['Beethoven', 'Mozart', 'Bach', 'Chopin']]),
    lancou(2, 1, 'Halo', ['Rihanna', 'Beyoncé', 'Alicia Keys', 'Leona Lewis']),
    lancou(2, 2, 'Somebody That I Used to Know', ['Vance Joy', 'Hozier', 'Gotye', 'James Blake']),
    lancou(2, 3, 'La Tortura', ['Thalía', 'Paulina Rubio', 'Nelly Furtado', 'Shakira']),
    livre(2, 0,
      ['Quantas cordas tem um violão padrão?', ['Seis', 'Quatro', 'Cinco', 'Oito']],
      ['How many strings does a standard guitar have?', ['Six', 'Four', 'Five', 'Eight']],
      ['¿Cuántas cuerdas tiene una guitarra estándar?', ['Seis', 'Cuatro', 'Cinco', 'Ocho']]),
    lancou(3, 1, 'Mezzanine', ['Portishead', 'Massive Attack', 'Moby', 'The Chemical Brothers']),
    lancou(3, 2, 'Homogenic', ['PJ Harvey', 'Fiona Apple', 'Björk', 'Tori Amos']),
    lancou(3, 3, 'Ágætis byrjun', ['Múm', 'Björk', 'Of Monsters and Men', 'Sigur Rós']),
    lancou(3, 0, 'Hejira', ['Joni Mitchell', 'Carole King', 'Joan Baez', 'Carly Simon']),
    lancou(3, 1, 'Vespertine', ['FKA twigs', 'Björk', 'Sophie', 'Grimes']),
    livre(3, 2,
      ['Qual instrumento era a marca do jazzista Miles Davis?', ['Saxofone', 'Piano', 'Trompete', 'Contrabaixo']],
      ['Which instrument was the trademark of jazz musician Miles Davis?',
        ['Saxophone', 'Piano', 'Trumpet', 'Double bass']],
      ['¿Qué instrumento era la marca del jazzista Miles Davis?', ['Saxofón', 'Piano', 'Trompeta', 'Contrabajo']]),
    lancou(3, 3, 'Dummy', ['Tricky', 'Massive Attack', 'Sneaker Pimps', 'Portishead']),
    lancou(3, 0, 'Since I Left You', ['The Avalanches', 'The Chemical Brothers', 'Air', 'M83']),
    lancou(3, 1, 'In Rainbows', ['Muse', 'Radiohead', 'Coldplay', 'Interpol']),
    lancou(3, 2, 'The Suburbs', ['The National', 'The Strokes', 'Arcade Fire', 'Interpol']),
    lancou(3, 3, 'Blue Lines', ['Soul II Soul', 'Portishead', 'Tricky', 'Massive Attack']),
    lancou(3, 0, 'Aquemini', ['Outkast', 'The Roots', 'De La Soul', 'A Tribe Called Quest']),
    lancou(3, 1, 'Illinois', ['Sufjan Stevens', 'Bon Iver', 'Fleet Foxes', 'Iron & Wine']),
    lancou(3, 2, 'The Low End Theory', ['De La Soul', 'Gang Starr', 'A Tribe Called Quest', 'The Roots']),
    lancou(3, 3, 'Discovery', ['Air', 'Justice', 'Cassius', 'Daft Punk']),
  ];
  root.GoLive = root.GoLive || {};
  root.GoLive.mesaQuizBanco = root.GoLive.mesaQuizBanco || {};
  root.GoLive.mesaQuizBanco.musica = perguntas;
  if (typeof module !== 'undefined') module.exports = perguntas;
})(globalThis);

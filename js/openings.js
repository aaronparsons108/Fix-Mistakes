// A small opening book: longest-prefix match on the game's SAN moves.
// Deliberately club-level breadth — enough that the host can almost always
// name what was played without shipping a full ECO database.

const BOOK = [
  // 1.e4 e5
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy López, Morphy Defence'],
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy López'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game, Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game, Two Knights'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'Four Knights Game'],
  ['e4 e5 Nf3 Nf6', "Petrov's Defence"],
  ['e4 e5 Nf3 d6', 'Philidor Defence'],
  ['e4 e5 Nf3', "King's Knight Opening"],
  ['e4 e5 Bc4', "Bishop's Opening"],
  ['e4 e5 f4', "King's Gambit"],
  ['e4 e5 Nc3', 'Vienna Game'],
  ['e4 e5 Qh5', 'Wayward Queen Attack'],
  ['e4 e5', 'Open Game'],
  // 1.e4 others
  ['e4 c5 Nf3 d6 d4', 'Open Sicilian'],
  ['e4 c5 Nf3 Nc6', 'Sicilian Defence'],
  ['e4 c5 c3', 'Sicilian, Alapin'],
  ['e4 c5 Nc3', 'Closed Sicilian'],
  ['e4 c5', 'Sicilian Defence'],
  ['e4 e6 d4 d5', 'French Defence'],
  ['e4 e6', 'French Defence'],
  ['e4 c6 d4 d5', 'Caro-Kann Defence'],
  ['e4 c6', 'Caro-Kann Defence'],
  ['e4 d5', 'Scandinavian Defence'],
  ['e4 d6 d4 Nf6', 'Pirc Defence'],
  ['e4 Nf6', "Alekhine's Defence"],
  ['e4 g6', 'Modern Defence'],
  ['e4', "King's Pawn Opening"],
  // 1.d4
  ['d4 d5 c4 e6', "Queen's Gambit Declined"],
  ['d4 d5 c4 c6', 'Slav Defence'],
  ['d4 d5 c4 dxc4', "Queen's Gambit Accepted"],
  ['d4 d5 c4', "Queen's Gambit"],
  ['d4 d5 Bf4', 'London System'],
  ['d4 d5 Nf3 Nf6 Bf4', 'London System'],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'Nimzo-Indian Defence'],
  ['d4 Nf6 c4 g6 Nc3 d5', 'Grünfeld Defence'],
  ['d4 Nf6 c4 g6', "King's Indian Defence"],
  ['d4 Nf6 c4 e6', 'Indian Game'],
  ['d4 Nf6 Bf4', 'London System'],
  ['d4 Nf6 Nf3 e6 Bf4', 'London System'],
  ['d4 Nf6', 'Indian Game'],
  ['d4 f5', 'Dutch Defence'],
  ['d4 d5', "Queen's Pawn Game"],
  ['d4', "Queen's Pawn Opening"],
  // flank
  ['c4', 'English Opening'],
  ['Nf3 d5 g3', 'Réti / King’s Indian Attack'],
  ['Nf3', 'Réti Opening'],
  ['f4', "Bird's Opening"],
  ['b3', 'Nimzo-Larsen Attack'],
  ['g3', "King's Fianchetto Opening"],
].map(([line, name]) => ({ moves: line.split(' '), name }));

// Longest matching book line for a game's SAN history (or null).
export function nameOpening(sans) {
  let best = null;
  for (const o of BOOK) {
    if (o.moves.length > sans.length) continue;
    if (o.moves.every((m, i) => m === sans[i])) {
      if (!best || o.moves.length > best.moves.length) best = o;
    }
  }
  return best ? best.name : null;
}

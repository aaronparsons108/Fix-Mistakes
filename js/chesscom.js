// chess.com public API client (https://api.chess.com/pub — CORS-enabled, no auth).

const API = 'https://api.chess.com/pub';

const LOSS_RESULTS = new Set(['checkmated', 'timeout', 'resigned', 'abandoned', 'lose']);

const REASON_LABEL = {
  checkmated: 'checkmated',
  timeout: 'lost on time',
  resigned: 'resigned',
  abandoned: 'abandoned',
  lose: 'lost',
};

async function getJSON(url) {
  const res = await fetch(url);
  if (res.status === 404) throw Object.assign(new Error('not found'), { code: 404 });
  if (!res.ok) throw new Error(`chess.com API error (${res.status})`);
  return res.json();
}

export async function fetchPlayer(username) {
  return getJSON(`${API}/player/${encodeURIComponent(username.toLowerCase())}`);
}

// A lazily-paginated feed of the player's recent games (any result), newest
// first. .page(p) fetches just enough archives to return that page of `size`.
export async function openGameFeed(username, { size = 5 } = {}) {
  const user = username.toLowerCase();
  const { archives } = await getJSON(`${API}/player/${encodeURIComponent(user)}/games/archives`);
  const months = (archives || []).slice().reverse(); // newest month first
  let mi = 0;
  const buffer = [];
  async function fillTo(n) {
    while (buffer.length < n && mi < months.length) {
      const { games } = await getJSON(months[mi++]);
      for (const g of (games || []).slice().reverse()) {
        const nm = normalizeGame(g, user);
        if (nm) buffer.push(nm);
      }
    }
  }
  return {
    size,
    async page(p) { await fillTo((p + 1) * size + 1); return buffer.slice(p * size, p * size + size); },
    hasMore(p) { return buffer.length > (p + 1) * size || mi < months.length; },
  };
}

// Fetch the player's recent losses (standard chess only), newest first.
export async function fetchLostGames(username, { maxGames = 24, maxArchives = 6 } = {}) {
  const user = username.toLowerCase();
  const { archives } = await getJSON(`${API}/player/${encodeURIComponent(user)}/games/archives`);
  if (!archives || archives.length === 0) return [];

  const losses = [];
  const recent = archives.slice(-maxArchives).reverse(); // newest month first
  for (const url of recent) {
    const { games } = await getJSON(url);
    for (const g of (games || []).slice().reverse()) {
      const norm = normalizeGame(g, user);
      if (norm && norm.isLoss) losses.push(norm);
    }
    if (losses.length >= maxGames) break;
  }
  return losses.slice(0, maxGames);
}

function normalizeGame(g, user) {
  if (!g.pgn || (g.rules && g.rules !== 'chess')) return null;
  const isWhite = g.white?.username?.toLowerCase() === user;
  const isBlack = g.black?.username?.toLowerCase() === user;
  if (!isWhite && !isBlack) return null;
  const me = isWhite ? g.white : g.black;
  const opp = isWhite ? g.black : g.white;
  return {
    pgn: g.pgn,
    url: g.url,
    endTime: g.end_time ? new Date(g.end_time * 1000) : null,
    timeClass: g.time_class || '?',
    rated: !!g.rated,
    userColor: isWhite ? 'w' : 'b',
    userRating: me.rating,
    opponent: opp.username,
    opponentRating: opp.rating,
    resultReason: REASON_LABEL[me.result] || me.result,
    isLoss: LOSS_RESULTS.has(me.result),
    result: me.result === 'win' ? 'won' : LOSS_RESULTS.has(me.result) ? 'lost' : 'draw',
  };
}

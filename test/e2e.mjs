// Headless end-to-end test: serves the site, mocks the chess.com API, and
// drives the full flow — landing → game picker → real Stockfish analysis in a
// Worker → quiz (best move, wrong move + retry, "I don't know") → summary.
//   node test/e2e.mjs
// Requires playwright (+ chromium) installed locally or globally.

import { createRequire } from 'module';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}

const PORT = 8123;
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const PGN = `[Event "Live Chess"]
[Site "Chess.com"]
[White "testuser"]
[Black "trickster"]
[Result "0-1"]

1. e4 {[%clk 0:09:58]} e5 {[%clk 0:09:57]} 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5
5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1`;

const FIXTURES = {
  '/pub/player/testuser': { username: 'testuser', player_id: 1 },
  '/pub/player/testuser/games/archives': {
    archives: ['https://api.chess.com/pub/player/testuser/games/2026/06'],
  },
  '/pub/player/testuser/games/2026/06': {
    games: [{
      url: 'https://www.chess.com/game/live/1',
      pgn: PGN,
      time_class: 'blitz',
      rated: true,
      rules: 'chess',
      end_time: 1750000000,
      white: { username: 'testuser', rating: 812, result: 'checkmated' },
      black: { username: 'trickster', rating: 945, result: 'win' },
    }],
  },
};

function clickSquare(page, board, sq) {
  // white orientation: a1 bottom-left
  return board.boundingBox().then((bb) => {
    const f = sq.charCodeAt(0) - 97;
    const r = 8 - parseInt(sq[1], 10);
    return page.mouse.click(bb.x + ((f + 0.5) / 8) * bb.width, bb.y + ((r + 0.5) / 8) * bb.height);
  });
}

const server = spawn('npx', ['http-server', '-p', String(PORT), '-s'], { stdio: 'ignore' });
const errors = [];
let failed = false;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}`);
  if (!cond) failed = true;
};

try {
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.route('**/api.chess.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = FIXTURES[path];
    if (body) route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
    else route.fulfill({ status: 404, json: { message: 'not found' } });
  });
  // fonts are non-essential; don't let them stall the test
  await page.route('**/fonts.googleapis.com/**', (r) =>
    r.fulfill({ contentType: 'text/css', body: '' }));

  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.screenshot({ path: SHOTS + '1-landing.png' });

  await page.fill('#username-input', 'testuser');
  await page.click('#btn-analyze');
  await page.waitForSelector('#screen-games.active', { timeout: 15000 });
  await page.waitForSelector('.game-card');
  await page.screenshot({ path: SHOTS + '2-games.png' });
  check(true, 'game picker shows fetched losses');

  await page.click('.game-card');
  await page.waitForSelector('#screen-loading.active', { timeout: 10000 });
  await page.screenshot({ path: SHOTS + '3-loading.png' });

  // real Stockfish analysis in the worker
  await page.waitForSelector('#screen-quiz.active', { timeout: 120000 });
  check(true, 'analysis completed and quiz started');
  await page.waitForTimeout(1800); // opponent's previous move animates in
  await page.screenshot({ path: SHOTS + '4-quiz.png' });

  const board = page.locator('#board');
  check(await page.locator('.board-arrow.played').count() === 1, 'red arrow marks the game move');

  // Puzzle 1: best move is Nxd4 (f3 -> d4)
  await clickSquare(page, board, 'f3');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '5-selected.png' });
  await clickSquare(page, board, 'd4');
  await page.waitForSelector('.feedback.ok', { timeout: 30000 });
  check(await page.locator('.board-arrow').count() === 0, 'arrow clears once you move');
  const fb1 = await page.textContent('#feedback');
  check(/BEST/.test(fb1) && /Nxd4/.test(fb1), `best move recognized ("${fb1.slice(0, 60)}…")`);
  await page.screenshot({ path: SHOTS + '6-correct.png' });

  // ← lets you retry even after solving; the score (pips) must not change
  const pipsBefore = await page.locator('.pip.done, .pip.current').evaluateAll((els) =>
    els.map((e) => e.className).join('|'));
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  const replayable = await page.evaluate(() =>
    document.querySelector('[data-val="you"]').textContent === '—' && // graph reset for a fresh try
    document.querySelectorAll('.board-arrow.played').length === 1);    // puzzle restored
  check(replayable, 'left arrow retries even after a correct answer');
  await clickSquare(page, board, 'f3');
  await page.waitForTimeout(200);
  await clickSquare(page, board, 'd4');
  await page.waitForSelector('.feedback.ok', { timeout: 30000 });
  const pipsAfter = await page.locator('.pip.done, .pip.current').evaluateAll((els) =>
    els.map((e) => e.className).join('|'));
  check(pipsBefore === pipsAfter, 'replaying a solved puzzle does not re-score it');

  // advance to puzzle 2 of N via the Next button (no auto-advance)
  const total = parseInt((await page.textContent('#puzzle-counter')).match(/\/\s*(\d+)/)[1], 10);
  console.log(`     (analysis found ${total} critical moments)`);
  await page.keyboard.press('ArrowRight'); // → advances like the Next button
  await page.waitForFunction(
    () => document.getElementById('puzzle-counter').textContent.includes('2/'),
    { timeout: 20000 }
  );
  await page.waitForTimeout(2500);

  // Puzzle 2: use a hint, then deliberately play a bad move (a2-a3)
  await page.click('#btn-hint');
  await page.waitForSelector('.square.hint-glow', { timeout: 5000 });
  await clickSquare(page, board, 'a2');
  await page.waitForTimeout(250);
  await clickSquare(page, board, 'a3');
  await page.waitForSelector('.feedback.bad', { timeout: 30000 });
  check(true, 'bad move detected, retry offered');
  const youBar = await page.evaluate(() => {
    const bar = document.querySelector('[data-bar="you"]');
    return { width: parseFloat(bar.style.width), val: document.querySelector('[data-val="you"]').textContent };
  });
  check(youBar.width > 0 && youBar.val !== '—', `eval graph shows the attempt (width ${youBar.width}%, ${youBar.val})`);
  await page.screenshot({ path: SHOTS + '7-wrong.png' });
  await page.waitForTimeout(1500); // board auto-resets
  const glowPersists = await page.locator('.square.hint-glow').count();
  check(glowPersists >= 1, 'hint highlight persists through a wrong move');
  await page.keyboard.press('ArrowLeft'); // ← resets immediately for another try
  await page.waitForTimeout(600);

  // give up: "I don't know" should reveal Bxf7+ and advance
  await page.click('#btn-idk');
  await page.waitForSelector('.feedback.info', { timeout: 15000 });
  const fb2 = await page.textContent('#feedback');
  check(/Bxf7\+/.test(fb2), `reveal shows the best move ("${fb2.slice(0, 60)}…")`);
  await page.screenshot({ path: SHOTS + '8-reveal.png' });
  await page.click('#btn-next');

  // burn through any remaining puzzles with "I don't know"
  for (let p = 3; p <= total; p++) {
    await page.waitForFunction(
      (n) => document.getElementById('puzzle-counter').textContent.includes(`${n}/`),
      p, { timeout: 20000 }
    );
    await page.waitForTimeout(2500);
    await page.click('#btn-idk');
    await page.waitForSelector('.feedback.info', { timeout: 15000 });
    await page.click('#btn-next');
  }

  await page.waitForSelector('#screen-summary.active', { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: SHOTS + '9-summary.png' });
  const summary = await page.textContent('#stats-row');
  check(/1/.test(summary), 'summary shows stats');

  await browser.close();
} catch (e) {
  failed = true;
  console.error('E2E FAILED:', e.message);
} finally {
  server.kill();
}

const realErrors = errors.filter((e) => !/favicon|fonts/.test(e));
if (realErrors.length) {
  failed = true;
  console.log('Browser errors:');
  realErrors.forEach((e) => console.log('  ' + e));
}
console.log(failed ? 'E2E: FAILED' : 'E2E: ALL CHECKS PASSED');
process.exit(failed ? 1 : 0);

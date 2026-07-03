# ♟ Revise My Chess — *the cabin*

A dark wooden cabin, lit by guttering candles. Across a floating board sits a
giant pawn with two big eyes. He asks for your **chess.com** name and then puts
you through four things — all on a real **3D board**, with **Stockfish**
(WebAssembly, in a Web Worker — nothing leaves your machine) doing the thinking.

A WebGL homage to *Inscryption*'s Act 1, built on a chess trainer.

![the cabin](test/shots/cabin-1-boot.png)

## The four modes

At the start you pick a track — **Study Games** or **Mental Challenges** — and
give your chess.com name. From then on a **☰ modes** button (top-right) lets you
hop straight between any of the four modes:

**Study Games** (needs one of your real games):
- **⚔ Fix Mistakes** — Stockfish finds where the game went wrong; for each
  blunder the board replays up to the moment and you must find the move you
  *should* have played. Each mistake is a collectible **card** (a 2D diagram
  with a red arrow for what you played); solve it and a green best-move arrow is
  added and the card flies into a **chest** at the back of the room. A live eval
  bar, the game notation, and best/played/yours evals sit alongside. **←** steps
  back to the previous position (the card lifts back out of the chest); **→**
  advances.
- **📖 Simple Review** — step through the whole game with the arrow keys, branch
  off by dragging a piece (chess.com-style variations), with a live eval bar.

**Mental Challenges** (the pawn plays at your rating, via Stockfish Skill Level):
- **🌀 Board Shaker** — memorise a position, the pawn flings the board with a
  tumbling animation, then you rebuild it one piece at a time. One wrong
  placement loses instantly.
- **🩸 Blindfolded** — the pawn reaches forward with a mask; the pieces vanish
  (the board stays normal) and you play a full game from memory, seeing only the
  last move as highlighted squares. A **peek (1s)** button flashes the pieces —
  but the pawn calls you a cheater.

Evals are reproducible: searches use a fixed **node budget** (not a wall-clock
budget), so the same position always scores the same instead of drifting.

![fix mistakes](test/shots/cabin-3-quiz.png)

## Running / deploying

A fully **static** site — no build step, no backend. Any static host works
(GitHub Pages, Netlify, a plain file server). It just needs to be *served* (the
Stockfish worker + ES modules won't run from `file://`), and `.wasm` served as
`application/wasm`:

```bash
python serve.py            # or: npx http-server -p 8080
# then open http://127.0.0.1:8080
```

`serve.py` sends correct MIME types and no-cache headers for local dev. Deep
link: `?user=yourname` pre-fills the name. The only network calls are to the
public chess.com API (CORS-enabled, no key) for your games.

## Tech

- **No build step, no framework, no backend.** Vanilla ES modules + WebGL.
- `lib/three/` — Three.js r184 (core ESM) + the GLTFLoader addon, used to
  build the scene (candlelit cabin, table, the pawn host, parchment) and to
  load the chess pieces. Vendored **pre-minified** (three.core.min.js /
  three.module.js / the addon files, all official/esbuild output — same
  source, same MIT license, just smaller) since this is the largest chunk of
  the critical-path JS; `index.html` also `modulepreload`s the deep parts of
  the import graph (three.core, GLTFLoader + its two utils, chess.js) and
  `preload`s the piece models + first-paint fonts, so a slow connection
  doesn't wait through a multi-hop ES-module discovery waterfall on top of the
  download itself.
- `assets/models/*.glb` — the chess piece models, loaded with GLTFLoader and
  painted ivory/dark at runtime. Source: github.com/ordamari/3d-chess (see
  `assets/models/SOURCE.txt`; the upstream repo has no explicit license, so
  treat these as placeholder art and swap if you need a specific license).
- `lib/stockfish.*` — Stockfish 10 (WASM, asm.js fallback) in a Web Worker.
- `lib/chess.js` — move generation / PGN parsing.
- `assets/fonts/` — self-hosted *IM Fell English* (old serif) + *Special Elite*
  (typewriter) for the cabin's UI.

### Module map

```
js/app.js      flow state machine (START → the four modes) + judging/scoring +
               the window.__rmc test hook that drives everything headlessly
js/scene.js    renderer, camera, brick-tower room, candle/torch lights, vignette
js/board3d.js  the 3D board: square↔world map, raycast input, move/highlight anim,
               piece-hiding (blindfold) + fling/place helpers (board shaker)
js/pieces.js   the chess piece models (GLTF), painted ivory/dark at runtime
js/host.js     the pawn host: bob, blink, gaze, lean, brow reactions
js/paper.js    the parchment: game list, slide-in, raycast row-pick, pager
js/cards.js    the mistake-card deck + the chest (2D diagram cards, fling-to-chest)
js/flipbutton.js  the wired 3D "FLIP" button
js/openings.js the opening book (longest-prefix match on SAN)
js/store.js    localStorage (remembered name, chest tally, shaker level) + mistake tagging
js/ui.js       thin HTML overlays: typewriter speech + 8-bit voice, sparkles, promotion
js/tween.js    promise-based rAF tweens (FAST flag for deterministic tests)
js/chesscom.js / engine.js / analysis.js / sound.js   API, Stockfish, analysis, synth
```

The pieces and board live entirely in WebGL (no DOM squares), so the automated
test drives the app through a small `window.__rmc` hook (submitUsername,
pickGame, playMove, squareToClient, reveal, next…), with one real raycast
click to verify pointer→square mapping under the 3D camera.

## Tests

```bash
node test/smoke.mjs   # analysis pipeline against real Stockfish (Node)
node test/e2e.mjs     # full cabin flow in headless WebGL via Playwright
```

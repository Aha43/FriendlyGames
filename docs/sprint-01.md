# Sprint 1 — A table worth returning to

## Result

A responsive, locally playable chess page that lets the owner judge the park
atmosphere, piece recognition, interaction and shared-history presentation.
This sprint does not deliver cross-device play; that is Sprint 2.

## Ordered issue outlines

### 1. Establish the runnable frontend and checks

- Scaffold React, TypeScript and Vite with a minimal dependency set.
- Document install, development, build and verification commands.
- Add lockfile and CI for lint, type checking, focused tests and production build.
- Start cleanly from a fresh checkout using documented commands.

### 2. Create the autumn park table

- Build the playing page with readable board, distinct pieces, player names and
  turn indicator, plus an autumn backdrop.
- Include clearly labeled sample completed games and a sample tally.
- Inspect desktop and phone layouts; no horizontal overflow or obscured board.
- Record artwork source and usage rights for any external or generated assets.

### 3. Make the local chess table playable

- Use an established chess rules library after checking its license and API.
- Support legal local moves, promotion, castling and en passant.
- Reject illegal moves and display check, checkmate and supported draw outcomes.
- Make selection and moves usable by touch and keyboard.
- Allow a new local game and retain the current game across a refresh.
- Verify rule integration and inspect the complete playing experience.

## Review

Codex reviews each implementation PR. The owner judges the integrated visual and
playing experience before closing the sprint. Any sample results remain visibly
distinct from real results.

## Next sprint — Across the table from Harald

Specify onboarding and device identity, joining a game, backend rules validation,
atomic persistence, turn refresh, finished-game history and hosting. Acceptance
must include two separate browser sessions making moves, refreshing and resuming
the same game. Do not count mocked backend journeys alone as proof of shared play.

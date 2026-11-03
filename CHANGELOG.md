# Changelog

Changes accumulate here before an owner-authorised versioned release. Source
versions live in `package.json`; actual deployments are recorded separately in
[docs/deployment.md](docs/deployment.md).

## Unreleased

### Development

- Proof of the Chess960 rules engine and saved format: chessops for Chess960 (not yet
  shipped), fixtures run in Node, the browser, Deno and the Supabase Edge runtime, and a
  decision record with the licence and publication proposal (#52).
- Game-type boundary: the server picks a rules adapter by each game's stored type and
  version, and clients say which types they can show (`types`). Standard chess is still
  the only type and plays exactly as before; a game a client cannot show is explained
  instead of being drawn as chess (#53).
- Fischer Random (Chess960) on the server: a fair random start saved once per game, explicit
  castling, all chess outcomes, retries, history per type and "Play again". Not selectable in
  the app yet (#55); clients that read only chess never see these games (#54).

## v0.1.2 — Captured pieces at a glance (2026-11-03)

Sprint 4. The release date is when this version was prepared; the `v0.1.2` tag marks the
accepted commit.

### Added

- Each player's plate shows the pieces they have captured, "Captured by White" and
  "Captured by Black", on a light strip so both colours stand out against the wood. This
  works in shared and local games and when reviewing a finished game. Existing games show
  their captures straight away, from their saved moves (#44, PR #47).

### Development

- Sprint 4 plan and the v0.1.2 milestone (#43, PR #46).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- The lobby says "1 moves" for a single move.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## v0.1.1 — Correct starts and repeatable development (2026-11-01)

Sprint 3. The release date is when this version was prepared; the `v0.1.1` tag marks the
accepted commit.

### Changed

- The player who creates a game can make the opening move before their friend joins;
  the friend finds it waiting and replies. Previously the board stayed locked until the
  friend joined, which looked as if Black moved first (#33, PR #39).

### Development

- `make` commands for local work, checks, backups, deploying the backend and production
  status; CI runs the same commands. Backups now keep only complete dumps (#32, PR #40).
- A PR check requires exactly one primary `Closes #N` for an issue with a version
  milestone (#36, PR #41).
- Versioned milestones, ordered sprints, issue/PR tracking and the human command
  contract (#31, PR #35).

### Known limitations

- Email entry is prototype access: email ownership isn't checked.
- The lobby says "1 moves" for a single move.
- The first real game with Harald is still being played, so the v0.1.0 acceptance (#11)
  stays open.

## Existing prototype baseline

The existing source version is 0.1.0. The deployed chess prototype includes shared
play, history and email entry across browsers. See the dated deployment record
for commits and evidence; this section does not invent a historical version tag
or completed first-game acceptance.

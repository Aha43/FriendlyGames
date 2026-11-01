# Changelog

Changes accumulate here before an owner-authorised versioned release. Source
versions live in `package.json`; actual deployments are recorded separately in
[docs/deployment.md](docs/deployment.md).

## Unreleased

### Changed

- The player who creates a game can make the opening move before their friend joins;
  the friend finds it waiting and replies. Previously the board stayed locked until the
  friend joined, which looked as if Black moved first (#33).

### Development

- A PR check requires exactly one primary `Closes #N` for an issue with a version
  milestone (#36).
- `make` commands for local work, checks, backups, deploying the backend and production
  status; CI runs the same commands. Backups now keep only complete dumps (#32).
- Define versioned milestones, ordered sprints, issue/PR tracking and the human
  command contract for Claude's Makefile implementation (#31).

## Existing prototype baseline

The existing source version is 0.1.0. The deployed chess prototype includes shared
play, history and email entry across browsers. See the dated deployment record
for commits and evidence; this section does not invent a historical version tag
or completed first-game acceptance.

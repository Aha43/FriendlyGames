# Deployment

FriendlyGames runs as a static site on a **Cloudflare Worker** (static assets only, configured
in `wrangler.jsonc`) that calls the `game-api` **Supabase Edge Function**, which owns a hosted
**Supabase Postgres** database. Cloudflare now recommends Workers over Pages for new projects
("Start new projects with Workers", developers.cloudflare.com/pages); NamWeb still uses Pages,
and its `docs/ops/go-live-playbook.md` remains useful for the Supabase side.

```
browser ──HTTPS──▶ friendlygames.<subdomain>.workers.dev (Cloudflare Worker, static dist/)
   │
   └──HTTPS──▶ <ref>.supabase.co/functions/v1/game-api ──▶ Postgres (same project)
```

## Environments

| | Site | API | Database |
|---|---|---|---|
| Local | `npm run dev` (5173) | `supabase start` (56321) | local container, reset freely |
| Production | Cloudflare Worker, built from `main` | hosted Edge Function (Frankfurt) | hosted Postgres (Frankfurt) |
| Worker previews (other branches, if enabled) | their own preview URL | production API, but **blocked by CORS** | — |

There is no staging backend. Preview deployments show the UI and local play only: the
production API allows browser calls from the production origin alone, so a preview cannot
read or write real games.

## Configuration and secrets

Nothing secret is in the repository.

| Name | Where | Value |
|---|---|---|
| `VITE_GAME_API_URL` | Worker → Settings → Build → **Build variables and secrets** (build-time; Workers keeps these separate from runtime variables) | `https://<ref>.supabase.co/functions/v1/game-api` (public by design: it is in the bundle) |
| `NODE_VERSION` | Worker build variables | `24` |
| `ALLOWED_ORIGINS` | Supabase function secret (set by the deploy script) | the site origin, e.g. `https://friendlygames.<subdomain>.workers.dev` |
| `GAME_API_COMMIT` | Supabase function secret (set by the deploy script) | deployed commit, reported by `GET /health` |
| `GAME_DB_POOLER_URL` | Supabase function secret, **set by the owner** (contains the database password) | the pooler in transaction mode: `postgresql://postgres.<ref>:<password>@aws-1-eu-central-1.pooler.supabase.com:6543/postgres` |
| `SUPABASE_DB_URL` | provided by Supabase to functions | used only locally and in CI; production uses the pooler |
| Database password | owner's password manager | set at project creation; `supabase link` asks for it |
| Supabase access token | Supabase CLI login on the owner's machine (`supabase login`) | never in the repo or CI |
| `GAME_API_HEALTH_URL` | GitHub → repository **variable** (optional) | `https://<ref>.supabase.co/functions/v1/game-api/health`; enables the daily keep-alive |

Never add `[edge_runtime.secrets]` to `supabase/config.toml`: `supabase secrets set` uploads
them to the hosted project as well (this broke the first deploy; see docs/backend.md).

## First-time setup (owner)

These create accounts' resources and need the owner's credentials. Claude prepares and
verifies; the owner performs or authorises each step.

1. **Supabase project:** dashboard → New project in the owner's organisation. Name
   `friendlygames`, an EU region (the project was created in **Central EU, Frankfurt**), a
   strong database password (save it), *Enable automatic RLS* on. Plan: see "Plan and limits".
2. **CLI login and link**, in a terminal at the repository root:
   ```bash
   supabase login
   supabase link --project-ref <ref>
   ```
3. **Database connection secret** (owner, in a terminal at the repository root). The command
   asks for the database password without echoing it, URL-encodes it and keeps it out of the
   shell history:
   ```bash
   PW=$(python3 -c 'import getpass, urllib.parse; print(urllib.parse.quote(getpass.getpass("Database password: "), safe=""))') && supabase secrets set "GAME_DB_POOLER_URL=postgresql://postgres.<ref>:${PW}@aws-1-eu-central-1.pooler.supabase.com:6543/postgres" --project-ref <ref>; unset PW
   ```
   Check the pooler host in the dashboard (Connect → Transaction pooler) if the region differs.
4. **Backend deploy** from an up-to-date, clean `main`:
   ```bash
   make deploy-backend   # site origin defaults to the live site; SITE_ORIGIN=… make deploy-backend overrides
   ```
5. **Cloudflare Worker:** Workers & Pages → Create → *Import a repository* → GitHub →
   `Aha43/FriendlyGames` (grant the Cloudflare GitHub app access to this private repository
   under GitHub → Settings → Applications → Installed GitHub Apps → Configure; the repository
   stays private). Worker name `friendlygames` (must match `wrangler.jsonc`), build command
   `npm run build`, deploy command `npx wrangler deploy` (the default), build variables from
   the table above. Under Settings → Build → Branch control the production branch is `main`.
6. If the `workers.dev` address differs from the `SITE_ORIGIN` used in step 3, update it:
   `supabase secrets set ALLOWED_ORIGINS=<site origin> --project-ref <ref>`.
7. **Verify** (below), then record the deployment.

## Releasing a change

Merging to `main` makes Workers Builds build and publish the site automatically. Backend
changes are deliberate:

1. Keep migrations and API changes **backward compatible** with the site already live (add,
   don't rename or remove in the same step), because the site and backend deploy separately.
2. After merging a PR that touches `supabase/`, run `make deploy-backend` from `main`. It
   first runs the read-only player-name check (`make prod-name-check`, #76) and stops before any
   backup, migration, secret or function change if names collide or the check cannot complete.
3. Run the smoke check and the deployed journeys (below).

### Unique player names (#76): preflight and order

Before deploying the #76 backend, run `make prod-name-check` on the owner's Mac. It runs
`scripts/name-check.sql` on the linked project through `supabase db query --linked` (Supabase
CLI 2.x with `db query`; it uses the existing `supabase login`, no database password), inside a
read-only transaction with a 15 s limit, and prints only player IDs, stored names, game counts and
creation dates. Exit 0 means a read-only check found no collisions; 1 means collisions (listed);
2 means the check could not complete, which is never "clear". If names collide, decide what to
do with each (docs/backend.md, "Unique player names") and run it again; nothing is changed
automatically. Then `make deploy-backend` (which runs the same check again) applies the
migration. The site needs no particular order: old and new pages both work with either backend.
Rollback: the index can be dropped without data loss; no names were rewritten.

### Email entry (#29): order and rollback

The migration (`20261101120000_player_credentials.sql`) only adds: a `player_credentials`
table filled with every existing credential hash, and a trigger that copies the credential of
any player the previous function version creates. `players.credential_hash` stays. So every
browser keeps working through the release, whichever versions are serving.

1. Merge the PR: the site deploys by itself. Run `make deploy-backend` from `main` right
   away. Until it finishes (a few minutes), a browser that has no player yet can't get past
   the email step (the old backend requires a name); browsers that remember a player are
   unaffected. The old site against the new backend works as before.
2. Verify: `/health` reports the new commit; an existing browser still opens its games;
   entering the same email in a private window opens the same player.

Rollback: roll back the site **and** the function together. The old function authenticates
with `players.credential_hash`, so each player's first browser keeps working; browsers added
by email entry stop working until the new version is redeployed. Leave the
migration in place (forward-only; harmless to the old version).

### Releasing a version

A release PR bumps `package.json`/`package-lock.json` and moves the changelog's
`Unreleased` entries into a dated version section, `## vX.Y.Z — <title> (YYYY-MM-DD)`
(docs/roadmap.md). After the owner merges it and any backend deploy is done, the owner runs:

```bash
git checkout main && git pull --ff-only
make release
```

`make release` (`scripts/release.ts`, #49) publishes; it does not deploy, bump versions,
edit the changelog or close milestones, and nothing else runs it (help, setup, verify, CI and
deploys never do). Running it is the owner's decision to publish; it asks nothing further.

1. **Preflight, no writes.** A full (not shallow) clone; clean `main` (untracked files count)
   equal to a fresh `origin/main`; `package.json`, `package-lock.json` and a dated changelog section agree on the
   version. The **release commit** is the commit on main's first-parent history where
   `package.json`'s version changed to this version, not the latest commit touching the file,
   so later documentation commits (such as the deployment record) are fine. More than one such
   commit is refused as ambiguous. It checks `gh auth status`, then the local tag, the tag on
   origin and the GitHub release: each must be absent or exactly match (same commit, annotated,
   message `vX.Y.Z — <title>`, same title and notes). A conflict, or a lookup that fails, stops
   it: a network or login failure is never taken to mean "absent". Finally it shows
   `make prod-status`, which fails if the site does not answer HTTP 200 or the backend is down
   or reports its database not ok; that stops the release.
2. **Publication, only the missing steps.** An annotated tag on the release commit, pushed to
   origin, then `gh release create vX.Y.Z --verify-tag` with the title and notes from that
   commit's changelog section (a notes file; no release text passes through a shell).
3. **If something fails part-way.** Tags and releases are external: nothing is rolled back, and
   a tag is never moved or deleted, a release never overwritten. After a failed push or release
   request it asks origin or GitHub again and reports what is confirmed (for example "the tag is
   on origin; GitHub has no release for it") or unknown. Fix the cause and run `make release`
   again: it reuses the existing tag and only creates what is missing, never a second release.
   If the exact tag and release already exist, it says so and does nothing.

The live site is built by Workers Builds on merge and may be a later commit than the release;
`make release` shows production status but does not prove the site equals the release. Then,
by hand: add the version to "Deployed versions" below with the site and backend commits
`make prod-status` reported, and close the milestone after owner acceptance.

## Verifying a deployment

```bash
make prod-status     # live site, and the backend's deployed commit, database and pooler status
make prod-e2e        # the browser journeys against the live site (writes test players)
```

`make prod-status` is read-only; it also prints your local commit separately, for
comparison. Both take the API address from the linked project (`supabase/.temp/project-ref`);
set `FG_API_URL` / `SITE_ORIGIN` to override.

The journeys onboard fresh test players (emails `…@example.test`) in two independent browser
contexts, create and join a game, exchange moves, refresh, recover from a lost response,
finish, rematch and read the history, on desktop and phone profiles. They create real rows
in production, owned by those throwaway players; they never touch real players' games or
history. The footer shows the site's build commit.

## Database connection

Edge Functions run as many short-lived instances. Connected directly, each instance opened its
own Postgres connections, and under load the free database ran out of slots ("remaining
connection slots are reserved for roles with the SUPERUSER attribute", during the first
deployed test run). Production therefore connects through Supabase's pooler in transaction mode
(`GAME_DB_POOLER_URL`), and each instance keeps at most 2 connections, closing them after 10 s
idle. The function accepts only the transaction pooler (host `*.pooler.supabase.com`, port
6543); a session-pooler or direct URL (port 5432) stops it at start-up with an error that does
not repeat the URL. `GET /health` reports `"pooled": true` only for a validated pooler, and the
deploy script refuses to deploy without the secret and requires that flag.

## Rollback

- **Site:** the Worker → Deployments → choose the previous version → *Rollback* (or
  `npx wrangler rollback`).
- **Function:** check out the previous good commit on a branch and run
  `supabase functions deploy game-api --project-ref <ref> --no-verify-jwt` (and
  `supabase secrets set GAME_API_COMMIT=<sha>`), then return to `main`.
- **Database:** migrations are forward-only. Fix forward with a new migration. If data was
  damaged, restore from the dump the deploy script wrote to `backups/` (git-ignored, contains
  private emails; keep it on the owner's machine).

## Plan and limits

- **Free plan:** pauses after about 7 days without activity and has no point-in-time
  recovery. The optional `Keep backend awake` workflow pings `/health` daily once
  `GAME_API_HEALTH_URL` is set; the deploy script's dumps are the backup. Check the free
  plan's active-project limit against the owner's existing projects (NamWeb).
- **Pro plan** (paid) removes pausing and adds daily backups.
- No rate limiting, and email entry trusts whoever types an email (prototype decision #29,
  docs/backend.md): anyone with the site address and a player's email can play as them.
  Fine for a friends-only prototype; don't share the address widely.

## Deployed versions

| Date (UTC) | Site commit | Backend commit | Notes |
|---|---|---|---|
| 2026-10-18 | `025ff34` | `025ff34` | First production deployment (#11). Site: `https://friendlygames.arne-halvorsen.workers.dev` (Worker `friendlygames`, built by Workers Builds from `main`). Backend: Supabase project `friendlygames` (ref `hxiwclhyxisoqpljrytw`, Central EU / Frankfurt, Free plan, keep-alive on), reached through the transaction pooler. |
| 2026-11-01 | `7da615c` | `7da615c` | One player per email (#27, #28). Before the migration, two unused duplicate test players (`92fc3f7d`, `acd55ac5`) had their email detached after an owner-approved backup and review; no players, games or history were deleted. |
| 2026-11-01 | `2f58dcd` | `2f58dcd` | Email entry from any browser (#29, #30): `player_credentials` migration; existing browsers kept working. Prototype: email ownership isn't checked. Owner verified existing browsers and email entry from a private window. |
| 2026-11-01 | `5c8b481` | `5c8b481` | Opening while waiting (#33, #39): function only, no migration. The owner deployed the backend after the merge and reported it done (the deploy script only finishes when `/health` reports that commit with the pooler), then played a saved opening (d4) in the waiting game with Harald. The site was later rebuilt from `8a5c7ee` (#40) and `2e1eeef` (#41); those changed only tooling and docs, not the app. |
| 2026-11-03 | `4d01874` | `5c8b481` | **v0.1.1** (tag `v0.1.1` → `62b1bcd`; GitHub release by the owner). `make prod-status` on the owner's Mac (the first `make` run on macOS): backend `5c8b481`, database ok, pooler yes. The site had been rebuilt from `62b1bcd` and `4d01874` (version and docs only); the app is unchanged since `5c8b481`. |
| 2026-11-03 | `18cde1f` | `5c8b481` | Captured pieces (#44, #47): frontend only, published by Workers Builds on merge (build succeeded). The backend was not redeployed: `game-api` and migrations are unchanged since `5c8b481`; `_shared/chess` only gained an unused helper. The owner confirmed the captured pieces in the ongoing game with Harald. |
| 2026-11-03 | `26793e4` | `5c8b481` | **v0.1.2** (tag `v0.1.2` → `26793e4`, annotated; GitHub release by the owner). Release PR #48 merged by owner decision with the Cloudflare preview check red: that build never started ("failed to initialize"), and all repository checks passed. Workers Builds then published `26793e4` to the live site. Backend not redeployed: `5c8b481`, healthy and pooled, per Codex's post-release audit. |
| before 2026-11-07 | (per merge) | `bfbbe4f` | Game-type dispatcher (#53, PR #59): function only, no migration. Deployed by the owner after the merge but not recorded at the time; Codex's read-only `make prod-status` on 2026-11-07 reported backend `bfbbe4f`, healthy and pooled. From here the supported backend rollback limit is this dispatcher. |
| 2026-11-07 | `0de954c` → `cf028f4` | `f81cf02` | **Fischer Random** (#54 backend, #55 site). Backend first: the owner ran `make deploy-backend` from `main` at `f81cf02`: complete backup `backups/20261107T155804Z-{schema,data}.sql`, additive migration `20261104120000_chess960_games.sql`, function deployed, health `{"ok":true,"commit":"f81cf02…","pooled":true}`; `make prod-status`: backend `f81cf02`, database ok, pooler yes. The owner then opened the ongoing game with Harald on the live site: board and captured pieces intact. Only then was #55 merged (`0de954c`); Workers Builds published it, then `cf028f4` (#66, tooling and docs only: no `src/`, `public/` or dependency change). The live footer read "Build cf028f4" on 2026-11-07, with the source link. The backend is unchanged since `f81cf02` (no `supabase/` change through `cf028f4`). No production-writing smoke test was run (`make prod-e2e` needs owner authorization). Rollback: the site can return to a pre-#55 build (it asks for chess only and never sees Fischer Random games); the backend must stay at the #53 dispatcher or later once Fischer Random games exist. |
| 2026-11-08 | `2613fec` | `f81cf02` | **v0.2.0** (annotated tag `v0.2.0` → `2613fec`, message "v0.2.0 — Chess and Fischer Random"; [GitHub release](https://github.com/Aha43/FriendlyGames/releases/tag/v0.2.0) published 2026-11-08 10:38 UTC), the first published through owner-run `make release` (#49). Release PR #68 (#56) merged by the owner; Workers Builds published `2613fec` (version and docs only: no `src/` or `public/` change since `0de954c`), and the live footer read "Build 2613fec" on 2026-11-08. Backend not redeployed: `f81cf02`, no `supabase/` change since. No production-writing smoke test. The first-game acceptance (#11) stays open. |
| 2026-11-10 | `75a0692` | `75a0692` | Unique player names (#76, PR #77). Before deploying, the owner ran `make prod-name-check`; colliding throwaway test players were renamed in a private owner-reviewed reconciliation (the four real players were protected by player ID and left unchanged; the details stay off GitHub) until the check was clean. The owner then deployed the backend from `main` per the reviewed handover (`make deploy-backend`, whose guard runs the same check before its backup, the additive migration `20261108120000_unique_player_names.sql` and the function deploy). Workers Builds published the site on merge (its name-taken message is backward compatible). Reported done by the owner before #72 merged; the backup name and health output were not recorded here. |
| 2026-11-10 | `1c0850a` → `32ba3f0` | `1c0850a` | **Play again by name** (#72 backend, #73 site). Backend first: #72 (no migration) was deployed by the owner from `main` at `1c0850a` after its merge (15:48 UTC) and before #73 merged; `GET /health` read `{"ok":true,"commit":"1c0850a…","pooled":true}` on 2026-11-10, observed by Codex and again during #74. Only then was #73 merged (`32ba3f0`, 16:41 UTC); Workers Builds published it (success 16:42 UTC). At 16:46 UTC the live footer read "Build 32ba3f0" and the served bundle contained the opponent picker. Afterwards the owner opened the ongoing game with Harald on the live site: board and move history intact (2026-11-10). No production-writing smoke test was run (`make prod-e2e` needs owner authorization); the checks above changed no production games. Rollback: the site can return to the v0.2.0 build; keep the backend at `1c0850a` or later while this site is live; the unique-name index is forward-only. |
| 2026-11-10 | `e5e169d` | `1c0850a` | **v0.3.0** (annotated tag `v0.3.0` → `e5e169d`, message "v0.3.0 — Play again with friends"; [GitHub release](https://github.com/Aha43/FriendlyGames/releases/tag/v0.3.0) published 2026-11-10 17:06 UTC by owner-run `make release`). Release PR #80 (#74) merged by the owner at 17:05 UTC after the owner's live-game check (the ongoing game with Harald: board and move history intact); Workers Builds published `e5e169d` (success 17:06 UTC; version and docs only, the same tree as the reviewed head `83168b5`). At 17:16 UTC the live footer read "Build e5e169d" with the source link, the served bundle contained the opponent picker, and `GET /health` read `{"ok":true,"commit":"1c0850a…","pooled":true}`. Backend not redeployed: no `supabase/` change since `1c0850a`. The push CI run for `e5e169d` on `main` was cancelled by the concurrency group before any job started ("higher priority waiting request"); the identical tree passed check, backend and e2e as PR #80's run 42861358349. No production-writing smoke test. The first-game acceptance (#11) stays open. |
| 2026-11-12 | `31faa88` → `8e4ac0a` | `31faa88` | **Yatzy with friends** (#85 backend, #86 site). Backend first: after #85 merged (`31faa88`, 07:20 UTC) the owner deployed it from `main` with `make deploy-backend`: backup completed, the additive migration `20261111120000_yatzy_games.sql` applied, function deployed; `make prod-status` reported a healthy database with pooling (owner's report; backup name not recorded here). Workers Builds published the site at `31faa88`, which did not yet ask for Yatzy. `GET /health` read `{"ok":true,"commit":"31faa88…","pooled":true}` at 16:36 UTC, before #86 was opened for review. Only then was #86 merged (`8e4ac0a`, 22:18 UTC); Workers Builds published it (success 22:18 UTC). At 22:41 UTC the live footer read "Build 8e4ac0a", the top bar "Chess & Yatzy", the served bundle contained the Yatzy picker and table, and `/health` still read `31faa88` (Codex observed the same footer and health). The checks ran in a browser that was not signed in, so the live *Start a game* picker itself was not seen; no production-writing smoke test was run, and no production data was read or changed. Whether existing chess games still open after this deploy has not been reported yet. Rollback: the site can return to the v0.3.0 build; the function to `1c0850a` (rehearsed in #84), never before the #53 dispatcher; keep the migration. |

### First deployment: verification and limits (2026-10-18)

- `GET /health` → `{"ok":true,"commit":"025ff34…","pooled":true}`; the site footer shows
  `Build 025ff34`. CORS allows only the site origin.
- Production database (dashboard SQL): RLS on for all six tables, no `select`/`insert` for
  `anon` or `authenticated`, the archive trigger on `games`.
- Browser journeys against the deployed site (`PLAYWRIGHT_BASE_URL`, `FG_API_URL`): 16/16,
  twice, desktop and Pixel 7 profiles, with no 500s (177 successful calls: median 290 ms, max
  1.1 s from Norway).
- Found and fixed on the way: the local `GAME_DB_URL` uploaded by `supabase secrets set`
  (#23); Pages replaced by a Worker (#24); database connection exhaustion under load, fixed
  with the pooler (#25); the `previews` block for branch builds (#25).
- Production contains throwaway test players (`…@example.test`, including `smoke-…`) and
  their games from these runs. They do not appear in real players' lobbies or history.
- Limits: Free plan (no point-in-time recovery; the deploy script's dumps in `backups/` are
  the backup); identities were device-bound with no recovery (since 2026-11-01, email entry
  reopens a player from any browser; docs/backend.md); no rate
  limiting; `workers.dev` address only (no custom domain).
- The milestone acceptance is the owner and Harald playing a real game on the deployed site.

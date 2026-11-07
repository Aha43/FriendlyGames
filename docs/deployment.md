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
2. After merging a PR that touches `supabase/`, run `make deploy-backend` from `main`.
3. Run the smoke check and the deployed journeys (below).

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

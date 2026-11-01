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
   SITE_ORIGIN=https://friendlygames.<subdomain>.workers.dev npm run deploy:backend
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
2. After merging a PR that touches `supabase/`, run `npm run deploy:backend` from `main`.
3. Run the smoke check and the deployed journeys (below).

### Email entry (#29): order and rollback

The migration (`20261101120000_player_credentials.sql`) only adds: a `player_credentials`
table filled with every existing credential hash, and a trigger that copies the credential of
any player the previous function version creates. `players.credential_hash` stays. So every
browser keeps working through the release, whichever versions are serving.

1. Merge the PR: the site deploys by itself. Run `npm run deploy:backend` from `main` right
   away. Until it finishes (a few minutes), a browser that has no player yet can't get past
   the email step (the old backend requires a name); browsers that remember a player are
   unaffected. The old site against the new backend works as before.
2. Verify: `/health` reports the new commit; an existing browser still opens its games;
   entering the same email in a private window opens the same player.

Rollback: roll back the site **and** the function together. The old function authenticates
with `players.credential_hash`, so each player's first browser keeps working; browsers added
by email entry stop working until the new version is redeployed. Leave the
migration in place (forward-only; harmless to the old version).

## Verifying a deployment

```bash
curl -fsS https://<ref>.supabase.co/functions/v1/game-api/health      # {"ok":true,"commit":"<sha>"}
PLAYWRIGHT_BASE_URL=https://friendlygames.<subdomain>.workers.dev \
FG_API_URL=https://<ref>.supabase.co/functions/v1/game-api \
npm run e2e
```

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
| — | — | — | not yet deployed |

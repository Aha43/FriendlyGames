# Source publication

FriendlyGames is licensed under **GPL-3.0-or-later** ([LICENSE](../LICENSE)) so that the web build
can include chessops for Fischer Random ([decision 0001](decisions/0001-chess960-engine.md)).
Every visitor receives that build, so its corresponding source must be available to them. The
route the owner chose is a public GitHub repository, linked from every page.

## Checklist before merging #55 (the first build with chessops)

Owner decisions are marked **(owner)**; nothing here is done by merging a PR.

- [ ] **(owner)** Approve GPL-3.0-or-later as FriendlyGames' licence: the `LICENSE` file and the
      README "Licence" section added by #55.
- [x] **(owner)** Repository public: <https://github.com/Aha43/FriendlyGames> (2026-11-07).
- [x] Public contents reviewed after the switch (2026-11-07, all 87 commits on 58 branches and PR
      heads): no backups, `.env` files, passwords, keys or tokens were ever committed; database
      URLs are placeholders or the local `postgres:postgres` default; test emails are
      `@example.test`; the only real address is the owner's, as commit author and in decision 0001.
      Earlier private scan: decision 0001.
- [x] Still private by design and git-ignored: `backups/` (production dumps with player data),
      `.env` / `.env.*`, `.wrangler/`. Production secrets live only in Supabase and the owner's
      password manager (docs/deployment.md); CI uses none of them.
- [x] Licence texts ship with every build in `public/licenses/` (chess.js, chessops,
      @badrap/result, Cburnett pieces) and are linked from the footer, with the source link.
- [ ] **(owner)** #54 backend verified live (`make prod-status`) before merging #55.
- [ ] After merge: the footer's build commit is on the public `main`, so the source of the
      running site is the public commit it names.

## Keeping it true

- The footer shows the build's commit; that commit must be public. Do not publish a build from
  an unpushed or private branch.
- When upgrading chessops or @badrap/result, refresh their copies in `public/licenses/`.
- Never commit backups, credentials, invitation tokens or player data; the repository is public.

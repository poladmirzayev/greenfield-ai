# GitHub rate limits (shared token)

Every agent and the lead share one `gh` token: **5000 GraphQL points/hour** and **5000 REST calls/hour**. Most `gh` subcommands (`gh project ...`, `gh pr list`, `gh issue list`) are GraphQL; `gh project item-list --limit 1000` costs about **100 points**, so 50 calls exhaust the hour for everyone.

## Do
- Board work: `node scripts/board/cli.mjs status|show|add`. It uses the REST Projects API (0 GraphQL points), caches ids in `board-cache.json` in the OS temp folder (`BOARD_CACHE` overrides; safe to delete), and falls back to one batched GraphQL request only if REST fails.
- Issues, PRs and comments through REST: `gh api repos/<owner>/<repo>/...`.
- One PR: `gh pr view <n> --json state` (about 1 point), only the fields you need; never list PRs.
- Check the budget for free: `gh api rate_limit` (not counted). Read `resources.graphql` and `resources.core`: `remaining`, `reset` (Unix time; `[DateTimeOffset]::FromUnixTimeSeconds(<reset>).LocalDateTime`).

## Don't
- `gh project item-list`, `gh project field-list`, or poll in a loop.

## At the limit
- The board tool reads the reset time, prints it and waits, at most `BOARD_MAX_WAIT_SECONDS` in total (default 900); beyond that it stops with the reset time. Report pending moves to the lead; don't retry in a loop.
- `gh` reports a rate-limited `gh project ... --owner <login>` call as `unknown owner type` (it maps every GraphQL error but "not found" to that). Check `gh api rate_limit` before debugging owners. A really wrong owner (e.g. `--owner <owner>/<repo>`) and an expired token give the same text.

Board tool unit tests: `node --test scripts/board/*.test.mjs` (the project's script name is in `AGENTS.md`).

---
name: Dev workflow
description: Issue, branch, worktree, PR and review workflow for developer, reviewer and chores agents. Load before any work.
---

# Dev workflow

Project facts (verification commands, docs rule, board, PR template, environment) are in `AGENTS.md`. On demand: `references/worktrees.md`, `references/github-rate-limits.md`, `references/windows-powershell.md`.

## Rules
- Every change has a GitHub issue. Commits are conventional and end `, closes #N`. Branch: `{feat|fix|test|chore|docs}/{issue}-{kebab}`.
- Docs are part of the change (docs rule in `AGENTS.md`); reviewers reject a PR that skips it.
- Frozen contracts and decisions change only additively, recorded as amendments, unless the task says otherwise.
- Keep all text (comments, PR and issue bodies, replies) SHORT.

## Steps
1. **Worktree.** Never work in the main checkout (the lead's). Create your own (`references/worktrees.md`); check the working directory before every command.
2. **Board.** `node scripts/board/cli.mjs status "#N" "In Progress"` (Todo, In Progress, In Review, Done; always with arguments), verify with `show "#N"`. A new issue needs `add "#N"` first. "REST search did not return issue" is common: verify, retry once.
3. **Implement.** Tests first for bugs. Install dependencies once per worktree.
4. **Check** with the verification commands in `AGENTS.md`; rerun known flakes.
5. **PR.** Intermediate commits are fine; the PR ends as ONE conventional commit. `git push -u origin <branch>`, then `gh pr create --base main --head <branch> --title "<conventional title>" --body-file <file>`. Body starts `Closes #N` and follows the PR template (`AGENTS.md`). Wait for green CI (`gh pr checks`), move the issue to "In Review". Assign no reviewers unless told.
6. **Report** to the lead: PR URL, FULL 40-char head SHA, summary, deviations, gaps. Stop. Never review your own PR.
7. **`CHANGES REQUESTED`:** back to "In Progress", fix everything, rerun checks, update the PR, "In Review", report again.
8. **Approved:** merge with `merge-recipe`, only when the lead says so.

## Tools
- `gh`: the board scripts find it themselves. For your own calls add `%LOCALAPPDATA%\Microsoft\WinGet\Packages\GitHub.cli_*\bin` to `PATH` (or set `GH`). Still missing: say so and stop.
- Comments: `gh api ... -F body=@file` (capital F; `-f` posts the literal path); read back.
- The `gh` token is shared and has hourly budgets: read `references/github-rate-limits.md` before any `gh project` or list call. Never poll.
- Long commands: foreground, long timeouts.
- `Blocked by configuration policy`: never look for another way to do the same thing. Stop and report the command and why you needed it.

## Shared resources
- Never print, log, commit or paste a key, credential file or real `.env`; redact quoted output.
- Rate-limited or real-API tests are opt-in, one at a time (`AGENTS.md`).
- Never kill processes you didn't start; keep runs short, stop what you started.

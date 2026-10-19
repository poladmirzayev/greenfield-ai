---
name: Merge recipe
description: Merge an approved PR so GitHub records it as Merged (squash to one commit, push the same SHA to main). Load only when told to merge.
---

# Merge recipe

`main` is checked out in the main checkout, so a worktree can't switch to it. Merge as below; never `gh pr merge` (policy-blocked).

Preconditions: a reviewer comment starting `APPROVED` (read it), the lead said merge, CI green on the head SHA. Otherwise stop.

```powershell
git fetch origin
git rebase origin/main                    # resolve conflicts; if main moved, rerun the checks
git reset --soft origin/main
git commit -m "<conventional message>, closes #N"     # ONE commit
git push --force-with-lease origin <branch>           # PR branch FIRST
<verification commands from AGENTS.md>                # install, forced typecheck, docs/config checks, touched tests
git push origin <sha>:main                # the SAME SHA, fast-forward only
```
1. Don't touch the PR branch after pushing to `main`.
2. Push to `main` rejected: `main` moved; fetch and repeat from the rebase.
3. Confirm `merged: true` in `gh api repos/<owner>/<repo>/pulls/<n>`.
4. `node scripts/board/cli.mjs status "#N" "Done"`; verify with `show`.
5. Remove your worktree and branch (`dev-workflow`, `references/worktrees.md`).
6. File the reviewer's non-blocking notes as ONE follow-up (`triage`).
7. Main checkout: only `git pull --ff-only`; confirm `git status` is clean. Dirty: report, don't edit.

Report: FULL 40-char merge SHA, `merged: true`, follow-up issue number, `main` HEAD, clean status.

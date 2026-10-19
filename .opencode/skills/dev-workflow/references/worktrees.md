# One worktree per agent

The main checkout is the lead's: no branch switches, commits or edits there. Each agent works in its own worktree in the sibling folder `<repo>-wt/`, one SHORT folder name per task (Windows path limits).

```powershell
cd <main checkout>
git fetch origin
git worktree add ..\<repo>-wt\<short> -b <type>/<issue>-<name> --no-track origin/main
cd ..\<repo>-wt\<short>      # install dependencies once here (see AGENTS.md)
```

Work, run, commit and run board commands only inside the worktree; push with `git push -u origin <branch>`.

| Task | Command |
|---|---|
| List | `git worktree list` |
| Remove after merge | `cd <main checkout>; git worktree remove ..\<repo>-wt\<dir> --force; git branch -D <branch>` |
| Update main checkout (lead) | `cd <main checkout>; git pull --ff-only` |
| Clean stale entries | `git worktree prune` |

`git worktree remove` fails with `Filename too long` (deep `node_modules` paths)? Delete the folder with `node -e "require('fs').rmSync('<path>', {recursive:true, force:true})"`, then `git worktree prune` and `git branch -D <branch>`.

State is per worktree (data folders, databases; see `AGENTS.md`). Settings that differ per worktree go in that worktree's shell, never in a shared file. Leave other agents' worktrees alone.

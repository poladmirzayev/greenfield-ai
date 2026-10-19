# greenfield-ai: multi-agent team template (OpenCode)

A reusable setup where a **team lead** agent orchestrates specialised subagents (architect, developer, reviewer, chores), each with its own model, permissions and workflow, through GitHub issues, PRs and a project board.

## Contents

| Path | What |
|---|---|
| `.opencode/agents/` | Roles and their models: `team-lead` (primary), `architect` (Opus), `developer` (Sonnet), `reviewer` and `chores` (Haiku) |
| `.opencode/skills/` | `dev-workflow` (issue, worktree, PR, review), `triage` (severity labels), `merge-recipe` |
| `.opencode/commands/` | `/start-task`, `/review-pr`, `/merge-pr`, `/plan-feature` |
| `.opencode/opencode.jsonc` | Generic hard policies (no real `.env` access, no `gh pr merge`, no unleased force push); default agent `team-lead` |
| `.opencode/README.md` | How the framework works: where each rule lives, enforced vs only asked, gotchas |
| `AGENTS.md` | Fill-in starter for the ONLY project-specific file (facts, naming, verification, limits, hard rules) |
| `opencode.jsonc` | Optional project-specific policies (commented example) |
| `scripts/board/` | Project-board tool (`node scripts/board/cli.mjs status\|show\|add`); tests: `node --test scripts/board/*.test.mjs` |
| `.github/pull_request_template.md` | PR template the skills point to |

## Set up in your repo

1. Copy everything here into your repo root (keep dotfolders). Don't overwrite an existing `.gitignore`: merge it.
2. `scripts/board/board.json`: set `owner`, `ownerType` (`user` or `org`), `repo`, `project` (number). Needs `gh` logged in with scopes `repo`, `project`, `read:org`, and a GitHub Project with the statuses Todo, In Progress, In Review, Done.
3. Models: each `.opencode/agents/*.md` has a `model:` line (`fuelix-anthropic/claude-...-5-5` here). Replace with ids from your provider (`opencode models`). `team-lead` has no `model`: it uses the session's model.
4. Fill in `AGENTS.md` (replace every `<placeholder>`, delete the top comment). Adapt `.github/pull_request_template.md`.
5. Optional: add project policies to the root `opencode.jsonc`.
6. Check: `opencode debug agents`, `opencode debug config`, `node --test scripts/board/*.test.mjs`.
7. Start `opencode` in the repo: the team lead is the default agent. Describe a feature, or use `/plan-feature`.

## Notes

- Requirements: OpenCode (verified on 2.0.26), `gh`, Node 20+, git. The workflow assumes GitHub, one git worktree per agent, a `main` branch, and (on Windows) PowerShell.
- Session limits (how many agents at once, per role) are set in `AGENTS.md`, not enforced by config.
- To share across all projects, put `agents/`, `skills/` and `commands/` under `~/.config/opencode/` and keep only `AGENTS.md` per repo.
- Read `.opencode/README.md` before changing the framework files.

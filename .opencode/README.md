# Team framework (OpenCode)

How the team works with AI agents, as OpenCode project config. For people; agents read the agent, skill and command files directly.

## What is the framework

| Part | Role |
|---|---|
| `.opencode/` | Generic: agents, skills, commands, base policies. Copy as is |
| `scripts/board/` | Generic board tool (`cli.mjs status\|show\|add`). Only `board.json` (owner, ownerType, repo, project number) is project-specific |
| `AGENTS.md` | The ONLY project-specific file, loaded into every session |
| root `opencode.jsonc` | Optional project-specific policies (an example is included, commented out) |

Generic files never name the project; they say "see `AGENTS.md`".

## Where each rule lives

| Rule | File | Enforced by |
|---|---|---|
| Roles and models | `agents/*.md` | Agent `model` and `permissions` |
| Who the lead may launch | `permissions` in `agents/team-lead.md` | Config |
| Workflow: issue, worktree, PR, review | `skills/dev-workflow` (+ `references/`: worktrees, GitHub rate limits, Windows/PowerShell) | Loaded on demand |
| Severity and triage | `skills/triage` | Same |
| Planning: architecture, slice plan, `tasklist.md`, task issues | `agents/architect.md`, "Planning and issues" in `agents/team-lead.md` | Asked |
| Merge order | `skills/merge-recipe` | Skill + policy blocking `gh pr merge` |
| Repeated prompts | `commands/*.md` | `/start-task`, `/review-pr`, `/merge-pr`, `/plan-feature` |
| Generic hard rules (secrets, `gh pr merge`, unleased force push) | `.opencode/opencode.jsonc` | Config, hard deny |
| Project hard rules (e.g. no writes to a database) | root `opencode.jsonc` | Config, hard deny |
| Project facts and always-on rules | `AGENTS.md` | Loaded every session |
| Long project docs | `docs/` | Read when `AGENTS.md` or a skill points there |

## Roles

| Agent | Mode | Model | Does |
|---|---|---|---|
| `team-lead` | primary (default) | session's model | Orchestrates, no feature code |
| `architect` | subagent | Opus 5.5 | Architecture, ADRs, slice roadmap; one slice plan + `tasklist.md` at a time. Rare |
| `developer` | subagent | Sonnet 5.5 | One issue, core functionality |
| `reviewer` | subagent | Haiku 5.5 | One PR, verdict comment |
| `chores` | subagent | Haiku 5.5 | Tests, docs, board, small fixes, merges |

## Naming

| Name | Meaning |
|---|---|
| Slice | One demonstrable piece of functionality, planned and delivered on its own. The project picks its ID scheme and records it in `AGENTS.md` (examples here: `S1`, `S2`) |
| Task | One unit of work in a slice's `tasklist.md`, ID `<slice>-T<nn>` (`S1-T07`), stable and never reused |
| Task issue | GitHub issue whose title starts with the task ID (`[S1-T07] ...`); a task may have several over time |
| Bug or follow-up issue | No task ID; exactly one `sev:*` label (`triage`) |
| ADR | Architecture decision record, numbered, under the architecture docs |
| Branch, commit | `{feat\|fix\|test\|chore\|docs}/{issue}-{kebab}`; conventional message ending `, closes #N` |

## What `AGENTS.md` must provide

The root `AGENTS.md` in this template is a fill-in starter: project facts, naming, verification and docs rule, secrets, agent limits, shared resources, hard rules, review stance. Replace every `<placeholder>`, then delete the HTML comment at the top.

## Enforced vs only asked

- **Enforced:** policies (real `.env` and key files unreadable and unwritable, no `gh pr merge`, no unleased force push), the lead's subagent list, subagents can't launch subagents or ask questions.
- **Only asked** (the agent file is the source of truth): the session limits (numbers in `AGENTS.md`), escalation from `chores` to `developer`, one worktree per agent, never writing to the main checkout (a policy can't name a project path generically), timestamps.
- Reviewers keep edit rights on purpose: they break behaviour temporarily to prove a test fails, then restore it.
- Policies sit under `experimental.policies`: OpenCode 2.0.26 drops a top-level `policies` key (docs say both work; move them when your version keeps it). Verified on 2.0.26: `.env` reads, `gh pr merge`, `git push --force` return `Blocked by configuration policy` (`--force-with-lease` and pushing a SHA to `main` stay allowed); `.env.example` stays readable.
- `grep` and `glob` bypass the file policies (a grep can match inside `.env`); keep real keys out of the repo folder.
- `instructions` in config is accepted by OpenCode V2 but not loaded yet: rules go in `AGENTS.md`, agents and skills.
- A worktree loads `AGENTS.md` and `.opencode/` only from the folder the session started in.
- Check with `opencode debug agents` and `opencode debug config`; after editing a policy read the server log (invalid statements are dropped with a warning).

## Reusing it

1. Copy `.opencode/` and `scripts/board/`; set owner, ownerType (`user` or `org`), repo, project number in `scripts/board/board.json`.
2. Change the model ids in `agents/*.md` to your provider's.
3. Copy `AGENTS.md` to the repo root and fill it in. Add a root `opencode.jsonc` only for project-specific policies (see the template's example).
4. Copy `.github/pull_request_template.md` and adapt its checklist; add a triage policy doc if you want one and link it from `AGENTS.md`.
5. Run the board tool tests: `node --test scripts/board/*.test.mjs`.

To share across all projects, put agents, skills and commands under `~/.config/opencode/` and keep only `AGENTS.md` per repo.

Change these files like code: an issue and a PR. One source of truth; link to a doc instead of copying it.
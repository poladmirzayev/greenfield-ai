# Project rules (<project name>)

<!-- Starter for AGENTS.md (OpenCode loads this file into every session): fill in, delete these
comments. Project-specific facts and rules ONLY (generic workflow is in .opencode/). Long details go in docs/ and are linked. -->

## Project facts
- Repo `<owner>/<repo>`. Board: <project URL> (config in `scripts/board/board.json`).
- Architecture: <style, where the docs live, what is frozen and how it changes>. ADRs in `<path>`; slice folders `<path>/<slice>/` (`plan.md`, `tasklist.md`).
- Worktrees: sibling folder `<repo>-wt/`, short names. PR body: `<path to PR template>`.
- Docs: triage policy `<path>`; security register `<path>` (if any); run and config docs `<path>`.

## Naming
- Slices: `<scheme, e.g. S1, S2>`. Tasks `<slice>-T<nn>`; task issue titles start with the task ID.
- Module or area prefixes and other project IDs: <meanings>.

## Verification (in your worktree)
- Commands: <install>, <typecheck>, <tests>, <docs and config checks>, <e2e>.
- Known flaky tests (rerun before reporting): <list>.
- Docs rule: a PR that changes how the app is installed, run, configured, tested or deployed updates <docs> in the same PR; <check command> passes. Reviewers reject a PR that skips it.

## Configuration and secrets
- Where config and secrets come from; never hardcode, print, log, commit or paste a secret or real `.env`.
- Opt-in or rate-limited tests (name the switch), one at a time.

## Agent limits
- At most <n> subagent sessions at once: <per role, e.g. n developers, 1 architect, rest reviewer/chores>. Reviews and merges on continued sessions count.

## Shared local resources
- Ports, data folders, services agents share; what they must not kill or share.

## Hard rules
- <Absolute project rules, e.g. data that must never be modified. Mirror each in the root `opencode.jsonc` policies where a command can be blocked.>

## Review stance
- What reviewers block on and what they only list (e.g. deferred findings and how they are filed).
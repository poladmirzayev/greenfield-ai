---
name: Triage
description: Severity labels, filing bugs and follow-ups, backlog order. Load before filing an issue or choosing work.
---

# Triage

The project's fuller policy and security register, if any, are listed in `AGENTS.md`.

## Rule
Essential features first; only critical bugs interrupt. Every bug or follow-up issue has exactly ONE `sev:*` label. Fix only critical ones now; the rest waits for the hardening phase.

| Label | When | Fix |
|---|---|---|
| `sev:1-critical` | Secret or credential committed, printed or logged; real data sent where not approved; silently wrong numbers or data loss; demo or acceptance path or `main` broken | Now |
| `sev:2-major` | Wrong behaviour with a workaround; flaky test failing more than 1 in 10 full runs | In the current feature if under about 1 h, else next slice's first week |
| `sev:3-minor` + `hardening` | Rare flakes, cosmetic, docs wording, performance misses without functional impact, non-blocking reviewer notes, defence in depth | Hardening phase |
| `sev:4-trivial` + `hardening` | Trivia | Only when touching the file anyway |

Security, multi-user and cross-org findings follow the stance in `AGENTS.md` (default: `security` + `hardening` + `sev:3-minor`, block no PR).

## Filing
- Planned task issues: see "Planning and issues" in `team-lead.md` (task ID in the title).
- Title `fix(<module>): <what>`. Labels: `bug` (if a bug), one `sev:*`, `follow-up`, module label, `hardening` for sev 3 and 4.
- Body, SHORT: Impact, Severity (N and why), Workaround, Found in (PR or test), Proposed fix, Acceptance.
- Create through REST (`gh api repos/<owner>/<repo>/issues`, 0 GraphQL points), then `node scripts/board/cli.mjs add "#N"` and `status "#N" "Todo"`. Sev:3/4 go to the bottom.
- Reviewer notes: ONE `sev:3-minor` follow-up per PR (labels `hardening`, `sev:3-minor`, `follow-up`); its number goes in the `APPROVED` comment.

## What next (lead)
`sev:1`; feature in flight; next essential feature; `sev:2`; `sev:3/4` only when all feature work is blocked on review or merge and a slot would idle (cheapest first).

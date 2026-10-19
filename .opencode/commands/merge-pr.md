---
description: Merge an approved PR with the merge recipe
agent: chores
subagent: true
---

Merge PR #$1 with `merge-recipe`. First confirm an `APPROVED` comment exists for the current head SHA and CI is green; else stop and say so. Extra: $2

Reply: FULL 40-char merge SHA, `merged: true`, follow-up issue number, `main` HEAD, main checkout status.
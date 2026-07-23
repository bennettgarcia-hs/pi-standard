---
name: org-commit-style
description: Use when writing git commit messages or opening pull requests in company repos. Enforces the org's Conventional-Commits-based format and PR description checklist.
metadata:
  owner: developer-experience
---

# Org commit & PR style

Apply this whenever you author a commit message or PR body in a company repo.

## Commit messages

Use Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`.
- **scope**: the affected package/module (optional but encouraged).
- **subject**: imperative mood, ≤72 chars, no trailing period.
- **body**: what and why, not how. Wrap at 72 chars.
- **footer**: reference the ticket, e.g. `Refs: PROJ-123`, and `BREAKING CHANGE:` when applicable.

## Pull requests

Every PR description must include:

1. **What** changed (one paragraph).
2. **Why** — link the ticket.
3. **How to test** — concrete steps or the command that verifies it.
4. **Risk / rollback** — blast radius and how to revert.

Keep PRs focused; split unrelated changes.

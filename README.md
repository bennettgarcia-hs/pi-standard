# @bennettgarcia-hs/pi-standard

The company-wide standard [Pi](https://pi.dev) setup: shared extensions,
skills, prompts, and themes, distributed as a single Pi package.

## What's in here

```
extensions/   # org .ts/.js extensions loaded by Pi
skills/        # <name>/SKILL.md capability packages (Agent Skills standard)
prompts/       # shared .md prompts
themes/        # shared .json themes
settings.baseline.json   # the snippet each project repo commits
scripts/validate.mjs     # pre-merge structure validator (runs in CI)
```

## How teams consume it

This repo is a Pi package consumed directly from git, tracking the `main`
branch. This needs **no auth token** (public repo, anonymous clone) and shows
**no detached-HEAD notice** (pinning a branch keeps the clone on that branch,
unlike pinning a tag).

In a project repo, create `.pi/settings.json` (copy from
[`settings.baseline.json`](./settings.baseline.json)) and commit it:

```json
{
  "packages": ["git:github.com/bennettgarcia-hs/pi-standard@main"]
}
```

A teammate then runs `pi` in that project, approves the trust prompt once, and
Pi **auto-installs the standard package on startup**. No separate install step,
no credentials.

- **Tracks `main`.** Consumers get whatever is on `main` at install / `pi update`
  time — this is a *moving* pin, not a frozen version, so it is not
  bit-for-bit reproducible. The safety net is branch protection: every change
  to `main` goes through a reviewed PR (see below).
- To try changes without installing: `pi -e ./` from a checkout of this repo.

> **Why not tags or an npm registry?** Tags are immutable (reproducible) but
> pinning one puts Pi's clone in detached-HEAD, which prints a noisy git notice
> on every install. GitHub Packages (npm) avoids that but *requires an auth
> token even for public packages*, which is fragile to provision in sandboxed
> environments (e.g. the jail). Tracking `main` avoids both problems at the
> cost of reproducibility. If you later need frozen versions, reintroduce tags
> and silence the notice with `git config advice.detachedHead false`.

## Releasing

There is no publish step — consumers track `main` directly, so a change reaches
everyone on their next `pi update` (or next Pi start, for a fresh install).

1. Open a PR (branch protection requires review before merge).
2. Merge to `main`. That *is* the release.
3. Announce notable changes so teams know to `pi update`.

Because there is no version pin, treat every merge to `main` as shipped to all
consumers. Keep changes small and reviewed; Pi's extension API is pre-1.0 and
can shift under you.

## Caveats (Pi platform limits)

- **No org/enterprise policy tier and no admin lock.** Pi only has global
  (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`) config,
  project overriding global. This repo *distributes and standardizes* a
  baseline; it cannot *enforce* it — users can always edit their own settings.
  If you need hard enforcement, add it externally (onboarding script that
  writes the global settings, or a CI check in consumer repos that fails if
  `.pi/settings.json` drops this package).
- **No reproducibility.** Consumers track `main`, so there is no frozen
  version — a merge ships to everyone. Reviewed PRs are the only safety net.
- Pi's extension API is pre-1.0 with no formal deprecation policy; expect churn.

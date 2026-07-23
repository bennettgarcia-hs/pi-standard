# @yourorg/pi-standard

The company-wide standard [Pi](https://pi.dev) setup: shared extensions,
skills, prompts, and themes, distributed as a single Pi package.

> Replace `yourorg` throughout with your real GitHub org / npm scope.

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

This repo is distributed via **git tags**. In a project repo, create
`.pi/settings.json` (copy from [`settings.baseline.json`](./settings.baseline.json))
and commit it:

```json
{
  "packages": ["git:github.com/yourorg/pi-standard@v0.1.0"]
}
```

A teammate then just runs `pi` in that project, approves the trust prompt
once, and Pi **auto-installs the standard package on startup**. No separate
install step.

- **Pin to a tag** (`@v0.1.0`). There is no lockfile — the pinned ref is your
  only source of determinism. Merging to `main` never changes anyone's setup
  until they bump the pinned version, so you control the blast radius.
- To try changes without installing: `pi -e ./` from a checkout of this repo,
  or `pi install -l git:github.com/yourorg/pi-standard@<branch>` into a scratch
  project (`-l` writes to project `.pi/settings.json` instead of global).

## Releasing

1. Merge changes to `main` (see [CONTRIBUTING.md](./CONTRIBUTING.md)).
2. Tag: `git tag v0.2.0 && git push --tags`.
3. Announce the new version; teams bump their pinned spec when ready.

Use semver: breaking extension/skill changes → major bump, since Pi's own
extension API is pre-1.0 and can shift under you.

## Caveats (Pi platform limits)

- **No org/enterprise policy tier and no admin lock.** Pi only has global
  (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`) config,
  project overriding global. This repo *distributes and standardizes* a
  baseline; it cannot *enforce* it — users can always edit their own settings.
  If you need hard enforcement, add it externally (onboarding script that
  writes the global settings, or a CI check in consumer repos that fails if
  `.pi/settings.json` drops this package).
- **No lockfile.** Pin every spec.
- Pi's extension API is pre-1.0 with no formal deprecation policy; expect churn.

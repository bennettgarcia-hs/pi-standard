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

This package is published to **GitHub Packages** (npm registry) and installed
via an `npm:` source. Unlike a `git:` source, npm installs are tarball
downloads — no git clone and no detached-HEAD checkout.

In a project repo, create `.pi/settings.json` (copy from
[`settings.baseline.json`](./settings.baseline.json)) and commit it:

```json
{
  "packages": ["npm:@bennettgarcia-hs/pi-standard@0.4.0"]
}
```

A teammate then runs `pi` in that project, approves the trust prompt once, and
Pi **auto-installs the standard package on startup**. No separate install step.

- **Pin to a version** (`@0.4.0`). Published versions are immutable, so a pin is
  reproducible. Merging to `main` never changes anyone's setup until a new
  version is published *and* they bump the pin — you control the blast radius.
- To try changes without installing: `pi -e ./` from a checkout of this repo.

### Registry auth (one-time per machine / jail)

GitHub Packages requires auth to install, even for public packages. Point the
`@bennettgarcia-hs` scope at the GitHub registry with a token. In an
environment that already has `gh` (e.g. the jail):

```bash
# Scope only @bennettgarcia-hs to GitHub Packages; everything else uses npmjs.
printf '@bennettgarcia-hs:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' \
  "$(gh auth token)" >> ~/.npmrc
```

The token needs the `read:packages` scope (gh's default token has it). This is
the only credential setup required; the package itself downloads over the
registry, not git.

## Releasing

Releases are published by GitHub Actions on a version tag — never from a
laptop, and the built-in `GITHUB_TOKEN` carries the `write:packages` scope so
no personal token is needed.

1. Merge changes to `main` via PR (protected branch).
2. Bump `version` in `package.json` to `X.Y.Z` and merge that too.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. The `publish` workflow validates, checks the tag matches `package.json`
   version, and runs `npm publish`. Teams bump their pinned spec when ready.

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
- **No lockfile.** Pin every spec to an exact version.
- Pi's extension API is pre-1.0 with no formal deprecation policy; expect churn.

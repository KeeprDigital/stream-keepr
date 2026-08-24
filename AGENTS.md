## Pre-push gate

Run `pnpm verify` before pushing. It applies CI's gates to the working tree in
one invocation, stopping at the first failure. CI also installs from the
lockfile, so commit `pnpm-lock.yaml` alongside any `package.json` change that
affects dependency resolution; script-only changes do not rewrite it.

It exists for its tail: `pnpm worker:dry-run` followed by `pnpm worker:smoke`.
Both consume `.output/`, so they need a production build first and stay out of
`pnpm test`. The dry run checks the upload bundle statically; the smoke run then
starts that artifact under local workerd and sends production-shaped requests
through its runtime, bindings, authentication, and media paths. Together they
catch the #302 class of failure: a bundle green on Node and broken on workerd.
Those failures move with dependencies, bundling, `nuxt.config.ts`, and server
code, so a change touching any of the four is one `pnpm verify` covers and the
test loop does not.

## Orphaned workerd

A dev server or test run that dies to SIGKILL or SIGHUP strands its workerd
process (miniflare's exit hooks cover only SIGINT/SIGTERM), leaving it holding
memory and sqlite locks on `.wrangler` persist state. `pnpm dev`, `pnpm
preview`, `pnpm worker:smoke`, and the integration suite reap these on start;
`pnpm reap` sweeps them on demand — it kills only workerd whose parent is gone,
so it is always safe to run. Stop dev servers with SIGTERM or SIGINT.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain layout. See `docs/agents/domain.md`.

### Parallel rounds

Several tickets are often worked at once, one git worktree each, through implement → fresh-context review → remediation → verification → merge. See `docs/agents/parallel-rounds.md` — it carries the hazards that only exist when worktrees run concurrently, and what a review and an implementation each owe.

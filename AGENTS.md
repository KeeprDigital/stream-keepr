## Pre-push gate

Run `pnpm verify` before pushing. It applies CI's gates to the working tree in
one invocation, stopping at the first failure. (CI also installs from the
lockfile; commit `pnpm-lock.yaml` alongside any `package.json` change.)

It exists for its tail, `pnpm worker:dry-run` — the gate nothing else in the
local loop runs. The dry run reads `.output/`, so it needs a production build
first, which is why it stays out of `pnpm test`. It catches the #302 class of
failure: a bundle green on Node and broken on workerd. Those failures move with
dependencies, bundling, `nuxt.config.ts`, and server code, so a change touching
any of the four is one `pnpm verify` covers and the test loop does not.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain layout. See `docs/agents/domain.md`.

### Parallel rounds

Several tickets are often worked at once, one git worktree each, through implement → fresh-context review → remediation → verification → merge. See `docs/agents/parallel-rounds.md` — it carries the hazards that only exist when worktrees run concurrently, and what a review and an implementation each owe.

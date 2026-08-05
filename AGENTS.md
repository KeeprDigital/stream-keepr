## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain layout. See `docs/agents/domain.md`.

### Parallel rounds

Several tickets are often worked at once, one git worktree each, through implement → fresh-context review → remediation → verification → merge. See `docs/agents/parallel-rounds.md` — it carries the hazards that only exist when worktrees run concurrently, and what a review and an implementation each owe.

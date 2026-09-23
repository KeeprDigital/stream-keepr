`README.md` is the guide to setup, testing, deploy, and operations. This file
holds only what an agent must follow.

## Before pushing

Run `pnpm verify` before pushing: it applies CI's gates to the working tree and
stops at the first failure. Its tail (`worker:dry-run`, `worker:smoke`) is the
only local check that the Worker bundle runs on workerd, so any change touching
dependencies, bundling, `nuxt.config.ts`, or server code needs it; `pnpm test`
does not cover it. Commit `pnpm-lock.yaml` with any `package.json` change that
affects dependency resolution.

## Local auth bypass

- `STREAM_KEEPR_LOCAL_AUTH_BYPASS` is written only in the `package.json`
  `:bypass` scripts. Keep it out of `.env`, `.env.example`, `wrangler.jsonc`,
  CI, and Worker vars: a deployed installation carrying it serves the app
  unauthenticated.
- Nothing needs it set. No build, suite, or gate depends on it; a task that
  seems to has been misread.

## Worktrees and processes

- A new worktree has no `.env`, `node_modules`, or `.nuxt`: `cp .env` in from
  the main checkout, then `pnpm install --frozen-lockfile`. Missing `.env`
  produces 503s and two skipped realtime tests, not branch defects.
- Stop dev servers with SIGINT/SIGTERM. `pnpm reap` safely removes orphaned
  `workerd`; scope any manual kill to your worktree
  (`pkill -f "worktrees/<name>.*workerd"`), never bare `pkill -f workerd`.
- Run one integration suite at a time per machine.

## Domain docs

- Before exploring, read `CONTEXT.md` and the `DECISIONS.md` sections touching
  your area.
- Name domain concepts with `CONTEXT.md` terms, never its `_Avoid_` synonyms. A
  missing term is either invented language (reconsider) or a real gap (add it).
- If your output contradicts a decision, say so explicitly ("Contradicts
  ADR-NNNN — worth reopening because…") rather than silently overriding it.
- Record a new decision as a new section at the end of `DECISIONS.md` with the
  next number. Change an existing decision by editing its section. Skills that
  default to `docs/adr/NNNN-*.md` files write here instead.

## Issue tracker

Issues and PRDs live in GitHub Issues; use `gh`, which infers the repo.

- Read: `gh issue view <n> --json number,title,state,body,comments,labels`. Use
  the JSON form, because plain `gh issue view` has silently dropped output here.
- Create: `gh issue create --title "…" --body "…"` (heredoc for multi-line).
  Comment: `gh issue comment`. Labels: `gh issue edit --add-label/--remove-label`.
  Close: `gh issue close <n> --comment "…"`.
- "Publish to the issue tracker" means create an issue; "fetch the ticket" means
  read it as above.
- External PRs are not a triage surface.

### Triage labels

| Label                 | Meaning                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `needs-triage`        | Maintainer needs to evaluate                                          |
| `needs-info`          | Waiting on reporter                                                   |
| `ready-for-agent`     | Fully specified, ready for an AFK agent                               |
| `ready-for-human`     | Requires human implementation                                         |
| `wontfix`             | Will not be actioned                                                  |
| `requires-deployment` | Remaining verification needs a human-authorized deploy (composes with the above) |

Having production credentials is not authorization to use them. Finish the
local evidence, apply `requires-deployment`, and leave the deploy and the
ticket's close to a human.

### Wayfinding

Used by `/wayfinder`. The **map** is one issue labelled `wayfinder:map`
(Notes / Decisions-so-far / Fog body). **Child tickets** are GitHub sub-issues of
the map, labelled `wayfinder:<research|prototype|grilling|task>`. If
sub-issues are unavailable, list them in the map body and put `Part of #<map>`
atop the child.

- **Blocking**: native issue dependencies:
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`,
  where the db id is `gh api repos/<owner>/<repo>/issues/<n> --jq .id`. Fallback:
  a `Blocked by: #<n>` line atop the child. A ticket is unblocked when every
  blocker is closed.
- **Frontier**: the map's open children with no open blocker and no assignee;
  first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` as the first write.
- **Resolve**: comment the answer, close, then append a gist + link to the
  map's Decisions-so-far.

`README.md` is the guide to setup, testing, deploy, and operations. This file
holds only what an agent must follow.

## Before pushing

Push once `pnpm verify:quick` (lint, typecheck, unit and Nuxt suites) passes;
CI is the full gate. Open the PR as a draft, which CI skips, and mark it ready
when the branch is done: that runs every gate `pnpm verify` runs, Worker build
and workerd smoke included. Realtime integration tests are the exception: CI
has no Ably key, so they run only against your local `.env`. A change touching
realtime needs `pnpm test:integration --run` green before you mark it ready.
Reach for `pnpm verify` to reproduce a CI failure locally. Commit
`pnpm-lock.yaml` with any `package.json` change that affects dependency
resolution.

## Landing on main

Every change reaches `main` as a squash-merged PR whose title is a Conventional
Commit (`fix(scope): summary`); release-please reads that one commit, and CI
runs only on PRs and in the merge queue. Open the PR from your branch and leave
`main` itself to the merge queue. Why: README.md § Releases.

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
  `workerd`; scope any manual kill to your worktree's path
  (`pkill -f "<worktree path>/.*workerd"`), never bare `pkill -f workerd`.
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

## Writing tests

A test earns its place by going red when behaviour a user, operator or caller
relies on breaks, and staying green through a refactor.

- Test each rule at its **home**, the one module that owns it. A consumer gets
  one **wiring** test (passes the right input, shows the result).
- Drive real code through a public seam and fake only the boundary: network,
  Ably, clock, object storage. Persistence runs on `createSqliteD1Harness` with
  the real migrations.
- Assert outcomes: stored rows, returned values, emitted events, visible text,
  ARIA state. Call arguments are the assertion only at a port whose call is the
  contract.
- Glue, pass-through repositories, re-exports and field-copy mappers are
  covered by the test of what they wire.
- A schema test names a rule the schema adds (refinement, transform,
  back-compat, cross-path parity) and covers both sides of each bound it tests.
  Literals, defaults, option lists and return shapes belong to the type system.
- Expose component state through ARIA or `data-*` and assert that, plus message
  codes and key tokens.
- Assert an optimistic update while its request is pending
  (`test/helpers/deferred.ts`).
- Write cases as `it.each` tables. Build setup from the kits in `test/helpers/`
  and `test/nuxt/helpers/` (Nuxt UI stubs, graphics fixtures, realtime fakes),
  extending a kit when it lacks something.
- Test comments state the invariant in at most three lines; issue history
  belongs in the commit and PR.
- An invariant that resists a behavioural test goes, in order, to a type, an
  ESLint rule, a parsed config, or an off-the-shelf linter.

Models: `test/unit/server/api/cardExpiry.sqlite.test.ts`,
`test/nuxt/stores/broadcastGraphicsLiveSessionProtocol.test.ts`,
`test/nuxt/components/Screen/Modes/settingsEditorFields.test.ts`.

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

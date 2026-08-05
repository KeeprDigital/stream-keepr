# Running a parallel round

How this repo runs several tickets at once across git worktrees, and the hazards that only exist when it does. Written from the fourth such round (#160, #167, #170+#188, #172, #178, #184+#190) so the working knowledge stops living in finished conversations. Issue #191 asked for this.

## The shape

One worktree per ticket group, under `.claude/worktrees/issue-<n>`, branched from one fixed point. Each branch runs:

**implement → fresh-context review → remediation → verification by the same reviewer → merge**

The review is _fresh-context_ on purpose: a reviewer that watched the implementation inherits its blind spots. The verification afterwards is by the **same** reviewer, because the question there is narrow — "is the thing I found closed?" — and a second fresh context would have to rediscover the finding before it could judge the fix.

Group tickets by **file locality**, not by theme. Two tickets that touch the same file belong on one branch even if they are unrelated; two tickets on the same subject belong on separate branches if they touch different files. Conflicts cost more than context switching.

Expect most branches to come back FIX FIRST. Across four rounds it has been the large majority, and in the fourth it was all six. That is the process working, not the implementers failing — every blocker in round four was a real defect, none was style.

## Hazards that only exist in parallel

### Killing sibling processes

`pkill -f workerd` is unscoped and kills **every** worktree's miniflare backend, including suites that are mid-run in other worktrees. Scope it:

```sh
pkill -f "worktrees/issue-NNN.*workerd"
```

Do **not** scope on the worktree path alone — `pkill -f "worktrees/issue-NNN"` also matches that worktree's own `vitest` and `esbuild`, so it kills the run it was meant to protect. The `.*workerd` term is load-bearing. Note also that the pattern can match the shell whose own command line contains the literal; check what you killed.

The signature of a killed backend is **a cascade of `ECONNREFUSED` / "session cookie was not issued" with zero assertion failures**. The dev server survives while its D1/KV backend dies, so the run keeps going and keeps failing, which reads as a broad breakage in whatever the branch touched. See #123, which catalogues this and five other flake causes.

### Reviewers mutating in a live worktree

Mutation testing means editing production files, and the implementer may be working in the same worktree. In round four a reviewer's mutation was swept into the implementer's commit by a concurrent `git add -A`, leaving the branch tip carrying **its own fix disabled** — green-looking and actually broken.

If a reviewer must work in the implementer's worktree:

- record `git rev-parse HEAD` and `git status --porcelain` before starting;
- restore inside the same command that runs the test, never leaving a mutation on disk across a long run;
- before reporting, confirm `git status --porcelain` is empty, `git diff HEAD --stat` is empty, and `git show --stat HEAD` lists only the implementer's files;
- say so if the tip moved while you worked.

Better: give the reviewer its own checkout. The round-four convention of pointing both at one worktree is the underlying error.

### The scratchpad is shared, and generic filenames collide

Every agent in a round is given the **same** scratchpad path. It is not per-agent. In round four two agents both wrote a PR body to `pr.md` and both ran `gh pr edit --body-file pr.md`; one PR's description was silently replaced with another ticket's, and sat that way until someone happened to look.

Name every scratch file with your issue number — `pr-196-issue172-body.md`, never `pr.md` or `body.md` — and read a file back before passing it to `--body-file`. A collision between two _similar_ documents will not announce itself the way a completely different ticket did.

The dangerous case is not PR prose. Agents routinely save backups of production files there under names like `renderModel.orig.ts`, `composable.orig.ts`, `store.orig.ts`. **Never restore a production file from a scratchpad backup** — restore from git objects (`git checkout HEAD -- <path>`), which cannot have been written by somebody else.

### Root-invoked tooling walks the worktrees

`eslint .` from the repository root linted every checkout under `.claude/worktrees/` and `.worktrees/` — 28 of them — and died at a 4 GB heap (#212, fixed by ignoring both). Nobody had hit it because agents run lint _inside_ a worktree, where no nested ones exist.

The general lesson outlives the specific fix: a parallel round puts complete copies of the repository inside the repository, and any root-invoked tool that walks the tree will find them. When a command behaves differently from the root than from a worktree, suspect this first.

### Stale snapshots

A fact about a branch someone is actively working on has a timestamp, not a standing truth. In round four the same branch produced two wrong conclusions this way — an "untracked file" that had been committed minutes earlier, and "inflated verification counts" that had already been restated. Both readings were sound; only the tree was old. `git fetch` before checking, and say which commit you looked at.

### Reviewing in a scratch copy

The safe answer to the previous hazard is to give the reviewer its own copy: `rsync` the worktree to a scratch directory named for the issue, symlink `node_modules`, and **prove the isolation with a sentinel edit before trusting a single result**. Two things it needs that are not obvious:

- `.nuxt` must be copied **and** regenerated (`./node_modules/.bin/nuxt prepare`), because `tsconfig.json` extends `./.nuxt/tsconfig.json` and every suite otherwise dies with `Tsconfig not found`.
- `pnpm` refuses to run in the copy (`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`), so invoke `./node_modules/.bin/vitest` directly.

It works for the unit suite. **It does not work for the Nuxt suite** without widening Vite's `fs.allow`, because the symlinked `node_modules` resolves to a realpath outside the scratch root — and widening it makes the run diverge from the real one. For Nuxt-suite mutation work, mutate in place but restore from git objects (`git checkout HEAD -- <path>`) rather than from any backup file, and assert the file's hash against `git show HEAD:<path>` after **every** row.

### Everyone running the integration suite at once

Three concurrent `test:integration:run` passes at load 10–26 make every number worthless in both directions. Serialise it: one authoritative run, on a quiet machine, against the merged result. Per-branch integration numbers taken under load are not evidence of anything.

A branch may legitimately skip the suite if its change set cannot reach it — but the argument must be **stated so a reviewer can reject it**, not used as a reason to stay silent. The good form: "nothing under `test/integration/` imports this; if that argument is wrong, the right response is to run the suite rather than to trust it."

## What a review owes

- **Reproduce claimed mutation tables rather than reading them.** A claimed table that does not hold has happened here, and a test that passes with the bug reintroduced is this project's most expensive recurring defect.
- **Report per row: confirmed / refuted / not attempted.** "Not attempted" stated plainly is worth more than a confident gloss.
- **Distinguish proved from suspected**, explicitly, at the end.
- **"I could not establish this" is a good answer.** So is "I looked for a case where X breaks and concluded none exists", which is stronger than failing to find one.
- **Verify claims about provenance.** `git log --oneline -- <path>` settles which ticket introduced or guarded something; round four found a security runbook attributing a guard to the wrong ticket.
- **Check whether a shared test stub or helper changed the conditions pre-existing tests run under.** Passing is weaker than detecting: re-run an old mutation to confirm the old tests still bite.

## What an implementer owes

- State what was **not** run and why, rather than omitting it.
- When a ticket's own text turns out to be wrong, say so and prove it by execution — this has happened repeatedly and the implementer has usually been right.
- Record adjacent defects rather than fixing them. Round four's out-of-scope findings became #197, #198, #203–#208.
- Prefer pinning a fix with a test over fixing it, where the defect is one a future edit could silently reintroduce.

## Merging

Merge commits, not squashes, with a subject naming the issues and a body stating what the review found and what the remediation closed. The merge message is where a reader learns why the branch took two rounds.

Before merging, confirm the tip is what you think it is, and that the branch's remediation actually landed — a report saying "actioned" is not evidence of action.

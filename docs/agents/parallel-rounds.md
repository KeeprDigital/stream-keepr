# Running a parallel round

How this repo runs several tickets at once across git worktrees, and the hazards that only exist when it does. Written from the fourth such round (#160, #167, #170+#188, #172, #178, #184+#190) so the working knowledge stops living in finished conversations. Issue #191 asked for this.

## The shape

One worktree per ticket group, under `.claude/worktrees/issue-<n>`, branched from one fixed point. Each branch runs:

**implement → fresh-context review → remediation → verification by the same reviewer → merge**

The review is _fresh-context_ on purpose: a reviewer that watched the implementation inherits its blind spots. The verification afterwards is by the **same** reviewer, because the question there is narrow — "is the thing I found closed?" — and a second fresh context would have to rediscover the finding before it could judge the fix.

A new worktree is not a working checkout until it has been given the two gitignored files git could not bring it — see "A fresh worktree has no local configuration" below. Do that at creation time; the failures it prevents do not look like configuration.

Group tickets by **file locality**, not by theme. Two tickets that touch the same file belong on one branch even if they are unrelated; two tickets on the same subject belong on separate branches if they touch different files. Conflicts cost more than context switching.

Expect most branches to come back FIX FIRST. Across four rounds it has been the large majority, and in the fourth it was all six. That is the process working, not the implementers failing — every blocker in round four was a real defect, none was style.

## Hazards that only exist in parallel

### A fresh worktree has no local configuration

`.env` and `.dev.vars` are both gitignored, so `git worktree add` brings neither. Copy them in as the first thing you do:

```sh
cp .env .dev.vars .claude/worktrees/issue-NNN/
```

`.env` is what the test suites and `nuxt dev` read; `.dev.vars` is what `nuxt dev` adopts its `NUXT_`-prefixed names from (`build/devVarsModule.ts`) and what `pnpm preview` stages for Wrangler. Neither has an example file that is a substitute — `.env.example` and `.dev.vars.example` ship their names with empty values.

The word "stages" is load-bearing and was wrong here for several rounds. Wrangler resolves `.dev.vars` against the directory of its **config file**, and `pnpm preview` passes `--config .output/server/wrangler.json` — so the file it opens is `.output/server/.dev.vars`, and the repository root's copy reached it through nothing at all. Copying `.dev.vars` into the worktree was **necessary and not sufficient**: an agent who followed this page exactly still got a previewed Worker with no environment variables and a 503 from the first authored request, with nothing anywhere naming the cause. #274 added the staging step to `pnpm preview`, so the sentence above is now true; before it, this page was confidently telling people the wrong thing.

What makes this a hazard rather than a chore is that the omission does not present as one. #130 catalogues the case: without `NUXT_ABLY_API_KEY` two named integration tests used to fail, and **two** agents in one round concluded from that they were pre-existing failures on `main`. The second went further and reproduced them at the merge-base in a worktree it created for the purpose, which is textbook control-group method and was worthless here — every fresh worktree has the identical missing file, so reproducing in another one confirms nothing. A more careful control produced a _more confident_ wrong answer.

Two mechanisms now say so out loud, and both are worth knowing about because each covers only its own half:

- The integration suite skips the two realtime tests and announces the reason once before anything runs (#223), and diagnoses a key Ably rejects rather than letting it read as a lease bug (#242). A run with no key is green with two skips and a notice, not two failures.
- A `nuxt dev` that finds no `.dev.vars` warns once, naming both files and the copy step (#130). Without it, `pnpm dev` in a worktree answers 503 from Graphics Administrator operations and Screen Output asset capabilities separately, each with a message about itself and none about the common cause.

A third now covers the harnesses themselves: an acceptance harness is its own `node` process and inherits neither notice, so before it opens an installation it checks that this checkout can supply `NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY` and stops with a named cause if it cannot (#274, `scripts/graphics-acceptance/local-configuration.mjs`). Only that one name — no acceptance route is an admin route, so a blank `NUXT_GRAPHICS_ADMIN_TOKEN` cannot stop a run and is not checked. `--deployed` runs are not gated on local files at all. Copy the files.

### Killing sibling processes

`pkill -f workerd` is unscoped and kills **every** worktree's miniflare backend, including suites that are mid-run in other worktrees. Scope it:

```sh
pkill -f "worktrees/issue-NNN.*workerd"
```

Do **not** scope on the worktree path alone — `pkill -f "worktrees/issue-NNN"` also matches that worktree's own `vitest` and `esbuild`, so it kills the run it was meant to protect. The `.*workerd` term is load-bearing. Note also that the pattern can match the shell whose own command line contains the literal; check what you killed.

The signature of a killed backend is **a cascade of `ECONNREFUSED` / "session cookie was not issued" with zero assertion failures**. The dev server survives while its D1/KV backend dies, so the run keeps going and keeps failing, which reads as a broad breakage in whatever the branch touched. See #123, which catalogues this and five other flake causes.

Round nine added the reaping half: SIGTERM to a `workerd` PID found by `lsof` **releases the port but leaves the process alive**, and `kill -9` on the child alone invites miniflare to **respawn** it under a new PID still holding the port. The order that works is: kill the `wrangler dev` **parent** first, then the child, then re-check with a worktree-scoped `pgrep` — a port that reads free is not evidence the processes are gone.

### A local harness run is a cross-worktree write

The acceptance harnesses default to `http://127.0.0.1:8787` — a **fixed** port, not a per-worktree one. So `node scripts/run-graphics-delivery-acceptance.mjs` without `--deployed` does not talk to "your" installation; it talks to whichever worktree's `pnpm preview` happens to be listening, and these harnesses provision real Events, Screen Outputs and assets before asserting anything.

In round nine an agent ran one as a no-false-alarm control, assuming nothing was up, and wrote a full acceptance scenario into a sibling lane's local D1 and R2. It passed and disposed of its Event, so nothing was left behind — but the sibling's state was mutated by another lane for a minute, and had that run failed partway the cleanup would not have happened.

Same class as unscoped `pkill`: an action that looks worktree-local and is machine-global. Either check the port first (`lsof -nP -iTCP:8787 -sTCP:LISTEN`, then the owner's cwd via `lsof -a -p <pid> -d cwd`) or point the harness somewhere you started yourself with `STREAM_KEEPR_LOCAL_ACCEPTANCE_URL`.

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

The issue number alone is not enough, because **one agent can collide with its own earlier run**. In round nine an implementer wrote a second mutation table over `issue274-mutation-results.txt` — correctly named for its issue — and destroyed the table a reviewer had been pointed at. A branch that takes four commits produces four different truths under one filename, and overwriting is not a conflict, so nothing flags it. Name scratch artefacts with your issue number **and the tip they describe** (`issue274-438454f-mutation-results.txt`), and keep per-row logs, which are what a rebuild reads from.

The dangerous case is not PR prose. Agents routinely save backups of production files there under names like `renderModel.orig.ts`, `composable.orig.ts`, `store.orig.ts`. **Never restore a production file from a scratchpad backup** — restore from git objects (`git checkout HEAD -- <path>`), which cannot have been written by somebody else.

### ADR numbers are allocated by a read-then-write race

`docs/adr/` numbers come from a directory listing, which is correct when it is read and stale by the time it merges. A filename collision is not a merge conflict, so nothing flags it at any point: one round-three merge commit briefly held two `0003-` files side by side with git perfectly happy, and the round that produced #181 left two ADRs numbered 0002 for a fortnight.

- **Take the number at merge time, not at authoring time**, from `origin/main` at the moment of the rename. Being told the next number in advance is the same read-then-write mistake wearing a different hat.
- **Cite the ADR at its final number.** The convention here is that code docblocks cite decision records by path, so the citations are what make a late rename expensive — #181's rename touched five of them. Write the citation once the number is settled rather than writing and rewriting it.

### Commit before you mutate

`git checkout HEAD -- <path>` restores to HEAD — so run against a file carrying **uncommitted** work, it silently discards that work along with the mutation. In round five two implementers hit this the same way: each mutation-tested a remediation before committing it, restored with `git checkout HEAD --`, and reverted their own fix. One caught it because the branch tip visibly lacked the new symbols; the other because the tool surfaced the reverted contents. Mutation-test only from a committed state. The rule above ("restore from git objects") assumes the work under test is already one of those objects.

### A completed run's leftovers break the next run

A finished integration run can leave its `workerd` backends alive, and they break the **next** run in the same checkout with `No test files found` plus a `close timed out` — zero assertion failures, and nothing that looks like the ECONNREFUSED contention cascade. Round five hit this repeatedly, and at round end the machine carried two dozen stale backends from runs that had all reported success. Scoped `pkill -f "worktrees/<name>/.*workerd"` clears it; check for leftovers before an authoritative run. Catalogued on #123.

### A filtered result cannot distinguish "ran fine" from "never ran"

Round six's recurring trap, hit independently by five agents in four different costumes:

- A pipeline's exit status is the **last** command's. `pnpm lint 2>&1 | tail` reports tail's success; `git commit ... ; git log` reports git log's. Two agents published "exit 0" claims that were never true — and both times the wrong reading was the reassuring one. Isolate exit codes on their own line, or redirect to a file and check `$?` directly.
- In zsh, `local path=...` silently clobbers `PATH` (`$path` is tied to it) — git and grep vanish mid-run, restores stop happening, and an empty-vs-empty comparison prints "restore: OK". Never name a shell variable `path`. Relatedly, zsh does **not** word-split unquoted expansions: `git checkout b044587 -- $F` with `F="a b c d"` passes one four-file pathspec, fails, and the next check measures the unmodified tip — which reads as "baseline is clean". After any setup step whose purpose is to change the tree, assert the tree changed before trusting what runs next.
- A mutation that never applied reads as a survivor; a test runner missing from PATH reads as a pass. Demand a **positive success marker** (a "Test Files" line in a per-row log) and a `git diff --quiet`-style "mutation actually applied" check; re-read every _survived_ row as a diff before calling it dead.
- The generalisation, earned twice over: apply the mutation-and-verify discipline to the **instrumentation**, not just the code. Give every before/after probe a negative control — run the check against a case where it must fail before trusting the case where it passes. One reviewer's cross-version probe bundled the same module twice, so `instanceof` failed silently and the _old_ code looked broken in a flattering direction; the guard was bundling once and asserting the class is defined exactly once.

Round seven restated the family's general form — **a check whose own success criterion is looser than the reader assumes** — and added five costumes:

- `eslint` exits 0 on **warnings**. An implementer reported "exit 0" twice while its own new docblock was warning; the reviewer read the output. An exit code alone never establishes a clean lint here — require zero output lines.
- `git checkout <sha> -- <path>` updates the **index** as well as the worktree, so a later `git diff --quiet -- <path>` reads clean and a rollback looks like a no-op. The correct did-it-apply check is `git diff HEAD --quiet`.
- A mutation that fails to **compile** reads as an especially convincing kill — every test in the file fails. That signature is a broken parse, not a killed mutant. Print the applied diff on _every_ row, not only survivors, and check each kill is the intended assertion.
- A misinvoked runner ("No projects matched the filter") reads as a branch failure; `grep -c` on an empty input prints a reassuring 0. Read the error text, and require a non-empty sanity marker before trusting any count.
- Nitro's typed `$fetch` produces `TS2321 Excessive stack depth` errors of which TypeScript reports only ~two per program — **each fix reveals the next**, in files unrelated to what surfaced them. A clean run after fixing one is not evidence you are done.

And one rule earned by a review that overturned a "no constructible test covers it" claim: when verifying a merge commit, compare each changed file's blob hash against **both parents** — `git show --cc` suppresses hunks, and a combined-diff read missed one of a merge's own changes.

Round eight's additions to the same family:

- **A name-filtered run's success criterion is narrower than the conclusion it invites.** A forward control validated under `-t 'one test'` passed and was true of its row — but the full suite showed the prospective fix breaking three tests, two of them pre-existing pins the filter excluded. Plan fixes against the unfiltered number.
- **Matching hashes of nothing read as a clean comparison.** Three emit files produced three identical sha256s — of the empty string, because the tool had rejected its arguments and written nothing. Require non-empty bytes and a positive content marker before comparing hashes.
- **Prose arithmetic diverges from correct enumerations sitting directly beneath it.** Three separate reports this round carried right per-item lists under wrong totals (fifteen-for-nineteen, three-for-four, a briefing's stale suite count). Total your own enumeration before publishing it, and count call sites, not files.
- **A softened assertion needs the forward control too.** `toBe` → `toContain` was proved in both directions: the reworded throw still fails it, and the prospective fix — applied for real — passes it. "Fails when wrong, survives when improved" is the executable form of the anti-pin rule.
- **After remediating a defect class, mutate the new code for the same class.** The catch added to fix a silent failure was itself mutated to lie (`return false` → `return true`) and died. That is the one way a fix can reproduce its defect one layer down, and it costs one row.
- **A defect that is a sentence wants probes that read sentences.** Cell-probing a notice's prose in every reachable configuration found two falsehoods that assertion-shaped tests were structurally blind to — and the counter-hazard is real too: tuning wording per enumerated cell over-fits to the cells you happened to think of.

Round nine's additions to the same family:

- **A Nuxt setup-hook timeout reports as skips, and skips read as a broad kill.** Under round load, `setupNuxt`'s 30s `beforeAll` times out and the run prints "N passed | M skipped" with a non-zero exit and zero assertion failures — one reviewer's first mutation run showed "11 failed / 161 skipped" and was nothing of the sort. The signature is skips plus ~30s file durations; re-run sequentially (`--no-file-parallelism`) before believing any broad kill taken under load.
- **The Nuxt suite is config-selected, not project-selected.** `vitest --project nuxt` prints "No projects matched the filter" with exit 1 and no results line, which reads as a branch failure. It takes `--config vitest.nuxt.config.ts`.
- **A background task's completion notice reports the wrapper's exit status, not the runner's.** Three agents saw "exit code 0" over a log whose own `EXIT=1` was the truth, because the wrapper's last statement was an `echo`. Always in the reassuring direction. Read the log, never the notification.
- **A missing tool reads as a negative result.** `timeout` does not exist on this machine; `timeout 120 <probe>` returns exit 127 with empty output, which reads as "the probe ran and found nothing". Print the raw streams before trusting any empty result.
- **A negative control aimed at the wrong program is indistinguishable from a dead pin.** This repo has two typecheck programs with a deliberate exclusion between them (`tsconfig.test.json` excludes `test/nuxt/**`; the Nuxt program covers it). A planted type error that "nothing catches" may simply be outside the program you ran — a reviewer nearly filed the branch's pins as inert this way.
- **A search narrower than the claim cannot support the claim — and narrowness has independent axes.** One "unpinned" byte figure survived two searches because the literal is written `62_260` (formatting), the test spells `twelfth` not `12th` (vocabulary), and the eventual read started at line 600, below the hit (range). Any one axis produces a confident false negative. The fix is a positive control: a grep that must return zero needs a variant that must return non-zero first — `toBe(` in the same file would have found all four pins immediately.
- **Reproduce a claimed enumeration before adopting it — review findings included.** A reviewer's "zero `useFetch` sites" (grep required a bare paren; all five sites use the generic form) was offered as *strengthening* a conclusion and would have planted a falsehood in the artefact. The reproduce-the-enumeration rule cuts both ways across the review boundary.
- **Correct judgement, over-specific evidence.** Three times on one branch, a minimal reproduction proved a mechanism and then got quoted as though it were observed on the real system ("answers with silence"; "prints No bindings found"). The conclusions all survived — which is exactly why the citations weren't caught. Quote evidence from the system the claim is about, or state the uncertainty instead of either claim.
- **When a mutation row stacks two edits, apply the deletion first.** Two agents on one branch independently had a line-inserting edit shift the target of a later deletion, so the "without guard" control deleted a comment and printed the guard's own error — which reads as a passing control. Re-read the printed diff against intent, not just for presence.
- **After remediating a defect class, audit the fix's own failure mode for the same class.** The companion to round eight's mutate-the-new-code rule: round nine's preview-staging fix would have silently clobbered a hand-maintained file — the ticket's own defect, one layer up — and the warning that fixed *that* needed its own row proving it stays quiet on the ordinary path, because a warning that fires on a working configuration is the defect again in the other direction.

### Commit signing can wedge mid-round

This repo signs commits via 1Password's `op-ssh-sign`. Six concurrent signing requests wedged the agent, after which the socket died and every `git commit` in every worktree hung, then failed fast ("failed to fill whole buffer", "Could not connect to socket"). Recovery is `open -a 1Password` and a retry — not `--no-gpg-sign`, unless the round decides so deliberately and records the unsigned range for a later re-sign. Merge commits sign the same way.

Two traps that ride along:

- **`%G?` cannot answer the signing question here.** With `gpg.ssh.allowedSignersFile` unset, `%G?` prints `N` — meaning _cannot verify_ — for genuinely signed commits, and prints its own explanatory error directly above the output. **Four** round-six agents independently read that `N` as "history was never signed". The only reliable check is `git cat-file commit <sha> | grep -c gpgsig`.
- A `git commit` killed mid-hang leaves the work **staged but uncommitted** — precisely the state where the "commit before you mutate" trap destroys it. Verify `git log` before retrying, and verify a committed state before any mutation row.

### Anchor mutations by line number, and record the table where the next round can find it

Two byte-identical strings at different indentation live in one round-six file; a string-anchored mutation hit the wrong one and got reported as a control it wasn't. Anchor by line number with a substring assertion on the anchor line. And post the final mutation table as a comment on the issue at close time: #230's table was never durably recorded, and reconstructing it cost round six a branch's second acceptance criterion. Reports and verdicts likewise: send them on the teammate channel — plain text output reaches nobody, and six round-six agents had to be chased for reports they believed they had filed.

Round seven added three refinements to what a recorded table owes:

- **Record each row's mutation _verbatim_**, not as a description. Twice now a row's wording admitted two faithful readings whose verdicts diverged over time — #230's row 5 had a reading that #245 later made survive, and #241's X2 "dead" verdict was refuted by a fixture its runner set contained all along.
- **"Dead" verdicts age worse than kills.** A killed row is a fact about one run; a dead row is a claim about every test in the runner set — so a survivor row must name the runner set it survived, or it cannot be re-checked.
- **Pin only behaviour someone has decided is correct.** A pin on undecided behaviour in an unreachable state _enshrines_ the defect: the eventual fix reads as a regression. Round seven twice chose a docblock note over a pin for exactly this reason. This is the counterweight to "prefer pinning a fix with a test", and both rules are right.

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

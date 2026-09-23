# Running a parallel round

How this repo runs several tickets at once across git worktrees, and the hazards that only exist when it does. Written from the fourth such round (#160, #167, #170+#188, #172, #178, #184+#190) so the working knowledge stopped living in finished conversations — issue #191 asked for it — and extended by every round since, sixteen at the time of writing.

**It is organised by hazard class, not by round.** Round numbers stay as evidence: an entry saying a thing happened in four separate rounds is telling you how much to trust it, and how likely you are to be next. When you add to this page, put the entry with its family rather than at the end.

**Read it for signatures, not for reassurance.** Most entries exist because a wrong reading was the comfortable one.

## The shape

One worktree per ticket group, under `.claude/worktrees/issue-<n>`, branched from one fixed point. Each branch runs:

**implement → fresh-context review → remediation → verification by the same reviewer → merge**

The review is _fresh-context_ on purpose: a reviewer that watched the implementation inherits its blind spots. The verification afterwards is by the **same** reviewer, because the question there is narrow — "is the thing I found closed?" — and a second fresh context would have to rediscover the finding before it could judge the fix.

A new worktree is not a working checkout until it has been given the gitignored configuration git could not bring it — see [A fresh worktree has no local configuration](#a-fresh-worktree-has-no-local-configuration). Do that at creation time; the failures it prevents do not look like configuration.

Group tickets by **file locality**, not by theme. Two tickets that touch the same file belong on one branch even if they are unrelated; two tickets on the same subject belong on separate branches if they touch different files. Conflicts cost more than context switching.

**Cap a round at five or six lanes.** Eight exceeded this machine in round twelve: load passed 120, `sysmond` died, LaunchServices stopped resolving apps, and the 1Password agent crash-restarted with its socket dead.

Expect most branches to come back FIX FIRST. Across sixteen rounds it has been the large majority — all six in round four, all six in round sixteen. That is the process working, not the implementers failing: every blocker in round four was a real defect, none was style. Rounds thirteen through sixteen are worth noting for what the blockers _were_ — every one a documentation truth or a pin-coverage gap, none behavioural.

---

## Handoff and protocol

Rounds twelve through sixteen were dominated by one failure: **two messages in flight handing one worktree to two agents, with neither side seeing the collision.** It happened three ways in round fourteen alone, three more in round fifteen, and three on a single lane in round sixteen.

The protocol that came out of it:

- **The lead sends an explicit two-way token** — "worktree yours at `<sha>`" — in each direction. Nobody enters a worktree on a verdict or a report alone.
- **A token to anyone voids every prior standing instruction on that worktree**, for every holder. Only the lead's latest token counts, and after any crossing the lead restates who holds.
- **The lead issues a token only after the counterpart's explicit release confirmation.** A lead who has queued anything to a reviewer must withdraw or confirm it before issuing anyone else a token for that tree — a reviewer that released and then drained a queued addendum re-entered a tree already handed on (round fifteen). Mailboxes drain at the receiver's next turn, so "released" is not final while anything addressed to that agent is unprocessed.
- **Report and stand-down are two separate messages.** Bundled, the lead cannot accept the report and reject the handover separately.
- **Send the stand-down after the last command of any kind** — including empty commits and control restores. "Finished mutating" and "finished committing" are both too early: one implementer ran a post-commit control row after reporting, another landed a record-only EMPTY commit after its token.
- **Implementer and reviewer must not hold the same worktree simultaneously.** An implementer re-verifying its mutation table mid-review handed the reviewer a mutated tree at a hash-verified-clean tip; the reviewer's anomalous run reproduced one mutation row's exact two-test signature (round twelve). Once a review is dispatched, the implementer's worktree access ends until the verdict.
- **An implementer with a queued or deferred authoritative run must not mutate** until that run has happened or been cancelled — otherwise it fires against a mutated tree, which is the two-agents-one-worktree hazard with one agent. Cancel the pending run first, then re-queue it after the rows.

### The staleness gate

Protocol fails anyway, so make the failure detectable in one command:

**`git rev-parse <token-sha>^{tree}` vs `HEAD^{tree}`, as a precondition of every verification pass, checked unconditionally on _both_ sides.**

It caught all three of round sixteen's crossings and never cost more than a rev-parse pair. Senders re-read the tip at send time; receivers treat any mismatch as STOP-and-report, **never reconcile by moving the tip**.

The worst variant is a superseding token that adds new work at an old sha, because the natural compliance path — checking out the token's sha "to match" — silently discards the newer commit. **The failure mode is a lost commit, not a refused edit.**

Supporting detection: **record `git rev-parse HEAD` per mutation row, not per pass.** A tree-identical commit moves the tip without disturbing any cleanliness check.

### Reports are the record

- **Send reports and verdicts on the teammate channel.** Plain text output reaches nobody; six round-six agents had to be chased for reports they believed they had filed.
- **Paste the full mutation table verbatim in the report body.** A round-eleven machine crash wiped every mutation log in the shared scratchpad, and the messages already sent were the only surviving copies. The file is a convenience; the message is the record. (The crash was otherwise survivable: every lane resumed from staged or committed state, and index blobs served as mutation baselines via `git rev-parse :<path>` where a commit could not be made.)
- **When the tracker is unreachable, the spec axis is NOT ATTEMPTED, not waved through.** GitHub was down for every reviewer in one round; each said so explicitly and verified against the relayed brief instead. Re-check the literal ticket text at close time, which needs the tracker anyway.

---

## Worktree isolation

### A fresh worktree has no local configuration

`.env` is gitignored, so `git worktree add` does not bring it. Copy it in as the first thing you do:

```sh
cp .env .claude/worktrees/issue-NNN/
```

`.env` is the whole of local configuration: the test suites and `nuxt dev` read it, and `pnpm preview` stages it for Wrangler. `.env.example` is not a substitute — it ships its names with empty values.

**The local auth bypass is not in that file and must never be put there** (#519, ADR-0017). A worktree that wants to work without signing in runs one of the `:bypass` launchers (`pnpm dev:bypass`, `pnpm preview:bypass`); those set the one name, `STREAM_KEEPR_LOCAL_AUTH_BYPASS`, and nothing else does. Adding it to `.env` to make the choice stick is the one thing to never do here — `.env` is the file this page tells you to copy between worktrees, which is exactly why the name is kept out of it.

**Copying is necessary and not sufficient.** The word "stages" is load-bearing and was wrong on this page for several rounds. Wrangler resolves the file it reads against the directory of its **config file**, and `pnpm preview` passes `--config .output/server/wrangler.json` — so the file it opens is `.output/server/.env`, and the repository root's copy reaches it through nothing at all. An agent who followed this page exactly still got a previewed Worker with no environment variables and a 503 from the first authored request, with nothing anywhere naming the cause. #274 added the staging step, so the sentence is now true; before it, this page was confidently telling people the wrong thing.

There were two files until #412, and the second one, `.dev.vars`, is why this section used to be twice as long. The reason recorded for it — that Wrangler would not read `.env` — was measured false, and while it stood, the three `NUXT_MELEE_*` names that only ever lived in `.env` could not reach a previewed Worker at all: Wrangler reads one of the two files and prefers the other one. A worktree branched from before that ticket may still have a `.dev.vars`; nothing reads it now, and `pnpm preview` deletes the staged copy if it finds one.

**`git worktree add` ships neither `node_modules` nor `.nuxt`.** All six lanes of round thirteen started without them. `pnpm install --frozen-lockfile` — whose postinstall `nuxt prepare` generates `.nuxt` — is a heavy run; do not start one while suites are running.

**The main checkout may not have `.env` either.** In the #366/#368/#370 round it did not, three lanes independently rediscovered the absence, and the instruction above read as a provisioning failure when there was simply nothing to copy. If `ls` on the repository root shows only the `.example` file, say so in your report and move on: the suites run in the announced no-key state (green with two realtime skips and a notice), `helpers.ts` invents the admin token and signing key itself, and the green you get is **a no-key green, which the report should name**.

**What makes this a hazard rather than a chore is that the omission does not present as one.** #130 catalogues the case: without `NUXT_ABLY_API_KEY` two named integration tests used to fail, and **two** agents in one round concluded they were pre-existing failures on `main`. The second went further and reproduced them at the merge-base in a worktree it created for the purpose — textbook control-group method, and worthless here, because every fresh worktree has the identical missing file. **A more careful control produced a more confident wrong answer.**

Never treat the two named realtime failures/skips as a branch defect, and never conclude "pre-existing failure on main" from a worktree whose configuration you have not compared against the main checkout's.

Three mechanisms now say so out loud, and each covers only its own half:

- The integration suite skips the two realtime tests and announces the reason once before anything runs (#223), and diagnoses a key Ably rejects rather than letting it read as a lease bug (#242). A run with no key is green with two skips and a notice, not two failures.
- A `nuxt dev` whose environment cannot supply the required names warns once, naming the file and the copy step (#130). Without it, `pnpm dev` in a worktree answers 503 from Graphics Administrator operations and Screen Output asset capabilities separately, each with a message about itself and none about the common cause.
- An acceptance harness is its own `node` process and inherits neither notice, so before it opens an installation it checks that this checkout can supply `NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY`, `NUXT_BETTER_AUTH_SECRET` and `NUXT_ADMIN_BOOTSTRAP_TOKEN` — the last two since #396, when `/api/**` began denying by default — and stops with a named cause if it cannot (#274, `scripts/graphics-acceptance/local-configuration.mjs`). Those three and no more: no acceptance route is an admin route, so a blank `NUXT_GRAPHICS_ADMIN_TOKEN` cannot stop a run. `--deployed` runs are not gated on local files at all.

### Root-invoked tooling walks the worktrees

`eslint .` from the repository root linted every checkout under `.claude/worktrees/` and `.worktrees/` — 28 of them — and died at a 4 GB heap (#212, fixed by ignoring both). Nobody had hit it because agents run lint _inside_ a worktree, where no nested ones exist.

The general lesson outlives the specific fix: **a parallel round puts complete copies of the repository inside the repository**, and any root-invoked tool that walks the tree will find them. When a command behaves differently from the root than from a worktree, suspect this first.

### A local harness run is a cross-worktree write

The acceptance harnesses default to `http://127.0.0.1:8787` — a **fixed** port, not a per-worktree one. So `node scripts/run-graphics-delivery-acceptance.mjs` without `--deployed` does not talk to "your" installation; it talks to whichever worktree's `pnpm preview` happens to be listening, and these harnesses provision real Events, Screen Outputs and assets before asserting anything.

In round nine an agent ran one as a no-false-alarm control, assuming nothing was up, and wrote a full acceptance scenario into a sibling lane's local D1 and R2. It passed and disposed of its Event, so nothing was left behind — but the sibling's state was mutated by another lane for a minute, and had that run failed partway the cleanup would not have happened.

Same class as unscoped `pkill`: an action that looks worktree-local and is machine-global. Either check the port first (`lsof -nP -iTCP:8787 -sTCP:LISTEN`, then the owner's cwd via `lsof -a -p <pid> -d cwd`) or point the harness somewhere you started yourself with `STREAM_KEEPR_LOCAL_ACCEPTANCE_URL`.

### Reviewers mutating in a live worktree

Mutation testing means editing production files, and the implementer may be working in the same worktree. In round four a reviewer's mutation was swept into the implementer's commit by a concurrent `git add -A`, leaving the branch tip carrying **its own fix disabled** — green-looking and actually broken.

The structural answer is the handoff protocol above: the two never hold the tree at once. Where a reviewer must work in the implementer's worktree anyway:

- record `git rev-parse HEAD` and `git status --porcelain` before starting;
- restore inside the same command that runs the test, never leaving a mutation on disk across a long run;
- before reporting, confirm `git status --porcelain` is empty, `git diff HEAD --stat` is empty, and `git show --stat HEAD` lists only the implementer's files;
- say so if the tip moved while you worked.

Better: give the reviewer its own checkout. The round-four convention of pointing both at one worktree is the underlying error.

### Reviewing in a scratch copy

`rsync` the worktree to a scratch directory named for the issue, symlink `node_modules`, and **prove the isolation with a sentinel edit before trusting a single result**. Two things it needs that are not obvious:

- `.nuxt` must be copied **and** regenerated (`./node_modules/.bin/nuxt prepare`), because `tsconfig.json` extends `./.nuxt/tsconfig.json` and every suite otherwise dies with `Tsconfig not found`.
- `pnpm` refuses to run in the copy (`ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`), so invoke `./node_modules/.bin/vitest` directly.

It works for the unit suite. **It does not work for the Nuxt suite** without widening Vite's `fs.allow`, because the symlinked `node_modules` resolves to a realpath outside the scratch root — and widening it makes the run diverge from the real one. For Nuxt-suite mutation work, mutate in place but restore from git objects (`git checkout HEAD -- <path>`) rather than from any backup file, and assert the file's hash against `git show HEAD:<path>` after **every** row.

### The scratchpad is shared, and generic filenames collide

Every agent in a round is given the **same** scratchpad path. It is not per-agent. In round four two agents both wrote a PR body to `pr.md` and both ran `gh pr edit --body-file pr.md`; one PR's description was silently replaced with another ticket's, and sat that way until someone happened to look.

- **Name every scratch file with your issue number _and the tip it describes_** — `issue274-438454f-mutation-results.txt`, never `pr.md`, and not even `issue274-mutation-results.txt`. The issue number alone is not enough, because **one agent can collide with its own earlier run**: in round nine an implementer wrote a second mutation table over a correctly-named file and destroyed the table a reviewer had been pointed at. A branch that takes four commits produces four different truths under one filename, and overwriting is not a conflict, so nothing flags it.
- **Read a file back before passing it to `--body-file`.** A collision between two _similar_ documents will not announce itself the way a completely different ticket did.
- **Keep per-row logs**, which are what a rebuild reads from.
- **It is not durable.** A machine crash wiped it entirely in round eleven.
- **Never restore a production file from a scratchpad backup.** Agents routinely save backups of production files there under names like `renderModel.orig.ts`, `composable.orig.ts`, `store.orig.ts`. Restore from git objects (`git checkout HEAD -- <path>`), which cannot have been written by somebody else.

### ADR numbers are allocated by a read-then-write race

`docs/adr/` numbers come from a directory listing, which is correct when it is read and stale by the time it merges. A filename collision is not a merge conflict, so nothing flags it at any point: one round-three merge commit briefly held two `0003-` files side by side with git perfectly happy, and the round that produced #181 left two ADRs numbered 0002 for a fortnight.

- **Take the number at merge time, not at authoring time**, from `origin/main` at the moment of the rename. Being told the next number in advance is the same read-then-write mistake wearing a different hat.
- **Cite the ADR at its final number.** The convention here is that code docblocks cite decision records by path, so the citations are what make a late rename expensive — #181's rename touched five of them. Write the citation once the number is settled rather than writing and rewriting it.

`docs/adr/README.md` is the index, and carries the same rule beside the record template.

---

## Processes: killing, reaping, waiting

### Killing sibling processes

`pkill -f workerd` is unscoped and kills **every** worktree's miniflare backend, including suites that are mid-run in other worktrees. Scope it:

```sh
pkill -f "worktrees/issue-NNN.*workerd"
```

Do **not** scope on the worktree path alone — `pkill -f "worktrees/issue-NNN"` also matches that worktree's own `vitest` and `esbuild`, so it kills the run it was meant to protect. The `.*workerd` term is load-bearing.

- **`pkill -f` patterns are ERE.** A `+` in a package path is a quantifier; one round-close reap silently matched nothing until the pattern was rewritten.
- **The pattern can match the shell whose own command line contains the literal.** In round sixteen one `pkill -f` killed its OWN launcher, because a single Bash call both wrote and launched the script — leaving the runner orphaned at PPID 1 while the harness reported it dead. That is the reassuring-direction lie inverted, and trusting it would have raced two chains. **Create-script and launch-script are separate calls.** Check what you killed.
- **`kill` can return success while the process survives.** A `trap cleanup TERM` that does not `exit` swallows the signal; the chain kept polling and needed `kill -9`. Use `trap 'cleanup; exit 143' TERM INT` beside `trap cleanup EXIT`.
- **Order matters for workerd.** SIGTERM to a `workerd` PID found by `lsof` **releases the port but leaves the process alive**, and `kill -9` on the child alone invites miniflare to **respawn** it under a new PID still holding the port. Kill the `wrangler dev` **parent** first, then the child, then re-check with a worktree-scoped `pgrep`. A port that reads free is not evidence the processes are gone.

**The signature of a killed backend is a cascade of `ECONNREFUSED` / "session cookie was not issued" with zero assertion failures.** The dev server survives while its D1/KV backend dies, so the run keeps going and keeps failing, which reads as a broad breakage in whatever the branch touched. See #123, which catalogues this and five other flake causes.

### `pgrep` is not to be trusted unchecked

Five costumes, all reading as a reassuring zero:

- **It self-matches** — in kills, and equally in wait loops. An `until ! pgrep -f <pattern>` loop never terminated because the pattern matched its own shell's command line, long after the awaited process had exited (round ten). Reading the log answered immediately.
- **`pgrep -fc` is not a count on macOS** — it errors or prints nothing, and an empty result reads as zero (round thirteen).
- **`pgrep -fl | wc -l` over-counts** when a matched command line contains newlines: 69 reported, 2 real (round sixteen). Your own poll loops are the likeliest self-match.
- **A broken `pgrep` piped to `wc -l` reads as zero.** When `sysmond` died under round twelve's load, `pgrep`/`pkill` failed with "Cannot get process list".
- **Use a known-alive control.** `pgrep -fl launchd` proves pgrep itself works before you believe any count.

### Leftovers, load, and telling them apart

A finished integration run can leave its `workerd` backends alive, and they break the **next** run in the same checkout with `No test files found` plus a `close timed out` — zero assertion failures, and nothing that looks like the ECONNREFUSED contention cascade. Round five hit this repeatedly, and at round end the machine carried two dozen stale backends from runs that had all reported success. Scoped `pkill -f "worktrees/<name>/.*workerd"` clears it.

**But machine load produces the identical log** (round eleven). **Check load before killing anything** — one agent reaped backends it did not need to.

**Check for leftover `workerd` at every handoff, not just after your own suites.** One release check found a backend predating that agent's entire tenure; the main checkout collects them too, and one round-close gate reaped one there.

### Waiting, and the ten-minute ceiling

- **Wait on an explicit exit marker, never on log non-emptiness.** `until [ -s log ]` fired on pnpm's own `$ eslint .` banner, and an in-progress lint read as a finished clean one.
- **The Bash tool SIGTERMs foreground commands at ten minutes.** Any wait loop or long chain written with a longer timeout dies at 10:00 exit 143, mid-whatever it was doing. Background anything that can run long, and check afterwards what state the kill left behind.

### Machine capacity

Cap rounds at five or six lanes, and treat full-repo eslint and typecheck as **heavy** — six concurrent `eslint .` runs were round twelve's proximate overload. Single-file test runs and file writes are always fine; avoid launching several suites, builds, lints, or typechecks at the same moment.

### Commit signing

This repo signs commits via 1Password's `op-ssh-sign`. Six concurrent signing requests wedged the agent, after which the socket died and every `git commit` in every worktree hung, then failed fast ("failed to fill whole buffer", "Could not connect to socket"). Recovery is `open -a 1Password` and a retry — **not** `--no-gpg-sign`, unless the round decides so deliberately and records the unsigned range for a later re-sign. Merge commits sign the same way.

**Background nothing that signs, and avoid signing many commits at the same moment.** A harness timeout that kills a commit mid-sign orphans an `op-ssh-sign` and leaves work staged-but-uncommitted.

Two traps that ride along:

- **`%G?` cannot answer the signing question here.** With `gpg.ssh.allowedSignersFile` unset, `%G?` prints `N` — meaning _cannot verify_ — for genuinely signed commits, and prints its own explanatory error directly above the output. **Four** round-six agents independently read that `N` as "history was never signed". The only reliable check is `git cat-file commit <sha> | grep -c gpgsig`.
- **A `git commit` killed mid-hang leaves the work staged but uncommitted** — precisely the state where the "commit before you mutate" trap destroys it. Verify `git log` before retrying, and verify a committed state before any mutation row.

---

## Mutation testing

### Commit before you mutate

`git checkout HEAD -- <path>` restores to HEAD — so run against a file carrying **uncommitted** work, it silently discards that work along with the mutation. In round five two implementers hit this the same way: each mutation-tested a remediation before committing it, restored with `git checkout HEAD --`, and reverted their own fix. One caught it because the branch tip visibly lacked the new symbols; the other because the tool surfaced the reverted contents. **Mutation-test only from a committed state.**

**This applies to any command chain ending in a restore, not just mutation rows.** In round fourteen a lint positive control restored its planted violation from HEAD and silently discarded the uncommitted remediation sharing the file; the diff stat showing three changed files where four had been was the catch. A sibling near-miss the same round: a control restoring with `git checkout -- <file>` restores from the **index** and eats uncommitted work the same way. Controls want untracked scratch files or a committed-state precondition.

### Applying a row

- **Anchor by line number with a substring assertion on the anchor line.** Two byte-identical strings at different indentation live in one round-six file; a string-anchored mutation hit the wrong one and got reported as a control it wasn't.
- **But anchor by unique string at run time when citing.** A verbatim quote survives a wrong line number; a bare line number does not survive anything — one reviewer cited the right sentence at the wrong line and the implementer found it anyway because the words were quoted. Remediation commits shift every line number below them, and three of one lane's eight recorded rows drifted by one before verification. **Restate a table's line numbers at the final tip** before it goes on the issue.
- **Sort a row's stacked edits by descending line number within each file.** Round nine's deletion-first rule did not cover insert-above-insert: two inserts in one file shifted the second's anchor and aborted a row, and a third agent's stack silently deleted the wrong line. Bottom-up ordering covers every case deletion-first covered and the ones it did not.
- **Validate EVERY anchor before touching the disk.** A helper that validates anchors as it applies leaves earlier edits on disk when a later anchor misses. The aborted row printed nothing and did not read as a result; only porcelain caught the half-applied state.
- **Gate an insert-position anchor on the line AFTER the insert too.** A probe inserted two statements after a closing `});` one line off, broke the parse, and the run printed `Tests no tests`. Abort the chain on an anchor miss rather than printing a marker and continuing.
- **Print the applied diff on _every_ row, not only survivors**, and re-read it against intent rather than for presence. A mutation that fails to **compile** reads as an especially convincing kill — every test in the file fails. That signature is a broken parse, not a killed mutant.
- **Check the did-it-apply question correctly.** `git checkout <sha> -- <path>` updates the **index** as well as the worktree, so a later `git diff --quiet -- <path>` reads clean and a rollback looks like a no-op. The correct check is `git diff HEAD --quiet`.
- **A `git diff HEAD` pre-image is not evidence about the disk** — its pre-image is HEAD's blob by definition. A reviewer clearing a contamination window needs the post-image: reconstruct each mutated file from the committed blob plus the row's edit, hash both, and require the hashes to differ across rows. Three identical hashes is the matching-hashes-of-nothing trap wearing a lab coat.

### Reading a row

- **Attribute kills by assertion values plus the FAIL-header test name, never by frame** — see [The frames lie](#the-frames-lie). Where two assertions share a value, plant a sentinel expectation to prove which one died.
- **Audit every row by test name; a runner's failure total is not a kill count.** One flaky test (a 5s timeout under round load) landed inside three separate mutation runs on one branch and inflated three recorded rows by one failure and one file each. The single row a reviewer questioned prompted the audit that found the other two.
- **Re-read every _survived_ row as a diff before calling it dead**, and demand a **positive success marker** — a "Test Files" line in a per-row log — plus a `git diff --quiet`-style "mutation actually applied" check. A mutation that never applied reads as a survivor; a test runner missing from PATH reads as a pass.
- **Run the command, then write the number.** One lane produced two self-caught fabrications: a commit message asserting a mutation result before the row had run, and a release token citing a made-up tree-hash prefix inside a correctness precondition — which would have made a VALID verification pass read as a moved tip. Fabricated specifics inside gates alarm in the wrong direction. State provenance ("last observed at…") when a number cannot be re-read without re-entering a tree.

### What a recorded table owes

Post the final mutation table as a comment on the issue at close time. #230's table was never durably recorded, and reconstructing it cost round six a branch's second acceptance criterion.

- **Record each row's mutation _verbatim_**, not as a description. Twice now a row's wording admitted two faithful readings whose verdicts diverged over time — #230's row 5 had a reading that #245 later made survive, and #241's X2 "dead" verdict was refuted by a fixture its runner set contained all along.
- **"Dead" verdicts age worse than kills.** A killed row is a fact about one run; a dead row is a claim about every test in the runner set — so a survivor row must **name the runner set it survived**, or it cannot be re-checked.
- **State the failed/PASSED convention once.** Two rows in one lane recorded failed/TOTAL amid eight failed/PASSED siblings, and the table read as self-contradictory at close time. Whichever convention, the table states it.
- **Derive restorations from the BASE**, not from an intermediate commit whose form may already contain the fix — which would forge a passing control.

### After a fix

- **Mutate the new code for the same defect class.** The catch added to fix a silent failure was itself mutated to lie (`return false` → `return true`) and died. That is the one way a fix can reproduce its defect one layer down, and it costs one row.
- **Audit the fix's own failure mode for the same class.** Round nine's preview-staging fix would have silently clobbered a hand-maintained file — the ticket's own defect, one layer up — and the warning that fixed _that_ needed its own row proving it stays quiet on the ordinary path, because a warning that fires on a working configuration is the defect again in the other direction.
- **A softened assertion needs the forward control too.** `toBe` → `toContain` was proved in both directions: the reworded throw still fails it, and the prospective fix — applied for real — passes it. "Fails when wrong, survives when improved" is the executable form of the anti-pin rule.
- **Pin only behaviour someone has decided is correct.** A pin on undecided behaviour in an unreachable state _enshrines_ the defect: the eventual fix reads as a regression. Round seven twice chose a docblock note over a pin for exactly this reason. This is the counterweight to "prefer pinning a fix with a test", and both rules are right.

---

## Instruments and controls

Round six's recurring trap, hit independently by five agents in four different costumes, restated by round seven in its general form and joined by a new costume every round since:

> **A check whose own success criterion is looser than the reader assumes.**

Almost every instance below was caught by a control, never by the comparison itself — and almost every wrong reading was the reassuring one.

### Both controls, first

**A grep that must return zero needs a variant that must return non-zero first.** Run every probe against a case where it must fail before trusting the case where it passes, and apply the mutation-and-verify discipline to the **instrumentation**, not just the code.

- **Controls both ways.** A string that must be present and one that must be absent, then read the block itself.
- **Key controls to names, not positions.** A comment-only-proof instrument's negative control pointed at `FILES[n]`; an edit to the array shifted `n` and the control targeted a file where it could not run.
- **A control that passes vacuously is the trap forging its own control.** In round ten's worst case the negative control _also_ hashed nothing. One reviewer's cross-version probe bundled the same module twice, so `instanceof` failed silently and the _old_ code looked broken in a flattering direction; the guard was bundling once and asserting the class is defined exactly once.

### Matching hashes of nothing

Three emit files produced three identical sha256s — of the empty string, because the tool had rejected its arguments and written nothing. Hit in rounds eight, ten and fifteen; five times in round ten alone, twice by reviewers checking someone else's recovery from it.

**Require non-empty bytes and a positive content marker on every input, run a control that must differ, and never route the tool's stderr to `/dev/null`.** A comparison's positive half must be stated as loudly as the comparison.

Three lanes independently hit `tsc` emitting NOTHING (TS5112 when files are named beside a loaded tsconfig — cured by `--ignoreConfig`, or sidestepped by `ts.transpileModule`), and one hit esbuild emitting nothing on a bad `--loader`. Every one was caught by the non-empty-bytes gate or by control B failing — **never by the hash comparison**, which would have matched empty against empty.

### Exit codes are narrower than they look

- **A pipeline's exit status is the last command's.** `pnpm lint 2>&1 | tail` reports tail's success; `git commit … ; git log` reports git log's. Two agents published "exit 0" claims that were never true — and both times the wrong reading was the reassuring one. Isolate exit codes on their own line, or redirect to a file and check `$?` directly.
- **`eslint` exits 0 on warnings.** An implementer reported "exit 0" twice while its own new docblock was warning; the reviewer read the output. An exit code alone never establishes a clean lint here.
- **`pnpm lint`'s clean output is ONE line** — pnpm's own `$ eslint .` banner, proved byte-exact with `od -c`. The criterion is zero ESLINT lines, banner excluded; "zero output lines" read literally fails a clean run.
- **`npx eslint` does not lint this repo.** It resolves nothing locally, downloads packages, prints nothing, and exits 0 — indistinguishable from a clean run. `pnpm lint` or `pnpm exec eslint` only, with a positive control that proves the invocation can report.
- **A background task's completion notice reports the wrapper's exit status, not the runner's.** Reconfirmed in rounds nine, eleven, thirteen and fourteen — at least ten separate occasions, **always in the reassuring direction**. Three agents saw "exit code 0" over a log whose own `EXIT=1` was the truth, because the wrapper's last statement was an `echo`; one lane's `SUITE_EXIT=0` sat three lines below the `LINT_EXIT=1` that was the truth. **Wrap the runner directly so the wrapper's exit is the runner's own, and read the log's per-step markers, never the notice.**
- **A missing tool reads as a negative result.** `timeout` does not exist on this machine; `timeout 120 <probe>` returns exit 127 with empty output, which reads as "the probe ran and found nothing". Print the raw streams before trusting any empty result.

### Greps and censuses

**A search narrower than the claim cannot support the claim — and narrowness has independent axes.** One "unpinned" byte figure survived two searches because the literal is written `62_260` (formatting), the test spells `twelfth` not `12th` (vocabulary), and the eventual read started at line 600, below the hit (range). Any one axis produces a confident false negative. The fix is a positive control: `toBe(` in the same file would have found all four pins immediately.

- **Prose matches false-positive; code shape false-negatives.** A docblock naming a helper's path in prose inflated an importer census by one; the same round's five-`useFetch` miss was the mirror — the grep required a bare paren, and all five sites use the generic form. Census greps anchor on `^import` (or another shape prose cannot satisfy) and cross-check with a looser pass.
- **A grep across wrapped comment prose false-negatives in the alarming direction.** A phrase spanning a comment-line break counted zero in the very blob that carried it, which reads as "the fix is not in the commit".
- **Three tracked source files carry deliberate NUL bytes, and this machine's `grep` is ugrep**, whose binary-skip is invocation-dependent: multi-file invocations print `Binary file … matches`, single-file invocations print NOTHING, and `-c` prints an empty string — not `0` — at exit 1, which reads as a reassuring zero in arithmetic. Twenty hits were invisible to a mandated census grep until `-a`. `git grep` does not skip.
- **`tsc` reports errors positionally and never prints the identifier**, so a grep for the identifier over a typecheck log false-negatives. This recorded a LIVE program-membership control (`TS2322 at (254,8)`) as inert three times across rounds fifteen and sixteen. TS2322 never names the variable; TS2353 does name the key, which is why excess-key greps are trustworthy where control greps are not. **Read the raw log.**
- **A census wants two instruments with disjoint blind spots, each positive-controlled.** Round sixteen's catch was a TypeScript-AST scan calibrated by reproducing all eleven of a prior round's hand-clearings; the census pattern it replaced had also missed every `…await f()` site.
- **A survey scoped by mock type is structurally blind to prop-fed consumers, and the blindness is silent.** A 67-file fixture survey read as complete while a live gap sat one directory over, reachable only through a repo-wide consumer sweep. The consumer axis bounds the defect class; the fixture axis only bounds the ticket. Pair them.
- **`grep -c` on an empty input prints a reassuring 0.** Require a non-empty sanity marker before trusting any count.

### Git pathspecs and shell expansion

- **Git pathspecs containing `[param]` segments are character classes.** `git diff HEAD -- 'path/[screenId]/file.ts'` matches nothing and prints nothing — indistinguishable from a clean file — and `git diff` does not error on a non-matching pathspec the way `git checkout` does. This repo's route tree is full of them. Use `:(literal)` magic or an unqualified `git diff HEAD`.
- **In zsh, `local path=…` silently clobbers `PATH`** (`$path` is tied to it) — git and grep vanish mid-run, restores stop happening, and an empty-vs-empty comparison prints "restore: OK". **Never name a shell variable `path`.**
- **zsh does not word-split unquoted expansions.** `git checkout b044587 -- $F` with `F="a b c d"` passes one four-file pathspec, fails, and the next check measures the unmodified tip — which reads as "baseline is clean". An unquoted `--include=*.ts` glob ate a citation sweep ("no matches found" read as clean, caught by positive control), and a multi-path variable passed unquoted reached vitest as ONE argument mid-mutation-row.
- **After any setup step whose purpose is to change the tree, assert the tree changed** before trusting what runs next.

### Comment-only and whitespace-only proofs

**Proving a commit comment-only wants a compiler, not a scanner, and two-way controls.** A raw token scanner misread JSDoc backticks as template literals and reported code changes that were prose — the alarming direction, caught precisely because it alarms. The instrument that works: emit with `removeComments` and compare bytes, with both controls run first — an injected comment must emit identically, a real code flip must emit differently.

**Lint is the one gate such a commit CAN break.** Comment-only skips suites, never lint: markdown headings and jsdoc rules bite, with one real instance — an issue reference at line start parsing as a malformed ATX heading. The same generalises to indentation: in round sixteen, 6,324 green tests, both typecheck programs and seven mutation rows were all structurally blind to 7× `style/indent` sitting in converted lines. A whitespace-only change is provable by `git diff -w` being empty between tips, which is its own honest proof form.

### Instruments aimed at the wrong target

- **A negative control aimed at the wrong program is indistinguishable from a dead pin.** This repo has two typecheck programs with a deliberate exclusion between them (`tsconfig.test.json` excludes `test/nuxt/**`; the Nuxt program covers it). A planted type error that "nothing catches" may simply be outside the program you ran — a reviewer nearly filed the branch's pins as inert this way.
- **But `tsconfig.test.json`'s blindness is real for non-route files and FALSE for routes.** The generated chain `.nuxt/nuxt.d.ts → types/nitro.d.ts → nitro-routes.d.ts` names every server route's default export, so an untested route is compiler-covered in BOTH programs. One lane's "invisible by construction" claim was refuted in the reassuring direction — its route's uncast `{}` fails TS2740 in both. The corrected rule: **invisible unless something generated pulls it in by path, and for routes something always does.**
- **`wrangler --outdir` resolves one flag against two bases** — the bundle config-relative, its README cwd-relative — and writes a decoy README labelled as the real artifact at the path you asked for. **Only an absolute path agrees with itself.**
- **rollup emits a plugin's JavaScript under the asset's original filename.** A bundle scanner filtered to `.js`/`.mjs` passed cleanly over a poisoned bundle whose forbidden code sat in a `.wasm`-named file (base64 text at 4/3 the binary's size). Scan everything except sourcemaps, and prove the scanner bites with a planted regression, not just a self-test of the pattern.
- **`global.components` is inert for Nuxt-resolved components; `stubs` is the knob that bites.** A suite's headline comment credited a registration that did nothing — even a stub registered under the same name loses to Nuxt's own resolution. The mechanism a comment names should itself be proved by mutation, or the next composition suite copies the inert line.
- **`findAllComponents` on a nameless shared stub silently returns the wrong set.** One definition standing in for five components returned six matches with `title` null on all — while the alert demonstrably rendered its title — reading as "the page doesn't render this", the alarming direction. **Name the stub, find by `{ name }`.**
- **A stub that inherits a component's `:min`/`:max` gains real DOM constraints, and happy-dom then refuses to submit the form.** Save-press tests pass vacuously; one asserted an error was cleared that was never raised. Number-input stubs must declare the props so they stop at the stub.

---

## Test-runner signatures: a red run that isn't

Under round load this repo's suites fail in ways that read exactly like real defects. **Re-run the single file, then the full suite sequentially (`--no-file-parallelism`), before believing any broad kill taken under load.**

Four witnessed signatures of the Nuxt-suite-under-load family:

| Signature                                                                                                                                                                                                             | Reads as                                                     | Discriminator                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| `setupNuxt`'s 30s `beforeAll` times out → "N passed \| M skipped", non-zero exit, zero assertion failures                                                                                                             | A broad kill — one reviewer saw "11 failed / 161 skipped"    | **Skips present**, ~30s file durations            |
| ~14 tests across ~9 files fail with **zero** skips; durations bimodal — most at the 5s per-test timeout, plus sub-second `AssertionError` / testing-library `Unable to get` where a component is still on its spinner | Two of them look exactly like real defects; that is the trap | **Zero skips**, bimodal durations                 |
| A background fetch (`useServerTime`'s `/api/time` probe, a lazy singleton any consumer starts) lands inside a `not.toHaveBeenCalled()` window on the module-wide `$fetch` mock                                        | A real regression in a component nobody touched              | **6 ms duration**, no timeout, no skips           |
| A round-close authoritative run goes red on exactly one catalogued flake                                                                                                                                              | A merge defect                                               | Single-file re-run is green; check #123/#342/#367 |

The evidence on the first two is opposite on both axes, and the remedy is the same. The general lesson from the third: **any count or negative assertion on a module-wide `$fetch` mock must select its calls**, because the clock sync also writes to it. #367 enumerates five witnessed costumes and the thirteen remaining unselected guards. A round-close red is a signature to check against #123/#342 before it is a merge defect.

### Invocation failures that read as branch failures

- **The Nuxt suite is config-selected, not project-selected.** `vitest --project nuxt` prints "No projects matched the filter" with exit 1 and no results line. It takes `--config vitest.nuxt.config.ts`.
- **vitest positional args are substring patterns, so a partially wrong file list degrades silently.** A verifier given an 8-file runner set with one path wrong ran 7 files at exit 0 — no "No test files found", nothing. **224-vs-241 was the only tell.** Assert the expected FILE count, not just the test count. The wrong path had come from the lead's relay, so reproduce-before-adopting applies to runner sets too.
- **Read the error text.** A misinvoked runner reads as a branch failure to anyone who only reads the exit code.

### The frames lie

**Some Nuxt-suite failure frames cite the wrong line and print the wrong excerpt**, and it is a runner-level property rather than a per-file one. Three files are on the wrong-frame list — the overlay composable suite off by ~86 lines (citing an unrelated `describe`), the graphics-assets page suite off by non-constant offsets, and a third with the excerpt wrong outright — while the Inspector suite's frames were byte-accurate **on the same tip**, and every unit-suite frame checked was accurate.

- Attribute kills by **assertion values plus the FAIL-header test name**, never by frame.
- Where two assertions share a value, **plant a sentinel expectation** to prove which one died. A verifier converted exactly that suspicion into a fact in round fifteen.
- A long-enough expected object prints `{ Object (name) }` instead of its literal, so value-attribution fails exactly when fixture names grow — **a 1:1 test-name→assertion structure is the fallback**.
- vitest names the `await expect(` line of a wrapped chain, not the `.toMatchObject` line — **record kill-line spans, not single numbers**.

### Other runner traps

- **A name-filtered run's success criterion is narrower than the conclusion it invites.** A forward control validated under `-t 'one test'` passed and was true of its row — but the full suite showed the prospective fix breaking three tests, two of them pre-existing pins the filter excluded. **Plan fixes against the unfiltered number.**
- **A test whose two fixtures share one sentence pins neither's discriminator.** A code-path fixture whose message was byte-identical to the message-path fixture let the message branch classify a broken code branch, and the suite stayed green — while the row that LOOKED like code coverage actually killed through a third fixture's negative assertion. Fixtures for sibling discriminators must not satisfy each other's predicates; **read which assertion a kill lands on**, not just that it kills.
- **Nitro's typed `$fetch` produces `TS2321 Excessive stack depth` errors of which TypeScript reports only ~two per program** — each fix reveals the next, in files unrelated to what surfaced them. A clean run after fixing one is not evidence you are done.
- **Serialise the integration suite.** Three concurrent `test:integration:run` passes at load 10–26 make every number worthless in both directions. One authoritative run, on a quiet machine, against the merged result. Per-branch integration numbers taken under load are not evidence of anything.

  A branch may legitimately skip it if its change set cannot reach it — but the argument must be **stated so a reviewer can reject it**, not used as a reason to stay silent. The good form: "nothing under `test/integration/` imports this; if that argument is wrong, the right response is to run the suite rather than to trust it."

---

## Enumerations, claims, and relays

### Reproduce before adopting — in every direction

**A review finding is an enumeration too, and it gets the same treatment as the code.**

- A reviewer's "zero `useFetch` sites" was offered as _strengthening_ a conclusion and would have planted a falsehood in the artefact.
- A reviewer's blocker named a docblock that did not carry the false claim while missing the file that did — the implementer's concept sweep found the real second site, which is the only reason it was fixed.
- A lead's relay upgraded a reviewer's "supports" to "confirms", and the reviewer had to decline the upgrade with the primary source.

**The lead's relays are enumerations too, and they failed reproduction four ways in one round**: a runner-set path relayed under the wrong directory (vitest's substring matching would have run 4 of 5 files at exit 0 — the file-count assertion is the standing defence); a mutation-restoration source pointed at an intermediate commit whose form already contained the fix, which would have forged a passing control; a row's two edits restated top-down while labelled bottom-up; and a ticket's "fourth spelling" of a defect class relayed as "four times". Each was caught by a reviewer or implementer applying the same discipline to the brief as to the code.

**Corrections flow through the same discipline in every direction: reproduce, then adopt.**

### Enumerate by concept, not by the instances you hold

A reviewer who had three sites of a false claim audited those three and missed a fourth sitting in a comment they had already quoted for a different finding. **A site-list can only confirm itself.** The implementer's concept-level sweep — every added line asserting anything about the log, positive-controlled against the pre-fix tree — found it.

**Total your own enumeration before publishing it, and count call sites, not files.** Three separate reports in round eight carried right per-item lists under wrong totals: fifteen-for-nineteen, three-for-four, and a briefing's stale suite count. Round nine extended it: **check what your enumeration is made of, on every row, not just the row someone challenges.**

### Cite what you actually observed

- **A quoted phrase in a finding once traced to the lead's own prompt**, three faithful hops from any primary source: the prompt's paraphrase was echoed by a reviewer as if quoting the file, relayed as a comment defect, and refuted by a one-line grep — while the finding's SUBSTANCE was right and reversed the implementer's own earlier conclusion. **Check the quote AND chase the substance**; a wrong citation on a right claim loses the claim if only the quote is checked.
- **Correct judgement, over-specific evidence.** Three times on one branch, a minimal reproduction proved a mechanism and then got quoted as though it were observed on the real system ("answers with silence"; "prints No bindings found"). The conclusions all survived — which is exactly why the citations weren't caught. **Quote evidence from the system the claim is about, or state the uncertainty instead of either claim.**
- **When verifying a merge commit, compare each changed file's blob hash against BOTH parents.** `git show --cc` suppresses hunks, and a combined-diff read missed one of a merge's own changes.
- **Verify claims about provenance.** `git log --oneline -- <path>` settles which ticket introduced or guarded something; round four found a security runbook attributing a guard to the wrong ticket.

### Reading tickets

**`gh issue view` failed silently on this machine, in two costumes.** Plain `gh issue view N` (and `--comments`) printed nothing at exit 0 for every issue in one lane; in another it printed the comment with its full header block while silently dropping the title and body — plausible-looking output that invites the reader to stop. Worst case observed: a ticket with genuinely zero comments, where the empty output happened to be true.

`gh issue view N --json number,title,state,body,comments` and `gh api repos/<owner>/<repo>/issues/N` both worked throughout. **Read tickets through the JSON forms, and positive-control the body text for a phrase you expect.**

### Using this page

**This catalogue makes pattern-matching cheap, and cheap pattern-matching finds false matches.** One agent mapped a colleague's correct observation onto the setup-hook entry when the evidence was opposite on both axes. **Check a signature's own discriminators before naming an entry, in both directions** — a hazard named wrongly sends the next reader looking for the wrong evidence.

### Stale snapshots

A fact about a branch someone is actively working on has a timestamp, not a standing truth. In round four the same branch produced two wrong conclusions this way — an "untracked file" that had been committed minutes earlier, and "inflated verification counts" that had already been restated. Both readings were sound; only the tree was old. **`git fetch` before checking, and say which commit you looked at.**

---

## What a review owes

- **Reproduce claimed mutation tables rather than reading them.** A claimed table that does not hold has happened here, and a test that passes with the bug reintroduced is this project's most expensive recurring defect.
- **Report per row: confirmed / refuted / not attempted.** "Not attempted" stated plainly is worth more than a confident gloss.
- **Distinguish proved from suspected**, explicitly, at the end.
- **"I could not establish this" is a good answer.** So is "I looked for a case where X breaks and concluded none exists", which is stronger than failing to find one.
- **Check whether a shared test stub or helper changed the conditions pre-existing tests run under.** Passing is weaker than detecting: re-run an old mutation to confirm the old tests still bite.
- **A prescribed fix can conflict with a prescribed residual in the same verdict.** A reviewer's suggested fixture wording contained the substring their own non-blocking recommendation would widen a constant to — applying both as written would have re-created the blocker exactly. **When a verdict carries a fix AND a residual touching the same mechanism, test them together.**

## What an implementer owes

- State what was **not** run and why, rather than omitting it.
- When a ticket's own text turns out to be wrong, say so and prove it by execution — this has happened repeatedly and the implementer has usually been right.
- Record adjacent defects rather than fixing them. Round four's out-of-scope findings became #197, #198, #203–#208.
- Prefer pinning a fix with a test over fixing it, where the defect is one a future edit could silently reintroduce — subject to the anti-pin rule above.
- **When a file disagrees with a rule the same branch wrote, fixing the rule is sometimes the remediation.** It happened twice in round sixteen: one lane proved the review's prescribed fix insufficient before shipping it, and another declined to bend a sound site to its own sloppy sentence and refined the sentence instead — with the reviewer's tell, "narrower where it matters, giving up nothing". **A site/rule disagreement has two candidate fixes, and the finding names only one.**
- **A docblock that invents a constraint to excuse a gap enshrines a round-scoped choice as structural.** "The page's one attribute went to the lifecycle alert" was refuted by the diff it sat in. The honest forms are "not done in this round", or doing it.
- **A defect that is a sentence wants probes that read sentences.** Cell-probing a notice's prose in every reachable configuration found two falsehoods that assertion-shaped tests were structurally blind to — and the counter-hazard is real too: tuning wording per enumerated cell over-fits to the cells you happened to think of.

## Authorization

**Having the credential is not authorization.** A lane with `workers:write` on the production account correctly declined to reproduce a bug against the deployed Worker unasked. Deployed-environment acceptance criteria stay open until a human authorizes the deployment; local artifact evidence — the defect provably absent from the deployable bundle — merges the fix but does not close the ticket.

That is what the `requires-deployment` label records; see `docs/agents/triage-labels.md`. #302 and #189 are the founding examples.

## Merging

Merge commits, not squashes, with a subject naming the issues and a body stating what the review found and what the remediation closed. The merge message is where a reader learns why the branch took two rounds.

Before merging, confirm the tip is what you think it is, and that the branch's remediation actually landed — **a report saying "actioned" is not evidence of action**.

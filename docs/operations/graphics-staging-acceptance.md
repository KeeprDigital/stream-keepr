# Graphics staging acceptance

The deployment gate for the Graphics Asset Library. It proves the behaviour no
local adapter can prove — Worker-to-R2 streaming, edge cache semantics,
authorization on every public request, browser decoding and font readiness, and
durable publication under production-shaped bindings — against a real
installation, before graphics work is considered releasable.

The gate is run by a person, in order, from a working checkout. Each step is a
command whose exit status is the answer; nothing here is judged by eye except
the one Safari observation that macOS may refuse to automate.

## The staging installation is the production deployment

There is no separate staging environment. The installation reached by
`CLOUDFLARE_ENV=production` **is** the staging gate, which has two consequences
you must hold onto while running this:

- Every harness creates real Events, Screen Outputs, Graphic Assets, and
  Template Packages in that installation, and deletes them again on the way
  out. A harness that dies mid-run leaves an Event named for its scenario
  behind; remove it before rerunning.
- The fault-injection steps take real delivery down for as long as the fault is
  injected. Do not run them while anything is on air.

Headless Chromium stands in for an OBS Screen Output. Safari is needed only to
prove that a Screen Output pinning VP9 alpha refuses it that revision's bytes.

## Before you start

1. **Docker must be running.** The silent-video validator is a Container; the
   validator harness and any silent-video ingestion need it.
2. **Deploy the validator, then the application:**

   ```sh
   pnpm deploy:validator
   pnpm deploy
   ```

   `pnpm deploy` ends in `deploy:verify`, which fails the deploy if the promoted
   Worker is not serving. Do not continue past a failed `deploy:verify`; see the
   rollback path in README.md.

3. **Set the two environment variables the harnesses read:**

   | Variable                              | Used by                                                         | Value                                                               |
   | ------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
   | `STREAM_KEEPR_DEPLOY_HEALTH_URL`      | `deploy:verify`, and as the fallback base URL for every harness | The deployed Worker base URL                                        |
   | `STREAM_KEEPR_BROWSER_ACCEPTANCE_URL` | Every `:deployed` harness                                       | The base URL to accept against, when it differs from the health URL |

   A `:deployed` harness refuses to start without one of them rather than
   guessing at an installation.

Local (non-deployed) modes of the same harnesses run against `pnpm preview` and
need `NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY` in `.dev.vars`; see
`.dev.vars.example`. They prove the invariants that do not depend on Cloudflare,
and are the fast way to find a break before spending a deploy on it.

## The sequence

Run these in order. Stop at the first failure: a later harness provisioning
assets on top of a broken delivery path produces evidence about the wrong thing.

| #   | Command                                        | Proves                                                                                            |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | `pnpm test:validator:silent-video:deployed`    | The deployed validator Container answers.                                                         |
| 2   | `pnpm test:delivery:graphics:deployed`         | Delivery semantics, authorization, revocation, origin exposure, and the settled failure outcomes. |
| 3   | `pnpm test:browser:still-images:deployed`      | PNG, JPEG, and WebP decode in an OBS-like output.                                                 |
| 4   | `pnpm test:browser:silent-video:deployed`      | H.264 MP4 and VP9 WebM play and seek; VP9 alpha keeps its transparency on Chromium.               |
| 5   | `pnpm test:browser:fonts:deployed`             | A font Graphic Asset Revision is delivered by the Worker, loads, and renders its own glyphs.      |
| 6   | `pnpm test:browser:safari-vp9-alpha:deployed`  | A Screen Output pinning VP9 alpha refuses Safari that revision, while its session still opens.    |
| 7   | `pnpm test:delivery:graphics:package:deployed` | Template Package publication is atomic and its retry is idempotent.                               |
| 8   | The fault-injection procedures below           | Unavailable content, integrity failure, D1 outage, and R2 outage with an authorized cache.        |

Every harness prints one line on success and a block of stable failure codes on
failure. The codes are the contract; the prose beside them is not. A run that
proved nothing — because a driver it needed was unavailable — prints
`acceptance deferred` and is never to be read as a pass.

### Step 2 in detail

`test:delivery:graphics:deployed` provisions one Event, one Screen Output, and
one still-image Graphic Asset, publishes a Feature Match Layout that pins the
revision, and then exercises both public entry points — the Screen Output
capability route and the authenticated editor route — plus the Screen Output
document itself, which is where a Content Security Policy would govern what an
unattended output may load.

The installation declares no policy today. That absence is what the gate
asserts, in both directions: a policy appearing where none is settled prints
`csp-directive-unexpected`, and a policy that widens where output content may
come from prints `csp-directive-permissive`. If a restrictive policy is
introduced later, flip the expectation in `checkContentSecurityPolicy` to
`settled: 'restrictive'` and its absence becomes the failure instead. There is
no configuration in which this check has no opinion.

Two options change what it enforces:

- `--require-cache-hit` turns "the edge never reported a warm cache" from a note
  into a failure. Use it once you have confirmed the deployment reaches the
  Workers Cache API; without it the harness still enforces that a repeated read
  is byte-identical and that revocation beats any cache.
- `--arm <file>` and `--fault <name> --scenario <file>` are the two halves of a
  fault-injection run, below.

## Fault injection

The harness ships the assertions; it does not inject the outage. Each procedure
is: arm a scenario, break one thing, run the matching fault mode, put it back.

The armed scenario file is also where you read the identities you need to break
something: the harness itself never prints an asset or revision identity, by
design. It contains live capability tokens, so write it somewhere only you can
read.

**A failed fault run keeps the file, and keeps its Events.** That is deliberate:
once you have deleted or overwritten a canonical object, the `content` array in
that file is the only copy of what was there, and the Events are what address
it. A run that passed has nothing left to restore, so it deletes both. When a
run keeps them it says so, and names the path.

### Which fault owns which cache state

Arming provisions **two** Screen Outputs, each with its own asset, because the
faults disagree about what a cache should be holding:

| Representation | Read through the capability route while arming?                   | Addressed by                                                                                   |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `warm`         | Yes, once — so a deployed edge cache holds its immutable response | `r2-outage-authorized-cache` expects it to keep serving                                        |
| `cold`         | Never                                                             | `content-unavailable`, `content-integrity-disagreement` expect it to report a retryable outage |

This matters because the two are mutually exclusive on one representation. A
warmed capability route serves its cached immutable bytes straight through a
storage outage — authorization still ran, and the bytes are still digest-true —
so pointing `content-unavailable` at a warmed representation asks production to
fail in exactly the way `r2-outage-authorized-cache` asks it to succeed. The
first version of this runbook did that, and the deployed run correctly reported
`outcome-not-retryable-unavailable expected=503 actual=200`. Production was
right; the procedure was wrong.

`d1-outage` addresses both, because a catalogue that cannot answer must fail
closed on every representation regardless of cache state.

### Unavailable Graphic Asset Content

Proves that content the catalogue knows about but cannot read is a retryable
`503` carrying `Retry-After`, not a missing identity — and that one missing
object takes down one revision and nothing else.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`
2. Read `cold.contentDigest` from the armed scenario file and delete
   `sha256/<that digest>` from the **canonical** bucket
   (`stream-graphics-asset-canonical`). The catalogue row stays; only the bytes
   go. Delete the **cold** representation's object, not the warm one — see the
   table above for why.
3. `pnpm test:delivery:graphics:deployed --fault content-unavailable --scenario ~/.sk-armed.json`
4. Expected: the cold representation answers `503` with `Retry-After` on both
   the capability and editor routes, and the warm representation still serves
   its own bytes untouched. A failure prints
   `outcome-not-retryable-unavailable`, `outcome-retry-after-missing`, or
   `outcome-retry-after-invalid`.
5. Restore by re-uploading the object from the `cold.content` array in the
   armed scenario file, or accept the reconciliation discrepancy the library
   will raise and repair it through the reconciliation queue.

### Integrity failure

Proves the outcome that is easy to confuse with the one above, and is not the
same thing. Content the store still holds, but whose bytes contradict the size,
media type, or digest the catalogue recorded, is **never served** — and because
a contradiction can be repaired, it reads as a retryable `503` rather than as a
missing revision. Delivery and reconciliation share one definition of
agreement, so anything reconciliation would isolate as a critical integrity
incident cannot still reach air.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`
2. Read `cold.contentDigest` from the armed scenario file and overwrite
   `sha256/<that digest>` in the canonical bucket with **different bytes of a
   different length** — any small file will do. The object exists and the store
   answers; what has changed is that it no longer matches its record. The cold
   representation again, for the same reason as above: a warmed capability
   route would serve its cached copy and never reach the store at all.
3. `pnpm test:delivery:graphics:deployed --fault content-integrity-disagreement --scenario ~/.sk-armed.json`
4. Expected: both the capability route and the editor route answer `503` with
   `Retry-After`, and neither returns a body. A `200` prints
   `outcome-not-integrity-failure` and means contradicting bytes reached a
   caller, which is the failure this step exists to catch. A `404` prints
   `outcome-not-retryable-unavailable` and means a repairable disagreement was
   reported as a permanent absence.
5. Restore the object, or repair it through the reconciliation queue — which is
   where the incident this step created will now be waiting.

### D1 outage

Proves that a catalogue that cannot answer fails closed and retryable, and
never serves bytes it could not authorize.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`
2. Remove the `DB` binding from the deployed Worker, or point it at a database
   id that does not exist, and deploy that configuration.
3. `pnpm test:delivery:graphics:deployed --fault d1-outage --scenario ~/.sk-armed.json`
4. Expected: **both** representations answer `503` with `Retry-After` on both
   content routes, as does the capability-session bootstrap. The warm one is
   included on purpose: authorization runs before any cache is consulted, so a
   warmed representation must fail closed here even though it would keep
   serving through the storage outage below. A `200` means authorization was
   skipped, which is the most serious failure this gate can find.
5. Restore the binding and redeploy.

### R2 outage with an authorized cache

Proves that a warmed representation keeps serving from the authorized cache
while a cold one reports a retryable outage — and that the cache never becomes
a way around authorization.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`. Arming reads
   the warm representation once through its capability route; that read is what
   puts it in the edge cache, so do not skip it.
2. Remove the `GRAPHICS_ASSET_CANONICAL` binding from the deployed Worker and
   deploy that configuration.
3. `pnpm test:delivery:graphics:deployed --fault r2-outage-authorized-cache --scenario ~/.sk-armed.json`
4. Expected: the warm capability read still returns its exact bytes, while the
   cold representation returns `503` with `Retry-After` on both routes — as
   does the warm one's editor route, which shares no cache with the capability
   route.
5. Restore the binding and redeploy.

Run this one **deployed**. Local mode has no edge cache to have warmed, so the
harness asserts only the cold-path outages there and reports
`delivery-cache-not-observable` for the warm read rather than asserting an
invariant the environment cannot host. That is a different fact from
`delivery-cache-state-unreported`, which step 2 uses when an edge cache exists
but did not report itself warm.

## Safari

`test:browser:safari-vp9-alpha:deployed` drives Safari through the
`safaridriver` that ships with macOS. It needs a one-time
`sudo safaridriver --enable`, plus **Develop > Allow Remote Automation** ticked
in Safari.

Where automation is unavailable the harness prints the observation to make by
hand and reports the run as `acceptance deferred path=manual-check-required` —
never as a pass. A deployed run refuses to defer at all unless you pass
`--allow-manual`, so a gate cannot quietly skip it.

**The manual path does not exercise the product boundary, and cannot.** It
records the browser fact alone: open the printed page in Safari and note what
it reports, which on current Safari will be `substituted`. There is no Screen
Output to try, because the harness settles its driver before provisioning
anything — publishing a Screen Output that pins restricted video and then
driving no browser at it would leave a real asset in a real installation for
nobody to look at.

A deferred run therefore leaves this step's guarantee unproven. The `409` is
proven only by an automated run against a deployed installation, and until one
has passed, step 6 is outstanding whatever the manual observation said.

### What this step proves, and why it changed

This gate was first written expecting Safari to refuse VP9 alpha, so that the
restriction would enforce itself. The deployed run disproved that: **Safari
26.5 decodes VP9 alpha and flattens the alpha channel away.** It plays, and
plays wrongly — which for a graphic going to air is worse than not playing.

The enforceable half is therefore the **product boundary**, and that is what
this step now asserts. Deployed mode:

1. Ingests the VP9-alpha fixture as a real silent-video Graphic Asset through
   the deployed validator, and checks the report came back restricted to
   `chromium-transparency`.
2. Publishes a Screen Output whose Feature Match Layout pins that revision.
3. Drives Safari to that Screen Output's page, where it mints a capability
   through its own author session, opens a capability session, and then asks
   for the restricted revision's own content route.
4. Requires the session to open with `200`, to name that revision in its
   `unplayableRevisions` forecast, and the revision itself to answer `409` with
   `data.code = vp9-alpha-chromium-required`. Anything else on the revision
   prints `safari-vp9-alpha-not-blocked` and is a gate failure — it means a
   browser that cannot show the content correctly was handed the bytes.
   A session that refuses instead prints `restricted-video-session-refused`,
   which is a gate failure of its own rather than an unready environment:
   refusing it costs the output every asset the Screen publishes rather than
   the one clip Safari would show wrongly, which is the defect #98 closed.
   A session that opens without naming the revision prints
   `restricted-video-refusal-unforecast`: the refusal then arrives at an output
   that drew a `<video>` for it, which is the same blank rectangle reached by a
   different route (#184).
5. Tears the Screen Output and its Event down.

Nothing secret travels in the URL: the page is given the Event, Screen, and
exact revision identities, and mints the capability itself.

### The browser fact, recorded rather than judged

The raw playback observation is kept, because it is the evidence for why the
boundary has to exist at all. It is reported in the pass line as
`browserFact=…` and is **not** a verdict:

| Observation             | Meaning                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `substituted`           | Expected on current Safari. Decoded, transparency flattened.                                                                                                                                                                                       |
| `refused`               | Expected on older Safari. An explicit decode error, or no picture.                                                                                                                                                                                 |
| `transparency-rendered` | Remarkable. This Safari really can show VP9 alpha, so the restriction's premise may be stale. Reported as `safari-vp9-alpha-transparency-rendered` for a human to weigh — it argues for relaxing the product block, not for failing this contract. |
| `undetermined`          | The browser neither decoded nor refused in the time allowed. Nothing observed, nothing claimed.                                                                                                                                                    |

### Local mode

Local runs observe the browser fact only and report
`boundary=not-exercised`. A restricted Screen Output cannot exist locally: the
video has to pass the silent-video validator, and the local Worker has no
service binding to reach it. The boundary is a deployed-only proof.

`test/integration/screenOutputAssetDelivery.test.ts` covers the same refusal at
the integration seam by fabricating the technical facts a real ingestion would
need the validator to produce; the deployed step is what proves it end to end
with a real video and a real Safari.

## Fonts

`test:browser:fonts:deployed` proves the fact only a running installation can:
that a **font Graphic Asset Revision** travels from the object store, through
the Worker, into a browser, and renders. The bundled application fonts are
explicitly outside the Graphics Asset Library, so a gate that only loaded those
would prove nothing about it.

The run stages a real font ingestion, and the page then does exactly what an
author's browser does — reads the staged source, answers the server's own glyph
challenge with genuine rendered-pixel proofs, and publishes the revision. It
then loads that published revision back through the delivery route that will
serve it on air. The face is trashed on the way out, pass or fail.

`pnpm test:browser:fonts` without `--library` skips all of that and proves the
browser facts alone. Four of them:

- Chromium loads WOFF2, WOFF, TTF, and OTF and renders their glyphs.
- A face that would silently fall back is refused rather than accepted
  (`font-silent-fallback-accepted`).
- Every face the `static-font-v1` profile rejects is refused by the browser too.
  The manifest's `refusedFaces` names them, and one loading here is
  `font-refused-face-loaded` — a server-side check and a browser disagreeing
  about the same bytes.
- Every face the profile deliberately **permits** despite a superficially
  similar defect really does load and render. The run builds one for itself:
  `public/fonts/mplantin.ttf` with only its Macintosh-platform cmap language
  left non-zero, which OpenType defines there. It is served as an ordinary face,
  so a profile rule that widened back into refusing it fails here (#153).

That mode needs no installation, which is why it runs in the ordinary suite, and
it is where the OTF face is covered: the installation ships no OTF, and
vendoring a proprietary typeface solely to be downloaded by a test would
republish it for no gain. The Macintosh-language face is built at run time for
the same reason — a synthetic font in `public/` would be a shipped asset nothing
serves. Use `pnpm test:browser:fonts:library` to run the library face against a
local `pnpm preview`.

## What the evidence may say

Every harness prints through one formatter that checks each detail value before
it is written. Secrets, capability tokens, source filenames, object keys, and
full delivery URLs cannot appear: routes are reduced to identifier-free labels
such as
`/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content`,
and a value that would leak is replaced by a failure of its own —
`evidence-secret-leak`, `evidence-url-leak`, `evidence-filename-leak`, or
`evidence-opaque-token-leak` — naming only the field that carried it.

This means a failing run is safe to paste into an issue as-is. It also means
that if you need the offending identity in order to investigate, you look it up
in the installation from the route and the timestamp; the transcript will not
hand it to you.

The stable codes live in `scripts/graphics-acceptance/evidence.mjs`. Add codes;
never rename one.

## Where each acceptance criterion is proven

| #50 acceptance criterion                                                                                                                                 | Proven by                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full and byte-range delivery, conditional requests, strong ETags, cache miss/hit, authorization on every public request, revocation despite cached bytes | Step 2. Cache warmth is deployed-only (`--require-cache-hit`); every other assertion runs locally too.                                                                                                                                                                                                                                                                                                                                                                            |
| CORS and CSP permit only the settled same-origin and output behaviour without making private canonical storage public                                    | Step 2, on both delivery routes and on the Screen Output document — `cors-allow-origin-exposed`, `cors-allow-credentials-exposed`, `cors-preflight-permitted`, `csp-directive-unexpected`, `csp-directive-permissive`, `private-storage-publicly-addressable`.                                                                                                                                                                                                                    |
| PNG, JPEG, and WebP pass real browser decoding                                                                                                           | Step 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| H.264 MP4 and VP9 WebM play and seek; VP9 alpha proven on Chromium and blocked on Safari                                                                 | Step 4 for Chromium playback. Step 6 for the Safari block, which is enforced at the product boundary rather than by the browser: Safari 26.5 decodes VP9 alpha and flattens it, so a Screen Output refuses Safari that revision's bytes instead. The refusal is per resolution request — the capability session still opens, because refusing it cost the output every other asset the Screen publishes (#98). The browser's own behaviour is recorded as evidence, not asserted. |
| Supported fonts complete loading and representative glyph rendering before the output reports ready                                                      | Step 5, on a font Graphic Asset Revision delivered by the Worker. The OTF face is covered by the local `pnpm test:browser:fonts`, which uses the same Chromium build. That local run also proves both sides of the `static-font-v1` cmap-language rule: `refusedFaces` must be refused by the browser (`font-refused-face-loaded`), and the Macintosh-language face it builds must load and render (#153).                                                                        |
| Unavailable content, D1 outage, R2 outage with authorized cache, integrity failure, and capability denial produce the settled observable outcomes        | Capability denial and an unreachable revision: step 2, which also asserts the two are indistinguishable. All four outages, integrity failure included: step 8.                                                                                                                                                                                                                                                                                                                    |
| Package publication and retry never expose partial assets or duplicate a committed result                                                                | Step 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The gate reports actionable stable failure evidence without logging secrets, filenames, object keys, or full delivery URLs                               | Enforced in the output path itself and covered by `test/unit/scripts/graphicsAcceptanceEvidence.test.ts`.                                                                                                                                                                                                                                                                                                                                                                         |

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
prove that VP9 alpha is refused there.

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
| 6   | `pnpm test:browser:safari-vp9-alpha:deployed`  | Safari refuses VP9 alpha rather than flattening it.                                               |
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
design. The file contains a live capability token, so write it somewhere only
you can read; the harness deletes it when the fault run finishes.

### Unavailable Graphic Asset Content

Proves that content the catalogue knows about but cannot read is a retryable
`503` carrying `Retry-After`, not a missing identity.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`
2. Read `assetId` and `revisionId` from the armed scenario file, and delete that
   revision's object from the **canonical** R2 bucket. The catalogue row stays;
   only the bytes go.
3. `pnpm test:delivery:graphics:deployed --fault content-unavailable --scenario ~/.sk-armed.json`
4. Expected: the harness passes. A failure prints
   `outcome-not-retryable-unavailable`, `outcome-retry-after-missing`, or
   `outcome-retry-after-invalid`.
5. Restore by re-uploading the object, or accept the reconciliation discrepancy
   the library will raise and repair it through the reconciliation queue.

### Integrity failure

Proves the outcome that is easy to confuse with the one above, and is not the
same thing. Content the store still holds, but whose bytes contradict the size,
media type, or digest the catalogue recorded, is **never served** — and because
a contradiction can be repaired, it reads as a retryable `503` rather than as a
missing revision. Delivery and reconciliation share one definition of
agreement, so anything reconciliation would isolate as a critical integrity
incident cannot still reach air.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`
2. Read `assetId` and `revisionId` from the armed scenario file. Overwrite that
   revision's canonical object with **different bytes of a different length** —
   any small file will do. The object exists and the store answers; what has
   changed is that it no longer matches its record.
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
4. Expected: the capability content route, the editor content route, and the
   capability-session bootstrap all answer `503` with `Retry-After`. A `200`
   here means authorization was skipped, which is the most serious failure this
   gate can find.
5. Restore the binding and redeploy.

### R2 outage with an authorized cache

Proves that a warmed representation keeps serving from the authorized cache
while a cold one reports a retryable outage — and that the cache never becomes
a way around authorization.

1. `pnpm test:delivery:graphics:deployed --arm ~/.sk-armed.json`. Arming warms
   the cache with one authorized read; this step is what makes the fault run
   meaningful, so do not skip it.
2. Remove the `GRAPHICS_ASSET_CANONICAL` binding from the deployed Worker and
   deploy that configuration.
3. `pnpm test:delivery:graphics:deployed --fault r2-outage-authorized-cache --scenario ~/.sk-armed.json`
4. Expected: the warmed capability read still returns the exact bytes, and the
   editor route — which does not share that cache — returns `503` with
   `Retry-After`.
5. Restore the binding and redeploy.

## Safari

`test:browser:safari-vp9-alpha:deployed` drives Safari through the
`safaridriver` that ships with macOS. It needs a one-time
`sudo safaridriver --enable`, plus **Develop > Allow Remote Automation** ticked
in Safari.

Where automation is unavailable the harness prints the observation to make by
hand and reports the run as `acceptance deferred path=manual-check-required` —
never as a pass. A deployed run refuses to defer at all unless you pass
`--allow-manual`, so a gate cannot quietly skip it. If you take the manual
path, open the printed page in Safari and record what it says; anything other
than `passed` is a gate failure.

The page distinguishes three things, because only one of them is a pass. An
explicit decode error is Safari refusing the content, which is the restriction
working. Playback with transparency prints `safari-vp9-alpha-not-blocked` and
means the restriction is stale. Playback with the transparency flattened away
prints `safari-vp9-alpha-substituted` and is worse — a wrong-looking graphic
reaching air while every capability check still says yes. Silence, where the
browser neither decoded nor refused within the time allowed, prints
`browser-acceptance-timed-out`: nothing was observed, so nothing is claimed.

The complementary product-level restriction — that the capability-session
bootstrap answers `409 vp9-alpha-chromium-required` to a Safari user agent when
a Screen Output pins VP9-alpha video — is proven by
`test/integration/screenOutputAssetDelivery.test.ts`, which can fabricate the
technical facts a real VP9-alpha ingestion would need the validator to produce.

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

`pnpm test:browser:fonts` without `--library` skips all of that and proves only
the browser facts — that Chromium loads WOFF2, WOFF, TTF, and OTF and renders
their glyphs, and that a face which would silently fall back is refused. That
mode needs no installation, which is why it runs in the ordinary suite, and it
is where the OTF face is covered: the installation ships no OTF, and vendoring
a proprietary typeface solely to be downloaded by a test would republish it for
no gain. Use `pnpm test:browser:fonts:library` to run the library face against
a local `pnpm preview`.

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

| #50 acceptance criterion                                                                                                                                 | Proven by                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full and byte-range delivery, conditional requests, strong ETags, cache miss/hit, authorization on every public request, revocation despite cached bytes | Step 2. Cache warmth is deployed-only (`--require-cache-hit`); every other assertion runs locally too.                                                                                                                                                         |
| CORS and CSP permit only the settled same-origin and output behaviour without making private canonical storage public                                    | Step 2, on both delivery routes and on the Screen Output document — `cors-allow-origin-exposed`, `cors-allow-credentials-exposed`, `cors-preflight-permitted`, `csp-directive-unexpected`, `csp-directive-permissive`, `private-storage-publicly-addressable`. |
| PNG, JPEG, and WebP pass real browser decoding                                                                                                           | Step 3.                                                                                                                                                                                                                                                        |
| H.264 MP4 and VP9 WebM play and seek; VP9 alpha proven on Chromium and blocked on Safari                                                                 | Steps 4 and 6.                                                                                                                                                                                                                                                 |
| Supported fonts complete loading and representative glyph rendering before the output reports ready                                                      | Step 5, on a font Graphic Asset Revision delivered by the Worker. The OTF face is covered by the local `pnpm test:browser:fonts`, which uses the same Chromium build.                                                                                          |
| Unavailable content, D1 outage, R2 outage with authorized cache, integrity failure, and capability denial produce the settled observable outcomes        | Capability denial and an unreachable revision: step 2, which also asserts the two are indistinguishable. All four outages, integrity failure included: step 8.                                                                                                 |
| Package publication and retry never expose partial assets or duplicate a committed result                                                                | Step 7.                                                                                                                                                                                                                                                        |
| The gate reports actionable stable failure evidence without logging secrets, filenames, object keys, or full delivery URLs                               | Enforced in the output path itself and covered by `test/unit/scripts/graphicsAcceptanceEvidence.test.ts`.                                                                                                                                                      |

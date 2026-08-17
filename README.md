# Stream Keepr

Event management and streaming overlay system for competitive gaming tournaments (MTG, One Piece).

## Features

- **Event Management** - Create and configure tournament events with game-specific settings
- **Player Tracking** - Manage player records, deck lists, and standings
- **Match Management** - Pair players, track results, support best-of series
- **Streaming Overlays** - Real-time card displays, deck views, match info screens
- **Melee Integration** - Sync tournament data from Melee platform
- **Real-time Updates** - Live sync across all connected clients via Ably

## Tech Stack

- **Frontend**: Nuxt 4, Vue 3, Pinia, Nuxt UI, TailwindCSS
- **Backend**: Nitro on Cloudflare Workers
- **Database**: SQLite (D1) with Drizzle ORM
- **Real-time**: Ably
- **Deployment**: NuxtHub-generated Cloudflare Worker deployed with pinned Wrangler

## Directory Structure

```text
/app          # Frontend - pages, components, stores, composables
/server       # Backend - API routes, services, database schema
/shared       # Shared types and utilities
```

## Setup

Use Node 24 LTS (24.11 or newer) and the pnpm version pinned in
`package.json`; `.node-version` contains the exact CI version.

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Testing

Which script, when:

| When                                        | Command                                                                                      | Notes                                                                                                                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| While developing                            | `pnpm test:unit`, `pnpm test:nuxt`, `pnpm test:integration`                                  | Watch mode for the tier you are touching; append `:run` for a single pass.                                                                                                                                                                              |
| Before commit / PR                          | `pnpm test`                                                                                  | Unit + Nuxt + integration, then the three local browser gates (still images, silent video, fonts). Needs an installed Chrome/Chromium. Never run integration passes concurrently — serialise them (`docs/agents/parallel-rounds.md`).                   |
| Deploy day                                  | The seven `:deployed` gates, in the order under [Deploy day, in order](#deploy-day-in-order) | Each provisions real Events and assets against the deployed installation and deletes them on the way out. Stop at the first failure.                                                                                                                    |
| Touching still-image codecs or Wasm (#302)  | `pnpm test:ingestion:still-images`                                                           | Proves JPEG/WebP ingestion decodes on workerd, where runtime Wasm compilation is refused. Needs `pnpm preview` already running at `127.0.0.1:8787`; not part of `pnpm test` for that reason. `:deployed` targets `STREAM_KEEPR_BROWSER_ACCEPTANCE_URL`. |
| Touching the silent-video validator         | `pnpm test:validator:silent-video`                                                           | Needs Docker (the validator is a Container).                                                                                                                                                                                                            |
| Touching font delivery against a real store | `pnpm test:browser:fonts:library`                                                            | Runs the library face against a local worker; plain `test:browser:fonts` covers the synthetic faces.                                                                                                                                                    |
| Investigating VP9-alpha handling on Safari  | `pnpm test:browser:safari-vp9-alpha`                                                         | Needs the Safari automation setup in `docs/operations/graphics-staging-acceptance.md`.                                                                                                                                                                  |

CI (`.github/workflows/ci.yml`) runs the whole self-contained set on every PR
and push to main: lint, typecheck, `pnpm test`, and `pnpm build` +
`pnpm worker:dry-run` (the #302 Wasm guard). Realtime integration tests
self-skip there — no Ably key is configured in CI by decision (#189). The
prerequisite-bound suites in the table above stay local.

Ad-hoc vitest modes still work without dedicated scripts: `pnpm exec vitest --ui`,
`pnpm exec vitest run --coverage`.

## Database

```bash
pnpm db:generate  # Generate migrations from schema changes
pnpm db:migrate   # Apply migrations
```

### An additive NOT NULL column needs a DEFAULT

SQLite refuses `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a non-null
`DEFAULT` — but **only when the table already holds rows**. A migration that
omits the default still applies perfectly against the one database that has
always been migrated in step, because the table happened to be empty when it
ran, and then fails the first time the journal is replayed against a backup
restore or a new environment seeded with data. Two migrations shipped this way
before anyone noticed (#310), so read every generated migration before
committing it and add the `DEFAULT` yourself; `pnpm db:generate` will not.

A constant default is not always sufficient. Where the new column carries a
unique index, every pre-existing row would take the same value and collide, so
the migration needs a per-row backfill between the `ALTER` and the
`CREATE UNIQUE INDEX` — `0007_serious_the_hunter.sql` is the worked example, and
`hex(randomblob(n))` and the row's own primary key are the two ways it makes
values that differ. Prefer repairing a migration in place to adding a corrective
one: D1 records applied migrations **by name**, so an edit is a no-op wherever
the original already ran, and the repair only ever changes what a replay does.
`test/unit/server/db/migrationJournalReplay.test.ts` replays the whole journal
against populated tables and is what catches the omission.

## Releases

Versioning is automated from the conventional commit history by
[release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release-please.yml`): `fix:` bumps patch, `feat:` bumps
minor, `feat!:`/`BREAKING CHANGE` bumps major. It maintains a single rolling
**Release PR** against main showing the pending version and `CHANGELOG.md`
diff. **Merging that PR is the release**: it tags `vX.Y.Z`, publishes a GitHub
Release, and bumps `package.json`. The baseline is the `v1.0.0` tag, cut at
adoption from what production was then running.

Releases exist so deploys have something formal to ship: the Deploy workflow
below promotes released tags, never main's HEAD. There is no `develop` branch
by decision — main is trunk, tags are the releasable snapshots.

Requires the repo setting Settings → Actions → General → **"Allow GitHub
Actions to create and approve pull requests"**, or release-please cannot open
its PR. Its PRs don't trigger CI on themselves (default-token limitation) —
acceptable while main has no required status checks; wire a PAT before ever
adding that protection.

## Deploy

NuxtHub generates the deployable configuration at
`.output/server/wrangler.json`. `wrangler.jsonc` contains shared runtime policy;
D1 and KV bindings are generated from `nuxt.config.ts` so each binding has one
configuration owner.

Preview the built Worker locally:

```bash
pnpm preview
```

The preview command applies migrations to an ignored local D1 store before
starting the generated Worker; it never connects to a remote database.

Validate the generated artifact without deploying:

```bash
pnpm build
pnpm worker:dry-run
```

The bundle wrangler would upload lands in `.output/wrangler-dry-run/`;
`scripts/worker-dry-run.mjs` explains why that path is passed absolute. The same
command then asserts the bundle contains no `new WebAssembly.Module(` — a
deployed Worker refuses to compile Wasm from bytes, so that pattern reaching
production means every JPEG and WebP ingestion fails once promoted (#302).
`pnpm deploy` runs this before promotion, not after. The guard self-tests on
every run, and can be exercised alone with
`node scripts/assert-no-runtime-wasm.mjs --self-test`.

Verify the still-image compatibility profile in an installed Chrome or Chromium:

```bash
pnpm test:browser:still-images
```

Run the same representative browser gate against a deployed staging Worker:

```bash
STREAM_KEEPR_BROWSER_ACCEPTANCE_URL=https://stream.keepr.digital \
	pnpm test:browser:still-images:deployed
```

Deploy production, including pending D1 migrations:

```bash
pnpm deploy
```

The same deploy can be triggered from GitHub Actions instead: the **Deploy**
workflow (`.github/workflows/deploy.yml`) is `workflow_dispatch`-only — never
merge-triggered — and runs exactly what `pnpm deploy` runs. It decides for
itself whether the silent-video validator Worker must deploy first: the
`validator` input defaults to `auto`, which diffs
`workers/silent-video-validator` between the commit the last successful
production deployment shipped and the target release; `always`/`never`
override the detection. The deployed commit is read from the `production` git
tag, which a successful deploy moves to exactly what it shipped (with the
GitHub `production` environment's deployment records as a pre-tag fallback).
Unlike the local path it ships a
**released tag**, never main's HEAD: its `version` input takes `latest` (the
default) or an explicit tag like `v1.2.0`, resolved through GitHub Releases —
which also makes rollback "dispatch Deploy with the previous tag". It requires the
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets, and
refuses to start until its `d1_recovery_point` input is the word `confirmed`,
mirroring the recovery-point check below. Either way, the deployed acceptance
gates and the "nothing on air" call remain the operator's, run locally per
[Deploy day, in order](#deploy-day-in-order).

Production uses the versioned D1 and KV IDs hardcoded in `nuxt.config.ts`.

Before a production migration, inspect the remote migration list and confirm a
recent D1 Time Travel recovery point or export exists:

```bash
CLOUDFLARE_ENV=production pnpm build
pnpm db:migrations:list:remote
```

`CLOUDFLARE_ENV` is read by `@nuxthub/core` (`processWranglerConfigFile`,
`node_modules/@nuxthub/core/dist/module.mjs:101-102,158-167`) while post-processing
the generated `wrangler.json`, which looks for a matching `env.<value>` block to
select. The generated config currently defines no named environments (confirmed by
building and inspecting `.output/server/wrangler.json` — no `env` key — and by the
`[nuxt:hub] No environment "production" found in wrangler config, using top-level
configuration` build log line), so it has no effect on the deployed artifact today.
It is kept because NuxtHub's environment-selection convention expects it and
Wrangler itself falls back to `CLOUDFLARE_ENV` for `--env` selection when the flag
is omitted; removing it would silently break environment selection if named
environments are ever added to the generated config.

In the `deploy` script, `CLOUDFLARE_ENV=production` is a shell prefix scoped only
to the `pnpm build` sub-command that immediately follows it (`VAR=x cmd1 && cmd2`
exports `VAR` to `cmd1` only, not to anything chained after `&&`), so it does not
reach the later `wrangler deploy` invocation in the same script.

D1 records applied migrations by name. If an environment already applied an
earlier revision of `0004_tense_otto_octavius.sql`, the corrected data-preserving
file will not run there again; recover missing legacy deck rows from a backup or
Time Travel before continuing.

The deploy scripts use the repository-pinned Wrangler version. They perform a
build and dry run, apply pending D1 migrations, and only then deploy the Worker.
D1 migration and Worker promotion are separate Cloudflare operations, not one
atomic transaction. Schedule incompatible schema changes for a maintenance
window; if Worker promotion fails after a migration, use the verified D1 Time
Travel recovery point or export before restoring traffic.

After `wrangler deploy` promotes the Worker, `pnpm deploy` chains into
`pnpm deploy:verify` (`scripts/deploy-verify.sh`), which curls the deployed
`GET /api/time` health endpoint a few times (`curl --retry 3
--retry-all-errors`, 15s timeout) to ride out cold starts and confirm the new
Worker is actually serving traffic. The production hostname is
**`https://stream.keepr.digital`**, committed as a `custom_domain` route in
`wrangler.jsonc` and the default for `STREAM_KEEPR_DEPLOY_HEALTH_URL`; set that
env var only to verify a different target. If `deploy:verify` fails, roll back manually:
redeploy the previous Worker version (Cloudflare dashboard → Workers & Pages →
this Worker → Deployments, or `wrangler versions` / `wrangler rollback`), then
reconcile any D1 migration that already applied using the Time Travel recovery
point or export identified above.

### Deploy day, in order

The full procedure — including what each gate proves, the Safari automation
setup, and the manual fault-injection steps — is
`docs/operations/graphics-staging-acceptance.md`. The short form:

1. **Pre-flight**: Docker running (the silent-video validator is a Container);
   Worker secrets present (`pnpm exec wrangler secret list --name stream`); no
   leftover `workerd` processes from local suites.
2. **Deploy both Workers, validator first** so the service binding resolves:

   ```bash
   pnpm deploy:validator
   pnpm deploy
   ```

   `pnpm deploy` ends in `deploy:verify` against `https://stream.keepr.digital`;
   do not continue past a failure — see the rollback path above.

3. **Run the deployed gates, in order, stopping at the first failure**:

   ```bash
   pnpm test:validator:silent-video:deployed
   pnpm test:delivery:graphics:deployed
   pnpm test:browser:still-images:deployed
   pnpm test:browser:silent-video:deployed
   pnpm test:browser:fonts:deployed
   pnpm test:browser:safari-vp9-alpha:deployed
   pnpm test:delivery:graphics:package:deployed
   ```

   Each provisions real Events and assets in the production installation and
   deletes them on the way out; a harness that dies mid-run names the Event to
   remove before rerunning.

4. **Fault injection** (`docs/operations/graphics-staging-acceptance.md`,
   step 8) is manual, breaks real delivery while armed, and is never run while
   anything is on air.

Realtime stays within the Ably **Free** plan by decision (#189): validate
against free-tier limits, and report — never work around — anything that would
exceed them.

### Worker secrets

After building the intended environment, configure its Ably server key against
the generated Worker config:

```bash
pnpm exec wrangler secret put NUXT_ABLY_API_KEY --config .output/server/wrangler.json
```

Secrets belong to a specific Worker.

### The first admin account

Accounts are created by an admin and there is no self sign-up, so a fresh
installation has nobody who can create the first one. `NUXT_ADMIN_BOOTSTRAP_TOKEN`
is what breaks that circle: while it is set, `POST /api/bootstrap/ensure-admin`
creates the named account as an admin, or — if the email already exists — sets
the given password on it and gives it the admin role. While it is unset, the
route answers 503 and names the secret.

Three steps, in order, and the third is not optional:

```bash
openssl rand -base64 32   # the value for the next command
pnpm exec wrangler secret put NUXT_ADMIN_BOOTSTRAP_TOKEN --config .output/server/wrangler.json

curl -X POST https://stream.keepr.digital/api/bootstrap/ensure-admin \
  -H "x-admin-bootstrap-token: <the value above>" \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"<a strong password>","name":"Your Name"}'

pnpm exec wrangler secret delete NUXT_ADMIN_BOOTSTRAP_TOKEN --config .output/server/wrangler.json
```

The answer says which branch ran — `{"outcome":"created"}` or
`{"outcome":"updated"}` — so a curl you are not sure landed can simply be
repeated: the same body twice leaves one account in the same state.

The same ceremony is the way back in if every admin loses their password. There
is no email sender in this installation, so no reset link exists to fall back
on; run the three steps again with the same email and a new password. It does
not lift a ban, and it does not rename an existing account.

Nothing stores "already bootstrapped" — deleting the secret is what disarms the
route, which is why the third command matters. Locally the name lives in `.env`
and `.dev.vars` and can stay set; a deployed installation should hold it only
for the minute between the first and third commands.

### Screen Output asset capabilities

Screen Outputs use opaque, revocable capabilities to resolve only the exact
Graphic Asset Revisions in their current published state. Configure a
deployment-level 32-byte base64 signing key and keep it server-side. Changing
this key revokes every existing Screen Output asset capability; rotate each
Screen's asset access afterward before using its output URL again.

```bash
openssl rand -base64 32
pnpm exec wrangler secret put NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY --config .output/server/wrangler.json
```

### Melee credential encryption

Melee client secrets are stored as AES-256-GCM envelopes in D1. Before saving
or using a Melee integration, configure a deployment-level 32-byte base64 key
and a non-empty key version. Keep the key server-side; never add it to
`wrangler.jsonc`, source control, or Nuxt `public` runtime config.

```bash
openssl rand -base64 32
pnpm exec wrangler secret put NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY --config .output/server/wrangler.json
pnpm exec wrangler secret put NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY_VERSION --config .output/server/wrangler.json
```

For local development, set the corresponding values from `.env.example` in an
ignored `.env` file. Existing plaintext rows remain readable temporarily and
are encrypted when their Melee configuration is next saved.

To rotate keys, retain the old version and key in the server-side
`NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` JSON object, deploy the new
active key and version, then re-save each enabled Melee integration. Remove an
old key only after all envelopes using that version have been re-wrapped.

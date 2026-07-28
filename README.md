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

## Database

```bash
pnpm db:generate  # Generate migrations from schema changes
pnpm db:migrate   # Apply migrations
```

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

Verify the still-image compatibility profile in an installed Chrome or Chromium:

```bash
pnpm test:browser:still-images
```

Run the same representative browser gate against a deployed staging Worker:

```bash
STREAM_KEEPR_BROWSER_ACCEPTANCE_URL=https://staging.example.workers.dev \
	pnpm test:browser:still-images:deployed
```

Deploy production, including pending D1 migrations:

```bash
pnpm deploy
```

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
earlier revision of `0004_condemned_malice.sql`, the corrected data-preserving
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
Worker is actually serving traffic. It reads the target from
`STREAM_KEEPR_DEPLOY_HEALTH_URL`, the production Worker's base URL (e.g.
`https://stream-keepr.example.workers.dev`); no domain is committed to the
repo, so set this env var before running `pnpm deploy` or the script fails
immediately with a clear message. If `deploy:verify` fails, roll back manually:
redeploy the previous Worker version (Cloudflare dashboard → Workers & Pages →
this Worker → Deployments, or `wrangler versions` / `wrangler rollback`), then
reconcile any D1 migration that already applied using the Time Travel recovery
point or export identified above.

### Worker secrets

After building the intended environment, configure its Ably server key against
the generated Worker config:

```bash
pnpm exec wrangler secret put NUXT_ABLY_API_KEY --config .output/server/wrangler.json
```

Secrets belong to a specific Worker.

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

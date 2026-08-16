# Better Auth on Cloudflare Workers + D1 assessment

_Researched 17 August 2026 for [#384](https://github.com/KeeprDigital/stream-keepr/issues/384) (map: #383) against the official Better Auth documentation, the `better-auth/better-auth` GitHub repository (issues, releases, source), and Cloudflare Workers documentation. Stack under assessment: Cloudflare Workers (`cloudflare_module` preset via NuxtHub), D1 + Drizzle, Nuxt 4 SPA (`ssr: false`)._

## Recommendation

**Viable for production on this stack**, with three conditions:

1. **Keep sessions in D1 via the Drizzle adapter** — not KV `secondaryStorage`. D1-backed sessions get Better Auth's native sliding expiry (`expiresIn` + `updateAge`), have no KV single-key write cap or eventual-consistency window, and avoid the plugin's worst Cloudflare bug history (#4203).
2. **Resolve the password-hashing CPU question before committing.** Better Auth defaults to scrypt; on workerd it falls back to a pure-JS implementation unless a native `node:crypto` is available. This repo pins nodejs_compat **v1** (`no_nodejs_compat_v2` in `wrangler.jsonc`), which likely forces the pure-JS path. Either lift that flag (find out why it is pinned first) or override `emailAndPassword.password.{hash,verify}` with WebCrypto PBKDF2. Hashing only runs at login/user-creation/password-set, never per-request, so this is a bounded cost either way — but on the free plan it is a hard failure, and this account should confirm its CPU limits.
3. **Generate the Better Auth tables through the existing drizzle-kit pipeline** so `server/db/migrations/sqlite/` remains the single migration history (details below).

Everything else the ticket asked about — admin-created accounts with self-signup disabled, invitation/password-set, sliding/idle expiry compatible with ADR-0003, Nuxt `ssr: false` integration, and future headroom (OAuth, passkeys, roles/orgs) — is supported first-party, with the specifics and caveats below.

## Workers / edge runtime compatibility

- **`nodejs_compat` is required.** Without it, `Buffer is not defined` at runtime; the ask to run without the flag ([#1375](https://github.com/better-auth/better-auth/issues/1375)) is closed. This repo already ships `"compatibility_flags": ["nodejs_compat", ...]` ([wrangler.jsonc](../../wrangler.jsonc#L6)), so the requirement is already met.
- **nodejs_compat v2 caveat (repo-specific):** `wrangler.jsonc` also pins `no_nodejs_compat_v2`, with no recorded reason. Better Auth's password module picks native `node:crypto` scrypt when the runtime exposes it and otherwise falls back to `@noble/hashes` pure-JS scrypt ([source](https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/crypto/password.ts)). v1 nodejs_compat's polyfilled `node:crypto` is far thinner than v2's, so under the current flags expect the pure-JS path. Community reports show sign-up exceeding the Workers CPU limit on the free tier with exactly this shape ([report](https://www.answeroverflow.com/m/1357795265108512808)); paid-plan default CPU limits absorb it. Mitigations: drop the pin, or supply a WebCrypto-based `password.hash`/`verify`.
- **Cold start:** no documented Better Auth startup blowout; the cost is ordinary bundle weight against the Workers 400 ms startup CPU limit, measurable with `wrangler check startup` ([Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-07-31-wrangler-startup-profile-summary/)). One structural constraint: D1/KV bindings exist only in request context on workerd, so the `betterAuth()` instance must be constructed lazily/per-request with the event's bindings — which is how Nitro server code in this repo already reaches `hubDatabase()`.
- **Known CF-specific breakages, all fixed:** module-load failure via `createRequire` ([#6665](https://github.com/better-auth/better-auth/issues/6665), closed), `nodejs_compat` requirement (#1375, closed), `secondaryStorage` TTL forcing re-login ([#4203](https://github.com/better-auth/better-auth/issues/4203), closed after a January 2026 reopen). A maintained community integration package exists ([zpg6/better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare): D1/KV/R2/geolocation, ~574 stars) but targets Hono/Next/SvelteKit, not Nuxt; treat it as reference material, not a dependency.

## D1 / Drizzle adapter and migrations

- The Drizzle adapter is first-party and supports `provider: "sqlite"`, which covers D1 through `drizzle-orm/d1` ([adapter docs](https://www.better-auth.com/docs/adapters/drizzle); working D1+Drizzle+Workers example in [discussion #7963](https://github.com/better-auth/better-auth/discussions/7963)). Options cover table renaming (`schema`/`modelName`), `usePlural`, and (since 1.4) relational joins.
- **Schema:** `npx @better-auth/cli generate` emits a Drizzle schema file for the four core tables — `user`, `session`, `account`, `verification` — plus whatever plugins add (admin adds user fields such as `role`/`banned`; passkey adds a `passkey` table) ([database concepts](https://www.better-auth.com/docs/concepts/database)).
- **Migrations coexist cleanly.** The Better Auth CLI's `migrate` command only works with its built-in Kysely adapter; with Drizzle the documented path is `drizzle-kit generate` ([adapter docs](https://www.better-auth.com/docs/adapters/drizzle)). The migrations in `server/db/migrations/sqlite/` are already drizzle-kit output, so the auth tables become ordinary entries in the existing schema + one more generated SQL migration in the same history — no second migration system, no runtime DDL. (The ticket's "raw-SQL" framing understates how good the fit is: this is the exact pipeline the repo runs today.)
- D1's access-prohibited `_cf_METADATA` table can trip generic CLI introspection (`SQLITE_AUTH`); irrelevant when schema generation happens from config, not DB introspection.

## Session model vs ADR-0003

- **Sliding expiry is native and default.** Sessions live in a DB table (`token`, `expiresAt`, `userId`, `ipAddress`, `userAgent`); when a request touches a session older than `updateAge` (default 1 day) its `expiresAt` is re-extended by `expiresIn` (default 7 days) ([session management](https://www.better-auth.com/docs/concepts/session-management)). This is exactly ADR-0003's idle-bound sliding model, and `updateAge` is the same write-suppression grace this codebase implements by hand as `GRAPHICS_AUTHOR_SESSION_REFRESH_AFTER_SECONDS` — except against D1 there is no KV ~1-write/s single-key cap to protect at all. A concurrent-part upload burst refreshes at most once per `updateAge` window. Set `expiresIn`/`updateAge` to taste (e.g. 8 h / 60 s to mirror ADR-0003).
- **Storage options, ranked for this app:** (1) **D1 sessions** — recommended; strongly consistent, sliding, one DB read per `getSession` unless cached. (2) **`cookieCache`** on top — optional read-reduction; signed short-lived cookie snapshot; delays cross-device revocation until the cache expires. (3) **KV `secondaryStorage`** — supported (simple `get`/`set`/`delete`-with-TTL interface) but not recommended as the system of record: KV is eventually consistent (~60 s cross-PoP, so a fresh login can be invisible at another edge), the single-key write cap returns, and the cookieCache+secondaryStorage interaction is where #4203 lived.
- `freshAge` (default 1 day) gates a few sensitive endpoints on session age; configurable, `0` disables. Revocation APIs (`revokeSession`/`revokeOtherSessions`/`revokeSessions`) and `preserveSessionInDatabase` (audit-friendly soft delete) exist.

## Admin-created accounts, self-signup disabled

- `emailAndPassword.disableSignUp: true` blocks public registration while keeping sign-in ([email & password docs](https://www.better-auth.com/docs/authentication/email-password)).
- The **admin plugin** provides `createUser` (email, password, name, role, extra fields), `setUserPassword`, `listUsers` (search/filter/paginate), `banUser` (revokes sessions), impersonation, and role management; admins are designated via `adminUserIds` or the `role` field ([admin plugin docs](https://www.better-auth.com/docs/plugins/admin)).
- **Invitation / password-set:** no first-class "invite" flow in core. The supported composition: admin `createUser` with a random password, then `requestPasswordReset` → `sendResetPassword` hook emails a set-password link → `resetPassword` completes it; `revokeSessionsOnPasswordReset` is available. The organization plugin has a real invitation flow if orgs are ever adopted. The app must supply an email sender either way — Better Auth only exposes the hook.

## Nuxt integration with `ssr: false`

- **Server:** one Nitro catch-all — `server/api/auth/[...all].ts` calling `auth.handler(toWebRequest(event))` ([Nuxt integration docs](https://www.better-auth.com/docs/integrations/nuxt)). Plain Nitro; nothing preset-specific, so it mounts identically under `cloudflare_module`.
- **Client:** `createAuthClient` from `better-auth/vue` gives reactive `useSession`/`signIn`/`signOut`. The docs' SSR complications (cookie forwarding, `useFetch` hydration) all vanish with `ssr: false` — the SPA case is the *simple* path. Route protection is ordinary Nuxt middleware client-side plus `auth.api.getSession({ headers })` in server routes, which is the credential ADR-0008 planned to attach at the existing `requireGraphicsAuthorSession` seams.
- The docs never demonstrate `ssr: false` explicitly; nothing in the mechanism depends on SSR, but budget a spike to confirm cookie behavior on the deployed origin (`baseURL`/`trustedOrigins` must be set).

## Future headroom

All first-party: social OAuth providers + generic OAuth plugin; **passkeys** (plugin backed by SimpleWebAuthn, adds one table) ([passkey docs](https://www.better-auth.com/docs/plugins/passkey)); **admin** (roles/permissions via `createAccessControl`, banning, impersonation); **organization** (orgs, member roles, invitations); plus 2FA, API keys, magic links. Adopting a plugin later means regenerating the Drizzle schema and shipping one more drizzle-kit migration — same pipeline.

## Maintenance signals

- ~29.6 k stars, MIT, pushed daily (checked 2026-08-17). Release cadence is aggressive: v1.6.23 → v1.6.29 between 29 Jun and 14 Aug 2026, with v1.7 at rc.6 ([releases](https://github.com/better-auth/better-auth/releases)).
- **Breaking-change posture:** 1.x line since late 2024; the [1.6 release](https://better-auth.com/blog/1-6) explicitly positioned itself as a backward-compatible bridge, with per-package release notes and OIDC trusted publishing + provenance on npm artifacts.
- **Security handling — the strongest and most double-edged signal:** in [June 2026](https://better-auth.com/blog/security-update-june-2026) the project coordinated **11 advisories** (2 critical, 8 high), patched on the stable line (1.6.11/1.6.14) with simultaneous disclosure and breaking fixes routed to the beta channel. Handling was exemplary; the volume says the attack surface is real. Notably, the critical/high findings clustered in SSO, OIDC/MCP, OAuth-provider, and SCIM plugins — **not** in the email/password + session core this app would run. Staying off those plugins keeps the exposed surface small.
- Issue tracker: 653 open issues+PRs — high in absolute terms for a security-critical dependency, but the CF-relevant defects tracked above were all triaged to closure, including a reopened one. Expect to pin versions and read release notes on every bump.

## Unresolved questions for the deciding issue (#386)

1. Why is `no_nodejs_compat_v2` pinned, and can it be lifted? If not, is a WebCrypto `password.hash` override acceptable?
2. Target session policy numbers: keep 8 h idle / 60 s grace from ADR-0003, or adopt Better Auth defaults (7 d / 1 d)?
3. Does the Graphics Author Session (attribution, ADR-0003) merge into the Better Auth session, or continue alongside it with ownership moving to the authenticated user (the ADR-0003 "reopen" clause)?
4. Which email sender backs the invite/set-password flow on Workers?

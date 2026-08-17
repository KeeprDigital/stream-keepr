# ADR-0010: Authentication replaces the anonymous author session — Better Auth, person-owned operations, deny-by-default

- **Status**: Accepted
- **Date**: 2026-08-17
- **Issue**: [#383](https://github.com/KeeprDigital/stream-keepr/issues/383) (the design map; decision tickets #384–#391)
- **Supersedes**: ADR-0008's "no boundary" clause, as that record said this work should; reopens ADR-0003's ownership clause exactly as it pre-committed ("ownership moves to the person")

## Context

ADR-0008 recorded that the installation has no authentication boundary by design, trusts its network perimeter, and named the seams a real credential would attach to. This record is that credential's design, locked before implementation on wayfinder map #383. The standing constraints: single-tenant, a small invited team, sign-in by **email/password only**, accounts **created by an admin** with no self-signup, and a library choice that leaves OAuth/passkeys and roles/organisations open for later. This is authentication only — no roles or permissions model is designed here.

## Decision

### Library: Better Auth, sessions in D1

**Better Auth**, with sessions in **D1 via the first-party Drizzle adapter** — not KV `secondaryStorage`. Its native sliding expiry (`expiresIn`/`updateAge`) supplies ADR-0003's idle-bound model with no KV single-key write cap to protect, and its tables generate into the existing drizzle-kit pipeline so `server/db/migrations/sqlite/` stays the single migration history.

- **Plugin surface kept minimal**: email/password with `disableSignUp: true`, plus the admin plugin (admin-created accounts, `setUserPassword`, banning). Stay off the SSO/OIDC/SCIM/OAuth-provider plugins — where the June 2026 advisory cluster lived. OAuth, passkeys, roles, and orgs remain first-party options for later.
- **The `no_nodejs_compat_v2` pin stays.** Better Auth reaches native `node:crypto` scrypt at build time via the `workerd` export condition in `@better-auth/utils` (verified on 1.6.29 and main; ~21 ms per hash in the repo's exact flags). The native path depends on the bundler resolving that condition, so implementation adds a smoke assertion.
- **No email sender.** Invite = admin-created account plus a single-use, expiring password-reset link the admin hands over out-of-band (team chat); resets work the same way. An email integration is a later enhancement, not an auth dependency.
- **Version posture**: pin exact versions; read release notes on every bump. Workers paid plan confirmed, so scrypt CPU cost is comfortably bounded.

### Credential model: the user replaces the Graphics Author Session

The authenticated user **replaces** the anonymous session rather than layering on it. The KV author-session module is retired at cutover; Better Auth's D1 session (per-browser, sliding, server-side, revocable) and its user become the only identities — no second self-issued identity space survives beside the credential, the exact hazard ADR-0003 named for device identifiers.

- **Operation ownership moves to the person.** `initiatedBy` on Graphics Ingestion Operations becomes the **userId** — the reopening ADR-0003 pre-committed to. An operation paused overnight at `awaiting-confirmation` survives its browser; sign-in from any machine resumes it. The idempotency scope `(initiatedBy, idempotencyKey)` widens from browser to person: the same key from two browsers dedupes to one operation, which is intentional dedupe, not a side effect. "The same person in a second browser is still a second author" is retired from `docs/operations/approved-remote-graphics-copy.md`.
- **The lease holder stays browser-scoped.** Leases guard concurrent *editors*, and one person in two browsers is two editors — a userId holder would let them silently corrupt each other. `holderSessionId` carries the Better Auth **session id** (the same granularity as today's authorId); takeover UI resolves session → user for display.
- **The Evidence Ledger actor becomes the userId**, display name resolved at read time so it stays stable across renames. Legacy anonymous-authorId rows are untouched — an opaque actor is an accurate record of the anonymous era. Admin-token-driven entries keep their current actor spelling.
- **Session policy: Better Auth defaults — `expiresIn` 7 days, `updateAge` 1 day.** Both drivers of ADR-0003's 8-hour-idle/60-second-grace shape are gone: a lapse no longer destroys ownership of work, and D1 sessions have no KV write cap. A mid-show forced re-login is the costliest failure this product can buy; the abandoned-shared-machine risk is answered by admin session revocation and banning rather than a short idle window.
- **The Graphics Administrator shared token is untouched.** It remains the admin credential until a roles/permissions effort — out of scope here — redraws that seam. It is the named successor-work seam.

### Protection boundary: deny-by-default over `/api/**`

One global server middleware requires a Better Auth session on every `/api/**` route unless the path is on an enumerated public allowlist. A new route is private until consciously allowlisted — it fails closed, where the guard-by-guard posture left all 96 `events/**` routes (including the on-air screen command route and the Melee credential write) fully public.

The exhaustive public allowlist: `/api/auth/**` (login must be reachable), `/api/time` (output drift correction), `/api/realtime/token` (internally scoped below), `/api/screen-output/**` (capability-authorized, 404-refusing posture preserved), the admin-bootstrap route below, and the SPA shell with its static assets (unavoidably public under `ssr: false`).

- `events/[id]/screens/slug/[slug].get` **leaves** the public surface: it folds into the capability surface, requiring the Screen Output Asset Capability bearer the output page already holds in its URL hash, and refuses 404 like the rest of that surface.
- **Realtime token: dual-grant, no anonymous issuance.** An authenticated user gets today's grant shape (event channel plus all screen channels, subscribe/history/presence) with `clientId` = the userId, not `'*'`. A capability bearer gets a grant narrowed to that screen's channels plus its event channel, `clientId` = a screen-output identity. Screen outputs stay credential-free in ADR-0008's sense — the capability already in hand *is* their credential.
- **The 18 `admin/**` routes are exempt**: `x-graphics-admin-token` alone satisfies the boundary, exactly today's posture, per the shared token staying untouched.
- **Refusal shape.** A missing session inside the boundary → **401** with one uniform message (a single entry for any refusal census). The capability surface keeps its 404-never-401/403 posture. The screen-command path's new 401 is legitimately added to `SCREEN_COMMAND_ROUTE_REFUSALS` — the case the scan's docblock permits, since the route really raises it now. Pages are gated client-side only (redirect to login, screen-output page excepted) — UX, not security; the API boundary is the wall.

### First-admin bootstrap: a secret-armed endpoint

A dedicated route is active only while a dedicated Worker secret is set — the `NUXT_GRAPHICS_ADMIN_TOKEN` pattern (blank → the 503 `ServiceConfigurationError` posture naming the env var). Suggested name `NUXT_ADMIN_BOOTSTRAP_TOKEN`.

- **Ensure semantics** — create-or-reset: a new email creates an admin account; an existing one gets the given password and admin role, via Better Auth's server-side admin API so rows are always Better Auth-shaped. Idempotent, no junk accounts on recovery.
- One mechanism covers **install #1 and break-glass lockout** (no email sender exists, so lockout is otherwise unrecoverable without hand-editing D1, which would orphan `initiatedBy` and Evidence Ledger references).
- **Curl-only operator ceremony**, documented in the README worker-secrets/deploy section: set secret → curl create admin → delete secret. Disarm is a documented operator step, no stored self-limiting state. Dev and preview arm the same route via `.dev.vars`, so the path is exercised constantly rather than once ever.

### Cutover: drain-first, no migration code

A **scheduled quiet-window deploy** — single-tenant, the owner controls the calendar — with **no transition machinery built**:

- In-flight anonymous operations drain first; anything left behind is reclaimed by the existing 24-hour retention sweep. Orphaned operation rows stay (a sentinel rewrite could collide on the `(initiated_by, idempotency_key)` unique index and would falsify the record).
- **Known wart, recorded so nobody debugs it as a mystery**: admin retry (`admin/graphics-assets/ingestion-operations/[operationId]/retry.post.ts`) can revive an anonymous-era orphan, which then stalls at any author-scoped step — its `initiatedBy` can never match again — and re-expires under the 24-hour sweep. A harmless self-healing zombie. The cockpit shows an "anonymous era" fallback where an initiator resolves to no user.
- Leases lapse on their own (≤180 s TTL); the KV author-session namespace clears itself via its native 8-hour TTL once nothing can read it. The two browser cookies are expired with `maxAge: 0` at cutover as hygiene.

## Consequences

- ADR-0008's perimeter-trust stance ends at cutover; its seam inventory is where this design attaches. ADR-0003's sliding-8-hour session shape retires with both of its drivers; its ownership boundary argument (ownership bounds who reads unpublished staged bytes) now binds to the person.
- New 401s inside the boundary will trip the `test/helpers/routeRefusalScan.ts` census; each addition is legitimized deliberately, never blanket-silenced.
- The Graphics Author Session leaves the domain model at cutover: `CONTEXT.md`'s entry and every surface that names a session lapse move to the user/session split above. Until cutover the glossary keeps describing what runs.
- Roles/permissions, a Screen Output Asset Capability redesign, and multi-tenancy were consciously ruled out of this design's scope.

## Alternatives rejected

- **nuxt-auth-utils** — a toolkit, not an auth system: users, invites, reset, and revocation all hand-built; its sealed-cookie session is a fixed window with no revocation, the exact mid-upload-expiry shape ADR-0003 eliminated. **@sidebase/nuxt-auth** not credible on Workers; **Lucia** deprecated.
- **Layering the credential on the Graphics Author Session** — two identity spaces to keep consistent, ADR-0003's named hazard.
- **KV-backed auth sessions** — reinstates the single-key write cap ADR-0003 engineered around.
- **Migration/adoption tooling for anonymous-era work** — drain-first plus existing retention reclaims everything a sweep can; the leftovers are accurately recorded as anonymous.
- **Guard-by-guard protection** — fails open on every route someone forgets; deny-by-default fails closed.

## Related

ADR-0003 (ownership and the sliding session this replaces) · ADR-0008 (the stance this supersedes) · map [#383](https://github.com/KeeprDigital/stream-keepr/issues/383) · research #384/#385 (`docs/research/better-auth-cloudflare.md`, `docs/research/nuxt-native-auth.md`) · decisions #386 (library), #387 (credential model), #388 (boundary), #390 (bootstrap), #391 (cutover)

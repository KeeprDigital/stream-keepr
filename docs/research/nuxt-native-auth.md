# nuxt-auth-utils and Nuxt-native auth on this stack

_Researched 17 August 2026 for [#385](https://github.com/KeeprDigital/stream-keepr/issues/385) (map: [#383](https://github.com/KeeprDigital/stream-keepr/issues/383)) against the nuxt-auth-utils source and README, the h3 v1 session source, Cloudflare's Node.js-compatibility docs, and an empirical scrypt probe run in workerd under this repo's exact compatibility flags. Stack assumed throughout: Cloudflare Workers (`cloudflare_module` preset), D1 + Drizzle, Nuxt 4 SPA (`ssr: false`)._

## Summary

`nuxt-auth-utils` is a thin, well-maintained toolkit, not an auth system: it gives us sealed-cookie sessions, route guards, a client composable, and scrypt password hashing — and nothing else. Everything the product actually needs beyond that (users table, admin-created accounts, invitations, password reset, revocation) is ours to build either way. The one structural mismatch is its session model: a sealed cookie is a **fixed window measured from creation** with **no server-side revocation**, which is precisely the shape ADR-0003 spent a ticket eliminating. Making it sliding and revocable means putting a session record back on the server — a pattern this codebase has already built once, with its hazards documented, in `server/modules/graphics-author-session.ts`. So the honest framing is: `nuxt-auth-utils` contributes the cookie plumbing, guards, composable, and hashing; the session store and every account-lifecycle flow are hand-built on D1/Drizzle regardless. Workers compatibility is a non-issue on this repo's current flags (verified empirically below). No other Nuxt-native module is credible on Workers; the real alternative is the companion better-auth ticket.

## What nuxt-auth-utils provides vs what we would own

Provided by the module ([README](https://github.com/atinux/nuxt-auth-utils), [session utils source](https://github.com/atinux/nuxt-auth-utils/blob/main/src/runtime/server/utils/session.ts)):

- **Sealed-cookie sessions** via h3 `useSession` — encrypted/signed (iron-style seal over WebCrypto) with `NUXT_SESSION_PASSWORD` (≥ 32 chars). Cookie name `nuxt-session`, `sameSite: 'lax'` default; `maxAge` set via `runtimeConfig.session` or per-call on `setUserSession`.
- **Server utils**: `getUserSession`, `requireUserSession` (throws 401), `setUserSession` (merge), `replaceUserSession`, `clearUserSession`, plus `sessionHooks` — a `fetch` hook that runs whenever the client composable loads `/api/_auth/session` (documented extension point for extra validation) and a `clear` hook on logout.
- **Password hashing**: `hashPassword` / `verifyPassword` / `passwordNeedsRehash`, implemented with `@adonisjs/hash`'s scrypt driver over `node:crypto` ([password.ts source](https://github.com/atinux/nuxt-auth-utils/blob/main/src/runtime/server/utils/password.ts)).
- **Client composable** `useUserSession()`: `loggedIn`, `ready`, `user`, `session`, `fetch()`, `clear()`.
- 40+ OAuth provider handlers and optional WebAuthn/passkeys (peer deps `@simplewebauthn/*`) — available but not needed for admin-created password accounts.

Ours to build (the module has no opinion on any of it):

- **Users table** in D1/Drizzle: identity, credential hash, role/state columns, timestamps.
- **Admin-created accounts and invitations**: creation routes, invitation tokens (generation, storage, expiry, single-use redemption), the accept-invite flow.
- **Password reset**: token table, issuance, delivery, redemption, hash rotation.
- **Login/logout routes**: the README's own example is a hand-written `/api/login` route calling `verifyPassword` then `setUserSession` — the module ships no routes.
- **Session revocation and sliding expiry**: see next section — these require a server-side session record the module deliberately does not have.

## Sealed cookie vs server-side session

- **Everything lives in the cookie.** No server-side storage exists; the source warns to "only store public information since it can be decoded" and the README caps session data at the **4096-byte cookie limit**. Fine for `{ userId, role }`; nothing bulky.
- **No revocation.** A sealed cookie is valid until it expires; the only global kill switch is rotating `NUXT_SESSION_PASSWORD`, which logs out everyone. Per-user/per-session revocation ("disable this account now", "log out that stolen laptop") requires a server-side record consulted per request. The supported seam is the `sessionHooks` `'fetch'` hook plus a check inside `requireUserSession` call sites — i.e. store a `sessionId` in the sealed cookie and look it up in D1 (or KV) on guarded requests. At that point the sealed cookie is a transport for a session id, and the session store is ours.
- **Expiry is a fixed window, not sliding.** In h3 v1 (what Nuxt 4/Nitro ships), the seal carries `createdAt` and unsealing enforces `Date.now() - createdAt > maxAge → "Session expired!"`; `updateSession` re-seals the cookie but **never resets `createdAt`**, and even the cookie's `expires` attribute is computed from `createdAt` ([h3 v1 session source](https://github.com/h3js/h3/blob/v1/src/utils/session.ts)). An 8h `maxAge` therefore reproduces exactly the mid-upload death ADR-0003 removed: active users expire at hour eight regardless of activity. Making it slide means either (a) re-issuing the whole session (fresh `createdAt`) on requests — a `Set-Cookie` per response, and races between parallel requests holding different seals — or (b) ignoring the built-in `maxAge` and keeping `expiresAt` server-side, renewed on activity. Option (b) is what `server/modules/graphics-author-session.ts` already does, including the non-obvious hazard it documents: Workers KV rate-limits writes to a single key, so renewal must be throttled (it renews only when meaningful lifetime has been spent) rather than touched on every request. A D1-backed session row has no such write limit but the throttle is still worth keeping for cost and latency.
- **Long-lived realtime/upload flows**: realtime here is Ably token issuance over ordinary HTTP requests (cookie present), and resumable uploads are many sequential requests — both are served correctly by sliding server-side expiry and both are broken by a fixed 8h seal, which is the ADR-0003 story replayed with a login attached.

**Conclusion**: for this product's stated requirements (sliding 8h idle expiry, revocation), the session must be server-side; the sealed cookie degenerates to carrying an id. That is not an argument against the module — its guards, composable, and hashing still pay for themselves — but the "sessions" headline feature is the part we would largely bypass.

## `ssr: false` SPA fit

The module explicitly supports client-only rendering. Its [client plugin](https://github.com/atinux/nuxt-auth-utils/blob/main/src/runtime/app/plugins/session.client.ts) checks `nuxtApp.payload.serverRendered`; when false (our case) it immediately fetches `/api/_auth/session` on app start, so `useUserSession()` populates without any SSR involvement. Consequences:

- One extra API round trip on every app load before `loggedIn` is truthful; the composable exposes `ready` to gate UI until then, and the README notes nothing renders auth-dependent state "until the user session is fetched on the client-side" for non-SSR modes.
- The `loadStrategy` module option (`'server-first'` default, `'client-only'`, `'none'`) exists for hybrid apps; with `ssr: false` the behaviour is already effectively client-only, and `'none'` would let us fetch manually.
- Server-side, nothing changes: `requireUserSession` guards Nitro routes identically under `ssr: false`. This matches how the repo already works — `graphics-author-session` middleware runs on plain HTML `GET`s of the SPA shell.

## Cloudflare Workers compatibility (verified)

- **Session sealing** uses WebCrypto — no Node dependency, works on Workers unconditionally.
- **Password hashing** is the historical risk: `@adonisjs/hash`'s scrypt driver imports `node:crypto`, and [atinux/nuxt-auth-utils#350](https://github.com/atinux/nuxt-auth-utils/issues/350) reports `No such module "node:crypto"` on the `cloudflare_pages` preset (closed not-planned). That failure mode predates/omits `nodejs_compat`: Cloudflare now [implements `node:crypto` natively in workerd](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/) (unsupported list is only `argon2*`, `generateKeyPair` for DSA/DH, `ed448`/`x448`), and this repo already ships `compatibility_flags: ["nodejs_compat", "no_nodejs_compat_v2"]`, `compatibility_date: 2026-07-16` (`wrangler.jsonc`).
- **Empirical probe** (17 Aug 2026): a minimal worker calling `node:crypto` `scrypt` with `N=16384, r=8, p=1` under this repo's exact flags and date, run in local workerd via `wrangler dev --local` (wrangler 4.x), returned successfully in ~21 ms with output byte-identical to Node 's `scryptSync` for the same inputs. So native scrypt works even in v1 compat mode (`no_nodejs_compat_v2`), no bundler polyfill involved.
- **CPU budget**: ~tens of ms per hash at default cost is comfortably inside the paid plan's default 30 s CPU limit; only the free plan's 10 ms cap would be marginal, and this deployment is not on it. Memory (~16 MB for N=16384) fits the 128 MB isolate.

## Other Nuxt-native contenders

- **@sidebase/nuxt-auth** — wraps Auth.js (plus a `local` provider); SSR-oriented by design. Actively maintained (v1.3.1, 30 Jun 2026; ~1.5k stars) but has an **open, unreproduced breakage on Cloudflare Pages/Workers** ([sidebase/nuxt-auth#1011](https://github.com/sidebase/nuxt-auth/issues/1011), `n.default is not a function` on `/api/auth/session`, open since Mar 2025, still `needs-reproduction`). Auth.js's session model is also cookie-JWT by default with the same revocation gap, and the module is heavier than what admin-created password accounts need. Not credible on this stack today.
- **Hand-rolled, Lucia-style** — Lucia the library was [deprecated March 2025](https://lucia-auth.com/); the site is now an explicit tutorial for rolling your own D1-friendly sessions (hashed random token in an `httpOnly` cookie, session row with `expires_at`, sliding renewal). This is credible on Workers by construction — and it is nearly isomorphic to what `graphics-author-session.ts` already implements against KV, minus users and credentials. Choosing nuxt-auth-utils versus hand-rolling is therefore a small delta: the module adds maintained cookie sealing, the `useUserSession` composable, guard helpers, and vetted scrypt defaults over what we'd write ourselves.
- **better-auth** — the full-featured contender (owns users/invitations/reset/revocation as features rather than homework); covered by its own research ticket under #383, not re-argued here.

## Maintenance signals

| Option | Latest release | Activity | Notes |
| --- | --- | --- | --- |
| nuxt-auth-utils | v0.5.30, 4 Aug 2026 | 1,590 stars, 141 open issues, steady releases through 2025–26 | Authored by Atinux (Nuxt core team); listed in the official Nuxt modules registry; still 0.x, so minor-version breaking changes are contractual |
| @sidebase/nuxt-auth | v1.3.1, 30 Jun 2026 | 1,548 stars, active repo | CF Workers breakage open since Mar 2025 |
| Lucia | — | Deprecated Mar 2025 | Maintained only as a learning resource |
| h3 v1 session (transitive) | ships with Nitro | Nuxt-team maintained | Fixed-window `createdAt` semantics are v1 behaviour we'd depend on |

## What adoption would actually look like here

1. `nuxt-auth-utils` module + `NUXT_SESSION_PASSWORD` secret; sealed cookie carries `{ sessionId, userId }` only.
2. D1/Drizzle tables: `users`, `sessions` (with `expires_at` for sliding renewal, revocation by row delete), `invitations`, `password_reset_tokens` — all hand-built.
3. Guards: `requireUserSession` wrapped with a D1 session-row check (via `sessionHooks` `'fetch'` and a small server util), replacing/absorbing `requireGraphicsAuthorSession` at the seams ADR-0008 reserved for a real credential.
4. Sliding 8h idle expiry implemented server-side with throttled renewal, porting the pattern (and hazard notes) from `server/modules/graphics-author-session.ts`.
5. `hashPassword`/`verifyPassword` used as-is (Workers-verified above); login/logout/invite/reset routes written by hand.

Rough ownership split: the module supplies perhaps the bottom quarter (cookie transport, guards, composable, hashing); the accounts and session store — the parts with product-specific behaviour — are ours in either world.

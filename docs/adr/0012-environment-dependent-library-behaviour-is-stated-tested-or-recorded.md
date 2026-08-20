# ADR-0012: Environment-dependent library behaviour is stated, tested, or recorded — never inherited silently

- **Status**: Accepted
- **Date**: 2026-08-20
- **Issue**: [#438](https://github.com/KeeprDigital/stream-keepr/issues/438)

## Context

Every test in this repository — unit, Nuxt-environment and integration alike —
runs against libraries that have been told they are in a test environment.
Vitest sets `NODE_ENV ??= 'test'`, `@nuxt/test-utils` hands the server it
spawns its own environment and forces `production` only when `dev` is false
(which this repo's integration setup never is), and `@better-auth/core`
freezes the answer at import: `env-impl.mjs` captures `NODE_ENV` into a
module-level constant, so nothing constructed in-process can ever see another
environment.

Some libraries behave differently when told they are under test. [#410](https://github.com/KeeprDigital/stream-keepr/issues/410)
found one such site the expensive way — Better Auth's origin check is off
under `NODE_ENV=test`, so the whole suite signed in with CSRF defence disabled
and a defect only a built Worker could refuse ([#397](https://github.com/KeeprDigital/stream-keepr/issues/397)) shipped through it.
Issue [#438](https://github.com/KeeprDigital/stream-keepr/issues/438) asked
what _else_ the environment decides that the suite then cannot see, and for a
decision per finding rather than a blanket change.

## The census

Method: grep of the pinned dists for `isTest`, `isDevelopment`, `isProduction`
and `NODE_ENV`. **Where it looked**: `better-auth@1.6.29`,
`@better-auth/core` and `@better-auth/telemetry` (the versions the lockfile
pins). **Where it stopped**: it did not audit the Nitro/h3/Nuxt runtime, the
Drizzle or Ably clients, or anything else `package.json` names — Better Auth
is the library with a demonstrated cost, and the census claims nothing about
the rest. A floor, not a ceiling.

Sites, and the decision each got:

| Site (pinned dist)                                                                                                                                                 | Under `NODE_ENV=test`                                                                                                      | Decision                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create-context.mjs` — origin check defaults off under test                                                                                                        | CSRF defence disabled                                                                                                      | **Stated** — `advanced.disableOriginCheck: false` (#410, already landed)                                                                                                                                                 |
| `create-context.mjs` — `validateSecret` returns early under `isTest()`                                                                                             | Default/short/low-entropy secrets admitted silently; a secretless construction signs with the library's well-known default | **Covered by test** — `test/unit/server/utils/authSecretValidation.test.ts` constructs the library in a child process it hands `NODE_ENV=production` (the only seam that works, since the environment freezes at import) |
| `create-context.mjs` — `rateLimit.enabled ?? isProduction`                                                                                                         | Rate limiter off everywhere but production                                                                                 | **Accepted blindness** — see below                                                                                                                                                                                       |
| `@better-auth/core` `ip.mjs` — client IP: header walk, then loopback under test/dev, `null` in production                                                          | Header arm reads caller-writable `x-forwarded-for`; header-less callers all resolve to `127.0.0.1`                         | **Split.** The header arm is stated — `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`, pinned by `test/unit/server/utils/authClientIp.test.ts`. The loopback residual is **accepted blindness** — see below  |
| `cookies/index.mjs` — secure-cookie prefix falls back to `isProduction` when `useSecureCookies` is unstated, protocol is `'auto'` and there is no string `baseURL` | Session cookies unprefixed locally, `__Secure-`-prefixed in production                                                     | **Accepted blindness** — see below                                                                                                                                                                                       |
| `@better-auth/telemetry` — publishes only when `!isTest()`                                                                                                         | Telemetry suppressed                                                                                                       | **Already stated** — `telemetry.enabled: false` states the intent in every environment                                                                                                                                   |
| `api/routes/error.mjs` — the `/error` page is blanked when `isProduction`                                                                                          | Suite sees the dev error page production never serves                                                                      | **Accepted blindness** — response-shape only, no admission or refusal rides on it                                                                                                                                        |
| Dev-only log lines (`oauth2/link-account.mjs`, `api/routes/sign-up.mjs`, MCP plugin warning, `client/vue/vue-store.mjs`)                                           | Extra or missing log output                                                                                                | **No action** — logs only, and the MCP plugin is not installed here                                                                                                                                                      |

## Decision

Per site, in order of preference:

1. **State the option** when one exists and a single value is right in every
   environment — the #410 pattern. It takes the decision away from
   `NODE_ENV` entirely, which is what makes the suite able to hold the
   behaviour to account.
2. **Construct the library under an environment the test controls** when no
   option exists but the behaviour is reachable — which, given the frozen
   module constant, means a child process.
3. **Record the blindness with its reason** when neither is worth its cost, so
   the next person finds a sentence instead of a surprise.

And one explicit no, carried over from #410: **the suite's `NODE_ENV` is not
globally overridden**, for the spawned server or otherwise. It would change
everything at once in a repository whose suite has never run under another
setting, and the failures would arrive as a wall rather than one at a time.
Stating options is reversible per site; changing the environment is not.

### The accepted blindnesses, with reasons

- **Rate limiting stays production-only by library default.** There is no
  value that preserves behaviour on both sides: `enabled: false` turns the
  production limiter off, and `enabled: true` turns it on locally — where the
  loopback residual below makes every header-less caller share one
  `127.0.0.1` bucket, so the suite would gain flake (100 requests per 10
  seconds per path, shared across everything) rather than coverage. What the
  limiter _keys_ on is now stated and tested (the IP row above), which is the
  half of the #410 probe warning this installation could actually close.
  Observing the limiter itself refusing a request is [#437](https://github.com/KeeprDigital/stream-keepr/issues/437)'s territory — a
  built Worker under production environment — not this suite's.
- **Header-less callers resolve to loopback under test/dev.** That is the
  `isTest() || isDevelopment()` arm inside the library, past every option.
  The cost is that nothing keyed on client IP can be distinguished locally;
  the pin in `authClientIp.test.ts`'s last case keeps the residual on record
  and will fail if a bump changes its shape.
- **The secure-cookie prefix follows `isProduction`.** The fallback produces
  the intended answer on both sides — no prefix for local `http` sign-ins
  (a `__Secure-` cookie cannot be set over `http` at all), the prefix on the
  deployed Worker — and no option expresses "secure exactly when the request
  is `https`": `useSecureCookies` would be wrong on one side whichever value
  it took, and pinning `protocol` was measured and rejected on #410. The
  suite therefore never exercises the prefixed cookie _names_; a built-Worker
  probe does.
- **The production error page is blanked.** Cosmetic surface; nothing about
  who is admitted rides on it, and asserting on an empty 500 body would pin
  noise.

## Consequences

- A Better Auth version bump now has two tripwires the suite lacked:
  `authSecretValidation.test.ts` fails if the library's secret gate moves, and
  `authClientIp.test.ts` fails if IP resolution or its environment fallback
  changes shape. The census itself is re-run — grep, same four names — when
  one of the three audited packages moves majorly; this table is dated and
  version-pinned, not evergreen.
- Sessions now record the Cloudflare-vouched client IP instead of whatever
  `x-forwarded-for` said (measured: a bare spoofed header was recorded
  verbatim under the default), and the production rate limiter's key survives
  a caller who sends their own forwarding header.
- The blindnesses above are _decisions_, not omissions. The next person who
  notices the limiter untested, the loopback collapse, or the unprefixed
  cookie names should land here before building a workaround — and if [#437](https://github.com/KeeprDigital/stream-keepr/issues/437)
  lands its built-Worker gate, the first and third entries are the ones it
  partially repays.

## Related

ADR-0010 (the boundary all of this defends) · [#410](https://github.com/KeeprDigital/stream-keepr/issues/410) (the origin-check site and the pattern) · [#437](https://github.com/KeeprDigital/stream-keepr/issues/437) (the runtime half of the same theme) · `server/utils/authOptions.ts` (every stated option, each with its reason)

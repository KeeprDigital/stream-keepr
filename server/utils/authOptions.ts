import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins';

/**
 * The session policy, stated rather than inherited (#393): sessions live seven
 * days from last refresh, and a request more than a day after the previous
 * refresh slides the expiry forward. These are Better Auth's own defaults —
 * written out so the policy survives a library default changing under a bump.
 */
export const AUTH_SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
export const AUTH_SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * The installation, named as the set of hostnames it answers on (#410).
 *
 * This is the allowlist two separate mechanisms read. Better Auth derives its
 * base URL from the incoming request's `Host` and refuses a host that is not
 * here, and it builds the trusted-origin list — the `Origin` allowlist its CSRF
 * defence compares a state-changing request against — from the same names.
 * Until this ticket neither was configured: with no `baseURL` the trusted list
 * is rebuilt per request from that request's own `Host`, so the check reduced
 * to "`Origin` must equal `Host`" and the installation had no say in which
 * hostnames it admits.
 *
 * The production name is the one `wrangler.jsonc` attaches as a custom domain.
 * It is spelled twice on purpose — a deploy target and an auth allowlist are
 * different facts that happen to agree, and the second is not derivable from
 * the first inside a running Worker.
 *
 * Loopback is listed with and without a port because the port is part of the
 * `Host` header and no local caller has a fixed one: `pnpm preview` defaults to
 * 8787 but moves per worktree, and the integration suite spawns on whatever it
 * is given. Patterns match the whole host, so `localhost:*` does not admit
 * `localhost.example.com`.
 *
 * **A `*.workers.dev` deploy is deliberately not here.** That subdomain is
 * account-shaped rather than ours, and admitting all of it would widen the
 * origin allowlist to hosts nobody in this repo controls. The cost is that
 * signing in against a `workers.dev` URL is refused; `fallback` below makes
 * that a 403 naming the origin rather than a crash, and an operator who wants
 * it adds the exact hostname here.
 */
export const AUTH_ALLOWED_HOSTS = [
	'stream.keepr.digital',
	'localhost',
	'localhost:*',
	'127.0.0.1',
	'127.0.0.1:*',
];

/**
 * The static half of this installation's Better Auth configuration: everything
 * except the database adapter and the secret, which only exist inside a running
 * server. Split out so tests can derive the expected table contract from the
 * same object the server configures itself with (see
 * `test/unit/server/db/authSchema.test.ts`), instead of from a copy that could
 * drift.
 *
 * The plugin surface is deliberately exactly this (ADR decided on #386):
 * email/password with sign-up disabled — accounts are admin-created — plus the
 * admin plugin. No SSO/OIDC/SCIM/OAuth plugins.
 */
export const authStaticOptions = {
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		/**
		 * Redeeming a password reset link ends every session the account holds
		 * (#399).
		 *
		 * On, because otherwise "I have reset my password" does not mean what
		 * everybody assumes it means: an account whose session was stolen gets a
		 * new password while the thief keeps the session, until an administrator
		 * separately remembers to revoke. That second step is the one people
		 * forget, and it is the step that actually evicts anybody.
		 *
		 * The cost this was weighed against — signing an operator out mid-show —
		 * turned out not to exist. A Screen Output holds **no session at all**: it
		 * is authorized by the Screen Output Asset Capability in its URL hash
		 * (ADR-0010), so nothing here can blank program output. What loses access
		 * is an operator control surface, whose user is the person who has this
		 * moment chosen the password they would sign back in with. And whoever
		 * redeems a link is either a new invite with no sessions to lose, or
		 * somebody who could not sign in to begin with.
		 *
		 * **It governs the link path only.** Better Auth reads this in
		 * `/api/auth/reset-password`, so an administrator *setting* a password
		 * directly (`PUT /api/admin/users/:id/password`) still revokes nothing —
		 * that path is for handing somebody back in mid-show, where ending their
		 * sessions is the opposite of the point. The explicit revoke and ban on
		 * the same surface remain the way to end sessions deliberately.
		 */
		revokeSessionsOnPasswordReset: true,
	},
	session: {
		expiresIn: AUTH_SESSION_EXPIRES_IN_SECONDS,
		updateAge: AUTH_SESSION_UPDATE_AGE_SECONDS,
	},
	plugins: [admin()],
	/**
	 * The multi-host form, because this installation genuinely has more than one
	 * hostname and a single string would be wrong at four of them (#410).
	 *
	 * `allowedHosts` keeps the derived-per-request behaviour that a Worker on a
	 * custom domain, a preview port, and a spawned test server all need, and adds
	 * the thing that was missing: a host the installation does not claim is not
	 * one it will mint a session for.
	 *
	 * `fallback` is what an unlisted host resolves to instead of throwing. It is
	 * set for the failure *shape*, not the behaviour: without it Better Auth
	 * raises out of base-URL resolution and the request ends as a 500 with a
	 * library message, and with it the request reaches the origin check and is
	 * refused as `INVALID_ORIGIN` — the same answer, said by the mechanism whose
	 * decision it actually is.
	 *
	 * `protocol: 'auto'` — the scheme comes from the request rather than from
	 * this file, which is what makes both `https://` and `http://` trusted for
	 * every listed host. That reads like a concession and is one: it exists
	 * because `wrangler dev` rewrites an `Origin` matching its own bind address
	 * to the route `wrangler.jsonc` configures, so the built Worker under `pnpm
	 * preview` sees its own callers as `http://stream.keepr.digital` — the
	 * production hostname over plain http, an address that exists nowhere else.
	 * Measured against a preview: with the scheme pinned, a sign-in from
	 * `http://127.0.0.1:8787` is refused `INVALID_ORIGIN` after the rewrite,
	 * which would have taken every local acceptance harness with it.
	 *
	 * What it costs is that `http://stream.keepr.digital` is a trusted origin.
	 * A deployment answers only over https and Cloudflare redirects the rest, so
	 * nothing can legitimately be at that address — and a browser will not send
	 * a deployment's `Secure`, `__Secure-`-prefixed session cookie to it anyway.
	 * The scheme no longer decides cookies: `advanced.useSecureCookies` below is
	 * stated, because with `'auto'` the library inferred it from `NODE_ENV` and
	 * got production wrong (#451).
	 */
	baseURL: {
		allowedHosts: AUTH_ALLOWED_HOSTS,
		fallback: 'https://stream.keepr.digital',
		protocol: 'auto',
	},
	advanced: {
		/**
		 * Stated because the default is environment-dependent, and the environment
		 * the tests run in is the one where it turns the check off.
		 *
		 * Better Auth's default is `isTest() ? true : false`, and `isTest()` reads
		 * `NODE_ENV === 'test'`. Vitest sets `NODE_ENV ??= 'test'`, and
		 * `@nuxt/test-utils` hands the spawned server its own environment while
		 * only forcing `production` when `dev` is false — which this repo's
		 * integration setup never is. So every integration run signed in against a
		 * server with the origin check **entirely disabled**, and could not have
		 * seen a cross-origin sign-in either.
		 *
		 * That, and not the missing `baseURL`, is why #396's harness shipped a
		 * defect that only a built Worker refused (#397, cb7d59df): a hand-run
		 * `pnpm dev` refuses it too. Measured across all three values of
		 * `NODE_ENV` — `test` admitted a sign-in that `development` and
		 * `production` both answered `403 MISSING_OR_NULL_ORIGIN`.
		 *
		 * Setting it explicitly — either value — takes the decision away from
		 * `NODE_ENV`, which is what makes the suite able to hold this behaviour to
		 * account at all.
		 */
		disableOriginCheck: false,
		/**
		 * Which header names the client, stated for the same reason as
		 * `disableOriginCheck` above: the default answer is decided by things this
		 * file does not control (#438).
		 *
		 * Better Auth's default walks `x-forwarded-for` and, failing that, answers
		 * loopback under `NODE_ENV=test`/`development` and `null` in production.
		 * On this installation both arms of that default are wrong. The header arm
		 * reads a name the caller can write: a bare spoofed `x-forwarded-for` is
		 * recorded as the session's client IP verbatim (measured —
		 * `test/unit/server/utils/authClientIp.test.ts` failed exactly there
		 * against the default), and when Cloudflare's own append makes the header
		 * multi-valued, the library — configured with no `trustedProxies` — refuses
		 * to read it at all, which in production is a `null` client IP and a rate
		 * limiter with no key. That header-shaped collapse is the warning a built
		 * Worker probe surfaced during #410.
		 *
		 * `cf-connecting-ip` is written by Cloudflare itself on every request that
		 * reaches the Worker, after anything the caller sent under that name is
		 * discarded — the one address on this platform the caller cannot choose.
		 *
		 * What stating it does **not** reach: a request carrying no listed header
		 * still resolves by environment — loopback under test/dev, so every
		 * header-less local caller is `127.0.0.1` and anything keyed on client IP
		 * shares one bucket in the suite. That residual has no option to state and
		 * is accepted, with the reasoning, in ADR-0012.
		 */
		ipAddress: {
			ipAddressHeaders: ['cf-connecting-ip'],
		},
		/**
		 * `Secure`, `__Secure-`-prefixed cookies on every server but `nuxt dev`
		 * (#451), stated because the inferred answer was wrong in production.
		 *
		 * Unstated, Better Auth takes this from `baseURL`: `'https'` or `'http'`
		 * decide it, and `'auto'` (above) falls through to `isProduction`, which is
		 * `NODE_ENV === 'production'` read once when the library's module loads.
		 * Nothing sets `NODE_ENV` in the Worker, so the built Worker — the artifact
		 * a deploy uploads — set an unprefixed session cookie without `Secure`
		 * (measured under local workerd on #621). ADR-0012 had accepted that
		 * fallback on the premise that production got `__Secure-` cookies.
		 *
		 * `import.meta.dev` is the build's own answer to "is this the dev server",
		 * replaced by a literal when Nitro bundles the server, so the deployed
		 * Worker carries `true` in its code rather than in anything read at
		 * runtime. `pnpm worker:smoke` asserts it on that artifact. It is `!== true`
		 * rather than negated so that anything which is not a Nitro dev build —
		 * the unit suite, which defines no `import.meta.dev` — gets production's
		 * cookie.
		 *
		 * The dev server keeps unprefixed, non-`Secure` cookies because it is the
		 * one server a browser reaches over plain http by a name that is not
		 * loopback (`pnpm dev:local`), and the integration and local-auth suites it
		 * serves read whatever name they are given. A built Worker under `pnpm
		 * preview` is production's artifact and gets production's cookie; browsers
		 * treat loopback as a secure origin, so it still signs in there.
		 *
		 * Rejected: `NODE_ENV=production` in the Worker build changes every
		 * `isProduction` site in ADR-0012's census at once (the rate limiter among
		 * them) to fix one; a Worker var is a deploy setting a forgotten value
		 * silently undoes; deriving it from each request's scheme has no option
		 * (ADR-0012), and would leave the smoke run, which reaches the artifact
		 * over http, unable to see production's cookie.
		 */
		useSecureCookies: import.meta.dev !== true,
	},
	// Off by default at this version; stated so a bump flipping the default
	// cannot quietly start publishing from a deployed Worker.
	telemetry: {
		enabled: false,
	},
} satisfies BetterAuthOptions;

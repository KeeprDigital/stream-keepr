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
	 * nothing can legitimately be at that address — and a browser will not carry
	 * a `__Secure-`-prefixed session cookie across schemes to reach it anyway.
	 * `'https'` was the other option and is worse: it puts that same prefix on
	 * cookies a local http sign-in cannot then keep.
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
	},
	// Off by default at this version; stated so a bump flipping the default
	// cannot quietly start publishing from a deployed Worker.
	telemetry: {
		enabled: false,
	},
} satisfies BetterAuthOptions;

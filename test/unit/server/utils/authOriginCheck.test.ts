import type { ThrowawayAuth } from '~~/test/helpers/throwawayAuth';
import { beforeEach, describe, expect, it } from 'vitest';
import { LOCAL_HOST, LOCAL_ORIGIN, throwawayAuth } from '~~/test/helpers/throwawayAuth';

/**
 * Better Auth's CSRF defence, against a real instance configured exactly as the
 * server configures its own (#410).
 *
 * **This suite exists because nothing else in the repository can see this
 * behaviour.** Better Auth turns the origin check off when `NODE_ENV === 'test'`,
 * vitest sets `NODE_ENV` to `test`, and `@nuxt/test-utils` passes its environment
 * to the dev server it spawns — so every HTTP test in this repository, integration
 * suite included, ran against a server with the check disabled. A sign-in carrying
 * no `Origin` was refused by a built Worker and admitted by the suite, which is how
 * #396's harness shipped a defect no test could reach (#397, cb7d59df).
 *
 * `authStaticOptions` now states `advanced.disableOriginCheck` rather than
 * inheriting it, which is what makes these assertions possible under vitest at
 * all. **All three refusals below answered 200 against the configuration this
 * ticket replaced** — measured, by running this file against it. That is the point
 * of writing them here rather than in the integration suite, where the requests go
 * through a server whose check is off and prove nothing either way.
 *
 * The cases are the ones a browser distinguishes: a request with a cookie and no
 * `Origin` is not a browser; a request from another site's `Origin` is a browser
 * being used against its user; and a request naming a host this installation does
 * not answer on is neither.
 */

const EMAIL = 'origin-check@keepr.digital';
const PASSWORD = 'a-long-enough-password';

let auth: ThrowawayAuth;

/** One sign-in attempt, with whatever headers the case is about. */
async function signIn(headers: Record<string, string>) {
	const response = await auth.handler(new Request(`${LOCAL_ORIGIN}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'host': LOCAL_HOST, ...headers },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	}));
	const text = await response.text();

	return {
		status: response.status,
		code: text ? (JSON.parse(text) as { code?: string }).code : undefined,
	};
}

beforeEach(async () => {
	auth = throwawayAuth();
	// Sign-up is disabled by design, so the account arrives the way every account
	// in this installation does: created server-side. Same path the first-admin
	// bootstrap takes.
	await auth.api.createUser({ body: { email: EMAIL, password: PASSWORD, name: 'Origin Check' } });
});

describe('the origin check, under the environment the tests themselves run in', () => {
	it('admits a sign-in from a hostname this installation answers on', async () => {
		expect(await signIn({ origin: LOCAL_ORIGIN })).toMatchObject({ status: 200 });
	});

	it('refuses a session-carrying request that says nothing about where it came from', async () => {
		// The shape that cost #397 a day: a browser always sends `Origin` on a
		// cross-document POST, so a request holding a session and sending none is
		// not one, and must not be handed another session on trust.
		expect(await signIn({ cookie: 'better-auth.session_token=stale', origin: '' }))
			.toMatchObject({ status: 403, code: 'MISSING_OR_NULL_ORIGIN' });
	});

	it('admits the production hostname over plain http, which is what a local preview looks like', async () => {
		// Not a stray permission: `wrangler dev` rewrites an `Origin` matching its
		// own bind address to the route `wrangler.jsonc` configures, so a sign-in
		// against `pnpm preview` reaches the Worker claiming to come from the
		// production hostname over http. Pinning the scheme instead refuses every
		// local acceptance harness — measured against a preview before this line
		// existed. A deployment answers only over https, so nothing legitimate is
		// at this address; if that ever stops being true, this is the test to
		// argue with.
		const response = await auth.handler(new Request('http://stream.keepr.digital/api/auth/sign-in/email', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'host': 'stream.keepr.digital',
				'origin': 'http://stream.keepr.digital',
			},
			body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
		}));

		expect(response.status).toBe(200);
	});

	it('refuses a sign-in offered by another site', async () => {
		expect(await signIn({ origin: 'https://not-this-installation.example' }))
			.toMatchObject({ status: 403, code: 'INVALID_ORIGIN' });
	});

	it('refuses a host the installation does not claim, rather than trusting the request about it', async () => {
		// The half a per-request base URL got wrong: with the origin derived from
		// the request, any `Host` produced a matching trusted origin, so a deploy
		// answering on a hostname nobody configured signed people in as readily as
		// the custom domain. `AUTH_ALLOWED_HOSTS` is now the installation's own
		// answer to which hostnames those are.
		const response = await auth.handler(new Request('https://stream-keepr.example.workers.dev/api/auth/sign-in/email', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'host': 'stream-keepr.example.workers.dev',
				'origin': 'https://stream-keepr.example.workers.dev',
			},
			body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
		}));

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
	});
});

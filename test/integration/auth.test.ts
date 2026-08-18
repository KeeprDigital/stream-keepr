import { hashPassword } from 'better-auth/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetch, url } from './client';
import { executeIntegrationD1 } from './integrationD1';

/**
 * The auth foundation's acceptance seams (#393): a server-side-created user —
 * the only kind this installation has, sign-up being disabled — can sign in
 * and out against the mounted Better Auth handler, with the session living in
 * D1.
 *
 * The fixture user is seeded by direct SQL because that is what
 * "server-side-created" means here until the first-admin bootstrap ticket
 * lands: no public route creates accounts. The password hash comes from
 * `better-auth/crypto` in this test process, which is the same scrypt format
 * the handler verifies against.
 */

const FIXTURE_USER_ID = 'auth-integration-user';
const FIXTURE_EMAIL = 'auth-integration@keepr.digital';
const FIXTURE_PASSWORD = 'integration-password-393';

/** All cookies from a response, folded into one request Cookie header. */
function cookieHeaderFrom(response: Awaited<ReturnType<typeof fetch>>): string {
	return response.headers
		.getSetCookie()
		.map(cookie => cookie.split(';')[0])
		.join('; ');
}

/**
 * A POST that says where it came from, because a browser does.
 *
 * `origin` defaults to this spawned server's own address and is overridable so
 * the refusals below can send something else. Better Auth compares it against
 * the trusted origins it builds from `AUTH_ALLOWED_HOSTS`, which is why the
 * spawned server's random port has to be admitted by a loopback pattern rather
 * than by a fixed name (#410).
 */
async function postJson(path: string, body: unknown, cookie?: string, origin: string | null = url('/')) {
	return fetch(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(cookie ? { Cookie: cookie } : {}),
			...(origin === null ? {} : { Origin: origin }),
		},
		body: JSON.stringify(body),
	});
}

async function getSession(cookie: string) {
	const response = await fetch('/api/auth/get-session', { headers: { Cookie: cookie } });
	expect(response.status).toBe(200);
	// A sessionless answer is the JSON literal `null`; an empty body means the
	// same thing and must not read as a parse failure.
	const text = await response.text();
	return text ? JSON.parse(text) : null;
}

describe('auth foundation', () => {
	beforeAll(async () => {
		const passwordHash = await hashPassword(FIXTURE_PASSWORD);
		const now = Date.now();
		await executeIntegrationD1(`
			DELETE FROM user WHERE id = '${FIXTURE_USER_ID}';
			INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
			VALUES ('${FIXTURE_USER_ID}', 'Auth Integration User', '${FIXTURE_EMAIL}', 1, ${now}, ${now});
			INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
			VALUES ('${FIXTURE_USER_ID}-account', '${FIXTURE_USER_ID}', 'credential', '${FIXTURE_USER_ID}', '${passwordHash}', ${now}, ${now});
		`);
	});

	it('signs a server-side-created user in, holds the session in D1, and signs out', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(signIn.status).toBe(200);
		const signInBody = await signIn.json() as { user: { id: string; email: string } };
		expect(signInBody.user).toMatchObject({ id: FIXTURE_USER_ID, email: FIXTURE_EMAIL });

		const cookie = cookieHeaderFrom(signIn);
		expect(cookie).toContain('better-auth.session_token=');

		const session = await getSession(cookie);
		expect(session.user).toMatchObject({ id: FIXTURE_USER_ID });
		expect(session.session.userId).toBe(FIXTURE_USER_ID);

		const signOut = await postJson('/api/auth/sign-out', {}, cookie);
		expect(signOut.status).toBe(200);

		// The session was revoked server-side, not merely cleared from the
		// browser: the old token answers nothing even when presented again.
		const afterSignOut = await getSession(cookie);
		expect(afterSignOut).toBeNull();
	});

	it('rejects a wrong password', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: 'not-the-password',
		});
		expect(signIn.status).toBe(401);
	});

	/**
	 * #410's half, and the reason every request in this file now carries an
	 * `Origin`: the CSRF defence is live against the mounted handler.
	 *
	 * It was not, until `authStaticOptions` stated `advanced.disableOriginCheck`.
	 * Better Auth turns the check off under `NODE_ENV === 'test'`, and the server
	 * this suite spawns inherits vitest's — so these two requests both answered
	 * 200 here while a built Worker refused them. The behaviour itself is pinned
	 * where it can be reasoned about without a spawned server, in
	 * `test/unit/server/utils/authOriginCheck.test.ts`; what these two add is that
	 * the mounted route really is the configured instance.
	 */
	it('refuses a session-carrying request that sends no Origin', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(signIn.status).toBe(200);

		const signOut = await postJson('/api/auth/sign-out', {}, cookieHeaderFrom(signIn), null);

		expect(signOut.status).toBe(403);
	});

	it('refuses a sign-in offered by another site', async () => {
		const signIn = await postJson(
			'/api/auth/sign-in/email',
			{ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD },
			undefined,
			'https://not-this-installation.example',
		);

		expect(signIn.status).toBe(403);
	});

	it('refuses public sign-up, which is disabled by design', async () => {
		const signUp = await postJson('/api/auth/sign-up/email', {
			name: 'Uninvited',
			email: 'uninvited@keepr.digital',
			password: 'uninvited-password-393',
		});
		expect(signUp.status).toBeGreaterThanOrEqual(400);

		const signIn = await postJson('/api/auth/sign-in/email', {
			email: 'uninvited@keepr.digital',
			password: 'uninvited-password-393',
		});
		expect(signIn.status).toBe(401);
	});
});

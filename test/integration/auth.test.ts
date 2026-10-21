import { hashPassword } from 'better-auth/crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH_SESSION_EXPIRES_IN_SECONDS, AUTH_SESSION_UPDATE_AGE_SECONDS } from '../../server/utils/authOptions';
import { fetch, url } from './client';
import { executeIntegrationD1, queryIntegrationD1 } from './integrationD1';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_IN_DAYS = AUTH_SESSION_EXPIRES_IN_SECONDS * 1000 / DAY_MS;
const UPDATE_AGE_DAYS = AUTH_SESSION_UPDATE_AGE_SECONDS * 1000 / DAY_MS;

/** The session cookie, under either name a server can give it (see `client.ts`). */
const SESSION_TOKEN_COOKIE = /^(?:__Secure-)?better-auth\.session_token=/;

/** The raw Session token a signed `session_token` cookie carries, as D1 keys it. */
function sessionTokenFrom(cookie: string): string {
	const signed = /(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie)?.[1];
	expect(signed).toBeDefined();
	return decodeURIComponent(signed!).split('.')[0]!;
}

/**
 * The controlled clock: moves one Session `days` into its own past, which to
 * every expiry and refresh comparison Better Auth makes is the same as the
 * server's clock moving forward — without a suite sleeping for a week.
 */
async function ageSession(token: string, days: number) {
	const shift = days * DAY_MS;
	await executeIntegrationD1(`
		UPDATE session
		SET created_at = created_at - ${shift}, updated_at = updated_at - ${shift}, expires_at = expires_at - ${shift}
		WHERE token = '${token}';
	`);
}

async function sessionExpiry(token: string): Promise<number | undefined> {
	const [row] = await queryIntegrationD1<{ expires_at: number }>('SELECT expires_at FROM session WHERE token = ?', [token]);
	return row?.expires_at;
}

/** An ordinary private API read, presented with exactly this cookie. */
async function ordinaryApiRequest(cookie: string) {
	return fetch('/api/events', { headers: { Cookie: cookie } });
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

	/**
	 * The dev server keeps the cookie it always set, so signing in over
	 * `http://localhost` works in a browser that would drop a `Secure` one there.
	 * Every built server sets the `__Secure-`, `Secure` one instead
	 * (`useSecureCookies` in `server/utils/authOptions.ts`, #451).
	 */
	it('sets the dev server\'s session cookie unprefixed and not Secure', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(signIn.status).toBe(200);

		const session = signIn.headers.getSetCookie().find(set => SESSION_TOKEN_COOKIE.test(set));
		expect(session).toMatch(/^better-auth\.session_token=/);
		expect(session!.split(';').map(part => part.trim().toLowerCase())).not.toContain('secure');
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

	/**
	 * #613: an ordinary authenticated request after the update window renews the
	 * Session in D1 **and** in the browser. It used to do only the first: the API
	 * boundary read the Session through `getSession` without `returnHeaders`, so
	 * the row slid forward and the renewed cookie went nowhere, and a tab left open
	 * for a week lost a cookie the server was still honouring.
	 */
	it('renews an aged Session\'s cookie on an ordinary API request and keeps admitting it past the original expiry', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(signIn.status).toBe(200);
		const cookie = cookieHeaderFrom(signIn);
		const token = sessionTokenFrom(cookie);

		// Half a day short of the seven-day window: past the one-day update age,
		// and half a day from the expiry the Session was issued with.
		await ageSession(token, EXPIRES_IN_DAYS - 0.5);
		const originalExpiry = (await sessionExpiry(token))!;

		const renewing = await ordinaryApiRequest(cookie);
		expect(renewing.status).toBe(200);
		const renewal = renewing.headers.getSetCookie().filter(set => SESSION_TOKEN_COOKIE.test(set));
		expect(renewal).toHaveLength(1);
		expect(renewal[0]).toMatch(new RegExp(`Max-Age=${AUTH_SESSION_EXPIRES_IN_SECONDS}(;|$)`, 'i'));
		expect(sessionTokenFrom(renewal[0]!)).toBe(token);
		const renewedExpiry = (await sessionExpiry(token))!;
		expect(renewedExpiry).toBeGreaterThan(originalExpiry + (EXPIRES_IN_DAYS - 1) * DAY_MS);

		// Three quarters of the update age more: the Session as first issued has
		// now expired, and the renewal is still too young to be renewed again.
		const later = UPDATE_AGE_DAYS * 0.75;
		await ageSession(token, later);
		expect(originalExpiry - later * DAY_MS).toBeLessThan(Date.now());

		const renewedCookie = cookieHeaderFrom(renewing);
		const afterOriginalExpiry = await ordinaryApiRequest(renewedCookie);
		expect(afterOriginalExpiry.status).toBe(200);
		// Admitted on the renewal already forwarded, not on a second one.
		expect(afterOriginalExpiry.headers.getSetCookie()).toEqual([]);
	});

	/**
	 * What forwarding the renewal must not loosen: the sliding window still closes
	 * seven idle days after the last renewal, and sign-out still revokes a Session
	 * whatever its cookie says (ADR-0010's policy).
	 */
	it('still refuses a Session seven idle days after its last renewal, and one that was revoked', async () => {
		const signIn = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(signIn.status).toBe(200);
		const cookie = cookieHeaderFrom(signIn);
		const token = sessionTokenFrom(cookie);

		await ageSession(token, EXPIRES_IN_DAYS - 1);
		const renewing = await ordinaryApiRequest(cookie);
		expect(renewing.status).toBe(200);
		const renewedCookie = cookieHeaderFrom(renewing);

		await ageSession(token, EXPIRES_IN_DAYS);
		const idle = await ordinaryApiRequest(renewedCookie);
		expect(idle.status).toBe(401);
		expect(await sessionExpiry(token)).toBeUndefined();
		// The dead cookie is expired on the refusal too, now that a read's cookies
		// reach the response whatever the boundary then answers.
		expect(idle.headers.getSetCookie().filter(set => SESSION_TOKEN_COOKIE.test(set)))
			.toEqual([expect.stringMatching(/Max-Age=0(;|$)/i)]);

		const another = await postJson('/api/auth/sign-in/email', {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
		});
		expect(another.status).toBe(200);
		const anotherCookie = cookieHeaderFrom(another);
		await ageSession(sessionTokenFrom(anotherCookie), EXPIRES_IN_DAYS - 1);
		expect((await postJson('/api/auth/sign-out', {}, anotherCookie)).status).toBe(200);

		expect((await ordinaryApiRequest(anotherCookie)).status).toBe(401);
	});
});

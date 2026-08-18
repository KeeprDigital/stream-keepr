import type {
	AdministeredUserList,
	CreatedUserAccount,
	IssuedPasswordResetLink,
	RevokedUserSessions,
} from '~~/shared/types/userAdministration';
import { beforeAll, describe, expect, it } from 'vitest';
import { fetch, url } from './client';
import { INTEGRATION_ADMIN_BOOTSTRAP_TOKEN, INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';
import { executeIntegrationD1 } from './integrationD1';

/**
 * The user administration surface as an administrator meets it (#399): a
 * Graphics Administrator token, an account created, a link handed over, and a
 * colleague who can then sign in — or who can no longer.
 *
 * What this file owns over the unit suite is the wiring and the whole round
 * trip. The unit suite proves the decisions and the library contract against a
 * throwaway Better Auth; only this proves that the seven routes are mounted
 * where the page calls them, that `x-graphics-admin-token` reaches them, that a
 * link minted by one route is redeemable at Better Auth's own `/reset-password`
 * on the other side of a real HTTP boundary, and that what all of it writes
 * lands in the D1 the sign-in path then reads.
 *
 * Everything is asserted through sign-in rather than by reading rows, for the
 * reason the bootstrap suite gives: the question these routes exist to answer is
 * "can this person get in now", and a row that looks right while sign-in refuses
 * it would be a passing test over a locked-out colleague.
 */

const INVITED_EMAIL = 'user-admin-399-invited@keepr.digital';
const SECOND_EMAIL = 'user-admin-399-second@keepr.digital';
const FIRST_PASSWORD = 'user-admin-399-first-password';
const SECOND_PASSWORD = 'user-admin-399-second-password';
const THIRD_PASSWORD = 'user-admin-399-third-password';

const ADMIN_HEADERS = { 'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN };

function administer(path: string, options: {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
} = {}) {
	return fetch(`/api/admin/users${path}`, {
		method: options.method ?? 'GET',
		headers: {
			'content-type': 'application/json',
			...(options.headers ?? ADMIN_HEADERS),
		},
		...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
	});
}

/**
 * Better Auth's own endpoints, asked the way a browser asks.
 *
 * The `Origin` header is not decoration: Better Auth refuses a state-changing
 * request without one (`403 MISSING_OR_NULL_ORIGIN`), which `nuxt dev` tolerates
 * and a built Worker does not — the trap `client.ts` records having fallen into
 * once already.
 */
function authFetch(path: string, body: unknown) {
	return fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'origin': url('/') },
		body: JSON.stringify(body),
	});
}

function signIn(email: string, password: string) {
	return authFetch('/api/auth/sign-in/email', { email, password });
}

function redeem(link: string, newPassword: string) {
	// The token rides in the fragment, which is the point of the encoding: it
	// never reached the server on the navigation, and the page presents it
	// itself. This is that page.
	const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
	expect(token, 'the link carried no token in its fragment').toBeTruthy();

	return authFetch('/api/auth/reset-password', { token, newPassword });
}

function cookieFrom(response: Response) {
	return response.headers.getSetCookie()
		.map(value => value.split(';', 1)[0] ?? '')
		.filter(pair => pair.includes('='))
		.join('; ');
}

/** Whether a session cookie still resolves to a session, which is what revocation ends. */
async function sessionStillLive(cookie: string) {
	const response = await fetch('/api/auth/get-session', { headers: { cookie } });
	if (!response.ok)
		return false;

	// A revoked session answers 200 with an empty body rather than a refusal,
	// which is exactly the shape a naive `response.ok` would read as "still
	// signed in".
	return (await response.text()).includes('"user"');
}

async function listAccounts() {
	const response = await administer('');
	expect(response.status).toBe(200);
	return await response.json() as AdministeredUserList;
}

async function findAccount(email: string) {
	return (await listAccounts()).users.find(user => user.email === email);
}

describe('user administration', () => {
	let invitedUserId = '';

	beforeAll(async () => {
		// These are the only accounts this suite creates, and it starts from an
		// installation that has never had them — including on a rerun against a
		// persisted local D1.
		await executeIntegrationD1(`
			DELETE FROM session WHERE user_id IN (SELECT id FROM user WHERE email IN ('${INVITED_EMAIL}', '${SECOND_EMAIL}'));
			DELETE FROM account WHERE user_id IN (SELECT id FROM user WHERE email IN ('${INVITED_EMAIL}', '${SECOND_EMAIL}'));
			DELETE FROM user WHERE email IN ('${INVITED_EMAIL}', '${SECOND_EMAIL}');
		`);
	});

	describe('who is admitted', () => {
		it('refuses a caller with no Graphics Administrator token', async () => {
			// The request carries the suite's operator session, which is the point:
			// `/api/admin/**` is exempt from the session boundary, so a session is
			// not what admits a caller here and must not be mistaken for it.
			expect((await administer('', { headers: {} })).status).toBe(403);
		});

		it('refuses a caller with the wrong token', async () => {
			expect((await administer('', { headers: { 'x-graphics-admin-token': 'not-the-token' } })).status)
				.toBe(403);
		});

		it('does not admit the first-admin bootstrap token in its place', async () => {
			const response = await administer('', {
				headers: { 'x-admin-bootstrap-token': INTEGRATION_ADMIN_BOOTSTRAP_TOKEN },
			});

			expect(response.status).toBe(403);
		});

		it('refuses every write on the surface, not only the listing', async () => {
			for (const [path, method] of [
				['', 'POST'],
				['/any-user/password-reset-link', 'POST'],
				['/any-user/password', 'PUT'],
				['/any-user/ban', 'POST'],
				['/any-user/ban', 'DELETE'],
				['/any-user/sessions', 'DELETE'],
			] as const) {
				const response = await administer(path, { method, body: {}, headers: {} });
				expect(response.status, `${method} ${path} was not refused`).toBe(403);
			}
		});
	});

	describe('inviting somebody', () => {
		it('creates an account with no password and hands back a link that sets one', async () => {
			const response = await administer('', {
				method: 'POST',
				body: { email: INVITED_EMAIL, name: 'An Invited Operator' },
			});

			expect(response.status).toBe(200);
			const created = await response.json() as CreatedUserAccount;
			expect(created.user).toMatchObject({ email: INVITED_EMAIL, name: 'An Invited Operator', banned: false });
			invitedUserId = created.user.id;

			// The link points at this installation, on the origin the request
			// arrived at — an administrator on a preview deployment must not be
			// handed a link to production.
			expect(created.passwordResetLink.url).toContain(`${url('/reset-password')}#token=`);
			expect(Date.parse(created.passwordResetLink.expiresAt)).toBeGreaterThan(Date.now());

			// Nothing to sign in with yet, which is the whole property the invite
			// shape buys: no administrator is left holding a password that works.
			expect((await signIn(INVITED_EMAIL, FIRST_PASSWORD)).status).toBe(401);

			expect((await redeem(created.passwordResetLink.url, FIRST_PASSWORD)).status).toBe(200);
			expect((await signIn(INVITED_EMAIL, FIRST_PASSWORD)).status).toBe(200);

			// Single-use: the row is consumed on redemption, so the copy still
			// sitting in a chat window is dead.
			expect((await redeem(created.passwordResetLink.url, 'a-third-password')).status)
				.not
				.toBe(200);
		});

		it('refuses a second account for the same email', async () => {
			const response = await administer('', {
				method: 'POST',
				body: { email: INVITED_EMAIL.toUpperCase(), name: 'A Duplicate' },
			});

			// 409 rather than the unique index's 500: what the administrator needs
			// to hear is that this person already has an account.
			expect(response.status).toBe(409);
		});

		it('refuses a body with a key it does not know', async () => {
			// `role` is the one worth naming — a surface that silently accepted it
			// would be a roles model nobody designed.
			const response = await administer('', {
				method: 'POST',
				body: { email: SECOND_EMAIL, name: 'A Second Operator', role: 'admin' },
			});

			expect(response.status).toBe(400);
			expect(await findAccount(SECOND_EMAIL)).toBeUndefined();
		});

		it('lists the account it created', async () => {
			const listing = await listAccounts();

			expect(listing.cap).toBeGreaterThan(0);
			expect(listing.total).toBeGreaterThanOrEqual(listing.users.length);
			expect(listing.users.map(user => user.email)).toContain(INVITED_EMAIL);
			// A listing is read by a browser; a password hash on it would be the
			// whole installation.
			expect(JSON.stringify(listing)).not.toContain('password');
		});
	});

	describe('resetting a password', () => {
		it('issues a fresh link for an account that already exists', async () => {
			const response = await administer(`/${invitedUserId}/password-reset-link`, { method: 'POST' });

			expect(response.status).toBe(200);
			const issued = await response.json() as IssuedPasswordResetLink;
			expect(issued.user.id).toBe(invitedUserId);

			expect((await redeem(issued.passwordResetLink.url, SECOND_PASSWORD)).status).toBe(200);
			expect((await signIn(INVITED_EMAIL, SECOND_PASSWORD)).status).toBe(200);
			// The old credential is gone rather than merely superseded.
			expect((await signIn(INVITED_EMAIL, FIRST_PASSWORD)).status).toBe(401);
		});

		it('sets one outright for the administrator standing next to somebody', async () => {
			const response = await administer(`/${invitedUserId}/password`, {
				method: 'PUT',
				body: { password: THIRD_PASSWORD },
			});

			expect(response.status).toBe(200);
			expect((await signIn(INVITED_EMAIL, THIRD_PASSWORD)).status).toBe(200);
			expect((await signIn(INVITED_EMAIL, SECOND_PASSWORD)).status).toBe(401);
		});

		it('refuses a password shorter than Better Auth accepts', async () => {
			const response = await administer(`/${invitedUserId}/password`, {
				method: 'PUT',
				body: { password: 'short' },
			});

			expect(response.status).toBe(400);
			// And the previous one still works, so a refused set changed nothing.
			expect((await signIn(INVITED_EMAIL, THIRD_PASSWORD)).status).toBe(200);
		});

		it('answers 404 for an account that does not exist', async () => {
			expect((await administer('/no-such-user/password-reset-link', { method: 'POST' })).status)
				.toBe(404);
			expect((await administer('/no-such-user/password', { method: 'PUT', body: { password: THIRD_PASSWORD } })).status)
				.toBe(404);
		});
	});

	describe('revoking and banning', () => {
		it('ends a live session without touching the password', async () => {
			const cookie = cookieFrom(await signIn(INVITED_EMAIL, THIRD_PASSWORD));
			expect(await sessionStillLive(cookie)).toBe(true);

			const response = await administer(`/${invitedUserId}/sessions`, { method: 'DELETE' });

			expect(response.status).toBe(200);
			expect(await response.json() as RevokedUserSessions)
				.toMatchObject({ revokedSessionCount: expect.any(Number) });
			expect(await sessionStillLive(cookie)).toBe(false);
			// The laptop left open in the production office: they sign straight back
			// in on their own machine.
			expect((await signIn(INVITED_EMAIL, THIRD_PASSWORD)).status).toBe(200);
		});

		it('ends every session a ban would otherwise leave running', async () => {
			const cookie = cookieFrom(await signIn(INVITED_EMAIL, THIRD_PASSWORD));

			const response = await administer(`/${invitedUserId}/ban`, {
				method: 'POST',
				body: { reason: 'Left the production office' },
			});

			expect(response.status).toBe(200);
			// Better Auth enforces a ban when a session is *created*, so without the
			// revocation the banned operator keeps working for up to seven days.
			expect(await sessionStillLive(cookie)).toBe(false);
			expect((await signIn(INVITED_EMAIL, THIRD_PASSWORD)).status).toBe(403);
			expect(await findAccount(INVITED_EMAIL))
				.toMatchObject({ banned: true, banReason: 'Left the production office' });
		});

		it('lets a lifted ban sign in again with the same password', async () => {
			const response = await administer(`/${invitedUserId}/ban`, { method: 'DELETE' });

			expect(response.status).toBe(200);
			expect((await signIn(INVITED_EMAIL, THIRD_PASSWORD)).status).toBe(200);
			expect(await findAccount(INVITED_EMAIL)).toMatchObject({ banned: false, banReason: null });
		});

		it('answers 404 for an account that does not exist', async () => {
			expect((await administer('/no-such-user/sessions', { method: 'DELETE' })).status).toBe(404);
			expect((await administer('/no-such-user/ban', { method: 'POST', body: {} })).status).toBe(404);
			expect((await administer('/no-such-user/ban', { method: 'DELETE' })).status).toBe(404);
		});
	});
});

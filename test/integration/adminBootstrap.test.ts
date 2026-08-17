import { fetch } from '@nuxt/test-utils/e2e';
import { beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ADMIN_BOOTSTRAP_TOKEN, INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';
import { executeIntegrationD1 } from './integrationD1';

/**
 * The first-admin bootstrap route as an operator meets it (#394): a curl
 * carrying the armed secret, and an account that can then sign in.
 *
 * What this file owns over the unit suite is the wiring — that
 * `NUXT_ADMIN_BOOTSTRAP_TOKEN` reaches `runtimeConfig.adminBootstrapToken`, that
 * the route is mounted where the README's curl points, and that what it writes
 * lands in the real D1 the sign-in path then reads. The ensure semantics
 * themselves are unit-tested against a Better Auth instance, and the disarmed
 * 503 with them, since a spawned server holds one environment for a whole run.
 *
 * Everything is asserted through HTTP rather than by reading rows: the question
 * this route exists to answer is "can somebody sign in now", and a row that
 * looks right while sign-in refuses it would be a passing test over a locked-out
 * installation.
 */

const ROUTE = '/api/bootstrap/ensure-admin';
const EMAIL = 'bootstrap-integration@keepr.digital';
const PASSWORD = 'bootstrap-integration-394';
const RECOVERY_PASSWORD = 'bootstrap-recovery-394';

interface EnsureAdminResponse {
	outcome: 'created' | 'updated';
	userId: string;
	email: string;
	grantedAdminRole: boolean;
}

async function ensureAdmin(body: unknown, headers: Record<string, string> = {
	'x-admin-bootstrap-token': INTEGRATION_ADMIN_BOOTSTRAP_TOKEN,
}) {
	return fetch(ROUTE, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
}

async function signIn(email: string, password: string) {
	return fetch('/api/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
}

/** The session as the application reads it, which is where the role has to be true. */
async function sessionFrom(signInResponse: Awaited<ReturnType<typeof signIn>>) {
	const cookie = signInResponse.headers
		.getSetCookie()
		.map(entry => entry.split(';')[0])
		.join('; ');
	expect(cookie).toContain('better-auth.session_token=');

	const response = await fetch('/api/auth/get-session', { headers: { Cookie: cookie } });
	expect(response.status).toBe(200);
	return await response.json() as { user: { id: string; email: string; role?: string | null } };
}

describe('first-admin bootstrap', () => {
	beforeAll(async () => {
		// This route is the only thing in the suite that creates users, so it starts
		// from an installation that has never had this one — including on a rerun
		// against a persisted local D1.
		await executeIntegrationD1(`
			DELETE FROM account WHERE user_id IN (SELECT id FROM user WHERE email IN ('${EMAIL}', 'too-short@keepr.digital', 'typo@keepr.digital'));
			DELETE FROM user WHERE email IN ('${EMAIL}', 'too-short@keepr.digital', 'typo@keepr.digital');
		`);
	});

	it('refuses a caller with no bootstrap token', async () => {
		expect((await ensureAdmin({ email: EMAIL, password: PASSWORD }, {})).status).toBe(403);
	});

	it('refuses a caller with the wrong bootstrap token', async () => {
		const response = await ensureAdmin(
			{ email: EMAIL, password: PASSWORD },
			{ 'x-admin-bootstrap-token': 'not-the-token' },
		);

		expect(response.status).toBe(403);
	});

	it('does not admit the Graphics Administrator token in its place', async () => {
		// Two separate secrets on purpose: this one is armed for a minute and
		// deleted, that one lives set. A route admitting either could not be
		// disarmed without turning off Graphics Administrator operations too.
		const response = await ensureAdmin(
			{ email: EMAIL, password: PASSWORD },
			{ 'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN },
		);

		expect(response.status).toBe(403);
	});

	it('creates an admin account that can sign in', async () => {
		const response = await ensureAdmin({ email: EMAIL, password: PASSWORD, name: 'Bootstrap Admin' });

		expect(response.status).toBe(200);
		const body = await response.json() as EnsureAdminResponse;
		// `created` rather than `updated` is also the proof that none of the three
		// refusals above wrote anything: this file runs in order, and an account
		// they had created would have sent this down the reset branch.
		expect(body).toMatchObject({ outcome: 'created', email: EMAIL, grantedAdminRole: true });

		const session = await sessionFrom(await signIn(EMAIL, PASSWORD));
		expect(session.user).toMatchObject({ id: body.userId, email: EMAIL, role: 'admin' });
	});

	it('resets the password of the account it already created', async () => {
		const response = await ensureAdmin({ email: EMAIL, password: RECOVERY_PASSWORD });

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ outcome: 'updated', grantedAdminRole: false });

		expect((await signIn(EMAIL, RECOVERY_PASSWORD)).status).toBe(200);
		// The forgotten password stops working, or a lockout recovery would leave
		// two live credentials on one admin account.
		expect((await signIn(EMAIL, PASSWORD)).status).toBe(401);
	});

	it('finds the same account whatever case the operator typed the email in', async () => {
		const response = await ensureAdmin({ email: EMAIL.toUpperCase(), password: RECOVERY_PASSWORD });

		expect(response.status).toBe(200);
		// One account, reported under the email it is keyed on rather than the one
		// that was typed — which is what an operator repeating a curl from their
		// shell history needs to see.
		expect(await response.json()).toMatchObject({ outcome: 'updated', email: EMAIL });
	});

	it('refuses a password shorter than Better Auth accepts', async () => {
		const response = await ensureAdmin({ email: 'too-short@keepr.digital', password: 'short' });

		expect(response.status).toBe(400);
		expect((await signIn('too-short@keepr.digital', 'short')).status).toBe(401);
	});

	it('refuses a body with a key it does not know', async () => {
		// A misspelt `password` silently ignored would create an admin account with
		// a password nobody has, discovered at the sign-in screen with the secret
		// already deleted.
		const response = await ensureAdmin({ email: 'typo@keepr.digital', passwrd: PASSWORD });

		expect(response.status).toBe(400);
		expect((await signIn('typo@keepr.digital', PASSWORD)).status).toBe(401);
	});

	it('does nothing on GET, so a password cannot travel in a query string', async () => {
		// A query string is logged by every proxy between the operator and the
		// Worker, which is why the handler is `.post.ts` and takes a body.
		const response = await fetch(
			`${ROUTE}?email=query@keepr.digital&password=${PASSWORD}`,
			{ headers: { 'x-admin-bootstrap-token': INTEGRATION_ADMIN_BOOTSTRAP_TOKEN } },
		);

		// Not 405: under `ssr: false` an unmatched path is answered by the SPA
		// shell, so what says the handler was never reached is the absence of its
		// answer, and the absence of the account it would have made.
		expect(await response.text()).not.toContain('"outcome"');
		expect((await signIn('query@keepr.digital', PASSWORD)).status).toBe(401);
	});
});

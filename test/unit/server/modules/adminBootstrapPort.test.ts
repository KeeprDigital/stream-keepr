import type { ServerAuth } from '~~/server/utils/auth';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authStaticOptions } from '~~/server/utils/authOptions';

// The port module imports `serverAuth`, which reaches the database binding at
// module scope. Every test here passes its own instance in, so the stub only has
// to exist.
vi.mock('hub:db', () => ({ db: {}, schema: {} }));
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { betterAuthBootstrapPort } = await import('~~/server/modules/admin-bootstrap/betterAuthPort');
const { ensureAdminAccount } = await import('~~/server/modules/admin-bootstrap');

/**
 * The Better Auth half of the first-admin bootstrap (#394), against a real
 * Better Auth configured exactly as this installation configures its own —
 * `authStaticOptions` is the same object the server passes — with an in-memory
 * store standing in for D1.
 *
 * This is where the ADR's "through Better Auth's server-side admin API" clause
 * is held to account. The ticket says the whole ensure goes that way; only half
 * of it can, and rather than assert that from reading the library's source,
 * these tests call both endpoints and record what each answers. A version bump
 * that opens `setUserPassword` to a sessionless call, or closes `createUser` to
 * one, fails here — which is the moment to reread this module.
 */
function throwawayAuth() {
	return betterAuth({
		...authStaticOptions,
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		secret: 'a-throwaway-secret-for-the-unit-suite',
	}) as unknown as ServerAuth;
}

const EMAIL = 'first@keepr.digital';
const PASSWORD = 'a-long-enough-password';

let auth: ServerAuth;

beforeEach(() => {
	auth = throwawayAuth();
});

describe('what Better Auth\'s admin API will do without a session', () => {
	it('creates a user, which is what the bootstrap route rests on', async () => {
		// Sessionless is the *designed* path for a server-side call: `createUser`
		// refuses only when a request or headers arrive without a session, which is
		// the "a browser asked" case. The route's own token is this call's
		// authorization.
		const { user } = await auth.api.createUser({
			body: { email: EMAIL, password: PASSWORD, name: 'First Admin', role: 'admin' },
		});

		expect(user).toMatchObject({ email: EMAIL, role: 'admin' });
	});

	/**
	 * The finding that shapes this module, and the reason #394's ticket text
	 * ("via Better Auth's server-side admin API only") cannot be met in full.
	 *
	 * `setUserPassword` sits behind the admin plugin's `adminMiddleware`, which
	 * requires an admin session unconditionally — so the endpoint that resets an
	 * admin's password can only be called by an admin who can already sign in.
	 * That is precisely the lockout this route exists to answer, which is why the
	 * reset half goes through `auth.$context` instead.
	 */
	it('refuses to set a password, session or no session', async () => {
		const { user } = await auth.api.createUser({
			body: { email: EMAIL, password: PASSWORD, name: 'First Admin', role: 'admin' },
		});

		await expect(auth.api.setUserPassword({
			body: { userId: user.id, newPassword: 'a-replacement-password' },
		})).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
	});
});

describe('the first-admin bootstrap against a real Better Auth', () => {
	async function signIn(password: string) {
		return auth.api.signInEmail({ body: { email: EMAIL, password } });
	}

	it('creates an admin who can then sign in', async () => {
		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), {
			email: EMAIL,
			password: PASSWORD,
			name: 'First Admin',
		});

		expect(outcome).toMatchObject({ outcome: 'created', email: EMAIL, grantedAdminRole: true });
		const session = await signIn(PASSWORD);
		expect(session.user).toMatchObject({ id: outcome.userId, email: EMAIL });
	});

	it('gives the account the admin role Better Auth\'s own admin API tests for', async () => {
		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), {
			email: EMAIL,
			password: PASSWORD,
		});
		const context = await auth.$context;

		expect(await context.internalAdapter.findUserById(outcome.userId))
			.toMatchObject({ role: 'admin' });
	});

	/**
	 * The break-glass path, end to end: the account exists, its password is
	 * forgotten, and there is no email sender to reset it with.
	 */
	it('replaces a forgotten password on an existing account', async () => {
		const port = await betterAuthBootstrapPort(auth);
		const created = await ensureAdminAccount(port, { email: EMAIL, password: PASSWORD });

		const reset = await ensureAdminAccount(port, { email: EMAIL, password: 'the-recovery-password' });

		expect(reset).toMatchObject({ outcome: 'updated', userId: created.userId, grantedAdminRole: false });
		expect((await signIn('the-recovery-password')).user.id).toBe(created.userId);
		// The old credential is gone, not merely superseded: a reset that left it
		// working would leave whoever knew it holding an admin account.
		await expect(signIn(PASSWORD)).rejects.toBeDefined();
	});

	it('promotes an existing non-admin account rather than refusing it', async () => {
		// The account exists because someone was invited as an ordinary user, and
		// the installation now has no admin at all.
		const context = await auth.$context;
		const user = await context.internalAdapter.createUser({
			email: EMAIL,
			name: 'An Ordinary User',
			role: 'user',
		});

		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), {
			email: EMAIL,
			password: PASSWORD,
		});

		expect(outcome).toMatchObject({ outcome: 'updated', userId: user.id, grantedAdminRole: true });
		expect(await context.internalAdapter.findUserById(user.id)).toMatchObject({ role: 'user,admin' });
		// Created without a credential account, so the reset had to make one — and
		// the account is worth nothing if it did not.
		expect((await signIn(PASSWORD)).user.id).toBe(user.id);
	});

	it('finds the account whatever case the operator typed the email in', async () => {
		const port = await betterAuthBootstrapPort(auth);
		const created = await ensureAdminAccount(port, { email: EMAIL, password: PASSWORD });

		const second = await ensureAdminAccount(port, { email: 'First@Keepr.Digital', password: PASSWORD });

		// One account, found again — whether by the module's normalization or by
		// `findUserByEmail` lowercasing its own argument, which it also does. Both
		// belts hold here; the module's own is pinned in `adminBootstrap.test.ts`
		// against a port that offers no such courtesy.
		expect(second).toMatchObject({ outcome: 'updated', userId: created.userId });
	});

	it('reads the password bounds Better Auth is actually configured with', async () => {
		const context = await auth.$context;

		const port = await betterAuthBootstrapPort(auth);

		expect(port.minPasswordLength).toBe(context.password.config.minPasswordLength);
		expect(port.maxPasswordLength).toBe(context.password.config.maxPasswordLength);
	});

	it('refuses a password Better Auth\'s own sign-up would have refused', async () => {
		// `createUser` checks neither bound, so without the module's check this
		// would create an admin whose password sign-in could never accept.
		const port = await betterAuthBootstrapPort(auth);

		await expect(ensureAdminAccount(port, { email: EMAIL, password: 'short' }))
			.rejects
			.toMatchObject({ statusCode: 400 });
		const context = await auth.$context;
		expect(await context.internalAdapter.findUserByEmail(EMAIL)).toBeNull();
	});
});

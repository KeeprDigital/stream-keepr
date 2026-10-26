import type { ServerAuth } from '~~/server/utils/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { throwawayAuth } from '~~/test/helpers/throwawayAuth';

// The port imports `serverAuth`, which touches the database binding at module scope.
vi.mock('~~/server/db', () => ({ db: {}, schema: {} }));
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { betterAuthBootstrapPort } = await import('~~/server/modules/admin-bootstrap/betterAuthPort');
const { ensureAdminAccount } = await import('~~/server/modules/admin-bootstrap');

/*
 * The first-admin bootstrap (#394) against a real Better Auth configured as this
 * installation configures it. A library bump that changes what either admin
 * endpoint will do without a session fails the first block, which is the moment
 * to reread the port.
 */

const EMAIL = 'first@keepr.digital';
const PASSWORD = 'a-long-enough-password';

let auth: ServerAuth;

beforeEach(() => {
	auth = throwawayAuth() as unknown as ServerAuth;
});

describe('what Better Auth\'s admin API will do without a session', () => {
	it('creates a user, which is what the bootstrap rests on', async () => {
		const { user } = await auth.api.createUser({
			body: {
				email: EMAIL,
				password: PASSWORD,
				name: 'First Admin',
				role: 'admin',
			},
		});

		expect(user).toMatchObject({ email: EMAIL, role: 'admin' });
	});

	it('refuses to set a password, which is why the reset goes through the internal adapter', async () => {
		const { user } = await auth.api.createUser({
			body: {
				email: EMAIL,
				password: PASSWORD,
				name: 'First Admin',
				role: 'admin',
			},
		});

		await expect(auth.api.setUserPassword({
			body: { userId: user.id, newPassword: 'a-replacement-password' },
		})).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
	});
});

describe('the first-admin bootstrap against a real Better Auth', () => {
	async function signIn(password: string) {
		return auth.api.signInEmail({
			body: { email: EMAIL, password },
		});
	}

	it('creates an admin who can then sign in', async () => {
		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), { email: EMAIL, password: PASSWORD, name: 'First Admin' });

		expect(outcome).toMatchObject({ outcome: 'created', email: EMAIL, grantedAdminRole: true });
		expect((await signIn(PASSWORD)).user).toMatchObject({ id: outcome.userId, email: EMAIL });
		const context = await auth.$context;
		expect(await context.internalAdapter.findUserById(outcome.userId)).toMatchObject({ role: 'admin' });
	});

	it('replaces a forgotten password, and the old one stops working', async () => {
		const port = await betterAuthBootstrapPort(auth);
		const created = await ensureAdminAccount(port, { email: EMAIL, password: PASSWORD });

		const reset = await ensureAdminAccount(port, { email: EMAIL, password: 'the-recovery-password' });

		expect(reset).toMatchObject({ outcome: 'updated', userId: created.userId, grantedAdminRole: false });
		expect((await signIn('the-recovery-password')).user.id).toBe(created.userId);
		await expect(signIn(PASSWORD)).rejects.toBeDefined();
	});

	it('promotes an existing non-admin account, giving it a credential it can sign in with', async () => {
		const context = await auth.$context;
		const user = await context.internalAdapter.createUser({ email: EMAIL, name: 'An Ordinary User', role: 'user' }, { method: 'admin' });

		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), { email: EMAIL, password: PASSWORD });

		expect(outcome).toMatchObject({ outcome: 'updated', userId: user.id, grantedAdminRole: true });
		expect(await context.internalAdapter.findUserById(user.id)).toMatchObject({ role: 'user,admin' });
		expect((await signIn(PASSWORD)).user.id).toBe(user.id);
	});

	it('reads an account already holding several roles as holding each of them', async () => {
		const context = await auth.$context;
		const user = await context.internalAdapter.createUser({ email: EMAIL, name: 'An Ordinary Admin', role: 'user,admin' }, { method: 'admin' });

		const outcome = await ensureAdminAccount(await betterAuthBootstrapPort(auth), { email: EMAIL, password: PASSWORD });

		// Already an admin: nothing is granted and the role column is left as it was.
		expect(outcome).toMatchObject({ outcome: 'updated', userId: user.id, grantedAdminRole: false });
		expect(await context.internalAdapter.findUserById(user.id)).toMatchObject({ role: 'user,admin' });
	});

	it('finds the account whatever case the email was typed in', async () => {
		const port = await betterAuthBootstrapPort(auth);
		const created = await ensureAdminAccount(port, { email: EMAIL, password: PASSWORD });

		await expect(ensureAdminAccount(port, { email: 'First@Keepr.Digital', password: PASSWORD }))
			.resolves
			.toMatchObject({ outcome: 'updated', userId: created.userId });
	});

	it('refuses a password sign-in would never accept, creating nothing', async () => {
		const port = await betterAuthBootstrapPort(auth);
		const context = await auth.$context;
		expect([port.minPasswordLength, port.maxPasswordLength]).toEqual([context.password.config.minPasswordLength, context.password.config.maxPasswordLength]);

		await expect(ensureAdminAccount(port, { email: EMAIL, password: 'short' })).rejects.toMatchObject({ statusCode: 400 });
		expect(await context.internalAdapter.findUserByEmail(EMAIL)).toBeNull();
	});
});

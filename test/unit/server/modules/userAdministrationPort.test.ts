import type { ServerAuth } from '~~/server/utils/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throwawayAuth as createThrowawayAuth } from '~~/test/helpers/throwawayAuth';

// The port imports `serverAuth`, which touches the database binding at module scope.
vi.mock('~~/server/db', () => ({ db: {}, schema: {} }));
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { betterAuthUserAdministrationPort } = await import('~~/server/modules/user-administration/betterAuthPort');
const {
	banUserAccount,
	createUserAccount,
	issuePasswordResetLinkForUser,
	listUserAccounts,
	revokeUserSessions,
	setUserAccountPassword,
	unbanUserAccount,
} = await import('~~/server/modules/user-administration');

/*
 * User administration (#399) against a real Better Auth configured as this
 * installation configures it. Every admin-plugin endpoint needs an admin session
 * this surface (ADR-0010's shared token) never has, so the port works through
 * `auth.$context`; the first block records that from the library, and the last
 * diffs our copy of the plugin's semantics against the plugin itself.
 */

const ORIGIN = 'https://stream.keepr.digital';

// Frozen as the system clock too (beforeEach): Better Auth checks a link's stored
// expiry against the real clock, so the two must agree (#445, #447).
const CONTEXT = {
	now: new Date('2026-08-18T09:00:00.000Z'),
	origin: ORIGIN,
};
const EMAIL = 'operator@keepr.digital';
const PASSWORD = 'a-long-enough-password';

function throwawayAuth() {
	return createThrowawayAuth() as unknown as ServerAuth;
}

let auth: ServerAuth;

beforeEach(() => {
	vi.useFakeTimers({
		toFake: ['Date'],
	});
	vi.setSystemTime(CONTEXT.now);
	auth = throwawayAuth();
});

afterEach(() => {
	vi.useRealTimers();
});

async function port() {
	return betterAuthUserAdministrationPort(auth);
}

/** The token out of a link's fragment, which is the only place it is ever written. */
function tokenFrom(url: string) {
	return new URLSearchParams(new URL(url).hash.slice(1)).get('token') ?? '';
}

async function redeem(token: string, newPassword: string) {
	return auth.api.resetPassword({
		body: { token, newPassword },
	});
}

async function signIn(email: string, password: string) {
	return auth.api.signInEmail({
		body: { email, password },
	});
}

describe('what Better Auth\'s admin API will do without a session', () => {
	it.each([
		[
			'banUser',
			() => auth.api.banUser({
				body: { userId: 'any-user' },
			}),
		],
		[
			'unbanUser',
			() => auth.api.unbanUser({
				body: { userId: 'any-user' },
			}),
		],
		[
			'revokeUserSessions',
			() => auth.api.revokeUserSessions({
				body: { userId: 'any-user' },
			}),
		],
		[
			'listUsers',
			() => auth.api.listUsers({ query: {} }),
		],
		[
			'listUserSessions',
			() => auth.api.listUserSessions({
				body: { userId: 'any-user' },
			}),
		],
		[
			'setUserPassword',
			() => auth.api.setUserPassword({
				body: { userId: 'any-user', newPassword: PASSWORD },
			}),
		],
	])('refuses %s, session or no session', async (_name, call) => {
		await expect(call()).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
	});

	it('has no self-serve reset to reach around this surface with', async () => {
		// ADR-0010: no email sender, so only an administrator can mint a reset token.
		await expect(auth.api.requestPasswordReset({
			body: { email: EMAIL },
		}))
			.rejects
			.toMatchObject({ status: 'BAD_REQUEST' });
	});
});

describe('creating an account against a real Better Auth', () => {
	it('leaves it with no working credential until the link is redeemed', async () => {
		const created = await createUserAccount(await port(), { email: EMAIL, name: 'An Operator' }, CONTEXT);

		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();

		await redeem(tokenFrom(created.passwordResetLink.url), PASSWORD);

		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('gives the account Better Auth\'s default role rather than an admin one', async () => {
		const created = await createUserAccount(await port(), { email: EMAIL, name: 'An Operator' }, CONTEXT);

		expect(created.user.role).toBe('user');
	});

	it('lists the accounts it has created', async () => {
		const configured = await port();
		await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);
		await createUserAccount(configured, { email: 'second@keepr.digital', name: 'Another' }, CONTEXT);

		const listing = await listUserAccounts(configured);

		expect(listing.total).toBe(2);
		expect(listing.users.map(user => user.email).sort())
			.toEqual(['operator@keepr.digital', 'second@keepr.digital']);
		// No password hash reaches the browser.
		expect(JSON.stringify(listing)).not.toContain('$');
	});
});

describe('the reset link an administrator hands over', () => {
	async function invite() {
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);
		return { configured, created };
	}

	it('is single-use, so a link read off a chat scrollback is dead', async () => {
		const { created } = await invite();
		const token = tokenFrom(created.passwordResetLink.url);
		await redeem(token, PASSWORD);

		await expect(redeem(token, 'a-different-password')).rejects.toBeDefined();
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('is refused once its expiry has passed', async () => {
		const { configured, created } = await invite();
		// Minted already expired: Better Auth's own consumption enforces our expiry.
		const token = await configured.issuePasswordResetToken(
			created.user.id,
			new Date(Date.now() - 1000),
		);

		await expect(redeem(token, PASSWORD)).rejects.toBeDefined();
		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();
	});

	it('replaces the credential rather than adding a second one', async () => {
		const { configured, created } = await invite();
		await redeem(tokenFrom(created.passwordResetLink.url), PASSWORD);

		const reissued = await issuePasswordResetLinkForUser(configured, created.user.id, CONTEXT);
		await redeem(tokenFrom(reissued.passwordResetLink.url), 'the-replacement-password');

		expect((await signIn(EMAIL, 'the-replacement-password')).user.id).toBe(created.user.id);
		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();
	});

	it('ends every older session when it is redeemed', async () => {
		// `revokeSessionsOnPasswordReset`: a stolen session must not outlive its password.
		const { configured, created } = await invite();
		await setUserAccountPassword(configured, created.user.id, PASSWORD);
		const session = await signIn(EMAIL, PASSWORD);
		const context = await auth.$context;
		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();

		const issued = await issuePasswordResetLinkForUser(configured, created.user.id, CONTEXT);
		// Issuing revokes nothing; only redeeming does.
		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();

		await redeem(tokenFrom(issued.passwordResetLink.url), 'the-replacement-password');

		expect(await context.internalAdapter.findSession(session.token)).toBeNull();
	});

	it('leaves sessions alone when an administrator sets a password directly', async () => {
		// This path hands somebody back in mid-show, so their sessions stay.
		const { configured, created } = await invite();
		await setUserAccountPassword(configured, created.user.id, PASSWORD);
		const session = await signIn(EMAIL, PASSWORD);
		const context = await auth.$context;

		await setUserAccountPassword(configured, created.user.id, 'the-replacement-password');

		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();
	});

	it('mints a different token every time, so two links are two credentials', async () => {
		const { configured, created } = await invite();

		const second = await issuePasswordResetLinkForUser(configured, created.user.id, CONTEXT);

		expect(tokenFrom(second.passwordResetLink.url))
			.not
			.toBe(tokenFrom(created.passwordResetLink.url));
		// Issuing a second does not invalidate the first.
		await redeem(tokenFrom(created.passwordResetLink.url), PASSWORD);
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});
});

describe('setting a password outright', () => {
	it('works on an account that has never had one', async () => {
		// An invited account has no credential row, so this has to create one.
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);

		await setUserAccountPassword(configured, created.user.id, PASSWORD);

		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('replaces one an account already had', async () => {
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);
		await setUserAccountPassword(configured, created.user.id, PASSWORD);

		await setUserAccountPassword(configured, created.user.id, 'the-replacement-password');

		expect((await signIn(EMAIL, 'the-replacement-password')).user.id).toBe(created.user.id);
		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();
	});
});

describe('banning and revoking against a real Better Auth', () => {
	async function signedInOperator() {
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);
		await setUserAccountPassword(configured, created.user.id, PASSWORD);
		const session = await signIn(EMAIL, PASSWORD);
		return { configured, created, session };
	}

	it('ends the sessions a ban would otherwise leave running', async () => {
		const { configured, created, session } = await signedInOperator();
		const context = await auth.$context;
		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();

		const outcome = await banUserAccount(configured, created.user.id, 'Left the office');

		expect(outcome).toMatchObject({ revokedSessionCount: 1 });
		// Better Auth checks a ban only when a session is created.
		expect(await context.internalAdapter.findSession(session.token)).toBeNull();
		await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ status: 'FORBIDDEN' });
	});

	it('records the reason where an administrator can read it back', async () => {
		const { configured, created } = await signedInOperator();

		await banUserAccount(configured, created.user.id, 'Left the office');

		const listing = await listUserAccounts(configured);
		expect(listing.users[0]).toMatchObject({ banned: true, banReason: 'Left the office' });
	});

	it('lets a lifted ban sign in again with the same password', async () => {
		const { configured, created } = await signedInOperator();
		await banUserAccount(configured, created.user.id, 'A misunderstanding');

		const outcome = await unbanUserAccount(configured, created.user.id);

		expect(outcome.user).toMatchObject({ banned: false, banReason: null });
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('revokes sessions without locking the account out of its own password', async () => {
		const { configured, created, session } = await signedInOperator();
		const context = await auth.$context;

		const outcome = await revokeUserSessions(configured, created.user.id);

		expect(outcome).toMatchObject({ revokedSessionCount: 1 });
		expect(await context.internalAdapter.findSession(session.token)).toBeNull();
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('reports nothing revoked where nobody was signed in', async () => {
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);

		expect(await revokeUserSessions(configured, created.user.id))
			.toMatchObject({ revokedSessionCount: 0 });
	});

	it('does not count sessions that had already lapsed', async () => {
		// Expired session rows are never pruned, so only live ones may be counted.
		const { configured, created, session } = await signedInOperator();
		const context = await auth.$context;
		await context.internalAdapter.updateSession(session.token, {
			expiresAt: new Date(Date.now() - 1000),
		});

		expect(await revokeUserSessions(configured, created.user.id))
			.toMatchObject({ revokedSessionCount: 0 });
	});
});

// ban, unban and set-password are re-implemented over `auth.$context`, so each is
// diffed against the plugin's own endpoint (called with a minted admin session)
// to catch our copy drifting on a library bump.
describe('our copy of the plugin\'s semantics, against the plugin', () => {
	const ADMIN_EMAIL = 'an-admin@keepr.digital';
	const SUBJECT_EMAIL = 'subject@keepr.digital';

	/** An admin, signed in, as request headers the plugin's middleware accepts. */
	async function adminHeaders() {
		await auth.api.createUser({
			body: {
				email: ADMIN_EMAIL,
				password: PASSWORD,
				name: 'An Admin',
				role: 'admin',
			},
		});
		const response = await auth.api.signInEmail({
			body: { email: ADMIN_EMAIL, password: PASSWORD },
			asResponse: true,
		}) as Response;
		const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

		return new Headers({ cookie });
	}

	/** One account with a live session, which is what a ban has to deal with. */
	async function subject() {
		const configured = await port();
		const created = await createUserAccount(configured, { email: SUBJECT_EMAIL, name: 'A Subject' }, CONTEXT);
		await setUserAccountPassword(configured, created.user.id, PASSWORD);
		await signIn(SUBJECT_EMAIL, PASSWORD);

		return { configured, userId: created.user.id };
	}

	/** Which providers an account holds — never the hashes. */
	async function accountShapeOf(userId: string) {
		const context = await auth.$context;
		const accounts = await context.internalAdapter.findAccounts(userId);

		return accounts.map(account => account.providerId).sort();
	}

	/** `banExpires` is compared as `?? null`: the plugin leaves it undefined, the port writes null. */
	async function banStateOf(userId: string) {
		const context = await auth.$context;
		const row = await context.internalAdapter.findUserById(userId) as {
			banned?: boolean | null;
			banReason?: string | null;
			banExpires?: Date | null;
		} | null;

		return {
			banned: row?.banned ?? false,
			banReason: row?.banReason ?? null,
			banExpires: row?.banExpires ?? null,
			activeSessions: (await context.internalAdapter.listSessions(userId, { onlyActiveSessions: true })).length,
		};
	}

	it('bans exactly the way the plugin bans', async () => {
		const headers = await adminHeaders();
		const theirs = await subject();
		await auth.api.banUser({
			body: { userId: theirs.userId, banReason: 'Left the office' },
			headers,
		});
		const pluginState = await banStateOf(theirs.userId);

		auth = throwawayAuth();
		const ours = await subject();
		await banUserAccount(ours.configured, ours.userId, 'Left the office');

		expect(await banStateOf(ours.userId)).toEqual(pluginState);
		// Absolute as well as differential, so a shared fault cannot agree with itself.
		expect(pluginState).toMatchObject({ banned: true, banReason: 'Left the office', activeSessions: 0 });
	});

	it('lifts a ban exactly the way the plugin lifts one', async () => {
		const headers = await adminHeaders();
		const theirs = await subject();
		await auth.api.banUser({
			body: { userId: theirs.userId, banReason: 'A reason' },
			headers,
		});
		await auth.api.unbanUser({
			body: { userId: theirs.userId },
			headers,
		});
		const pluginState = await banStateOf(theirs.userId);

		auth = throwawayAuth();
		const ours = await subject();
		await banUserAccount(ours.configured, ours.userId, 'A reason');
		await unbanUserAccount(ours.configured, ours.userId);

		expect(await banStateOf(ours.userId)).toEqual(pluginState);
		expect(pluginState).toMatchObject({ banned: false, banReason: null });
	});

	it('sets a password exactly the way the plugin sets one', async () => {
		const headers = await adminHeaders();
		const theirs = await subject();
		await auth.api.setUserPassword({
			body: { userId: theirs.userId, newPassword: 'the-replacement-password' },
			headers,
		});
		const pluginAccounts = await accountShapeOf(theirs.userId);
		expect((await signIn(SUBJECT_EMAIL, 'the-replacement-password')).user.id).toBe(theirs.userId);
		await expect(signIn(SUBJECT_EMAIL, PASSWORD)).rejects.toBeDefined();

		auth = throwawayAuth();
		const ours = await subject();
		await setUserAccountPassword(ours.configured, ours.userId, 'the-replacement-password');

		expect(await accountShapeOf(ours.userId)).toEqual(pluginAccounts);
		expect((await signIn(SUBJECT_EMAIL, 'the-replacement-password')).user.id).toBe(ours.userId);
		await expect(signIn(SUBJECT_EMAIL, PASSWORD)).rejects.toBeDefined();
	});
});

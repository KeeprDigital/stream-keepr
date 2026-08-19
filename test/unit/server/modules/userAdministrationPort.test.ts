import type { ServerAuth } from '~~/server/utils/auth';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStaticOptions } from '~~/server/utils/authOptions';

// The port module imports `serverAuth`, which reaches the database binding at
// module scope. Every test here passes its own instance in, so the stub only has
// to exist.
vi.mock('hub:db', () => ({ db: {}, schema: {} }));
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

/**
 * The Better Auth half of user administration (#399), against a real Better
 * Auth configured exactly as this installation configures its own —
 * `authStaticOptions` is the same object the server passes — with an in-memory
 * store standing in for D1.
 *
 * This file exists because the port is written around a constraint that is a
 * fact about a pinned library rather than a design choice: **every endpoint the
 * admin plugin exposes sits behind an admin session**, and this surface is
 * gated by ADR-0010's shared `x-graphics-admin-token` and has no session at
 * all. The first describe block below establishes that from the library rather
 * than from reading its source, so a version bump that opens those endpoints —
 * or closes the one that is open — fails here, which is the moment to reread
 * `betterAuthPort.ts` rather than the moment an administrator cannot ban
 * somebody.
 *
 * Everything after it asserts through the paths that actually matter to an
 * operator — can this person sign in, is this link still good — because a row
 * that looks right while sign-in refuses it is a passing test over a locked-out
 * colleague.
 */

const ORIGIN = 'https://stream.keepr.digital';

/**
 * The clock an administrator's request would carry, and it has to be the real one.
 *
 * A literal date was written here, and it made this file pass on the day it was
 * written and fail every day after. `issuePasswordResetLinkForUser` derives the
 * link's expiry from this `now` — `now + PASSWORD_RESET_LINK_LIFETIME_SECONDS` —
 * and the rows below redeem those links against **a real Better Auth**, which
 * checks the stored expiry against the system clock. Twenty-four hours after that
 * literal, every link this file mints is already expired and five rows fail with
 * `Invalid token`: a green suite turning red with nothing changed, pointing at the
 * library rather than at the date.
 *
 * A fixed clock is right where nothing consumes the value — `userAdministration.test.ts`
 * pins the expiry arithmetic against a literal `NOW` and should keep doing so, because
 * it asserts on the number rather than handing it to something that enforces it. The
 * distinction is whether a real expiry check is downstream, and here it is.
 *
 * The one row that needs an expired link still mints its own, explicitly in the past
 * (`new Date(Date.now() - 1000)`) — deliberate expiry, rather than expiry by the
 * calendar catching up with a fixture.
 */
const CONTEXT = { now: new Date(), origin: ORIGIN };
const EMAIL = 'operator@keepr.digital';
const PASSWORD = 'a-long-enough-password';

function throwawayAuth() {
	return betterAuth({
		...authStaticOptions,
		database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
		secret: 'a-throwaway-secret-for-the-unit-suite',
	}) as unknown as ServerAuth;
}

let auth: ServerAuth;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
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
	return auth.api.resetPassword({ body: { token, newPassword } });
}

async function signIn(email: string, password: string) {
	return auth.api.signInEmail({ body: { email, password } });
}

describe('what Better Auth\'s admin API will do without a session', () => {
	it('creates a user, which is the one operation the plugin admits', async () => {
		// Sessionless is the *designed* path for a server-side call here:
		// `createUser` refuses only when a request or headers arrive without a
		// session, which is the "a browser asked" case. The route's own shared
		// token is this call's authorization.
		const { user } = await auth.api.createUser({
			body: { email: EMAIL, password: PASSWORD, name: 'An Operator' },
		});

		expect(user).toMatchObject({ email: EMAIL });
	});

	it.each([
		['banUser', () => auth.api.banUser({ body: { userId: 'any-user' } })],
		['unbanUser', () => auth.api.unbanUser({ body: { userId: 'any-user' } })],
		['revokeUserSessions', () => auth.api.revokeUserSessions({ body: { userId: 'any-user' } })],
		['listUsers', () => auth.api.listUsers({ query: {} })],
		['listUserSessions', () => auth.api.listUserSessions({ body: { userId: 'any-user' } })],
		['setUserPassword', () => auth.api.setUserPassword({ body: { userId: 'any-user', newPassword: PASSWORD } })],
	])('refuses %s, session or no session', async (_name, call) => {
		// All six sit behind the plugin's `adminMiddleware`, which requires an
		// admin session unconditionally. That is the whole reason this port goes
		// through `auth.$context` instead — and it is a fact about the pinned
		// version, so it is recorded rather than asserted from the source.
		await expect(call()).rejects.toMatchObject({ status: 'UNAUTHORIZED' });
	});

	it('has no self-serve reset to reach around this surface with', async () => {
		// ADR-0010's "no email sender" holding at the library's own boundary: with
		// no `sendResetPassword` configured, `/request-password-reset` refuses, so
		// the only way a reset token comes into existence is an administrator
		// asking this surface for one.
		await expect(auth.api.requestPasswordReset({ body: { email: EMAIL } }))
			.rejects
			.toMatchObject({ status: 'BAD_REQUEST' });
	});
});

describe('creating an account against a real Better Auth', () => {
	it('leaves it with no working credential until the link is redeemed', async () => {
		const created = await createUserAccount(await port(), { email: EMAIL, name: 'An Operator' }, CONTEXT);

		// No password was chosen by anybody, so there is nothing to sign in with —
		// which is the property the invite shape exists for.
		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();

		await redeem(tokenFrom(created.passwordResetLink.url), PASSWORD);

		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('gives the account Better Auth\'s default role rather than an admin one', async () => {
		// Roles are out of ADR-0010's scope and nothing in this application reads
		// one, but an invited operator silently becoming an admin would be a
		// decision this surface is not entitled to make.
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
		// A listing is the surface's front page and is read by a browser; a
		// password hash on it would be the whole installation.
		expect(JSON.stringify(listing)).not.toContain('$');
	});

	it('reads the password bounds Better Auth is actually configured with', async () => {
		const context = await auth.$context;
		const configured = await port();

		expect(configured.minPasswordLength).toBe(context.password.config.minPasswordLength);
		expect(configured.maxPasswordLength).toBe(context.password.config.maxPasswordLength);
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

		// `consumeVerificationValue` deletes the row it returns, so the second
		// redemption has nothing to find. A link that stayed live would be a
		// standing credential sitting in somebody's chat history.
		await expect(redeem(token, 'a-different-password')).rejects.toBeDefined();
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('is refused once its expiry has passed', async () => {
		const { configured, created } = await invite();
		// Minted expired rather than waiting a day: the expiry this installation
		// chose is a value written onto the verification row, and what this
		// establishes is that Better Auth's own consumption enforces it — which is
		// the whole reason the module is entitled to call the link expiring.
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
		// A forgotten password that still worked would leave whoever knew it
		// holding the account.
		await expect(signIn(EMAIL, PASSWORD)).rejects.toBeDefined();
	});

	it('ends every older session when it is redeemed', async () => {
		// `revokeSessionsOnPasswordReset` (authOptions.ts). Without it a stolen
		// session outlives the password it was stolen alongside: the account gets a
		// new credential and the thief keeps the session, until an administrator
		// separately remembers to revoke — the step people forget, and the only one
		// that actually evicts anybody.
		const { configured, created } = await invite();
		await setUserAccountPassword(configured, created.user.id, PASSWORD);
		const session = await signIn(EMAIL, PASSWORD);
		const context = await auth.$context;
		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();

		const issued = await issuePasswordResetLinkForUser(configured, created.user.id, CONTEXT);
		// Issuing revokes nothing — a link an administrator sent and nobody opened
		// must not sign its owner out.
		expect(await context.internalAdapter.findSession(session.token)).not.toBeNull();

		await redeem(tokenFrom(issued.passwordResetLink.url), 'the-replacement-password');

		expect(await context.internalAdapter.findSession(session.token)).toBeNull();
	});

	it('leaves sessions alone when an administrator sets a password directly', async () => {
		// The other half of the split: this path exists to hand somebody back in
		// mid-show, where ending their sessions is the opposite of the point.
		// Better Auth reads the option in `/reset-password` only, so the two paths
		// differ by construction rather than by our remembering to make them.
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
		// The first is still good: an administrator who issued two has not
		// silently invalidated the one they already handed over.
		await redeem(tokenFrom(created.passwordResetLink.url), PASSWORD);
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});
});

describe('setting a password outright', () => {
	it('works on an account that has never had one', async () => {
		// The invited account has no `credential` row at all, so this path has to
		// create one — a reset reporting success over an account that still cannot
		// sign in is the failure worth having a test for.
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
		// Better Auth enforces a ban at session *creation*, so without this the
		// banned operator keeps working for up to ADR-0010's seven days.
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
		// The laptop left open in the production office: the person signs straight
		// back in on their own machine.
		expect((await signIn(EMAIL, PASSWORD)).user.id).toBe(created.user.id);
	});

	it('reports nothing revoked where nobody was signed in', async () => {
		const configured = await port();
		const created = await createUserAccount(configured, { email: EMAIL, name: 'An Operator' }, CONTEXT);

		expect(await revokeUserSessions(configured, created.user.id))
			.toMatchObject({ revokedSessionCount: 0 });
	});

	it('does not count sessions that had already lapsed', async () => {
		// Nothing prunes an expired session row, so a count taken without
		// `onlyActiveSessions` reports sessions that ended by themselves weeks ago
		// as sessions this action just ended. "Revoked 0" is how an administrator
		// learns the compromise they are chasing is not live, and an inflated count
		// tells them the opposite.
		const { configured, created, session } = await signedInOperator();
		const context = await auth.$context;
		await context.internalAdapter.updateSession(session.token, {
			expiresAt: new Date(Date.now() - 1000),
		});

		expect(await revokeUserSessions(configured, created.user.id))
			.toMatchObject({ revokedSessionCount: 0 });
	});
});

/**
 * Our copy of the admin plugin's semantics, diffed against the plugin itself.
 *
 * The gap this closes. Because `adminMiddleware` wants an admin session this
 * surface has not got, ban, unban and set-password are re-implemented over
 * `auth.$context` — so the plugin's *semantics* (a ban ends sessions, an unban
 * clears the reason, a password set replaces rather than adds) are now this
 * repo's copy of them. Every test above asserts what our copy does. None of
 * them can notice the copy drifting away from the original, which is the whole
 * failure mode of copying: a version bump changes the plugin, our copy stays as
 * it was, and the suite still passes.
 *
 * So these run the plugin's own endpoint and ours against equivalent accounts
 * and compare the state each leaves behind. Calling the plugin needs the admin
 * session the surface cannot have — which the unit suite *can* mint, being
 * under no obligation to be the surface.
 */
describe('our copy of the plugin\'s semantics, against the plugin', () => {
	const ADMIN_EMAIL = 'an-admin@keepr.digital';
	const SUBJECT_EMAIL = 'subject@keepr.digital';

	/** An admin, signed in, as request headers the plugin's middleware accepts. */
	async function adminHeaders() {
		await auth.api.createUser({
			body: { email: ADMIN_EMAIL, password: PASSWORD, name: 'An Admin', role: 'admin' },
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

	/**
	 * The ban-related state, normalized.
	 *
	 * `banExpires` is compared as `?? null` because the plugin leaves it
	 * `undefined` where it sets no expiry and this port writes an explicit
	 * `null` — the same fact spelled two ways, and the port writes the explicit
	 * one deliberately, so a lifted-then-reapplied ban cannot inherit a stale
	 * expiry. Anything else differing is a real divergence.
	 */
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
		await auth.api.banUser({ body: { userId: theirs.userId, banReason: 'Left the office' }, headers });
		const pluginState = await banStateOf(theirs.userId);

		// The same starting state, down our code path instead.
		auth = throwawayAuth();
		const ours = await subject();
		await banUserAccount(ours.configured, ours.userId, 'Left the office');

		expect(await banStateOf(ours.userId)).toEqual(pluginState);
		// Asserted absolutely as well as differentially, so a fault the two share
		// cannot pass this by agreeing with each other.
		expect(pluginState).toMatchObject({ banned: true, banReason: 'Left the office', activeSessions: 0 });
	});

	it('lifts a ban exactly the way the plugin lifts one', async () => {
		const headers = await adminHeaders();
		const theirs = await subject();
		await auth.api.banUser({ body: { userId: theirs.userId, banReason: 'A reason' }, headers });
		await auth.api.unbanUser({ body: { userId: theirs.userId }, headers });
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

		// The same account shape — one credential, replaced rather than added
		// beside the old one — and the same answer at the sign-in path.
		expect(await accountShapeOf(ours.userId)).toEqual(pluginAccounts);
		expect((await signIn(SUBJECT_EMAIL, 'the-replacement-password')).user.id).toBe(ours.userId);
		await expect(signIn(SUBJECT_EMAIL, PASSWORD)).rejects.toBeDefined();
	});
});

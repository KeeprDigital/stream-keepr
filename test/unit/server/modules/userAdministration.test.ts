import type { UserAdministrationPort } from '~~/server/modules/user-administration';
import type { AdministeredUser } from '~~/shared/types/userAdministration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const {
	banUserAccount,
	createUserAccount,
	issuePasswordResetLinkForUser,
	listUserAccounts,
	PASSWORD_RESET_LINK_LIFETIME_SECONDS,
	revokeUserSessions,
	setUserAccountPassword,
	unbanUserAccount,
	USER_LIST_CAP,
} = await import('~~/server/modules/user-administration');

// The user administration decisions (#399) over a plain-record port that, unlike
// Better Auth, does not lowercase emails; the library half is userAdministrationPort.

const NOW = new Date('2026-08-18T09:00:00.000Z');
const ORIGIN = 'https://stream.keepr.digital';
const CONTEXT = { now: NOW, origin: ORIGIN };

function accountFor(overrides: Partial<AdministeredUser> = {}): AdministeredUser {
	return {
		id: 'user-1',
		email: 'operator@keepr.digital',
		name: 'An Operator',
		role: 'user',
		banned: false,
		banReason: null,
		createdAt: '2026-08-01T00:00:00.000Z',
		...overrides,
	};
}

interface FakePort extends UserAdministrationPort {
	accounts: Map<string, AdministeredUser>;
	sessionCounts: Map<string, number>;
	issuedTokens: { userId: string; expiresAt: Date }[];
	revoked: string[];
	setPasswords: { userId: string; password: string }[];
}

function fakePort(seed: AdministeredUser[] = []): FakePort {
	const accounts = new Map(seed.map(account => [account.id, account]));
	const sessionCounts = new Map<string, number>();
	const issuedTokens: { userId: string; expiresAt: Date }[] = [];
	const revoked: string[] = [];
	const setPasswords: { userId: string; password: string }[] = [];

	return {
		accounts,
		sessionCounts,
		issuedTokens,
		revoked,
		setPasswords,
		minPasswordLength: 8,
		maxPasswordLength: 128,
		listUsers: async limit => ({
			users: [
				...accounts.values(),
			].slice(0, limit),
			total: accounts.size,
		}),
		findByEmail: async email => [
			...accounts.values(),
		].find(account => account.email === email) ?? null,
		findById: async userId => accounts.get(userId) ?? null,
		createUser: async ({ email, name }) => {
			const created = accountFor({
				id: `user-${accounts.size + 1}`,
				email,
				name,
				role: 'user',
			});
			accounts.set(created.id, created);
			return created;
		},
		setPassword: async (userId, password) => {
			setPasswords.push({ userId, password });
		},
		issuePasswordResetToken: async (userId, expiresAt) => {
			issuedTokens.push({ userId, expiresAt });
			return `token-for-${userId}-${issuedTokens.length}`;
		},
		setBan: async (userId, ban) => {
			const updated = accountFor({
				...accounts.get(userId),
				...ban,
			});
			accounts.set(userId, updated);
			return updated;
		},
		countSessions: async userId => sessionCounts.get(userId) ?? 0,
		revokeSessions: async (userId) => {
			revoked.push(userId);
			sessionCounts.set(userId, 0);
		},
	};
}

describe('listing the accounts an installation holds', () => {
	it('reports the true total alongside the capped rows', async () => {
		const port = fakePort([
			accountFor(),
		]);
		port.listUsers = async () => ({
			users: [
				accountFor(),
			],
			total: 412,
		});

		const listing = await listUserAccounts(port);

		expect(listing).toMatchObject({ total: 412, cap: USER_LIST_CAP });
		expect(listing.users).toHaveLength(1);
	});

	it('asks for no more rows than the cap', async () => {
		const port = fakePort();
		const listUsers = vi.fn(async () => ({ users: [], total: 0 }));
		port.listUsers = listUsers;

		await listUserAccounts(port);

		expect(listUsers).toHaveBeenCalledWith(USER_LIST_CAP);
	});
});

describe('creating an account', () => {
	let port: FakePort;

	beforeEach(() => {
		port = fakePort();
	});

	it('creates it with no password at all, and answers with the link that sets one', async () => {
		const created = await createUserAccount(
			port,
			{ email: 'new@keepr.digital', name: 'A New Operator' },
			CONTEXT,
		);

		expect(created.user).toMatchObject({ email: 'new@keepr.digital', name: 'A New Operator' });
		// The first password is chosen by its owner, never by an administrator.
		expect(port.setPasswords).toEqual([]);
		expect(port.issuedTokens).toEqual([
			{
				userId: created.user.id,
				expiresAt: expect.any(Date),
			},
		]);
	});

	it('hands over an absolute link on the origin the request arrived at', async () => {
		const created = await createUserAccount(
			port,
			{ email: 'new@keepr.digital', name: 'A New Operator' },
			CONTEXT,
		);

		// The token rides in the fragment, out of access logs.
		expect(created.passwordResetLink.url)
			.toBe(`${ORIGIN}/reset-password#token=token-for-${created.user.id}-1`);
	});

	it('joins a trailing-slash origin without doubling the slash', async () => {
		const created = await createUserAccount(
			port,
			{ email: 'new@keepr.digital', name: 'A New Operator' },
			{ now: NOW, origin: 'https://stream.keepr.digital/' },
		);

		expect(created.passwordResetLink.url).toContain('digital/reset-password#');
	});

	it('expires the link a day out, and says when', async () => {
		const created = await createUserAccount(
			port,
			{ email: 'new@keepr.digital', name: 'A New Operator' },
			CONTEXT,
		);

		const expected = new Date(NOW.getTime() + PASSWORD_RESET_LINK_LIFETIME_SECONDS * 1000);
		expect(created.passwordResetLink.expiresAt).toBe(expected.toISOString());
		expect(port.issuedTokens[0]?.expiresAt.toISOString()).toBe(expected.toISOString());
	});

	it('keys the account on the normalized email whatever case was typed', async () => {
		const created = await createUserAccount(
			port,
			{ email: '  New@Keepr.Digital  ', name: 'A New Operator' },
			CONTEXT,
		);

		expect(created.user.email).toBe('new@keepr.digital');
	});

	it('refuses a second account for an email that already has one', async () => {
		await createUserAccount(port, { email: 'new@keepr.digital', name: 'First' }, CONTEXT);

		await expect(createUserAccount(port, { email: 'New@Keepr.Digital', name: 'Second' }, CONTEXT))
			.rejects
			.toMatchObject({ statusCode: 409 });
		expect(port.accounts.size).toBe(1);
	});

	it('refuses a name that is only whitespace', async () => {
		await expect(createUserAccount(port, { email: 'new@keepr.digital', name: '   ' }, CONTEXT))
			.rejects
			.toMatchObject({ statusCode: 400 });
		expect(port.accounts.size).toBe(0);
	});
});

describe('issuing a reset link for an existing account', () => {
	it('mints a fresh one without disturbing the account', async () => {
		const port = fakePort([
			accountFor(),
		]);
		port.sessionCounts.set('user-1', 2);

		const issued = await issuePasswordResetLinkForUser(port, 'user-1', CONTEXT);

		expect(issued.user.id).toBe('user-1');
		expect(issued.passwordResetLink.url).toContain('#token=');
		// Not a revocation: that could sign an operator out mid-show.
		expect(port.revoked).toEqual([]);
		expect(port.setPasswords).toEqual([]);
	});

	it('answers 404 for an account that does not exist', async () => {
		const port = fakePort();

		await expect(issuePasswordResetLinkForUser(port, 'user-404', CONTEXT))
			.rejects
			.toMatchObject({ statusCode: 404 });
		expect(port.issuedTokens).toEqual([]);
	});
});

describe('setting a password outright', () => {
	let port: FakePort;

	beforeEach(() => {
		port = fakePort([
			accountFor(),
		]);
	});

	it('sets it on the named account', async () => {
		const outcome = await setUserAccountPassword(port, 'user-1', 'a-long-enough-password');

		expect(outcome.user.id).toBe('user-1');
		expect(port.setPasswords).toEqual([
			{ userId: 'user-1', password: 'a-long-enough-password' },
		]);
	});

	it('refuses a password shorter than Better Auth is configured to accept', async () => {
		// Better Auth's internal hasher enforces neither bound.
		await expect(setUserAccountPassword(port, 'user-1', 'short'))
			.rejects
			.toMatchObject({ statusCode: 400 });
		expect(port.setPasswords).toEqual([]);
	});

	it('refuses a password longer than Better Auth is configured to accept', async () => {
		await expect(setUserAccountPassword(port, 'user-1', 'x'.repeat(129)))
			.rejects
			.toMatchObject({ statusCode: 400 });
		expect(port.setPasswords).toEqual([]);
	});

	it('answers 404 before hashing anything for an account that does not exist', async () => {
		await expect(setUserAccountPassword(port, 'user-404', 'a-long-enough-password'))
			.rejects
			.toMatchObject({ statusCode: 404 });
		expect(port.setPasswords).toEqual([]);
	});
});

describe('banning an account', () => {
	let port: FakePort;

	beforeEach(() => {
		port = fakePort([
			accountFor(),
		]);
		port.sessionCounts.set('user-1', 3);
	});

	it('ends every session the ban would otherwise leave running', async () => {
		// Better Auth checks a ban only when a session is created.
		const outcome = await banUserAccount(port, 'user-1', 'Left the production office');

		expect(outcome).toMatchObject({ revokedSessionCount: 3 });
		expect(outcome.user).toMatchObject({ banned: true, banReason: 'Left the production office' });
		expect(port.revoked).toEqual(['user-1']);
	});

	it('records no reason rather than an empty one', async () => {
		const outcome = await banUserAccount(port, 'user-1', '   ');

		expect(outcome.user.banReason).toBeNull();
	});

	it('answers 404 without banning anything for an account that does not exist', async () => {
		await expect(banUserAccount(port, 'user-404', null)).rejects.toMatchObject({ statusCode: 404 });
		expect(port.revoked).toEqual([]);
	});

	it('lifts a ban without touching the password', async () => {
		await banUserAccount(port, 'user-1', 'A reason');

		const outcome = await unbanUserAccount(port, 'user-1');

		expect(outcome.user).toMatchObject({ banned: false, banReason: null });
		expect(port.setPasswords).toEqual([]);
	});
});

describe('revoking sessions on their own', () => {
	it('reports how many were ended, which is what makes the action legible', async () => {
		const port = fakePort([
			accountFor(),
		]);
		port.sessionCounts.set('user-1', 2);

		const outcome = await revokeUserSessions(port, 'user-1');

		expect(outcome).toMatchObject({ revokedSessionCount: 2 });
		expect(port.revoked).toEqual(['user-1']);
	});

	it('leaves the account able to sign straight back in', async () => {
		const port = fakePort([
			accountFor(),
		]);

		const outcome = await revokeUserSessions(port, 'user-1');

		expect(outcome.user.banned).toBe(false);
		expect(port.setPasswords).toEqual([]);
	});

	it('answers 404 for an account that does not exist', async () => {
		await expect(revokeUserSessions(fakePort(), 'user-404'))
			.rejects
			.toMatchObject({ statusCode: 404 });
	});
});

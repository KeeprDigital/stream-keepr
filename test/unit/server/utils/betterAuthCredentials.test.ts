import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { assertPasswordWithinBounds, normalizeAccountEmail, setCredentialPassword } = await import(
	'~~/server/utils/betterAuthCredentials',
);

/**
 * The three pieces both account-administering surfaces share (#399).
 *
 * They were a transcription of each other until this file's module existed —
 * the first-admin bootstrap wrote them, user administration copied them — and
 * shared code with no test of its own is what drifts back apart. Each surface
 * still proves its own behaviour end to end against a real Better Auth; what is
 * pinned here is the shape both of them now depend on.
 */

const BOUNDS = { minPasswordLength: 8, maxPasswordLength: 128 };

describe('the email an account is keyed on', () => {
	it('is trimmed and lowercased, because that is what Better Auth stores', () => {
		expect(normalizeAccountEmail('  Operator@Keepr.Digital ')).toBe('operator@keepr.digital');
	});

	it('leaves an already-normalized address exactly as it is', () => {
		expect(normalizeAccountEmail('operator@keepr.digital')).toBe('operator@keepr.digital');
	});
});

describe('the password bounds both surfaces enforce', () => {
	it('admits one inside them', () => {
		expect(() => assertPasswordWithinBounds(BOUNDS, 'a-long-enough-password')).not.toThrow();
	});

	it('refuses one too short, naming the bound', () => {
		// The bound is named because the only reader who can act on this is the
		// person choosing the password.
		expect(() => assertPasswordWithinBounds(BOUNDS, 'short'))
			.toThrow(/at least 8 characters/);
	});

	it('refuses one too long', () => {
		expect(() => assertPasswordWithinBounds(BOUNDS, 'x'.repeat(129)))
			.toThrow(/at most 128 characters/);
	});

	it('refuses an empty password, which is the case neither library endpoint catches', () => {
		// `createUser` enforces neither bound, so without this an empty password
		// hashes and stores happily and its owner can never sign in.
		expect(() => assertPasswordWithinBounds(BOUNDS, '')).toThrow();
	});
});

describe('writing the credential', () => {
	function fakeContext(accounts: { providerId: string }[]) {
		const updatePassword = vi.fn(async () => {});
		const createAccount = vi.fn(async () => {});

		return {
			context: {
				password: { hash: vi.fn(async (value: string) => `hashed:${value}`) },
				internalAdapter: {
					findAccounts: vi.fn(async () => accounts),
					updatePassword,
					createAccount,
				},
			},
			updatePassword,
			createAccount,
		};
	}

	it('updates the credential an account already has', async () => {
		const { context, updatePassword, createAccount } = fakeContext([{ providerId: 'credential' }]);

		await setCredentialPassword(context as never, 'user-1', 'a-long-enough-password');

		expect(updatePassword).toHaveBeenCalledWith('user-1', 'hashed:a-long-enough-password');
		expect(createAccount).not.toHaveBeenCalled();
	});

	it('creates one where the account has none, which is every invited account', async () => {
		// An invited account has no `credential` row until its link is redeemed.
		// Skipping this arm would report success over an account that still cannot
		// sign in — the failure worth having a test for.
		const { context, updatePassword, createAccount } = fakeContext([]);

		await setCredentialPassword(context as never, 'user-1', 'a-long-enough-password');

		expect(createAccount).toHaveBeenCalledWith({
			userId: 'user-1',
			providerId: 'credential',
			accountId: 'user-1',
			password: 'hashed:a-long-enough-password',
		});
		expect(updatePassword).not.toHaveBeenCalled();
	});

	it('creates one where the account holds only some other provider', async () => {
		const { context, createAccount } = fakeContext([{ providerId: 'google' }]);

		await setCredentialPassword(context as never, 'user-1', 'a-long-enough-password');

		expect(createAccount).toHaveBeenCalled();
	});

	it('never stores the password as given', async () => {
		const { context, updatePassword } = fakeContext([{ providerId: 'credential' }]);

		await setCredentialPassword(context as never, 'user-1', 'a-long-enough-password');

		expect(updatePassword).not.toHaveBeenCalledWith('user-1', 'a-long-enough-password');
	});
});

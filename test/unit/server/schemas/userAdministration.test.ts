import { describe, expect, it } from 'vitest';
import {
	banUserAccountSchema,
	createUserAccountSchema,
	setUserPasswordSchema,
} from '~~/server/schemas/api/userAdministration';

/**
 * The user administration bodies (#399). Shape only — a password's length is
 * checked against Better Auth's own configured bounds in the module, so this
 * file deliberately proves that it is *not* checked here.
 */

describe('the create-account body', () => {
	it('accepts an email and a name', () => {
		expect(createUserAccountSchema.parse({ email: 'new@keepr.digital', name: 'A New Operator' }))
			.toEqual({ email: 'new@keepr.digital', name: 'A New Operator' });
	});

	it('refuses something that is not an email address', () => {
		expect(() => createUserAccountSchema.parse({ email: 'new', name: 'A New Operator' })).toThrow();
	});

	it('refuses a body with no name', () => {
		// The name is what the Evidence Ledger resolves an actor to at read time,
		// so an account without one is work attributed to nothing.
		expect(() => createUserAccountSchema.parse({ email: 'new@keepr.digital' })).toThrow();
		expect(() => createUserAccountSchema.parse({ email: 'new@keepr.digital', name: '' })).toThrow();
	});

	it('refuses a key it does not know', () => {
		// A misspelt key silently ignored here creates an account nobody meant.
		expect(() => createUserAccountSchema.parse({
			email: 'new@keepr.digital',
			name: 'A New Operator',
			role: 'admin',
		})).toThrow();
	});
});

describe('the set-password body', () => {
	it('accepts any password, leaving the bounds to the module', () => {
		// Short on purpose: the bounds are Better Auth's own, read from the running
		// configuration, and a number restated here could drift from the one
		// sign-in enforces.
		expect(setUserPasswordSchema.parse({ password: 'x' })).toEqual({ password: 'x' });
	});

	it('refuses a body with no password, and one with anything else in it', () => {
		expect(() => setUserPasswordSchema.parse({})).toThrow();
		expect(() => setUserPasswordSchema.parse({ password: 'a-password', userId: 'user-1' })).toThrow();
	});
});

describe('the ban body', () => {
	it('accepts a reason, and accepts none', () => {
		expect(banUserAccountSchema.parse({ reason: 'Left the office' }).reason).toBe('Left the office');
		// Typing a reason should never be what stands between an administrator and
		// ending a compromised session.
		expect(banUserAccountSchema.parse({})).toEqual({});
	});

	it('refuses a reason too long to display back on the listing', () => {
		expect(() => banUserAccountSchema.parse({ reason: 'x'.repeat(501) })).toThrow();
	});

	it('refuses a key it does not know', () => {
		// `banExpiresIn` is the one worth naming: this surface writes no ban
		// expiry, and a body that quietly accepted one would read as though it did.
		expect(() => banUserAccountSchema.parse({ banExpiresIn: 3600 })).toThrow();
	});
});

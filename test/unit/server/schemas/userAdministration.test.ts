import { describe, expect, it } from 'vitest';
import {
	banUserAccountSchema,
	createUserAccountSchema,
	setUserPasswordSchema,
} from '~~/server/schemas/api/userAdministration';

// The user administration bodies (#399). Password length is left to the module,
// which reads Better Auth's configured bounds.

describe('the create-account body', () => {
	it('requires a name, which is what the Evidence Ledger attributes work to', () => {
		expect(createUserAccountSchema.parse({ email: 'new@keepr.digital', name: 'A New Operator' }))
			.toEqual({ email: 'new@keepr.digital', name: 'A New Operator' });
		expect(() => createUserAccountSchema.parse({ email: 'new@keepr.digital' })).toThrow();
		expect(() => createUserAccountSchema.parse({ email: 'new@keepr.digital', name: '' })).toThrow();
	});

	it('refuses a key it does not know', () => {
		expect(() => createUserAccountSchema.parse({
			email: 'new@keepr.digital',
			name: 'A New Operator',
			role: 'admin',
		})).toThrow();
	});
});

describe('the set-password body', () => {
	it('accepts any password, and nothing else', () => {
		expect(setUserPasswordSchema.parse({ password: 'x' })).toEqual({ password: 'x' });
		expect(() => setUserPasswordSchema.parse({ password: 'a-password', userId: 'user-1' })).toThrow();
	});
});

describe('the ban body', () => {
	it('takes an optional reason short enough to display back on the listing', () => {
		expect(banUserAccountSchema.parse({})).toEqual({});
		expect(banUserAccountSchema.parse({
			reason: 'x'.repeat(500),
		}).reason).toHaveLength(500);
		expect(() => banUserAccountSchema.parse({
			reason: 'x'.repeat(501),
		})).toThrow();
	});

	it('refuses a ban expiry, which this surface does not write', () => {
		expect(() => banUserAccountSchema.parse({ banExpiresIn: 3600 })).toThrow();
	});
});

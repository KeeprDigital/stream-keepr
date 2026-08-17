import { describe, expect, it } from 'vitest';
import { ensureAdminSchema } from '~~/server/schemas/api/adminBootstrap';

/**
 * The first-admin bootstrap body (#394). Shape only — the password's length is
 * checked against Better Auth's own configured bounds in the module, so this
 * file deliberately proves that it is *not* checked here.
 */
describe('the ensure-admin body', () => {
	it('accepts an email and a password', () => {
		expect(ensureAdminSchema.parse({ email: 'first@keepr.digital', password: 'a-password' }))
			.toEqual({ email: 'first@keepr.digital', password: 'a-password' });
	});

	it('accepts an optional display name', () => {
		expect(ensureAdminSchema.parse({
			email: 'first@keepr.digital',
			password: 'a-password',
			name: 'First Admin',
		}).name).toBe('First Admin');
	});

	it('refuses something that is not an email address', () => {
		expect(() => ensureAdminSchema.parse({ email: 'first', password: 'a-password' })).toThrow();
	});

	it('refuses a body with no password', () => {
		expect(() => ensureAdminSchema.parse({ email: 'first@keepr.digital' })).toThrow();
	});

	/**
	 * This body is typed into a terminal under time pressure, and a misspelt key
	 * silently ignored would create an admin account with a password nobody has —
	 * discovered at the sign-in screen, with the secret already deleted.
	 */
	it('refuses an unknown key rather than ignoring it', () => {
		expect(() => ensureAdminSchema.parse({
			email: 'first@keepr.digital',
			password: 'a-password',
			passwrd: 'the-one-they-meant',
		})).toThrow();
	});

	it('leaves password length to the module that knows the configured bounds', () => {
		// A length here would be a second opinion about what sign-in accepts, and
		// the two would drift the first time Better Auth's minimum changed.
		expect(ensureAdminSchema.parse({ email: 'first@keepr.digital', password: 'x' }).password).toBe('x');
	});
});

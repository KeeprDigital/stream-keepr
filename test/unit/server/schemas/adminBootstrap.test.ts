import { describe, expect, it } from 'vitest';
import { ensureAdminSchema } from '~~/server/schemas/api/adminBootstrap';

// The first-admin bootstrap body (#394).
describe('the ensure-admin body', () => {
	it('refuses an unknown key rather than ignoring it', () => {
		// Typed into a terminal: a misspelt key ignored would create an admin whose
		// password nobody has.
		expect(ensureAdminSchema.parse({ email: 'first@keepr.digital', password: 'a-password' }))
			.toEqual({ email: 'first@keepr.digital', password: 'a-password' });
		expect(() => ensureAdminSchema.parse({
			email: 'first@keepr.digital',
			password: 'a-password',
			passwrd: 'the-one-they-meant',
		})).toThrow();
	});

	it('leaves password length to the module that reads Better Auth\'s configured bounds', () => {
		expect(ensureAdminSchema.parse({ email: 'first@keepr.digital', password: 'x' }).password).toBe('x');
	});
});

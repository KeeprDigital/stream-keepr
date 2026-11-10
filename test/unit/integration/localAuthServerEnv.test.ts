import { describe, expect, it } from 'vitest';
import { INTEGRATION_ABLY_API_KEY_ENV } from '~~/test/integration/realtimeDiagnosis';
import { localAuthServerEnv } from '~~/test/local-auth/serverEnv';

// The local-auth server never reaches Ably: it creates and deletes an Event, and
// with the developer's key each write would publish on the real app (#1028).
// Empty, not absent: `nuxt dev` fills an unset name from `.env`.

describe('the local-auth server environment', () => {
	it('blanks the Ably key the server would otherwise load from .env', () => {
		const env = localAuthServerEnv({ nodeOptions: '' });

		expect(env[INTEGRATION_ABLY_API_KEY_ENV]).toBe('');
	});
});

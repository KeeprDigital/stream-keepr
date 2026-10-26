import { describe, expect, it } from 'vitest';
import { announceIntegrationMode, INTEGRATION_MODE_ENV } from '~~/test/integration/state';

describe('the integration suite announcing itself to its own process', () => {
	it('sets the flag the rest of the repo reads, as exactly `true`', () => {
		// Nuxt's `ProcessEnv` augmentation makes an empty environment impossible to write literally.
		const env = {} as NodeJS.ProcessEnv;

		announceIntegrationMode(env);

		expect(env[INTEGRATION_MODE_ENV]).toBe('true');
	});
});

import { describe, expect, it } from 'vitest';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
	localAuthBypassEnabled,
} from '~~/shared/utils/localDeveloperAuth';

describe('the Local Developer Session opt-in', () => {
	it('activates on the exact bypass value and nothing else', () => {
		expect(localAuthBypassEnabled(LOCAL_AUTH_BYPASS_ENABLED_VALUE)).toBe(true);

		// Environment variables arrive as strings, so a near miss is a misspelling
		// rather than an intention, and the boundary stays where it was.
		for (const value of [undefined, null, '', ' ', 'true ', 'false', 'TRUE', 'True', '1', 'yes', true, 1])
			expect(localAuthBypassEnabled(value)).toBe(false);
	});

	it('is named outside the NUXT_ family, so no .env name can reach it', () => {
		// The name is the guard (#519): it is set by the `:bypass` launchers
		// on the command line and assigned in no file, and it
		// is deliberately not a `NUXT_` name — nothing in `.env`, and no
		// runtimeConfig key, answers to it.
		expect(LOCAL_AUTH_BYPASS_NAME).toBe('STREAM_KEEPR_LOCAL_AUTH_BYPASS');
		expect(LOCAL_AUTH_BYPASS_NAME.startsWith('NUXT_')).toBe(false);
	});
});

import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfiguredSecret, SHARED_SECRET_MIN_LENGTH } from '~~/server/utils/configuredSecret';
import { INTEGRATION_ADMIN_BOOTSTRAP_TOKEN, INTEGRATION_GRAPHICS_ADMIN_TOKEN } from '~~/test/integration/environment';

const SETTING = 'NUXT_GRAPHICS_ADMIN_TOKEN';

// A shared secret shorter than the floor is guessable, so it reads as not
// configured and its surface stays unarmed; the log names the setting, never
// the value.
describe('a configured secret held to a minimum length', () => {
	let logged: MockInstance<typeof console.error>;

	beforeEach(() => {
		logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		logged.mockRestore();
	});

	it.each([
		[
			'at the floor',
			'k'.repeat(SHARED_SECRET_MIN_LENGTH),
			'k'.repeat(SHARED_SECRET_MIN_LENGTH),
			0,
		],
		[
			'above the floor',
			'k'.repeat(SHARED_SECRET_MIN_LENGTH + 12),
			'k'.repeat(SHARED_SECRET_MIN_LENGTH + 12),
			0,
		],
		[
			'at the floor once trimmed',
			` ${'k'.repeat(SHARED_SECRET_MIN_LENGTH)} `,
			'k'.repeat(SHARED_SECRET_MIN_LENGTH),
			0,
		],
		[
			'one below the floor',
			'k'.repeat(SHARED_SECRET_MIN_LENGTH - 1),
			'',
			1,
		],
		[
			'below the floor once trimmed',
			`${'k'.repeat(SHARED_SECRET_MIN_LENGTH - 1)}  `,
			'',
			1,
		],
		['one character', 'k', '', 1],
		// Unset is not too short: nothing was set, so there is nothing to say.
		['blank', '   ', '', 0],
		['unset', undefined, '', 0],
	])('reads a secret %s', (_case, configured, read, logLines) => {
		expect(readConfiguredSecret(configured, SETTING, { minLength: SHARED_SECRET_MIN_LENGTH })).toBe(read);
		expect(logged).toHaveBeenCalledTimes(logLines);
	});

	it('logs the setting and the floor, and not the secret', () => {
		readConfiguredSecret('too-short-to-keep', SETTING, { minLength: SHARED_SECRET_MIN_LENGTH });

		const line = String(logged.mock.calls[0]?.[0]);
		expect(line).toContain(SETTING);
		expect(line).toContain(String(SHARED_SECRET_MIN_LENGTH));
		expect(line).not.toContain('too-short-to-keep');
	});

	// The spawned integration server arms both surfaces with these; a floor
	// above either would turn every administrator route there into a 503.
	it.each([
		['INTEGRATION_GRAPHICS_ADMIN_TOKEN', INTEGRATION_GRAPHICS_ADMIN_TOKEN],
		['INTEGRATION_ADMIN_BOOTSTRAP_TOKEN', INTEGRATION_ADMIN_BOOTSTRAP_TOKEN],
	])('reads the integration suite\'s %s as configured', (_name, fixture) => {
		expect(readConfiguredSecret(fixture, SETTING, { minLength: SHARED_SECRET_MIN_LENGTH })).toBe(fixture);
	});

	it('holds a value to no floor unless its reader states one', () => {
		expect(readConfiguredSecret('short', 'NUXT_BANDAI_KEEPR_API_URL')).toBe('short');
	});
});

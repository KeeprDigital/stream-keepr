import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceConfigurationError } from '~~/server/utils/errors';

vi.mock('~~/server/db', () => ({ db: { $client: {} } }));

vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { screenOutputAssetCapabilityManagerForEvent } = await import(
	'~~/server/modules/screen-output-assets/runtime',
);

function withSigningKey(value: unknown) {
	vi.stubGlobal('useRuntimeConfig', () => ({ screenOutputCapabilitySigningKey: value }));
	return { context: {} } as never;
}

/**
 * A misconfigured signing key is the first thing a fresh checkout hits, and the
 * only place it surfaces is the response to screen creation. If that response
 * does not say which name is wrong, the author is left with a bare 503 for a
 * one-line environment fix — which is exactly what #233 recorded.
 */
describe('a Screen Output capability signing key that cannot be used', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('names the environment variable when nothing set it', () => {
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey('')))
			.toThrowError(/NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set/);
	});

	it('names the environment variable when the runtime config carries no string at all', () => {
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey(undefined)))
			.toThrowError(/NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not set/);
	});

	it('distinguishes a key of the wrong shape from an absent one', () => {
		// Both answer 503, and the two fixes are not the same fix.
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey('not-base64-32-bytes')))
			.toThrowError(/NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY is not 32-byte base64/);
	});

	it('still answers 503, so no caller\'s handling of the outcome changes', () => {
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey('')))
			.toThrowError(expect.objectContaining({ statusCode: 503 }));
	});

	it('carries a cause the 5xx sanitizer will let the message through', () => {
		// The message is only public because `mapPublicNitroError` recognises this
		// cause; thrown without one it would reach the author as 'Internal Server
		// Error' however carefully it were worded here.
		let thrown: unknown;
		try {
			screenOutputAssetCapabilityManagerForEvent(withSigningKey(''));
		}
		catch (error) {
			thrown = error;
		}

		const { cause } = thrown as { cause: unknown };

		expect(cause).toBeInstanceOf(ServiceConfigurationError);
	});

	it('is not raised for a well-formed key', () => {
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey(`${'A'.repeat(43)}=`)))
			.not
			.toThrow();
	});
});

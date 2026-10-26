import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceConfigurationError } from '~~/server/utils/errors';

vi.mock('~~/server/db', () => ({
	db: { $client: {} },
}));

vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

const { screenOutputAssetCapabilityManagerForEvent } = await import(
	'~~/server/modules/screen-output-assets/runtime',
);

function withSigningKey(value: unknown) {
	vi.stubGlobal('useRuntimeConfig', () => ({ screenOutputCapabilitySigningKey: value }));
	return { context: {} } as never;
}

// The only place a bad signing key surfaces is the screen-creation response, so it names the variable (#233).
describe('a Screen Output capability signing key that cannot be used', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	function refusalFor(value: unknown) {
		try {
			screenOutputAssetCapabilityManagerForEvent(withSigningKey(value));
		}
		catch (error) {
			return error as Error & { statusCode: number; cause: unknown };
		}
		throw new Error('Expected the signing key to be refused');
	}

	it.each([
		['set to nothing', '', 'is not set'],
		['absent from the runtime config', undefined, 'is not set'],
		['the wrong shape', 'not-base64-32-bytes', 'is not 32-byte base64'],
	])('names the variable and the fix when the key is %s', (_label, value, fix) => {
		const refusal = refusalFor(value);

		expect(refusal.statusCode).toBe(503);
		expect(refusal.message).toContain(`NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY ${fix}`);
		// The cause is what lets the public error mapper keep the message.
		expect(refusal.cause).toBeInstanceOf(ServiceConfigurationError);
	});

	it('is not raised for a well-formed key', () => {
		expect(() => screenOutputAssetCapabilityManagerForEvent(withSigningKey(`${'A'.repeat(43)}=`)))
			.not
			.toThrow();
	});
});

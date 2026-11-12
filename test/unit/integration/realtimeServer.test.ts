import { describe, expect, it } from 'vitest';
import { INTEGRATION_ABLY_API_KEY_ENV } from '~~/test/integration/realtimeDiagnosis';
import {
	assertRealtimeTestFile,
	INTEGRATION_KEYLESS_WORKER_ENV,
	withoutAblyKey,
} from '~~/test/integration/state';

// Only the realtime server may reach Ably: each Event a keyed server creates opens
// a channel on the account production shares. Empty, not absent: `nuxt dev` fills
// an unset name from `.env`.

describe('an integration server that tests no realtime', () => {
	it('starts with the Ably key blank and the rest of its environment kept', () => {
		const env = withoutAblyKey({ [INTEGRATION_ABLY_API_KEY_ENV]: 'app.key:secret', NUXT_OTHER: 'kept' });

		expect(env).toEqual({ [INTEGRATION_ABLY_API_KEY_ENV]: '', NUXT_OTHER: 'kept' });
	});
});

describe('a test file reading the Ably key', () => {
	it('is refused in a worker whose server has none, and told where it belongs', () => {
		const env = { [INTEGRATION_KEYLESS_WORKER_ENV]: 'true' } as unknown as NodeJS.ProcessEnv;

		expect(() => assertRealtimeTestFile(env)).toThrow(/\*\.realtime\.test\.ts/);
	});

	it('is admitted where no worker was marked keyless', () => {
		expect(() => assertRealtimeTestFile({} as NodeJS.ProcessEnv)).not.toThrow();
	});
});

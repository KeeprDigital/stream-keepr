import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
} from '../../shared/utils/localDeveloperAuth';
import { INTEGRATION_ABLY_API_KEY_ENV } from '../integration/realtimeDiagnosis';
import { INTEGRATION_MODE_ENV } from '../integration/state';

/**
 * What the local-auth suite lays over its dev server's inherited environment.
 *
 * Apart from `globalSetup.ts` so the unit suite can read it without starting a
 * server. The suite is a launcher, and the only one in the test tree that asks
 * for a bypassed server. Nothing it inherits can arm this: no file assigns the
 * name, and it reaches the server child alone, never the test process.
 *
 * The Ably key is blanked, not left out: `nuxt dev` fills an unset name from
 * `.env`, and with the developer's key every write here would publish on the
 * real Ably app (#1028). No test in the suite reads realtime; a publish without
 * a key is logged and the write still answers.
 */
export function localAuthServerEnv({ nodeOptions }: { nodeOptions: string }): Record<string, string> {
	return {
		[INTEGRATION_MODE_ENV]: 'true',
		[LOCAL_AUTH_BYPASS_NAME]: LOCAL_AUTH_BYPASS_ENABLED_VALUE,
		NUXT_BETTER_AUTH_SECRET: '',
		NUXT_ADMIN_BOOTSTRAP_TOKEN: '',
		[INTEGRATION_ABLY_API_KEY_ENV]: '',
		NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
		NODE_OPTIONS: nodeOptions,
	};
}

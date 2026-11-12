import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { INTEGRATION_ABLY_API_KEY_ENV } from './realtimeDiagnosis';
import { assertRealtimeTestFile } from './state';

assertRealtimeTestFile();

/**
 * Whether this run has a real Ably key, deciding the realtime tests and the notice.
 *
 * The suite invents its other secrets, and cannot invent this one. A fabricated key
 * still signs a token request, because `createTokenRequest` computes the HMAC
 * locally, so the realtime token test would pass against a key that could never
 * connect; meanwhile every publish would leave for the real service and 404, which
 * costs an outbound request on each screen mutation and fails whenever the suite
 * runs offline. Realtime coverage is worth having only where a genuine key is.
 *
 * Nothing here can tell a fabricated key from a real one — that answer only exists
 * on Ably's side of a publish. `realtimeDiagnosis` is where the run says so once the
 * publish has come back refused.
 *
 * Only a `*.realtime.test.ts` file may import this module: every other file runs
 * against a server with no key (`./state.ts` § realtime server), where a test
 * guarded by this answer would wait for a publish that never leaves.
 *
 * The server needs no help getting the key — it inherits a real environment variable,
 * and loads `.env` itself otherwise. This resolves the key only to *decide*, and the
 * `.env` fallback exists for one process: `globalSetup` runs before the server boots,
 * so its environment does not carry `.env` yet and it would otherwise announce a skip
 * on a checkout that has a key. Test workers fork after the boot and inherit it, so
 * they mostly take the first branch; the fallback keeps them right either way.
 *
 * Resolve `.env` against this file rather than `process.cwd()`. The two diverge
 * whenever the suite is driven from elsewhere (`pnpm --dir`, an absolute `--config`,
 * any root-level orchestration over worktrees), and a miss there is not neutral: it
 * would claim "unconfigured" while the server still found its key, printing a skip
 * notice over a test that ran and failed.
 */
function resolveAblyApiKey(): string {
	const fromEnvironment = process.env[INTEGRATION_ABLY_API_KEY_ENV];
	if (fromEnvironment)
		return fromEnvironment;

	try {
		const dotenvPath = fileURLToPath(new URL('../../.env', import.meta.url));
		return parseEnv(readFileSync(dotenvPath, 'utf8'))[INTEGRATION_ABLY_API_KEY_ENV] ?? '';
	}
	catch {
		// No `.env`, or one that cannot be read: the same answer as a checkout
		// carrying no key, which is the case this whole path exists to name.
		return '';
	}
}

export const INTEGRATION_ABLY_API_KEY = resolveAblyApiKey();

/** Whether the realtime path can be exercised against the real service this run. */
export const integrationRealtimeConfigured = INTEGRATION_ABLY_API_KEY !== '';

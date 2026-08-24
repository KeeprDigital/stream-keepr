import { main as reapStrandedWorkerd } from '../../scripts/reap-workerd.mjs';
import { createTest, exposeContextToEnv, fetch } from './client';
import { INTEGRATION_REALTIME_SKIP_NOTICE, integrationRealtimeConfigured, integrationSetupOptions } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { announceIntegrationMode, resetIntegrationWranglerState } from './state';
import './disable-fs-watch.mjs';

/**
 * That the server is up, its database is migrated, and an operator can get in.
 *
 * `/api/events` is the readiness probe because it reads D1 — a server that
 * answers it has run its migrations. Since #396 it is also behind the API
 * boundary, so this now proves the second thing as well: that the suite's
 * operator exists and its session is accepted. Both facts are worth failing here
 * for. Without the second, a broken sign-in would surface as every test in the
 * run answering 401, with nothing naming the cause.
 *
 * The `fetch` imported here is the suite's own signed-in client (`./client.ts`),
 * so the sign-in it performs on first use happens here — before any test file
 * runs, where a failure names itself.
 */
async function assertIntegrationServerReady() {
	const response = await fetch('/api/events');
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`Integration server database readiness check failed with status ${response.status}: ${detail}`,
		);
	}
}

export async function setup() {
	// First, and before `createTest`: `loadFixture()` runs `loadNuxt()` in *this*
	// process, against the repository root, and `integrationSetupOptions.env`
	// reaches only the server child. Without this, config-time readers here see an
	// environment with no sign that a suite is running, and the child inherits
	// whatever they wrote.
	announceIntegrationMode();

	// Say this once, before anything runs, so a reader meets the reason for the
	// skipped tests rather than having to work back to it from a bare skip mark.
	if (!integrationRealtimeConfigured)
		console.warn(INTEGRATION_REALTIME_SKIP_NOTICE);

	// A workerd stranded by a killed session still holds sqlite locks on the
	// persist directories; sweep them before touching that state.
	await reapStrandedWorkerd();

	await resetIntegrationWranglerState();
	await prepareIntegrationD1();

	const hooks = createTest(integrationSetupOptions);
	await hooks.beforeAll();
	exposeContextToEnv();
	await assertIntegrationServerReady();

	return async () => {
		await hooks.afterAll();
		await resetIntegrationWranglerState();
	};
}

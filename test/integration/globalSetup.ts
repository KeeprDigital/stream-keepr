import { createTest, exposeContextToEnv, fetch } from '@nuxt/test-utils/e2e';
import { integrationSetupOptions } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { announceIntegrationMode, resetIntegrationWranglerState } from './state';
import './disable-fs-watch.mjs';

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

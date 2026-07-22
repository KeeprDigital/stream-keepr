import { createTest, exposeContextToEnv, fetch } from '@nuxt/test-utils/e2e';
import { integrationSetupOptions } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { resetIntegrationWranglerState } from './state';
import './disable-fs-watch.mjs';

async function assertIntegrationServerReady() {
	const response = await fetch('/api/events');
	if (!response.ok)
		throw new Error(`Integration server database readiness check failed with status ${response.status}`);
}

export async function setup() {
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

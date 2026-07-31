import type { GraphicsOperationsCockpit } from '~~/shared/types/graphicsAsset';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

const administratorHeaders = {
	'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
};

describe('the Operations Cockpit API', () => {
	it('keeps the cockpit behind Graphics Administrator authorization', async () => {
		const response = await fetch('/api/admin/graphics-assets/operations-cockpit');

		expect(response.status).toBe(403);
	});

	it('answers with one composed, domain-shaped reading of the whole library', async () => {
		const cockpit = await $fetch<GraphicsOperationsCockpit>(
			'/api/admin/graphics-assets/operations-cockpit',
			{ headers: administratorHeaders },
		);

		expect(cockpit.outcome).toBe('complete');
		if (cockpit.outcome !== 'complete')
			return;

		// D1 catalogue health and canonical R2 byte health are separate answers.
		// The suite shares one database, so what earlier suites left behind
		// decides whether a component is healthy or degraded; what this asserts
		// is that each component answered, and answered on its own.
		expect(['healthy', 'degraded']).toContain(cockpit.condition.catalogue.status);
		expect(['healthy', 'degraded']).toContain(cockpit.condition.canonicalByteStore.status);
		expect(cockpit.condition.stagingByteStore.status).toBe('healthy');
		// Whether the two sides genuinely derive from separate evidence is proved
		// against a controlled catalogue in
		// test/unit/server/modules/graphicsOperationsCockpit.sqlite.test.ts; here
		// only the composed contract is exercised.

		// The canonical quota states where its boundaries actually sit, and the
		// staging allowance stays a budget of its own.
		expect(cockpit.capacity.canonical.boundaries).toMatchObject({
			warningFraction: 0.8,
			criticalFraction: 0.95,
			fullFraction: 1,
		});
		expect(cockpit.capacity.canonical.boundaries.fullBytes)
			.toBe(cockpit.capacity.canonical.limitBytes);
		expect(cockpit.capacity.staging.limitBytes).toBeGreaterThan(0);
		expect(cockpit.capacity.staging).not.toHaveProperty('boundaries');

		expect(cockpit.reconciliation.authority).toEqual({
			expectedReachability: 'catalogue',
			presentBytes: 'byte-store',
			contentAvailabilityFlag: 'advisory-reconciliation-state',
		});
		expect(cockpit.lifecycle.guaranteesShortenedUnderPressure).toBe(false);
		expect(cockpit.lifecycle.retired.reversibleWithoutDeadline).toBe(true);

		// Nothing about the storage provider crosses the boundary.
		const serialised = JSON.stringify(cockpit);
		expect(serialised).not.toContain('sha256');
		expect(serialised).not.toContain('bucket');
		expect(serialised).not.toContain(INTEGRATION_GRAPHICS_ADMIN_TOKEN);
	});
});

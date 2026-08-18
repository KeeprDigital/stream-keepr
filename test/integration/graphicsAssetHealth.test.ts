import type { GraphicsAssetLibraryHealth } from '~~/shared/types/graphicsAsset';
import { describe, expect, it } from 'vitest';
import { $fetch, fetch } from './client';
import { INTEGRATION_GRAPHICS_ADMIN_TOKEN } from './helpers';

describe('the Graphics Asset Library health API', () => {
	const administratorHeaders = {
		'x-graphics-admin-token': INTEGRATION_GRAPHICS_ADMIN_TOKEN,
	};

	it('keeps the health check behind Graphics Administrator authorization', async () => {
		const response = await fetch('/api/admin/graphics-assets/health');

		expect(response.status).toBe(403);
	});

	it('reports the migrated D1 catalogue and both private local byte stores separately', async () => {
		const health = await $fetch<GraphicsAssetLibraryHealth>('/api/admin/graphics-assets/health', {
			headers: administratorHeaders,
		});

		expect(health.status).toBe('healthy');
		expect(health.catalogue).toEqual({ status: 'healthy' });
		expect(health.byteStores).toEqual({
			staging: { status: 'healthy' },
			canonical: { status: 'healthy' },
		});
		expect(new Date(health.checkedAt).toISOString()).toBe(health.checkedAt);
	});
});

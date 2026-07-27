import type { GraphicsAssetLibraryHealth } from '~~/shared/types/graphicsAsset';
import { $fetch } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('the Graphics Asset Library health API', () => {
	it('reports the migrated D1 catalogue and both private local byte stores separately', async () => {
		const health = await $fetch<GraphicsAssetLibraryHealth>('/api/admin/graphics-assets/health');

		expect(health.status).toBe('healthy');
		expect(health.catalogue).toEqual({ status: 'healthy' });
		expect(health.byteStores).toEqual({
			staging: { status: 'healthy' },
			canonical: { status: 'healthy' },
		});
		expect(new Date(health.checkedAt).toISOString()).toBe(health.checkedAt);
	});
});

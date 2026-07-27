import { describe, expect, it, vi } from 'vitest';
import {
	createGraphicsAssetLibrary,
	graphicAssetId,
	graphicAssetRevisionId,
	graphicsIngestionOperationId,
} from '~~/server/modules/graphics-asset-library';

describe('the Graphics Asset Library public module', () => {
	it('reports catalogue, staging, and canonical health as separate domain results', async () => {
		const catalogue = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const staging = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const canonical = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const library = createGraphicsAssetLibrary({
			catalogue,
			staging,
			canonical,
			now: () => new Date('2026-07-27T04:00:00.000Z'),
		});

		await expect(library.getHealth()).resolves.toEqual({
			status: 'healthy',
			checkedAt: '2026-07-27T04:00:00.000Z',
			catalogue: { status: 'healthy' },
			byteStores: {
				staging: { status: 'healthy' },
				canonical: { status: 'healthy' },
			},
		});
		expect(catalogue.checkHealth).toHaveBeenCalledOnce();
		expect(staging.checkHealth).toHaveBeenCalledOnce();
		expect(canonical.checkHealth).toHaveBeenCalledOnce();
	});

	it('keeps checking every component and returns retryable structured degradation', async () => {
		const catalogue = { checkHealth: vi.fn().mockRejectedValue(new Error('D1 unavailable')) };
		const staging = {
			checkHealth: vi.fn().mockResolvedValue({
				outcome: 'unavailable',
				reason: { code: 'transient-object-store-failure', retryable: true },
			}),
		};
		const canonical = { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) };
		const library = createGraphicsAssetLibrary({
			catalogue,
			staging,
			canonical,
			now: () => new Date('2026-07-27T04:00:00.000Z'),
		});

		await expect(library.getHealth()).resolves.toEqual({
			status: 'degraded',
			checkedAt: '2026-07-27T04:00:00.000Z',
			catalogue: {
				status: 'unavailable',
				reason: { code: 'catalogue-unavailable', retryable: true },
			},
			byteStores: {
				staging: {
					status: 'unavailable',
					reason: { code: 'byte-store-unavailable', retryable: true },
				},
				canonical: { status: 'healthy' },
			},
		});
		expect(canonical.checkHealth).toHaveBeenCalledOnce();
	});

	it('constructs opaque Graphic Asset domain identities at the boundary', () => {
		expect(graphicAssetId('asset-1')).toBe('asset-1');
		expect(graphicAssetRevisionId('revision-1')).toBe('revision-1');
		expect(graphicsIngestionOperationId('operation-1')).toBe('operation-1');
		expect(() => graphicAssetId('')).toThrow('Graphic Asset identity cannot be empty');
	});
});

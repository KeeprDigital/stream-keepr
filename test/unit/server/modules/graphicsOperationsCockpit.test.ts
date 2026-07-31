import { describe, expect, it, vi } from 'vitest';
import { createGraphicsAssetLibrary } from '~~/server/modules/graphics-asset-library';

describe('the Operations Cockpit reading', () => {
	it('still answers whether the library is safe when the catalogue cannot answer', async () => {
		const library = createGraphicsAssetLibrary({
			catalogue: { checkHealth: vi.fn().mockRejectedValue(new Error('D1 unavailable')) },
			staging: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
			canonical: { checkHealth: vi.fn().mockResolvedValue({ outcome: 'healthy' }) },
			now: () => new Date('2026-07-30T09:00:00.000Z'),
		});

		const cockpit = await library.getOperationsCockpit();

		expect(cockpit).toEqual({
			outcome: 'catalogue-unavailable',
			checkedAt: '2026-07-30T09:00:00.000Z',
			condition: {
				status: 'unavailable',
				catalogue: {
					status: 'unavailable',
					reason: { code: 'catalogue-unavailable', retryable: true },
				},
				canonicalByteStore: { status: 'healthy' },
				stagingByteStore: { status: 'healthy' },
			},
			alerts: {
				countsBySeverity: { critical: 1, warning: 0, info: 0 },
				open: [
					{
						code: 'catalogue-unavailable',
						severity: 'critical',
						openCount: 1,
						persistent: false,
					},
				],
			},
		});
	});
});

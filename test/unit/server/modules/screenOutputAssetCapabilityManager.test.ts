import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreenOutputAssetCapabilityManager } from '~~/server/modules/screen-output-assets/manager';

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('screen Output Asset Capability lifecycle', () => {
	const findById = vi.fn();
	const replaceAssetCapability = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		findById.mockResolvedValue({
			id: 17,
			eventId: 3,
			assetCapabilitySeed: 'seed-1',
			assetCapabilityVersion: 1,
		});
		replaceAssetCapability.mockImplementation(async (
			_screenId,
			_eventId,
			replacement,
		) => ({
			id: 17,
			eventId: 3,
			...replacement,
		}));
	});

	function manager() {
		return createScreenOutputAssetCapabilityManager({
			signingKey,
			screens: { findById, replaceAssetCapability },
			generateSeed: () => 'seed-2',
		});
	}

	it('prepares one capability for atomic storage with a newly created Screen', async () => {
		const prepared = await manager().prepare();

		expect(prepared.capability).toMatch(/^[\w-]{43}$/);
		expect(prepared.persisted).toEqual({
			assetCapabilitySeed: 'seed-2',
			assetCapabilityVersion: 1,
			assetCapabilityDigest: expect.stringMatching(/^[\da-f]{64}$/),
		});
		expect(prepared.persisted.assetCapabilityDigest).not.toContain(prepared.capability);
	});

	it('re-derives the current capability without storing or exposing it on the Screen response', async () => {
		const result = await manager().current({ eventId: 3, screenId: 17 });

		expect(result).toEqual({
			outcome: 'available',
			capability: expect.stringMatching(/^[\w-]{43}$/),
		});
		expect(replaceAssetCapability).not.toHaveBeenCalled();
	});

	it('rotates to a new seed and digest so every prior capability is revoked', async () => {
		const previous = await manager().current({ eventId: 3, screenId: 17 });
		const rotated = await manager().rotate({ eventId: 3, screenId: 17 });

		expect(rotated.outcome).toBe('available');
		if (previous.outcome !== 'available' || rotated.outcome !== 'available')
			return;
		expect(rotated.capability).not.toBe(previous.capability);
		expect(replaceAssetCapability).toHaveBeenCalledWith(
			17,
			3,
			{
				assetCapabilitySeed: 'seed-2',
				assetCapabilityVersion: 2,
				assetCapabilityDigest: expect.stringMatching(/^[\da-f]{64}$/),
			},
			1,
		);
	});

	it('returns a non-retryable missing outcome after the Screen is deleted', async () => {
		findById.mockResolvedValue(undefined);

		await expect(manager().current({ eventId: 3, screenId: 17 }))
			.resolves
			.toEqual({ outcome: 'missing' });
		await expect(manager().rotate({ eventId: 3, screenId: 17 }))
			.resolves
			.toEqual({ outcome: 'missing' });
	});
});

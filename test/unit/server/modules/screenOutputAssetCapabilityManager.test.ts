import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseScreenOutputLink } from '~~/server/modules/screen-output-assets/link';
import { createScreenOutputAssetCapabilityManager } from '~~/server/modules/screen-output-assets/manager';

const signingKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

describe('screen Output Asset Capability lifecycle', () => {
	const findById = vi.fn();
	const findByIdInAnyEvent = vi.fn();
	const replaceAssetCapability = vi.fn();
	const stored = {
		id: 17,
		eventId: 3,
		assetCapabilitySeed: 'seed-1',
		assetCapabilityVersion: 1,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(stored, { assetCapabilitySeed: 'seed-1', assetCapabilityVersion: 1 });
		findById.mockResolvedValue(stored);
		findByIdInAnyEvent.mockImplementation(async (screenId: number) => screenId === stored.id
			? stored
			: undefined);
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
			screens: { findById, findByIdInAnyEvent, replaceAssetCapability },
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
			link: expect.any(String),
		});
		expect(replaceAssetCapability).not.toHaveBeenCalled();
	});

	it('answers the Screen Output Link beside the capability, naming its Screen', async () => {
		const result = await manager().current({ eventId: 3, screenId: 17 });

		expect(result.outcome).toBe('available');
		if (result.outcome !== 'available')
			return;
		expect(parseScreenOutputLink(result.link)).toEqual({ screenId: 17 });
	});

	it('exchanges the current link for the capability current() answers, and the Screen it is for', async () => {
		const current = await manager().current({ eventId: 3, screenId: 17 });
		if (current.outcome !== 'available')
			throw new Error('expected a current capability');

		await expect(manager().exchange({ link: current.link })).resolves.toEqual({
			outcome: 'available',
			eventId: 3,
			screenId: 17,
			capability: current.capability,
		});
	});

	// Regenerating the capability regenerates the link: the old one dies with the old capability.
	it('rotates the link with the capability, and stops exchanging the one it replaced', async () => {
		const previous = await manager().current({ eventId: 3, screenId: 17 });
		const rotated = await manager().rotate({ eventId: 3, screenId: 17 });
		if (previous.outcome !== 'available' || rotated.outcome !== 'available')
			throw new Error('expected a capability before and after');
		Object.assign(stored, { assetCapabilitySeed: 'seed-2', assetCapabilityVersion: 2 });

		expect(rotated.link).not.toBe(previous.link);
		await expect(manager().exchange({ link: previous.link })).resolves.toEqual({ outcome: 'missing' });
		await expect(manager().exchange({ link: rotated.link })).resolves.toEqual({
			outcome: 'available',
			eventId: 3,
			screenId: 17,
			capability: rotated.capability,
		});
	});

	it.each<[string, (capability: string) => unknown]>([
		[
			'a value that is not a link',
			() => 'not a link',
		],
		[
			'the capability itself',
			capability => capability,
		],
		[
			'no value',
			() => undefined,
		],
	])('exchanges nothing for %s, without reading a Screen', async (_what, presented) => {
		const current = await manager().current({ eventId: 3, screenId: 17 });
		if (current.outcome !== 'available')
			throw new Error('expected a current capability');

		await expect(manager().exchange({
			link: presented(current.capability),
		}))
			.resolves
			.toEqual({ outcome: 'missing' });
		expect(findByIdInAnyEvent).not.toHaveBeenCalled();
	});

	// Timing must not say whether the Screen exists: both refusals sign once.
	it('refuses a deleted Screen\'s link after the same signing work as a wrong one', async () => {
		const current = await manager().current({ eventId: 3, screenId: 17 });
		if (current.outcome !== 'available')
			throw new Error('expected a current capability');
		const wrong = `${current.link.slice(0, -1)}${current.link.endsWith('2')
			? '3'
			: '2'}`;
		const sign = vi.spyOn(crypto.subtle, 'sign');

		await expect(manager().exchange({ link: wrong })).resolves.toEqual({ outcome: 'missing' });
		const signedForWrongLink = sign.mock.calls.length;
		findByIdInAnyEvent.mockResolvedValue(undefined);
		await expect(manager().exchange({ link: current.link })).resolves.toEqual({ outcome: 'missing' });

		expect(signedForWrongLink).toBe(1);
		expect(sign.mock.calls.length - signedForWrongLink).toBe(1);
		sign.mockRestore();
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

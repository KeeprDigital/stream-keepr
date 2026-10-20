import type { ConsumedEventData } from '~/modules/event-data/resync';
import { describe, expect, it, vi } from 'vitest';
import { createEventDataResync } from '~/modules/event-data/resync';

/**
 * Event Data Resync: a consumer names the Event Data it reads, and coming back
 * from a disconnection re-reads exactly that — once per dataset however many
 * consumers share it. What nobody consumed then is behind, and is re-read when
 * a consumer next names it.
 */

function harness() {
	const reloaders = {
		event: vi.fn(),
		players: vi.fn(),
		phases: vi.fn(),
		rounds: vi.fn(),
		matches: vi.fn(),
		featureMatchSlots: vi.fn(),
		archetypes: vi.fn(),
		playerLists: vi.fn(),
		playerDecks: vi.fn(),
		screens: vi.fn(),
		card: vi.fn(),
	} satisfies Record<ConsumedEventData, () => unknown>;
	const resync = createEventDataResync(reloaders);
	const reloaded = () => (Object.keys(reloaders) as ConsumedEventData[])
		.filter(dataset => reloaders[dataset].mock.calls.length > 0)
		.sort();
	const clear = () => Object.values(reloaders).forEach(reload => reload.mockClear());
	return { reloaders, resync, reloaded, clear };
}

describe('createEventDataResync', () => {
	it('re-reads what is consumed, once per dataset, and nothing else', async () => {
		const { resync, reloaders, reloaded } = harness();
		resync.consume(['players', 'rounds']);
		resync.consume(['players', 'card']);

		await resync.resync();

		expect(reloaded()).toEqual(['card', 'players', 'rounds']);
		expect(reloaders.players).toHaveBeenCalledOnce();
	});

	it('stops re-reading what a disposed consumer alone named', async () => {
		const { resync, reloaded } = harness();
		const releasePage = resync.consume(['players', 'rounds']);
		resync.consume(['players']);

		releasePage();
		// A second release must not take another consumer's claim with it.
		releasePage();
		await resync.resync();

		expect(reloaded()).toEqual(['players']);
	});

	it('re-reads a dataset nobody consumed at the resync once a consumer next names it', async () => {
		const { resync, reloaders, reloaded, clear } = harness();
		resync.consume(['card']);
		await resync.resync();
		clear();

		resync.consume(['players', 'card']);
		expect(reloaded()).toEqual(['players']);

		// Caught up: the next consumer of it reads what is held.
		resync.consume(['players']);
		expect(reloaders.players).toHaveBeenCalledOnce();
	});

	it('forgets what was behind when an Event Lifetime ends', async () => {
		const { resync, reloaded, clear } = harness();
		await resync.resync();
		clear();

		resync.reset();
		resync.consume(['players']);

		expect(reloaded()).toEqual([]);
	});

	it('keeps re-reading the rest when one re-read fails, and leaves the failed ones behind', async () => {
		const { resync, reloaders, reloaded, clear } = harness();
		reloaders.players.mockRejectedValue(new Error('offline'));
		reloaders.phases.mockResolvedValue(false);
		resync.consume(['players', 'phases', 'rounds']);

		await expect(resync.resync()).resolves.toBeUndefined();
		expect(reloaders.rounds).toHaveBeenCalledOnce();
		clear();

		resync.consume(['players', 'phases', 'rounds']);
		expect(reloaded()).toEqual(['phases', 'players']);
	});

	it('marks nothing behind in the next Event Lifetime from a re-read the last one began', async () => {
		const { resync, reloaders, reloaded, clear } = harness();
		let fail!: (cause: Error) => void;
		reloaders.players.mockReturnValue(new Promise((_, reject) => {
			fail = reject;
		}));
		resync.consume(['players']);
		const inFlight = resync.resync();

		resync.reset();
		fail(new Error('offline'));
		await inFlight;
		clear();

		resync.consume(['players']);
		expect(reloaded()).toEqual([]);
	});
});

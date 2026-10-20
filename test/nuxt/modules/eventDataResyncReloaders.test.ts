import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { storeReloaders } from '~/modules/event-data/resync';

/**
 * How Event Data Resync re-reads each dataset through this client's stores: in
 * place, only what a store already holds, and in the scope it holds it.
 */

const stores = vi.hoisted(() => ({
	event: {} as Record<string, unknown>,
	player: {} as Record<string, unknown>,
	round: {} as Record<string, unknown>,
	match: {} as Record<string, unknown>,
	card: {} as Record<string, unknown>,
}));

mockNuxtImport('useEventStore', () => () => stores.event);
mockNuxtImport('usePlayerStore', () => () => stores.player);
mockNuxtImport('useRoundStore', () => () => stores.round);
mockNuxtImport('useMatchStore', () => () => stores.match);
mockNuxtImport('useCardStore', () => () => stores.card);

describe('storeReloaders', () => {
	beforeEach(() => {
		stores.event = reactive({ eventId: 12, event: { id: 12 }, loadEvent: vi.fn(async () => ({ id: 12 })) });
		stores.player = reactive({ isLoaded: true, loadPlayersByEventId: vi.fn(async () => []) });
		stores.round = reactive({ isLoaded: true, rounds: [{ id: 3 }], loadRoundsByEventId: vi.fn(async () => []) });
		stores.match = reactive({
			isLoaded: true,
			loadedRoundId: 3 as number | null,
			loadMatchesByRoundId: vi.fn(async () => []),
			loadMatchesByEventId: vi.fn(async () => []),
		});
		stores.card = reactive({ activeScreenId: 5 as number | null, setActiveScreen: vi.fn(), loadActiveCard: vi.fn(async () => null) });
	});

	it('re-reads a held collection for the current Event, and leaves one nothing loaded', async () => {
		stores.round.isLoaded = false;
		const reload = storeReloaders();

		await expect(reload.players()).resolves.toBe(true);
		await reload.rounds();

		expect(stores.player.loadPlayersByEventId).toHaveBeenCalledWith(12);
		expect(stores.round.loadRoundsByEventId).not.toHaveBeenCalled();
	});

	it('reports a collection re-read that did not land', async () => {
		(stores.player.loadPlayersByEventId as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		await expect(storeReloaders().players()).resolves.toBe(false);
	});

	it('re-reads Matches in the Round scope the store holds', async () => {
		await storeReloaders().matches();

		expect(stores.match.loadMatchesByRoundId).toHaveBeenCalledWith(12, 3);
		expect(stores.match.loadMatchesByEventId).not.toHaveBeenCalled();
	});

	it('re-reads the selected Screen\'s Card without deselecting the Screen', async () => {
		await storeReloaders().card();

		expect(stores.card.loadActiveCard).toHaveBeenCalledOnce();
		expect(stores.card.setActiveScreen).not.toHaveBeenCalled();
	});

	it('reads no Card while no Screen is selected', async () => {
		stores.card.activeScreenId = null;

		await storeReloaders().card();

		expect(stores.card.loadActiveCard).not.toHaveBeenCalled();
	});

	it('re-reads the operator\'s Event, and none on a rendering of a Screen, which holds no Event', async () => {
		await storeReloaders().event();
		expect(stores.event.loadEvent).toHaveBeenCalledWith(12);

		vi.clearAllMocks();
		stores.event.event = null;
		await storeReloaders().event();
		expect(stores.event.loadEvent).not.toHaveBeenCalled();
	});
});

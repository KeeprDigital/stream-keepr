import type { Player } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockPlayer } from '~~/test/helpers/fixtures';
import { eventDataResync } from '~/modules/event-data/resync';

/*
 * How a page's load ends, over the real Event and Player stores. Faked: `$fetch`,
 * the network the Players are read through.
 */

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const readFirst = createMockPlayer({ id: 1, eventId: 1, name: 'Read first' }) as Player;
const readSince = createMockPlayer({ id: 2, eventId: 1, name: 'Read since' }) as Player;

/** A page that shows the Event's Players, mounted in a scope that ends with the test. */
let pageScope = effectScope();
function usePlayersPage(afterLoad?: (eventId: number) => Promise<void>) {
	const playerStore = usePlayerStore();
	return pageScope.run(() => useEventPageLoading([
		{
			consumes: 'players',
			isLoaded: () => playerStore.isLoaded,
			isLoading: () => playerStore.loading,
			load: id => playerStore.loadPlayersByEventId(id, { failure: 'raise' }),
		},
	], afterLoad))!;
}

function heldPlayers() {
	return usePlayerStore().players.map(player => player.name);
}

describe('useEventPageLoading, by how its load ends', () => {
	beforeEach(() => {
		pageScope = effectScope();
		usePlayerStore().$reset();
		useEventStore().$reset();
		useEventStore().setEvent({
			...createMockEvent({ id: 1 }),
			talents: [],
			meleeConfigured: false,
		} as never);
	});

	afterEach(() => {
		pageScope.stop();
		eventDataResync.reset();
	});

	describe('a load a newer load of the same collection superseded', () => {
		/** The page's read and the newer one, as a realtime reload starts it, both held pending. */
		async function supersedePageLoad(afterLoad?: (eventId: number) => Promise<void>) {
			const pageRead = deferred<Player[]>();
			const newerRead = deferred<Player[]>();
			mockFetch
				.mockReturnValueOnce(pageRead.promise)
				.mockReturnValueOnce(newerRead.promise);
			const page = usePlayersPage(afterLoad);
			await flushPromises();
			const newerLoad = usePlayerStore().loadPlayersByEventId(1);
			return { page, pageRead, newerRead, newerLoad };
		}

		it('keeps the page loading, with no error, until the newer load lands, and ends on its data', async () => {
			let heldAfterLoad: string[] | null = null;
			const { page, pageRead, newerRead, newerLoad } = await supersedePageLoad(async () => {
				heldAfterLoad = heldPlayers();
			});

			pageRead.resolve([readFirst]);
			await flushPromises();

			expect(page.initialError.value).toBeNull();
			expect(page.initialLoading.value).toBe(true);
			expect(heldAfterLoad).toBeNull();

			newerRead.resolve([readSince]);
			await newerLoad;
			await flushPromises();

			expect(page.initialError.value).toBeNull();
			expect(page.initialLoading.value).toBe(false);
			expect(heldPlayers()).toEqual(['Read since']);
			expect(heldAfterLoad).toEqual(['Read since']);
		});

		it('shows the error once the newer load fails, since nothing is left to fill the page', async () => {
			const { page, pageRead, newerRead, newerLoad } = await supersedePageLoad();

			pageRead.resolve([readFirst]);
			await flushPromises();
			expect(page.initialError.value).toBeNull();

			newerRead.reject(new Error('players offline'));
			await newerLoad;
			await flushPromises();

			expect(page.initialError.value).toBe('Unable to load this page');
			expect(page.initialLoading.value).toBe(false);
		});
	});

	it('shows a failed load as an error the operator can retry', async () => {
		mockFetch.mockRejectedValueOnce(new Error('players offline'));
		const page = usePlayersPage();
		await flushPromises();

		expect(page.initialError.value).toBe('Unable to load this page');
		expect(page.initialLoading.value).toBe(false);

		mockFetch.mockResolvedValueOnce([readSince]);
		await page.retry();

		expect(page.initialError.value).toBeNull();
		expect(page.initialLoading.value).toBe(false);
		expect(heldPlayers()).toEqual(['Read since']);
	});
});

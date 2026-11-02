import type { OpCardDetail, OpCardSummary } from '~~/shared/types/card/op';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';

// Card Spotlight on a One Piece Card Game Event. The server's `op-cards` routes are
// faked at `$fetch`; the Card save is the Card repository's, whose request is the contract.

const { mockFetch, mockSaveScreenCard, serverNow } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
	mockSaveScreenCard: vi.fn(),
	serverNow: { value: 1_790_000_000_000 },
}));
mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => serverNow.value,
}));

let revision = 0;
mockNuxtImport('useCardRepository', () => () => ({
	saveScreenCard: async (...args: unknown[]) => {
		await mockSaveScreenCard(...args);
		return { success: true, revision: ++revision };
	},
	getScreenCard: async () => ({ card: null, revision }),
	deleteScreenCard: async () => ({ success: true, revision: ++revision }),
}));

const mockEventStoreState = {
	eventId: 1 as number | null,
	event: { id: 1, game: 'op', cardTimeout: 0 } as any,
};
mockNuxtImport('useEventStore', () => () => mockEventStoreState);

const zoro: OpCardSummary = {
	number: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
	cost: null,
	life: 5,
	power: 5000,
	counter: null,
	types: ['Supernovas'],
	effect: null,
	trigger: null,
	printingId: 'OP01-001',
	imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
};
const zoroDetail: OpCardDetail = {
	...zoro,
	printings: [
		{
			id: 'OP01-001',
			setId: 'OP-01',
			kind: 'standard',
			rarity: 'L',
			imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		},
		{
			id: 'OP01-001_p1',
			setId: 'OP-01',
			kind: 'alt-art',
			rarity: 'L',
			imageUrl: 'https://cards-img.keepr.digital/OP01-001_p1.png',
		},
	],
};
const luffy: OpCardSummary = {
	...zoro,
	number: 'OP01-024',
	name: 'Monkey.D.Luffy',
	category: 'character',
	printingId: 'OP01-024',
	imageUrl: 'https://cards-img.keepr.digital/OP01-024.png',
};
const luffyDetail: OpCardDetail = {
	...luffy,
	printings: [
		{
			id: 'OP01-024',
			setId: 'OP-01',
			kind: 'standard',
			rarity: 'SR',
			imageUrl: 'https://cards-img.keepr.digital/OP01-024.png',
		},
	],
};

/** The server's `op-cards` routes, configured with bandai-keepr. */
function server(path: string) {
	if (path === '/api/events/1/op-cards') {
		return {
			available: true,
			items: [zoro, luffy],
			total: 2,
		};
	}
	if (path === '/api/events/1/op-cards/OP01-001')
		return { available: true, card: zoroDetail };
	if (path === '/api/events/1/op-cards/OP01-024')
		return { available: true, card: luffyDetail };
	throw new Error(`unrouted ${path}`);
}

describe('card store on a One Piece Event', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		mockFetch.mockReset();
		mockFetch.mockImplementation(async (path: string) => server(path));
		mockSaveScreenCard.mockReset();
		mockEventStoreState.event = { id: 1, game: 'op', cardTimeout: 0 };
		store = useCardStore();
		store.$reset();
		store.clearOpHistory();
		store.setActiveScreen(5);
	});

	afterEach(() => {
		store.$reset();
		vi.useRealTimers();
	});

	describe('searching', () => {
		it.each([
			[
				'name or text',
				{ text: 'zoro' },
				{ q: 'zoro' },
			],
			[
				'a card number, as a number lookup',
				{ text: ' op01-001 ' },
				{ number: 'OP01-001' },
			],
			[
				'colour and category alone',
				{ text: '', color: 'Red', category: 'leader' },
				{ color: 'Red', category: 'leader' },
			],
			[
				'text with colour',
				{ text: 'zoro', color: 'Red' },
				{ q: 'zoro', color: 'Red' },
			],
		] as const)('asks the server by %s and lists what it answers', async (_case, search, query) => {
			await store.searchOpCards(search);

			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/op-cards', expect.objectContaining({ query }));
			expect(store.opSearchResults.map(card => card.number)).toEqual(['OP01-001', 'OP01-024']);
			expect(store.opCardDataAvailable).toBe(true);
		});

		it('says card data is unavailable when the server has no bandai-keepr', async () => {
			mockFetch.mockResolvedValue({ available: false });

			await store.searchOpCards({ text: 'zoro' });

			expect(store.opCardDataAvailable).toBe(false);
			expect(store.opSearchResults).toEqual([]);
		});

		it('lists only the latest search when an earlier one answers last', async () => {
			const first = deferred<unknown>();
			mockFetch.mockImplementationOnce(async () => await first.promise);
			const slow = store.searchOpCards({ text: 'zor' });
			mockFetch.mockResolvedValueOnce({
				available: true,
				items: [luffy],
				total: 1,
			});
			await store.searchOpCards({ text: 'luffy' });

			first.resolve({
				available: true,
				items: [zoro],
				total: 1,
			});
			await slow;

			expect(store.opSearchResults.map(card => card.number)).toEqual(['OP01-024']);
		});
	});

	describe('choosing a Printing and showing it', () => {
		it('previews the Card\'s own Printing, offers every Printing, and shows the alt-art chosen with its Card Timeout', async () => {
			mockEventStoreState.event.cardTimeout = 30;
			await store.selectOpCard(zoro);

			expect(store.opPreviewCard).toMatchObject({ id: 'OP01-001', printingKind: 'standard' });
			expect(store.opPreviewPrintings.map(printing => printing.kind)).toEqual(['standard', 'alt-art']);

			store.selectOpPrinting('OP01-001_p1');
			await store.showOpPreviewCard();

			const shown = {
				game: 'op',
				id: 'OP01-001_p1',
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				set: 'OP-01',
				printingKind: 'alt-art',
				imageUrl: 'https://cards-img.keepr.digital/OP01-001_p1.png',
				timeoutData: { timeoutDuration: 30_000, timeoutStartTimestamp: serverNow.value },
			};
			expect(mockSaveScreenCard).toHaveBeenCalledWith(1, 5, shown);
			expect(store.activeCard).toEqual(shown);
			expect(store.cardsMatch).toBe(true);
		});

		it('hides the shown OP card when its Card Timeout runs out', async () => {
			vi.useFakeTimers();
			serverNow.value = Date.now();
			mockEventStoreState.event.cardTimeout = 10;
			await store.selectOpCard(zoro);
			await store.showOpPreviewCard();

			await vi.advanceTimersByTimeAsync(9_999);
			expect(store.activeCard).toMatchObject({ id: 'OP01-001' });
			await vi.advanceTimersByTimeAsync(1);
			expect(store.activeCard).toBeNull();
		});

		it('shows at once on selection when auto-show is on', async () => {
			store.autoShowSelectedCard = true;

			await store.selectOpCard(luffy);

			expect(mockSaveScreenCard).toHaveBeenCalledWith(1, 5, expect.objectContaining({ id: 'OP01-024' }));
			store.autoShowSelectedCard = false;
		});

		it('takes no flip, rotate or turn-over', async () => {
			await store.selectOpCard(zoro);
			await store.showOpPreviewCard();
			mockSaveScreenCard.mockClear();

			await store.controlActiveCard('flip');
			await store.controlActiveCard('turnOver');

			expect(mockSaveScreenCard).not.toHaveBeenCalled();
		});
	});

	describe('card History', () => {
		it('keeps each Card once, latest first, with the Printing last chosen', async () => {
			await store.selectOpCard(zoro);
			store.selectOpPrinting('OP01-001_p1');
			await store.selectOpCard(luffy);
			await store.selectOpCard(zoro);
			store.selectOpPrinting('OP01-001_p1');

			expect(store.opSelectionHistory.map(card => card.id)).toEqual(['OP01-001_p1', 'OP01-024']);
		});

		it('previews the Printing a History entry holds, offering its Card\'s Printings again', async () => {
			await store.selectOpCard(zoro);
			store.selectOpPrinting('OP01-001_p1');
			await store.selectOpCard(luffy);

			await store.selectOpHistoryCard(store.opSelectionHistory[1]!);

			expect(store.opPreviewCard).toMatchObject({ id: 'OP01-001_p1' });
			expect(store.opPreviewPrintings.map(printing => printing.id)).toEqual(['OP01-001', 'OP01-001_p1']);
		});
	});
});

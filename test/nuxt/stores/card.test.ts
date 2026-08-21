import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── $fetch stub (used by searchFuzzyCardName, searchCardPrints, selectMeldCardPart) ──

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn().mockResolvedValue({ data: [] }) }));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => Date.now(),
}));

// ── Mock Dependencies ──

const mockCardRepo = {
	saveScreenCard: vi.fn(),
	getScreenCard: vi.fn(),
	deleteScreenCard: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

// Mock eventStore — needs to look like a Pinia store with reactive properties
const mockEventStoreState = {
	eventId: 1 as number | null,
	event: { id: 1, cardTimeout: 0 } as any,
};

mockNuxtImport('useCardRepository', () => () => mockCardRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useEventStore', () => () => mockEventStoreState);
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn().mockResolvedValue({ cards: new Map(), degraded: false }),
	buildDeckListArrays: vi.fn().mockReturnValue({ mainboard: [], sideboard: [] }),
}));
const mockFetchDeck = vi.fn().mockResolvedValue(null);
const mockGetCachedDeck = vi.fn().mockReturnValue(null);
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: mockFetchDeck,
	getCachedDeck: mockGetCachedDeck,
}));

const mockPlayerStoreState = reactive({
	players: [] as any[],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
});
mockNuxtImport('usePlayerStore', () => () => mockPlayerStoreState);

const mockFeatureMatchStoreState = reactive({
	featureMatches: [] as any[],
	isLoaded: true,
	loadFeatureMatchesByEventId: vi.fn(),
});
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStoreState);

// Helper: mock MtgCard (matches the full MtgCard shape required by cloneMtgCard)
function createMockMtgCard(overrides?: Record<string, any>) {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: { front: { normal: 'http://example.com/card.jpg' }, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: {
			flipped: false,
			rotated: false,
			turnedOver: false,
			counterRotated: false,
		},
		...overrides,
	} as any;
}

describe('useCardStore', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.card = {
			'card:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'card:preview': data => !(mockIsSelfOrigin as any)(data) && store.applyRemotePreview(data as any),
			'card:cleared': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCleared(data as any),
			'card:timeout': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTimeout(data as any),
			'card:timeout:cancel': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTimeoutCancel(data as any),
		};
		mockEventStoreState.eventId = 1;
		mockEventStoreState.event = { id: 1, cardTimeout: 0 };
	});

	afterEach(() => {
		store.$reset();
		store.timeout.stop();
		vi.useRealTimers();
	});

	// ── Active Screen ──

	describe('setActiveScreen', () => {
		it('sets activeScreenId and resets card state', () => {
			store.activeCard = createMockMtgCard();

			store.setActiveScreen(5);

			expect(store.activeScreenId).toBe(5);
			expect(store.activeCard).toBeNull();
		});
	});

	// ── Load Active Card ──

	describe('loadActiveCard', () => {
		it('loads card for active screen', async () => {
			store.activeScreenId = 5;
			const card = createMockMtgCard();
			mockCardRepo.getScreenCard.mockResolvedValue(card);

			await store.loadActiveCard();

			expect(store.activeCard).toEqual(card);
		});

		it('resets state when no screen selected', async () => {
			store.activeScreenId = null;

			const result = await store.loadActiveCard();

			expect(result).toBeNull();
			expect(store.activeCard).toBeNull();
		});

		it('restores a persisted card timeout after reconnecting', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
			store.activeScreenId = 5;
			const card = createMockMtgCard({
				timeoutData: {
					timeoutStartTimestamp: Date.now() - 2_000,
					timeoutDuration: 5_000,
				},
			});
			mockCardRepo.getScreenCard.mockResolvedValue(card);
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

			await store.loadActiveCard();
			await vi.advanceTimersByTimeAsync(3_000);

			expect(mockCardRepo.deleteScreenCard).toHaveBeenCalledWith(1, 5);
			expect(store.activeCard).toBeNull();
		});

		it('ignores a response for a screen that is no longer active', async () => {
			let resolveCard!: (card: ReturnType<typeof createMockMtgCard>) => void;
			mockCardRepo.getScreenCard.mockReturnValue(new Promise((resolve) => {
				resolveCard = resolve;
			}));
			store.activeScreenId = 5;
			const loading = store.loadActiveCard();

			store.setActiveScreen(6);
			resolveCard(createMockMtgCard());
			await loading;

			expect(store.activeScreenId).toBe(6);
			expect(store.activeCard).toBeNull();
		});
	});

	// ── Save Active Card ──

	describe('saveActiveCard', () => {
		it('saves card and updates state', async () => {
			store.activeScreenId = 5;
			const card = createMockMtgCard();
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);

			await store.saveActiveCard(card);

			expect(store.activeCard).toEqual(card);
			expect(mockCardRepo.saveScreenCard).toHaveBeenCalledWith(1, 5, card);
		});

		it('cancels the previous timer when an untimed card replaces a timed card', async () => {
			vi.useFakeTimers();
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);
			await store.saveActiveCard(createMockMtgCard({
				timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
			}));

			const replacement = createMockMtgCard({ id: 'card-2', name: 'Counterspell' });
			await store.saveActiveCard(replacement);
			await vi.advanceTimersByTimeAsync(1_000);

			expect(store.activeCard).toEqual(replacement);
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		it('clears a card when its timeout elapsed while the save was in flight', async () => {
			vi.useFakeTimers();
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

			await store.saveActiveCard(createMockMtgCard({
				timeoutData: { timeoutStartTimestamp: Date.now() - 2_000, timeoutDuration: 1_000 },
			}));
			await vi.advanceTimersByTimeAsync(0);

			expect(mockCardRepo.deleteScreenCard).toHaveBeenCalledWith(1, 5);
			expect(store.activeCard).toBeNull();
		});
	});

	// ── Failure Reporting ──

	/**
	 * What the Card page shows when a write is refused.
	 *
	 * These rows could not exist before #271. This suite stood a hand-written
	 * `async fn => fn()` in for `useAsyncAction`, which never catches — so no test here
	 * had ever rejected, and the store's whole failure path was unobserved rather than
	 * merely untested (#263's map, #241's discipline). Running the real composable is what
	 * makes them constructible; the fixtures are real `FetchError`s because that is what
	 * `$fetch` rejects with, and a plain object would report 'An error occurred' instead.
	 */
	describe('failure reporting', () => {
		it('reports the sentence the server wrote about a refused load', async () => {
			store.activeScreenId = 5;
			mockCardRepo.getScreenCard.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'Screen is not in Card mode' },
				request: `[GET] "/api/events/1/screens/5/card"`,
			}));

			await store.loadActiveCard();

			expect(store.error).toBe('Screen is not in Card mode');
			expect(store.loading).toBe(false);
		});

		it('reports the sentence the server wrote about a refused save', async () => {
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'Another operator is showing a card on this Screen' },
			}));

			await store.saveActiveCard(createMockMtgCard());

			expect(store.error).toBe('Another operator is showing a card on this Screen');
		});

		/**
		 * The rollback is the reason the substitution belongs inside the action rather than
		 * around the whole call: `onError` must still see a failure, and still put the card
		 * an operator was looking at back on screen.
		 */
		it('rolls the cleared card back and still reports the sentence', async () => {
			store.activeScreenId = 5;
			const card = createMockMtgCard();
			store.activeCard = card;
			mockCardRepo.deleteScreenCard.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'The card timeout has already elapsed' },
			}));

			await store.clearActiveCard();

			expect(store.error).toBe('The card timeout has already elapsed');
			expect(store.activeCard).toEqual(card);
		});

		it('shows the transport line rather than a 5xx body detail', async () => {
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockRejectedValue(transportFailure({
				status: 500,
				body: { message: 'D1_ERROR: no such table: screen_cards' },
				request: `[PUT] "/api/events/1/screens/5/card"`,
			}));

			await store.saveActiveCard(createMockMtgCard());

			expect(store.error).not.toContain('D1_ERROR');
			expect(store.error).toBe('[PUT] "/api/events/1/screens/5/card": 500 Internal Server Error');
		});

		it('reports a rejection that is not an Error as the composable does', async () => {
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockRejectedValue({ message: 'not an Error at all' });

			await store.saveActiveCard(createMockMtgCard());

			expect(store.error).toBe('An error occurred');
		});
	});

	// ── Clear Active Card ──

	describe('clearActiveCard', () => {
		it('clears active card', async () => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

			await store.clearActiveCard();

			expect(store.activeCard).toBeNull();
		});
	});

	// ── Search ──

	describe('clearSearch', () => {
		it('clears search state', () => {
			store.searching = true;
			store.searchResults = [createMockMtgCard()];

			store.clearSearch();

			expect(store.searching).toBe(false);
			expect(store.searchResults).toEqual([]);
		});
	});

	// ── Preview Controls ──

	describe('controlPreviewCard', () => {
		it('flips preview card', async () => {
			store.previewCard = createMockMtgCard();

			await store.controlPreviewCard('flip');

			expect(store.previewCard!.displayData.flipped).toBe(true);
		});

		it('rotates preview card', async () => {
			store.previewCard = createMockMtgCard();

			await store.controlPreviewCard('rotate');

			expect(store.previewCard!.displayData.rotated).toBe(true);
		});

		it('clears preview card', async () => {
			store.previewCard = createMockMtgCard();
			store.showCardControls = true;

			await store.controlPreviewCard('clear');

			expect(store.previewCard).toBeNull();
			expect(store.showCardControls).toBe(false);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('card:updated', () => {
			it('updates active card from remote message', () => {
				store.activeScreenId = 5;
				const card = createMockMtgCard({ name: 'Remote Card' });

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card });

				expect(store.activeCard!.name).toBe('Remote Card');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.activeScreenId = 5;
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: createMockMtgCard() });

				expect(store.activeCard).toBeNull();
			});

			it('skips when screenId does not match', () => {
				store.activeScreenId = 5;

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 99, card: createMockMtgCard() });

				expect(store.activeCard).toBeNull();
			});

			it('schedules expiry from the durable card data', async () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);
				const card = createMockMtgCard({
					timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
				});

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card });
				await vi.advanceTimersByTimeAsync(1_000);

				expect(mockCardRepo.deleteScreenCard).toHaveBeenCalledWith(1, 5);
				expect(store.activeCard).toBeNull();
			});

			it('cancels the prior expiry when a remote update clears the card', async () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);
				ablyCallbacks.card!['card:updated']!({
					eventId: 1,
					screenId: 5,
					card: createMockMtgCard({
						timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
					}),
				});

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: null });
				await vi.advanceTimersByTimeAsync(1_000);

				expect(store.activeCard).toBeNull();
				expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			});
		});

		describe('card:timeout', () => {
			it('uses the absolute expiry instead of extending a delayed message', async () => {
				vi.useFakeTimers();
				vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
				store.activeScreenId = 5;
				store.activeCard = createMockMtgCard();
				mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

				ablyCallbacks.card!['card:timeout']!({
					eventId: 1,
					screenId: 5,
					timeoutDuration: 60_000,
					expiresAt: Date.now() + 1_000,
				});
				await vi.advanceTimersByTimeAsync(1_000);

				expect(mockCardRepo.deleteScreenCard).toHaveBeenCalledWith(1, 5);
			});
		});

		describe('card:cleared', () => {
			it('clears active card from remote message', () => {
				store.activeScreenId = 5;
				store.activeCard = createMockMtgCard();

				ablyCallbacks.card!['card:cleared']!({ eventId: 1, screenId: 5 });

				expect(store.activeCard).toBeNull();
			});
		});

		describe('card:preview', () => {
			it('sets preview card from remote message', () => {
				store.activeScreenId = 5;
				const card = createMockMtgCard({ name: 'Preview Card' });

				ablyCallbacks.card!['card:preview']!({ eventId: 1, screenId: 5, card });

				expect(store.previewCard!.name).toBe('Preview Card');
				expect(store.showCardControls).toBe(true);
			});
		});
	});

	// ── Computed ──

	describe('cardsMatch', () => {
		it('returns true when active and preview cards are identical', () => {
			const card = createMockMtgCard();
			store.activeCard = card;
			store.previewCard = { ...card };

			expect(store.cardsMatch).toBe(true);
		});

		it('returns false when display data differs', () => {
			store.activeCard = createMockMtgCard();
			store.previewCard = createMockMtgCard({ displayData: { flipped: true, rotated: false, turnedOver: false, counterRotated: false } });

			expect(store.cardsMatch).toBe(false);
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.activeCard = createMockMtgCard();
			store.previewCard = createMockMtgCard();
			store.activeScreenId = 5;
			store.cardPageMode = 'match-decklist';
			store.deckListRoundId = 12;
			store.deckListMatchId = 34;
			store.searchResults = [createMockMtgCard()];
			store.error = 'some error';

			store.$reset();

			expect(store.activeCard).toBeNull();
			expect(store.previewCard).toBeNull();
			expect(store.activeScreenId).toBeNull();
			expect(store.cardPageMode).toBe('search');
			expect(store.deckListRoundId).toBeNull();
			expect(store.deckListMatchId).toBeNull();
			expect(store.searchResults).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.showCardControls).toBe(false);
		});

		it('clears player deck state', () => {
			store.playerDeckPlayerId = 42;
			store.playerDeckData = { playerName: 'Alice', deckList: null, mainboard: [], sideboard: [] } as any;

			store.$reset();

			expect(store.playerDeckPlayerId).toBeNull();
			expect(store.playerDeckData).toBeNull();
			expect(store.loadingPlayerDeck).toBe(false);
		});
	});

	// ── canUsePlayerDeckMode ──
});

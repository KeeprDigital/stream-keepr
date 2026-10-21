import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── $fetch stub (used by searchFuzzyCardName, searchCardPrints, selectMeldCardPart) ──

const { mockFetch, mockGetServerTime } = vi.hoisted(() => ({
	mockFetch: vi.fn().mockResolvedValue({ data: [] }),
	mockGetServerTime: vi.fn(() => Date.now()),
}));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: mockGetServerTime,
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

		// Scenario 4 of #707: the operator Card page hides an expired Card as a rendering
		// does, and asks the server for nothing (ADR-0022).
		it('restores a persisted card timeout after reconnecting and hides the Card at expiry without clearing it', async () => {
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

			await store.loadActiveCard();
			expect(store.timeout.remaining).toBe(3);
			await vi.advanceTimersByTimeAsync(2_999);
			expect(store.activeCard).toEqual(card);
			await vi.advanceTimersByTimeAsync(1);

			expect(store.activeCard).toBeNull();
			expect(store.timeout.remaining).toBe(0);
			expect(mockCardRepo.getScreenCard).toHaveBeenCalledTimes(1);
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		// Scenario 6 of #707: operator A's timer for X fires before B's replacement reaches it.
		it('sends no Clear at expiry, so a replacement it has not heard of yet stands and shows once announced', async () => {
			vi.useFakeTimers();
			store.activeScreenId = 5;
			mockCardRepo.getScreenCard.mockResolvedValue(createMockMtgCard({
				id: 'x',
				timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
			}));
			await store.loadActiveCard();

			await vi.advanceTimersByTimeAsync(1_000);
			expect(store.activeCard).toBeNull();
			ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: createMockMtgCard({ id: 'y' }) });

			expect(store.activeCard?.id).toBe('y');
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		// Characterises #707's trace on main: a rendering's expiry is visible only. The
		// durable clear is left to an operator client's DELETE or the next read's cleanup;
		// ADR-0022's amendment keeps this row and makes the operator path match it.
		it('hides an expired Card on a rendering without asking the server to clear it', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
			store.activeScreenId = 5;
			const card = createMockMtgCard({
				timeoutData: {
					timeoutStartTimestamp: Date.now() - 2_000,
					timeoutDuration: 5_000,
				},
			});
			const outputRead = vi.fn().mockResolvedValue(card);
			const uninstall = store.readActiveCardAsScreenOutput(outputRead);

			await store.loadActiveCard();
			expect(store.activeCard).toEqual(card);
			await vi.advanceTimersByTimeAsync(3_000);

			expect(store.activeCard).toBeNull();
			expect(store.timeout.remaining).toBe(0);
			expect(outputRead).toHaveBeenCalledTimes(1);
			expect(mockCardRepo.getScreenCard).not.toHaveBeenCalled();
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			uninstall();
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

	// ── Card Read Freshness ──

	/**
	 * A Card read applies only while nothing newer has reached the Card store's held
	 * Card (#704). Each row holds a read open, lets something newer land, then answers the
	 * read: the real store must keep the newer state and arm no timer from the late
	 * answer.
	 */
	describe('card read freshness', () => {
		function deferredRead() {
			let resolve!: (card: ReturnType<typeof createMockMtgCard> | null) => void;
			let reject!: (error: unknown) => void;
			mockCardRepo.getScreenCard.mockReturnValueOnce(new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			}));
			return { resolve, reject };
		}

		const oldCard = (overrides?: Record<string, any>) => createMockMtgCard({ id: 'old', name: 'Old Card', ...overrides });
		const newCard = () => createMockMtgCard({ id: 'new', name: 'New Card' });

		it('keeps a newer realtime Card over a read answered after it', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard?.id).toBe('new');
		});

		it('does not restore a Card after a newer realtime clear', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			ablyCallbacks.card!['card:cleared']!({ eventId: 1, screenId: 5 });
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard).toBeNull();
		});

		it('keeps an accepted local save over a read answered after it', async () => {
			store.setActiveScreen(5);
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			await store.saveActiveCard(newCard());
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard?.id).toBe('new');
		});

		it('does not restore a Card after an accepted local clear', async () => {
			store.setActiveScreen(5);
			store.activeCard = oldCard();
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			await store.clearActiveCard();
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard).toBeNull();
		});

		it('drops a read that crossed a Screen selection, even back to the same Screen', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			store.setActiveScreen(6);
			store.setActiveScreen(5);
			read.resolve(oldCard());
			await loading;

			expect(store.activeScreenId).toBe(5);
			expect(store.activeCard).toBeNull();
		});

		it('drops a read that crossed the end of its Event Lifetime, even into the same Event', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			store.$reset();
			store.setActiveScreen(5);
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard).toBeNull();
		});

		it('keeps the newer of two overlapping reads', async () => {
			store.setActiveScreen(5);
			const first = deferredRead();
			const firstLoading = store.loadActiveCard();
			const second = deferredRead();
			const secondLoading = store.loadActiveCard();

			second.resolve(newCard());
			await secondLoading;
			first.resolve(oldCard());
			await firstLoading;

			expect(store.activeCard?.id).toBe('new');
		});

		it('arms no timer from a superseded read', async () => {
			vi.useFakeTimers();
			store.setActiveScreen(5);
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
			read.resolve(oldCard({
				timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
			}));
			await loading;
			await vi.advanceTimersByTimeAsync(1_000);

			expect(store.activeCard?.id).toBe('new');
			expect(store.timeout.isActive).toBe(false);
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		it('holds no Card from a read that answers with a Card which expired while it was out', async () => {
			vi.useFakeTimers();
			store.setActiveScreen(5);
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);
			const timed = oldCard({ timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 } });
			await store.saveActiveCard(timed);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			await vi.advanceTimersByTimeAsync(1_000);
			read.resolve(timed);
			await loading;

			// Not even for a tick: the expired Card is projected away as it lands.
			expect(store.activeCard).toBeNull();
			expect(store.timeout.remaining).toBe(0);
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		it('reports no failure from a superseded read and settles loading once it answers', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
			read.reject(transportFailure({ status: 503, body: { message: 'Unavailable' } }));
			await loading;

			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.activeCard?.id).toBe('new');
		});

		it('keeps loading on for a save still out when a superseded read answers', async () => {
			store.setActiveScreen(5);
			let acceptSave!: () => void;
			mockCardRepo.saveScreenCard.mockReturnValueOnce(new Promise<void>((resolve) => {
				acceptSave = resolve;
			}));
			const read = deferredRead();
			const loading = store.loadActiveCard();
			const saving = store.saveActiveCard(newCard());

			ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
			read.resolve(oldCard());
			await loading;
			expect(store.loading).toBe(true);

			acceptSave();
			await saving;
			expect(store.loading).toBe(false);
		});

		describe('as a Screen Output', () => {
			const mockOutputRead = vi.fn<() => Promise<any>>();
			let uninstall: () => void;

			beforeEach(() => {
				uninstall = store.readActiveCardAsScreenOutput(() => mockOutputRead());
			});

			afterEach(() => uninstall());

			it('keeps a newer realtime Card over its read answered after it', async () => {
				let resolve!: (card: unknown) => void;
				mockOutputRead.mockReturnValueOnce(new Promise((res) => {
					resolve = res;
				}));
				store.setActiveScreen(5);
				const loading = store.loadActiveCard();

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
				resolve(oldCard());
				await loading;

				expect(store.activeCard?.id).toBe('new');
				expect(mockCardRepo.getScreenCard).not.toHaveBeenCalled();
			});

			it('arms no timer from its superseded read', async () => {
				vi.useFakeTimers();
				let resolve!: (card: unknown) => void;
				mockOutputRead.mockReturnValueOnce(new Promise((res) => {
					resolve = res;
				}));
				store.setActiveScreen(5);
				const loading = store.loadActiveCard();

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: newCard() });
				resolve(oldCard({ timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 } }));
				await loading;
				await vi.advanceTimersByTimeAsync(1_000);

				expect(store.activeCard?.id).toBe('new');
				expect(store.timeout.isActive).toBe(false);
			});

			it('still hides its current read\'s Card locally once it expires', async () => {
				vi.useFakeTimers();
				mockOutputRead.mockResolvedValueOnce(createMockMtgCard({
					timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
				}));
				store.setActiveScreen(5);

				await store.loadActiveCard();
				expect(store.activeCard).not.toBeNull();
				expect(store.timeout.isActive).toBe(true);
				await vi.advanceTimersByTimeAsync(1_000);

				// Scenario 4 of #707 for a rendering: no Card, a zero countdown, and no request.
				expect(store.activeCard).toBeNull();
				expect(store.timeout.remaining).toBe(0);
				expect(mockOutputRead).toHaveBeenCalledTimes(1);
				expect(mockCardRepo.getScreenCard).not.toHaveBeenCalled();
				expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			});
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

		// Scenario 10 of #707.
		it('hides a card whose timeout elapsed while the save was in flight, without clearing it', async () => {
			vi.useFakeTimers();
			store.activeScreenId = 5;
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);

			await store.saveActiveCard(createMockMtgCard({
				timeoutData: { timeoutStartTimestamp: Date.now() - 2_000, timeoutDuration: 1_000 },
			}));

			expect(store.activeCard).toBeNull();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
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

		it('rounds the synchronized clock when starting a card timeout', async () => {
			store.activeScreenId = 5;
			store.previewCard = createMockMtgCard();
			mockEventStoreState.event = { id: 1, cardTimeout: 5 };
			mockGetServerTime.mockReturnValueOnce(1_700_000_000_000.5);
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);

			await store.controlPreviewCard('show');

			expect(mockCardRepo.saveScreenCard).toHaveBeenCalledWith(1, 5, expect.objectContaining({
				timeoutData: {
					timeoutDuration: 5_000,
					timeoutStartTimestamp: 1_700_000_000_001,
				},
			}));
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

			it('schedules hiding from the durable card data, and clears nothing', async () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				const card = createMockMtgCard({
					timeoutData: { timeoutStartTimestamp: Date.now(), timeoutDuration: 1_000 },
				});

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card });
				await vi.advanceTimersByTimeAsync(1_000);

				expect(store.activeCard).toBeNull();
				expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			});

			it('uses the absolute expiry instead of extending a delayed message', async () => {
				vi.useFakeTimers();
				vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
				store.activeScreenId = 5;
				// Saved 59 s ago with a 60 s timeout: one second is left, however late this arrives.
				const card = createMockMtgCard({
					timeoutData: { timeoutStartTimestamp: Date.now() - 59_000, timeoutDuration: 60_000 },
				});

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card });
				expect(store.timeout.remaining).toBe(1);
				await vi.advanceTimersByTimeAsync(999);
				expect(store.activeCard).toEqual(card);
				await vi.advanceTimersByTimeAsync(1);

				expect(store.activeCard).toBeNull();
				expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			});

			it('cancels the prior expiry when a remote update clears the card', async () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
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

import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';
import { createEventDataResync, storeReloaders } from '~/modules/event-data/resync';

const { mockFetch, mockGetServerTime } = vi.hoisted(() => ({
	mockFetch: vi.fn().mockResolvedValue({ data: [] }),
	mockGetServerTime: vi.fn(() => Date.now()),
}));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: mockGetServerTime,
}));

const mockCardRepo = {
	saveScreenCard: vi.fn(),
	getScreenCard: vi.fn(),
	deleteScreenCard: vi.fn(),
};

/**
 * The stand-in server's Card revision (#734). Ordering tests answer with explicit
 * revisions; every other answer is treated as current: writes and announcements
 * advance the revision, reads answer the revision the server is at.
 */
let serverRevision = 0;
function hasRevision(answer: unknown): answer is { revision: number } {
	return typeof answer === 'object' && answer !== null && 'revision' in answer;
}
function asWrite(answer: unknown) {
	return hasRevision(answer)
		? answer
		: { success: true, revision: ++serverRevision };
}
function asRead(answer: unknown) {
	return hasRevision(answer)
		? answer
		: { card: answer, revision: serverRevision };
}
function asAnnouncement(data: any) {
	return hasRevision(data)
		? data
		: { ...data, revision: ++serverRevision };
}

const { deliver } = realtimeHandlersFor();

/** A peer's Card message, carrying the next server revision unless it names one. */
function announce(type: 'card:updated' | 'card:cleared', data: any) {
	deliver(type, asAnnouncement(data), { eventId: data.eventId ?? 1 });
}

const mockEventStoreState = {
	eventId: 1 as number | null,
	event: { id: 1, cardTimeout: 0 } as any,
};

mockNuxtImport('useCardRepository', () => () => ({
	saveScreenCard: async (...args: unknown[]) => asWrite(await mockCardRepo.saveScreenCard(...args)),
	getScreenCard: async (...args: unknown[]) => asRead(await mockCardRepo.getScreenCard(...args)),
	deleteScreenCard: async (...args: unknown[]) => asWrite(await mockCardRepo.deleteScreenCard(...args)),
}));
mockNuxtImport('useEventStore', () => () => mockEventStoreState);
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn().mockResolvedValue({
		cards: new Map(),
		degraded: false,
	}),
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
		imageData: {
			front: { normal: 'http://example.com/card.jpg' },
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			turnedOver: false,
			counterRotated: false,
		},
		...overrides,
	} as any;
}

function unavailable() {
	return transportFailure({
		status: 503,
		body: { message: 'Unavailable' },
	});
}

describe('useCardStore', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		serverRevision = 0;
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

			// No Screen holds no Card, and that is what it read.
			expect(result).toBe('landed');
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
				timeoutData: {
					timeoutStartTimestamp: Date.now(),
					timeoutDuration: 1_000,
				},
			}));
			await store.loadActiveCard();

			await vi.advanceTimersByTimeAsync(1_000);
			expect(store.activeCard).toBeNull();
			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: createMockMtgCard({ id: 'y' }),
			});

			expect(store.activeCard?.id).toBe('y');
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		// Scenario 4 of #707 for a rendering: no Card, a zero countdown, and no request.
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
			const uninstall = store.readActiveCardAsScreenOutput(async () => asRead(await outputRead()) as any);

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

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: newCard(),
			});
			read.resolve(oldCard());
			await loading;

			expect(store.activeCard?.id).toBe('new');
		});

		it('does not restore a Card after a newer realtime clear', async () => {
			store.setActiveScreen(5);
			const read = deferredRead();
			const loading = store.loadActiveCard();

			announce('card:cleared', { eventId: 1, screenId: 5 });
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

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: newCard(),
			});
			read.resolve(oldCard({
				timeoutData: {
					timeoutStartTimestamp: Date.now(),
					timeoutDuration: 1_000,
				},
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
			const timed = oldCard({
				timeoutData: {
					timeoutStartTimestamp: Date.now(),
					timeoutDuration: 1_000,
				},
			});
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

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: newCard(),
			});
			read.reject(transportFailure({
				status: 503,
				body: { message: 'Unavailable' },
			}));
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

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: newCard(),
			});
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
				uninstall = store.readActiveCardAsScreenOutput(async () => asRead(await mockOutputRead()) as any);
			});

			afterEach(() => uninstall());

			it('keeps a newer realtime Card over its read answered after it', async () => {
				let resolve!: (card: unknown) => void;
				mockOutputRead.mockReturnValueOnce(new Promise((res) => {
					resolve = res;
				}));
				store.setActiveScreen(5);
				const loading = store.loadActiveCard();

				announce('card:updated', {
					eventId: 1,
					screenId: 5,
					card: newCard(),
				});
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

				announce('card:updated', {
					eventId: 1,
					screenId: 5,
					card: newCard(),
				});
				resolve(oldCard({
					timeoutData: {
						timeoutStartTimestamp: Date.now(),
						timeoutDuration: 1_000,
					},
				}));
				await loading;
				await vi.advanceTimersByTimeAsync(1_000);

				expect(store.activeCard?.id).toBe('new');
				expect(store.timeout.isActive).toBe(false);
			});

			it('still hides its current read\'s Card locally once it expires', async () => {
				vi.useFakeTimers();
				mockOutputRead.mockResolvedValueOnce(createMockMtgCard({
					timeoutData: {
						timeoutStartTimestamp: Date.now(),
						timeoutDuration: 1_000,
					},
				}));
				store.setActiveScreen(5);

				await store.loadActiveCard();
				expect(store.activeCard).not.toBeNull();
				expect(store.timeout.isActive).toBe(true);
				await vi.advanceTimersByTimeAsync(1_000);

				expect(store.activeCard).toBeNull();
				expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
			});
		});
	});

	/**
	 * A Card write's continuation belongs to the Event Lifetime and Screen
	 * selection it began in (ADR-0024), and a failed Clear changes nothing it
	 * holds (#726). Each test holds the write open, moves the store on, then
	 * answers it.
	 */
	describe('card write lifetime', () => {
		const oldCard = () => createMockMtgCard({ id: 'old', name: 'Old Card' });
		const newCard = () => createMockMtgCard({ id: 'new', name: 'New Card' });

		it('drops a save answered after its Event Lifetime ended, even back into the same Event and Screen', async () => {
			store.setActiveScreen(5);
			const save = deferred();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(oldCard());

			// A → B → A: the same Event and Screen ids, loaded afresh.
			store.$reset();
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
			await store.loadActiveCard();
			save.resolve();

			// The caller still hears its write landed.
			await expect(saving).resolves.toEqual(oldCard());
			expect(store.activeCard?.id).toBe('new');
		});

		it('lets a read begun in the next lifetime land over a save from the last', async () => {
			store.setActiveScreen(5);
			const save = deferred();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(oldCard());

			store.$reset();
			store.setActiveScreen(5);
			const read = deferred<ReturnType<typeof newCard>>();
			mockCardRepo.getScreenCard.mockReturnValueOnce(read.promise);
			const loading = store.loadActiveCard();
			save.resolve();
			await saving;
			read.resolve(newCard());
			await loading;

			expect(store.activeCard?.id).toBe('new');
		});

		it('reports no failure from a save whose lifetime ended, and leaves loading to the next lifetime', async () => {
			store.setActiveScreen(5);
			const save = deferred();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(oldCard());

			store.$reset();
			store.setActiveScreen(5);
			const read = deferred<ReturnType<typeof newCard>>();
			mockCardRepo.getScreenCard.mockReturnValueOnce(read.promise);
			const loading = store.loadActiveCard();
			save.reject(transportFailure({
				status: 409,
				body: { message: 'Another operator is showing a card on this Screen' },
			}));
			await saving;

			expect(store.error).toBeNull();
			expect(store.loading).toBe(true);
			read.resolve(newCard());
			await loading;
			expect(store.loading).toBe(false);
		});

		it('drops a clear answered after its Event Lifetime ended, even back into the same Event and Screen', async () => {
			store.setActiveScreen(5);
			store.activeCard = oldCard();
			const clear = deferred();
			mockCardRepo.deleteScreenCard.mockReturnValueOnce(clear.promise);
			const clearing = store.clearActiveCard();

			store.$reset();
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
			await store.loadActiveCard();
			clear.resolve();
			await clearing;

			expect(store.activeCard?.id).toBe('new');
		});

		it('reports no failure from a clear whose lifetime ended', async () => {
			store.setActiveScreen(5);
			store.activeCard = oldCard();
			const clear = deferred();
			mockCardRepo.deleteScreenCard.mockReturnValueOnce(clear.promise);
			const clearing = store.clearActiveCard();

			store.$reset();
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
			await store.loadActiveCard();
			clear.reject(unavailable());
			await clearing;

			expect(store.error).toBeNull();
			expect(store.activeCard?.id).toBe('new');
		});

		it('drops a save that crossed a Screen selection, even back to the same Screen', async () => {
			store.setActiveScreen(5);
			const save = deferred();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(oldCard());

			store.setActiveScreen(6);
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
			await store.loadActiveCard();
			save.resolve();
			await saving;

			expect(store.activeCard?.id).toBe('new');
		});

		it('drops a clear that crossed a Screen selection, even back to the same Screen', async () => {
			store.setActiveScreen(5);
			store.activeCard = oldCard();
			const clear = deferred();
			mockCardRepo.deleteScreenCard.mockReturnValueOnce(clear.promise);
			const clearing = store.clearActiveCard();

			store.setActiveScreen(6);
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
			await store.loadActiveCard();
			clear.resolve();
			await clearing;

			expect(store.activeCard?.id).toBe('new');
		});

		describe('a failed Clear', () => {
			/** Send a Clear and hold its DELETE; the answer fails it. */
			function clearThatFails() {
				const clear = deferred();
				mockCardRepo.deleteScreenCard.mockReturnValueOnce(clear.promise);
				const clearing = store.clearActiveCard();
				return async () => {
					clear.reject(unavailable());
					await clearing;
				};
			}

			beforeEach(() => {
				store.setActiveScreen(5);
				store.activeCard = oldCard();
			});

			it('keeps a realtime Card heard while its DELETE was out', async () => {
				const fail = clearThatFails();

				announce('card:updated', {
					eventId: 1,
					screenId: 5,
					card: newCard(),
				});
				await fail();

				expect(store.activeCard?.id).toBe('new');
				// The operator is still told the Clear failed.
				expect(store.error).toBe('Unavailable');
			});

			it('keeps a realtime clear heard while its DELETE was out', async () => {
				const fail = clearThatFails();

				announce('card:cleared', { eventId: 1, screenId: 5 });
				await fail();

				expect(store.activeCard).toBeNull();
			});

			it('keeps a local save accepted while its DELETE was out', async () => {
				const fail = clearThatFails();

				mockCardRepo.saveScreenCard.mockResolvedValueOnce(undefined);
				await store.saveActiveCard(newCard());
				await fail();

				expect(store.activeCard?.id).toBe('new');
			});

			it('keeps a read landed while its DELETE was out', async () => {
				const fail = clearThatFails();

				mockCardRepo.getScreenCard.mockResolvedValueOnce(newCard());
				await store.loadActiveCard();
				await fail();

				expect(store.activeCard?.id).toBe('new');
			});

			it('keeps a Card hidden once its Card Timeout ran out while the DELETE was out', async () => {
				vi.useFakeTimers();
				mockCardRepo.saveScreenCard.mockResolvedValueOnce(undefined);
				await store.saveActiveCard(createMockMtgCard({
					id: 'timed',
					timeoutData: {
						timeoutStartTimestamp: Date.now(),
						timeoutDuration: 1_000,
					},
				}));
				const fail = clearThatFails();

				await vi.advanceTimersByTimeAsync(1_000);
				await fail();

				expect(store.activeCard).toBeNull();
			});

			it('still holds the Card it began with when nothing newer was accepted', async () => {
				const held = store.activeCard;
				const fail = clearThatFails();

				await fail();

				expect(store.activeCard).toEqual(held);
			});
		});
	});

	/**
	 * The Card revision orders every Card state the store is handed (#734). Each
	 * row hands the real store Card states out of order, each carrying the
	 * revision the server committed it at, and the store must show the newest:
	 * a save, Clear, read or message older than what it holds lands nothing.
	 */
	describe('card revision ordering', () => {
		const committed = (revision: number) => ({ success: true, revision });
		const read = (card: ReturnType<typeof createMockMtgCard> | null, revision: number) => ({ card, revision });
		const updated = (card: ReturnType<typeof createMockMtgCard> | null, revision: number) =>
			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card,
				revision,
			});
		const cleared = (revision: number) => announce('card:cleared', { eventId: 1, screenId: 5, revision });
		const ours = () => createMockMtgCard({ id: 'ours', name: 'Our Card' });
		const theirs = () => createMockMtgCard({ id: 'theirs', name: 'Their Card' });

		beforeEach(() => {
			store.setActiveScreen(5);
		});

		it('keeps a newer card:updated over a save answered after it', async () => {
			const save = deferred<ReturnType<typeof committed>>();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(ours());

			updated(theirs(), 3);
			save.resolve(committed(2));

			// The caller still hears its write landed.
			await expect(saving).resolves.toEqual(ours());
			expect(store.activeCard?.id).toBe('theirs');
		});

		it('keeps a newer card:cleared over a save answered after it', async () => {
			const save = deferred<ReturnType<typeof committed>>();
			mockCardRepo.saveScreenCard.mockReturnValueOnce(save.promise);
			const saving = store.saveActiveCard(ours());

			cleared(3);
			save.resolve(committed(2));
			await saving;

			expect(store.activeCard).toBeNull();
		});

		it('keeps a newer card:updated over a Clear answered after it', async () => {
			mockCardRepo.saveScreenCard.mockResolvedValueOnce(committed(1));
			await store.saveActiveCard(ours());
			const clear = deferred<ReturnType<typeof committed>>();
			mockCardRepo.deleteScreenCard.mockReturnValueOnce(clear.promise);
			const clearing = store.clearActiveCard();

			updated(theirs(), 3);
			clear.resolve(committed(2));
			await clearing;

			expect(store.activeCard?.id).toBe('theirs');
		});

		it('keeps a newer save over a card:updated delivered after it', async () => {
			mockCardRepo.saveScreenCard.mockResolvedValueOnce(committed(5));
			await store.saveActiveCard(ours());

			updated(theirs(), 4);

			expect(store.activeCard?.id).toBe('ours');
		});

		it('keeps a newer save over a card:cleared delivered after it', async () => {
			mockCardRepo.saveScreenCard.mockResolvedValueOnce(committed(5));
			await store.saveActiveCard(ours());

			cleared(4);

			expect(store.activeCard?.id).toBe('ours');
		});

		it('keeps a newer Clear over a card:updated delivered after it', async () => {
			store.activeCard = ours();
			mockCardRepo.deleteScreenCard.mockResolvedValueOnce(committed(5));
			await store.clearActiveCard();

			updated(theirs(), 4);

			expect(store.activeCard).toBeNull();
		});

		it('lands nothing from a read that answers an older revision than the one held', async () => {
			updated(theirs(), 3);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(read(ours(), 2));

			await expect(store.loadActiveCard()).resolves.toBe('superseded');
			expect(store.activeCard?.id).toBe('theirs');
		});

		it('lands a read that answers the revision held', async () => {
			updated(theirs(), 3);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(read(null, 3));

			// The Card held at 3 has expired by the time the read answers it as none.
			await expect(store.loadActiveCard()).resolves.toBe('landed');
			expect(store.activeCard).toBeNull();
		});

		it('applies a newer message over the revision a read landed', async () => {
			mockCardRepo.getScreenCard.mockResolvedValueOnce(read(ours(), 2));
			await store.loadActiveCard();

			updated(theirs(), 3);
			expect(store.activeCard?.id).toBe('theirs');
			cleared(4);
			expect(store.activeCard).toBeNull();
		});

		it('orders a Screen Output read by its revision too', async () => {
			const uninstall = store.readActiveCardAsScreenOutput(async () => read(ours(), 2));
			updated(theirs(), 3);

			await expect(store.loadActiveCard()).resolves.toBe('superseded');
			expect(store.activeCard?.id).toBe('theirs');
			uninstall();
		});

		it('forgets the revision held when another Screen is selected', async () => {
			updated(theirs(), 9);

			store.setActiveScreen(6);
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(read(ours(), 1));

			await expect(store.loadActiveCard()).resolves.toBe('landed');
			expect(store.activeCard?.id).toBe('ours');
		});

		it('forgets the revision held when its Event Lifetime ends', async () => {
			updated(theirs(), 9);

			store.$reset();
			store.setActiveScreen(5);
			updated(ours(), 1);

			expect(store.activeCard?.id).toBe('ours');
		});
	});

	/**
	 * A display control is a save of the held Card with one display field
	 * toggled. It shows at once, but never by mutating the held Card in place,
	 * and a failed save puts back only the field it toggled, and only while
	 * nothing newer has been accepted since (#734).
	 */
	describe('controlActiveCard display controls', () => {
		function deferredSave() {
			let resolve!: (value: unknown) => void;
			let reject!: (error: unknown) => void;
			mockCardRepo.saveScreenCard.mockReturnValueOnce(new Promise((res, rej) => {
				resolve = res;
				reject = rej;
			}));
			return { resolve, reject };
		}

		beforeEach(async () => {
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce({
				card: createMockMtgCard(),
				revision: 1,
			});
			await store.loadActiveCard();
		});

		it('shows the toggle at once, without mutating the held Card in place, and saves it', async () => {
			const held = store.activeCard!;
			const save = deferredSave();

			const controlling = store.controlActiveCard('flip');

			expect(store.activeCard!.displayData.flipped).toBe(true);
			expect(held.displayData.flipped).toBe(false);
			expect(mockCardRepo.saveScreenCard).toHaveBeenCalledWith(1, 5, expect.objectContaining({
				displayData: expect.objectContaining({ flipped: true }),
			}));
			save.resolve({ success: true, revision: 2 });
			await controlling;
			expect(store.activeCard!.displayData.flipped).toBe(true);
		});

		it('puts back the field it toggled when its save fails, and reports the failure', async () => {
			const save = deferredSave();
			const controlling = store.controlActiveCard('rotate');

			save.reject(unavailable());
			await controlling;

			expect(store.activeCard).toEqual(createMockMtgCard());
			expect(store.error).toBe('Unavailable');
		});

		it('puts back only its own field, keeping another control still out', async () => {
			const flip = deferredSave();
			const flipping = store.controlActiveCard('flip');
			const rotate = deferredSave();
			const rotating = store.controlActiveCard('rotate');

			flip.reject(unavailable());
			await flipping;

			expect(store.activeCard!.displayData).toMatchObject({ flipped: false, rotated: true });
			rotate.resolve({ success: true, revision: 2 });
			await rotating;
		});

		it('puts back the value last accepted when two controls of one field both fail, the first first', async () => {
			const first = deferredSave();
			const flipping = store.controlActiveCard('flip');
			const second = deferredSave();
			const unflipping = store.controlActiveCard('flip');

			first.reject(unavailable());
			await flipping;
			second.reject(unavailable());
			await unflipping;

			// The server never held the first control's unsaved `true`.
			expect(store.activeCard!.displayData.flipped).toBe(false);
		});

		it('leaves a field to the later control of it still out when an earlier one fails', async () => {
			const first = deferredSave();
			const flipping = store.controlActiveCard('flip');
			const second = deferredSave();
			const unflipping = store.controlActiveCard('flip');
			const third = deferredSave();
			const reflipping = store.controlActiveCard('flip');

			first.reject(unavailable());
			await flipping;
			expect(store.activeCard!.displayData.flipped).toBe(true);

			second.reject(unavailable());
			third.resolve({ success: true, revision: 2 });
			await Promise.all([unflipping, reflipping]);
			expect(store.activeCard!.displayData.flipped).toBe(true);
		});

		it('puts nothing back over newer state accepted while its save was out', async () => {
			const save = deferredSave();
			const controlling = store.controlActiveCard('flip');

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				revision: 2,
				card: createMockMtgCard({
					id: 'theirs',
					displayData: {
						flipped: true,
						rotated: true,
						turnedOver: false,
						counterRotated: false,
					},
				}),
			});
			save.reject(unavailable());
			await controlling;

			expect(store.activeCard).toMatchObject({
				id: 'theirs',
				displayData: { flipped: true, rotated: true },
			});
		});

		it('puts nothing back once the operator has moved to another Screen', async () => {
			const save = deferredSave();
			const controlling = store.controlActiveCard('flip');

			store.setActiveScreen(6);
			save.reject(unavailable());
			await controlling;

			expect(store.activeCard).toBeNull();
		});
	});

	/**
	 * What the Card's re-read answers Event Data Resync on Reconnect Resync
	 * (ADR-0028): a failed read did not land, so it stays behind; a read of no
	 * Card did land. Over the real store, which is why it is here rather than
	 * beside the other reloaders in `eventDataResyncReloaders.test.ts`.
	 */
	describe('the Card re-read on Reconnect Resync', () => {
		it('reports a failed Card read as not landed', async () => {
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockRejectedValueOnce(unavailable());

			await expect(storeReloaders().card()).resolves.toBe(false);
		});

		it('reports a read of no Card as landed', async () => {
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(null);

			await expect(storeReloaders().card()).resolves.toBe(true);
		});

		it('reports a read of a Card as landed', async () => {
			store.setActiveScreen(5);
			mockCardRepo.getScreenCard.mockResolvedValueOnce(createMockMtgCard());

			await expect(storeReloaders().card()).resolves.toBe(true);
		});

		it('reports a read something newer superseded as not landed', async () => {
			store.setActiveScreen(5);
			let resolve!: (card: unknown) => void;
			mockCardRepo.getScreenCard.mockReturnValueOnce(new Promise((res) => {
				resolve = res;
			}));
			const reread = storeReloaders().card();

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: createMockMtgCard({ id: 'new' }),
			});
			resolve(createMockMtgCard());

			await expect(reread).resolves.toBe(false);
		});

		it('leaves the Card behind after a failed read, so its next consumer re-reads it', async () => {
			store.setActiveScreen(5);
			const resync = createEventDataResync(storeReloaders());
			const release = resync.consume(['card']);
			mockCardRepo.getScreenCard.mockRejectedValueOnce(unavailable());
			await resync.resync();
			release();
			mockCardRepo.getScreenCard.mockResolvedValueOnce(createMockMtgCard({ id: 'caught-up' }));

			resync.consume(['card']);

			await vi.waitFor(() => expect(store.activeCard?.id).toBe('caught-up'));
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
				timeoutData: {
					timeoutStartTimestamp: Date.now(),
					timeoutDuration: 1_000,
				},
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

	describe('failure reporting', () => {
		it('reports the server\'s sentence for a refused load', async () => {
			store.activeScreenId = 5;
			mockCardRepo.getScreenCard.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'Screen is not in Card mode' },
			}));

			await store.loadActiveCard();

			expect(store.error).toBe('Screen is not in Card mode');
			expect(store.loading).toBe(false);
		});

		it('puts the cleared Card back on a refused clear, and reports the server\'s sentence', async () => {
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
	});

	it('clearActiveCard holds no Card once the clear is accepted', async () => {
		store.activeScreenId = 5;
		store.activeCard = createMockMtgCard();
		mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

		await store.clearActiveCard();

		expect(store.activeCard).toBeNull();
	});

	describe('controlPreviewCard', () => {
		it('clearing the preview hides the Card controls', async () => {
			store.previewCard = createMockMtgCard();
			store.showCardControls = true;

			await store.controlPreviewCard('clear');

			expect(store.previewCard).toBeNull();
			expect(store.showCardControls).toBe(false);
		});

		it('showing it starts the Event\'s Card Timeout from the synchronized clock, rounded', async () => {
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

	describe('a peer\'s Card messages', () => {
		it('hold a Card for the active Screen and ignore another Screen\'s', () => {
			store.activeScreenId = 5;

			announce('card:updated', {
				eventId: 1,
				screenId: 99,
				card: createMockMtgCard({ name: 'Elsewhere' }),
			});

			expect(store.activeCard).toBeNull();

			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: createMockMtgCard({ name: 'Remote Card' }),
			});

			expect(store.activeCard!.name).toBe('Remote Card');

			announce('card:cleared', { eventId: 1, screenId: 5 });

			expect(store.activeCard).toBeNull();
		});

		it('hide a timed Card at its absolute expiry, however late the message arrives, and clear nothing', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
			store.activeScreenId = 5;
			// Saved 59 s ago with a 60 s timeout: one second is left.
			const card = createMockMtgCard({
				timeoutData: { timeoutStartTimestamp: Date.now() - 59_000, timeoutDuration: 60_000 },
			});

			announce('card:updated', { eventId: 1, screenId: 5, card });
			expect(store.timeout.remaining).toBe(1);
			await vi.advanceTimersByTimeAsync(999);
			expect(store.activeCard).toEqual(card);
			await vi.advanceTimersByTimeAsync(1);

			expect(store.activeCard).toBeNull();
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		it('cancel the prior expiry when an update clears the Card', async () => {
			vi.useFakeTimers();
			store.activeScreenId = 5;
			announce('card:updated', {
				eventId: 1,
				screenId: 5,
				card: createMockMtgCard({
					timeoutData: {
						timeoutStartTimestamp: Date.now(),
						timeoutDuration: 1_000,
					},
				}),
			});

			announce('card:updated', { eventId: 1, screenId: 5, card: null });
			await vi.advanceTimersByTimeAsync(1_000);

			expect(store.activeCard).toBeNull();
			expect(mockCardRepo.deleteScreenCard).not.toHaveBeenCalled();
		});

		it('show a previewed Card with its controls', () => {
			store.activeScreenId = 5;

			deliver('card:preview', {
				eventId: 1,
				screenId: 5,
				card: createMockMtgCard({ name: 'Preview Card' }),
			} as never);

			expect(store.previewCard!.name).toBe('Preview Card');
			expect(store.showCardControls).toBe(true);
		});
	});

	describe('cardsMatch', () => {
		it('matches a preview identical to the active Card', () => {
			const card = createMockMtgCard();
			store.activeCard = card;
			store.previewCard = { ...card };

			expect(store.cardsMatch).toBe(true);
		});

		it('does not match a preview whose display differs', () => {
			store.activeCard = createMockMtgCard();
			store.previewCard = createMockMtgCard({
				displayData: {
					flipped: true,
					rotated: false,
					turnedOver: false,
					counterRotated: false,
				},
			});

			expect(store.cardsMatch).toBe(false);
		});
	});
});

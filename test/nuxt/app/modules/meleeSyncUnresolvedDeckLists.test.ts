import type { MeleeUnresolvedDeckCardResponse } from '~~/shared/api';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import {
	groupUnresolvedDeckCards,
	useMeleeSyncUnresolvedDeckListResolution,
} from '~~/app/modules/melee-sync/unresolvedDeckLists';
import { callsTo } from '~~/test/helpers/lastCallTo';

/** Where the workflow looks a printed card name up (`unresolvedDeckLists.ts`). */
const SCRYFALL_SEARCH_ENDPOINT = 'https://api.scryfall.com/cards/search';

const mockEventRepo = {
	listUnresolvedDeckCards: vi.fn(),
	resolveUnresolvedDeckCard: vi.fn(),
};
const mockPlayerStore = {
	loadPlayersByEventId: vi.fn(),
};
const mockRunRequest = vi.fn(async (action: () => Promise<unknown>) => await action());
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useRequestFeedback', () => () => ({ runRequest: mockRunRequest }));

function unresolved(overrides: Partial<MeleeUnresolvedDeckCardResponse> = {}): MeleeUnresolvedDeckCardResponse {
	return {
		id: 1,
		eventId: 1,
		playerId: 1,
		playerName: 'Alice',
		deckId: 10,
		formatExternalId: 'modern',
		phaseName: 'Swiss',
		deckName: 'Burn',
		entryType: 'card',
		originalName: 'Lightnng Bolt',
		setCode: 'M11',
		quantity: 4,
		compartment: 'mainboard',
		sortOrder: 0,
		cardType: 'Instant',
		createdAt: new Date('2026-04-09T10:00:00.000Z'),
		updatedAt: new Date('2026-04-09T10:00:00.000Z'),
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function flushAsyncWork() {
	await Promise.resolve();
	await nextTick();
	await Promise.resolve();
}

describe('melee Sync unresolved Deck List module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventRepo.listUnresolvedDeckCards.mockResolvedValue([]);
		mockEventRepo.resolveUnresolvedDeckCard.mockResolvedValue({ success: true, message: 'Resolved card' });
		mockPlayerStore.loadPlayersByEventId.mockResolvedValue(undefined);
		mockRunRequest.mockImplementation(async (action: () => Promise<unknown>) => await action());
		mockFetch.mockResolvedValue({ data: [] });
	});

	it('groups unresolved Deck List entries by normalized name, set, and entry type', () => {
		const groups = groupUnresolvedDeckCards([
			unresolved({ id: 1, playerId: 1, playerName: 'Zed', originalName: 'Lightnng Bolt', setCode: 'M11', sortOrder: 2 }),
			unresolved({ id: 2, playerId: 2, playerName: 'Alice', deckId: 20, originalName: ' lightnng   bolt ', setCode: 'm11', sortOrder: 1 }),
			unresolved({ id: 3, originalName: 'Counterspel', setCode: null }),
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			originalName: 'Lightnng Bolt',
			entryCount: 2,
			affectedPlayerCount: 2,
			affectedDeckCount: 2,
		});
		expect(groups[0]!.entries.map(entry => entry.playerName)).toEqual(['Alice', 'Zed']);
	});

	it('loads unresolved entries and selects the first group', async () => {
		const entries = [unresolved()];
		mockEventRepo.listUnresolvedDeckCards.mockResolvedValue(entries);

		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();

		expect(mockEventRepo.listUnresolvedDeckCards).toHaveBeenCalledWith(1);
		expect(workflow.unresolvedDeckCards.value).toEqual(entries);
		expect(workflow.activeUnresolvedGroup.value?.originalName).toBe('Lightnng Bolt');
		expect(workflow.unresolvedDeckCardsCountLabel.value).toBe('1 unresolved group across 1 entry');
	});

	it('ignores an event load that resolves after the event changes', async () => {
		const firstLoad = deferred<MeleeUnresolvedDeckCardResponse[]>();
		const secondLoad = deferred<MeleeUnresolvedDeckCardResponse[]>();
		mockEventRepo.listUnresolvedDeckCards.mockImplementation((eventId: number) =>
			eventId === 1 ? firstLoad.promise : secondLoad.promise,
		);
		const eventId = ref(1);
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId, isSetupComplete: ref(true) });
		await flushAsyncWork();

		eventId.value = 2;
		await flushAsyncWork();
		const currentEntries = [unresolved({ id: 2, eventId: 2, originalName: 'Current Card' })];
		secondLoad.resolve(currentEntries);
		await flushAsyncWork();
		expect(workflow.unresolvedDeckCards.value).toEqual(currentEntries);

		firstLoad.resolve([unresolved({ id: 1, eventId: 1, originalName: 'Stale Card' })]);
		await flushAsyncWork();
		expect(workflow.unresolvedDeckCards.value).toEqual(currentEntries);
		expect(workflow.unresolvedDeckCardsLoading.value).toBe(false);
	});

	it('exposes an unresolved-card load error instead of reporting an empty resolved list', async () => {
		mockEventRepo.listUnresolvedDeckCards.mockRejectedValueOnce(new Error('Unresolved endpoint unavailable'));
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();

		expect(workflow.unresolvedDeckCards.value).toEqual([]);
		expect(workflow.unresolvedDeckCardsError.value).toBe('Unresolved endpoint unavailable');
		expect(workflow.unresolvedDeckCardsLoading.value).toBe(false);
	});

	it('retains the last confirmed unresolved list when a same-event refresh fails', async () => {
		const entries = [unresolved()];
		mockEventRepo.listUnresolvedDeckCards
			.mockResolvedValueOnce(entries)
			.mockRejectedValueOnce(new Error('Refresh failed'));
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();

		await workflow.loadUnresolvedDeckCards();

		expect(workflow.unresolvedDeckCards.value).toEqual(entries);
		expect(workflow.unresolvedDeckCardsError.value).toBe('Refresh failed');
		expect(workflow.unresolvedDeckCardGroups.value).toHaveLength(1);
	});

	it('keeps the newest Scryfall search result when an older request resolves last', async () => {
		const firstSearch = deferred<{ data: Array<{ id: string; name: string; set: string }> }>();
		const secondSearch = deferred<{ data: Array<{ id: string; name: string; set: string }> }>();
		mockFetch
			.mockImplementationOnce((_url: string, options: { signal: AbortSignal }) => {
				expect(options.signal.aborted).toBe(false);
				return firstSearch.promise;
			})
			.mockImplementationOnce(() => secondSearch.promise);
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();

		workflow.resolveSearchTerm.value = 'first';
		const olderRequest = workflow.searchResolveCandidates();
		workflow.resolveSearchTerm.value = 'second';
		const newerRequest = workflow.searchResolveCandidates();
		// Two searches, counted rather than assumed, and named rather than taken from
		// position 0: this `$fetch` mock stands in for the module's, which `useServerTime`
		// also samples the clock through (#123). A stray at position 0 hands back options
		// with no `signal` on them, and a run that dispatched only one search would read
		// `undefined` here instead of saying so (#273, #280, swept in #342).
		// Both signals, asserted as a list rather than read by position: the older search
		// is abandoned and the newer one is still live, which is the whole of what
		// "keeps the newest" means here. Nothing indexes the call list at all — the count
		// `callsTo` enforces at run time is invisible to the compiler, so a positional read
		// of its result would want a bang under `noUncheckedIndexedAccess` (#342).
		expect(callsTo(mockFetch, 2, SCRYFALL_SEARCH_ENDPOINT)
			.map(([, options]) => options.signal.aborted)).toEqual([true, false]);

		const newestResult = { id: 'new', name: 'Newest', set: 'new' };
		secondSearch.resolve({ data: [newestResult] });
		await newerRequest;
		expect(workflow.resolveSearchResults.value).toEqual([newestResult]);

		firstSearch.resolve({ data: [{ id: 'old', name: 'Stale', set: 'old' }] });
		await olderRequest;
		expect(workflow.resolveSearchResults.value).toEqual([newestResult]);
		expect(workflow.resolveSearchLoading.value).toBe(false);
	});

	it('exposes a Scryfall search failure instead of presenting it as no results', async () => {
		mockFetch.mockRejectedValueOnce(new Error('Scryfall unavailable'));
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();

		workflow.resolveSearchTerm.value = 'lightning';
		await workflow.searchResolveCandidates();

		expect(workflow.resolveSearchResults.value).toEqual([]);
		expect(workflow.resolveSearchError.value).toBe('Scryfall unavailable');
		expect(workflow.resolveSearchLoading.value).toBe(false);
	});

	it('invalidates visible Scryfall results as soon as the search term changes', async () => {
		mockFetch.mockResolvedValueOnce({ data: [{ id: 'old', name: 'Old result', set: 'old' }] });
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();
		workflow.resolveSearchTerm.value = 'first';
		await workflow.searchResolveCandidates();
		expect(workflow.resolveSearchResults.value).toHaveLength(1);

		workflow.resolveSearchTerm.value = 'second';

		expect(workflow.resolveSearchResults.value).toEqual([]);
		expect(workflow.resolveSearchError.value).toBeNull();
	});

	it('resolves the active group, reloads Players, reloads unresolved entries, and closes the modal when complete', async () => {
		mockEventRepo.listUnresolvedDeckCards
			.mockResolvedValueOnce([unresolved({ id: 10 })])
			.mockResolvedValueOnce([]);
		const workflow = useMeleeSyncUnresolvedDeckListResolution({ eventId: ref(1), isSetupComplete: ref(true) });
		await flushAsyncWork();
		workflow.openResolveModal();

		await workflow.resolveUnresolvedDeckCard({ id: 'scryfall-1', name: 'Lightning Bolt', set: 'm11' });

		expect(mockEventRepo.resolveUnresolvedDeckCard).toHaveBeenCalledWith(1, 10, { scryfallId: 'scryfall-1' });
		expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
		expect(mockEventRepo.listUnresolvedDeckCards).toHaveBeenCalledTimes(2);
		expect(workflow.resolveModalOpen.value).toBe(false);
		expect(workflow.resolvingScryfallId.value).toBeNull();
	});
});

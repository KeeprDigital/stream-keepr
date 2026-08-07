import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

const mockEventRepo = {
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	syncMelee: vi.fn(),
	runInitialSetup: vi.fn(),
	updateFromMelee: vi.fn(),
	syncPlayers: vi.fn(),
	syncSpecificRound: vi.fn(),
	syncDecklists: vi.fn(),
};

const mockAbly = createMockRealtime();
mockAbly.onRoom.mockImplementation(() => {});

mockNuxtImport('useEventRepository', () => () => mockEventRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
/*
 * `useAsyncAction` is deliberately not mocked. The hand-written copy that stood here
 * reported `e.message ?? String(e)` with no `instanceof Error` guard, where the real
 * composable reports 'An error occurred' for a rejection that is not an `Error` — so a
 * plain-object fixture could assert prose no operator would be shown. It also called
 * `onError` with no argument and resolved `undefined` where the real one passes the
 * failure and resolves `null` (#241, #263).
 */

// For melee store: useEventStore() returns a pinia store where refs are auto-unwrapped.
// We use reactive() to mimic this behavior — properties are accessed directly (no .value).
const mockEventState = reactive({
	event: null as any,
	eventId: null as number | null,
	loadEvent: vi.fn(),
	updateEvent: vi.fn(),
});

const mockRoundStore = reactive({
	rounds: [] as any[],
	isLoaded: false,
	loadRoundsByEventId: vi.fn(),
	getRoundById: vi.fn(),
});

const mockPhaseStore = reactive({
	phases: [] as any[],
	isLoaded: false,
	loadPhasesByEventId: vi.fn(),
	getPhaseById: vi.fn(),
});

const mockMatchStore = reactive({
	matches: [] as any[],
	isLoaded: true,
	loadedRoundId: null as number | null,
	loadMatchesByRoundId: vi.fn(),
	loadMatchesByEventId: vi.fn(),
	clearMatches: vi.fn(),
});

const mockPlayerStore = reactive({
	players: [] as any[],
	loadPlayersByEventId: vi.fn(),
});
const mockPlayerDeckStore = reactive({
	loadByEventId: vi.fn(),
});
const mockFeatureMatchStore = reactive({
	loadFeatureMatchesByEventId: vi.fn(),
});
const mockMetagameStore = reactive({
	applyRemoteInvalidated: vi.fn(),
});

mockNuxtImport('useEventStore', () => () => mockEventState);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerDeckStore', () => () => mockPlayerDeckStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);

// Test round data — now DB-shaped rounds with phaseId, status, lastSyncedAt
const testRounds = [
	{ id: 10, phaseId: 1, externalId: '100', externalSource: 'melee', name: 'Round 1', roundNumber: 1, status: 'upcoming', lastSyncedAt: null, eventId: 1 },
	{ id: 20, phaseId: 1, externalId: '200', externalSource: 'melee', name: 'Round 2', roundNumber: 2, status: 'upcoming', lastSyncedAt: null, eventId: 1 },
	{ id: 30, phaseId: 2, externalId: '300', externalSource: 'melee', name: 'Quarterfinals', roundNumber: 1, status: 'upcoming', lastSyncedAt: null, eventId: 1 },
];

const testPhases = [
	{ id: 1, name: 'Swiss', sortOrder: 0, eventId: 1 },
	{ id: 2, name: 'Top 8', sortOrder: 1, eventId: 1 },
];

const initialSetupResponse = {
	success: true,
	message: 'Initial Melee.gg setup completed',
	steps: ['structure', 'players', 'decklists'],
	event: { name: 'Test Event' },
	phases: 2,
	rounds: 7,
	players: { created: 4, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] },
	deckLists: { players: 4, deckLists: 4, uniqueCards: 40, updated: 4 },
	warnings: [],
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('useMeleeStore', () => {
	let store: ReturnType<typeof useMeleeStore>;

	beforeEach(() => {
		store = useMeleeStore();
		store.$reset();
		mockEventState.event = null;
		mockEventState.eventId = null;
		mockEventState.loadEvent = vi.fn();
		mockEventState.updateEvent = vi.fn();
		mockRoundStore.rounds = [];
		mockRoundStore.isLoaded = false;
		mockRoundStore.getRoundById = vi.fn();
		mockPhaseStore.phases = [];
		mockPhaseStore.isLoaded = false;
		mockPhaseStore.getPhaseById = vi.fn();
		mockMatchStore.matches = [];
		mockMatchStore.isLoaded = true;
		mockMatchStore.loadedRoundId = null;
		mockPlayerStore.players = [];
		mockPlayerDeckStore.loadByEventId = vi.fn();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation(() => {});
	});

	function setEvent(extra?: Record<string, any>) {
		const evt = {
			...createMockEvent(),
			talents: [],
			meleeConfigured: false,
			...extra,
		};
		mockEventState.event = evt;
		mockEventState.eventId = evt.id;
	}

	function setRoundsAndPhases() {
		mockRoundStore.rounds = [...testRounds];
		mockPhaseStore.phases = [...testPhases];
		mockPhaseStore.getPhaseById = vi.fn((id: number) => testPhases.find(p => p.id === id) ?? null);
	}

	// ── Computed ──

	describe('hasCredentials', () => {
		it('returns false when no event', () => {
			expect(store.hasCredentials).toBe(false);
		});

		it('returns true when melee is enabled and configured', () => {
			setEvent({ meleeEnabled: true, meleeConfigured: true });
			expect(store.hasCredentials).toBe(true);
		});

		it('returns false when melee not enabled', () => {
			setEvent({ meleeEnabled: false, meleeConfigured: true });
			expect(store.hasCredentials).toBe(false);
		});
	});

	describe('nextUnsyncedRound', () => {
		it('returns first round when none synced', () => {
			setRoundsAndPhases();
			expect(store.nextUnsyncedRound).toEqual(testRounds[0]);
		});

		it('returns next unsynced round when some are synced', () => {
			setRoundsAndPhases();
			mockRoundStore.rounds[0] = { ...testRounds[0], lastSyncedAt: new Date() };
			expect(store.nextUnsyncedRound).toEqual(testRounds[1]);
		});
	});

	describe('nextRoundLabel', () => {
		it('returns label for the next unsynced round', () => {
			setRoundsAndPhases();
			expect(store.nextRoundLabel).toBe('Sync Round 1');
		});
	});

	describe('allRoundsSynced', () => {
		it('returns false when there are unsynced rounds', () => {
			setRoundsAndPhases();
			expect(store.allRoundsSynced).toBe(false);
		});

		it('returns true when all rounds are synced', () => {
			setRoundsAndPhases();
			mockRoundStore.rounds = testRounds.map(r => ({ ...r, lastSyncedAt: new Date() }));
			expect(store.allRoundsSynced).toBe(true);
		});
	});

	describe('syncedRoundCount', () => {
		it('returns count of synced rounds', () => {
			setRoundsAndPhases();
			mockRoundStore.rounds[0] = { ...testRounds[0], lastSyncedAt: new Date() };
			expect(store.syncedRoundCount).toBe(1);
		});
	});

	it('excludes local, foreign-source, and manual-override rounds from sync progress', () => {
		setRoundsAndPhases();
		mockRoundStore.rounds.push(
			{ ...testRounds[0], id: 40, externalId: null, externalSource: null },
			{ ...testRounds[0], id: 50, externalId: 'other-50', externalSource: 'other' },
			{ ...testRounds[0], id: 60, externalId: 'melee-60', externalSource: 'melee', controlMode: 'manual_override' },
		);

		expect(store.availableRounds.map(round => round.id)).toEqual([10, 20, 30]);
		expect(store.totalRoundCount).toBe(3);
	});

	// ── Actions ──

	describe('syncEvent', () => {
		it('calls repo and reloads phases and rounds', async () => {
			setEvent();
			mockEventRepo.syncMelee.mockResolvedValue({
				success: true,
				event: { name: 'Test Event' },
				phases: 2,
				rounds: 7,
				warnings: ['Structure notification could not be delivered'],
			});

			await store.syncEvent();

			expect(mockEventRepo.syncMelee).toHaveBeenCalledWith(1);
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
			expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMatchStore.loadMatchesByEventId).toHaveBeenCalledWith(1);
			expect(store.lastOperation?.title).toBe('Event Synced');
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('Structure notification could not be delivered');
		});
	});

	describe('failure reporting', () => {
		it('reports the sentence a refused sync carries, in `error` and in the operation banner', async () => {
			setEvent();
			mockEventRepo.syncMelee.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'This Event is no longer linked to a Melee.gg tournament' },
				request: `[POST] "/api/events/1/melee/sync"`,
			}));

			await store.syncEvent();

			expect(store.error).toBe('This Event is no longer linked to a Melee.gg tournament');
			// The banner's own failure description falls through to `error`, so the sentence
			// is what an operator reads under 'Event Sync Failed' as well.
			expect(store.lastOperation?.description).toBe('This Event is no longer linked to a Melee.gg tournament');
		});

		it('reports the transport line for a 5xx, whose body message the server sanitized', async () => {
			setEvent();
			mockEventRepo.syncMelee.mockRejectedValue(transportFailure({
				status: 502,
				statusText: 'Bad Gateway',
				body: { message: 'Internal Server Error' },
				request: `[POST] "/api/events/1/melee/sync"`,
			}));

			await store.syncEvent();

			expect(store.error).toBe('[POST] "/api/events/1/melee/sync": 502 Bad Gateway');
		});
	});

	describe('syncPlayers', () => {
		it('calls repo and reloads player store', async () => {
			setEvent();
			mockEventRepo.syncPlayers.mockResolvedValue({
				success: true,
				results: { created: 2, updated: 3, deactivated: 1, matchesUpdated: 0, errors: [] },
				warnings: ['Player notification could not be delivered'],
			});

			await store.syncPlayers();

			expect(mockEventRepo.syncPlayers).toHaveBeenCalledWith(1);
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(store.lastOperation?.title).toBe('Players Synced');
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('1 deactivated');
			expect(store.lastOperation?.details).toContain('Player notification could not be delivered');
		});
	});

	describe('updateFromMelee', () => {
		it('calls the unified repo action and reloads event-scoped data', async () => {
			setEvent();
			mockMatchStore.loadedRoundId = 10;
			mockRoundStore.rounds = [{ id: 10 }] as any;
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: ['Round notification could not be delivered'],
				steps: ['players', 'previous-round', 'next-round'],
				players: { created: 1, updated: 2, deactivated: 0, matchesUpdated: 0, errors: [] },
				deckLists: null,
				rounds: [{ role: 'next', round: { id: 10, name: 'Round 1', roundNumber: 1, phaseId: 1 }, matchCount: 24, created: 20, updated: 4, staleDeleted: 0 }],
				advancedRound: { id: 10, name: 'Round 1', roundNumber: 1, phaseId: 1 },
				refreshedRound: null,
			});

			const result = await store.updateFromMelee({ includeDeckLists: true });

			expect(result.success).toBe(true);
			expect(mockEventRepo.updateFromMelee).toHaveBeenCalledWith(1, { includeDeckLists: true });
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
			expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerDeckStore.loadByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 10);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(store.lastOperation?.title).toBe('Melee Updated');
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('Imported Round 1');
			expect(store.lastOperation?.details).toContain('Round notification could not be delivered');
		});

		it('returns error when no event loaded', async () => {
			const result = await store.updateFromMelee();

			expect(result.success).toBe(false);
			expect(result.error).toBe('No event loaded');
			expect(mockEventRepo.updateFromMelee).not.toHaveBeenCalled();
		});

		it('maintains updatingFromMelee while the unified update is running', async () => {
			setEvent();
			const runningDuringUpdate: boolean[] = [];
			mockEventRepo.updateFromMelee.mockImplementation(async () => {
				runningDuringUpdate.push(store.updatingFromMelee);
				return { success: true, steps: ['players'], players: { created: 0, updated: 0, errors: [] }, deckLists: null, rounds: [], advancedRound: null, refreshedRound: null };
			});

			await store.updateFromMelee();

			expect(runningDuringUpdate).toEqual([true]);
			expect(store.updatingFromMelee).toBe(false);
		});

		it('coalesces duplicate update commands so loading cannot clear between requests', async () => {
			setEvent();
			const pending = deferred<any>();
			mockEventRepo.updateFromMelee.mockReturnValue(pending.promise);

			const first = store.updateFromMelee();
			const duplicate = store.updateFromMelee();

			expect(mockEventRepo.updateFromMelee).toHaveBeenCalledOnce();
			expect(store.updatingFromMelee).toBe(true);

			pending.resolve({
				success: true,
				warnings: [],
				steps: ['players'],
				players: { created: 0, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] },
				deckLists: null,
				rounds: [],
				advancedRound: null,
				refreshedRound: null,
			});
			const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

			expect(store.updatingFromMelee).toBe(false);
			expect(duplicateResult).toEqual(firstResult);
			expect(store.lastOperation?.status).toBe('success');
		});

		it('reports a committed source update separately from a local projection refresh failure', async () => {
			setEvent();
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: [],
				steps: ['players'],
				players: { created: 1, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] },
				deckLists: null,
				rounds: [],
				advancedRound: null,
				refreshedRound: null,
			});
			mockPlayerStore.loadPlayersByEventId.mockRejectedValueOnce(new Error('Player projection offline'));

			const result = await store.updateFromMelee();

			expect(result.success).toBe(true);
			expect(store.lastOperation?.status).toBe('warning');
			expect(store.lastOperation?.title).toBe('Melee Updated — Reload Needed');
			expect(store.lastOperation?.description).toContain('source changes were committed');
			expect(store.lastOperation?.details).toContain('Local players refresh failed: Player projection offline');
			expect(store.error).toBeNull();
		});
	});

	describe('syncSpecificRound', () => {
		it('calls repo with roundId and reloads data including player store', async () => {
			setEvent();
			setRoundsAndPhases();
			mockMatchStore.loadedRoundId = 20;
			mockEventRepo.syncSpecificRound.mockResolvedValue({
				success: true,
				round: { id: 20, name: 'Round 2', roundNumber: 2, phaseId: 1 },
				matchCount: 11,
				created: 10,
				updated: 1,
				warnings: ['Match notification could not be delivered'],
			});
			mockEventRepo.syncPlayers.mockResolvedValue({ success: true });

			const result = await store.syncSpecificRound(20);

			expect(result.success).toBe(true);
			expect(mockEventRepo.syncSpecificRound).toHaveBeenCalledWith(1, 20);
			expect(mockEventRepo.syncPlayers).not.toHaveBeenCalled();
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMatchStore.loadMatchesByRoundId).toHaveBeenCalledWith(1, 20);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('Match notification could not be delivered');
		});

		it('does not let an older completion timer clear a newer sync step', async () => {
			vi.useFakeTimers();
			setEvent();
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: [],
				steps: ['players'],
				players: { created: 0, updated: 0, deactivated: 0, matchesUpdated: 0, errors: [] },
				deckLists: null,
				rounds: [],
				advancedRound: null,
				refreshedRound: null,
			});
			await store.updateFromMelee();
			expect(store.syncStep).toBe('complete');

			let resolveRound!: (value: unknown) => void;
			mockEventRepo.syncSpecificRound.mockReturnValue(new Promise((resolve) => {
				resolveRound = resolve;
			}));
			const newerSync = store.syncSpecificRound(20);
			await Promise.resolve();
			expect(store.syncStep).toBe('standings');

			await vi.advanceTimersByTimeAsync(1500);
			expect(store.syncStep).toBe('standings');

			resolveRound({
				success: true,
				round: { id: 20, name: 'Round 2', roundNumber: 2, phaseId: 1 },
				matchCount: 1,
				created: 1,
				updated: 0,
				warnings: [],
			});
			await newerSync;
			vi.useRealTimers();
		});
	});

	describe('syncDecklists', () => {
		it('calls repo and reloads player and effective deck stores', async () => {
			setEvent();
			mockEventRepo.syncDecklists.mockResolvedValue({
				success: true,
				results: { players: 4, deckLists: 5, uniqueCards: 40, updated: 4 },
				warnings: ['One deck entry remains unresolved'],
			});

			await store.syncDecklists();

			expect(mockEventRepo.syncDecklists).toHaveBeenCalledWith(1);
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerDeckStore.loadByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(store.lastOperation?.title).toBe('Deck Lists Synced');
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('One deck entry remains unresolved');
		});
	});

	describe('runInitialSetup', () => {
		it('uses one server command and reloads all imported state once', async () => {
			setEvent();
			mockEventRepo.runInitialSetup.mockResolvedValue({
				...initialSetupResponse,
				warnings: ['Setup notification could not be delivered'],
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(true);
			expect(mockEventRepo.runInitialSetup).toHaveBeenCalledOnce();
			expect(mockEventRepo.runInitialSetup).toHaveBeenCalledWith(1);
			expect(mockEventRepo.syncMelee).not.toHaveBeenCalled();
			expect(mockEventRepo.syncPlayers).not.toHaveBeenCalled();
			expect(mockEventRepo.syncDecklists).not.toHaveBeenCalled();
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
			expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledOnce();
			expect(mockPlayerDeckStore.loadByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(store.lastOperation?.title).toBe('Initial Setup Complete');
			expect(store.lastOperation?.status).toBe('success');
			expect(store.lastOperation?.details).toContain('Setup notification could not be delivered');
		});

		it('returns error when no event loaded', async () => {
			const result = await store.runInitialSetup();

			expect(result.success).toBe(false);
			expect(result.error).toBe('No event loaded');
		});

		it('surfaces the aggregate setup failure and reloads Event status', async () => {
			setEvent();
			mockEventRepo.runInitialSetup.mockResolvedValue({
				...initialSetupResponse,
				success: false,
				message: 'Initial Melee.gg setup completed with deck list warnings',
				warnings: ['Deck list sync skipped 1 player'],
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(false);
			expect(result.error).toBe('Deck list sync skipped 1 player');
			expect(mockEventState.loadEvent).toHaveBeenCalledWith(1);
			expect(mockPhaseStore.loadPhasesByEventId).toHaveBeenCalledWith(1);
			expect(mockRoundStore.loadRoundsByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerStore.loadPlayersByEventId).toHaveBeenCalledWith(1);
			expect(mockPlayerDeckStore.loadByEventId).toHaveBeenCalledWith(1);
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
			expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
			expect(store.lastOperation?.status).toBe('error');
		});

		it('maintains runningSetup while the canonical request runs', async () => {
			setEvent();
			const runningDuringRequest: boolean[] = [];
			mockEventRepo.runInitialSetup.mockImplementation(async () => {
				runningDuringRequest.push(store.runningSetup);
				return initialSetupResponse;
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(true);
			expect(runningDuringRequest).toEqual([true]);
			expect(store.runningSetup).toBe(false);
		});

		it('progresses from server sync to local loading', async () => {
			setEvent();
			const stepsObserved: string[] = [];
			mockEventRepo.runInitialSetup.mockImplementation(async () => {
				stepsObserved.push(store.setupStep!);
				return initialSetupResponse;
			});
			mockEventState.loadEvent.mockImplementation(async () => {
				stepsObserved.push(store.setupStep!);
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(true);
			expect(stepsObserved).toEqual(['syncing', 'loading']);
		});

		it('coalesces concurrent setup calls into one server command', async () => {
			setEvent();
			const pending = deferred<any>();
			mockEventRepo.runInitialSetup.mockReturnValue(pending.promise);

			// Start first setup (blocks on the one server command).
			const firstSetup = store.runInitialSetup();
			const duplicateSetup = store.runInitialSetup();

			expect(mockEventRepo.runInitialSetup).toHaveBeenCalledOnce();

			pending.resolve(initialSetupResponse);
			const [firstResult, duplicateResult] = await Promise.all([firstSetup, duplicateSetup]);
			expect(firstResult.success).toBe(true);
			expect(duplicateResult).toEqual(firstResult);
		});

		it('sets setupStep to complete on success then clears after delay', async () => {
			vi.useFakeTimers();
			setEvent();
			mockEventRepo.runInitialSetup.mockResolvedValue(initialSetupResponse);

			await store.runInitialSetup();

			// setupStep should be 'complete' immediately after
			expect(store.setupStep).toBe('complete');

			// After the 1500ms delay it should clear
			vi.advanceTimersByTime(1500);
			expect(store.setupStep).toBeNull();

			vi.useRealTimers();
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.error = 'some error';

			store.$reset();

			expect(store.syncing).toBe(false);
			expect(store.syncingPlayers).toBe(false);
			expect(store.syncingDecklists).toBe(false);
			expect(store.syncingRound).toBe(false);
			expect(store.updatingFromMelee).toBe(false);
			expect(store.runningSetup).toBe(false);
			expect(store.setupStep).toBeNull();
			expect(store.syncStep).toBeNull();
			expect(store.error).toBeNull();
		});
	});
});

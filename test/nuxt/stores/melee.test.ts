import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockEvent, createMockFeatureMatch, createMockMatch, createMockPhase, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';

/*
 * The Melee store over the real Event-scoped stores it reloads. Faked: the Event
 * repository, whose Melee commands are the contract, and `$fetch`, the network
 * every sibling store reads through.
 */

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

mockNuxtImport('useEventRepository', () => () => mockEventRepo);

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

interface Served {
	event: any;
	phases: unknown[];
	rounds: unknown[];
	players: unknown[];
	decks: unknown[];
	slots: unknown[];
	matches: Array<{ roundId: number | null }>;
}

/** What the server holds for the Event. Every read answers from it, so a test sets what its sync imported. */
let server: Served;

/** The Event-scoped reads the sibling stores make, answered from `server`. */
async function serve(path: string, options?: { query?: { roundId?: number } }) {
	const roundId = options?.query?.roundId;
	switch (path.replace(/^\/api\/events\/\d+\//, '')) {
		case 'phases':
			return [...server.phases];
		case 'rounds':
			return [...server.rounds];
		case 'players':
			return [...server.players];
		case 'decks':
			return {
				decks: [...server.decks],
			};
		case 'feature-match-slots':
			return [...server.slots];
		case 'matches':
			return roundId
				? {
						matches: server.matches.filter(match => match.roundId === roundId),
					}
				: [...server.matches];
		default:
			throw new Error(`unrouted ${path}`);
	}
}

/** What this client holds of the Event, by store. */
function held() {
	return {
		event: useEventStore().event?.name,
		phases: usePhaseStore().phases.map(phase => phase.id),
		rounds: useRoundStore().rounds.map(round => round.id),
		players: usePlayerStore().players.map(player => player.id),
		decks: usePlayerDeckStore().decks.map(deck => deck.id),
		slots: useFeatureMatchStore().featureMatches.map(slot => slot.id),
		matches: useMatchStore().matches.map(match => match.id),
		metagame: useMetagameStore().summaryData === null
			? 'invalidated'
			: 'held',
	};
}

/** Reads of one Event-scoped resource that reached the network. */
function readsOf(resource: string) {
	return mockFetch.mock.calls.filter(([path]) => path === `/api/events/1/${resource}`).length;
}

/** The server stops answering reads of one resource; every other read still answers. */
function failReadsOf(resource: string) {
	mockFetch.mockImplementation(async (path: string, options?: { query?: { roundId?: number } }) => {
		if (path.endsWith(`/${resource}`))
			throw new Error(`${resource} offline`);
		return serve(path, options);
	});
}

const testRounds = [
	{
		id: 10,
		phaseId: 1,
		externalId: '100',
		externalSource: 'melee',
		name: 'Round 1',
		roundNumber: 1,
		status: 'upcoming',
		lastSyncedAt: null,
		eventId: 1,
	},
	{
		id: 20,
		phaseId: 1,
		externalId: '200',
		externalSource: 'melee',
		name: 'Round 2',
		roundNumber: 2,
		status: 'upcoming',
		lastSyncedAt: null,
		eventId: 1,
	},
	{
		id: 30,
		phaseId: 2,
		externalId: '300',
		externalSource: 'melee',
		name: 'Quarterfinals',
		roundNumber: 1,
		status: 'upcoming',
		lastSyncedAt: null,
		eventId: 1,
	},
];

const testPhases = [
	{
		id: 1,
		name: 'Swiss',
		sortOrder: 0,
		eventId: 1,
	},
	{
		id: 2,
		name: 'Top 8',
		sortOrder: 1,
		eventId: 1,
	},
];

const initialSetupResponse = {
	success: true,
	message: 'Initial Melee.gg setup completed',
	steps: ['structure', 'players', 'decklists'],
	event: { name: 'Test Event' },
	phases: 2,
	rounds: 7,
	players: {
		created: 4,
		updated: 0,
		deactivated: 0,
		matchesUpdated: 0,
		errors: [],
	},
	deckLists: {
		players: 4,
		deckLists: 4,
		uniqueCards: 40,
		updated: 4,
	},
	warnings: [],
};

describe('useMeleeStore', () => {
	let store: ReturnType<typeof useMeleeStore>;

	beforeEach(() => {
		for (const sibling of [
			useMeleeStore(),
			useEventStore(),
			usePhaseStore(),
			useRoundStore(),
			useMatchStore(),
			usePlayerStore(),
			usePlayerDeckStore(),
			useFeatureMatchStore(),
			useFeatureMatchStateStore(),
			useMetagameStore(),
		])
			sibling.$reset();
		store = useMeleeStore();
		server = {
			event: null,
			phases: [],
			rounds: [],
			players: [],
			decks: [],
			slots: [],
			matches: [],
		};
		mockFetch.mockImplementation(serve);
		mockEventRepo.getById.mockImplementation(async () => server.event);
	});

	// A test that fails before its last line must not leave fake timers to the ones after it.
	afterEach(() => {
		vi.useRealTimers();
	});

	/** The operator's Event, held and served alike, so its reload answers the same Event. */
	function setEvent(extra?: Record<string, any>) {
		const event = {
			...createMockEvent(),
			talents: [],
			meleeConfigured: false,
			...extra,
		};
		server.event = event;
		useEventStore().setEvent(event as never);
	}

	function setRoundsAndPhases() {
		useRoundStore().rounds = [...testRounds] as never;
		usePhaseStore().phases = [...testPhases] as never;
	}

	/**
	 * The Event as the server holds it once a Melee command has imported: one of
	 * everything no store holds yet, and a Metagame summary held from before.
	 */
	function importOnServer() {
		server.event = { ...server.event, name: 'Imported Event' };
		server.phases = [
			createMockPhase({ id: 1, eventId: 1 }),
		];
		server.rounds = [
			createMockRound({ id: 10, eventId: 1, phaseId: 1 }),
			createMockRound({ id: 20, eventId: 1, phaseId: 1 }),
		];
		server.players = [
			createMockPlayer({ id: 7, eventId: 1 }),
		];
		server.decks = [
			{ id: 70, eventId: 1, playerId: 7 },
		];
		server.slots = [
			createMockFeatureMatch({ id: 5, eventId: 1 }),
		];
		server.matches = [
			createMockMatch({ id: 100, eventId: 1, roundId: 10 }),
			createMockMatch({ id: 200, eventId: 1, roundId: 20 }),
		];
		useMetagameStore().summaryData = { totalPlayers: 4 } as never;
	}

	it.each([
		['no Event', undefined, false],
		[
			'Melee enabled and configured',
			{ meleeEnabled: true, meleeConfigured: true },
			true,
		],
		[
			'Melee configured but not enabled',
			{ meleeEnabled: false, meleeConfigured: true },
			false,
		],
	])('hasCredentials with %s is %s', (_, event, expected) => {
		if (event)
			setEvent(event);

		expect(store.hasCredentials).toBe(expected);
	});

	it('tracks sync progress through the Event\'s Rounds in order', () => {
		const rounds = useRoundStore();
		setRoundsAndPhases();

		expect(store.nextUnsyncedRound).toEqual(testRounds[0]);
		expect(store.nextRoundLabel).toBe('Sync Round 1');
		expect(store.allRoundsSynced).toBe(false);

		rounds.rounds[0] = {
			...testRounds[0],
			lastSyncedAt: new Date(),
		} as never;

		expect(store.nextUnsyncedRound).toEqual(testRounds[1]);
		expect(store.syncedRoundCount).toBe(1);

		rounds.rounds = testRounds.map(r => ({
			...r,
			lastSyncedAt: new Date(),
		})) as never;

		expect(store.allRoundsSynced).toBe(true);
	});

	it('excludes local, foreign-source, and manual-override rounds from sync progress', () => {
		setRoundsAndPhases();
		useRoundStore().rounds.push(
			{
				...testRounds[0],
				id: 40,
				externalId: null,
				externalSource: null,
			} as never,
			{
				...testRounds[0],
				id: 50,
				externalId: 'other-50',
				externalSource: 'other',
			} as never,
			{
				...testRounds[0],
				id: 60,
				externalId: 'melee-60',
				externalSource: 'melee',
				controlMode: 'manual_override',
			} as never,
		);

		expect(store.availableRounds.map(round => round.id)).toEqual([10, 20, 30]);
		expect(store.totalRoundCount).toBe(3);
	});

	describe('syncEvent', () => {
		it('holds the Event, its structure, its Slots and the Matches on view as the server has them after the sync', async () => {
			setEvent();
			await useMatchStore().loadMatchesByEventId(1);
			importOnServer();
			mockEventRepo.syncMelee.mockResolvedValue({
				success: true,
				event: { name: 'Test Event' },
				phases: 2,
				rounds: 7,
				warnings: ['Structure notification could not be delivered'],
			});

			await store.syncEvent();

			expect(mockEventRepo.syncMelee).toHaveBeenCalledWith(1);
			expect(held()).toMatchObject({
				event: 'Imported Event',
				phases: [1],
				rounds: [10, 20],
				slots: [5],
				matches: [100, 200],
			});
			expect(store.lastOperation).toMatchObject({ kind: 'event', status: 'success' });
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
			expect(store.lastOperation?.description).toBe('This Event is no longer linked to a Melee.gg tournament');
		});
	});

	describe('syncPlayers', () => {
		it('holds the Event, its Players and its Slots as the server has them, and drops the Metagame summary', async () => {
			setEvent();
			importOnServer();
			mockEventRepo.syncPlayers.mockResolvedValue({
				success: true,
				results: {
					created: 2,
					updated: 3,
					deactivated: 1,
					matchesUpdated: 0,
					errors: [],
				},
				warnings: ['Player notification could not be delivered'],
			});

			await store.syncPlayers();

			expect(mockEventRepo.syncPlayers).toHaveBeenCalledWith(1);
			expect(held()).toMatchObject({
				event: 'Imported Event',
				players: [7],
				slots: [5],
				metagame: 'invalidated',
			});
			expect(store.lastOperation).toMatchObject({ kind: 'players', status: 'success', title: 'Players Synced' });
			expect(store.lastOperation?.details).toContain('1 deactivated');
			expect(store.lastOperation?.details).toContain('Player notification could not be delivered');
		});
	});

	describe('updateFromMelee', () => {
		it('holds everything the update can change as the server has it, with the Matches of the Round on view', async () => {
			setEvent();
			await useMatchStore().loadMatchesByRoundId(1, 10);
			importOnServer();
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: ['Round notification could not be delivered'],
				steps: ['players', 'previous-round', 'next-round'],
				players: {
					created: 1,
					updated: 2,
					deactivated: 0,
					matchesUpdated: 0,
					errors: [],
				},
				deckLists: null,
				rounds: [
					{
						role: 'next',
						round: {
							id: 10,
							name: 'Round 1',
							roundNumber: 1,
							phaseId: 1,
						},
						matchCount: 24,
						created: 20,
						updated: 4,
						staleDeleted: 0,
					},
				],
				advancedRound: {
					id: 10,
					name: 'Round 1',
					roundNumber: 1,
					phaseId: 1,
				},
				refreshedRound: null,
			});

			const result = await store.updateFromMelee({ includeDeckLists: true });

			expect(result.success).toBe(true);
			expect(mockEventRepo.updateFromMelee).toHaveBeenCalledWith(1, { includeDeckLists: true });
			expect(held()).toEqual({
				event: 'Imported Event',
				phases: [1],
				rounds: [10, 20],
				players: [7],
				decks: [70],
				slots: [5],
				matches: [100],
				metagame: 'invalidated',
			});
			expect(store.lastOperation).toMatchObject({ kind: 'update', status: 'success' });
			expect(store.lastOperation?.details).toContain('Imported Round 1');
			expect(store.lastOperation?.details).toContain('Round notification could not be delivered');
		});

		it('returns error when no event loaded', async () => {
			const result = await store.updateFromMelee();

			expect(result.success).toBe(false);
			expect(result.error).toBe('No event loaded');
			expect(mockEventRepo.updateFromMelee).not.toHaveBeenCalled();
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
				players: {
					created: 0,
					updated: 0,
					deactivated: 0,
					matchesUpdated: 0,
					errors: [],
				},
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

		// A reload that fails after the command landed is this browser's problem, not the sync's.
		it('reports a committed source update separately from a local projection refresh failure', async () => {
			setEvent();
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: [],
				steps: ['players'],
				players: {
					created: 1,
					updated: 0,
					deactivated: 0,
					matchesUpdated: 0,
					errors: [],
				},
				deckLists: null,
				rounds: [],
				advancedRound: null,
				refreshedRound: null,
			});
			failReadsOf('decks');

			const result = await store.updateFromMelee();

			expect(result.success).toBe(true);
			expect(store.lastOperation?.status).toBe('warning');
			expect(store.lastOperation?.title).toBe('Melee Updated — Reload Needed');
			expect(store.lastOperation?.description).toContain('source changes were committed');
			expect(store.lastOperation?.details).toContain('Local deck lists refresh failed: decks offline');
			expect(store.error).toBeNull();
		});
	});

	describe('syncSpecificRound', () => {
		it('holds the Event, Players, Rounds and Slots as the server has them, with the synced Round\'s Matches on view', async () => {
			setEvent();
			await useMatchStore().loadMatchesByRoundId(1, 20);
			importOnServer();
			mockEventRepo.syncSpecificRound.mockResolvedValue({
				success: true,
				round: {
					id: 20,
					name: 'Round 2',
					roundNumber: 2,
					phaseId: 1,
				},
				matchCount: 11,
				created: 10,
				updated: 1,
				warnings: ['Match notification could not be delivered'],
			});

			const result = await store.syncSpecificRound(20);

			expect(result.success).toBe(true);
			expect(mockEventRepo.syncSpecificRound).toHaveBeenCalledWith(1, 20);
			expect(mockEventRepo.syncPlayers).not.toHaveBeenCalled();
			expect(held()).toMatchObject({
				event: 'Imported Event',
				rounds: [10, 20],
				players: [7],
				slots: [5],
				matches: [200],
				metagame: 'invalidated',
			});
			expect(store.lastOperation).toMatchObject({ kind: 'specific-round', status: 'success' });
			expect(store.lastOperation?.details).toContain('Match notification could not be delivered');
		});

		it('does not let an older completion timer clear a newer sync step', async () => {
			vi.useFakeTimers();
			setEvent();
			mockEventRepo.updateFromMelee.mockResolvedValue({
				success: true,
				warnings: [],
				steps: ['players'],
				players: {
					created: 0,
					updated: 0,
					deactivated: 0,
					matchesUpdated: 0,
					errors: [],
				},
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
				round: {
					id: 20,
					name: 'Round 2',
					roundNumber: 2,
					phaseId: 1,
				},
				matchCount: 1,
				created: 1,
				updated: 0,
				warnings: [],
			});
			await newerSync;
		});
	});

	describe('syncDecklists', () => {
		it('holds the Event, Players, Deck Lists and Slots as the server has them, and drops the Metagame summary', async () => {
			setEvent();
			importOnServer();
			mockEventRepo.syncDecklists.mockResolvedValue({
				success: true,
				results: {
					players: 4,
					deckLists: 5,
					uniqueCards: 40,
					updated: 4,
				},
				warnings: ['One deck entry remains unresolved'],
			});

			await store.syncDecklists();

			expect(mockEventRepo.syncDecklists).toHaveBeenCalledWith(1);
			expect(held()).toMatchObject({
				event: 'Imported Event',
				players: [7],
				decks: [70],
				slots: [5],
				metagame: 'invalidated',
			});
			expect(store.lastOperation).toMatchObject({ kind: 'decklists', status: 'success' });
			expect(store.lastOperation?.details).toContain('One deck entry remains unresolved');
		});
	});

	describe('runInitialSetup', () => {
		it('uses one server command and holds all it imported, each read once', async () => {
			setEvent();
			importOnServer();
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
			expect(held()).toMatchObject({
				event: 'Imported Event',
				phases: [1],
				rounds: [10, 20],
				players: [7],
				decks: [70],
				slots: [5],
				metagame: 'invalidated',
			});
			expect(readsOf('players')).toBe(1);
			expect(store.lastOperation).toMatchObject({ kind: 'setup', status: 'success' });
			expect(store.lastOperation?.details).toContain('Setup notification could not be delivered');
		});

		it('returns error when no event loaded', async () => {
			const result = await store.runInitialSetup();

			expect(result.success).toBe(false);
			expect(result.error).toBe('No event loaded');
		});

		it('surfaces the aggregate setup failure and still holds what the setup imported', async () => {
			setEvent();
			importOnServer();
			mockEventRepo.runInitialSetup.mockResolvedValue({
				...initialSetupResponse,
				success: false,
				message: 'Initial Melee.gg setup completed with deck list warnings',
				warnings: ['Deck list sync skipped 1 player'],
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(false);
			expect(result.error).toBe('Deck list sync skipped 1 player');
			expect(held()).toMatchObject({
				event: 'Imported Event',
				phases: [1],
				rounds: [10, 20],
				players: [7],
				decks: [70],
				slots: [5],
				metagame: 'invalidated',
			});
			expect(store.lastOperation?.status).toBe('error');
		});

		it('progresses from server sync to local loading', async () => {
			setEvent();
			const stepsObserved: string[] = [];
			mockEventRepo.runInitialSetup.mockImplementation(async () => {
				stepsObserved.push(store.setupStep!);
				return initialSetupResponse;
			});
			mockEventRepo.getById.mockImplementation(async () => {
				stepsObserved.push(store.setupStep!);
				return server.event;
			});

			const result = await store.runInitialSetup();

			expect(result.success).toBe(true);
			expect(stepsObserved).toEqual(['syncing', 'loading']);
		});

		it('coalesces concurrent setup calls into one server command', async () => {
			setEvent();
			const pending = deferred<any>();
			mockEventRepo.runInitialSetup.mockReturnValue(pending.promise);

			const firstSetup = store.runInitialSetup();
			const duplicateSetup = store.runInitialSetup();

			expect(mockEventRepo.runInitialSetup).toHaveBeenCalledOnce();
			expect(store.runningSetup).toBe(true);

			pending.resolve(initialSetupResponse);
			const [firstResult, duplicateResult] = await Promise.all([firstSetup, duplicateSetup]);
			expect(firstResult.success).toBe(true);
			expect(duplicateResult).toEqual(firstResult);
			expect(store.runningSetup).toBe(false);
		});

		it('sets setupStep to complete on success then clears after delay', async () => {
			vi.useFakeTimers();
			setEvent();
			mockEventRepo.runInitialSetup.mockResolvedValue(initialSetupResponse);

			await store.runInitialSetup();

			expect(store.setupStep).toBe('complete');

			vi.advanceTimersByTime(1500);
			expect(store.setupStep).toBeNull();
		});
	});

	// The command landed, so a reload that fails is this browser's to report: the
	// operator is told to reload, and which data is behind.
	describe('a reload that fails after its command committed', () => {
		const round = {
			id: 20,
			name: 'Round 2',
			roundNumber: 2,
			phaseId: 1,
		};
		const players = {
			created: 1,
			updated: 0,
			deactivated: 0,
			matchesUpdated: 0,
			errors: [],
		};
		/** Each Melee command as the server commits it, with the title its banner then carries. */
		const commands = {
			syncEvent: {
				title: 'Event Synced',
				run: () => {
					mockEventRepo.syncMelee.mockResolvedValue({
						success: true,
						event: { name: 'Test Event' },
						phases: 2,
						rounds: 7,
					});
					return store.syncEvent();
				},
			},
			syncPlayers: {
				title: 'Players Synced',
				run: () => {
					mockEventRepo.syncPlayers.mockResolvedValue({ success: true, results: players });
					return store.syncPlayers();
				},
			},
			syncDecklists: {
				title: 'Deck Lists Synced',
				run: () => {
					mockEventRepo.syncDecklists.mockResolvedValue({
						success: true,
						results: initialSetupResponse.deckLists,
						warnings: [],
					});
					return store.syncDecklists();
				},
			},
			syncSpecificRound: {
				title: 'Round Synced',
				run: () => {
					mockEventRepo.syncSpecificRound.mockResolvedValue({
						success: true,
						round,
						matchCount: 1,
						created: 1,
						updated: 0,
						warnings: [],
					});
					return store.syncSpecificRound(round.id);
				},
			},
			updateFromMelee: {
				title: 'Melee Updated',
				run: () => {
					mockEventRepo.updateFromMelee.mockResolvedValue({
						success: true,
						warnings: [],
						steps: ['players'],
						players,
						deckLists: null,
						rounds: [],
						advancedRound: null,
						refreshedRound: null,
					});
					return store.updateFromMelee();
				},
			},
			runInitialSetup: {
				title: 'Initial Setup Complete',
				run: () => {
					mockEventRepo.runInitialSetup.mockResolvedValue(initialSetupResponse);
					return store.runInitialSetup();
				},
			},
		};

		/** The next Players read held open, so a test decides what happens before it answers. */
		function holdPlayersReload() {
			const reload = deferred<unknown[]>();
			mockFetch.mockImplementation(async (path: string, options?: { query?: { roundId?: number } }) => {
				if (!path.endsWith('/players'))
					return serve(path, options);
				mockFetch.mockImplementation(serve);
				return reload.promise;
			});
			return reload;
		}

		it.each([
			['syncEvent', 'phases', 'event structure'],
			['syncEvent', 'rounds', 'event structure'],
			['syncEvent', 'feature-match-slots', 'event structure'],
			['syncEvent', 'matches', 'event structure'],
			['syncPlayers', 'players', 'players'],
			['syncPlayers', 'feature-match-slots', 'feature matches'],
			['syncDecklists', 'players', 'players'],
			['syncDecklists', 'feature-match-slots', 'feature matches'],
			['syncSpecificRound', 'players', 'players'],
			['syncSpecificRound', 'rounds', 'rounds'],
			['syncSpecificRound', 'feature-match-slots', 'feature matches'],
			['syncSpecificRound', 'matches', 'matches'],
			['updateFromMelee', 'players', 'players'],
			['updateFromMelee', 'phases', 'event structure'],
			['updateFromMelee', 'matches', 'event structure'],
			['runInitialSetup', 'phases', 'phases'],
			['runInitialSetup', 'rounds', 'rounds'],
			['runInitialSetup', 'players', 'players'],
			['runInitialSetup', 'feature-match-slots', 'feature matches'],
		] as const)('%s, when the %s reload fails, says Reload Needed and lists the %s refresh', async (command, resource, label) => {
			setEvent();
			await useMatchStore().loadMatchesByRoundId(1, round.id);
			importOnServer();
			failReadsOf(resource);

			await commands[command].run();

			expect(store.lastOperation).toMatchObject({
				status: 'warning',
				title: `${commands[command].title} — Reload Needed`,
			});
			expect(store.lastOperation?.details).toContain(`Local ${label} refresh failed: ${resource} offline`);
			expect(store.error).toBeNull();
		});

		it('still reloads the rest of the Event structure when one of its reloads fails', async () => {
			setEvent();
			await useMatchStore().loadMatchesByEventId(1);
			importOnServer();
			failReadsOf('phases');

			await commands.syncEvent.run();

			expect(held()).toMatchObject({
				phases: [],
				rounds: [10, 20],
				slots: [5],
				matches: [100, 200],
			});
		});

		// A superseded reload is no failure: what superseded it is newer, or another Event's.
		it('says nothing when the operator moved to another Event before the reload failed', async () => {
			setEvent();
			importOnServer();
			const reload = holdPlayersReload();

			const syncing = commands.syncPlayers.run();
			await vi.waitFor(() => expect(readsOf('players')).toBe(1));
			resetAllEventStores();
			setEvent({ id: 2 });
			reload.reject(new Error('players offline'));
			await syncing;

			expect(store.lastOperation).toBeNull();
			expect(usePlayerStore().error).toBeNull();
		});

		it('reports a plain success when a newer Players load superseded the reload that failed', async () => {
			setEvent();
			importOnServer();
			const reload = holdPlayersReload();

			const syncing = commands.syncPlayers.run();
			await vi.waitFor(() => expect(readsOf('players')).toBe(1));
			await usePlayerStore().loadPlayersByEventId(1);
			reload.reject(new Error('players offline'));
			await syncing;

			expect(store.lastOperation).toMatchObject({ status: 'success', title: 'Players Synced' });
			expect(held().players).toEqual([7]);
		});
	});

	// A Melee operation's answer reloads, reports and answers nothing in a later Event Lifetime (ADR-0024).
	// Back in the same Event is the case an Event-id comparison would miss.
	describe('an operation answered after the operator moved on to Event A, loaded again since', () => {
		function switchAway() {
			for (const eventId of [2, 1]) {
				store.$reset();
				setEvent({ id: eventId });
			}
		}

		it('a late success reloads nothing and reports nothing', async () => {
			setEvent();
			const sync = deferred<unknown>();
			mockEventRepo.syncMelee.mockReturnValueOnce(sync.promise);

			const syncing = store.syncEvent();
			switchAway();
			importOnServer();
			sync.resolve({
				success: true,
				event: { name: 'Test Event' },
				phases: 2,
				rounds: 7,
			});
			await syncing;

			expect(held()).toMatchObject({
				event: 'Test Event',
				phases: [],
				rounds: [],
				slots: [],
			});
			expect(store.lastOperation).toBeNull();
			expect(store.syncing).toBe(false);
		});

		it('a late failure reloads nothing and reports nothing', async () => {
			setEvent();
			const sync = deferred<never>();
			mockEventRepo.syncMelee.mockReturnValueOnce(sync.promise);

			const syncing = store.syncEvent();
			switchAway();
			importOnServer();
			sync.reject(new Error('Melee refused the sync'));
			await syncing;

			expect(held().event).toBe('Test Event');
			expect(store.lastOperation).toBeNull();
			expect(store.error).toBeNull();
		});

		it('a new operation is not answered by the one still running for the earlier lifetime', async () => {
			setEvent();
			const earlier = deferred<unknown>();
			mockEventRepo.syncMelee
				.mockReturnValueOnce(earlier.promise)
				.mockResolvedValueOnce({
					success: true,
					event: { name: 'Current Event' },
					phases: 1,
					rounds: 1,
				});

			const earlierSync = store.syncEvent();
			switchAway();
			const currentSync = await store.syncEvent();
			earlier.resolve({
				success: true,
				event: { name: 'Earlier Event' },
				phases: 2,
				rounds: 7,
			});
			await earlierSync;

			expect(mockEventRepo.syncMelee).toHaveBeenLastCalledWith(1);
			expect(currentSync).toEqual(expect.objectContaining({
				event: { name: 'Current Event' },
			}));
			expect(store.lastOperation?.description).toBe('Synced event structure for Current Event');
		});
	});
});

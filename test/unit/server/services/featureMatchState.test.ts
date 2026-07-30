import type { DbFeatureMatch, DbFeatureMatchSession } from '~~/server/db/schema';
import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

const mockPublishMessage = vi.fn();

vi.mock('hub:db', () => ({ db: mockDb }));

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
}));

vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	err.data = opts.data;
	return err;
});

const { commandFingerprint } = await import('~~/server/modules/live-state');
const { applyFeatureMatchSessionEvent, featureMatchStateService } = await import('~~/server/services/featureMatchState');

function createSnapshot(overrides: Partial<FeatureMatchSourceSnapshot> = {}): FeatureMatchSourceSnapshot {
	return {
		eventId: 1,
		slotId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: 12,
		bestOf: 3,
		playerDisplayMode: 'score',
		game: 'mtg',
		defaults: DEFAULT_FEATURE_MATCH_DEFAULTS,
		player1: { playerId: 1, data: { name: 'Alice', wins: 3, losses: 1, draws: 0, gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' } } },
		player2: { playerId: 2, data: { name: 'Bob', wins: 2, losses: 2, draws: 0, gameData: { type: 'mtg', deckName: 'Control', deckColors: 'U' } } },
		createdAt: 1000,
		...overrides,
	};
}

function reduce(
	state: FeatureMatchState,
	snapshot: FeatureMatchSourceSnapshot,
	type: FeatureMatchCommandType | 'SessionStarted',
	payload: Record<string, unknown>,
) {
	return applyFeatureMatchSessionEvent(state, snapshot, type, payload);
}

function createDbSession(overrides: Partial<DbFeatureMatchSession> = {}): DbFeatureMatchSession {
	const sourceSnapshot = createSnapshot();
	return {
		id: 10,
		eventId: 1,
		slotId: 5,
		sourceSnapshot,
		currentState: createInitialFeatureMatchState(sourceSnapshot.defaults.startingLife),
		sequence: 3,
		status: 'active',
		closedAt: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

function createSlot(overrides: Partial<DbFeatureMatch> = {}): DbFeatureMatch {
	return {
		id: 5,
		eventId: 1,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: 12,
		player1Id: null,
		player2Id: null,
		player1Data: null,
		player2Data: null,
		bestOf: 3,
		sortOrder: 0,
		playerDisplayMode: 'score',
		activeSessionId: null,
		createdAt: new Date('2026-01-01T00:00:00Z'),
		updatedAt: new Date('2026-01-01T00:00:00Z'),
		...overrides,
	};
}

describe('feature match session reducer', () => {
	it('starts from a SessionStarted snapshot and state', () => {
		const snapshot = createSnapshot();
		const currentState = createInitialFeatureMatchState(25);

		const result = reduce(createInitialFeatureMatchState(), snapshot, 'SessionStarted', { sourceSnapshot: snapshot, currentState });

		expect(result.sourceSnapshot).toEqual(snapshot);
		expect(result.currentState.player1.lifeTotal).toBe(25);
	});

	it('corrects the frozen source snapshot without mutating live state', () => {
		const snapshot = createSnapshot();
		const corrected = createSnapshot({ tableNumber: 20 });
		const state = createInitialFeatureMatchState();

		const result = reduce(state, snapshot, 'SnapshotCorrected', { sourceSnapshot: corrected });

		expect(result.sourceSnapshot.tableNumber).toBe(20);
		expect(result.currentState).toEqual(state);
	});

	it('applies player life, counters, and mulligan events', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();

		state = reduce(state, snapshot, 'AdjustLife', { player: 'player1', delta: -3 }).currentState;
		state = reduce(state, snapshot, 'SetLife', { player: 'player2', lifeTotal: 7 }).currentState;
		state = reduce(state, snapshot, 'SetCounters', { player: 'player1', counters: [{ type: 'poison', value: 2 }] }).currentState;
		state = reduce(state, snapshot, 'SetCardsKept', { player: 'player2', cardsKept: 5 }).currentState;

		expect(state.player1.lifeTotal).toBe(17);
		expect(state.player2.lifeTotal).toBe(7);
		expect(state.player1.counters).toEqual([{ type: 'poison', value: 2 }]);
		expect(state.player2.cardsKept).toBe(5);
	});

	it('applies clock events with persisted timestamps', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();

		state = reduce(state, snapshot, 'StartClock', { at: 1000 }).currentState;
		state = reduce(state, snapshot, 'PauseClock', { at: 6000 }).currentState;
		state = reduce(state, snapshot, 'AdjustClock', { at: 6000, deltaMs: 10_000 }).currentState;
		state = reduce(state, snapshot, 'SetClock', { at: 6000, targetMs: 30_000 }).currentState;
		state = reduce(state, snapshot, 'ResetClock', { durationMs: 2_400_000 }).currentState;
		state = reduce(state, snapshot, 'RestartClock', { at: 9000 }).currentState;

		expect(state.clock.durationMs).toBe(2_400_000);
		expect(state.clock.elapsedMs).toBe(0);
		expect(state.clock.isRunning).toBe(true);
		expect(state.clock.lastStartedAt).toBe(9000);
	});

	it('records and undoes game wins using frozen match settings', () => {
		const snapshot = createSnapshot({ bestOf: 3 });
		let state = createInitialFeatureMatchState();
		state.player1.lifeTotal = 3;
		state.player2.lifeTotal = 9;

		state = reduce(state, snapshot, 'RecordGameWin', { player: 'player1' }).currentState;
		expect(state.player1.gameWins).toBe(1);
		expect(state.currentGame).toBe(2);
		expect(state.player1.lifeTotal).toBe(20);

		state = reduce(state, snapshot, 'RecordGameWin', { player: 'player1' }).currentState;
		expect(state.isComplete).toBe(true);

		state = reduce(state, snapshot, 'UndoGameWin', { player: 'player1' }).currentState;
		expect(state.player1.gameWins).toBe(1);
		expect(state.isComplete).toBe(false);
	});

	it('resets game state in-session and resets full match state without creating a session', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();
		state.player1.gameWins = 1;
		state.player1.lifeTotal = 2;
		state.turnNumber = 4;
		state.firstPlayer = 'player2';
		state.activePlayer = 'player1';

		state = reduce(state, snapshot, 'ResetState', { type: 'game' }).currentState;
		expect(state.player1.gameWins).toBe(1);
		expect(state.player1.lifeTotal).toBe(20);
		expect(state.turnNumber).toBe(0);
		expect(state.firstPlayer).toBeNull();

		state = reduce(state, snapshot, 'ResetState', { type: 'match' }).currentState;
		expect(state.player1.gameWins).toBe(0);
		expect(state.currentGame).toBe(1);
	});

	it('tracks first player, active player, turn steps, and overtime steps', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();

		state = reduce(state, snapshot, 'SelectFirstPlayer', { player: 'player1' }).currentState;
		state = reduce(state, snapshot, 'StepTurn', { delta: 1 }).currentState;
		expect(state.turnNumber).toBe(1);
		expect(state.activePlayer).toBe('player2');

		state = reduce(state, snapshot, 'StepTurn', { delta: 1 }).currentState;
		expect(state.turnNumber).toBe(2);
		expect(state.activePlayer).toBe('player1');

		state = reduce(state, snapshot, 'SetActivePlayer', { player: 'player2' }).currentState;
		state = reduce(state, snapshot, 'SetTurnNumber', { turnNumber: 5 }).currentState;
		state = reduce(state, snapshot, 'StartOvertime', { totalTurns: 3 }).currentState;
		state = reduce(state, snapshot, 'StepOvertime', { delta: 1 }).currentState;

		expect(state.turnNumber).toBe(5);
		expect(state.activePlayer).toBe('player1');
		expect(state.overtime?.turnsRemaining).toBe(2);
	});

	it('sets first player without resetting active player or turn number', () => {
		const snapshot = createSnapshot();
		const state = createInitialFeatureMatchState();
		state.firstPlayer = 'player1';
		state.activePlayer = 'player1';
		state.turnNumber = 4;

		const result = reduce(state, snapshot, 'SetFirstPlayer', { player: 'player2' }).currentState;

		expect(result.firstPlayer).toBe('player2');
		expect(result.activePlayer).toBe('player1');
		expect(result.turnNumber).toBe(4);
	});

	it('swaps live state and frozen player snapshot sides', () => {
		const snapshot = createSnapshot();
		const state = createInitialFeatureMatchState();
		state.player1.lifeTotal = 8;
		state.player2.lifeTotal = 13;
		state.firstPlayer = 'player1';
		state.activePlayer = 'player2';

		const result = reduce(state, snapshot, 'SwapPlayers', {});

		expect(result.currentState.player1.lifeTotal).toBe(13);
		expect(result.currentState.player2.lifeTotal).toBe(8);
		expect(result.currentState.firstPlayer).toBe('player2');
		expect(result.currentState.activePlayer).toBe('player1');
		expect(result.sourceSnapshot.player1.data?.name).toBe('Bob');
		expect(result.sourceSnapshot.player2.data?.name).toBe('Alice');
	});

	it('replays an event stream to the same projection', () => {
		const snapshot = createSnapshot();
		const started = createInitialFeatureMatchState();
		const events: Array<[FeatureMatchCommandType | 'SessionStarted', Record<string, unknown>]> = [
			['SessionStarted', { sourceSnapshot: snapshot, currentState: started }],
			['AdjustLife', { player: 'player1', delta: -2 }],
			['SetCounters', { player: 'player1', counters: [{ type: 'energy', value: 4 }] }],
			['SelectFirstPlayer', { player: 'player2' }],
			['StepTurn', { delta: 2 }],
			['RecordGameWin', { player: 'player2', resetLife: false, resetCounters: false }],
		];

		const replayed = events.reduce(
			(acc, [type, payload]) => reduce(acc.currentState, acc.sourceSnapshot, type, payload),
			{ currentState: createInitialFeatureMatchState(), sourceSnapshot: snapshot },
		);

		expect(replayed.currentState.player1.lifeTotal).toBe(18);
		expect(replayed.currentState.player1.counters).toEqual([{ type: 'energy', value: 4 }]);
		expect(replayed.currentState.player2.gameWins).toBe(1);
		expect(replayed.currentState.currentGame).toBe(2);
	});
});

describe('feature match session state service', () => {
	beforeEach(() => {
		resetDbMocks();
		mockPublishMessage.mockReset();
	});

	it('builds source snapshots from slot, event defaults, players, and slot overrides', async () => {
		const slot = createSlot({
			player1Id: 101,
			player1Data: { name: 'Display Alice', deckId: 77, gameData: { type: 'mtg', deckName: 'Aggro' } },
			player2Id: 202,
		});
		mockDb.query.players.findFirst
			.mockResolvedValueOnce({
				id: 101,
				eventId: 1,
				name: 'Alice',
				pronouns: 'she/her',
				externalId: 'p1',
				externalSource: 'melee',
				wins: 3,
				losses: 1,
				draws: 0,
				position: 2,
				points: 9,
				archetypeId: 7,
				lgs: 'Local',
				gameData: { type: 'mtg', deckName: 'Control', deckColors: 'U' },
			})
			.mockResolvedValueOnce({
				id: 202,
				eventId: 1,
				name: 'Bob',
				pronouns: null,
				externalId: null,
				externalSource: null,
				wins: 2,
				losses: 2,
				draws: 0,
				position: 8,
				points: 6,
				archetypeId: null,
				lgs: null,
				gameData: { type: 'mtg', deckName: 'Midrange' },
			});

		const snapshot = await featureMatchStateService().buildSourceSnapshot(slot, {
			...DEFAULT_FEATURE_MATCH_DEFAULTS,
			game: 'mtg',
			startingLife: 25,
		});

		expect(snapshot).toMatchObject({
			eventId: 1,
			slotId: 5,
			tableNumber: 12,
			defaults: expect.objectContaining({ startingLife: 25 }),
			player1: {
				playerId: 101,
				data: expect.objectContaining({
					name: 'Display Alice',
					deckId: 77,
					wins: 3,
					gameData: { type: 'mtg', deckName: 'Aggro' },
				}),
			},
			player2: {
				playerId: 202,
				data: expect.objectContaining({ name: 'Bob', points: 6 }),
			},
		});
		expect(snapshot.createdAt).toEqual(expect.any(Number));
	});

	it('preserves an explicit no-deck Match snapshot instead of falling back to the player primary deck', async () => {
		const slot = createSlot({
			player1Id: 101,
			player1Data: {
				name: 'Alice',
				deckId: null,
				archetypeId: null,
				gameData: { type: 'mtg', deckName: null, deckColors: null },
			},
		});
		const player = {
			id: 101,
			eventId: 1,
			name: 'Alice',
			archetypeId: 9,
			gameData: { type: 'mtg', deckName: 'Primary Deck', deckColors: 'R' },
		} as any;

		const snapshot = await featureMatchStateService().buildSourceSnapshot(
			slot,
			{ ...DEFAULT_FEATURE_MATCH_DEFAULTS, game: 'mtg' },
			new Map([[101, player]]),
		);

		expect(snapshot.player1.data).toEqual(expect.objectContaining({
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		}));
	});

	it('treats explicit empty deck identity as authoritative without any display fields', async () => {
		const slot = createSlot({
			player1Id: 101,
			player1Data: {
				deckId: null,
				archetypeId: null,
				gameData: { type: 'mtg', deckName: null, deckColors: null },
			},
		});
		const player = {
			id: 101,
			eventId: 1,
			name: 'Alice',
			archetypeId: 9,
			gameData: { type: 'mtg', deckName: 'Primary Deck', deckColors: 'R' },
		} as any;

		const snapshot = await featureMatchStateService().buildSourceSnapshot(
			slot,
			{ ...DEFAULT_FEATURE_MATCH_DEFAULTS, game: 'mtg' },
			new Map([[101, player]]),
		);

		expect(snapshot.player1.data).toEqual(expect.objectContaining({
			name: 'Alice',
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		}));
	});

	it('creates a session, discards the closed sessions\' receipts, and activates the slot', async () => {
		const slot = createSlot({ id: 7, tableNumber: 3 });
		const inserted = createDbSession({ id: 30, slotId: 7, sequence: 1 });
		mockDb.query.featureMatches.findFirst.mockResolvedValue(slot);
		mockDb.batch.mockResolvedValueOnce([[], [inserted], [], []]);

		const result = await featureMatchStateService().createSessionForSlot(7, 1, {
			...DEFAULT_FEATURE_MATCH_DEFAULTS,
			game: 'mtg',
		});

		expect(result).toBe(inserted);
		expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
			eventId: 1,
			slotId: 7,
			sequence: 1,
		}));
		expect(getChain('delete').where).toHaveBeenCalledOnce();
		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]?.[0]).toHaveLength(4);
	});

	it('rejects reuse of a command ID for a different command', async () => {
		mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
			commandType: 'SetLife',
			fingerprint: commandFingerprint('SetLife', { player: 'player1', lifeTotal: 10 }),
		});

		await expect(featureMatchStateService().applyCommand(10, 1, {
			commandId: 'same-command-id',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 11 },
			baseSequence: 3,
		})).rejects.toMatchObject({
			statusCode: 409,
			message: 'commandId has already been used for a different command',
		});

		expect(mockDb.query.featureMatchSessions.findFirst).not.toHaveBeenCalled();
	});

	it('treats a retried clock command as identical despite the timestamp reduction stamps on it', async () => {
		const latest = createDbSession();
		mockDb.query.liveStateCommandReceipts.findFirst.mockResolvedValue({
			commandType: 'StartClock',
			fingerprint: commandFingerprint('StartClock', {}),
		});
		mockDb.query.featureMatchSessions.findFirst.mockResolvedValue(latest);

		const result = await featureMatchStateService().applyCommand(10, 1, {
			commandId: 'same-clock-command',
			type: 'StartClock',
			payload: {},
			baseSequence: 3,
		});

		expect(result.sequence).toBe(latest.sequence);
		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('rejects a snapshot correction for another Event or Slot', async () => {
		const session = createDbSession({ slotId: 5 });
		mockDb.query.featureMatchSessions.findFirst.mockResolvedValue(session);

		await expect(featureMatchStateService().applyCommand(10, 1, {
			commandId: 'wrong-snapshot',
			type: 'SnapshotCorrected',
			payload: { sourceSnapshot: createSnapshot({ eventId: 2, slotId: 5 }) },
			baseSequence: 3,
		})).rejects.toMatchObject({
			statusCode: 400,
			message: 'Snapshot correction does not belong to this session',
		});

		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('retries mergeable commands against the latest session after a sequence conflict', async () => {
		const session = createDbSession({ sequence: 3 });
		const latest = createDbSession({ sequence: 4 });
		const updated = createDbSession({
			sequence: 5,
			currentState: reduce(latest.currentState, latest.sourceSnapshot, 'AdjustLife', { player: 'player1', delta: -1 }).currentState,
		});
		mockDb.query.featureMatchSessions.findFirst
			.mockResolvedValueOnce(session)
			.mockResolvedValueOnce(latest);
		mockDb.batch
			.mockResolvedValueOnce([undefined, []])
			.mockResolvedValueOnce([undefined, [updated]]);

		const result = await featureMatchStateService().applyCommand(10, 1, {
			commandId: 'cmd-merge',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -1 },
			baseSequence: 1,
		});

		expect(result.sequence).toBe(5);
		expect(result.currentState.player1.lifeTotal).toBe(19);
		expect(mockDb.batch).toHaveBeenCalledTimes(2);
		expect(getChain('insert').select).toHaveBeenCalledTimes(2);
		expect(getChain('insert').values).not.toHaveBeenCalled();
	});

	describe('post-commit publication', () => {
		function stageSuccessfulCommit(): DbFeatureMatchSession {
			const session = createDbSession({ sequence: 3 });
			const updated = createDbSession({
				sequence: 4,
				currentState: reduce(session.currentState, session.sourceSnapshot, 'SetLife', { player: 'player1', lifeTotal: 12 }).currentState,
			});
			mockDb.query.featureMatchSessions.findFirst.mockResolvedValue(session);
			// The projection update is the batch's last statement; the receipt writes
			// precede it.
			mockDb.batch.mockResolvedValue([[], [], [updated]]);
			return updated;
		}

		it('announces the applied event on the Event channel with the accepted snapshot and state', async () => {
			const updated = stageSuccessfulCommit();

			await featureMatchStateService().applyCommand(10, 1, {
				commandId: 'cmd-publish',
				type: 'SetLife',
				payload: { player: 'player1', lifeTotal: 12 },
				baseSequence: 3,
			}, 'origin-1', { publish: true });

			expect(mockPublishMessage).toHaveBeenCalledWith(
				1,
				'featureMatchSession:eventApplied',
				{
					slotId: updated.slotId,
					sessionId: updated.id,
					sequence: 4,
					eventType: 'SetLife',
					sourceSnapshot: updated.sourceSnapshot,
					currentState: updated.currentState,
				},
				'origin-1',
			);
		});

		it('omits the session response from the announced payload', async () => {
			stageSuccessfulCommit();

			await featureMatchStateService().applyCommand(10, 1, {
				commandId: 'cmd-publish-shape',
				type: 'SetLife',
				payload: { player: 'player1', lifeTotal: 12 },
				baseSequence: 3,
			}, 'origin-1', { publish: true });

			const [,, payload] = mockPublishMessage.mock.calls[0]!;
			expect(payload).not.toHaveProperty('session');
		});

		it('stays silent for reverse-sync writes that carry their own notification', async () => {
			stageSuccessfulCommit();

			await featureMatchStateService().applyCommand(10, 1, {
				commandId: 'cmd-silent',
				type: 'SetLife',
				payload: { player: 'player1', lifeTotal: 12 },
				baseSequence: 3,
			});

			expect(mockPublishMessage).not.toHaveBeenCalled();
		});
	});
});

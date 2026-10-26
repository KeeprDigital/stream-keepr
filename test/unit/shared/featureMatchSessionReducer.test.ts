import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import { applyFeatureMatchSessionEvent, normalizeFeatureMatchSessionCommandPayload } from '~~/shared/modules/feature-match-session';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';


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
		player1: {
			playerId: 1,
			data: {
				name: 'Alice',
				wins: 3,
				losses: 1,
				draws: 0,
				gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
			},
		},
		player2: {
			playerId: 2,
			data: {
				name: 'Bob',
				wins: 2,
				losses: 2,
				draws: 0,
				gameData: { type: 'mtg', deckName: 'Control', deckColors: 'U' },
			},
		},
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
		state = reduce(state, snapshot, 'SetCounters', {
			player: 'player1',
			counters: [
				{ type: 'poison', value: 2 },
			],
		}).currentState;
		state = reduce(state, snapshot, 'SetCardsKept', { player: 'player2', cardsKept: 5 }).currentState;

		expect(state.player1.lifeTotal).toBe(17);
		expect(state.player2.lifeTotal).toBe(7);
		expect(state.player1.counters).toEqual([
			{ type: 'poison', value: 2 },
		]);
		expect(state.player2.cardsKept).toBe(5);
	});

	it('sets sideboardRevealed per player as an absolute setter', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();

		state = reduce(state, snapshot, 'SetSideboardRevealed', { player: 'player1', revealed: true }).currentState;
		expect(state.player1.sideboardRevealed).toBe(true);
		expect(state.player2.sideboardRevealed).toBe(false);

		state = reduce(state, snapshot, 'SetSideboardRevealed', { player: 'player1', revealed: false }).currentState;
		expect(state.player1.sideboardRevealed).toBe(false);
	});

	it('keeps sideboardRevealed across game boundaries and re-hides only on match reset', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();
		state = reduce(state, snapshot, 'SetSideboardRevealed', { player: 'player1', revealed: true }).currentState;
		state = reduce(state, snapshot, 'SetSideboardRevealed', { player: 'player2', revealed: true }).currentState;

		// A game win moves to the next game; the reveal survives, and nothing auto-reveals.
		state = reduce(state, snapshot, 'RecordGameWin', { player: 'player1' }).currentState;
		expect(state.player1.sideboardRevealed).toBe(true);
		expect(state.player2.sideboardRevealed).toBe(true);

		// A game reset must not touch it either.
		state = reduce(state, snapshot, 'ResetState', { type: 'game' }).currentState;
		expect(state.player1.sideboardRevealed).toBe(true);
		expect(state.player2.sideboardRevealed).toBe(true);

		// Only a match reset re-hides.
		state = reduce(state, snapshot, 'ResetState', { type: 'match' }).currentState;
		expect(state.player1.sideboardRevealed).toBe(false);
		expect(state.player2.sideboardRevealed).toBe(false);
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

	it('keeps a swapped session swapped when a correction rebuilt from the slot arrives', () => {
		const swapped = reduce(createInitialFeatureMatchState(), createSnapshot(), 'SwapPlayers', {});
		// A correction is built by `buildSourceSnapshot` from the Slot row, which
		// carries no record of the swap — so it always arrives in Slot order.
		const rebuiltFromSlot = createSnapshot({ tableNumber: 20 });

		const result = reduce(swapped.currentState, swapped.sourceSnapshot, 'SnapshotCorrected', { sourceSnapshot: rebuiltFromSlot });

		// The correction's own facts land, and the sides the operator chose survive
		// it. Taking the rebuild verbatim pairs Alice's name with Bob's life total.
		expect(result.sourceSnapshot.tableNumber).toBe(20);
		expect(result.sourceSnapshot.player1.data?.name).toBe('Bob');
		expect(result.sourceSnapshot.player2.data?.name).toBe('Alice');
		expect(result.currentState).toEqual(swapped.currentState);
	});

	it('leaves an unswapped session in slot order when a correction arrives', () => {
		const snapshot = createSnapshot();
		const rebuiltFromSlot = createSnapshot({ tableNumber: 20 });

		const result = reduce(createInitialFeatureMatchState(), snapshot, 'SnapshotCorrected', { sourceSnapshot: rebuiltFromSlot });

		expect(result.sourceSnapshot.player1.data?.name).toBe('Alice');
		expect(result.sourceSnapshot.player2.data?.name).toBe('Bob');
	});

	it('keeps the creation stamp the session has been holding when a correction arrives', () => {
		const snapshot = createSnapshot({ createdAt: 1000 });
		// A correction is rebuilt by `buildSourceSnapshot`, which stamps `Date.now()`
		// every time it runs — so it always arrives claiming its own build time.
		const rebuiltFromSlot = createSnapshot({ tableNumber: 20, createdAt: 5000 });

		const result = reduce(createInitialFeatureMatchState(), snapshot, 'SnapshotCorrected', { sourceSnapshot: rebuiltFromSlot });

		expect(result.sourceSnapshot.createdAt).toBe(1000);
		// The control: everything the correction is actually for still lands.
		expect(result.sourceSnapshot.tableNumber).toBe(20);
	});

	it('keeps the creation stamp through a correction to a swapped session', () => {
		// The two facts a rebuild cannot know are restored together, so neither can be
		// reinstated in a way that drops the other.
		const swapped = reduce(createInitialFeatureMatchState(), createSnapshot({ createdAt: 1000 }), 'SwapPlayers', {});
		const rebuiltFromSlot = createSnapshot({ tableNumber: 20, createdAt: 5000 });

		const result = reduce(swapped.currentState, swapped.sourceSnapshot, 'SnapshotCorrected', { sourceSnapshot: rebuiltFromSlot });

		expect(result.sourceSnapshot.createdAt).toBe(1000);
		expect(result.sourceSnapshot.player1.data?.name).toBe('Bob');
		expect(result.sourceSnapshot.tableNumber).toBe(20);
	});

	it('returns a twice-swapped session to slot order across a correction', () => {
		const once = reduce(createInitialFeatureMatchState(), createSnapshot(), 'SwapPlayers', {});
		const twice = reduce(once.currentState, once.sourceSnapshot, 'SwapPlayers', {});

		const result = reduce(twice.currentState, twice.sourceSnapshot, 'SnapshotCorrected', {
			sourceSnapshot: createSnapshot(),
		});

		expect(result.sourceSnapshot.player1.data?.name).toBe('Alice');
		expect(result.sourceSnapshot.player2.data?.name).toBe('Bob');
	});

	it('folds a Batch of setter events into one atomic reduction', () => {
		const snapshot = createSnapshot();
		const state = createInitialFeatureMatchState();

		const result = reduce(state, snapshot, 'Batch', {
			commands: [
				{
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 12 },
				},
				{
					type: 'SetLife',
					payload: { player: 'player2', lifeTotal: 9 },
				},
				{
					type: 'SetCounters',
					payload: {
						player: 'player1',
						counters: [
							{ type: 'poison', value: 3 },
						],
					},
				},
				{
					type: 'SetCardsKept',
					payload: { player: 'player2', cardsKept: 6 },
				},
				{
					type: 'SetSideboardRevealed',
					payload: { player: 'player1', revealed: true },
				},
				{
					type: 'SetSideboardRevealed',
					payload: { player: 'player2', revealed: true },
				},
				{
					type: 'SetClock',
					payload: { at: 6000, targetMs: 30_000 },
				},
				{
					type: 'SetFirstPlayer',
					payload: { player: 'player2' },
				},
				{
					type: 'SetActivePlayer',
					payload: { player: 'player1' },
				},
				{
					type: 'SetTurnNumber',
					payload: { turnNumber: 4 },
				},
				{
					type: 'StartOvertime',
					payload: { totalTurns: 3 },
				},
			],
		});

		expect(result.currentState.player1.lifeTotal).toBe(12);
		expect(result.currentState.player2.lifeTotal).toBe(9);
		expect(result.currentState.player1.counters).toEqual([
			{ type: 'poison', value: 3 },
		]);
		expect(result.currentState.player2.cardsKept).toBe(6);
		expect(result.currentState.player1.sideboardRevealed).toBe(true);
		expect(result.currentState.player2.sideboardRevealed).toBe(true);
		expect(result.currentState.firstPlayer).toBe('player2');
		expect(result.currentState.activePlayer).toBe('player1');
		expect(result.currentState.turnNumber).toBe(4);
		expect(result.currentState.overtime?.totalTurns).toBe(3);
		expect(result.sourceSnapshot).toEqual(snapshot);
	});

	it('applies Batch sub-commands in order, so later fields win over earlier side effects', () => {
		const snapshot = createSnapshot();
		const state = createInitialFeatureMatchState();

		// SelectFirstPlayer forces turnNumber to 1; a later SetTurnNumber in the
		// same batch must land on top of it, exactly as the serial commands did.
		const result = reduce(state, snapshot, 'Batch', {
			commands: [
				{
					type: 'SelectFirstPlayer',
					payload: { player: 'player1' },
				},
				{
					type: 'SetTurnNumber',
					payload: { turnNumber: 7 },
				},
			],
		});

		expect(result.currentState.firstPlayer).toBe('player1');
		expect(result.currentState.activePlayer).toBe('player1');
		expect(result.currentState.turnNumber).toBe(7);
	});

	it('stamps clock timestamps inside a Batch payload during normalization', () => {
		const normalized = normalizeFeatureMatchSessionCommandPayload('Batch', {
			commands: [
				{
					type: 'SetClock',
					payload: { targetMs: 30_000 },
				},
				{
					type: 'SetLife',
					payload: { player: 'player1', lifeTotal: 12 },
				},
			],
		}, () => 4242) as { commands: { type: string; payload: Record<string, unknown> }[] };

		expect(normalized.commands[0]?.payload).toEqual({ targetMs: 30_000, at: 4242 });
		expect(normalized.commands[1]?.payload).toEqual({ player: 'player1', lifeTotal: 12 });
	});

	it('replays an event stream to the same projection', () => {
		const snapshot = createSnapshot();
		const started = createInitialFeatureMatchState();
		const events: Array<[FeatureMatchCommandType | 'SessionStarted', Record<string, unknown>]> = [
			[
				'SessionStarted',
				{ sourceSnapshot: snapshot, currentState: started },
			],
			[
				'AdjustLife',
				{ player: 'player1', delta: -2 },
			],
			[
				'SetCounters',
				{
					player: 'player1',
					counters: [
						{ type: 'energy', value: 4 },
					],
				},
			],
			[
				'SelectFirstPlayer',
				{ player: 'player2' },
			],
			[
				'StepTurn',
				{ delta: 2 },
			],
			[
				'RecordGameWin',
				{ player: 'player2', resetLife: false, resetCounters: false },
			],
		];

		const replayed = events.reduce(
			(acc, [type, payload]) => reduce(acc.currentState, acc.sourceSnapshot, type, payload),
			{
				currentState: createInitialFeatureMatchState(),
				sourceSnapshot: snapshot,
			},
		);

		expect(replayed.currentState.player1.lifeTotal).toBe(18);
		expect(replayed.currentState.player1.counters).toEqual([
			{ type: 'energy', value: 4 },
		]);
		expect(replayed.currentState.player2.gameWins).toBe(1);
		expect(replayed.currentState.currentGame).toBe(2);
	});
});

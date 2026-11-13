import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import {
	applyFeatureMatchSessionEvent,
	createInitialFeatureMatchSessionStateFromSnapshot,
	isCommandOutsideSessionVariant,
} from '~~/shared/modules/feature-match-session';
import { SEAT_VALUES } from '~~/shared/types/enums';
import { createInitialFeatureMatchState, createInitialOvertimeState } from '~~/shared/types/featureMatchState';
import { ATRAXA, KRAUM, TYMNA } from '~~/test/helpers/commanders';
import { commanderSnapshot, seatedPlayer, twoPlayerSnapshot } from '~~/test/helpers/featureMatchSnapshots';

/** A Commander Session as it opens, then each command applied in turn. */
function play(
	snapshot: FeatureMatchSourceSnapshot,
	...commands: [FeatureMatchCommandType, Record<string, unknown>][]
) {
	let result = {
		currentState: createInitialFeatureMatchSessionStateFromSnapshot(snapshot),
		sourceSnapshot: snapshot,
	};
	for (const [type, payload] of commands)
		result = applyFeatureMatchSessionEvent(result.currentState, result.sourceSnapshot, type, payload);
	return result;
}

const lifeOf = (state: FeatureMatchState) => SEAT_VALUES.map(seat => state[seat]?.lifeTotal);
function damage(player: Seat, from: Seat, commander: 1 | 2, delta: number): [FeatureMatchCommandType, Record<string, unknown>] {
	return [
		'AdjustCommanderDamage',
		{ player, from, commander, delta },
	];
}
function eliminate(player: Seat, eliminated = true): [FeatureMatchCommandType, Record<string, unknown>] {
	return [
		'SetEliminated',
		{ player, eliminated },
	];
}
function step(delta = 1): [FeatureMatchCommandType, Record<string, unknown>] {
	return [
		'StepTurn',
		{ delta },
	];
}
function goesFirst(player: Seat): [FeatureMatchCommandType, Record<string, unknown>] {
	return [
		'SelectFirstPlayer',
		{ player },
	];
}

/** The turn after each of `steps` forward steps, as `[active Seat, turn number]`. */
function turns(snapshot: FeatureMatchSourceSnapshot, setup: [FeatureMatchCommandType, Record<string, unknown>][], steps: number) {
	const seen: [Seat | null | undefined, number][] = [];
	let result = play(snapshot, ...setup);
	for (let taken = 0; taken < steps; taken++) {
		result = applyFeatureMatchSessionEvent(result.currentState, result.sourceSnapshot, 'StepTurn', { delta: 1 });
		seen.push([result.currentState.activePlayer, result.currentState.turnNumber]);
	}
	return seen;
}

describe('a Commander Session', () => {
	it('opens every Seat at the Event\'s starting life, with no damage and nobody Eliminated', () => {
		const state = createInitialFeatureMatchSessionStateFromSnapshot(commanderSnapshot({ startingLife: 30 }));

		expect(lifeOf(state)).toEqual([30, 30, 30, 30]);
		expect(SEAT_VALUES.map(seat => [state[seat]?.commanderDamage, state[seat]?.eliminated]))
			.toEqual(SEAT_VALUES.map(() => [[], false]));
	});

	describe('commander Damage', () => {
		it('is counted against the Commander that dealt it and lowers life by the same amount', () => {
			const { currentState } = play(commanderSnapshot(), damage('player2', 'player1', 1, 5));

			expect(currentState.player2.commanderDamage).toEqual([
				{ seat: 'player1', commander: 1, damage: 5 },
			]);
			expect(lifeOf(currentState)).toEqual([40, 35, 40, 40]);
		});

		it('taken back restores the count and the life', () => {
			const snapshot = commanderSnapshot();
			const { currentState } = play(snapshot, damage('player2', 'player1', 1, 5), damage('player2', 'player1', 1, -5));

			expect(currentState).toEqual(createInitialFeatureMatchSessionStateFromSnapshot(snapshot));
		});

		it('counts each Commander of a pair, and each Seat\'s, separately', () => {
			const { currentState } = play(
				commanderSnapshot(),
				damage('player1', 'player3', 1, 4),
				damage('player1', 'player3', 2, 2),
				damage('player1', 'player2', 1, 1),
				damage('player1', 'player3', 1, 3),
			);

			expect(currentState.player1.commanderDamage).toEqual([
				{ seat: 'player3', commander: 1, damage: 7 },
				{ seat: 'player3', commander: 2, damage: 2 },
				{ seat: 'player2', commander: 1, damage: 1 },
			]);
			expect(currentState.player1.lifeTotal).toBe(30);
		});

		it('taken back past none stops at none, and raises life only by what was there', () => {
			const { currentState } = play(commanderSnapshot(), damage('player2', 'player1', 1, 3), damage('player2', 'player1', 1, -10));

			expect(currentState.player2.commanderDamage).toEqual([]);
			expect(currentState.player2.lifeTotal).toBe(40);
		});

		it.each([
			[
				'its own Commander',
				{
					player: 'player1',
					from: 'player1',
					commander: 1,
					delta: 1,
				},
			],
			[
				'a Commander the Seat does not hold',
				{
					player: 'player1',
					from: 'player2',
					commander: 2,
					delta: 1,
				},
			],
			[
				'an empty Seat\'s Commander',
				{
					player: 'player1',
					from: 'player4',
					commander: 1,
					delta: 1,
				},
			],
			[
				'damage to an empty Seat',
				{
					player: 'player4',
					from: 'player1',
					commander: 1,
					delta: 1,
				},
			],
			[
				'an amount that is not a number',
				{
					player: 'player2',
					from: 'player1',
					commander: 1,
					delta: 'lots',
				},
			],
		])('refuses %s', (_case, payload) => {
			const snapshot = commanderSnapshot({ player4: null });
			const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);

			expect(applyFeatureMatchSessionEvent(opened, snapshot, 'AdjustCommanderDamage', payload).currentState).toBe(opened);
		});
	});

	describe('eliminated', () => {
		it('is set and cleared by its command alone', () => {
			const set = play(commanderSnapshot(), eliminate('player3'));
			expect(SEAT_VALUES.map(seat => set.currentState[seat]?.eliminated)).toEqual([false, false, true, false]);

			const cleared = applyFeatureMatchSessionEvent(set.currentState, set.sourceSnapshot, 'SetEliminated', { player: 'player3', eliminated: false });
			expect(cleared.currentState.player3?.eliminated).toBe(false);
		});

		// Nothing derives it: lethal life, 21 from one Commander and ten poison all leave the Seat in the game.
		it('is not derived from life, Commander Damage or poison', () => {
			const { currentState } = play(
				commanderSnapshot(),
				[
					'SetLife',
					{ player: 'player2', lifeTotal: 0 },
				],
				damage('player2', 'player1', 1, 21),
				[
					'SetCounters',
					{
						player: 'player2',
						counters: [
							{ type: 'poison', value: 10 },
						],
					},
				],
			);

			expect(currentState.player2.eliminated).toBe(false);
			expect(currentState.isComplete).toBe(false);
		});
	});

	describe('the turn', () => {
		it('passes in Seat order, and its number goes up each time it returns to the Seat that went first', () => {
			expect(turns(commanderSnapshot(), [
				goesFirst('player3'),
			], 5)).toEqual([
				['player4', 1],
				['player1', 1],
				['player2', 1],
				['player3', 2],
				['player4', 2],
			]);
		});

		it('passes over an Eliminated Seat and an empty one', () => {
			const snapshot = commanderSnapshot({ player4: null });

			expect(turns(snapshot, [
				goesFirst('player1'),
				eliminate('player3'),
			], 4)).toEqual([
				['player2', 1],
				['player1', 2],
				['player2', 2],
				['player1', 3],
			]);
		});

		it('still counts a round when the Seat that went first is Eliminated', () => {
			expect(turns(commanderSnapshot(), [
				goesFirst('player1'),
				step(),
				eliminate('player1'),
			], 4)).toEqual([
				['player3', 1],
				['player4', 1],
				['player2', 2],
				['player3', 2],
			]);
		});

		it('steps back the way it came, and not before the first turn', () => {
			const snapshot = commanderSnapshot({ player4: null });
			const ahead = play(snapshot, goesFirst('player2'), eliminate('player3'), step(3));
			expect([ahead.currentState.activePlayer, ahead.currentState.turnNumber]).toEqual(['player1', 2]);

			const back = applyFeatureMatchSessionEvent(ahead.currentState, snapshot, 'StepTurn', { delta: -2 });
			expect([back.currentState.activePlayer, back.currentState.turnNumber]).toEqual(['player1', 1]);

			const floor = applyFeatureMatchSessionEvent(back.currentState, snapshot, 'StepTurn', { delta: -5 });
			expect([floor.currentState.activePlayer, floor.currentState.turnNumber]).toEqual(['player2', 1]);
		});

		it('stays where it is when no Seat is left to take it', () => {
			const all = play(commanderSnapshot(), goesFirst('player1'), ...SEAT_VALUES.map(seat => eliminate(seat)));

			expect(applyFeatureMatchSessionEvent(all.currentState, all.sourceSnapshot, 'StepTurn', { delta: 1 }).currentState)
				.toEqual(all.currentState);
		});

		it('cannot start from an empty Seat', () => {
			const snapshot = commanderSnapshot({ player4: null });
			const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);

			expect(applyFeatureMatchSessionEvent(opened, snapshot, 'SelectFirstPlayer', { player: 'player4' }).currentState).toBe(opened);
		});
	});

	describe('completion', () => {
		it.each([
			[
				'a winning Seat',
				{ winner: 'player2' },
			],
			[
				'a draw',
				{ winner: null },
			],
		])('completes when %s is declared', (_case, outcome) => {
			const { currentState } = play(commanderSnapshot(), [
				'SetOutcome',
				{ outcome },
			]);

			expect(currentState.isComplete).toBe(true);
			expect(currentState.outcome).toEqual(outcome);
		});

		it('reopens when the outcome is taken back', () => {
			const { currentState } = play(commanderSnapshot(), [
				'SetOutcome',
				{
					outcome: { winner: 'player2' },
				},
			], [
				'SetOutcome',
				{ outcome: null },
			]);

			expect(currentState.isComplete).toBe(false);
			expect(currentState.outcome).toBeUndefined();
		});

		it('refuses an empty Seat as the winner', () => {
			const snapshot = commanderSnapshot({ player3: null });
			const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);

			expect(applyFeatureMatchSessionEvent(opened, snapshot, 'SetOutcome', {
				outcome: { winner: 'player3' },
			}).currentState).toBe(opened);
		});

		// One game: no game win, best-of, extra turns, Sideboard reveal or Session-only swap.
		it.each([
			[
				'RecordGameWin',
				{ player: 'player1' },
			],
			[
				'UndoGameWin',
				{ player: 'player1' },
			],
			[
				'StartOvertime',
				{ totalTurns: 5 },
			],
			[
				'StepOvertime',
				{ delta: 1 },
			],
			[
				'SetSideboardRevealed',
				{ player: 'player1', revealed: true },
			],
			['SwapPlayers', {}],
		] as const)('refuses %s', (type, payload) => {
			const snapshot = commanderSnapshot({ clockType: 'countdown' });
			const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
			// A game win to undo and extra turns to step, so each command would change the state were it taken.
			const state: FeatureMatchState = {
				...opened,
				player1: { ...opened.player1, gameWins: 1 },
				overtime: createInitialOvertimeState(5),
			};

			expect(applyFeatureMatchSessionEvent(state, snapshot, type, payload).currentState).toBe(state);
		});

		it('starts a new game with the same players on a reset, its clock included', () => {
			const snapshot = commanderSnapshot({ clockType: 'countdown' });
			const played = play(
				snapshot,
				[
					'StartClock',
					{ at: 5_000 },
				],
				goesFirst('player2'),
				step(),
				damage('player1', 'player2', 1, 6),
				eliminate('player3'),
				[
					'SetCounters',
					{
						player: 'player4',
						counters: [
							{ type: 'poison', value: 2 },
						],
					},
				],
				[
					'SetCardsKept',
					{ player: 'player4', cardsKept: 6 },
				],
				[
					'SetOutcome',
					{
						outcome: { winner: 'player2' },
					},
				],
			);

			const reset = applyFeatureMatchSessionEvent(played.currentState, snapshot, 'ResetState', { type: 'game' });

			expect(reset.currentState).toEqual(createInitialFeatureMatchSessionStateFromSnapshot(snapshot));
			expect(reset.sourceSnapshot).toBe(snapshot);
		});
	});

	describe('a Seat filled or emptied mid-Session', () => {
		it('joins at starting life when filled, the others untouched', () => {
			const opened = play(commanderSnapshot({ player4: null }), [
				'AdjustLife',
				{ player: 'player1', delta: -7 },
			], [
				'AdjustLife',
				{ player: 'player4', delta: -3 },
			]);

			const joined = applyFeatureMatchSessionEvent(opened.currentState, opened.sourceSnapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot(),
			});

			expect(lifeOf(joined.currentState)).toEqual([33, 40, 40, 40]);
			expect(joined.sourceSnapshot.player4?.data?.name).toBe('Dara');
		});

		it('leaves at once when emptied: its state goes, and so does the damage its Commanders dealt', () => {
			const played = play(
				commanderSnapshot(),
				damage('player1', 'player3', 1, 4),
				damage('player1', 'player2', 1, 2),
				damage('player3', 'player1', 1, 9),
				eliminate('player3'),
			);

			const left = applyFeatureMatchSessionEvent(played.currentState, played.sourceSnapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot({ player3: null }),
			});

			expect(left.currentState.player3).toEqual(createInitialFeatureMatchSessionStateFromSnapshot(commanderSnapshot()).player3);
			expect(left.currentState.player1.commanderDamage).toEqual([
				{ seat: 'player2', commander: 1, damage: 2 },
			]);
			// Life already lost stays lost.
			expect(left.currentState.player1.lifeTotal).toBe(34);
		});

		it('leaves the turn order: the turn it held passes to the next Seat', () => {
			const played = play(commanderSnapshot(), goesFirst('player1'), step(3));
			expect(played.currentState.activePlayer).toBe('player4');

			const left = applyFeatureMatchSessionEvent(played.currentState, played.sourceSnapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot({ player4: null }),
			});

			expect([left.currentState.activePlayer, left.currentState.turnNumber]).toEqual(['player1', 2]);
			const next = applyFeatureMatchSessionEvent(left.currentState, left.sourceSnapshot, 'StepTurn', { delta: 3 });
			expect([next.currentState.activePlayer, next.currentState.turnNumber]).toEqual(['player1', 3]);
		});

		it('waits on a Seat to go first again when the turn it held has nobody to pass to', () => {
			const snapshot = commanderSnapshot({ player3: null, player4: null });
			const played = play(snapshot, goesFirst('player1'), eliminate('player2'));

			const left = applyFeatureMatchSessionEvent(played.currentState, snapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot({ player1: null, player3: null, player4: null }),
			});

			expect([left.currentState.activePlayer, left.currentState.firstPlayer]).toEqual([null, null]);
		});

		it('keeps a Seat\'s state through an edit that leaves it filled', () => {
			const played = play(commanderSnapshot(), damage('player2', 'player1', 1, 5), eliminate('player2'));

			const edited = applyFeatureMatchSessionEvent(played.currentState, played.sourceSnapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot({
					player2: seatedPlayer('Renamed', [TYMNA]),
				}),
			});

			expect(edited.currentState).toEqual(played.currentState);
		});

		it('drops the damage of a Commander its Seat no longer holds', () => {
			const played = play(commanderSnapshot(), damage('player1', 'player3', 1, 3), damage('player1', 'player3', 2, 4));

			const edited = applyFeatureMatchSessionEvent(played.currentState, played.sourceSnapshot, 'SnapshotCorrected', {
				sourceSnapshot: commanderSnapshot({
					player3: seatedPlayer('Cleo', [TYMNA]),
				}),
			});

			expect(edited.currentState.player1.commanderDamage).toEqual([
				{ seat: 'player3', commander: 1, damage: 3 },
			]);
		});
	});

	describe('swap Seats', () => {
		it('moves each player\'s live state with them, and everything that names their Seat', () => {
			const played = play(
				commanderSnapshot(),
				goesFirst('player1'),
				[
					'AdjustLife',
					{ player: 'player1', delta: -10 },
				],
				damage('player2', 'player1', 1, 5),
				damage('player1', 'player3', 2, 2),
				eliminate('player3'),
				[
					'SetOutcome',
					{
						outcome: { winner: 'player1' },
					},
				],
			);
			const swappedSlot = commanderSnapshot({
				player1: seatedPlayer('Cleo', [TYMNA, KRAUM]),
				player3: seatedPlayer('Ana', [ATRAXA]),
			});

			const { currentState, sourceSnapshot } = applyFeatureMatchSessionEvent(played.currentState, played.sourceSnapshot, 'SwapSeats', {
				seats: ['player1', 'player3'],
				sourceSnapshot: swappedSlot,
			});

			expect(lifeOf(currentState)).toEqual([40, 35, 28, 40]);
			expect(currentState.player1.eliminated).toBe(true);
			expect(currentState.player2.commanderDamage).toEqual([
				{ seat: 'player3', commander: 1, damage: 5 },
			]);
			expect(currentState.player3?.commanderDamage).toEqual([
				{ seat: 'player1', commander: 2, damage: 2 },
			]);
			expect([currentState.firstPlayer, currentState.activePlayer, currentState.outcome?.winner]).toEqual(['player3', 'player3', 'player3']);
			expect(sourceSnapshot.player1.data?.name).toBe('Cleo');
			expect(sourceSnapshot.createdAt).toBe(played.sourceSnapshot.createdAt);
		});

		it('moves a player to an empty Seat without that Seat joining afresh', () => {
			const opened = play(commanderSnapshot({ player4: null }), [
				'AdjustLife',
				{ player: 'player2', delta: -12 },
			]);

			const { currentState } = applyFeatureMatchSessionEvent(opened.currentState, opened.sourceSnapshot, 'SwapSeats', {
				seats: ['player2', 'player4'],
				sourceSnapshot: commanderSnapshot({
					player2: null,
					player4: seatedPlayer('Ben', [TYMNA]),
				}),
			});

			expect(lifeOf(currentState)).toEqual([40, 40, 40, 28]);
		});
	});
});

describe('a Two-Player Session', () => {
	it('opens with the state it always has', () => {
		expect(createInitialFeatureMatchSessionStateFromSnapshot(twoPlayerSnapshot()))
			.toEqual(createInitialFeatureMatchState(20, 'countdown', 50 * 60 * 1000, true));
	});

	// Seats 3 and 4 and the Commander commands are a Commander Session's alone (ADR-0087).
	it.each([
		[
			'AdjustLife',
			{ player: 'player3', delta: -1 },
		],
		[
			'AdjustCommanderDamage',
			{
				player: 'player2',
				from: 'player1',
				commander: 1,
				delta: 5,
			},
		],
		[
			'SetEliminated',
			{ player: 'player1', eliminated: true },
		],
		[
			'SetOutcome',
			{
				outcome: { winner: 'player1' },
			},
		],
		[
			'SwapSeats',
			{
				seats: ['player1', 'player2'],
				sourceSnapshot: twoPlayerSnapshot(),
			},
		],
	] as const)('refuses %s', (type, payload) => {
		// Even were its Seats to hold Commanders, and a third Seat a state.
		const snapshot = twoPlayerSnapshot({
			player1: {
				playerId: null,
				data: seatedPlayer('Alice', [ATRAXA]),
			},
			player2: {
				playerId: null,
				data: seatedPlayer('Bob', [TYMNA]),
			},
		});
		const opened = createInitialFeatureMatchSessionStateFromSnapshot(snapshot);
		const state: FeatureMatchState = { ...opened, player3: opened.player1 };

		const result = applyFeatureMatchSessionEvent(state, snapshot, type, payload);

		expect(result.currentState).toBe(state);
		expect(result.sourceSnapshot).toBe(snapshot);
	});

	it('still steps its turn by halves', () => {
		const snapshot = twoPlayerSnapshot();
		const { currentState } = play(snapshot, goesFirst('player2'), step());

		expect([currentState.activePlayer, currentState.turnNumber]).toEqual(['player1', 1]);
	});
});

// What the API answers 400 to: a command a Session of this Variant never takes.
describe('a command outside its Session\'s Variant', () => {
	it.each([
		{
			session: 'a Two-Player Session',
			snapshot: twoPlayerSnapshot(),
			type: 'SetEliminated',
			payload: { player: 'player1', eliminated: true },
			outside: true,
		},
		{
			session: 'a Two-Player Session',
			snapshot: twoPlayerSnapshot(),
			type: 'AdjustLife',
			payload: { player: 'player4', delta: -1 },
			outside: true,
		},
		{
			session: 'a Two-Player Session',
			snapshot: twoPlayerSnapshot(),
			type: 'AdjustLife',
			payload: { player: 'player2', delta: -1 },
			outside: false,
		},
		{
			session: 'a Two-Player Session',
			snapshot: twoPlayerSnapshot(),
			type: 'Batch',
			payload: {
				commands: [
					{
						type: 'SetLife',
						payload: { player: 'player1', lifeTotal: 3 },
					},
					{
						type: 'SetLife',
						payload: { player: 'player3', lifeTotal: 3 },
					},
				],
			},
			outside: true,
		},
		{
			session: 'a Commander Session',
			snapshot: commanderSnapshot(),
			type: 'RecordGameWin',
			payload: { player: 'player1' },
			outside: true,
		},
		{
			session: 'a Commander Session',
			snapshot: commanderSnapshot(),
			type: 'AdjustLife',
			payload: { player: 'player4', delta: -1 },
			outside: false,
		},
	] as const)('for $session, $type $payload is outside: $outside', ({ snapshot, type, payload, outside }) => {
		expect(isCommandOutsideSessionVariant(snapshot, type, payload)).toBe(outside);
	});
});

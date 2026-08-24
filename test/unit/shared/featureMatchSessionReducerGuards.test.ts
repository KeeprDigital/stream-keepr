import type { FeatureMatchCommandType, FeatureMatchSourceSnapshot } from '~~/shared/types/featureMatchSession';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import { describe, expect, it } from 'vitest';
import { applyFeatureMatchSessionEvent } from '~~/shared/modules/feature-match-session';
import { DEFAULT_FEATURE_MATCH_DEFAULTS } from '~~/shared/types/featureMatchDefaults';
import { createInitialFeatureMatchState } from '~~/shared/types/featureMatchState';

function createSnapshot(): FeatureMatchSourceSnapshot {
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
		player1: { playerId: 1, data: { name: 'Alice' } },
		player2: { playerId: 2, data: { name: 'Bob' } },
		createdAt: 1000,
	};
}

/** A mid-match state where every guarded action has something real to act on. */
function createBusyState(): FeatureMatchState {
	const state = createInitialFeatureMatchState();
	return {
		...state,
		player1: { ...state.player1, lifeTotal: 14, gameWins: 1, counters: [{ type: 'poison', value: 2 }], cardsKept: 7 },
		player2: { ...state.player2, lifeTotal: 18, gameWins: 1 },
		clock: { ...state.clock, isRunning: true, lastStartedAt: 1_000, elapsedMs: 5_000 },
		turnNumber: 3,
		firstPlayer: 'player1',
		activePlayer: 'player2',
		overtime: { active: true, turnsRemaining: 2, totalTurns: 3 },
	};
}

/** Collect paths of every non-finite number nested anywhere in a value. */
function nonFinitePaths(value: unknown, path = '$'): string[] {
	if (typeof value === 'number')
		return Number.isFinite(value) ? [] : [path];
	if (Array.isArray(value))
		return value.flatMap((entry, index) => nonFinitePaths(entry, `${path}[${index}]`));
	if (value && typeof value === 'object')
		return Object.entries(value).flatMap(([key, entry]) => nonFinitePaths(entry, `${path}.${key}`));
	return [];
}

const NON_FINITE_VALUES: unknown[] = [Number.NaN, Infinity, -Infinity, 'abc', '12:34', {}, [1, 2]];

interface GuardCase {
	type: FeatureMatchCommandType;
	valid: Record<string, unknown>;
	numericFields: string[];
	state?: (state: FeatureMatchState) => FeatureMatchState;
}

const GUARD_CASES: GuardCase[] = [
	{ type: 'AdjustLife', valid: { player: 'player1', delta: 3 }, numericFields: ['delta'] },
	{ type: 'SetLife', valid: { player: 'player1', lifeTotal: 15 }, numericFields: ['lifeTotal'] },
	{ type: 'SetCardsKept', valid: { player: 'player1', cardsKept: 6 }, numericFields: ['cardsKept'] },
	{ type: 'SetSideboardRevealed', valid: { player: 'player1', revealed: true }, numericFields: [] },
	{ type: 'AdjustClock', valid: { at: 5_000, deltaMs: 1_000 }, numericFields: ['at', 'deltaMs'] },
	{ type: 'SetClock', valid: { at: 5_000, targetMs: 60_000 }, numericFields: ['at', 'targetMs'] },
	{
		type: 'StartClock',
		valid: { at: 5_000 },
		numericFields: ['at'],
		state: state => ({ ...state, clock: { ...state.clock, isRunning: false, lastStartedAt: null } }),
	},
	{ type: 'PauseClock', valid: { at: 5_000 }, numericFields: ['at'] },
	{ type: 'ResetClock', valid: { durationMs: 60_000 }, numericFields: ['durationMs'] },
	{ type: 'RestartClock', valid: { at: 5_000 }, numericFields: ['at'] },
	{ type: 'SetTurnNumber', valid: { turnNumber: 4 }, numericFields: ['turnNumber'] },
	{ type: 'RecordGameWin', valid: { player: 'player1', startingLife: 20 }, numericFields: ['startingLife'] },
	{ type: 'UndoGameWin', valid: { player: 'player1', startingLife: 20 }, numericFields: ['startingLife'] },
	{ type: 'ResetState', valid: { type: 'game', startingLife: 20 }, numericFields: ['startingLife'] },
	{ type: 'StartOvertime', valid: { totalTurns: 3 }, numericFields: ['totalTurns'] },
	{ type: 'StepTurn', valid: { delta: 1 }, numericFields: ['delta'] },
	{ type: 'StepOvertime', valid: { delta: 1 }, numericFields: ['delta'] },
];

describe('feature match session reducer payload guards', () => {
	it('never commits a non-finite number, for any action and any malformed numeric field', () => {
		const snapshot = createSnapshot();
		for (const guardCase of GUARD_CASES) {
			const state = guardCase.state ? guardCase.state(createBusyState()) : createBusyState();
			for (const field of guardCase.numericFields) {
				for (const malformed of NON_FINITE_VALUES) {
					const payload = { ...guardCase.valid, [field]: malformed };
					const label = `${guardCase.type} with ${field}=${String(malformed)}`;
					const result = applyFeatureMatchSessionEvent(state, snapshot, guardCase.type, payload);
					expect(nonFinitePaths(result.currentState), label).toEqual([]);
					expect(result.currentState, `${label} should be rejected unchanged`).toEqual(state);
				}
			}
		}
	});

	it('rejects an action whose required numeric field is missing', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();
		for (const [type, payload] of [
			['SetLife', { player: 'player1' }],
			['SetCardsKept', { player: 'player1' }],
			['SetTurnNumber', {}],
			['StartOvertime', {}],
			['PauseClock', {}],
		] as [FeatureMatchCommandType, Record<string, unknown>][]) {
			const result = applyFeatureMatchSessionEvent(state, snapshot, type, payload);
			expect(nonFinitePaths(result.currentState), type).toEqual([]);
			expect(result.currentState, `${type} without its numeric field should be rejected unchanged`).toEqual(state);
		}
	});

	it('rejects player-scoped actions whose player is not a valid side, without throwing', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();
		for (const type of ['AdjustLife', 'SetLife', 'SetCounters', 'SetCardsKept', 'SetSideboardRevealed', 'SelectFirstPlayer', 'SetFirstPlayer', 'RecordGameWin', 'UndoGameWin'] as FeatureMatchCommandType[]) {
			for (const player of ['playerX', null, undefined, {}, 3]) {
				const result = applyFeatureMatchSessionEvent(state, snapshot, type, { ...GUARD_CASES.find(c => c.type === type)?.valid, player });
				expect(result.currentState, `${type} with player=${String(player)}`).toEqual(state);
			}
		}
	});

	it('allows SetActivePlayer to clear the active player but rejects invalid sides', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();

		const cleared = applyFeatureMatchSessionEvent(state, snapshot, 'SetActivePlayer', { player: null });
		expect(cleared.currentState.activePlayer).toBeNull();

		const rejected = applyFeatureMatchSessionEvent(state, snapshot, 'SetActivePlayer', { player: 'playerX' });
		expect(rejected.currentState).toEqual(state);
	});

	it('rejects SetCounters payloads whose entries are not finite-valued counters', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();
		for (const counters of [
			'not-an-array',
			[{ type: 'poison', value: Number.NaN }],
			[{ type: 'poison', value: Infinity }],
			[{ type: 'poison', value: '3' }],
			[{ value: 3 }],
			[null],
		]) {
			const result = applyFeatureMatchSessionEvent(state, snapshot, 'SetCounters', { player: 'player1', counters });
			expect(result.currentState, JSON.stringify(counters)).toEqual(state);
		}

		const applied = applyFeatureMatchSessionEvent(state, snapshot, 'SetCounters', { player: 'player1', counters: [{ type: 'energy', value: 4 }] });
		expect(applied.currentState.player1.counters).toEqual([{ type: 'energy', value: 4 }]);
	});

	it('rejects SetSideboardRevealed payloads whose revealed flag is not a strict boolean', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();
		for (const revealed of ['true', 1, 0, null, undefined, {}, []]) {
			const result = applyFeatureMatchSessionEvent(state, snapshot, 'SetSideboardRevealed', { player: 'player1', revealed });
			expect(result.currentState, `revealed=${String(revealed)}`).toEqual(state);
		}

		const applied = applyFeatureMatchSessionEvent(state, snapshot, 'SetSideboardRevealed', { player: 'player1', revealed: true });
		expect(applied.currentState.player1.sideboardRevealed).toBe(true);
	});

	it('still applies well-formed payloads', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();

		expect(applyFeatureMatchSessionEvent(state, snapshot, 'SetLife', { player: 'player1', lifeTotal: 9 }).currentState.player1.lifeTotal).toBe(9);
		expect(applyFeatureMatchSessionEvent(state, snapshot, 'AdjustLife', { player: 'player2', delta: -4 }).currentState.player2.lifeTotal).toBe(14);
		expect(applyFeatureMatchSessionEvent(state, snapshot, 'SetTurnNumber', { turnNumber: 8 }).currentState.turnNumber).toBe(8);
		expect(applyFeatureMatchSessionEvent(state, snapshot, 'SetCardsKept', { player: 'player1', cardsKept: 5 }).currentState.player1.cardsKept).toBe(5);
	});

	it('rejects the whole Batch when any sub-command is malformed — the save lands whole or not at all', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();

		const result = applyFeatureMatchSessionEvent(state, snapshot, 'Batch', {
			commands: [
				{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 11 } },
				{ type: 'SetLife', payload: { player: 'player2', lifeTotal: Number.NaN } },
				{ type: 'SetTurnNumber', payload: { turnNumber: 6 } },
			],
		});

		expect(result.currentState).toEqual(state);
		expect(nonFinitePaths(result.currentState)).toEqual([]);
	});

	it('applies a fully well-formed Batch as one reduction', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();

		const result = applyFeatureMatchSessionEvent(state, snapshot, 'Batch', {
			commands: [
				{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 11 } },
				{ type: 'SetTurnNumber', payload: { turnNumber: 6 } },
			],
		});

		expect(result.currentState.player1.lifeTotal).toBe(11);
		expect(result.currentState.turnNumber).toBe(6);
	});

	it('tolerates malformed Batch shapes without throwing', () => {
		const snapshot = createSnapshot();
		const state = createBusyState();

		for (const commands of [
			'not-an-array',
			42,
			null,
			[null, 'junk', { type: 'SetLife' }, { type: 'SetLife', payload: 'junk' }],
			// A shape-garbage entry sinks the well-formed one beside it too.
			[null, { type: 'SetLife', payload: { player: 'player1', lifeTotal: 11 } }],
			[{ type: 'SetLife', payload: 'junk' }, { type: 'SetLife', payload: { player: 'player1', lifeTotal: 11 } }],
		]) {
			const result = applyFeatureMatchSessionEvent(state, snapshot, 'Batch', { commands });
			expect(result.currentState, JSON.stringify(commands)).toEqual(state);
		}
	});

	it('keeps a replayed clock healthy when a poisoning pause is rejected', () => {
		const snapshot = createSnapshot();
		let state = createInitialFeatureMatchState();

		// Historical event log with a malformed pause timestamp. Before the
		// boundary guard this committed elapsedMs = NaN, which survived every
		// later event because Math.max(0, NaN) is NaN.
		const events: [FeatureMatchCommandType, Record<string, unknown>][] = [
			['StartClock', { at: 1_000 }],
			['PauseClock', { at: 'garbage' }],
			['StartClock', { at: 2_000 }],
			['PauseClock', { at: 3_000 }],
			['AdjustClock', { at: 4_000, deltaMs: -10_000 }],
		];
		for (const [type, payload] of events) {
			const result = applyFeatureMatchSessionEvent(state, snapshot, type, payload);
			state = result.currentState;
		}

		expect(nonFinitePaths(state)).toEqual([]);
		expect(state.clock.isRunning).toBe(false);
		// The malformed pause is rejected, so the clock keeps running from the
		// original start: the good pause banks 3000 - 1000 = 2000ms.
		expect(state.clock.elapsedMs).toBe(2_000);
	});
});

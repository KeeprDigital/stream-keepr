import { describe, expect, it } from 'vitest';
import {
	createFeatureMatchSchema,
	featureMatchBatchSubCommandSchema,
	featureMatchCommandSchema,
	updateFeatureMatchSchema,
} from '~~/server/schemas/api/featureMatch';
import { FEATURE_MATCH_BATCHABLE_COMMAND_TYPES } from '~~/shared/types/featureMatchSession';

describe('createFeatureMatchSchema', () => {
	it('accepts a manual Slot but refuses integration-owned provenance', () => {
		const manual = {
			bestOf: 3,
			player1Data: { name: 'Player', deckId: 77, archetypeId: 7 },
		};

		expect(createFeatureMatchSchema.safeParse(manual).success).toBe(true);
		expect(createFeatureMatchSchema.safeParse({ ...manual, externalId: 'forged', externalSource: 'melee' }).success).toBe(false);
	});
});

describe('featureMatchCommandSchema', () => {
	const sourceSnapshot = {
		eventId: 1,
		slotId: 2,
		matchId: null,
		externalId: null,
		externalSource: null,
		tableNumber: null,
		bestOf: 3,
		playerDisplayMode: 'score',
		game: 'op',
		defaults: {
			bestOf: 1,
			startingLife: 0,
			clockType: 'countdown',
			clockDuration: 30,
			countUpAfterCountdown: false,
			turnTrackingEnabled: false,
			activePlayerTrackingEnabled: false,
			extraTurnsEnabled: false,
			extraTurns: 0,
			extraTurnsLabel: 'Extra Turns',
			mulliganTrackingEnabled: false,
		},
		player1: { playerId: null, data: null },
		player2: { playerId: null, data: null },
		createdAt: 1,
	};

	it('rejects SnapshotCorrected from clients — snapshots are server-built only', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'snapshot-2',
			type: 'SnapshotCorrected',
			baseSequence: 1,
			payload: { sourceSnapshot },
		}).success).toBe(false);
		// Unsequenced too, since SnapshotCorrected is mergeable.
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'snapshot-3',
			type: 'SnapshotCorrected',
			payload: { sourceSnapshot },
		}).success).toBe(false);
	});

	it('bounds constant-time turn deltas', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'turn-ok',
			type: 'StepTurn',
			payload: { delta: 100 },
		}).success).toBe(true);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'turn-too-large',
			type: 'StepTurn',
			payload: { delta: 101 },
		}).success).toBe(false);
	});

	it('requires baseSequence for non-mergeable commands', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'set-life',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 10 },
		}).success).toBe(false);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'adjust-life',
			type: 'AdjustLife',
			payload: { player: 'player1', delta: -1 },
		}).success).toBe(true);
	});

	it('accepts SetSideboardRevealed with a strict boolean and rejects anything else', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'reveal-ok',
			type: 'SetSideboardRevealed',
			payload: { player: 'player1', revealed: true },
			baseSequence: 1,
		}).success).toBe(true);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'reveal-coerced',
			type: 'SetSideboardRevealed',
			payload: { player: 'player1', revealed: 1 },
			baseSequence: 1,
		}).success).toBe(false);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'reveal-bad-side',
			type: 'SetSideboardRevealed',
			payload: { player: 'playerX', revealed: true },
			baseSequence: 1,
		}).success).toBe(false);
	});

	it('admits exactly the batchable command types as Batch sub-commands', () => {
		// Nothing derives the const from the union, so this pins them together.
		const schemaTypes = featureMatchBatchSubCommandSchema.options
			.map(option => option.shape.type.value)
			.toSorted();
		expect(schemaTypes).toEqual([...FEATURE_MATCH_BATCHABLE_COMMAND_TYPES].toSorted());
	});

	it('requires baseSequence for a Batch — the sequence claim covers the whole save', () => {
		const commands = [
			{
				type: 'SetLife',
				payload: { player: 'player1', lifeTotal: 10 },
			},
		];
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'batch-unsequenced',
			type: 'Batch',
			payload: { commands },
		}).success).toBe(false);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'batch-sequenced',
			type: 'Batch',
			payload: { commands },
			baseSequence: 1,
		}).success).toBe(true);
	});

	it('rejects a Batch carrying non-batchable or nested commands, or nothing at all', () => {
		const batch = (commands: unknown[]) => featureMatchCommandSchema.safeParse({
			commandId: 'batch-contents',
			type: 'Batch',
			payload: { commands },
			baseSequence: 1,
		}).success;

		// Relative commands keep their merge-retry semantics by staying standalone.
		expect(batch([
			{
				type: 'AdjustLife',
				payload: { player: 'player1', delta: -1 },
			},
		])).toBe(false);
		// Server-only snapshot corrections stay unreachable through a batch.
		expect(batch([
			{
				type: 'SnapshotCorrected',
				payload: { sourceSnapshot },
			},
		])).toBe(false);
		// A batch cannot nest a batch.
		expect(batch([
			{
				type: 'Batch',
				payload: { commands: [] },
			},
		])).toBe(false);
		expect(batch([])).toBe(false);
	});
});

describe('updateFeatureMatchSchema', () => {
	it.each([
		['a numeric string', '12', 12],
		['a blank value', '', null],
	])('coerces %s tableNumber', (_case, tableNumber, expected) => {
		expect(updateFeatureMatchSchema.parse({ tableNumber }).tableNumber).toBe(expected);
	});

	it('accepts partial player data without a name and coerces numeric strings', () => {
		expect(updateFeatureMatchSchema.parse({
			player1Data: { position: '4' },
		}).player1Data).toEqual({ position: 4 });
	});

	it('normalizes empty player metadata to null', () => {
		const result = updateFeatureMatchSchema.parse({
			player1Data: {
				name: '',
				pronouns: '',
				gameData: { type: 'mtg', deckName: '', deckColors: null },
			},
			player2Data: {},
		});

		expect(result.player1Data).toBeNull();
		expect(result.player2Data).toBeNull();
	});
});

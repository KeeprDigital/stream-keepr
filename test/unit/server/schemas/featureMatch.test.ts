import { describe, expect, it } from 'vitest';
import {
	createFeatureMatchSchema,
	featureMatchBatchSubCommandSchema,
	featureMatchCommandSchema,
	featureMatchSlotParamsSchema,
	updateFeatureMatchSchema,
} from '~~/server/schemas/api/featureMatch';
import { FEATURE_MATCH_BATCHABLE_COMMAND_TYPES } from '~~/shared/types/featureMatchSession';

// ──────────────── createFeatureMatchSchema ────────────────

describe('createFeatureMatchSchema', () => {
	it('accepts minimal valid input (no required body fields beyond DB defaults)', () => {
		const result = createFeatureMatchSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts full valid input with all optional fields', () => {
		const result = createFeatureMatchSchema.safeParse({
			bestOf: 3,
			tableNumber: 1,
			player1Id: 10,
			player2Id: 20,
			player1Data: {
				name: 'Player 1',
				pronouns: 'he/him',
			},
			player2Data: {
				name: 'Player 2',
			},
		});
		expect(result.success).toBe(true);
	});

	// bestOf: 1-9
	it('accepts bestOf of 1', () => {
		const result = createFeatureMatchSchema.safeParse({ bestOf: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts bestOf of 9', () => {
		const result = createFeatureMatchSchema.safeParse({ bestOf: 9 });
		expect(result.success).toBe(true);
	});

	// tableNumber: positive integer or null
	it('accepts tableNumber of 1', () => {
		const result = createFeatureMatchSchema.safeParse({ tableNumber: 1 });
		expect(result.success).toBe(true);
	});

	it('accepts null tableNumber', () => {
		const result = createFeatureMatchSchema.safeParse({ tableNumber: null });
		expect(result.success).toBe(true);
	});

	// player IDs: positive integers or null
	it('accepts valid player1Id', () => {
		const result = createFeatureMatchSchema.safeParse({ player1Id: 5 });
		expect(result.success).toBe(true);
	});

	it('accepts null player1Id', () => {
		const result = createFeatureMatchSchema.safeParse({ player1Id: null });
		expect(result.success).toBe(true);
	});

	it('accepts valid player2Id', () => {
		const result = createFeatureMatchSchema.safeParse({ player2Id: 7 });
		expect(result.success).toBe(true);
	});

	it('accepts null player2Id', () => {
		const result = createFeatureMatchSchema.safeParse({ player2Id: null });
		expect(result.success).toBe(true);
	});

	it('rejects integration-owned Slot provenance (unknown keys on a strict schema)', () => {
		const result = createFeatureMatchSchema.safeParse({
			externalId: 'forged',
			externalSource: 'melee',
		});
		expect(result.success).toBe(false);
	});

	// player data: embedded objects
	it('accepts player1Data with valid name', () => {
		const result = createFeatureMatchSchema.safeParse({
			player1Data: { name: 'Alice' },
		});
		expect(result.success).toBe(true);
	});

	it('accepts player data with gameData discriminated union', () => {
		const result = createFeatureMatchSchema.safeParse({
			player1Data: {
				name: 'Player',
				gameData: { type: 'mtg', deckName: 'Storm' },
			},
		});
		expect(result.success).toBe(true);
	});

	it('accepts player data with archetypeId', () => {
		const result = createFeatureMatchSchema.safeParse({
			player1Data: { name: 'Player', archetypeId: 7 },
			player2Data: { name: 'Other', archetypeId: null },
		});
		expect(result.success).toBe(true);
	});

	it('accepts player data with a stable submitted deck identity', () => {
		const result = createFeatureMatchSchema.safeParse({
			player1Data: { name: 'Player', deckId: 77 },
		});
		expect(result.success).toBe(true);
	});

	it('accepts null player data', () => {
		const result = createFeatureMatchSchema.safeParse({
			player1Data: null,
			player2Data: null,
		});
		expect(result.success).toBe(true);
	});

	// Omitted fields should be stripped from output
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
		// Authoritative snapshots carry Melee provenance and are replayed as
		// truth; only the server may construct them (featureMatchService.update).
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'snapshot-2',
			type: 'SnapshotCorrected',
			baseSequence: 1,
			payload: { sourceSnapshot },
		}).success).toBe(false);
		// Unsequenced too: SnapshotCorrected is mergeable, so the sequenced form
		// alone would leave the shape a client can actually send untested.
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
		// The batchable list exists as a type-level const and as this zod union;
		// nothing derives one from the other, so this pins them together.
		const schemaTypes = featureMatchBatchSubCommandSchema.options
			.map(option => option.shape.type.value)
			.toSorted();
		expect(schemaTypes).toEqual([...FEATURE_MATCH_BATCHABLE_COMMAND_TYPES].toSorted());
	});

	it('requires baseSequence for a Batch — the sequence claim covers the whole save', () => {
		const commands = [{ type: 'SetLife', payload: { player: 'player1', lifeTotal: 10 } }];
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
		expect(batch([{ type: 'AdjustLife', payload: { player: 'player1', delta: -1 } }])).toBe(false);
		// Server-only snapshot corrections stay unreachable through a batch.
		expect(batch([{ type: 'SnapshotCorrected', payload: { sourceSnapshot } }])).toBe(false);
		// A batch cannot nest a batch.
		expect(batch([{ type: 'Batch', payload: { commands: [] } }])).toBe(false);
		expect(batch([])).toBe(false);
	});
});

// ──────────────── updateFeatureMatchSchema ────────────────

describe('updateFeatureMatchSchema', () => {
	it('accepts empty object (all fields optional)', () => {
		const result = updateFeatureMatchSchema.safeParse({});
		expect(result.success).toBe(true);
	});

	it('accepts partial update with bestOf only', () => {
		const result = updateFeatureMatchSchema.safeParse({ bestOf: 5 });
		expect(result.success).toBe(true);
	});

	it('accepts partial update with player IDs', () => {
		const result = updateFeatureMatchSchema.safeParse({ player1Id: 3, player2Id: 7 });
		expect(result.success).toBe(true);
	});

	it('coerces string tableNumber to a number', () => {
		const result = updateFeatureMatchSchema.safeParse({ tableNumber: '12' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tableNumber).toBe(12);
		}
	});

	it('coerces blank tableNumber to null', () => {
		const result = updateFeatureMatchSchema.safeParse({ tableNumber: '' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.tableNumber).toBeNull();
		}
	});

	it('accepts partial player data without a name and coerces numeric strings', () => {
		const result = updateFeatureMatchSchema.safeParse({
			player1Data: { position: '4' },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.player1Data).toEqual({ position: 4 });
		}
	});

	it('normalizes empty player metadata to null', () => {
		const result = updateFeatureMatchSchema.safeParse({
			player1Data: {
				name: '',
				pronouns: '',
				gameData: { type: 'mtg', deckName: '', deckColors: null },
			},
			player2Data: {},
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.player1Data).toBeNull();
			expect(result.data.player2Data).toBeNull();
		}
	});
});

// ──────────────── featureMatchSlotParamsSchema ────────────────

describe('featureMatchSlotParamsSchema', () => {
	it('coerces string id and slotId to numbers', () => {
		const result = featureMatchSlotParamsSchema.safeParse({ id: '1', slotId: '5' });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.id).toBe(1);
			expect(result.data.slotId).toBe(5);
		}
	});

	it('accepts numeric id and slotId', () => {
		const result = featureMatchSlotParamsSchema.safeParse({ id: 10, slotId: 20 });
		expect(result.success).toBe(true);
	});
});

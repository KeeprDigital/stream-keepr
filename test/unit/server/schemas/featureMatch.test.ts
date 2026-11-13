import { describe, expect, it } from 'vitest';
import {
	createFeatureMatchSchema,
	featureMatchBatchSubCommandSchema,
	featureMatchCommandSchema,
	updateFeatureMatchSchema,
} from '~~/server/schemas/api/featureMatch';
import { createPlayerSchema, updatePlayerSchema } from '~~/server/schemas/api/player';
import { FEATURE_MATCH_BATCHABLE_COMMAND_TYPES } from '~~/shared/types/featureMatchSession';
import { ATRAXA } from '~~/test/helpers/commanders';
import { ZORO } from '~~/test/helpers/opCards';

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

	// It carries the snapshot of a Slot whose Seats were exchanged, which only the server builds (ADR-0087).
	it('rejects SwapSeats from clients', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'swap-seats-1',
			type: 'SwapSeats',
			payload: {
				seats: ['player1', 'player3'],
				sourceSnapshot,
			},
		}).success).toBe(false);
	});

	it.each([
		[
			'Commander Damage entered',
			'AdjustCommanderDamage',
			{
				player: 'player4',
				from: 'player1',
				commander: 2,
				delta: 5,
			},
			true,
		],
		[
			'Commander Damage taken back',
			'AdjustCommanderDamage',
			{
				player: 'player2',
				from: 'player3',
				commander: 1,
				delta: -1,
			},
			true,
		],
		[
			'Commander Damage from the Seat\'s own Commander',
			'AdjustCommanderDamage',
			{
				player: 'player1',
				from: 'player1',
				commander: 1,
				delta: 1,
			},
			false,
		],
		[
			'Commander Damage from a third Commander',
			'AdjustCommanderDamage',
			{
				player: 'player2',
				from: 'player1',
				commander: 3,
				delta: 1,
			},
			false,
		],
		[
			'Commander Damage of nothing',
			'AdjustCommanderDamage',
			{
				player: 'player2',
				from: 'player1',
				commander: 1,
				delta: 0,
			},
			false,
		],
		[
			'a Seat Eliminated',
			'SetEliminated',
			{ player: 'player3', eliminated: true },
			true,
		],
		[
			'a Seat Eliminated without saying so',
			'SetEliminated',
			{ player: 'player3', eliminated: 'yes' },
			false,
		],
		[
			'a winning Seat',
			'SetOutcome',
			{
				outcome: { winner: 'player4' },
			},
			true,
		],
		[
			'a draw',
			'SetOutcome',
			{
				outcome: { winner: null },
			},
			true,
		],
		[
			'an outcome taken back',
			'SetOutcome',
			{ outcome: null },
			true,
		],
		[
			'an outcome naming no Seat',
			'SetOutcome',
			{
				outcome: { winner: 'player5' },
			},
			false,
		],
		[
			'life for Seat 3',
			'SetLife',
			{ player: 'player3', lifeTotal: 12 },
			true,
		],
		[
			'a Sideboard revealed for Seat 3',
			'SetSideboardRevealed',
			{ player: 'player3', revealed: true },
			false,
		],
		[
			'a game win for Seat 3',
			'RecordGameWin',
			{ player: 'player3' },
			false,
		],
	])('reads %s', (_case, type, payload, accepted) => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'c-1',
			type,
			baseSequence: 1,
			payload,
		}).success).toBe(accepted);
	});

	it('takes Commander Damage unsequenced, as it does a life adjustment', () => {
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'c-2',
			type: 'AdjustCommanderDamage',
			payload: {
				player: 'player2',
				from: 'player1',
				commander: 1,
				delta: 1,
			},
		}).success).toBe(true);
		expect(featureMatchCommandSchema.safeParse({
			commandId: 'c-3',
			type: 'SetEliminated',
			payload: { player: 'player2', eliminated: true },
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

describe('a Slot side\'s Leader', () => {
	const sideWith = (value: unknown) => updateFeatureMatchSchema.safeParse({
		player1Data: {
			name: 'Ana',
			gameData: { type: 'op', leader: value },
		},
	});

	// The overlay loads the image on air, so it must be a bandai-keepr Printing image.
	it.each([
		{ imageUrl: ZORO.imageUrl, accepted: true },
		{ imageUrl: 'https://example.com/OP01-001.png', accepted: false },
	])('takes $imageUrl as its image: $accepted', ({ imageUrl, accepted }) => {
		expect(sideWith({ ...ZORO, imageUrl }).success).toBe(accepted);
	});

	// Free text typed before the Leader picker names no card.
	it.each([
		{ leader: ZORO, held: ZORO },
		{ leader: 'Zoro', held: null },
	])('holds a side\'s Leader $leader as $held', ({ leader, held }) => {
		const result = sideWith(leader);
		expect(result.success && result.data.player1Data?.gameData).toEqual({ type: 'op', leader: held });
	});
});

// Only a Slot setup save carries a Deck List reference, which its write then checks against the Slot.
describe('a Feature Match Deck List reference', () => {
	const gameData = {
		type: 'op',
		featureMatchDeckList: { id: 4, mainboardCount: 50 },
	};

	it.each([
		[
			'a Slot setup save',
			() => updateFeatureMatchSchema.safeParse({
				player1Data: { name: 'Ana', gameData },
			}),
			true,
		],
		[
			'a Slot create',
			() => createFeatureMatchSchema.safeParse({
				player1Data: { name: 'Ana', gameData },
			}),
			false,
		],
		[
			'a Player create',
			() => createPlayerSchema.safeParse({ name: 'Ana', gameData }),
			false,
		],
		[
			'a Player update',
			() => updatePlayerSchema.safeParse({ gameData }),
			false,
		],
	] as const)('is taken by %s: %3$s', (_label, parse, accepted) => {
		expect(parse().success).toBe(accepted);
	});
});

// A linked side shows its Player's Deck List, which only the OP Deck List write writes (ADR-0074).
describe('a Player Deck List reference on a Slot side', () => {
	const gameData = {
		type: 'op',
		leader: ZORO,
		deckList: { id: 4, mainboardCount: 50, leaderNumber: ZORO.number },
	};

	it('is taken from a Slot setup save, as its form holds the side, and dropped', () => {
		const result = updateFeatureMatchSchema.safeParse({
			player1Data: { name: 'Ana', gameData },
		});
		expect(result.success && result.data.player1Data?.gameData).toEqual({ type: 'op', leader: ZORO });
	});

	it.each([
		[
			'a Slot create',
			() => createFeatureMatchSchema.safeParse({
				player1Data: { name: 'Ana', gameData },
			}),
		],
		[
			'a Player update',
			() => updatePlayerSchema.safeParse({ gameData }),
		],
	] as const)('is refused by %s', (_label, parse) => {
		expect(parse().success).toBe(false);
	});
});

// A Seat holds one or two Commanders, each one printing of a card (ADR-0087).
describe('a Seat\'s Commanders', () => {
	const commander = (overrides: Record<string, unknown> = {}) => ({
		...ATRAXA,
		...overrides,
	});
	const gameData = (commanders: unknown[]) => ({ type: 'mtg', commanders });

	it.each([
		{
			held: 'two',
			commanders: [
				commander(),
				commander(),
			],
			accepted: true,
		},
		{
			held: 'three',
			commanders: [
				commander(),
				commander(),
				commander(),
			],
			accepted: false,
		},
		{
			held: 'a colourless one',
			commanders: [
				commander({ colorIdentity: '' }),
			],
			accepted: true,
		},
		{
			held: 'one whose colour identity repeats a colour',
			commanders: [
				commander({ colorIdentity: 'WW' }),
			],
			accepted: false,
		},
		{
			held: 'one whose colour identity names no colour',
			commanders: [
				commander({ colorIdentity: 'X' }),
			],
			accepted: false,
		},
		{
			held: 'one that names no printing',
			commanders: [
				commander({ scryfallId: 'atraxa' }),
			],
			accepted: false,
		},
	])('a setup save of a Seat holding $held is accepted: $accepted', ({ commanders, accepted }) => {
		expect(updateFeatureMatchSchema.safeParse({
			player3Data: {
				name: 'Cyd',
				gameData: gameData(commanders),
			},
		}).success).toBe(accepted);
	});

	it.each([
		[
			'a Slot create',
			() => createFeatureMatchSchema.safeParse({
				player1Data: {
					name: 'Ana',
					gameData: gameData([
						commander(),
					]),
				},
			}),
		],
		[
			'a Player create',
			() => createPlayerSchema.safeParse({
				name: 'Ana',
				gameData: gameData([
					commander(),
				]),
			}),
		],
	] as const)('are refused by %s', (_label, parse) => {
		expect(parse().success).toBe(false);
	});
});

// Seats 3 and 4 are written as Seats 1 and 2 are, and only by a setup save (ADR-0087).
describe('seats 3 and 4', () => {
	it('take a setup save\'s Seat data under the rules Seats 1 and 2 do', () => {
		expect(updateFeatureMatchSchema.parse({
			player3Data: { position: '4' },
			player4Data: { name: '' },
		})).toEqual({
			player3Data: { position: 4 },
			player4Data: null,
		});
		expect(updateFeatureMatchSchema.safeParse({
			player4Data: { name: 'Dee', externalId: 'forged' },
		}).success).toBe(false);
	});

	it('are refused by a Slot create', () => {
		expect(createFeatureMatchSchema.safeParse({
			player3Data: { name: 'Cyd' },
		}).success).toBe(false);
	});
});

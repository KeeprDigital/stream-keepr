import {
	createInsertSchema,
	createUpdateSchema,
} from 'drizzle-zod';
import { z } from 'zod';
import { featureMatches } from '~~/server/db/schema';
import {
	PLAYER_SIDE_VALUES,
	RESET_TYPE_VALUES,
} from '~~/shared/types/enums';
import { isMergeableFeatureMatchCommand } from '~~/shared/types/featureMatchSession';
import { playerGameDataSchema } from './player';

function blankStringToNull(value: unknown) {
	if (typeof value !== 'string')
		return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function blankStringToUndefined(value: unknown) {
	if (typeof value !== 'string')
		return value;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function nullableStringSchema(max: number) {
	return z.preprocess(blankStringToNull, z.string().max(max).nullable().optional());
}

const nullablePositiveIntegerSchema = z.preprocess(
	blankStringToNull,
	z.coerce.number().int().positive().nullable().optional(),
);

const nullableNonnegativeIntegerSchema = z.preprocess(
	blankStringToNull,
	z.coerce.number().int().nonnegative().nullable().optional(),
);

function optionalBoundedIntegerSchema(min: number, max: number) {
	return z.preprocess(
		blankStringToUndefined,
		z.coerce.number().int().min(min).max(max).optional(),
	);
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === undefined || value === null)
		return false;
	if (typeof value === 'string')
		return value.trim().length > 0;
	if (typeof value === 'object') {
		if (Array.isArray(value))
			return value.some(hasMeaningfulValue);
		return Object.entries(value).some(([key, entry]) => key !== 'type' && hasMeaningfulValue(entry));
	}
	return true;
}

// Embedded player data for initial slot creation. A directly supplied player
// needs a name here; setup PATCHes below allow partial display metadata.
const createFeatureMatchPlayerDataSchema = z
	.object({
		name: z.string().min(1).max(200),
		pronouns: nullableStringSchema(50),
		wins: nullableNonnegativeIntegerSchema,
		losses: nullableNonnegativeIntegerSchema,
		draws: nullableNonnegativeIntegerSchema,
		position: nullablePositiveIntegerSchema,
		points: nullableNonnegativeIntegerSchema,
		deckId: nullablePositiveIntegerSchema,
		archetypeId: nullablePositiveIntegerSchema,
		deckList: nullableStringSchema(100000),
		lgs: nullableStringSchema(200),
		gameData: playerGameDataSchema.nullable().optional(),
	})
	.strict();

const updateFeatureMatchPlayerDataSchema = z.preprocess(
	value => value === '' ? null : value,
	z
		.object({
			name: nullableStringSchema(200),
			pronouns: nullableStringSchema(50),
			wins: nullableNonnegativeIntegerSchema,
			losses: nullableNonnegativeIntegerSchema,
			draws: nullableNonnegativeIntegerSchema,
			position: nullablePositiveIntegerSchema,
			points: nullableNonnegativeIntegerSchema,
			deckId: nullablePositiveIntegerSchema,
			archetypeId: nullablePositiveIntegerSchema,
			deckList: nullableStringSchema(100000),
			lgs: nullableStringSchema(200),
			gameData: playerGameDataSchema.nullable().optional(),
		})
		.strict()
		.transform(data => hasMeaningfulValue(data) ? data : null)
		.nullable()
		.optional(),
);

// CREATE
export const createFeatureMatchSchema = createInsertSchema(featureMatches)
	.omit({
		id: true,
		eventId: true,
		createdAt: true,
		updatedAt: true,
		activeSessionId: true,
		externalId: true,
		externalSource: true,
	})
	.extend({
		// String length limits
		roundName: nullableStringSchema(200),
		formatName: nullableStringSchema(100),
		// Numeric bounds
		bestOf: optionalBoundedIntegerSchema(1, 9),
		tableNumber: nullablePositiveIntegerSchema,
		// Player ID references
		player1Id: nullablePositiveIntegerSchema,
		player2Id: nullablePositiveIntegerSchema,
		// JSON structural validation
		player1Data: createFeatureMatchPlayerDataSchema.nullable().optional(),
		player2Data: createFeatureMatchPlayerDataSchema.nullable().optional(),
	})
	.strict();

// UPDATE
export const updateFeatureMatchSchema = createUpdateSchema(featureMatches)
	.omit({
		id: true,
		eventId: true,
		createdAt: true,
		updatedAt: true,
		activeSessionId: true,
		externalId: true,
		externalSource: true,
	})
	.extend({
		// String length limits (all optional for partial updates)
		roundName: nullableStringSchema(200),
		formatName: nullableStringSchema(100),
		// Numeric bounds (all optional for partial updates)
		bestOf: optionalBoundedIntegerSchema(1, 9),
		tableNumber: nullablePositiveIntegerSchema,
		// Player ID references (all optional for partial updates)
		player1Id: nullablePositiveIntegerSchema,
		player2Id: nullablePositiveIntegerSchema,
		// JSON structural validation (all optional for partial updates)
		player1Data: updateFeatureMatchPlayerDataSchema,
		player2Data: updateFeatureMatchPlayerDataSchema,
	})
	.strict();

// ROUTE PARAMS
export const featureMatchSlotParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	slotId: z.coerce.number().int().positive(),
});

// REORDER
export const reorderFeatureMatchSlotSchema = z.object({
	slotId: z.number().int().positive(),
	direction: z.enum(['up', 'down']),
});

export const featureMatchSessionParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	sessionId: z.coerce.number().int().positive(),
});

const commandBaseSchema = {
	commandId: z.string().min(1).max(100),
	baseSequence: z.number().int().nonnegative().optional(),
};

const emptyPayloadSchema = z.object({}).strict();
const playerSideSchema = z.enum(PLAYER_SIDE_VALUES);
const counterSchema = z
	.object({
		type: z.string().min(1).max(50),
		value: z.number().int(),
	})
	.strict();

// Payloads shared between the standalone command union and the Batch
// sub-command union, so the two cannot drift.
const setLifePayloadSchema = z
	.object({ player: playerSideSchema, lifeTotal: z.number().int() })
	.strict();
const setCountersPayloadSchema = z
	.object({ player: playerSideSchema, counters: z.array(counterSchema) })
	.strict();
const setCardsKeptPayloadSchema = z
	.object({ player: playerSideSchema, cardsKept: z.number().int().nonnegative() })
	.strict();
const setSideboardRevealedPayloadSchema = z
	.object({ player: playerSideSchema, revealed: z.boolean() })
	.strict();
const setClockPayloadSchema = z
	.object({ targetMs: z.number().int().nonnegative() })
	.strict();
const firstPlayerPayloadSchema = z.object({ player: playerSideSchema }).strict();
const setActivePlayerPayloadSchema = z
	.object({ player: playerSideSchema.nullable() })
	.strict();
const setTurnNumberPayloadSchema = z
	.object({ turnNumber: z.number().int().nonnegative() })
	.strict();
const startOvertimePayloadSchema = z
	.object({ totalTurns: z.number().int().positive() })
	.strict();

// Batch carries absolute setters only — see FEATURE_MATCH_BATCHABLE_COMMAND_TYPES.
// Sub-commands carry no commandId or baseSequence of their own: the Batch's
// receipt and sequence claim cover the whole save. Exported so a test can pin
// this union's membership to FEATURE_MATCH_BATCHABLE_COMMAND_TYPES.
export const featureMatchBatchSubCommandSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('SetLife'), payload: setLifePayloadSchema }).strict(),
	z.object({ type: z.literal('SetCounters'), payload: setCountersPayloadSchema }).strict(),
	z.object({ type: z.literal('SetCardsKept'), payload: setCardsKeptPayloadSchema }).strict(),
	z.object({ type: z.literal('SetSideboardRevealed'), payload: setSideboardRevealedPayloadSchema }).strict(),
	z.object({ type: z.literal('SetClock'), payload: setClockPayloadSchema }).strict(),
	z.object({ type: z.literal('SelectFirstPlayer'), payload: firstPlayerPayloadSchema }).strict(),
	z.object({ type: z.literal('SetFirstPlayer'), payload: firstPlayerPayloadSchema }).strict(),
	z.object({ type: z.literal('SetActivePlayer'), payload: setActivePlayerPayloadSchema }).strict(),
	z.object({ type: z.literal('SetTurnNumber'), payload: setTurnNumberPayloadSchema }).strict(),
	z.object({ type: z.literal('StartOvertime'), payload: startOvertimePayloadSchema }).strict(),
]);
// SnapshotCorrected is deliberately absent from the client command schema:
// authoritative snapshots carry Melee provenance and are replayed as truth,
// so only the server may construct them (featureMatchService.update builds
// them from the database via buildSourceSnapshot).
export const featureMatchCommandSchema = z.discriminatedUnion('type', [
	z
		.object({
			...commandBaseSchema,
			type: z.literal('AdjustLife'),
			payload: z
				.object({ player: playerSideSchema, delta: z.number().int() })
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetLife'),
			payload: setLifePayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetCounters'),
			payload: setCountersPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetCardsKept'),
			payload: setCardsKeptPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetSideboardRevealed'),
			payload: setSideboardRevealedPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('AdjustClock'),
			payload: z.object({ deltaMs: z.number().int() }).strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetClock'),
			payload: setClockPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('StartClock'),
			payload: emptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('PauseClock'),
			payload: emptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('ResetClock'),
			payload: z
				.object({ durationMs: z.number().int().nonnegative().optional() })
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('RestartClock'),
			payload: emptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SelectFirstPlayer'),
			payload: firstPlayerPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetFirstPlayer'),
			payload: firstPlayerPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetActivePlayer'),
			payload: setActivePlayerPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SetTurnNumber'),
			payload: setTurnNumberPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('RecordGameWin'),
			payload: z
				.object({
					player: playerSideSchema,
					resetLife: z.boolean().optional(),
					resetCounters: z.boolean().optional(),
					startingLife: z.number().int().nonnegative().optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('UndoGameWin'),
			payload: z
				.object({
					player: playerSideSchema,
					resetLife: z.boolean().optional(),
					resetCounters: z.boolean().optional(),
					startingLife: z.number().int().nonnegative().optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('ResetState'),
			payload: z
				.object({
					type: z.enum(RESET_TYPE_VALUES),
					startingLife: z.number().int().nonnegative().optional(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('StartOvertime'),
			payload: startOvertimePayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('StepTurn'),
			payload: z
				.object({
					delta: z.number().int().min(-100).max(100).refine(value => value !== 0, {
						message: 'delta must be non-zero',
					}),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('StepOvertime'),
			payload: z
				.object({
					delta: z.number().int().min(-100).max(100).refine(value => value !== 0, {
						message: 'delta must be non-zero',
					}),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('SwapPlayers'),
			payload: emptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...commandBaseSchema,
			type: z.literal('Batch'),
			payload: z
				.object({ commands: z.array(featureMatchBatchSubCommandSchema).min(1).max(20) })
				.strict(),
		})
		.strict(),
]).superRefine((command, context) => {
	// A mergeable command can be safely retried against the latest projection.
	// Every other command must identify the exact projection it was based on.
	// Asked of the shared merge policy rather than a second list, so the two
	// cannot drift; the server-only command that policy also admits is absent
	// from the union above and unreachable here.
	if (!isMergeableFeatureMatchCommand(command.type)
		&& command.baseSequence === undefined) {
		context.addIssue({
			code: 'custom',
			path: ['baseSequence'],
			message: 'baseSequence is required for non-mergeable commands',
		});
	}
});

/* TYPES */
export type CreateFeatureMatchInput = z.infer<typeof createFeatureMatchSchema>;
export type UpdateFeatureMatchInput = z.infer<typeof updateFeatureMatchSchema>;
export type ReorderFeatureMatchSlotInput = z.infer<
  typeof reorderFeatureMatchSlotSchema
>;
export type FeatureMatchCommandInput = z.infer<
  typeof featureMatchCommandSchema
>;

export type FeatureMatchSessionParams = z.infer<
  typeof featureMatchSessionParamsSchema
>;

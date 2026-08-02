import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import { z } from 'zod';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import {
	GRAPHIC_INPUT_KEY_PATTERN,
	MAX_GRAPHIC_INPUT_KEY_LENGTH,
} from '~~/shared/types/graphics';
import { screenParamsSchema } from './screen';

/** A playout route names the epoch as well as the Screen that owns it. */
export const broadcastGraphicsLiveSessionParamsSchema = screenParamsSchema.extend({
	sessionId: z.coerce.number().int().positive(),
});

const graphicIdSchema = z.string().min(1).max(100);

/**
 * The ceiling on one Graphic Input value on the wire.
 *
 * Deliberately larger than the longest value any text Graphic Input may declare
 * (`MAX_GRAPHIC_TEXT_LENGTH`, 1,000): a value that exceeds its declaration's own
 * bound has to be storable so Live Control can show it as unavailable, which is what
 * "unavailable rather than truncated" means in practice. This is only the bound that
 * keeps a command from being unboundedly large.
 *
 * Its margin over the authored cap is 200 rather than 1,000, because the margin buys
 * nothing beyond being non-zero — an over-long value is refused acceptance at any
 * length — while it is paid twice per Graphic Input in every durable live state and
 * every notification that describes one. Doubling the authored cap cost 60 KB of
 * worst-case live state for no property the smaller margin does not have. See #168.
 */
export const MAX_GRAPHIC_INPUT_VALUE_LENGTH = 1200;

/**
 * One Graphic Input value, in whichever shape its declared type takes. The wire
 * schema accepts any of them and the reducer judges the value against the
 * declaration, because which type is correct is authored configuration rather
 * than something the route knows.
 */
const graphicInputValueSchema = z.union([
	z.null(),
	z.boolean(),
	z.number().finite(),
	z.string().max(MAX_GRAPHIC_INPUT_VALUE_LENGTH),
	z.object({
		assetId: z.string().min(1).max(100).transform(graphicAssetId),
		revisionId: z.string().min(1).max(100).transform(graphicAssetRevisionId),
	}).strict(),
]);

/**
 * One playout action. Cut is a modifier on the action rather than an action of
 * its own, and there is no base sequence: a target-state intent stays valid
 * however far the session has advanced.
 */
const playoutPayloadSchema = z.object({
	graphicId: graphicIdSchema,
	cut: z.boolean().optional(),
}).strict();

/**
 * Update Graphic is the one action that is not target state, so it carries the
 * acceptance revision it supersedes. That is the sequence guard: an acceptance
 * built against a superseded one is refused rather than silently overwriting a
 * colleague's.
 */
const updatePayloadSchema = z.object({
	graphicId: graphicIdSchema,
	cut: z.boolean().optional(),
	basedOnAcceptedRevision: z.number().int().nonnegative(),
}).strict();

const inputKeySchema = z.string().min(1).max(MAX_GRAPHIC_INPUT_KEY_LENGTH).regex(GRAPHIC_INPUT_KEY_PATTERN);

/**
 * One working-value edit, optionally stating the value it believes it replaces.
 *
 * The claim is wrapped in an object rather than sent as a bare optional value
 * because `null` is a legitimate Graphic Input value: only a wrapper can tell
 * "I claim the field was empty" apart from "I claim nothing", and the difference
 * decides whether a second operator's edit is refused or silently overwritten.
 */
const setInputPayloadSchema = z.object({
	graphicId: graphicIdSchema,
	inputKey: inputKeySchema,
	value: graphicInputValueSchema,
	basedOn: z.object({ value: graphicInputValueSchema }).strict().optional(),
}).strict();

/**
 * A Graphic Input Override carries a value in exactly the shape a working value
 * does, because it is the same kind of thing: an operator's own value, judged
 * against the same declaration. `null` clears it, which is why there is no separate
 * clear action — an override always holds a real value, and not masking is the
 * absence of one.
 */
const setOverridePayloadSchema = setInputPayloadSchema;

/**
 * One Graphic Source Selection pointed at an entity id, or cleared with `null`.
 *
 * Only the id crosses the wire. Which entity that is, and whether the operator may
 * see it, are the Event's questions and are answered by resolving against the
 * Event's own data rather than by trusting a client-supplied entity.
 */
const selectSourcePayloadSchema = z.object({
	graphicId: graphicIdSchema,
	sourceKey: inputKeySchema,
	selectionId: z.number().int().positive().nullable(),
}).strict();

const commandIdSchema = z.string().min(1).max(100);

export const broadcastGraphicsCommandSchema = z.discriminatedUnion('type', [
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Take'),
		payload: playoutPayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Out'),
		payload: playoutPayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Update Graphic'),
		payload: updatePayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Set Input'),
		payload: setInputPayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Set Override'),
		payload: setOverridePayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Select Source'),
		payload: selectSourcePayloadSchema,
	}).strict(),
	z.object({
		commandId: commandIdSchema,
		type: z.literal('Resolve Bindings'),
		// It names only the Broadcast Graphic. Nothing about what Event Data now says
		// crosses the wire, because the server reads that itself.
		payload: z.object({ graphicId: graphicIdSchema }).strict(),
	}).strict(),
]) satisfies z.ZodType<BroadcastGraphicsCommand>;

export type BroadcastGraphicsLiveSessionParams = z.infer<typeof broadcastGraphicsLiveSessionParamsSchema>;

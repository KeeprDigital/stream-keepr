import { z } from 'zod';

const MAX_SOURCE_BYTES = 64 * 1024;
const colorSelectionSchema = z.string()
	.max(5)
	.refine(colors => /^[WUBRG]*$/.test(colors) && new Set(colors).size === colors.length, {
		message: 'colors must contain each selected WUBRG color at most once',
	})
	.nullable();
const sourceTextSchema = z.string().refine(
	source => new TextEncoder().encode(source).byteLength <= MAX_SOURCE_BYTES,
	{ message: 'Source text must not exceed 64 KiB' },
);
const nameSchema = z.string().trim().min(1).max(200);
const archetypeLabelSchema = z.string().trim().max(200).nullable();

export const createBroadcastDeckListSchema = z.object({
	name: nameSchema,
	sourceText: sourceTextSchema,
	archetypeLabel: archetypeLabelSchema.optional(),
	colors: colorSelectionSchema.optional(),
}).strict();

export const updateBroadcastDeckListSchema = z.object({
	expectedRevision: z.number().int().positive(),
	name: nameSchema.optional(),
	sourceText: sourceTextSchema.optional(),
	archetypeLabel: archetypeLabelSchema.optional(),
	colors: colorSelectionSchema.optional(),
}).strict().refine(
	input => input.name !== undefined
		|| input.sourceText !== undefined
		|| input.archetypeLabel !== undefined
		|| input.colors !== undefined,
	{ message: 'At least one Broadcast Deck List field must be updated' },
);

export const deleteBroadcastDeckListSchema = z.object({
	expectedRevision: z.number().int().positive(),
}).strict();

export const broadcastDeckListParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	listId: z.coerce.number().int().positive(),
});

export type CreateBroadcastDeckListInput = z.infer<typeof createBroadcastDeckListSchema>;
export type UpdateBroadcastDeckListInput = z.infer<typeof updateBroadcastDeckListSchema>;
export type DeleteBroadcastDeckListInput = z.infer<typeof deleteBroadcastDeckListSchema>;

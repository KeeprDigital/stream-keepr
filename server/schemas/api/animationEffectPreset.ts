import { z } from 'zod';
import { animationEffectPresetNameSchema } from '~~/shared/animationEffectPresets';
import { animationEffectSelectionSchema } from '~~/shared/animationEffects';

export const animationEffectPresetParamsSchema = z.strictObject({
	presetId: z.string().uuid(),
});

export const createAnimationEffectPresetSchema = z.strictObject({
	name: animationEffectPresetNameSchema,
	selection: animationEffectSelectionSchema,
});

export const updateAnimationEffectPresetSchema = z.strictObject({
	revision: z.number().int().positive(),
	name: animationEffectPresetNameSchema.optional(),
	selection: animationEffectSelectionSchema.optional(),
}).refine(value => value.name !== undefined || value.selection !== undefined, {
	message: 'An Animation Effect Preset change is required',
});

export const importAnimationEffectPresetSchema = z.strictObject({
	document: z.string(),
});

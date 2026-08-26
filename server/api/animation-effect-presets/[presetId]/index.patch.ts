import { mapAnimationEffectPreset } from '~~/server/mappers/animationEffectPreset';
import {
	animationEffectPresetParamsSchema,
	updateAnimationEffectPresetSchema,
} from '~~/server/schemas/api/animationEffectPreset';
import {
	AnimationEffectPresetRevisionConflict,
	animationEffectPresetService,
} from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';
import { MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES } from '~~/shared/animationEffectPresets';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { presetId } = await getValidatedRouterParams(event, animationEffectPresetParamsSchema.parse);
	const body = updateAnimationEffectPresetSchema.parse(
		await readJsonPayloadLimited(event, MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES, 'Animation Effect Preset'),
	);

	try {
		const preset = await animationEffectPresetService().update(presetId, body);
		if (!preset) {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Animation Effect Preset not found',
			});
		}
		return mapAnimationEffectPreset(preset);
	}
	catch (error) {
		if (error instanceof AnimationEffectPresetRevisionConflict) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: `Animation Effect Preset has been revised by another session (now revision ${error.currentRevision})`,
			});
		}
		throw error;
	}
});

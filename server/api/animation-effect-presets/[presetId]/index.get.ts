import { mapAnimationEffectPreset } from '~~/server/mappers/animationEffectPreset';
import { animationEffectPresetParamsSchema } from '~~/server/schemas/api/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { presetId } = await getValidatedRouterParams(event, animationEffectPresetParamsSchema.parse);
	const preset = await animationEffectPresetService().findById(presetId);
	if (!preset) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Animation Effect Preset not found',
		});
	}
	return mapAnimationEffectPreset(preset);
});

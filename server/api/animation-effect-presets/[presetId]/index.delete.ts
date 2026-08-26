import { animationEffectPresetParamsSchema } from '~~/server/schemas/api/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { presetId } = await getValidatedRouterParams(event, animationEffectPresetParamsSchema.parse);
	const removed = await animationEffectPresetService().remove(presetId);
	if (!removed) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Animation Effect Preset not found',
		});
	}

	setResponseStatus(event, 204);
	return null;
});

import { animationEffectPresetParamsSchema } from '~~/server/schemas/api/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';
import { encodeAnimationEffectPresetDocument } from '~~/shared/animationEffectPresets';

function exportFileName(name: string): string {
	const stem = name
		.normalize('NFKD')
		.replace(/[^\w.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return `${stem || 'animation-effect-preset'}.skeffect`;
}

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

	setResponseHeaders(event, {
		'content-type': 'application/json; charset=utf-8',
		'content-disposition': `attachment; filename="${exportFileName(preset.name)}"`,
		'cache-control': 'no-store',
	});
	return encodeAnimationEffectPresetDocument(preset);
});

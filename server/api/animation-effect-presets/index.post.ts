import { mapAnimationEffectPreset } from '~~/server/mappers/animationEffectPreset';
import { createAnimationEffectPresetSchema } from '~~/server/schemas/api/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';
import { MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES } from '~~/shared/animationEffectPresets';
import { randomUuid } from '~~/shared/utils/uuid';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const body = createAnimationEffectPresetSchema.parse(
		await readJsonPayloadLimited(event, MAX_ANIMATION_EFFECT_PRESET_DOCUMENT_BYTES, 'Animation Effect Preset'),
	);
	const preset = await animationEffectPresetService().create({
		id: randomUuid(),
		...body,
	});
	setResponseStatus(event, 201);
	return mapAnimationEffectPreset(preset);
});

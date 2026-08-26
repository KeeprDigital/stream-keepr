import { mapAnimationEffectPreset } from '~~/server/mappers/animationEffectPreset';
import { animationEffectPresetService } from '~~/server/services/animationEffectPreset';
import { requireUserId } from '~~/server/utils/auth';

export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const presets = await animationEffectPresetService().findAll();
	return { presets: presets.map(mapAnimationEffectPreset) };
});

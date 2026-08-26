import type { DbAnimationEffectPreset } from '~~/server/db/schema';
import type { AnimationEffectPresetResponse } from '~~/shared/types/animationEffectPreset';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapAnimationEffectPreset(preset: DbAnimationEffectPreset): AnimationEffectPresetResponse {
	return mapTimestamps(preset);
}

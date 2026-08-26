import type { AnimationEffectSelection } from '../animationEffects';

export interface AnimationEffectPresetResponse {
	id: string;
	name: string;
	revision: number;
	selection: AnimationEffectSelection;
	createdAt: Date;
	updatedAt: Date;
}

export interface AnimationEffectPresetListResponse {
	presets: AnimationEffectPresetResponse[];
}

import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import type { StoredThemeTokens, ThemeAsset } from '~~/shared/modules/theme';
import type { FeatureMatchOverlaySurface } from './renderModel';
import { FOUNDATION_TOKENS, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeTokens } from '~~/shared/screenModes';

/**
 * What the Feature Match Overlay's host-owned parts paint from (#831): its
 * Mode Tokens, resolved for one Screen from its overrides, else its Theme,
 * else their defaults. Its Graphic Items bind Foundation Tokens instead.
 */
export interface FeatureMatchOverlayThemeValues {
	frameSurface: FeatureMatchOverlaySurface;
	/** The Theme's media painted in the Frame beneath its own, or none. */
	frameMedia: ThemeAsset | null;
	frameAnimationEffect: AnimationEffectSelection;
	sourceSurface: FeatureMatchOverlaySurface;
}

const MODE_TOKENS = screenModeTokens('feature-match-overlay');

export function resolveFeatureMatchOverlayThemeValues(theme: StoredThemeTokens, overrides: StoredThemeTokens): FeatureMatchOverlayThemeValues {
	const { values } = resolveThemeTokens({
		vocabulary: FOUNDATION_TOKENS,
		modeTokens: MODE_TOKENS,
		theme,
		overrides,
	});
	return {
		frameSurface: values['feature-match-overlay.frame-surface'] as FeatureMatchOverlaySurface,
		frameMedia: values['feature-match-overlay.frame-media'] as ThemeAsset | null,
		frameAnimationEffect: values['feature-match-overlay.frame-animation-effect'] as AnimationEffectSelection,
		sourceSurface: values['feature-match-overlay.source-surface'] as FeatureMatchOverlaySurface,
	};
}

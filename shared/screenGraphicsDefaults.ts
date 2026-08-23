import type { FeatureMatchOverlayFrameAnimationConfig, ScreenMediaBackgroundConfig } from './types/screenConfig';

/**
 * The starting values a Screen's media background and a Feature Match Overlay
 * Frame's decorative animation take.
 *
 * They live beside `shared/types/screenConfig.ts` rather than in it because the
 * Feature Match Overlay Presets build a whole Frame, and the mode-configuration
 * module reads its default Feature Match Overlay configuration back from those
 * presets. One of the two directions has to be values-free, and a pair of
 * starting values is the smaller thing to move.
 *
 * `shared/types/screenConfig.ts` re-exports both, so every existing consumer
 * keeps one import.
 */

export const DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG: ScreenMediaBackgroundConfig = {
	enabled: false,
	type: 'video',
	url: '',
	fit: 'cover',
	opacity: 1,
	playbackRate: 1,
	loop: true,
};

/**
 * Effect params are deliberately absent: each Animation Effect's Zod schema is
 * the single source of its defaults, so an empty bag means "as shipped" and
 * never goes stale against the catalogue.
 */
export const DEFAULT_FRAME_ANIMATION: FeatureMatchOverlayFrameAnimationConfig = {
	enabled: false,
	effect: 'fog',
	opacity: 0.45,
};

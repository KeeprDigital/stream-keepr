import type { BroadcastGraphicsBackgroundConfig, FeatureMatchOverlayFrameAnimationConfig, ScreenMediaBackgroundConfig } from './types/screenConfig';

/**
 * The starting values a Screen's media background, a Feature Match Overlay
 * Frame's decorative animation, and a Broadcast Graphics Background take.
 *
 * They live beside `shared/types/screenConfig.ts` rather than in it because the
 * Feature Match Overlay Presets build a whole Frame, and the mode-configuration
 * module reads its default Feature Match Overlay configuration back from those
 * presets. One of the two directions has to be values-free, and a pair of
 * starting values is the smaller thing to move.
 *
 * `shared/types/screenConfig.ts` re-exports them, so every existing consumer
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

/**
 * What a Broadcast Graphics Screen's background starts as: the catalogue's fog,
 * fully opaque.
 *
 * Opaque rather than the Frame's 0.45, because the two are different things. The
 * Frame's animation is decoration inside a graphic area that already has a colour
 * and an image behind it; a Screen's background is the picture, with only the
 * Screen Output's own black behind it.
 */
export const DEFAULT_BROADCAST_GRAPHICS_BACKGROUND: BroadcastGraphicsBackgroundConfig = {
	enabled: false,
	effect: 'fog',
	opacity: 1,
};

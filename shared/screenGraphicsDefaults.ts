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

export const DEFAULT_FRAME_ANIMATION: FeatureMatchOverlayFrameAnimationConfig = {
	enabled: false,
	effect: 'fog',
	opacity: 0.45,
	highlightColor: '#f59e0b',
	midtoneColor: '#7c3aed',
	lowlightColor: '#06b6d4',
	baseColor: '#111111',
	blurFactor: 0.55,
	speed: 0.6,
	zoom: 1,
	color: '#7c3aed',
	color2: '#06b6d4',
	backgroundColor: '#111111',
	shininess: 30,
	waveHeight: 20,
	waveSpeed: 1,
	points: 10,
	maxDistance: 22,
	spacing: 16,
	showDots: true,
	size: 3,
	showLines: true,
	mouseDriftEnabled: true,
	mouseDriftMode: 'orbit',
	mouseDriftSeconds: 18,
	mouseDriftRadius: 0.28,
};

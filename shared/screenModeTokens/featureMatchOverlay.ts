import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/**
 * How the Feature Match Overlay's host-owned parts look: the Frame's and the
 * Source Items' Mode Tokens, by name within the mode (#831). Its Graphic Items
 * bind Foundation Tokens themselves.
 *
 * A surface carries the fill, the outline (the Frame's canvas-edge border, a
 * Source Item's framing border) and the glow around that outline. Their
 * defaults keep the look the Feature Match Overlay Presets had before Themes,
 * with the outline on the accent so a Theme's accent reaches it.
 */
export const featureMatchOverlayModeTokens = {
	'frame-surface': {
		type: 'surface-style',
		label: 'Frame surface',
		default: {
			fill: { type: 'solid', color: '#111111' },
			fillOpacity: 0.92,
			outline: {
				color: { token: 'accent' },
				width: 4,
			},
		},
	},
	'frame-media': {
		type: 'asset',
		label: 'Frame media',
		assetKinds: ['image', 'silent-video'],
		// None: the Frame shows its own fill, image and video.
		default: null,
	},
	'frame-animation-effect': {
		type: 'animationEffect',
		label: 'Frame Animation Effect',
		default: { token: 'animation-effect' },
	},
	'source-surface': {
		type: 'surface-style',
		label: 'Source Item surface',
		default: {
			fill: { type: 'solid', color: '#000000' },
			fillOpacity: 0,
			outline: {
				color: { token: 'accent' },
				width: 4,
			},
		},
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;

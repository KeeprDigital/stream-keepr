import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import { EVENT_CANVAS_SIDE_BOUNDS } from '../eventCanvas';

/** The Standings settings groups its Mode Tokens may name (ADR-0072). */
export type StandingsSettingsGroup = 'header' | 'data' | 'table';

/** How the Standings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const standingsModeTokens = {
	'surface': {
		type: 'color',
		label: 'Table surface',
		settingsGroup: 'table',
		default: { token: 'surface' },
	},
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		settingsGroup: 'header',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		settingsGroup: 'header',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		settingsGroup: 'header',
		default: { token: 'divider' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row type',
		settingsGroup: 'table',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		settingsGroup: 'table',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name and points text',
		settingsGroup: 'table',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Position, record and deck text',
		settingsGroup: 'table',
		default: { token: 'text-secondary' },
	},
	'rise': {
		type: 'color',
		label: 'Position Change climb',
		settingsGroup: 'table',
		default: { token: 'positive' },
	},
	'fall': {
		type: 'color',
		label: 'Position Change drop',
		settingsGroup: 'table',
		default: { token: 'negative' },
	},
	// The widest the table runs, centred. It ships at the widest Event Canvas,
	// so the table fills its Screen until a Theme narrows it.
	'max-width': {
		type: 'dimension',
		label: 'Table max width',
		settingsGroup: 'table',
		default: EVENT_CANVAS_SIDE_BOUNDS.max,
		bounds: EVENT_CANVAS_SIDE_BOUNDS,
	},
	// How a row enters, leaves back to, and moves, each row an eighth of the
	// duration after the one above. A recipe with no channel cuts.
	'row-motion': {
		type: 'animation-recipe',
		label: 'Row enter and exit',
		settingsGroup: 'table',
		default: {
			duration: 400,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'west', distanceMode: 'fixed', distance: 20 },
		},
	},
	// The `reveal` view mode's rows, in place of `row-motion`: a rise for the reveal.
	'reveal-motion': {
		type: 'animation-recipe',
		label: 'Revealed row enter and exit',
		settingsGroup: 'data',
		default: {
			duration: 600,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'south', distanceMode: 'fixed', distance: 20 },
			scale: { factor: 0.95, origin: 'center' },
		},
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<StandingsSettingsGroup>>>;

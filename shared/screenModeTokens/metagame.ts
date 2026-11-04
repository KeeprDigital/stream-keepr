import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import { EVENT_CANVAS_SIDE_BOUNDS } from '../eventCanvas';

/** One of the chart's categorical colour slots, following the Theme's chart palette. */
function chartSlot<N extends number>(slot: N) {
	return {
		type: 'color',
		label: `Chart colour ${slot}`,
		default: { token: `series-${slot}` },
		settingsGroup: 'chart',
	} as const;
}

/** The Metagame settings groups its Mode Tokens may name (ADR-0072). */
export type MetagameSettingsGroup = 'header' | 'table' | 'chart' | 'size-and-surface';

/**
 * How the Metagame Screen Mode looks: its Mode Tokens, by name within the mode.
 * Every bar is named, so identity never rests on its colour alone.
 */
export const metagameModeTokens = {
	'surface': {
		type: 'color',
		label: 'Table and chart surface',
		settingsGroup: 'size-and-surface',
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
	'header-typography': {
		type: 'typography',
		label: 'Column header type',
		settingsGroup: 'table',
		default: { token: 'heading' },
	},
	'header-text': {
		type: 'color',
		label: 'Column header text',
		settingsGroup: 'table',
		default: { token: 'text-secondary' },
	},
	'header-divider': {
		type: 'color',
		label: 'Column header divider',
		settingsGroup: 'table',
		default: { token: 'divider' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row and chart label type',
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
		label: 'Name, headline figure and chart label text',
		settingsGroup: 'table',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Other figures and page text',
		settingsGroup: 'table',
		default: { token: 'text-secondary' },
	},
	'chart-baseline': {
		type: 'color',
		label: 'Chart baseline',
		settingsGroup: 'chart',
		default: { token: 'divider' },
	},
	'chart-series-1': chartSlot(1),
	'chart-series-2': chartSlot(2),
	'chart-series-3': chartSlot(3),
	'chart-series-4': chartSlot(4),
	'chart-series-5': chartSlot(5),
	'chart-series-6': chartSlot(6),
	'chart-series-7': chartSlot(7),
	'chart-series-8': chartSlot(8),
	'chart-other': {
		type: 'color',
		label: 'Chart Other',
		settingsGroup: 'chart',
		default: { token: 'series-other' },
	},
	// The widest the table or chart runs, centred. It ships at the widest Event
	// Canvas, so either fills its Screen until a Theme narrows it.
	'max-width': {
		type: 'dimension',
		label: 'Table and chart max width',
		settingsGroup: 'size-and-surface',
		default: EVENT_CANVAS_SIDE_BOUNDS.max,
		bounds: EVENT_CANVAS_SIDE_BOUNDS,
	},
	// How a row enters, leaves back to, and moves, each row an eighth of the
	// duration after the one above, and how a chart bar grows on its timing.
	// A recipe with no channel cuts.
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
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<MetagameSettingsGroup>>>;

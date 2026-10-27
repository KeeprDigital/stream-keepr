import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** One of the chart's categorical colour slots, holding the colour it shipped with. */
function chartSeries(slot: number, color: string) {
	return {
		type: 'color',
		label: `Chart colour ${slot}`,
		default: color,
	} as const;
}

/**
 * How the Metagame Screen Mode looks: its Mode Tokens, by name within the mode.
 *
 * The chart's categorical slots hold literals, since no Foundation Token is a
 * categorical palette. They are stepped for a dark surface and validated as a
 * set for adjacent-pair CVD separation and >= 3:1 against #1a1a19. Every bar
 * is named, so identity never rests on its colour alone. Other is the
 * neutral, never a slot.
 */
export const metagameModeTokens = {
	'surface': {
		type: 'color',
		label: 'Table and chart surface',
		default: { token: 'surface' },
	},
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		default: { token: 'divider' },
	},
	'header-typography': {
		type: 'typography',
		label: 'Column header type',
		default: { token: 'heading' },
	},
	'header-text': {
		type: 'color',
		label: 'Column header text',
		default: { token: 'text-secondary' },
	},
	'header-divider': {
		type: 'color',
		label: 'Column header divider',
		default: { token: 'divider' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row and chart label type',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name, headline figure and chart label text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Other figures and page text',
		default: { token: 'text-secondary' },
	},
	'chart-baseline': {
		type: 'color',
		label: 'Chart baseline',
		default: { token: 'divider' },
	},
	'chart-series-1': chartSeries(1, '#3987e5'),
	'chart-series-2': chartSeries(2, '#d95926'),
	'chart-series-3': chartSeries(3, '#199e70'),
	'chart-series-4': chartSeries(4, '#c98500'),
	'chart-series-5': chartSeries(5, '#d55181'),
	'chart-series-6': chartSeries(6, '#008300'),
	'chart-series-7': chartSeries(7, '#9085e9'),
	'chart-series-8': chartSeries(8, '#e66767'),
	'chart-other': {
		type: 'color',
		label: 'Chart Other',
		default: '#898781',
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;

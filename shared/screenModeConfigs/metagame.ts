import type { Game, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameSortBy } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import {
	METAGAME_ARCHETYPE_COLUMN_KEY_VALUES,
	METAGAME_CARD_COLUMN_KEY_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_SORT_BY_VALUES,
	METAGAME_VIEW_MODE_VALUES,
} from '../types/enums';
import { isMetagameColumnOffered, isMetagameSortOffered } from '../utils/metagame';
import { METAGAME_CHART_MAX_ARCHETYPES } from '../utils/metagameChart';
import { defineScreenModeConfigContract } from './contract';
import { editorField, withEditorMeta } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_METAGAME_SCOPE, DEFAULT_PAGE_ROTATION, headerConfigShape, METAGAME_CARD_SORT_BY_LABELS, metagameArchetypeFilterField, metagameScopeShape, pageRotationPageSize, pageRotationShape, returnsToFirstPage, tableMaxWidthField } from './subShapes';

const METAGAME_SORT_BY_LABELS = {
	metaShare: 'Meta share',
	count: 'Count',
	winRate: 'Win rate',
	conversionRate: 'Conversion rate',
} as const satisfies Record<MetagameSortBy, string>;

/** Each Metagame table column's heading on its column list. */
const METAGAME_COLUMN_LABELS = {
	archetype: 'Archetype',
	count: 'Count',
	metaShare: 'Share',
	winRate: 'Win rate',
	avgPlace: 'Average place',
	colors: 'Colours',
	conversionRate: 'Conversion rate',
	card: 'Card',
	manaCost: 'Cost',
	type: 'Type',
	inclusionRate: 'Inclusion',
	avgCopies: 'Average copies',
	totalCopies: 'Total copies',
	deckCount: 'Decks',
	mainboardCount: 'Main',
	sideboardCount: 'Side',
} as const satisfies Record<MetagameArchetypeColumnKey | MetagameCardColumnKey, string>;

/** The labels of `keys` the Event's Card Game reads (ADR-0074). */
function offeredColumns<Key extends keyof typeof METAGAME_COLUMN_LABELS>(keys: readonly Key[], game: Game | undefined): Partial<Record<Key, string>> {
	const labels: Partial<Record<Key, string>> = {};
	for (const key of keys.filter(key => isMetagameColumnOffered(game, key)))
		labels[key] = METAGAME_COLUMN_LABELS[key];
	return labels;
}

/** A column list: its table's columns, in order, each shown or hidden. */
const columnList = {
	label: 'Columns',
	card: 'content',
	slot: 'columns',
	description: 'Drag to reorder, toggle to show or hide.',
} as const;

const showsCards = ({ config }: ScreenSettingsContext) => config.viewMode === 'cards';
/** A chart is never paged, and has no table. */
const pagesTable = ({ config }: ScreenSettingsContext) => config.viewMode !== 'chart';

/** The Metagame Screen Mode's config contract: its shape, type, and defaults. */
export const metagameModeConfigContract = defineScreenModeConfigContract({
	// View selection
	viewMode: editorField(z.enum(METAGAME_VIEW_MODE_VALUES), {
		label: 'View',
		card: 'source',
		description: 'The metagame table or chart to show.',
		options: { archetype: 'Archetypes', cards: 'Cards', chart: 'Chart' },
	}),

	// Scoping
	...metagameScopeShape,
	/** The Archetype the cards view counts alone; an Event Reference (ADR-0038). */
	archetypeId: withEditorMeta(metagameArchetypeFilterField, { showWhen: showsCards }),

	// Sorting
	sortBy: editorField(z.enum(METAGAME_SORT_BY_VALUES), {
		label: 'Sort by',
		card: 'content',
		group: 'archetypes',
		// The sorts the Event's Card Game reads (ADR-0074).
		options: ({ event }) => Object.fromEntries(Object.entries(METAGAME_SORT_BY_LABELS)
			.filter(([sortBy]) => isMetagameSortOffered(event?.game, sortBy as MetagameSortBy))),
		...returnsToFirstPage,
	}),
	cardSortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), {
		label: 'Sort by',
		card: 'content',
		group: 'cards',
		options: METAGAME_CARD_SORT_BY_LABELS,
		...returnsToFirstPage,
	}),

	// Column configuration (ordered arrays — order = display order)
	archetypeColumns: editorField(z.array(columnConfigSchema(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES)).min(1).max(10), {
		...columnList,
		group: 'archetypes',
		showWhen: ({ config }) => config.viewMode === 'archetype',
		options: ({ event }) => offeredColumns(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES, event?.game),
	}),
	cardColumns: editorField(z.array(columnConfigSchema(METAGAME_CARD_COLUMN_KEY_VALUES)).min(1).max(12), {
		...columnList,
		group: 'cards',
		options: ({ event }) => offeredColumns(METAGAME_CARD_COLUMN_KEY_VALUES, event?.game),
	}),

	// Display limits
	limit: editorField(z.number().int().min(1).max(500), {
		label: 'Limit',
		card: 'content',
		group: 'cards',
		description: 'The most card rows to include.',
		...returnsToFirstPage,
	}),
	archetypeLimit: editorField(z.number().int().min(1).max(500).nullable().optional(), {
		label: 'Limit',
		card: 'content',
		group: 'archetypes',
		placeholder: 'All',
		description: ({ config }) => config.viewMode === 'chart'
			? `Show the top archetypes and group the rest as Other; the chart draws at most ${METAGAME_CHART_MAX_ARCHETYPES}.`
			: 'Show the top archetypes and group the rest as Other.',
		...returnsToFirstPage,
	}),

	// The widest the table or chart runs, centred, in Event Canvas pixels. Absent is Auto: it fills its Screen.
	maxWidth: tableMaxWidthField('size'),

	// Pagination: the table's pages; a chart is never paged.
	pageSize: withEditorMeta(pageRotationPageSize, { description: 'Table rows on each page.', showWhen: pagesTable }),
	...pageRotationShape,
	autoPageEnabled: withEditorMeta(pageRotationShape.autoPageEnabled, { showWhen: pagesTable }),
	autoPageIntervalMs: withEditorMeta(pageRotationShape.autoPageIntervalMs, {
		showWhen: context => pagesTable(context) && context.config.autoPageEnabled === true,
	}),
	currentPage: withEditorMeta(pageRotationShape.currentPage, { showWhen: pagesTable }),
	rotationAnchor: withEditorMeta(pageRotationShape.rotationAnchor, { showWhen: pagesTable }),

	// Visibility toggles
	...headerConfigShape({
		shows: 'Show the metagame title above the table.',
		auto: 'Empty shows a title for the view and scope.',
	}),
}, {
	viewMode: 'archetype',
	...DEFAULT_METAGAME_SCOPE,
	archetypeId: undefined,
	sortBy: 'metaShare',
	cardSortBy: 'inclusionRate',
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
		{ key: 'conversionRate', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	archetypeLimit: null,
	maxWidth: undefined,
	pageSize: 10,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
}, {
	groups: {
		archetypes: {
			title: 'Archetypes',
			card: 'content',
			showWhen: context => !showsCards(context),
		},
		cards: { title: 'Cards', card: 'content', showWhen: showsCards },
		table: { title: 'Table', card: 'content', showWhen: pagesTable },
		size: { title: 'Size', card: 'content' },
	},
});

export type MetagameModeConfig = ScreenModeConfigOf<typeof metagameModeConfigContract>;
export type MetagameArchetypeColumnConfig = MetagameModeConfig['archetypeColumns'][number];
export type MetagameCardColumnConfig = MetagameModeConfig['cardColumns'][number];

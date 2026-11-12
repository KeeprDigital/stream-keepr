import type { BoardSelection, MetagameCardSortBy, MetagameScope } from '../types/enums';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import { getFeatureMatchStateTracking, getMetagameRules } from '../config/games';
import { EVENT_CANVAS_SIDE_BOUNDS, eventCanvasOf } from '../eventCanvas';
import { METAGAME_SCOPE_VALUES } from '../types/enums';
import { CARD_BADGE_SIZE_BOUNDS } from '../utils/cardBadgeSize';
import { CARD_ASPECT } from '../utils/cardGrid';
import { editorField } from './fields';

/** What each Metagame Scope is called on its select. */
const METAGAME_SCOPE_LABELS = {
	all: 'All Players',
	topN: 'Top N',
	minPoints: 'Minimum points',
	playerList: 'Player List',
} as const satisfies Record<MetagameScope, string>;

/**
 * Sub-shapes more than one Screen Mode's config contract repeats, so a bound
 * written once holds for every mode that carries the field.
 */

/** One column of a table mode: which it is, and whether it shows. A list of them is ordered as displayed. */
export function columnConfigSchema<const Keys extends readonly [string, ...string[]]>(keys: Keys) {
	return z.object({
		key: z.enum(keys),
		visible: z.boolean(),
	}).strict();
}

/** Whether a table mode's column list shows the column `key`. */
export function isColumnVisible<Key extends string>(
	columns: ReadonlyArray<{ key: Key; visible: boolean }>,
	key: Key,
): boolean {
	return columns.some(column => column.key === key && column.visible);
}

/**
 * A stored column list as its editor offers it, with every column its mode
 * offers: each of the mode's default columns it lacks is appended hidden, in the
 * defaults' order. A column added to a mode after a Screen stored its list is not
 * stored, so it renders as before, hidden; its editor offers it hidden too, and
 * the operator's first show, hide or reorder stores it. A complete list is
 * returned as it is.
 */
export function withEveryColumn<Column extends { key: string; visible: boolean }>(
	columns: readonly Column[],
	defaultColumns: readonly Column[],
): Column[] {
	const held = new Set(columns.map(column => column.key));
	const missing = defaultColumns.filter(column => !held.has(column.key));
	if (missing.length === 0)
		return columns as Column[];
	return [
		...columns,
		...missing.map(column => ({ ...column, visible: false })),
	];
}

/**
 * The optional header above a mode's content, described in the mode's own
 * words: what the header shows, and what it shows while its text is empty.
 */
export function headerConfigShape(header: { shows: string; auto: string }) {
	return {
		showHeader: editorField(z.boolean(), { label: 'Show header', card: 'header', description: header.shows }),
		headerText: editorField(z.string().max(200).optional(), {
			label: 'Header text',
			card: 'header',
			description: header.auto,
			placeholder: 'Auto',
			showWhen: ({ config }) => config.showHeader === true,
		}),
	};
}

export const DEFAULT_HEADER_CONFIG = {
	showHeader: true,
	headerText: undefined,
} as const;

/**
 * A Metagame Scope: which Players a mode's metagame read counts. Every Player,
 * the top N by placement, those with at least a minimum match-point total, or
 * one Player List's members; each field past `scope` is read only under its own
 * scope. Every mode reading the metagame carries it, so a scope asks each read
 * the same question. `playerListId` names a Player List in the Event, an Event
 * Reference each mode declares on its definition (ADR-0038).
 */
export const metagameScopeShape = {
	scope: editorField(z.enum(METAGAME_SCOPE_VALUES), {
		label: 'Player scope',
		card: 'source',
		description: 'Which Players the metagame counts.',
		// Every scope the Event's Card Game reads (ADR-0074); a Player List only once the Event holds one.
		options: ({ event, hasPlayerLists }) => {
			const scopes = event?.game
				? getMetagameRules(event.game).scopes
				: METAGAME_SCOPE_VALUES;
			return Object.fromEntries(Object.entries(METAGAME_SCOPE_LABELS)
				.filter(([scope]) => scopes.includes(scope as MetagameScope) && (scope !== 'playerList' || hasPlayerLists)));
		},
	}),
	topN: editorField(z.number().int().min(1).max(500), {
		label: 'Top N',
		card: 'source',
		description: 'Count the top N Players by position.',
		showWhen: ({ config }) => config.scope === 'topN',
	}),
	minPoints: editorField(z.number().int().min(0).max(999), {
		label: 'Minimum points',
		card: 'source',
		description: 'Count Players with at least this many match points.',
		showWhen: ({ config }) => config.scope === 'minPoints',
	}),
	playerListId: editorField(z.number().int().positive().optional(), {
		label: 'Player List',
		card: 'source',
		reference: 'playerList',
		description: 'Count this list\'s Players only.',
		showWhen: ({ config }) => config.scope === 'playerList',
	}),
};

/** The Metagame Scope's fields, which a display reset keeps on every mode carrying it. */
export const METAGAME_SCOPE_FIELDS = [
	'scope',
	'topN',
	'minPoints',
	'playerListId',
] as const satisfies readonly (keyof typeof metagameScopeShape)[];

export const DEFAULT_METAGAME_SCOPE = {
	scope: 'all',
	topN: 8,
	minPoints: 9,
	playerListId: undefined,
} as const;

/** What each part of a deck a card read counts is called. */
export const BOARD_SELECTION_LABELS = {
	full: 'Full deck',
	mainboard: 'Mainboard',
	sideboard: 'Sideboard',
} as const satisfies Record<BoardSelection, string>;

/** Whether the Event's Card Game has Sideboards, so a board choice can apply; assumed until the Event loads. */
export function hasSideboard({ event }: ScreenSettingsContext): boolean {
	return !event?.game || getFeatureMatchStateTracking(event.game).sideboard;
}

/**
 * A card read's archetype filter: the Archetype whose decks the cards are
 * narrowed to, an Event Reference by id (ADR-0038), so a rename keeps it and a
 * delete unsets it (ADR-0060). A mode carries it as `archetypeId`.
 */
export const metagameArchetypeFilterField = editorField(z.number().int().positive().optional(), {
	label: 'Archetype filter',
	card: 'source',
	reference: 'archetype',
	description: 'Count one archetype\'s cards only.',
	placeholder: 'All archetypes',
});

/**
 * A paginated mode's Page Rotation: `currentPage` is the manually selected page
 * (auto-page off); `rotationAnchor` is the rotation's epoch (auto-page on),
 * written only by operator surfaces and projected against server time by every
 * rendering. How many rows a page holds is a field the mode names itself, which
 * its Screen Mode Definition declares (`pageRotation`), validated by
 * `pageRotationPageSize`.
 */
export const pageRotationShape = {
	autoPageEnabled: editorField(z.boolean(), { label: 'Auto-page', card: 'live', description: 'Show each page in turn.' }),
	autoPageIntervalMs: editorField(z.number().int().min(3000).max(60000), {
		label: 'Interval (seconds)',
		card: 'paging',
		description: 'How long each page shows.',
		displayScale: 1000,
		showWhen: ({ config }) => config.autoPageEnabled === true,
	}),
	currentPage: editorField(z.number().int().min(1).optional(), { label: 'Page', card: 'live', slot: 'page-rotation' }),
	rotationAnchor: editorField(z.number().int().nonnegative().optional(), { label: 'Rotation start', card: 'live', slot: 'page-rotation' }),
};

/** The Page Rotation fields as a paginated mode's config holds them. */
export type PageRotationConfig = z.input<z.ZodObject<typeof pageRotationShape>>;

export const DEFAULT_PAGE_ROTATION = {
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
} as const;

/**
 * Editor meta for a field outside the Source card that reorders or recounts the
 * rows a Page Rotation pages, such as a sort or a limit: its edit returns to
 * page 1, as every Source edit does.
 */
export const returnsToFirstPage = {
	writesWith: () => ({ currentPage: 1 }),
} as const;

/** What each sort of a card ranking is called. */
export const METAGAME_CARD_SORT_BY_LABELS = {
	inclusionRate: 'Inclusion rate',
	avgCopies: 'Average copies',
	totalCopies: 'Total copies',
} as const satisfies Record<MetagameCardSortBy, string>;

/** How many rows a page of a Page Rotation holds, under whichever name its mode gives the field. */
export const pageRotationPageSize = editorField(z.number().int().min(1).max(100), { label: 'Rows per page', card: 'paging' });

/** A list board's rows show in columns; a Card Layout lays out a grid. */
const showsCardGrid = ({ block }: ScreenSettingsContext) => block?.view !== 'list';

/** The widest card the Screen's Event Canvas holds whole, at a card's aspect. */
function largestCardOnCanvas({ event }: ScreenSettingsContext): number {
	const canvas = eventCanvasOf(event);
	return Math.floor(Math.min(canvas.width, canvas.height * CARD_ASPECT));
}

/**
 * A card grid's Card Layout (ADR-0054): each value a number, or Auto while
 * absent. Columns run to `mostCards`, the most cards the grid can hold; a max
 * card size to the largest side an Event Canvas may have; the gap bound is the
 * one every card grid shares. Its editor narrows each to the content: columns
 * to `mostColumns`, the cards the Screen shows, where the mode knows it, and
 * a max card size to the largest card its Event's canvas holds. `group` is the
 * Screen Settings Group of the Content card the grid's settings sit in; each
 * shows for a grid whose layout is `editable`, as a sideboard following the
 * mainboard's is not.
 */
export function cardLayoutShape(
	mostCards: number,
	group: string,
	editable: (context: ScreenSettingsContext) => boolean = () => true,
	mostColumns?: (context: ScreenSettingsContext) => number | undefined,
) {
	const place = {
		card: 'content',
		group,
		placeholder: 'Auto',
		showWhen: (context: ScreenSettingsContext) => showsCardGrid(context) && editable(context),
	} as const;
	return {
		columns: editorField(z.number().int().min(1).max(mostCards).optional(), { ...place, label: 'Columns', maxFor: mostColumns }),
		/** The widest a card may be, in Event Canvas px. */
		maxCardSize: editorField(z.number().int().min(48).max(EVENT_CANVAS_SIDE_BOUNDS.max).optional(), {
			...place,
			label: 'Max card size',
			description: 'The widest a card may be, in px.',
			maxFor: largestCardOnCanvas,
		}),
		cardGap: editorField(z.number().int().min(0).max(100).optional(), { ...place, label: 'Card gap' }),
	};
}

/** A Card Layout nobody has set: every value Auto. Named, so a display reset returns each to Auto. */
export const DEFAULT_CARD_LAYOUT = {
	columns: undefined,
	maxCardSize: undefined,
	cardGap: undefined,
} as const;

/**
 * A card badge's size: its text size in px, which the badge is laid out around
 * in em. Absent is Auto: a share of its card's solved width (`cardBadgeTextSize`).
 */
export function cardBadgeSizeField(group: string, showWhen?: (context: ScreenSettingsContext) => boolean) {
	return editorField(z.number().int().min(CARD_BADGE_SIZE_BOUNDS.min).max(CARD_BADGE_SIZE_BOUNDS.max).optional(), {
		label: 'Badge size',
		card: 'content',
		group,
		placeholder: 'Auto',
		description: 'Its text size in px; Auto follows the card.',
		showWhen,
	});
}

/**
 * The widest a table mode's content runs, in Event Canvas pixels, under the name
 * `maxWidth`. Absent is Auto: the content fills its Screen. `group` is the
 * Screen Settings Group of the Content card it sits in.
 */
export function tableMaxWidthField(group: string, showWhen?: (context: ScreenSettingsContext) => boolean) {
	return editorField(
		z.number().int().min(EVENT_CANVAS_SIDE_BOUNDS.min).max(EVENT_CANVAS_SIDE_BOUNDS.max).optional(),
		{
			label: 'Max width',
			card: 'content',
			group,
			placeholder: 'Auto',
			description: 'The widest it runs, centred. Auto fills the Screen.',
			showWhen,
		},
	);
}

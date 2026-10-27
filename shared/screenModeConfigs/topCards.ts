import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	TOP_CARDS_STAT_VALUES,
} from '../types/enums';
import { CARD_TYPE_BUCKET_ORDER } from '../utils/metagame';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import {
	DEFAULT_HEADER_CONFIG,
	DEFAULT_METAGAME_SCOPE_WITHOUT_MIN_POINTS,
	DEFAULT_PAGE_ROTATION,
	headerConfigShape,
	metagameArchetypeFilterField,
	metagameScopeShapeWithoutMinPoints,
	pageRotationPageSize,
	pageRotationShape,
} from './subShapes';

/** The most cards a Most Played Cards Screen ranks. */
const TOP_CARDS_MAX_LIMIT = 60;

/**
 * The most grid rows a Most Played Cards grid can have: every card a Screen can rank,
 * in one column. As the default page size, it holds any grid on one page.
 */
const TOP_CARDS_MAX_GRID_ROWS = TOP_CARDS_MAX_LIMIT;

/**
 * The Most Played Cards Screen Mode's config contract: a ranked grid of the most played
 * cards in the event's metagame, rendered as card images the way the Deck Screen
 * renders a deck. It is scoped by the Metagame Scope, less Minimum Points, which
 * it never offered; `excludedCardTypes` is applied server-side before `limit`,
 * so a filtered top N still fills N slots.
 *
 * Its Page Rotation pages the grid by whole grid rows: `rowsPerPage` rows of
 * `columns` cards each. The default holds the most cards a Screen can rank in
 * one column, so a Screen that never set it shows every card on one page.
 *
 * Its badge colours (#823), card size, card gap and badge size (#844) are Mode
 * Tokens; the fields it once held for them are former fields, which a stored
 * config may still carry. Whether cards fill their columns is behaviour, so
 * `dynamicCardSize` stays.
 */
export const topCardsModeConfigContract = defineScreenModeConfigContract({
	// Scoping
	...metagameScopeShapeWithoutMinPoints,
	archetypeFilter: metagameArchetypeFilterField,

	// Data selection & filtering
	board: editorField(z.enum(BOARD_SELECTION_VALUES), { label: 'Board' }),
	sortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), { label: 'Rank by' }),
	limit: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT), { label: 'Card count' }),
	excludedCardTypes: z.array(z.enum(CARD_TYPE_BUCKET_ORDER)).max(CARD_TYPE_BUCKET_ORDER.length),

	// Grid layout
	columns: editorField(z.number().int().min(1).max(12), { label: 'Columns' }),
	/** Cards fill their columns rather than taking the `card-width` Mode Token. */
	dynamicCardSize: editorField(z.boolean(), { label: 'Dynamic card size' }),

	// Pagination: grid rows per page
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,

	// Header
	...headerConfigShape,

	// Card labels & badges
	showCardNames: editorField(z.boolean(), { label: 'Show card names' }),
	showRankBadges: editorField(z.boolean(), { label: 'Show rank badges' }),
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: editorField(z.enum(TOP_CARDS_STAT_VALUES), { label: 'Stat badge' }),
}, {
	...DEFAULT_METAGAME_SCOPE_WITHOUT_MIN_POINTS,
	archetypeFilter: undefined,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	// Nonbasic lands read as noise in a "most played" ranking; basics never
	// reach the breakdown at all.
	excludedCardTypes: ['Land'],
	columns: 5,
	dynamicCardSize: true,
	rowsPerPage: TOP_CARDS_MAX_GRID_ROWS,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate',
}, {
	formerFields: [
		'rankBadgeTextColor',
		'rankBadgeBgColor',
		'statBadgeTextColor',
		'statBadgeBgColor',
		'cardSize',
		'cardGap',
		'statBadgeSize',
	],
});

export type TopCardsModeConfig = ScreenModeConfigOf<typeof topCardsModeConfigContract>;

/** How many grid rows `cardCount` cards fill, in rows of `columns` cards. */
function topCardsGridRowCount(cardCount: number, columns: number): number {
	return Math.ceil(cardCount / Math.max(1, columns));
}

/** `cards` laid out as the grid's rows of `columns` cards, the last row possibly short. */
export function topCardsGridRows<T>(cards: readonly T[], columns: number): T[][] {
	const width = Math.max(1, columns);
	return Array.from({
		length: topCardsGridRowCount(cards.length, width),
	}, (_, row) =>
		cards.slice(row * width, (row + 1) * width));
}

import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	CARD_SIZING_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	QUANTITY_POSITION_VALUES,
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
	pageRotationShape,
} from './subShapes';

/** The most cards a Most Played Cards Screen ranks. */
const TOP_CARDS_MAX_LIMIT = 60;

/**
 * The Most Played Cards Screen Mode's config contract: a ranked grid of the most played
 * cards in the event's metagame, rendered as card images the way the Deck Screen
 * renders a deck. It is scoped by the Metagame Scope, less Minimum Points, which
 * it never offered; `excludedCardTypes` and `pointedOnly` are applied
 * server-side before `limit`, so a filtered top N still fills N slots.
 *
 * Its Page Rotation pages the ranking by cards: `cardsPerPage` a page, however
 * many columns the Screen lays them out in, so a page count never depends on
 * the space the Screen measures (ADR-0054). The default is the most cards a
 * Screen can rank, so a Screen that never set it shows every card on one page.
 *
 * Its badge colours (#823) are Mode Tokens; the fields it once held for them
 * are former fields, which a stored config may still carry. Its card width,
 * card gap and badge text sizes are config, read only here (ADR-0054); the size
 * presets they replaced are former fields too. `cardSizing` replaced
 * `dynamicCardSize`. Each badge is placed and sized on its own, as a Deck
 * Screen's are; one `badgeSize` once sized both. A card's image prints its
 * name, so `showCardNames`, a label under it, is a former field.
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
	/** Only cards the Event's points system points, applied server-side before `limit`. */
	pointedOnly: editorField(z.boolean(), { label: 'Pointed only' }),

	// Grid layout
	columns: editorField(z.number().int().min(1).max(12), { label: 'Columns' }),
	/** Columns chosen from the card count and the Event Canvas, in place of `columns`. */
	autoColumns: editorField(z.boolean(), { label: 'Auto columns' }),
	/** Fit: every card on the page fits the screen. Fixed: cards take `cardWidth`. */
	cardSizing: editorField(z.enum(CARD_SIZING_VALUES), { label: 'Card sizing' }),
	/** A Fixed card's width in Event Canvas px. */
	cardWidth: editorField(z.number().int().min(48).max(480), { label: 'Card width' }),
	cardGap: editorField(z.number().int().min(0).max(100), { label: 'Card gap' }),

	// Paging: cards per page; at least `limit` is one page
	cardsPerPage: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT), { label: 'Cards per page' }),
	...pageRotationShape,

	// Header
	...headerConfigShape,

	// Card badges: each placed on its card, and sized around its own text size in px.
	showRankBadges: editorField(z.boolean(), { label: 'Show rank badges' }),
	rankBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), { label: 'Badge position' }),
	rankBadgeTextSize: editorField(z.number().int().min(8).max(48), { label: 'Badge text size' }),
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: editorField(z.enum(TOP_CARDS_STAT_VALUES), { label: 'Stat badge' }),
	statBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), { label: 'Badge position' }),
	statBadgeTextSize: editorField(z.number().int().min(8).max(48), { label: 'Badge text size' }),
}, {
	...DEFAULT_METAGAME_SCOPE_WITHOUT_MIN_POINTS,
	archetypeFilter: undefined,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	// Nonbasic lands read as noise in a "most played" ranking; basics never
	// reach the breakdown at all.
	excludedCardTypes: ['Land'],
	pointedOnly: false,
	columns: 5,
	autoColumns: false,
	cardSizing: 'fit',
	cardWidth: 160,
	cardGap: 12,
	cardsPerPage: TOP_CARDS_MAX_LIMIT,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
	showRankBadges: true,
	rankBadgePosition: 'top-left',
	rankBadgeTextSize: 14,
	statBadge: 'inclusionRate',
	statBadgePosition: 'bottom-right',
	statBadgeTextSize: 14,
}, {
	formerFields: [
		'rankBadgeTextColor',
		'rankBadgeBgColor',
		'statBadgeTextColor',
		'statBadgeBgColor',
		'cardSize',
		'statBadgeSize',
		'dynamicCardSize',
		// A page held whole grid rows; it holds cards now (ADR-0054).
		'rowsPerPage',
		// One text size for both badges, which each badge now sets for itself.
		'badgeSize',
		// A card's image prints its name.
		'showCardNames',
	],
});

export type TopCardsModeConfig = ScreenModeConfigOf<typeof topCardsModeConfigContract>;

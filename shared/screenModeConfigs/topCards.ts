import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	QUANTITY_POSITION_VALUES,
	TOP_CARDS_STAT_VALUES,
} from '../types/enums';
import { METAGAME_CARD_TYPE_BUCKETS } from '../utils/metagame';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import {
	cardLayoutShape,
	DEFAULT_CARD_LAYOUT,
	DEFAULT_HEADER_CONFIG,
	DEFAULT_METAGAME_SCOPE,
	DEFAULT_PAGE_ROTATION,
	headerConfigShape,
	metagameArchetypeFilterField,
	metagameScopeShape,
	pageRotationShape,
} from './subShapes';

/** The most cards a Most Played Cards Screen ranks. */
const TOP_CARDS_MAX_LIMIT = 60;

/** A Fixed card's width before the Screen set one, under the former Card Sizing. */
const FORMER_DEFAULT_CARD_WIDTH = 160;

/**
 * The Card Layout a Card Sizing meant (ADR-0054): a Fixed width is the max card
 * size, and a column count with auto columns on is Auto. A fragment naming no
 * Card Sizing was Fit, the former default, which has no max card size.
 */
function upgradeCardSizing(fragment: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const fixed = fragment.cardSizing === 'fixed';
	const autoColumns = fragment.autoColumns === true;
	if (!fixed && !autoColumns)
		return fragment;
	const upgraded: Record<string, unknown> = { ...fragment };
	if (autoColumns)
		delete upgraded.columns;
	if (fixed && !('maxCardSize' in fragment))
		upgraded.maxCardSize = fragment.cardWidth ?? FORMER_DEFAULT_CARD_WIDTH;
	return upgraded;
}

/**
 * The Most Played Cards Screen Mode's config contract: a ranked grid of the most played
 * cards in the event's metagame, rendered as card images the way the Deck List Screen
 * renders a deck. It is scoped by the whole Metagame Scope, Minimum Points
 * included since #904; `excludedCardTypes` and `pointedOnly` are applied
 * server-side before `limit`, so a filtered top N still fills N slots. While
 * `pointedOnly` is on, Nonbasic Land is never excluded: a pointed land such as
 * Strip Mine is as much a pointed pick as any other card.
 *
 * Its Page Rotation pages the ranking by cards: `cardsPerPage` a page, however
 * many columns the Screen lays them out in, so a page count never depends on
 * the space the Screen measures (ADR-0054). It is Auto while absent, the
 * default: every card on one page.
 *
 * Its badge colours (#823) are Mode Tokens; the fields it once held for them
 * are former fields, which a stored config may still carry. Its Card Layout
 * and badge text sizes are config, read only here (ADR-0054); the size presets
 * they replaced are former fields too. Its cards always fit: Card Sizing
 * (`cardSizing`, `cardWidth`, `autoColumns`) is former, and a stored one reads
 * as the Card Layout it meant (`upgradeCardSizing`). Each badge is placed and
 * sized on its own, as a Deck Screen's are; one `badgeSize` once sized both. A card's image prints its
 * name, so `showCardNames`, a label under it, is a former field.
 */
export const topCardsModeConfigContract = defineScreenModeConfigContract({
	// Scoping
	...metagameScopeShape,
	archetypeFilter: metagameArchetypeFilterField,

	// Data selection & filtering
	board: editorField(z.enum(BOARD_SELECTION_VALUES), { label: 'Board' }),
	sortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), { label: 'Rank by' }),
	limit: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT), { label: 'Card count' }),
	excludedCardTypes: z.array(z.enum(METAGAME_CARD_TYPE_BUCKETS)).max(METAGAME_CARD_TYPE_BUCKETS.length),
	/** Only cards the Event's points system points, applied server-side before `limit`. */
	pointedOnly: editorField(z.boolean(), { label: 'Pointed only' }),

	// Card Layout: columns, max card size and gap, each Auto while absent
	...cardLayoutShape(TOP_CARDS_MAX_LIMIT),

	// Paging: cards per page, Auto (one page) while absent; at least `limit` is one page too
	cardsPerPage: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT).optional(), { label: 'Cards per page' }),
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
	/** A pointed card's points from the Event's points system; an unpointed card shows none. */
	showPointsBadges: editorField(z.boolean(), { label: 'Show point badges' }),
	pointsBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), { label: 'Badge position' }),
	pointsBadgeTextSize: editorField(z.number().int().min(8).max(48), { label: 'Badge text size' }),
}, {
	...DEFAULT_METAGAME_SCOPE,
	archetypeFilter: undefined,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	// Nonbasic lands read as noise in a "most played" ranking; basics never
	// reach the breakdown at all.
	excludedCardTypes: ['Land'],
	pointedOnly: false,
	...DEFAULT_CARD_LAYOUT,
	// Named, so a display reset returns it to Auto.
	cardsPerPage: undefined,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
	showRankBadges: true,
	rankBadgePosition: 'top-left',
	rankBadgeTextSize: 14,
	statBadge: 'inclusionRate',
	statBadgePosition: 'bottom-right',
	statBadgeTextSize: 14,
	showPointsBadges: false,
	pointsBadgePosition: 'top-right',
	pointsBadgeTextSize: 14,
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
		// Card Sizing: cards always fit, under a max card size (ADR-0054).
		'cardSizing',
		'cardWidth',
		'autoColumns',
	],
	upgradeFormerFields: upgradeCardSizing,
});

export type TopCardsModeConfig = ScreenModeConfigOf<typeof topCardsModeConfigContract>;

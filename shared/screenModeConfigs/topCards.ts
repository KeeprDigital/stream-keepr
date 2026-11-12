import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	QUANTITY_POSITION_VALUES,
	TOP_CARDS_STAT_VALUES,
} from '../types/enums';
import { METAGAME_CARD_TYPE_BUCKETS } from '../utils/metagame';
import { defineScreenModeConfigContract } from './contract';
import { editorField, withEditorMeta } from './fields';
import {
	BOARD_SELECTION_LABELS,
	cardBadgeSizeField,
	cardLayoutShape,
	DEFAULT_CARD_LAYOUT,
	DEFAULT_HEADER_CONFIG,
	DEFAULT_METAGAME_SCOPE,
	DEFAULT_PAGE_ROTATION,
	hasSideboard,
	headerConfigShape,
	METAGAME_CARD_SORT_BY_LABELS,
	metagameArchetypeFilterField,
	metagameScopeShape,
	pageRotationShape,
	returnsToFirstPage,
} from './subShapes';

/** The most cards a Most Played Cards Screen ranks. */
const TOP_CARDS_MAX_LIMIT = 60;

/** Whether the Event points cards: a One Piece Card Game Event never does. */
function hasPointsSystem(event: ScreenSettingsContext['event']): boolean {
	return event?.game !== 'op' && !!event?.pointsSystem;
}

/** A card badge's field, in its own group of the Content card. */
function badge(group: string) {
	return { card: 'content', group } as const;
}

const showsStatBadge = ({ config }: ScreenSettingsContext) => config.statBadge !== 'none';

/** The ranking pages while a page holds fewer cards than it ranks; Auto, or a page of every card, is one page with nothing to turn. */
const pagesRanking = ({ config }: ScreenSettingsContext) => typeof config.cardsPerPage === 'number' && config.cardsPerPage < config.limit;

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
 * Its badge colours (#823) are Mode Tokens. Its Card Layout and badge text sizes
 * are config, read only here (ADR-0054), and its cards always fit. Each badge is
 * placed and sized on its own, Auto (following its card) or px, as a Deck
 * Screen's are. A card's image prints its name, so it has no label under it.
 */
export const topCardsModeConfigContract = defineScreenModeConfigContract({
	// Scoping
	...metagameScopeShape,
	/** The Archetype whose cards the ranking counts alone; an Event Reference (ADR-0038). */
	archetypeId: metagameArchetypeFilterField,

	// Data selection & filtering
	board: editorField(z.enum(BOARD_SELECTION_VALUES), {
		label: 'Board',
		card: 'source',
		description: 'Count cards from this part of each deck.',
		options: BOARD_SELECTION_LABELS,
		showWhen: hasSideboard,
	}),
	sortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), {
		label: 'Sort by',
		card: 'content',
		group: 'ranking',
		options: METAGAME_CARD_SORT_BY_LABELS,
		...returnsToFirstPage,
	}),
	limit: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT), {
		label: 'Limit',
		card: 'content',
		group: 'ranking',
		description: 'How many of the top cards the ranking shows.',
		...returnsToFirstPage,
	}),
	excludedCardTypes: editorField(z.array(z.enum(METAGAME_CARD_TYPE_BUCKETS)).max(METAGAME_CARD_TYPE_BUCKETS.length), {
		label: 'Card types',
		card: 'source',
		slot: 'card-type-filter',
		description: ({ event }) => event?.game === 'op'
			? 'The card types the ranking may include; Leaders never are.'
			: 'The card types the ranking may include; basic lands never are, and ranking pointed cards keeps nonbasic lands in.',
	}),
	/** Only cards the Event's points system points, applied server-side before `limit`. */
	pointedOnly: editorField(z.boolean(), {
		label: 'Pointed only',
		card: 'source',
		description: 'Rank only cards the Event\'s points system gives points, pointed lands such as Strip Mine included.',
		// Kept while on, so a Screen whose Event lost its points system can turn it off.
		showWhen: ({ config, event }) => hasPointsSystem(event) || config.pointedOnly === true,
	}),

	// Card Layout: columns, max card size and gap, each Auto while absent; no more columns than cards ranked
	...cardLayoutShape(TOP_CARDS_MAX_LIMIT, 'layout', undefined, ({ config }) => config.limit),

	// Paging: cards per page, Auto (one page) while absent; at least `limit` is one page too
	cardsPerPage: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT).optional(), {
		label: 'Cards per page',
		card: 'paging',
		placeholder: 'Auto',
		description: 'However many columns the Screen lays them out in. Auto shows every card on one page.',
	}),
	...pageRotationShape,
	autoPageEnabled: withEditorMeta(pageRotationShape.autoPageEnabled, { showWhen: pagesRanking }),
	autoPageIntervalMs: withEditorMeta(pageRotationShape.autoPageIntervalMs, {
		showWhen: context => pagesRanking(context) && context.config.autoPageEnabled === true,
	}),
	currentPage: withEditorMeta(pageRotationShape.currentPage, { showWhen: pagesRanking }),
	rotationAnchor: withEditorMeta(pageRotationShape.rotationAnchor, { showWhen: pagesRanking }),

	// Header
	...headerConfigShape({
		shows: 'Show the title above the card grid.',
		auto: 'Empty shows a title for the ranking and scope.',
	}),

	// Card badges: each placed on its card, and sized around its own text size: Auto while absent, or px.
	showRankBadges: editorField(z.boolean(), {
		...badge('rank-badge'),
		label: 'Show rank badges',
		description: 'Each card\'s position in the ranking.',
	}),
	rankBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), {
		...badge('rank-badge'),
		label: 'Badge position',
		control: 'position',
		showWhen: ({ config }) => config.showRankBadges === true,
	}),
	rankBadgeTextSize: cardBadgeSizeField('rank-badge', ({ config }) => config.showRankBadges === true),
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: editorField(z.enum(TOP_CARDS_STAT_VALUES), {
		...badge('stat-badge'),
		label: 'Stat badge',
		description: 'One metric on each card.',
		options: {
			none: 'None',
			inclusionRate: 'Inclusion rate',
			avgCopies: 'Average copies',
			totalCopies: 'Total copies',
			deckCount: 'Deck count',
		},
	}),
	statBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), {
		...badge('stat-badge'),
		label: 'Badge position',
		control: 'position',
		showWhen: showsStatBadge,
	}),
	statBadgeTextSize: cardBadgeSizeField('stat-badge', showsStatBadge),
	/** A pointed card's points from the Event's points system; an unpointed card shows none. */
	showPointsBadges: editorField(z.boolean(), {
		...badge('points-badge'),
		label: 'Show point badges',
		description: 'Each pointed card\'s points from the Event\'s points system.',
	}),
	pointsBadgePosition: editorField(z.enum(QUANTITY_POSITION_VALUES), {
		...badge('points-badge'),
		label: 'Badge position',
		control: 'position',
		showWhen: ({ config }) => config.showPointsBadges === true,
	}),
	pointsBadgeTextSize: cardBadgeSizeField('points-badge', ({ config }) => config.showPointsBadges === true),
}, {
	...DEFAULT_METAGAME_SCOPE,
	archetypeId: undefined,
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
	rankBadgeTextSize: undefined,
	statBadge: 'inclusionRate',
	statBadgePosition: 'bottom-right',
	statBadgeTextSize: undefined,
	showPointsBadges: false,
	pointsBadgePosition: 'top-right',
	pointsBadgeTextSize: undefined,
}, {
	groups: {
		'ranking': { title: 'Ranking', card: 'content' },
		'layout': { title: 'Layout', card: 'content' },
		// Each badge one row: whether it shows, its position and its size.
		'rank-badge': { title: 'Rank badge', card: 'content', layout: 'row' },
		'stat-badge': { title: 'Stat badge', card: 'content', layout: 'row' },
		// Kept while shown, so a Screen whose Event lost its points system can turn them off.
		'points-badge': {
			title: 'Point badge',
			card: 'content',
			layout: 'row',
			showWhen: ({ config, event }) => hasPointsSystem(event) || config.showPointsBadges === true,
		},
	},
});

export type TopCardsModeConfig = ScreenModeConfigOf<typeof topCardsModeConfigContract>;

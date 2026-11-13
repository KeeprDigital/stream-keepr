import type { BoardSelection, QuantityPosition, SideboardPlacement } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import type { ScreenSettingsContext } from './fields';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	MAINBOARD_VIEW_VALUES,
	SEAT_VALUES,
	QUANTITY_POSITION_VALUES,
	SIDEBOARD_PLACEMENT_VALUES,
	SIDEBOARD_VIEW_VALUES,
} from '../types/enums';
import { NINE_POINT_VALUES } from '../utils/ninePoints';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { cardBadgeSizeField, cardLayoutShape, DEFAULT_CARD_LAYOUT } from './subShapes';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);

/** The most cards a board lays out, so the most columns its grid can have: a hundred-card singleton deck. */
const DECK_BOARD_MAX_CARDS = 100;

/**
 * The most columns a board's grid can use on this Screen: one per card its Deck
 * List gives the board, where the page knows them (ADR-0054). A board with no
 * cards keeps the field's minimum; with no Deck List resolved, the contract's
 * bound stands.
 */
function mostBoardColumns(group: 'mainboard' | 'sideboard') {
	return ({ deckBoardCards }: ScreenSettingsContext): number | undefined => deckBoardCards
		&& Math.min(DECK_BOARD_MAX_CARDS, Math.max(1, deckBoardCards[group]));
}

/** What each board view is called. */
const BOARD_VIEW_LABELS = { grid: 'Grid', stack: 'Stack', list: 'List' } as const;

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads. A grid reads its Card Layout (columns, max card size and gap, each
 * Auto while absent) and a list its listColumns. Only the sideboard stacks, as
 * the strip beside the mainboard (ADR-0054), so each board names its own
 * views, and only it says how much of a stacked card shows. Visibility is the
 * `board` selection's concern, so a block carries no show/hide of its own.
 */
function deckBoardLayoutShape<const Views extends readonly [string, ...string[]]>(
	views: Views,
	group: 'mainboard' | 'sideboard',
	/** Whether the board's layout values are its own to edit: a sideboard following the mainboard's are not (#1091). */
	ownLayout: (context: ScreenSettingsContext) => boolean = () => true,
) {
	const place = { card: 'content', group } as const;
	return {
		view: editorField(z.enum(views).optional(), {
			...place,
			label: 'View',
			description: `How the ${group}'s cards are shown.`,
			options: Object.fromEntries(views.map(view => [view, BOARD_VIEW_LABELS[view as keyof typeof BOARD_VIEW_LABELS]])) as Record<Views[number], string>,
		}),
		...cardLayoutShape(DECK_BOARD_MAX_CARDS, group, ownLayout, mostBoardColumns(group)),
		listColumns: editorField(z.number().int().min(1).max(4).optional(), {
			...place,
			label: 'List columns',
			showWhen: context => context.block?.view === 'list' && ownLayout(context),
		}),
		/** Where the board's cards sit in its space when they leave some over. */
		alignment: editorField(z.enum(NINE_POINT_VALUES).optional(), {
			...place,
			label: 'Alignment',
			control: 'position',
			description: 'Where the cards sit when they leave space over.',
			showWhen: context => context.block?.view !== 'list' && ownLayout(context),
		}),
	};
}

const mainboardLayoutShape = deckBoardLayoutShape(MAINBOARD_VIEW_VALUES, 'mainboard');
const sideboardLayoutShape = {
	...deckBoardLayoutShape(SIDEBOARD_VIEW_VALUES, 'sideboard', ({ block }) => sideboardStoresOwnLayout(block)),
	/** How much of each stacked card but the last shows, in px. */
	stackReveal: editorField(z.number().int().min(4).max(240).optional(), {
		label: 'Stack reveal',
		card: 'content',
		group: 'sideboard',
		description: 'How much of each stacked card but the last shows, in px.',
		showWhen: ({ block }) => block?.view === 'stack',
	}),
};

const mainboardLayoutConfigSchema = z.object(mainboardLayoutShape).strict();
const sideboardLayoutConfigSchema = z.object(sideboardLayoutShape).strict();

type MainboardLayout = z.output<typeof mainboardLayoutConfigSchema>;
type SideboardLayout = z.output<typeof sideboardLayoutConfigSchema>;
/** The Card Layout values, which stay absent while Auto. */
type CardLayoutKey = keyof typeof DEFAULT_CARD_LAYOUT;

/** A board's layout block as its defaults complete it; its Card Layout values stay absent while Auto. */
export type ResolvedMainboardLayout = Required<Omit<MainboardLayout, CardLayoutKey>> & Pick<MainboardLayout, CardLayoutKey>;
export type ResolvedSideboardLayout = Required<Omit<SideboardLayout, CardLayoutKey>> & Pick<SideboardLayout, CardLayoutKey>;
/** Either board's resolved layout block, as a reader of both boards reads it. */
export type ResolvedDeckBoardLayout = ResolvedMainboardLayout | ResolvedSideboardLayout;

export const DEFAULT_DECK_BOARD_LAYOUT: ResolvedMainboardLayout = {
	view: 'grid',
	...DEFAULT_CARD_LAYOUT,
	listColumns: 2,
	alignment: 'center',
};

/** The sideboard's own fields: it never takes these from the mainboard (#1091). */
type SideboardOwnFields = Pick<ResolvedSideboardLayout, 'view' | 'stackReveal'>;

const DEFAULT_SIDEBOARD_OWN_FIELDS: SideboardOwnFields = {
	view: 'stack',
	// About the former 15% of a medium card's height.
	stackReveal: 30,
};

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedSideboardLayout = {
	...DEFAULT_DECK_BOARD_LAYOUT,
	...DEFAULT_SIDEBOARD_OWN_FIELDS,
};

/**
 * Whether a stored sideboard block holds a layout of its own: it names a
 * layout value, not only its view and reveal. A block an editor writes whole
 * always names its alignment and list columns, so a layout of all Auto Card
 * Layout values is still its own.
 */
function sideboardStoresOwnLayout(block: Readonly<Record<string, unknown>> | undefined): boolean {
	return Object.entries(block ?? {})
		.some(([key, value]) => key !== 'view' && key !== 'stackReveal' && value !== undefined);
}

/** A resolved sideboard's own view and reveal, as a sideboard following the mainboard stores them. */
export function sideboardOwnFields(sideboard: ResolvedSideboardLayout): SideboardOwnFields {
	return { view: sideboard.view, stackReveal: sideboard.stackReveal };
}

/**
 * A board's layout block with an editor's `patch` applied, as its next write
 * stores it whole: a Card Layout value patched to `null` is Auto, so its key
 * is left out.
 */
export function patchedBoardLayout<Layout extends Partial<ResolvedSideboardLayout>>(
	layout: Layout,
	patch: { [Key in keyof ResolvedSideboardLayout]?: ResolvedSideboardLayout[Key] | null },
): Layout {
	return Object.fromEntries(Object.entries({
		...layout,
		...patch,
	})
		.filter(([, value]) => value !== null && value !== undefined)) as Layout;
}

/** Which boards render, and where the sideboard sits, until an operator changes them. */
const DEFAULT_BOARD: BoardSelection = 'full';
const DEFAULT_SIDEBOARD_PLACEMENT: SideboardPlacement = 'beside';

/** The details pill's and pointed card chip's text size in px until an operator sets it; each sizes itself around its own. */
export const DEFAULT_DECK_TEXT_SIZES = {
	metaPillSize: 16,
	pointedCardSize: 14,
} as const;

/** Where each badge sits on a Deck List Screen card until an operator moves it. */
export const DEFAULT_QUANTITY_POSITION: QuantityPosition = 'top-right';
export const DEFAULT_HIGHLANDER_POINTS_POSITION: QuantityPosition = 'top-left';
/** Top centre: clear of the corner badges, and shown by a stacked card's top slice. */
export const DEFAULT_COMPANION_TAG_POSITION: QuantityPosition = 'top';

/** A Magic Deck List's page; a One Piece Card Game Deck List has no sideboard, companion or card points (ADR-0057). */
function isMagic({ event }: ScreenSettingsContext): boolean {
	return event?.game !== 'op';
}

function isBroadcastSource({ config }: ScreenSettingsContext): boolean {
	return config.deckSource?.type === 'broadcast';
}

/** Card points come from the Event's points system; a Broadcast Deck List carries none. */
function showsCardPoints(context: ScreenSettingsContext): boolean {
	return isMagic(context) && !isBroadcastSource(context) && !!context.event?.pointsSystem;
}

function showsPointBadges(context: ScreenSettingsContext): boolean {
	return showsCardPoints(context) && context.config.showHighlanderPoints !== false;
}

/** The details row shows only with something in it, so its own settings show only then. */
function showsDetailsRow(context: ScreenSettingsContext): boolean {
	return isMagic(context)
		&& (!!context.config.showDeckStats || (showsCardPoints(context) && context.config.showHighlanderTotal !== false));
}

/** The Deck List Screen Mode's config contract: its shape, type, and defaults. */
export const deckModeConfigContract = defineScreenModeConfigContract({
	// The Deck Source (ADR-0032): no Player or one Player, one Broadcast Deck
	// List, or one Seat of a Feature Match Slot, followed live (ADR-0057, ADR-0087).
	deckSource: editorField(z.discriminatedUnion('type', [
		z.object({
			type: z.literal('player'),
			playerId: z.number().int().positive().nullable(),
		}).strict(),
		z.object({
			type: z.literal('broadcast'),
			broadcastDeckListId: z.number().int().positive(),
		}).strict(),
		z.object({
			type: z.literal('featureMatchSlot'),
			/** `null` once its Slot is deleted, as a deleted Player leaves no Player. */
			slotId: z.number().int().positive().nullable(),
			/**
			 * The Seat shown, in the Session's order: whichever player sits there now
			 * (ADR-0058). Seats 3 and 4 are a Commander Slot's, which the Screen
			 * write checks (ADR-0087).
			 */
			side: z.enum(SEAT_VALUES),
		}).strict(),
	]), {
		label: 'Deck Source',
		card: 'source',
		reference: 'deckSource',
	}),
	/**
	 * Which boards render (#477). "Both hidden" is impossible by construction,
	 * so its editor is each board's own show toggle, writing this one field.
	 */
	board: editorField(z.enum(BOARD_SELECTION_VALUES).optional(), {
		label: 'Boards',
		card: 'content',
		slot: 'board-toggles',
		showWhen: isMagic,
	}),
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement: editorField(z.enum(SIDEBOARD_PLACEMENT_VALUES).optional(), {
		label: 'Placement',
		card: 'content',
		group: 'sideboard',
		description: 'Where the sideboard sits relative to the mainboard.',
		options: { beside: 'Beside the mainboard', below: 'Below the mainboard' },
		showWhen: ({ config }) => (config.board ?? DEFAULT_BOARD) === 'full',
	}),
	mainboard: editorField(mainboardLayoutConfigSchema.optional(), {
		label: 'Mainboard layout',
		card: 'content',
		group: 'mainboard',
		showWhen: ({ config }) => (config.board ?? DEFAULT_BOARD) !== 'sideboard',
	}),
	sideboard: editorField(sideboardLayoutConfigSchema.optional(), {
		label: 'Sideboard layout',
		card: 'content',
		group: 'sideboard',
		showWhen: ({ config }) => (config.board ?? DEFAULT_BOARD) !== 'mainboard',
	}),
	showQuantities: editorField(z.boolean().optional(), {
		label: 'Show quantity badges',
		card: 'content',
		group: 'quantity-badge',
		description: 'On cards with multiple copies.',
	}),
	/** The header's first line: the Player's name, or a Broadcast Deck List's own name. */
	showPlayerName: editorField(z.boolean().optional(), {
		label: 'Show Player name',
		labelFor: context => isBroadcastSource(context)
			? 'Show list name'
			: 'Show Player name',
		card: 'header',
		description: context => isBroadcastSource(context)
			? 'The Broadcast Deck List\'s name, on the first line.'
			: 'The Player\'s name, on the first line.',
	}),
	/** The header's second line: the deck's name, or a Broadcast Deck List's archetype. */
	showDeckName: editorField(z.boolean().optional(), {
		label: 'Show deck name',
		labelFor: context => isBroadcastSource(context)
			? 'Show archetype'
			: 'Show deck name',
		card: 'header',
		description: (context) => {
			if (!isMagic(context))
				return 'The Leader\'s name, which names the deck.';
			return isBroadcastSource(context)
				? 'The list\'s archetype, beside its name.'
				: 'The deck\'s name, beside the Player\'s.';
		},
	}),
	showDeckColors: editorField(z.boolean().optional(), {
		label: 'Show deck colours',
		card: 'header',
		description: context => isMagic(context)
			? 'The deck\'s mana colours, beside its name.'
			: 'The Leader\'s colours, beside its name.',
	}),
	/** The companion as its own card image, beside the boards. */
	showCompanion: editorField(z.boolean().optional(), {
		label: 'Show companion',
		card: 'content',
		group: 'sideboard',
		description: 'The deck\'s companion as the sideboard\'s first card.',
	}),
	showDeckStats: editorField(z.boolean().optional(), {
		label: 'Show deck stats',
		card: 'content',
		group: 'deck-details',
		description: 'Card counts by type: creatures, instants and so on.',
		showWhen: isMagic,
	}),
	/** A One Piece Card Game Deck List's cost curve, beside its Leader. */
	showCostCurve: editorField(z.boolean().optional(), {
		label: 'Show cost curve',
		card: 'content',
		group: 'mainboard',
		description: 'Cards by cost, under the Leader.',
		showWhen: context => !isMagic(context),
	}),
	showDeckMetaPill: editorField(z.boolean().optional(), {
		label: 'Show as a pill',
		card: 'content',
		group: 'deck-details',
		description: 'Wrap the details row in a pill.',
		showWhen: showsDetailsRow,
	}),
	showHighlanderTotal: editorField(z.boolean().optional(), {
		label: 'Show total points',
		card: 'content',
		group: 'deck-details',
		description: 'The deck\'s total points from the Event\'s points system.',
		showWhen: showsCardPoints,
	}),
	showHighlanderPointedCards: editorField(z.boolean().optional(), {
		label: 'Show pointed cards',
		card: 'content',
		group: 'pointed-cards',
		description: 'A chip per pointed card, under the details row.',
		showWhen: showsCardPoints,
	}),
	showHighlanderPoints: editorField(z.boolean().optional(), {
		label: 'Show point badges',
		card: 'content',
		group: 'points-badge',
		description: 'Each pointed card\'s points; placed on a grid\'s cards.',
		showWhen: showsCardPoints,
	}),
	highlanderPointsPosition: editorField(quantityPositionSchema.optional(), {
		label: 'Badge position',
		card: 'content',
		group: 'points-badge',
		control: 'position',
		showWhen: showsPointBadges,
	}),

	// Quantity badge placement
	quantityPosition: editorField(quantityPositionSchema.optional(), {
		label: 'Badge position',
		card: 'content',
		group: 'quantity-badge',
		control: 'position',
		showWhen: ({ config }) => config.showQuantities !== false,
	}),
	/** Where the companion's tag sits on its card: a corner puts the tag's own edge there. */
	companionTagPosition: editorField(quantityPositionSchema.optional(), {
		label: 'Badge position',
		card: 'content',
		group: 'companion-badge',
		control: 'position',
		description: 'On the companion\'s card; in a corner, it lines up with that side.',
	}),

	// Text sizes; each badge, pill and chip sizes itself around its own (ADR-0054). A badge's is Auto while absent.
	quantityBadgeSize: cardBadgeSizeField('quantity-badge', ({ config }) => config.showQuantities !== false),
	pointsBadgeSize: cardBadgeSizeField('points-badge', showsPointBadges),
	metaPillSize: editorField(z.number().int().min(8).max(48).optional(), {
		label: 'Details text size',
		card: 'content',
		group: 'deck-details',
		description: 'The row\'s text size in px; a pill sizes itself around it.',
		showWhen: showsDetailsRow,
	}),
	pointedCardSize: editorField(z.number().int().min(8).max(48).optional(), {
		label: 'Pointed card text size',
		card: 'content',
		group: 'pointed-cards',
		description: 'Each chip\'s text size in px; the chip sizes itself around it.',
		showWhen: context => showsCardPoints(context) && context.config.showHighlanderPointedCards !== false,
	}),
}, {
	deckSource: { type: 'player', playerId: null },
	board: DEFAULT_BOARD,
	sideboardPlacement: DEFAULT_SIDEBOARD_PLACEMENT,
	mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT },
	// Its own fields alone: it follows the mainboard's layout until customised (#1091).
	sideboard: { ...DEFAULT_SIDEBOARD_OWN_FIELDS },
	showQuantities: true,
	showPlayerName: true,
	showDeckName: true,
	showDeckColors: true,
	showCompanion: true,
	showDeckStats: false,
	showCostCurve: true,
	showDeckMetaPill: true,
	showHighlanderTotal: true,
	showHighlanderPointedCards: true,
	showHighlanderPoints: true,
	highlanderPointsPosition: DEFAULT_HIGHLANDER_POINTS_POSITION,
	quantityPosition: DEFAULT_QUANTITY_POSITION,
	companionTagPosition: DEFAULT_COMPANION_TAG_POSITION,
	...DEFAULT_DECK_TEXT_SIZES,
	// Auto: each badge follows its card's width (ADR-0054). Named, so a display reset returns it to Auto.
	quantityBadgeSize: undefined,
	pointsBadgeSize: undefined,
}, {
	groups: {
		'mainboard': { title: 'Mainboard', card: 'content' },
		'sideboard': { title: 'Sideboard', card: 'content', showWhen: isMagic },
		'deck-details': { title: 'Deck details', card: 'content' },
		// A One Piece Deck List has no card points, but its page keeps their Looks reachable (ADR-0072).
		'pointed-cards': {
			title: 'Pointed cards',
			card: 'content',
			showWhen: context => !isMagic(context) || showsCardPoints(context),
		},
		// Each badge one row: whether it shows, its position and its size.
		'quantity-badge': { title: 'Quantity badge', card: 'content', layout: 'row' },
		'points-badge': {
			title: 'Point badge',
			card: 'content',
			layout: 'row',
			showWhen: context => !isMagic(context) || showsCardPoints(context),
		},
		'companion-badge': {
			title: 'Companion badge',
			card: 'content',
			layout: 'row',
			showWhen: context => isMagic(context) && context.config.showCompanion !== false,
		},
	},
});

export type DeckModeConfig = ScreenModeConfigOf<typeof deckModeConfigContract>;
export type DeckSource = DeckModeConfig['deckSource'];

export interface ResolvedDeckBoards {
	board: BoardSelection;
	sideboardPlacement: SideboardPlacement;
	mainboard: ResolvedMainboardLayout;
	sideboard: ResolvedSideboardLayout;
	/** Whether the sideboard holds its own layout; otherwise it takes the mainboard's (#1091). */
	sideboardCustomised: boolean;
}

/**
 * Completes a Deck configuration's board selection and board blocks from their
 * defaults. Stored blocks are partial fragments — a PATCH may have written a
 * lone `{ columns: 6 }` — so every rendering and settings surface resolves
 * through this rather than reading the fragments directly. A mainboard stack,
 * which only a client from before ADR-0054 could still write, reads as
 * a grid (ADR-0054), so neither a rendering nor the next board write carries it.
 * A sideboard naming no layout value takes the mainboard's layout values, and
 * keeps its own view and reveal (#1091).
 */
export function resolveDeckBoards(config: Partial<DeckModeConfig>): ResolvedDeckBoards {
	const mainboard = {
		...DEFAULT_DECK_BOARD_LAYOUT,
		...config.mainboard,
	};
	const sideboardCustomised = sideboardStoresOwnLayout(config.sideboard);
	const { view: _mainboardView, ...mainboardLayoutValues } = mainboard;
	return {
		board: config.board ?? DEFAULT_BOARD,
		sideboardPlacement: config.sideboardPlacement ?? DEFAULT_SIDEBOARD_PLACEMENT,
		mainboard: {
			...mainboard,
			view: MAINBOARD_VIEW_VALUES.includes(mainboard.view)
				? mainboard.view
				: 'grid',
		},
		sideboard: sideboardCustomised
			? {
					...DEFAULT_SIDEBOARD_LAYOUT,
					...config.sideboard,
				}
			: {
					...mainboardLayoutValues,
					view: config.sideboard?.view ?? DEFAULT_SIDEBOARD_OWN_FIELDS.view,
					stackReveal: config.sideboard?.stackReveal ?? DEFAULT_SIDEBOARD_OWN_FIELDS.stackReveal,
				},
		sideboardCustomised,
	};
}

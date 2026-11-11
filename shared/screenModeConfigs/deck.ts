import type { BoardSelection, QuantityPosition, SideboardPlacement } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	MAINBOARD_VIEW_VALUES,
	PLAYER_SIDE_VALUES,
	QUANTITY_POSITION_VALUES,
	SIDEBOARD_PLACEMENT_VALUES,
	SIDEBOARD_VIEW_VALUES,
} from '../types/enums';
import { NINE_POINT_VALUES } from '../utils/ninePoints';
import { defineScreenModeConfigContract } from './contract';
import { editorField, screenModeConfigFields } from './fields';
import { cardBadgeSizeField, cardLayoutShape, DEFAULT_CARD_LAYOUT } from './subShapes';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);

/** The most cards a board lays out, so the most columns its grid can have: a hundred-card singleton deck. */
const DECK_BOARD_MAX_CARDS = 100;

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads. A grid reads its Card Layout (columns, max card size and gap, each
 * Auto while absent) and a list its listColumns. Only the sideboard stacks, as
 * the strip beside the mainboard (ADR-0054), so each board names its own
 * views, and only it says how much of a stacked card shows. Visibility is the
 * `board` selection's concern, so a block carries no show/hide of its own.
 */
function deckBoardLayoutShape<const Views extends readonly [string, ...string[]]>(views: Views) {
	return {
		view: editorField(z.enum(views).optional(), { label: 'View' }),
		...cardLayoutShape(DECK_BOARD_MAX_CARDS),
		listColumns: editorField(z.number().int().min(1).max(4).optional(), { label: 'List Columns' }),
		/** Where the board's cards sit in its space when they leave some over. */
		alignment: editorField(z.enum(NINE_POINT_VALUES).optional(), { label: 'Alignment' }),
	};
}

const mainboardLayoutShape = deckBoardLayoutShape(MAINBOARD_VIEW_VALUES);
const sideboardLayoutShape = {
	...deckBoardLayoutShape(SIDEBOARD_VIEW_VALUES),
	/** How much of each stacked card but the last shows, in px. */
	stackReveal: editorField(z.number().int().min(4).max(240).optional(), { label: 'Stack Reveal' }),
};

/**
 * A layout block's former fields: its size preset and stack share, which
 * `stackReveal` and a card width replaced; `dynamicCardSize`, which Card
 * Sizing replaced; and Card Sizing itself (`cardSizing`, `cardWidth`,
 * `autoColumns`), which the Card Layout replaced (ADR-0054).
 */
const FORMER_BOARD_LAYOUT_FIELDS = [
	'cardSize',
	'stackOverlap',
	'dynamicCardSize',
	'cardSizing',
	'cardWidth',
	'autoColumns',
] as const;

/** A Fixed card's width before the board set one, under the former Card Sizing. */
const FORMER_DEFAULT_CARD_WIDTH = 144;

/**
 * The Card Layout a board's Card Sizing meant (ADR-0054): a Fixed width is the
 * max card size, and a column count with auto columns on is Auto. A board's
 * former default was Fixed, so a width stored with no Card Sizing was a Fixed
 * one; a block storing neither has no max card size.
 */
function upgradeBoardCardSizing(block: unknown): unknown {
	if (typeof block !== 'object' || block === null || Array.isArray(block))
		return block;
	const stored = block as Readonly<Record<string, unknown>>;
	const fixed = stored.cardSizing === 'fixed'
		|| (stored.cardSizing === undefined && stored.cardWidth !== undefined);
	const autoColumns = stored.autoColumns === true;
	if (!fixed && !autoColumns)
		return block;
	const upgraded: Record<string, unknown> = { ...stored };
	if (autoColumns)
		delete upgraded.columns;
	if (fixed && !('maxCardSize' in stored))
		upgraded.maxCardSize = stored.cardWidth ?? FORMER_DEFAULT_CARD_WIDTH;
	return upgraded;
}

/** Each stored board block, upgraded on its own; a board not stored stays absent. */
function upgradeCardSizing(fragment: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const mainboard = upgradeBoardCardSizing(fragment.mainboard);
	const sideboard = upgradeBoardCardSizing(fragment.sideboard);
	if (mainboard === fragment.mainboard && sideboard === fragment.sideboard)
		return fragment;
	return {
		...fragment,
		...('mainboard' in fragment
			? { mainboard }
			: {}),
		...('sideboard' in fragment
			? { sideboard }
			: {}),
	};
}

const mainboardLayoutConfigSchema = z.object(mainboardLayoutShape).strict();
const sideboardLayoutConfigSchema = z.object(sideboardLayoutShape).strict();

/** The editor fields of each board's layout block. */
export const DECK_MAINBOARD_LAYOUT_FIELDS = screenModeConfigFields(mainboardLayoutShape);
export const DECK_SIDEBOARD_LAYOUT_FIELDS = screenModeConfigFields(sideboardLayoutShape);

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

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedSideboardLayout = {
	...DEFAULT_DECK_BOARD_LAYOUT,
	view: 'stack',
	// About the former 15% of a medium card's height.
	stackReveal: 30,
};

/**
 * A board's layout block with an editor's `patch` applied, as its next write
 * stores it whole: a Card Layout value patched to `null` is Auto, so its key
 * is left out.
 */
export function patchedBoardLayout<Layout extends ResolvedDeckBoardLayout>(
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

/** The Deck List Screen Mode's config contract: its shape, type, and defaults. */
export const deckModeConfigContract = defineScreenModeConfigContract({
	// The Deck Source (ADR-0032): no Player or one Player, one Broadcast Deck
	// List, or one player side of a Feature Match Slot, followed live (ADR-0057).
	deckSource: z.discriminatedUnion('type', [
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
			/** The side shown, in the Session's order: whichever player sits there now (ADR-0058). */
			side: z.enum(PLAYER_SIDE_VALUES),
		}).strict(),
	]),
	/**
	 * Which boards render (#477). "Both hidden" is impossible by construction.
	 * Its editor is each board's own show toggle, so it carries no editor meta.
	 */
	board: z.enum(BOARD_SELECTION_VALUES).optional(),
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement: editorField(z.enum(SIDEBOARD_PLACEMENT_VALUES).optional(), { label: 'Sideboard Placement' }),
	mainboard: mainboardLayoutConfigSchema.optional(),
	sideboard: sideboardLayoutConfigSchema.optional(),
	showQuantities: editorField(z.boolean().optional(), { label: 'Show Quantities' }),
	/** The header's first line: the Player's name, or a Broadcast Deck List's own name. */
	showPlayerName: editorField(z.boolean().optional(), { label: 'Show Player Name' }),
	/** The header's second line: the deck's name, or a Broadcast Deck List's archetype. */
	showDeckName: editorField(z.boolean().optional(), { label: 'Show Deck Name' }),
	showDeckColors: editorField(z.boolean().optional(), { label: 'Show Deck Colors' }),
	/** The companion as its own card image, beside the boards. */
	showCompanion: editorField(z.boolean().optional(), { label: 'Show Companion' }),
	showDeckStats: editorField(z.boolean().optional(), { label: 'Show Deck Stats' }),
	/** A One Piece Card Game Deck List's cost curve, beside its Leader. */
	showCostCurve: editorField(z.boolean().optional(), { label: 'Show Cost Curve' }),
	showDeckMetaPill: editorField(z.boolean().optional(), { label: 'Show Deck Meta Pill' }),
	showHighlanderTotal: editorField(z.boolean().optional(), { label: 'Show Total Points' }),
	showHighlanderPointedCards: editorField(z.boolean().optional(), { label: 'Show Pointed Cards' }),
	showHighlanderPoints: editorField(z.boolean().optional(), { label: 'Show Point Badges' }),
	highlanderPointsPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),

	// Quantity badge placement
	quantityPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),
	/** Where the companion's tag sits on its card: a corner puts the tag's own edge there. */
	companionTagPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),

	// Text sizes; each badge, pill and chip sizes itself around its own (ADR-0054). A badge's is Auto while absent.
	quantityBadgeSize: cardBadgeSizeField,
	pointsBadgeSize: cardBadgeSizeField,
	metaPillSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Details Text Size' }),
	pointedCardSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Pointed Card Text Size' }),
}, {
	deckSource: { type: 'player', playerId: null },
	board: DEFAULT_BOARD,
	sideboardPlacement: DEFAULT_SIDEBOARD_PLACEMENT,
	mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT },
	sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT },
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
	formerFields: [
		// Their colours are the mode's Mode Tokens (#824).
		'deckMetaPillTextColor',
		'deckMetaPillBgColor',
		'deckMetaPillAccentColor',
		'deckMetaPillBorderColor',
		'highlanderPointedCardsTextColor',
		'highlanderPointedCardsBgColor',
		'highlanderPointedCardsAccentColor',
		'highlanderPointedCardsBorderColor',
		'highlanderPointsTextColor',
		'highlanderPointsBgColor',
		'quantityTextColor',
		'quantityBgColor',
		// Their size presets, which the px text sizes replaced (ADR-0054).
		'deckMetaPillSize',
		'highlanderPointedCardsSize',
		'highlanderPointsSize',
		'quantitySize',
		...FORMER_BOARD_LAYOUT_FIELDS.flatMap(field => [`mainboard.${field}`, `sideboard.${field}`]),
	],
	upgradeFormerFields: upgradeCardSizing,
});

export type DeckModeConfig = ScreenModeConfigOf<typeof deckModeConfigContract>;
export type DeckSource = DeckModeConfig['deckSource'];

export interface ResolvedDeckBoards {
	board: BoardSelection;
	sideboardPlacement: SideboardPlacement;
	mainboard: ResolvedMainboardLayout;
	sideboard: ResolvedSideboardLayout;
}

/**
 * Completes a Deck configuration's board selection and board blocks from their
 * defaults. Stored blocks are partial fragments — a PATCH may have written a
 * lone `{ columns: 6 }` — so every rendering and settings surface resolves
 * through this rather than reading the fragments directly. A mainboard stack,
 * which only a client from before ADR-0054 could still write, reads as
 * a grid (ADR-0054), so neither a rendering nor the next board write carries it.
 */
export function resolveDeckBoards(config: Partial<DeckModeConfig>): ResolvedDeckBoards {
	const mainboard = {
		...DEFAULT_DECK_BOARD_LAYOUT,
		...config.mainboard,
	};
	return {
		board: config.board ?? DEFAULT_BOARD,
		sideboardPlacement: config.sideboardPlacement ?? DEFAULT_SIDEBOARD_PLACEMENT,
		mainboard: {
			...mainboard,
			view: MAINBOARD_VIEW_VALUES.includes(mainboard.view)
				? mainboard.view
				: 'grid',
		},
		sideboard: {
			...DEFAULT_SIDEBOARD_LAYOUT,
			...config.sideboard,
		},
	};
}

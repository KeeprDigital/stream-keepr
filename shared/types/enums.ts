/* Shared enum constants and derived types.
 * These are the single source of truth -- both the DB schema and
 * app-side types should import from here. */

export const GAME_VALUES = ['mtg', 'op'] as const;
/** How a Magic: The Gathering Event's games are played (ADR-0087). */
export const VARIANT_VALUES = ['two-player', 'commander'] as const;
export const POINTS_SYSTEM_VALUES = ['7ph'] as const;
export const DECK_COMPANION_SOURCE_VALUES = ['manual', 'melee'] as const;
export const FEATURE_MATCH_ORIENTATION_VALUES = ['horizontal', 'vertical'] as const;
// `tcgplus` is a TCG+ Import's Player, keyed by their Bandai member number (ADR-0074).
export const EXTERNAL_SOURCE_VALUES = ['melee', 'manual', 'tcgplus'] as const;
/** The Melee-imported Player fields an operator's edit keeps from Melee Sync (ADR-0046). */
export const PLAYER_MANUALLY_EDITED_FIELD_VALUES = ['name', 'pronouns'] as const;
export const PLAYER_DISPLAY_MODE_VALUES = ['score', 'position'] as const;
export const POSITION_FORMAT_VALUES = ['number', 'ordinal'] as const;
export const DISPLAY_TYPE_VALUES = ['overlay', 'control'] as const;
export const SCREEN_MODE_VALUES = [
	'background',
	'card',
	'deck',
	'standings',
	'top-cut',
	'feature-match',
	'feature-match-overlay',
	'broadcast-graphics',
	'metagame',
	'top-cards',
	'player-history',
	'pairings',
	'archetype-spotlight',
	'head-to-head',
	'round-clock',
	'talent',
] as const;
/**
 * Each Screen Mode key renamed after release, and the key it is now (#773, ADR-0043).
 * A migration moved stored Screens; a Screen write accepts the former key from a
 * client built before the rename and stores the current one.
 */
export const FORMER_SCREEN_MODE_KEYS: Readonly<Record<string, ScreenMode>> = { topCut: 'top-cut' };
/** Where a Head-to-Head Screen takes its two Players from (#760). */
export const HEAD_TO_HEAD_PLAYER_SOURCE_VALUES = ['featureMatchSlot', 'players'] as const;
/** Whether a Talent Screen shows one Talent or a lineup of them (#782). */
export const TALENT_SCREEN_SELECTION_VALUES = ['one', 'lineup'] as const;
/** How a Talent Screen lays its Talents out: a lower third, or a full panel (#782). */
export const TALENT_SCREEN_LAYOUT_VALUES = ['lowerThird', 'fullPanel'] as const;
export const SCREEN_COMMAND_VALUES = ['refresh', 'identify', 'debug'] as const;
export const CLOCK_TYPE_VALUES = ['countdown', 'countup', 'untimed'] as const;
export const RECORD_SEPARATOR_VALUES = ['-', '/', ' | ', ' '] as const;
// A sideboard stacks only as the strip beside the mainboard (ADR-0054).
export const MAINBOARD_VIEW_VALUES = ['grid', 'list'] as const;
export const SIDEBOARD_VIEW_VALUES = ['grid', 'stack', 'list'] as const;
// Where a badge sits on a Deck List Screen card: the nine points less the centre,
// spelled as `NINE_POINTS` (`shared/utils/ninePoints.ts`) so the nine-point picker
// edits it directly (#543).
export const QUANTITY_POSITION_VALUES = [
	'top-left',
	'top',
	'top-right',
	'left',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right',
] as const;
export const SIDEBOARD_PLACEMENT_VALUES = ['beside', 'below'] as const;
export const BOARD_SELECTION_VALUES = ['full', 'mainboard', 'sideboard'] as const;
/**
 * The two Seats every Feature Match Slot has. What a Two-Player or One Piece
 * Card Game contract accepts stays this pair (ADR-0087).
 */
export const PLAYER_SIDE_VALUES = ['player1', 'player2'] as const;
/**
 * A Feature Match Slot's Seats, in the Slot's own order: the pair every Slot
 * has, then the two only a Commander Event's holds (ADR-0087).
 */
export const SEAT_VALUES = [...PLAYER_SIDE_VALUES, 'player3', 'player4'] as const;
export const HORIZONTAL_ALIGN_VALUES = ['left', 'center', 'right'] as const;
export const VERTICAL_ALIGN_VALUES = ['top', 'center', 'bottom'] as const;
export const RESET_TYPE_VALUES = ['game', 'match'] as const;
export const BULK_CLOCK_ACTION_VALUES = [
	'start',
	'pause',
	'reset',
	'restart',
	'adjust',
] as const;
export const DECK_LIST_COMPARTMENT_VALUES = ['mainboard', 'sideboard'] as const;
export const UNRESOLVED_DECK_ENTRY_TYPE_VALUES = ['card', 'companion'] as const;
export const METAGAME_VIEW_MODE_VALUES = ['archetype', 'cards', 'chart'] as const;
export const METAGAME_SCOPE_VALUES = [
	'all',
	'topN',
	'playerList',
	'minPoints',
] as const;
export const METAGAME_SORT_BY_VALUES = [
	'count',
	'winRate',
	'metaShare',
	'conversionRate',
] as const;
export const METAGAME_CONVERSION_METRIC_VALUES = ['topN', 'minPoints'] as const;
export const METAGAME_CARD_SORT_BY_VALUES = ['inclusionRate', 'avgCopies', 'totalCopies'] as const;
export const TOP_CARDS_STAT_VALUES = [
	'none',
	'inclusionRate',
	'avgCopies',
	'totalCopies',
	'deckCount',
] as const;
export const METAGAME_ARCHETYPE_COLUMN_KEY_VALUES = [
	'archetype',
	'count',
	'metaShare',
	'winRate',
	'avgPlace',
	'colors',
	'conversionRate',
] as const;
export const METAGAME_CARD_COLUMN_KEY_VALUES = [
	'card',
	'manaCost',
	'type',
	'inclusionRate',
	'avgCopies',
	'totalCopies',
	'deckCount',
	'mainboardCount',
	'sideboardCount',
] as const;
export const STANDINGS_VIEW_MODE_VALUES = [
	'all',
	'range',
	'watchlist',
	'reveal',
] as const;
export const STANDINGS_COLUMN_KEY_VALUES = [
	'position',
	'name',
	'record',
	'points',
	'deck',
	'positionChange',
] as const;
export const PLAYER_HISTORY_COLUMN_KEY_VALUES = [
	'round',
	'opponent',
	'table',
	'outcome',
	'opponentArchetype',
	'gameScore',
] as const;
export const REVEAL_ORDER_VALUES = ['bottomUp', 'topDown'] as const;
export const ROUND_CONTROL_MODE_VALUES = ['default', 'manual_override'] as const;
/** Why Live Results switched itself off: 12 hours without a change, or Melee refused the credentials. */
export const MELEE_LIVE_RESULTS_STOP_REASON_VALUES = ['idle', 'auth'] as const;

export type Game = typeof GAME_VALUES[number];
export type Variant = typeof VARIANT_VALUES[number];
export type PointsSystem = typeof POINTS_SYSTEM_VALUES[number];
export type DeckCompanionSource = typeof DECK_COMPANION_SOURCE_VALUES[number];
export type ClockType = typeof CLOCK_TYPE_VALUES[number];
export type FeatureMatchOrientation = typeof FEATURE_MATCH_ORIENTATION_VALUES[number];
export type ExternalSource = typeof EXTERNAL_SOURCE_VALUES[number];
export type PlayerManuallyEditedField = typeof PLAYER_MANUALLY_EDITED_FIELD_VALUES[number];
export type PlayerDisplayMode = typeof PLAYER_DISPLAY_MODE_VALUES[number];
export type PositionFormat = typeof POSITION_FORMAT_VALUES[number];
export type DisplayType = typeof DISPLAY_TYPE_VALUES[number];
export type ScreenMode = typeof SCREEN_MODE_VALUES[number];
export type HeadToHeadPlayerSource = typeof HEAD_TO_HEAD_PLAYER_SOURCE_VALUES[number];
export type TalentScreenSelection = typeof TALENT_SCREEN_SELECTION_VALUES[number];
export type TalentScreenLayout = typeof TALENT_SCREEN_LAYOUT_VALUES[number];
export type ScreenCommand = typeof SCREEN_COMMAND_VALUES[number];
export type RecordSeparator = typeof RECORD_SEPARATOR_VALUES[number];
export type MainboardView = typeof MAINBOARD_VIEW_VALUES[number];
export type SideboardView = typeof SIDEBOARD_VIEW_VALUES[number];
export type QuantityPosition = typeof QUANTITY_POSITION_VALUES[number];
export type SideboardPlacement = typeof SIDEBOARD_PLACEMENT_VALUES[number];
export type BoardSelection = typeof BOARD_SELECTION_VALUES[number];
export type PlayerSide = typeof PLAYER_SIDE_VALUES[number];
export type Seat = typeof SEAT_VALUES[number];
export type HorizontalAlign = typeof HORIZONTAL_ALIGN_VALUES[number];
export type VerticalAlign = typeof VERTICAL_ALIGN_VALUES[number];
export type ResetType = typeof RESET_TYPE_VALUES[number];
export type BulkClockAction = typeof BULK_CLOCK_ACTION_VALUES[number];
export type StandingsViewMode = typeof STANDINGS_VIEW_MODE_VALUES[number];
export type StandingsColumnKey = typeof STANDINGS_COLUMN_KEY_VALUES[number];
export type PlayerHistoryColumnKey = typeof PLAYER_HISTORY_COLUMN_KEY_VALUES[number];
export type DeckListCompartment = typeof DECK_LIST_COMPARTMENT_VALUES[number];
export type UnresolvedDeckEntryType = typeof UNRESOLVED_DECK_ENTRY_TYPE_VALUES[number];
export type MetagameViewMode = typeof METAGAME_VIEW_MODE_VALUES[number];
export type MetagameScope = typeof METAGAME_SCOPE_VALUES[number];
export type MetagameSortBy = typeof METAGAME_SORT_BY_VALUES[number];
export type MetagameConversionMetric = typeof METAGAME_CONVERSION_METRIC_VALUES[number];
export type MetagameCardSortBy = typeof METAGAME_CARD_SORT_BY_VALUES[number];
export type TopCardsStat = typeof TOP_CARDS_STAT_VALUES[number];
export type MetagameArchetypeColumnKey = typeof METAGAME_ARCHETYPE_COLUMN_KEY_VALUES[number];
export type MetagameCardColumnKey = typeof METAGAME_CARD_COLUMN_KEY_VALUES[number];
export type RevealOrder = typeof REVEAL_ORDER_VALUES[number];
export type RoundControlMode = typeof ROUND_CONTROL_MODE_VALUES[number];
export type MeleeLiveResultsStopReason = typeof MELEE_LIVE_RESULTS_STOP_REASON_VALUES[number];

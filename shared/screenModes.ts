import type { PageRotationDeclaration } from './modules/page-rotation';
import type { ThemeTokenType } from './modules/theme/tokens';
import type { AnyDeclaredModeTokenDefinition } from './modules/theme/vocabulary';
import type { ManualBracket } from './modules/top-cut-bracket/manual';
import type { ScreenModeConfigContract, ScreenModeConfigOf } from './screenModeConfigs/contract';
import type { DeckModeConfig, DeckSource } from './screenModeConfigs/deck';
import type { FeatureMatchModeConfig } from './screenModeConfigs/featureMatch';
import type { FeatureMatchOverlayModeConfig } from './screenModeConfigs/featureMatchOverlay';
import type { HeadToHeadModeConfig } from './screenModeConfigs/headToHead';
import type { PairingsModeConfig } from './screenModeConfigs/pairings';
import type { PlayerHistoryModeConfig } from './screenModeConfigs/playerHistory';
import type { RoundClockModeConfig } from './screenModeConfigs/roundClock';
import type { StandingsModeConfig } from './screenModeConfigs/standings';
import type { PageRotationConfig } from './screenModeConfigs/subShapes';
import type { TalentModeConfig } from './screenModeConfigs/talent';
import type { TopCutModeConfig } from './screenModeConfigs/topCut';
import type { OutputFollowNarrowing, ScreenModeOutputFollows } from './screenOutputInterest';
import type { DisplayType, Game, MetagameScope, ScreenMode } from './types/enums';
import { SCREEN_MODE_CARD_GAMES } from './config/games';
import { archetypeSpotlightModeConfigContract } from './screenModeConfigs/archetypeSpotlight';
import { backgroundModeConfigContract } from './screenModeConfigs/background';
import { broadcastGraphicsModeConfigContract } from './screenModeConfigs/broadcastGraphics';
import { cardModeConfigContract } from './screenModeConfigs/card';
import { deckModeConfigContract } from './screenModeConfigs/deck';
import { featureMatchModeConfigContract } from './screenModeConfigs/featureMatch';
import { featureMatchOverlayModeConfigContract } from './screenModeConfigs/featureMatchOverlay';
import { headToHeadModeConfigContract } from './screenModeConfigs/headToHead';
import { metagameModeConfigContract } from './screenModeConfigs/metagame';
import { pairingsModeConfigContract } from './screenModeConfigs/pairings';
import { playerHistoryModeConfigContract } from './screenModeConfigs/playerHistory';
import { roundClockModeConfigContract } from './screenModeConfigs/roundClock';
import { standingsModeConfigContract } from './screenModeConfigs/standings';
import { isColumnVisible } from './screenModeConfigs/subShapes';
import { talentModeConfigContract, talentScreenTalentIds } from './screenModeConfigs/talent';
import { topCardsModeConfigContract } from './screenModeConfigs/topCards';
import { topCutModeConfigContract } from './screenModeConfigs/topCut';
import { archetypeSpotlightModeTokens } from './screenModeTokens/archetypeSpotlight';
import { cardModeTokens } from './screenModeTokens/card';
import { deckModeTokens } from './screenModeTokens/deck';
import { featureMatchOverlayModeTokens } from './screenModeTokens/featureMatchOverlay';
import { headToHeadModeTokens } from './screenModeTokens/headToHead';
import { metagameFormerModeTokens, metagameModeTokens } from './screenModeTokens/metagame';
import { pairingsModeTokens } from './screenModeTokens/pairings';
import { playerHistoryModeTokens } from './screenModeTokens/playerHistory';
import { roundClockModeTokens } from './screenModeTokens/roundClock';
import { standingsModeTokens } from './screenModeTokens/standings';
import { talentModeTokens } from './screenModeTokens/talent';
import { topCardsModeTokens } from './screenModeTokens/topCards';
import { topCutModeTokens } from './screenModeTokens/topCut';
import { SCREEN_MODE_VALUES } from './types/enums';

/**
 * What a field declared as each kind of Event Reference holds. A kind is what
 * the field names: a Phase, a Round, a Player, a Player List, a Feature Match
 * Slot, an Archetype or a Talent by id, a Talent lineup as an ordered list of
 * Talent ids, a whole Deck Source, which names a Player or a Broadcast Deck
 * List, or a whole Manual Bracket, whose entrants may each name a Player.
 */
interface EventReferenceValues {
	phase: EntityIdField;
	round: EntityIdField;
	player: EntityIdField;
	playerList: EntityIdField;
	featureMatchSlot: EntityIdField;
	archetype: EntityIdField;
	talent: EntityIdField;
	talentLineup: readonly number[] | undefined;
	deckSource: DeckSource | undefined;
	manualBracket: ManualBracket | undefined;
}

/** A field naming one entity by id, or none. */
type EntityIdField = number | null | undefined;

export type EventReferenceKind = keyof EventReferenceValues;

/** A mode's Event References: each config field naming something in the Screen's Event, and what it names. */
export type ScreenModeEventReferences = Readonly<Record<string, EventReferenceKind>>;

export interface ScreenModeDefinition {
	label: string;
	icon: string;
	displayType: DisplayType;
	description: string;
	/**
	 * The Card Games whose Events the mode is offered to, from the shared
	 * table (`SCREEN_MODE_CARD_GAMES`). Every mode declares it, so a new mode
	 * cannot skip the question; the mode pickers offer an
	 * Event only the modes declaring its Card Game (`getScreenModeSelectOptions`).
	 */
	cardGames: readonly Game[];
	/**
	 * The mode is a graphics host: it composes in its Event Canvas and exposes
	 * Overlay, Fill, and Key Screen Outputs. Its host takes no Theme Token of
	 * its own, so its outputs stay transparent and keyable.
	 */
	graphicsHost?: true;
	/**
	 * A Theme preview shows the mode though it declares no Mode Tokens: a
	 * graphics host whose Graphic Items bind Foundation Tokens instead, shown
	 * composing its sample graphic.
	 */
	themePreview?: true;
	/**
	 * The mode carries its own optional `backgroundLayers` stack, painted behind
	 * its content by the Screen renderer host.
	 *
	 * Declared here and nowhere else. The config field and its validation,
	 * preservation across a display reset, the settings editor card, the painting,
	 * and Graphic Asset Reference discovery — and so the Screen write path's
	 * reference versioning and what the Screen Output may resolve — all derive
	 * from this flag, so a mode that declares it gets every one of them.
	 *
	 * The rule behind who declares it: every plain overlay mode qualifies.
	 * Control screens are operator surfaces, not program output; the Background
	 * Screen is itself the stack; and the graphics hosts (Feature Match Overlay,
	 * Broadcast Graphics) own their backgrounds and rely on transparent
	 * Overlay/Key Outputs, so a host-painted layer behind them would break keying.
	 */
	backgroundLayers?: true;
	/**
	 * The mode's config contract: the one source of its config's shape, type,
	 * defaults, and authored stacks, from which its write forms are derived
	 * (ADR-0037).
	 */
	config: ScreenModeConfigContract<any>;
	/**
	 * The mode's Event References: which of its config fields name something
	 * that must belong to the Screen's Event, and what each names. `{}` declares
	 * none. Every mode declares it, so a new mode cannot skip the question.
	 *
	 * Declared here and nowhere else. The Screen write path derives its Event
	 * checks from it (`validateScreenModeConfigReferences`), and each field must
	 * be one of the mode's config fields holding what its kind names, or the
	 * definitions fail to compile (ADR-0038).
	 */
	eventReferences: ScreenModeEventReferences;
	/**
	 * What the mode's Screen Output follows: each kind of Output Change its
	 * rendering shows, and how the Screen's config narrows it to the Round,
	 * Player, Feature Match Slot or other id it names. `{}` declares none.
	 * Every mode declares it, so a new mode cannot skip the question. Every
	 * Screen follows its own Screen, its Event and its Theme without declaring
	 * them.
	 *
	 * Declared here and nowhere else. `screenHears` answers which Screens
	 * re-read on a change from it alone, and each narrowing must read the
	 * mode's own config, or the definitions fail to compile. It may be broader
	 * than the rendering needs, never narrower: a change heard needlessly costs
	 * one re-read, and one missed leaves stale data on air.
	 */
	outputFollows: ScreenModeOutputFollows;
	/**
	 * The mode is paginated: its pages show in turn as a Page Rotation
	 * (ADR-0009), and this names the config field holding how many rows a page
	 * holds. A mode that is not paginated leaves it out.
	 *
	 * Declared here and nowhere else. The settings editor's rotation writes,
	 * and the one rule for which edits change the rotation's shape
	 * (`pageRotationEdit`), and every rendering's paging all read it. A
	 * declaring mode's config must carry the shared Page Rotation fields and a
	 * numeric page size field, and a mode carrying any rotation field must
	 * declare it, or the definitions fail to compile (ADR-0039).
	 */
	pageRotation?: PageRotationDeclaration;
	/**
	 * How the mode looks: its Mode Tokens, by name within the mode, each with a
	 * type, optional bounds, and a default naming a same-type Foundation Token
	 * or holding a literal. Its config holds what it shows; these hold how it
	 * looks (ADR-0049, ADR-0051).
	 *
	 * Declared here and nowhere else. The Screen host resolves them and sets
	 * them as CSS custom properties for the display (`screenModeTokens`,
	 * `resolveThemeTokens`), beside every Foundation Token, which the display
	 * reads directly for its shared chrome. A mode not yet on
	 * Theme Tokens leaves it out; Feature Match Controls, an operator surface,
	 * always will.
	 */
	modeTokens?: Readonly<Record<string, AnyDeclaredModeTokenDefinition>>;
	/**
	 * The Mode Tokens an earlier version of the mode declared, by name within
	 * the mode, which a Theme or a Screen Theme Override may still store. As a
	 * config contract's `formerFields`: no reader sees one, and a write naming
	 * one is accepted without storing it (`isFormerThemeToken`).
	 */
	formerModeTokens?: readonly string[];
}

/** A Feature Match Slot a config names, or nothing while it names none. */
function namedSlot(slotId: number | null | undefined): OutputFollowNarrowing | false {
	return slotId != null && {
		slotIds: [slotId],
	};
}

/** The Player a Deck Source selects, whose record and decks a Deck List Screen reads. */
function deckSourcePlayer({ deckSource }: DeckModeConfig): OutputFollowNarrowing | false {
	return deckSource.type === 'player' && deckSource.playerId !== null && {
		playerIds: [deckSource.playerId],
	};
}

/** The Feature Match Slot whose side a Deck Source shows; its Session decides who sits there (ADR-0058). */
function deckSourceSlot({ deckSource }: DeckModeConfig): OutputFollowNarrowing | false {
	return deckSource.type === 'featureMatchSlot' && namedSlot(deckSource.slotId);
}

/**
 * What a Metagame read is derived from, for every mode reading one: every
 * Player in scope, their Deck Lists, the Archetypes, the Round Standings its
 * numbers count, and the Player List scoping it, only while the scope names
 * one.
 */
const METAGAME_OUTPUT_FOLLOWS = {
	player: true,
	playerDeck: true,
	archetype: true,
	roundStandings: true,
	playerList: ({ scope, playerListId }: { scope: MetagameScope; playerListId?: number }) =>
		scope === 'playerList' && playerListId != null && {
			playerListIds: [playerListId],
		},
} as const satisfies ScreenModeOutputFollows;

const followsTopCutPhase = (config: TopCutModeConfig) => config.bracketSource === 'phase';
const showsTopCutArchetypes = (config: TopCutModeConfig) => config.showArchetypes;

/** Whether a Player History names its Player; until then it reads nothing. */
const selectsPlayerHistory = (config: PlayerHistoryModeConfig) => config.playerId != null;

/** Whether a Pairings Screen names its Round; until then it reads nothing. */
const selectsPairings = (config: PairingsModeConfig) => config.roundId != null;

/** Whether a Head-to-Head names its Slot or a Player; until then it reads nothing. */
function selectsHeadToHead(config: HeadToHeadModeConfig): boolean {
	return config.playerSource === 'featureMatchSlot'
		? config.featureMatchId != null
		: config.player1Id != null || config.player2Id != null;
}

const headToHeadSlot = (config: HeadToHeadModeConfig) => config.playerSource === 'featureMatchSlot' && namedSlot(config.featureMatchId);

/** Whether a Round Clock follows the Current Round, which any Round, Phase or Match may move. */
const followsCurrentRound = (config: RoundClockModeConfig) => config.roundId == null;

/** Whether a Feature Match Overlay names its Slot; until then it reads nothing. */
const selectsOverlaySlot = (config: FeatureMatchOverlayModeConfig) => config.featureMatchId != null;

/** The Players the Overlay's Slot seats, whose sideboards a Deck List Graphic Item shows. */
function overlaySeatedPlayers(config: FeatureMatchOverlayModeConfig): OutputFollowNarrowing | false {
	return config.featureMatchId != null && {
		playerIds: { seatedIn: config.featureMatchId },
	};
}

/**
 * Single source of truth for all screen modes and their display characteristics.
 * Each mode declares its own display type, label, and icon, and what it carries.
 *
 * Kept literal (`satisfies`, not an annotation) so the modes carrying something
 * can be derived as a type as well as a list; `SCREEN_MODES` below is the same object
 * widened for readers asking about any mode.
 */
const SCREEN_MODE_DEFINITIONS = {
	'background': {
		label: 'Background',
		icon: 'i-lucide-wallpaper',
		displayType: 'overlay',
		description: 'Full-screen layered background',
		cardGames: SCREEN_MODE_CARD_GAMES.background,
		config: backgroundModeConfigContract,
		eventReferences: {},
		outputFollows: {},
	},
	'card': {
		label: 'Card Spotlight',
		icon: 'i-lucide-square',
		displayType: 'overlay',
		description: 'Single card display',
		cardGames: SCREEN_MODE_CARD_GAMES.card,
		backgroundLayers: true,
		config: cardModeConfigContract,
		eventReferences: { featureMatchId: 'featureMatchSlot' },
		// Its Card arrives on the Card's own messages; `featureMatchId` only helps its operator pick one.
		outputFollows: { screenCard: true },
		modeTokens: cardModeTokens,
	},
	'deck': {
		label: 'Deck List',
		icon: 'i-lucide-layers',
		displayType: 'overlay',
		description: 'Deck list view',
		cardGames: SCREEN_MODE_CARD_GAMES.deck,
		backgroundLayers: true,
		config: deckModeConfigContract,
		eventReferences: { deckSource: 'deckSource' },
		outputFollows: {
			player: deckSourcePlayer,
			playerDeck: deckSourcePlayer,
			// Over-approximation: only the shown deck's own Archetype matters, and only the rendering holds which that is.
			archetype: (config: DeckModeConfig) => deckSourcePlayer(config) !== false,
			broadcastDeckList: ({ deckSource }: DeckModeConfig) =>
				deckSource.type === 'broadcast' && {
					broadcastDeckListIds: [deckSource.broadcastDeckListId],
				},
			featureMatchSlot: deckSourceSlot,
			featureMatchSession: deckSourceSlot,
		},
		modeTokens: deckModeTokens,
	},
	'standings': {
		label: 'Standings',
		icon: 'i-lucide-trophy',
		displayType: 'overlay',
		description: 'Player standings',
		cardGames: SCREEN_MODE_CARD_GAMES.standings,
		backgroundLayers: true,
		config: standingsModeConfigContract,
		eventReferences: { roundId: 'round', playerListId: 'playerList' },
		outputFollows: {
			player: true,
			roundStandings: true,
			// The Round it is fixed at; while Position Change shows, any Round or
			// Phase, since either may reorder the Event's Rounds. Fixed at no
			// Round it names none, and still hears a sync of them all, as today.
			round: (config: StandingsModeConfig) =>
				isColumnVisible(config.columns, 'positionChange')
				|| {
					roundIds: config.roundId == null
						? []
						: [config.roundId],
				},
			phase: (config: StandingsModeConfig) => isColumnVisible(config.columns, 'positionChange'),
			playerList: (config: StandingsModeConfig) =>
				config.viewMode === 'watchlist' && config.playerListId != null && {
					playerListIds: [config.playerListId],
				},
		},
		pageRotation: { pageSize: 'rowsPerPage' },
		modeTokens: standingsModeTokens,
	},
	'top-cut': {
		label: 'Top Cut Bracket',
		icon: 'i-lucide-git-branch',
		displayType: 'overlay',
		description: 'Top cut bracket',
		cardGames: SCREEN_MODE_CARD_GAMES['top-cut'],
		backgroundLayers: true,
		config: topCutModeConfigContract,
		eventReferences: { phaseId: 'phase', manualBracket: 'manualBracket' },
		outputFollows: {
			// A Manual Bracket names its Players. Over-approximation: a Phase's
			// bracket seats whoever its Matches do, which only its read knows,
			// and a One Piece Card Game Event shows its Manual Bracket whatever
			// `bracketSource` says (ADR-0075), so that source hears every Player.
			player: (config: TopCutModeConfig) => config.bracketSource !== 'manual' || {
				playerIds: config.manualBracket.entrants.flatMap(entrant => entrant && 'playerId' in entrant
					? [entrant.playerId]
					: []),
			},
			playerDeck: showsTopCutArchetypes,
			archetype: showsTopCutArchetypes,
			// Over-approximation: which Rounds and Matches are the Phase's, and
			// which Round Standings seed it, only its read knows.
			phase: followsTopCutPhase,
			round: followsTopCutPhase,
			match: followsTopCutPhase,
			roundStandings: followsTopCutPhase,
		},
		modeTokens: topCutModeTokens,
	},
	'feature-match': {
		label: 'Feature Match Controls',
		icon: 'i-lucide-swords',
		displayType: 'control',
		description: 'Live feature match controls',
		cardGames: SCREEN_MODE_CARD_GAMES['feature-match'],
		config: featureMatchModeConfigContract,
		eventReferences: { featureMatchId: 'featureMatchSlot' },
		outputFollows: {
			featureMatchSlot: (config: FeatureMatchModeConfig) => namedSlot(config.featureMatchId),
			featureMatchSession: (config: FeatureMatchModeConfig) => namedSlot(config.featureMatchId),
		},
	},
	'feature-match-overlay': {
		label: 'Feature Match Overlay',
		icon: 'i-lucide-panels-top-left',
		displayType: 'overlay',
		description: 'Pixel-exact feature match overlay with fill/key outputs',
		cardGames: SCREEN_MODE_CARD_GAMES['feature-match-overlay'],
		graphicsHost: true,
		config: featureMatchOverlayModeConfigContract,
		eventReferences: { featureMatchId: 'featureMatchSlot' },
		outputFollows: {
			featureMatchSlot: (config: FeatureMatchOverlayModeConfig) => namedSlot(config.featureMatchId),
			featureMatchSession: (config: FeatureMatchOverlayModeConfig) => namedSlot(config.featureMatchId),
			// Over-approximation: it shows the one Match its Slot follows, and
			// that Match's Round and Phase, which the Slot names and the config does not.
			match: selectsOverlaySlot,
			round: selectsOverlaySlot,
			phase: selectsOverlaySlot,
			// Over-approximation: followed whether or not the layout holds a Deck List Graphic Item.
			player: overlaySeatedPlayers,
			playerDeck: overlaySeatedPlayers,
		},
		modeTokens: featureMatchOverlayModeTokens,
	},
	'broadcast-graphics': {
		label: 'Broadcast Graphics',
		icon: 'i-lucide-layout-template',
		displayType: 'overlay',
		description: 'Composed broadcast graphics stack with overlay/fill/key outputs',
		cardGames: SCREEN_MODE_CARD_GAMES['broadcast-graphics'],
		graphicsHost: true,
		themePreview: true,
		config: broadcastGraphicsModeConfigContract,
		eventReferences: {},
		// Its Graphic Input Bindings are resolved into its Live Session, which is all it reads.
		outputFollows: { broadcastGraphicsLiveSession: true },
	},
	'metagame': {
		label: 'Metagame',
		icon: 'i-lucide-pie-chart',
		displayType: 'overlay',
		description: 'Metagame breakdown',
		cardGames: SCREEN_MODE_CARD_GAMES.metagame,
		backgroundLayers: true,
		config: metagameModeConfigContract,
		eventReferences: { playerListId: 'playerList' },
		outputFollows: METAGAME_OUTPUT_FOLLOWS,
		pageRotation: { pageSize: 'pageSize' },
		modeTokens: metagameModeTokens,
		formerModeTokens: metagameFormerModeTokens,
	},
	'top-cards': {
		label: 'Most Played Cards',
		icon: 'i-lucide-trending-up',
		displayType: 'overlay',
		description: 'Most played cards grid',
		cardGames: SCREEN_MODE_CARD_GAMES['top-cards'],
		backgroundLayers: true,
		config: topCardsModeConfigContract,
		eventReferences: { playerListId: 'playerList' },
		outputFollows: METAGAME_OUTPUT_FOLLOWS,
		pageRotation: { pageSize: 'cardsPerPage' },
		modeTokens: topCardsModeTokens,
	},
	'player-history': {
		label: 'Player History',
		icon: 'i-lucide-history',
		displayType: 'overlay',
		description: 'Player match history',
		cardGames: SCREEN_MODE_CARD_GAMES['player-history'],
		backgroundLayers: true,
		config: playerHistoryModeConfigContract,
		eventReferences: { playerId: 'player' },
		// Over-approximation throughout: its rows hold opponents, Matches since
		// re-seated, their Rounds and the opponents' Archetypes, which only its read knows.
		outputFollows: {
			player: selectsPlayerHistory,
			playerDeck: selectsPlayerHistory,
			match: selectsPlayerHistory,
			round: selectsPlayerHistory,
			phase: selectsPlayerHistory,
			archetype: selectsPlayerHistory,
		},
		pageRotation: { pageSize: 'rowsPerPage' },
		modeTokens: playerHistoryModeTokens,
	},
	'pairings': {
		label: 'Pairings',
		icon: 'i-lucide-list-ordered',
		displayType: 'overlay',
		description: 'Round pairings and results',
		cardGames: SCREEN_MODE_CARD_GAMES.pairings,
		backgroundLayers: true,
		config: pairingsModeConfigContract,
		eventReferences: { roundId: 'round' },
		outputFollows: {
			round: (config: PairingsModeConfig) => config.roundId != null && {
				roundIds: [config.roundId],
			},
			// Over-approximation: a Match moved out of its Round names only the
			// Round it joined, and which Players its Matches seat only its read knows.
			match: selectsPairings,
			player: selectsPairings,
		},
		pageRotation: { pageSize: 'rowsPerPage' },
		modeTokens: pairingsModeTokens,
	},
	'archetype-spotlight': {
		label: 'Archetype Spotlight',
		icon: 'i-lucide-crosshair',
		displayType: 'overlay',
		description: 'One archetype\'s pilots, numbers and top cards',
		cardGames: SCREEN_MODE_CARD_GAMES['archetype-spotlight'],
		backgroundLayers: true,
		config: archetypeSpotlightModeConfigContract,
		eventReferences: { archetypeId: 'archetype', playerListId: 'playerList' },
		outputFollows: METAGAME_OUTPUT_FOLLOWS,
		pageRotation: { pageSize: 'rowsPerPage' },
		modeTokens: archetypeSpotlightModeTokens,
	},
	'head-to-head': {
		label: 'Head-to-Head',
		icon: 'i-lucide-users',
		displayType: 'overlay',
		description: 'Two Players side by side before their Match',
		cardGames: SCREEN_MODE_CARD_GAMES['head-to-head'],
		backgroundLayers: true,
		config: headToHeadModeConfigContract,
		eventReferences: { featureMatchId: 'featureMatchSlot', player1Id: 'player', player2Id: 'player' },
		outputFollows: {
			featureMatchSlot: headToHeadSlot,
			featureMatchSession: headToHeadSlot,
			// The two Players it picks, or the two its Slot seats.
			player: (config: HeadToHeadModeConfig) => config.playerSource === 'featureMatchSlot'
				? config.featureMatchId != null && {
					playerIds: { seatedIn: config.featureMatchId },
				}
				: {
						playerIds: [config.player1Id, config.player2Id].filter(id => id != null),
					},
			// Over-approximation: the earlier Matches between its Players, their
			// Rounds and Phases, and the Players' Archetypes, only its read knows.
			match: selectsHeadToHead,
			round: selectsHeadToHead,
			phase: selectsHeadToHead,
			archetype: selectsHeadToHead,
			playerDeck: selectsHeadToHead,
			roundStandings: selectsHeadToHead,
		},
		modeTokens: headToHeadModeTokens,
	},
	'round-clock': {
		label: 'Round Clock',
		icon: 'i-lucide-timer',
		displayType: 'overlay',
		description: 'Time remaining in a Round',
		cardGames: SCREEN_MODE_CARD_GAMES['round-clock'],
		backgroundLayers: true,
		config: roundClockModeConfigContract,
		eventReferences: { roundId: 'round' },
		outputFollows: {
			round: (config: RoundClockModeConfig) => config.roundId == null || {
				roundIds: [config.roundId],
			},
			match: followsCurrentRound,
			phase: followsCurrentRound,
		},
		modeTokens: roundClockModeTokens,
	},
	// Talent needs no results or Deck Lists, so ADR-0057 leaves it to every Card Game.
	'talent': {
		label: 'Talent',
		icon: 'i-lucide-mic',
		displayType: 'overlay',
		description: 'The broadcast\'s presenters and commentators, with their Social Profiles',
		cardGames: SCREEN_MODE_CARD_GAMES.talent,
		backgroundLayers: true,
		config: talentModeConfigContract,
		eventReferences: { talentId: 'talent', talentIds: 'talentLineup' },
		outputFollows: {
			talent: (config: TalentModeConfig) => {
				const talentIds = talentScreenTalentIds(config);
				return talentIds.length > 0 && { talentIds };
			},
		},
		modeTokens: talentModeTokens,
	},
} as const satisfies Record<ScreenMode, ScreenModeDefinition>;

export const SCREEN_MODES: Record<ScreenMode, ScreenModeDefinition> = SCREEN_MODE_DEFINITIONS;

/** Derive the display type for a given screen mode. */
export function getDisplayType(mode: ScreenMode): DisplayType {
	return SCREEN_MODES[mode].displayType;
}

/** The Screen Modes whose definition declares a Background Layer stack. */
export type BackgroundLayersCapableMode = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { backgroundLayers: true } ? M : never;
}[ScreenMode];

export function screenModeSupportsBackgroundLayers(mode: ScreenMode): mode is BackgroundLayersCapableMode {
	return SCREEN_MODES[mode].backgroundLayers === true;
}

/** The same modes as a list, in Screen Mode order, derived from the declaration. */
export const BACKGROUND_LAYERS_CAPABLE_MODES: readonly BackgroundLayersCapableMode[]
	= SCREEN_MODE_VALUES.filter(screenModeSupportsBackgroundLayers);

/** A mode's config, as its contract defines it. */
type ConfigOfMode<M extends ScreenMode> = ScreenModeConfigOf<typeof SCREEN_MODE_DEFINITIONS[M]['config']>;
type EventReferencesOfMode<M extends ScreenMode> = typeof SCREEN_MODE_DEFINITIONS[M]['eventReferences'];

/**
 * Each declared Event Reference that is not one of its mode's config fields, or
 * whose field does not hold what its kind names, as `mode.field`.
 */
type MisdeclaredEventReference = {
	[M in ScreenMode]: {
		[F in keyof EventReferencesOfMode<M> & string]: F extends keyof ConfigOfMode<M>
			? ConfigOfMode<M>[F] extends EventReferenceValues[EventReferencesOfMode<M>[F] & EventReferenceKind] ? never : `${M}.${F}`
			: `${M}.${F}`;
	}[keyof EventReferencesOfMode<M> & string];
}[ScreenMode];

/**
 * Fails to compile when an Event Reference is misdeclared; the error's
 * `MisdeclaredEventReference` resolves to each offending `mode.field`.
 * Exported only so the check is not an unused binding.
 */
export const EVENT_REFERENCES_FIT_THEIR_CONFIG: [MisdeclaredEventReference] extends [never] ? true : MisdeclaredEventReference = true;

/** Each mode whose `outputFollows` reads a config that is not its own. */
type MisdeclaredOutputFollows = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M]['outputFollows'] extends ScreenModeOutputFollows<ConfigOfMode<M>> ? never : M;
}[ScreenMode];

/**
 * Fails to compile when a mode's `outputFollows` narrows by another mode's
 * config; the error's `MisdeclaredOutputFollows` resolves to each offending mode.
 * Exported only so the check is not an unused binding.
 */
export const OUTPUT_FOLLOWS_FIT_THEIR_CONFIG: [MisdeclaredOutputFollows] extends [never] ? true : MisdeclaredOutputFollows = true;

/** The Screen Modes whose definition declares a Page Rotation. */
export type PageRotationMode = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { pageRotation: PageRotationDeclaration } ? M : never;
}[ScreenMode];

/** A paginated mode's Page Rotation declaration. */
export function screenModePageRotation(mode: PageRotationMode): PageRotationDeclaration {
	return SCREEN_MODES[mode].pageRotation!;
}

/**
 * Each mode whose Page Rotation declaration and config disagree: a declaring
 * mode whose config lacks the shared rotation fields or a page size field
 * holding a number (optional where the mode pages by Auto), or a mode carrying
 * a rotation field without declaring a Page Rotation.
 */
type MisdeclaredPageRotation = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { pageRotation: { pageSize: infer PageSize extends string } }
		? PageSize extends keyof ConfigOfMode<M>
			? ConfigOfMode<M> extends PageRotationConfig & Partial<Record<PageSize, number>> ? never : M
			: M
		: Extract<keyof ConfigOfMode<M>, keyof PageRotationConfig> extends never ? never : M;
}[ScreenMode];

/**
 * Fails to compile when a Page Rotation is misdeclared; the error's
 * `MisdeclaredPageRotation` resolves to each offending mode.
 * Exported only so the check is not an unused binding.
 */
export const PAGE_ROTATIONS_FIT_THEIR_CONFIG: [MisdeclaredPageRotation] extends [never] ? true : MisdeclaredPageRotation = true;

/** A mode's config contract. */
export function screenModeConfigContract<M extends ScreenMode>(mode: M): typeof SCREEN_MODE_DEFINITIONS[M]['config'] {
	return SCREEN_MODE_DEFINITIONS[mode].config;
}

/** The Screen Modes whose definition declares Mode Tokens. */
export type ThemedScreenMode = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { modeTokens: object } ? M : never;
}[ScreenMode];

/**
 * The Screen Modes a Theme preview shows, in Screen Mode order: each mode
 * declaring Mode Tokens, and each graphics host declaring a Theme preview.
 */
export const THEME_PREVIEW_SCREEN_MODES: readonly ScreenMode[] = SCREEN_MODE_VALUES.filter(mode =>
	SCREEN_MODES[mode].modeTokens || SCREEN_MODES[mode].themePreview);

/** A themed mode's Mode Tokens of one type, by name within the mode. */
export type ScreenModeTokenOfType<M extends ThemedScreenMode, T extends ThemeTokenType> = {
	[K in keyof typeof SCREEN_MODE_DEFINITIONS[M]['modeTokens']]: typeof SCREEN_MODE_DEFINITIONS[M]['modeTokens'][K] extends { type: T } ? K : never;
}[keyof typeof SCREEN_MODE_DEFINITIONS[M]['modeTokens']] & string;

/**
 * A Mode Token's full name, as a Theme or a Screen Theme Override stores it:
 * its mode's key, then its name within the mode.
 */
export type ScreenModeTokenName = `${ScreenMode}.${string}`;

export function screenModeTokenName(mode: ScreenMode, token: string): ScreenModeTokenName {
	return `${mode}.${token}`;
}

/** A mode's declared Mode Tokens by full name, as `resolveThemeTokens` reads them; none for a mode declaring none. */
export function screenModeTokens(mode: ScreenMode): Readonly<Record<ScreenModeTokenName, AnyDeclaredModeTokenDefinition>> {
	const declared = SCREEN_MODES[mode].modeTokens ?? {};
	return Object.fromEntries(Object.entries(declared).map(([token, definition]) => [
		screenModeTokenName(mode, token),
		definition,
	]));
}

/** A mode's former Mode Tokens by full name; none for a mode that dropped none. */
export function screenModeFormerTokens(mode: ScreenMode): ScreenModeTokenName[] {
	return (SCREEN_MODES[mode].formerModeTokens ?? []).map(token => screenModeTokenName(mode, token));
}

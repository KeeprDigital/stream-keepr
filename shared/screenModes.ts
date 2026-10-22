import type { PageRotationDeclaration } from './modules/page-rotation';
import type { ScreenModeConfigContract, ScreenModeConfigOf } from './screenModeConfigs/contract';
import type { DeckSource } from './screenModeConfigs/deck';
import type { PageRotationConfig } from './screenModeConfigs/subShapes';
import type { DisplayType, ScreenMode } from './types/enums';
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
import { standingsModeConfigContract } from './screenModeConfigs/standings';
import { topCardsModeConfigContract } from './screenModeConfigs/topCards';
import { topCutModeConfigContract } from './screenModeConfigs/topCut';
import { SCREEN_MODE_VALUES } from './types/enums';
import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
} from './types/screenConfig';

export interface ScreenModeContainerControls {
	dimensions?: boolean;
	padding?: boolean;
	textColors?: boolean;
	background?: boolean;
}

/**
 * The graphics host profile of a Screen Mode that renders a pixel-exact canvas
 * and exposes Overlay, Fill, and Key Screen Outputs.
 *
 * Declaring it here keeps host size, generic-control exclusions, dimension
 * placement, and output options together on the Screen Mode Definition instead
 * of scattering them across parallel per-mode lookup tables.
 */
export interface ScreenModeGraphicsHost {
	canvasWidth: number;
	canvasHeight: number;
	/** Feature Match Overlay still honours generic Screen alignment; a transparent host does not. */
	useScreenAlignment?: boolean;
}

/**
 * What a field declared as each kind of Event Reference holds. A kind is what
 * the field names: a Phase, a Round, a Player, a Player List or a Feature Match
 * Slot by id, or a whole Deck Source, which names a Player or a Broadcast Deck
 * List.
 */
interface EventReferenceValues {
	phase: EntityIdField;
	round: EntityIdField;
	player: EntityIdField;
	playerList: EntityIdField;
	featureMatchSlot: EntityIdField;
	deckSource: DeckSource | undefined;
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
	containerControls?: ScreenModeContainerControls;
	graphicsHost?: ScreenModeGraphicsHost;
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
}

/** Generic Screen container controls a graphics host replaces with its own canvas and styling. */
const GRAPHICS_HOST_CONTAINER_CONTROLS: ScreenModeContainerControls = {
	padding: false,
	textColors: false,
	background: false,
};

export const DEFAULT_OVERLAY_CONTAINER_CONTROLS: Required<ScreenModeContainerControls> = {
	dimensions: true,
	padding: true,
	textColors: true,
	background: true,
};

/**
 * Single source of truth for all screen modes and their display characteristics.
 * Each mode declares its own display type, label, and icon, and what it carries.
 *
 * Kept literal (`satisfies`, not an annotation) so the modes carrying something
 * can be derived as a type as well as a list; `SCREEN_MODES` below is the same object
 * widened for readers asking about any mode.
 */
const SCREEN_MODE_DEFINITIONS = {
	'background': { label: 'Background', icon: 'i-lucide-wallpaper', displayType: 'overlay', description: 'Full-screen layered background', config: backgroundModeConfigContract, eventReferences: {} },
	'card': { label: 'Card', icon: 'i-lucide-square', displayType: 'overlay', description: 'Single card display', backgroundLayers: true, config: cardModeConfigContract, eventReferences: { featureMatchId: 'featureMatchSlot' } },
	'deck': { label: 'Deck', icon: 'i-lucide-layers', displayType: 'overlay', description: 'Deck list view', backgroundLayers: true, config: deckModeConfigContract, eventReferences: { deckSource: 'deckSource' } },
	'standings': { label: 'Standings', icon: 'i-lucide-trophy', displayType: 'overlay', description: 'Player standings', backgroundLayers: true, config: standingsModeConfigContract, eventReferences: { roundId: 'round', playerListId: 'playerList' }, pageRotation: { pageSize: 'rowsPerPage' } },
	'topCut': { label: 'Top Cut', icon: 'i-lucide-git-branch', displayType: 'overlay', description: 'Top cut bracket', backgroundLayers: true, config: topCutModeConfigContract, eventReferences: { phaseId: 'phase' } },
	'feature-match': { label: 'Feature Match', icon: 'i-lucide-swords', displayType: 'control', description: 'Live feature match controls', config: featureMatchModeConfigContract, eventReferences: { featureMatchId: 'featureMatchSlot' } },
	'feature-match-overlay': {
		label: 'Feature Match Overlay',
		icon: 'i-lucide-panels-top-left',
		displayType: 'overlay',
		description: 'Pixel-exact feature match overlay with fill/key outputs',
		containerControls: GRAPHICS_HOST_CONTAINER_CONTROLS,
		graphicsHost: {
			canvasWidth: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
			canvasHeight: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
		},
		config: featureMatchOverlayModeConfigContract,
		eventReferences: { featureMatchId: 'featureMatchSlot' },
	},
	'broadcast-graphics': {
		label: 'Broadcast Graphics',
		icon: 'i-lucide-layout-template',
		displayType: 'overlay',
		description: 'Composed broadcast graphics stack with overlay/fill/key outputs',
		containerControls: GRAPHICS_HOST_CONTAINER_CONTROLS,
		graphicsHost: {
			canvasWidth: DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
			canvasHeight: DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
			useScreenAlignment: false,
		},
		config: broadcastGraphicsModeConfigContract,
		eventReferences: {},
	},
	'metagame': { label: 'Metagame', icon: 'i-lucide-pie-chart', displayType: 'overlay', description: 'Metagame breakdown', backgroundLayers: true, config: metagameModeConfigContract, eventReferences: { playerListId: 'playerList' }, pageRotation: { pageSize: 'pageSize' } },
	'top-cards': { label: 'Top Cards', icon: 'i-lucide-trending-up', displayType: 'overlay', description: 'Most played cards grid', backgroundLayers: true, config: topCardsModeConfigContract, eventReferences: { playerListId: 'playerList' }, pageRotation: { pageSize: 'rowsPerPage' } },
	'player-history': { label: 'Player History', icon: 'i-lucide-history', displayType: 'overlay', description: 'Player match history', backgroundLayers: true, config: playerHistoryModeConfigContract, eventReferences: { playerId: 'player' }, pageRotation: { pageSize: 'rowsPerPage' } },
	'pairings': { label: 'Pairings', icon: 'i-lucide-list-ordered', displayType: 'overlay', description: 'Round pairings and results', backgroundLayers: true, config: pairingsModeConfigContract, eventReferences: { roundId: 'round' }, pageRotation: { pageSize: 'rowsPerPage' } },
	'head-to-head': { label: 'Head-to-head', icon: 'i-lucide-users', displayType: 'overlay', description: 'Two Players side by side before their Match', backgroundLayers: true, config: headToHeadModeConfigContract, eventReferences: { featureMatchId: 'featureMatchSlot', player1Id: 'player', player2Id: 'player' } },
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
 * mode whose config lacks the shared rotation fields or a numeric page size
 * field, or a mode carrying a rotation field without declaring a Page Rotation.
 */
type MisdeclaredPageRotation = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { pageRotation: { pageSize: infer PageSize extends string } }
		? ConfigOfMode<M> extends PageRotationConfig & Record<PageSize, number> ? never : M
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

/** Derive which generic Container controls apply to a Screen Mode. */
export function getContainerControls(mode: ScreenMode): Required<ScreenModeContainerControls> {
	return {
		...DEFAULT_OVERLAY_CONTAINER_CONTROLS,
		...(SCREEN_MODES[mode].containerControls ?? {}),
	};
}

/**
 * The canvas a graphics Screen Mode defaults to, when a Screen has not yet been
 * given its own width and height. This is the one home for that number: editors
 * and Screen Outputs read it here rather than reaching for a loose constant.
 * Only a graphics host has a canvas, so asking about any other mode is a bug.
 */
export function getScreenModeGraphicsCanvas(mode: ScreenMode): { width: number; height: number } {
	const graphicsHost = SCREEN_MODES[mode].graphicsHost;
	if (!graphicsHost)
		throw new Error(`Screen Mode "${mode}" has no graphics host canvas.`);

	return { width: graphicsHost.canvasWidth, height: graphicsHost.canvasHeight };
}

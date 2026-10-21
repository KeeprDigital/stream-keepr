import type { PlayerSide } from '../../types/enums';
import type {
	GameWinsGraphicItemConfig,
	GraphicFill,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicSurfaceStyle,
	GraphicTypography,
	ShapeGeometry,
	TextOverflowPolicy,
} from '../../types/graphics';
import type { GraphicStyleSlot } from '../../types/graphicStyleSet';
import type { GraphicsContextKind, GraphicsHostContract, GraphicsHostId } from './hostContract';
import { SUPPORTED_SOCIAL_NETWORK_BY_KEY } from '../../socialProfiles';
import { applicationGraphicFont } from '../../types/graphics';
import { roundedShapeGeometry, shapeGeometrySummary, squareShapeGeometry } from './shapeGeometry';
import { DEFAULT_GRAPHIC_FONT_ID } from './typography';

/**
 * Graphic Item Definitions: the application-owned contract for each Graphic
 * Item kind — stable identifier, configuration version, editor metadata,
 * defaults, summary, and the property groups it owns: typography, Graphic Surface
 * Styles, Shape Geometry, and a player side, each with the display mode it is on
 * screen in.
 *
 * Adding a kind is still a sweep rather than an entry: this table (whose
 * `satisfies` closure forces the new member), the config interface and unions in
 * `shared/types/graphics.ts`, the wire schema arms in `server/schemas/api/screen.ts`,
 * the descriptor arms in `app/modules/graphics/renderModel.ts`, and the compositor's
 * `Item.vue` and the Inspector's kind-specific controls. What follows this table for
 * free: the definition palette, Template Package requirements, and the property
 * groups — the Inspector, the Graphic Style Set slots, and authoring all read the
 * declarations below rather than a kind list of their own, and the mapped type on
 * the `satisfies` closure requires each declaration exactly where the kind's stored
 * config carries the group. Templates never provide executable Definitions.
 *
 * ## The configuration version is a portability contract, not a changelog
 *
 * It is what a Template Package declares and what a receiving installation checks:
 * a package requiring version 2 of `media` cannot install here while this
 * installation implements version 1, and it fails atomically rather than
 * installing a Graphic Item nothing can render as authored.
 *
 * So it advances only when a kind's *stored configuration* gains meaning an older
 * installation would silently misread — a new field it would drop, or a changed
 * interpretation of an existing one. Renaming a label, changing an icon, moving a
 * default, or adding an editor control changes nothing a stored document carries
 * and must leave the version alone: raising it needlessly refuses packages this
 * installation could have rendered perfectly.
 */

export interface GraphicItemDefaultsOptions {
	id: string;
	label: string;
	canvasWidth: number;
	canvasHeight: number;
}

export interface GraphicItemDefinition {
	kind: GraphicItemKind;
	/**
	 * The version of this kind's stored configuration that this installation
	 * implements. A Template Package declaring a higher one for this kind is
	 * refused; a lower one is readable.
	 */
	configurationVersion: number;
	label: string;
	icon: string;
	/** A context the host must declare before the definition palette offers this kind. */
	requiredContext?: GraphicsContextKind;
	/** A single Screen Mode host this Definition is reserved for. */
	requiredHost?: GraphicsHostId;
	createDefault: (options: GraphicItemDefaultsOptions) => GraphicItemConfig;
	summary: (item: GraphicItemConfig) => string;
	/**
	 * The base typography this kind paints its text with, absent for a kind that paints
	 * none. Stated once here: the Inspector's typography and Text Overflow Policy
	 * controls, the Graphic Style Set typography slot, and the authoring operations
	 * all read it, so none of them can offer typography a kind does not have.
	 */
	typography?: GraphicTypographyDeclaration;
	/**
	 * The Graphic Surface Styles this kind keeps, each under its Graphic Style Set
	 * slot, absent for a kind that paints none. The Graphic Style Set slots, the
	 * surface authoring operations, and the Inspector's surface controls all read it.
	 */
	surfaceStyles?: Partial<Record<GraphicSurfaceStyleSlot, GraphicDisplayDeclaration>>;
	/** The one Shape Geometry this kind draws, clips to, or shapes a part with, absent for none. */
	shapeGeometry?: GraphicShapeGeometryDeclaration;
	/** Whether this kind reads one player side's live state, which its author chooses. */
	playerSide?: true;
}

/** A Graphic Item whose configuration carries base typography. */
export type GraphicTypographyItem = Extract<GraphicItemConfig, { typography: GraphicTypography }>;

/** A Graphic Item whose configuration carries a Text Overflow Policy. */
export type GraphicTextOverflowItem = Extract<GraphicItemConfig, { overflowPolicy: TextOverflowPolicy }>;

export interface GraphicTypographyDeclaration {
	/**
	 * Whether a Text Overflow Policy bounds the text: true for a kind whose rendered
	 * string can exceed its authored bounds.
	 */
	textOverflowPolicy: boolean;
	/**
	 * Whether the item paints text with its typography in its current display mode;
	 * absent means always. The item owns its typography either way, so a Graphic Style
	 * Set slot still binds to it — only the Inspector, which offers controls for what
	 * is on screen, reads this.
	 *
	 * Each Definition narrows the parameter to its own kind, and is only ever called
	 * with an item of that kind.
	 */
	paintsText?: (item: GraphicTypographyItem) => boolean;
}

type GraphicItemOfKind<K extends GraphicItemKind> = Extract<GraphicItemConfig, { type: K }>;

/**
 * The Graphic Item kinds whose stored configuration has a key, optional or not. A
 * key-based `Extract` would also admit every kind lacking an optional key.
 */
type GraphicItemWithKey<P extends PropertyKey, I = GraphicItemConfig> = I extends unknown
	? P extends keyof I ? I : never
	: never;

/**
 * Every place a Graphic Item can keep a Graphic Surface Style, each named as the
 * Graphic Style Set slot that inherits into it.
 */
export type GraphicSurfaceStyleSlot = Extract<
	GraphicStyleSlot,
	'surfaceStyle' | 'defaultChildSurfaceStyle' | 'boxSurfaceStyle' | 'wonBoxSurfaceStyle'
>;

/** Every place a Graphic Item can keep its Shape Geometry, named as its Graphic Style Set slot. */
export type GraphicShapeGeometrySlot = Extract<GraphicStyleSlot, 'geometry' | 'clipGeometry' | 'boxGeometry'>;

/** A Graphic Item that can keep a Graphic Surface Style in this slot. */
export type GraphicSurfaceStyleItem<S extends GraphicSurfaceStyleSlot = GraphicSurfaceStyleSlot> = GraphicItemWithKey<S>;

/** A Graphic Item that can keep a Shape Geometry. */
export type GraphicShapeGeometryItem = GraphicItemWithKey<GraphicShapeGeometrySlot>;

/** A Graphic Item that reads one player side. */
export type GraphicPlayerSideItem = Extract<GraphicItemConfig, { playerSide: PlayerSide }>;

/**
 * When a property group the item owns is on screen. `paints` absent means always;
 * otherwise it is the item's current display mode that decides, as `paintsText` does
 * for typography. The item owns the group either way, so a Graphic Style Set slot
 * still binds to it — only the Inspector, which offers controls for what is on
 * screen, reads this.
 *
 * Each Definition narrows the parameter to its own kind, and is only ever called
 * with an item of that kind.
 */
export interface GraphicDisplayDeclaration {
	paints?: (item: GraphicItemConfig) => boolean;
}

export interface GraphicShapeGeometryDeclaration extends GraphicDisplayDeclaration {
	slot: GraphicShapeGeometrySlot;
	/**
	 * The item's numeric fields the geometry is drawn inside, and where a preset that
	 * proposes a height writes it; absent means the item's own `width` and `height`.
	 */
	bounds?: { width: string; height: string };
}

type NumericKeyOf<I> = { [P in keyof I]-?: I[P] extends number ? P : never }[keyof I];

interface GraphicDisplayDeclarationFor<K extends GraphicItemKind> {
	paints?: (item: GraphicItemOfKind<K>) => boolean;
}

/**
 * What a kind's Definition must declare about its Graphic Surface Styles, Shape
 * Geometry, and player side, decided by its stored configuration exactly as
 * `GraphicTypographyDeclarationFor` decides typography: a declaration for each
 * surface key the config has and none it lacks, the one geometry key it has, and a
 * player side where the config carries one.
 */
type GraphicSurfaceStylesDeclarationFor<K extends GraphicItemKind> = [
	Extract<keyof GraphicItemOfKind<K>, GraphicSurfaceStyleSlot>,
] extends [never]
	? { surfaceStyles?: undefined }
	: { surfaceStyles: { [S in Extract<keyof GraphicItemOfKind<K>, GraphicSurfaceStyleSlot>]: GraphicDisplayDeclarationFor<K> } };

type GraphicShapeGeometryDeclarationFor<K extends GraphicItemKind> = [
	Extract<keyof GraphicItemOfKind<K>, GraphicShapeGeometrySlot>,
] extends [never]
	? { shapeGeometry?: undefined }
	: {
			shapeGeometry: GraphicDisplayDeclarationFor<K> & {
				slot: Extract<keyof GraphicItemOfKind<K>, GraphicShapeGeometrySlot>;
				bounds?: { width: NumericKeyOf<GraphicItemOfKind<K>>; height: NumericKeyOf<GraphicItemOfKind<K>> };
			};
		};

type GraphicPlayerSideDeclarationFor<K extends GraphicItemKind> = K extends GraphicPlayerSideItem['type']
	? { playerSide: true }
	: { playerSide?: undefined };

type GraphicItemDefinitionFor<K extends GraphicItemKind> = Omit<
	GraphicItemDefinition,
	'typography' | 'surfaceStyles' | 'shapeGeometry' | 'playerSide'
>
& GraphicTypographyDeclarationFor<K>
& GraphicSurfaceStylesDeclarationFor<K>
& GraphicShapeGeometryDeclarationFor<K>
& GraphicPlayerSideDeclarationFor<K>;

/**
 * What a kind's Definition must declare about typography, decided by its stored
 * configuration: a kind whose config carries typography must declare it, one whose
 * config carries a Text Overflow Policy must say so, and no other kind may. So a
 * declaration cannot drift from the schema it describes.
 */
type GraphicTypographyDeclarationFor<K extends GraphicItemKind> = K extends GraphicTypographyItem['type']
	? {
			typography: {
				textOverflowPolicy: K extends GraphicTextOverflowItem['type'] ? true : false;
				paintsText?: (item: GraphicItemOfKind<K>) => boolean;
			};
		}
	: { typography?: undefined };

export const DEFAULT_GRAPHIC_TYPOGRAPHY: GraphicTypography = {
	font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID),
	fontSize: 64,
	fontWeight: 700,
	fontStyle: 'normal',
	textTransform: 'none',
	letterSpacing: 0,
	lineHeight: 1.15,
	textAlign: 'left',
	color: '#ffffff',
};

export const DEFAULT_GRAPHIC_FILL: GraphicFill = { type: 'solid', color: '#0077a3' };

export const DEFAULT_GRAPHIC_SURFACE_STYLE: GraphicSurfaceStyle = {
	fill: { ...DEFAULT_GRAPHIC_FILL },
	fillOpacity: 1,
};

/** A fresh copy, so no two items share one nested style object. */
export function createDefaultGraphicSurfaceStyle(): GraphicSurfaceStyle {
	return { ...DEFAULT_GRAPHIC_SURFACE_STYLE, fill: { ...DEFAULT_GRAPHIC_FILL } };
}

/** A newly placed item occupies a predictable share of the host canvas. */
function defaultRect(options: GraphicItemDefaultsOptions) {
	return {
		x: Math.round(options.canvasWidth * 0.1),
		y: Math.round(options.canvasHeight * 0.1),
		width: Math.round(options.canvasWidth * 0.4),
		height: Math.round(options.canvasHeight * 0.1),
	};
}

/** A square icon sized from the shorter canvas axis. */
function defaultIconRect(options: GraphicItemDefaultsOptions) {
	const size = Math.round(Math.min(options.canvasWidth, options.canvasHeight) * 0.1);
	return {
		x: Math.round(options.canvasWidth * 0.1),
		y: Math.round(options.canvasHeight * 0.1),
		width: size,
		height: size,
	};
}

/** A Graphic Fill in one phrase, for the authoring tree's item summaries. */
export function graphicFillSummary(fill: GraphicFill): string {
	return fill.type === 'solid' ? fill.color : `gradient • ${fill.stops.length} stops`;
}

function surfaceSummary(style: GraphicSurfaceStyle | undefined): string {
	return style ? graphicFillSummary(style.fill) : 'inherited style';
}

/** Whether a Game Wins Item renders win boxes, rather than its win count as text. */
function rendersWinBoxes(item: GameWinsGraphicItemConfig): boolean {
	return item.displayMode === 'boxes';
}

/** The side a context-gated Definition reads, as an author names it. */
function playerSideLabel(side: PlayerSide): string {
	return side === 'player1' ? 'Player 1' : 'Player 2';
}

const DEFINITIONS = {
	'text': {
		kind: 'text',
		configurationVersion: 1,
		label: 'Text',
		icon: 'i-lucide-type',
		typography: { textOverflowPolicy: true },
		surfaceStyles: { surfaceStyle: {} },
		createDefault: options => ({
			type: 'text',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			text: 'Text',
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
			overflowPolicy: 'ellipsis',
			minFontSize: 24,
		}),
		summary: item => item.type === 'text' ? (item.text.trim() || 'Empty text') : 'Text',
	},
	'shape': {
		kind: 'shape',
		configurationVersion: 1,
		label: 'Shape',
		icon: 'i-lucide-square',
		surfaceStyles: { surfaceStyle: {} },
		shapeGeometry: { slot: 'geometry' },
		createDefault: options => ({
			type: 'shape',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			geometry: squareShapeGeometry(),
			surfaceStyle: createDefaultGraphicSurfaceStyle(),
		}),
		summary: item => item.type === 'shape'
			? `${surfaceSummary(item.surfaceStyle)} • ${shapeGeometrySummary(item.geometry)}`
			: 'Shape',
	},
	'media': {
		kind: 'media',
		configurationVersion: 1,
		label: 'Media',
		icon: 'i-lucide-image',
		// Clips to it only while clipping is switched on, which `clipGeometry` being
		// present already says; with none, there is nothing for the controls to shape.
		shapeGeometry: { slot: 'clipGeometry' },
		createDefault: options => ({
			type: 'media',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			// An image until an asset says otherwise: the overwhelmingly common case,
			// and the one whose video-only controls stay out of the author's way.
			mediaKind: 'image',
			// Cover fills the authored bounds, which is what an author who just placed
			// a rectangle for a picture means. Focal position then decides what
			// survives the crop, so it starts at the centre.
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			playbackRate: 1,
			loop: true,
		}),
		summary: (item) => {
			if (item.type !== 'media')
				return 'Media';
			if (!item.asset)
				return 'No Graphic Asset';
			return `${item.mediaKind === 'silent-video' ? 'silent video' : 'image'} • ${item.fit}`;
		},
	},
	'social-network-icon': {
		kind: 'social-network-icon',
		// Version 2 adds the projection-bound network source arm.
		configurationVersion: 2,
		label: 'Social Network Icon',
		icon: 'i-lucide-at-sign',
		requiredHost: 'broadcast-graphics',
		createDefault: options => ({
			type: 'social-network-icon',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultIconRect(options),
			network: 'twitch',
			color: '#ffffff',
			opacity: 1,
		}),
		summary: item => item.type === 'social-network-icon'
			? `${typeof item.network === 'string'
				? SUPPORTED_SOCIAL_NETWORK_BY_KEY[item.network].label
				: `Projection ${item.network.projectionKey}`} • ${item.color}`
			: 'Social Network Icon',
	},
	'group': {
		kind: 'group',
		configurationVersion: 1,
		label: 'Group',
		icon: 'i-lucide-group',
		surfaceStyles: { surfaceStyle: {}, defaultChildSurfaceStyle: {} },
		shapeGeometry: { slot: 'geometry' },
		createDefault: options => ({
			type: 'group',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			arrangement: 'row',
			padding: 0,
			gap: 16,
			align: 'stretch',
			justify: 'start',
			clip: false,
			geometry: squareShapeGeometry(),
			children: [],
		}),
		summary: item => item.type === 'group'
			? `${item.arrangement} • ${item.children.length} items`
			: 'Group',
	},
	'clock': {
		kind: 'clock',
		configurationVersion: 1,
		label: 'Clock',
		icon: 'i-lucide-clock',
		requiredContext: 'feature-match',
		typography: { textOverflowPolicy: true },
		surfaceStyles: { surfaceStyle: {} },
		createDefault: options => ({
			type: 'clock',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			// A clock is read at a glance from across a room and its width is stable,
			// so it starts centred and clips rather than reflowing under a shrink.
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, textAlign: 'center' },
			overflowPolicy: 'clip',
			minFontSize: 24,
		}),
		summary: () => 'Feature Match clock',
	},
	'player-life': {
		kind: 'player-life',
		configurationVersion: 1,
		label: 'Life',
		icon: 'i-lucide-heart-pulse',
		requiredContext: 'feature-match',
		typography: { textOverflowPolicy: true },
		surfaceStyles: { surfaceStyle: {} },
		playerSide: true,
		createDefault: options => ({
			type: 'player-life',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			playerSide: 'player1',
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, textAlign: 'center' },
			overflowPolicy: 'clip',
			minFontSize: 24,
			lifeAnimation: 'glow',
			lifeAnimationDurationMs: 420,
			lifeAnimationAccentColor: '#ffffff',
		}),
		summary: item => item.type === 'player-life' ? `${playerSideLabel(item.playerSide)} life` : 'Life',
	},
	'game-wins': {
		kind: 'game-wins',
		configurationVersion: 1,
		label: 'Wins',
		icon: 'i-lucide-trophy',
		requiredContext: 'feature-match',
		// Paints text only while it renders its win count, and a count cannot outgrow
		// its bounds, so no Text Overflow Policy bounds it.
		typography: { textOverflowPolicy: false, paintsText: item => item.displayMode === 'number' },
		// Its own surface frames the indicator in either display mode; the two box
		// surfaces and the box geometry are on screen only while boxes are. A box
		// geometry shapes one win box, so a preset sizes against the box.
		surfaceStyles: {
			surfaceStyle: {},
			boxSurfaceStyle: { paints: rendersWinBoxes },
			wonBoxSurfaceStyle: { paints: rendersWinBoxes },
		},
		shapeGeometry: { slot: 'boxGeometry', paints: rendersWinBoxes, bounds: { width: 'boxWidth', height: 'boxHeight' } },
		playerSide: true,
		createDefault: options => ({
			type: 'game-wins',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			playerSide: 'player1',
			displayMode: 'boxes',
			boxOrientation: 'horizontal',
			boxWidth: 22,
			boxHeight: 22,
			boxGap: 6,
			boxGeometry: roundedShapeGeometry(4),
			// An unwon box reads as an empty outline and a won one as a filled pip,
			// which is the distinction the indicator exists to make.
			boxSurfaceStyle: {
				fill: { type: 'solid', color: '#000000' },
				fillOpacity: 0,
				outline: { width: 2, color: '#ffffff' },
			},
			wonBoxSurfaceStyle: {
				fill: { type: 'solid', color: '#22c55e' },
				fillOpacity: 1,
				outline: { width: 2, color: '#ffffff' },
			},
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, textAlign: 'center' },
		}),
		summary: item => item.type === 'game-wins'
			? `${playerSideLabel(item.playerSide)} wins • ${item.displayMode}`
			: 'Wins',
	},
	'deck-list': {
		kind: 'deck-list',
		configurationVersion: 1,
		label: 'Deck List',
		icon: 'i-lucide-list',
		requiredContext: 'feature-match',
		// Paints text only in its list view; the grid renders cards. Its overflow is a
		// fixed shrink-then-clip rather than an authored Text Overflow Policy.
		typography: { textOverflowPolicy: false, paintsText: item => item.view === 'list' },
		playerSide: true,
		createDefault: options => ({
			type: 'deck-list',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			// A sideboard is up to fifteen rows, so the default bounds are a tall
			// panel rather than the one-line strip the other kinds start with.
			x: Math.round(options.canvasWidth * 0.1),
			y: Math.round(options.canvasHeight * 0.1),
			width: Math.round(options.canvasWidth * 0.2),
			height: Math.round(options.canvasHeight * 0.45),
			playerSide: 'player1',
			view: 'list',
			showQuantities: true,
			// A card name per row rather than a headline, so the default size is a
			// row's rather than the display typography the other kinds start with.
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, fontSize: 32 },
		}),
		summary: item => item.type === 'deck-list'
			? `${playerSideLabel(item.playerSide)} sideboard • ${item.view}`
			: 'Deck List',
	},
} satisfies { [K in GraphicItemKind]: GraphicItemDefinitionFor<K> };

/** Definition palette order is the shared vocabulary's own order. */
export const GRAPHIC_ITEM_KINDS = Object.keys(DEFINITIONS) as readonly GraphicItemKind[];

/** The kinds a Graphic Group may contain: every base kind except another group. */
export const GRAPHIC_GROUP_CHILD_KINDS = GRAPHIC_ITEM_KINDS.filter(kind => kind !== 'group');

export function getGraphicItemDefinition(kind: GraphicItemKind): GraphicItemDefinition {
	// Each entry's `paintsText` and `paints` take only its own kind, which the wide
	// Definition cannot say; each is only ever called with an item of the kind it was
	// looked up by.
	return DEFINITIONS[kind] as GraphicItemDefinition;
}

/** A Definition is offered only where its required context can be supplied. */
export function isGraphicItemDefinitionAvailable(
	definition: GraphicItemDefinition,
	contract: GraphicsHostContract,
): boolean {
	return (definition.requiredHost === undefined || definition.requiredHost === contract.hostId)
		&& (definition.requiredContext === undefined
			|| contract.contextKinds.includes(definition.requiredContext));
}

export function graphicItemDefinitionsForHost(contract: GraphicsHostContract): readonly GraphicItemDefinition[] {
	return GRAPHIC_ITEM_KINDS
		.map(getGraphicItemDefinition)
		.filter(definition => isGraphicItemDefinitionAvailable(definition, contract));
}

/** The Definitions a Graphic Group may offer: never another Graphic Group. */
export function graphicGroupChildDefinitionsForHost(
	contract: GraphicsHostContract,
): readonly GraphicItemDefinition[] {
	return graphicItemDefinitionsForHost(contract).filter(definition => definition.kind !== 'group');
}

/**
 * Whether this item owns base typography: what the Graphic Style Set typography slot
 * and `patchGraphicTypography` accept. Read from the item's kind, not its fields.
 */
export function ownsGraphicTypography(item: GraphicItemConfig): item is GraphicTypographyItem {
	return getGraphicItemDefinition(item.type).typography !== undefined;
}

/** Whether a Text Overflow Policy bounds this item's text: what `patchGraphicTextOverflow` accepts. */
export function ownsTextOverflowPolicy(item: GraphicItemConfig): item is GraphicTextOverflowItem {
	return getGraphicItemDefinition(item.type).typography?.textOverflowPolicy === true;
}

/**
 * The base typography this item paints text with as it is displayed now, or null when
 * it paints none: where the Inspector offers typography controls.
 */
export function paintedGraphicTypography(item: GraphicItemConfig): GraphicTypography | null {
	const declaration = getGraphicItemDefinition(item.type).typography;
	if (!declaration || !ownsGraphicTypography(item))
		return null;
	return declaration.paintsText === undefined || declaration.paintsText(item) ? item.typography : null;
}

function isPainted(declaration: GraphicDisplayDeclaration, item: GraphicItemConfig): boolean {
	return declaration.paints === undefined || declaration.paints(item);
}

/**
 * Whether this item keeps a Graphic Surface Style in this slot: what the Graphic
 * Style Set surface slots and the surface authoring operations accept. Read from the
 * item's kind, not its fields, since an owned surface may be absent until authored.
 */
export function ownsGraphicSurfaceStyle<S extends GraphicSurfaceStyleSlot>(
	item: GraphicItemConfig,
	slot: S,
): item is GraphicSurfaceStyleItem<S> {
	return getGraphicItemDefinition(item.type).surfaceStyles?.[slot] !== undefined;
}

/** The Graphic Surface Style this item holds in one slot, or undefined where it owns none or holds none yet. */
export function graphicSurfaceStyleAt(
	item: GraphicItemConfig,
	slot: GraphicSurfaceStyleSlot,
): GraphicSurfaceStyle | undefined {
	return ownsGraphicSurfaceStyle(item, slot)
		? (item as Partial<Record<GraphicSurfaceStyleSlot, GraphicSurfaceStyle>>)[slot]
		: undefined;
}

/**
 * The Graphic Surface Styles this item has on screen as it is displayed now, keyed
 * by slot, each null where the item holds none of its own yet: where the Inspector
 * offers surface controls.
 */
export function paintedGraphicSurfaceStyles(
	item: GraphicItemConfig,
): Partial<Record<GraphicSurfaceStyleSlot, GraphicSurfaceStyle | null>> {
	const declarations = getGraphicItemDefinition(item.type).surfaceStyles ?? {};
	const painted: Partial<Record<GraphicSurfaceStyleSlot, GraphicSurfaceStyle | null>> = {};
	for (const [slot, declaration] of Object.entries(declarations) as [GraphicSurfaceStyleSlot, GraphicDisplayDeclaration][]) {
		if (isPainted(declaration, item))
			painted[slot] = graphicSurfaceStyleAt(item, slot) ?? null;
	}
	return painted;
}

/**
 * Where one item keeps the Shape Geometry a geometry edit means, and what it holds
 * there now.
 */
export interface OwnedShapeGeometry {
	slot: GraphicShapeGeometrySlot;
	geometry: ShapeGeometry;
	/**
	 * The bounds the geometry is drawn inside. Usually the item's own rectangle — but
	 * a Game Wins Item's geometry shapes one win box, so a preset sized against the
	 * whole indicator would be sized against the wrong thing.
	 */
	bounds: { width: number; height: number };
	/** Where a preset that proposes a height writes it. */
	heightField: string;
}

/** Whether this item's Definition declares a Shape Geometry: what the geometry authoring operations accept. */
export function ownsShapeGeometry(item: GraphicItemConfig): item is GraphicShapeGeometryItem {
	return getGraphicItemDefinition(item.type).shapeGeometry !== undefined;
}

/**
 * The Shape Geometry this item keeps, or null where it owns none or holds none now.
 * A Media Graphic Item's is optional, and absent means it clips to nothing but its
 * bounds — so a geometry edit aimed at one that is not clipping resolves to nothing,
 * rather than switching clipping on as a side effect of nudging a corner.
 */
export function graphicShapeGeometry(item: GraphicItemConfig): OwnedShapeGeometry | null {
	const declaration = getGraphicItemDefinition(item.type).shapeGeometry;
	if (!declaration)
		return null;
	const fields = item as unknown as Record<string, unknown>;
	const geometry = fields[declaration.slot] as ShapeGeometry | undefined;
	if (!geometry)
		return null;
	const width = declaration.bounds?.width ?? 'width';
	const height = declaration.bounds?.height ?? 'height';
	return {
		slot: declaration.slot,
		geometry,
		bounds: { width: fields[width] as number, height: fields[height] as number },
		heightField: height,
	};
}

/** The Shape Geometry this item has on screen as it is displayed now: where the Inspector offers geometry controls. */
export function paintedShapeGeometry(item: GraphicItemConfig): OwnedShapeGeometry | null {
	const declaration = getGraphicItemDefinition(item.type).shapeGeometry;
	return declaration && isPainted(declaration, item) ? graphicShapeGeometry(item) : null;
}

/** Whether this item reads one player side's live state: where the Inspector offers the Player, and what authoring accepts. */
export function ownsPlayerSide(item: GraphicItemConfig): item is GraphicPlayerSideItem {
	return getGraphicItemDefinition(item.type).playerSide === true;
}

export function graphicItemSummary(item: GraphicItemConfig): string {
	return getGraphicItemDefinition(item.type).summary(item);
}

export function graphicItemIcon(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).icon;
}

export function graphicItemKindLabel(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).label;
}

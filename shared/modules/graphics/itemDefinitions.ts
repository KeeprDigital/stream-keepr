import type { PlayerSide } from '../../types/enums';
import type {
	GraphicFill,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicSurfaceStyle,
	GraphicTypography,
} from '../../types/graphics';
import type { GraphicsContextKind, GraphicsHostContract, GraphicsHostId } from './hostContract';
import { SUPPORTED_SOCIAL_NETWORK_BY_KEY } from '../../socialProfiles';
import { applicationGraphicFont } from '../../types/graphics';
import { roundedShapeGeometry, shapeGeometrySummary, squareShapeGeometry } from './shapeGeometry';
import { DEFAULT_GRAPHIC_FONT_ID } from './typography';

/**
 * Graphic Item Definitions: the application-owned contract for each Graphic
 * Item kind — stable identifier, configuration version, editor metadata,
 * defaults, and summary.
 *
 * Adding a kind means one entry here plus a branch in the compositor renderer;
 * nothing else enumerates kinds. Templates never provide executable Definitions.
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
}

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
		configurationVersion: 1,
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
			? `${SUPPORTED_SOCIAL_NETWORK_BY_KEY[item.network].label} • ${item.color}`
			: 'Social Network Icon',
	},
	'group': {
		kind: 'group',
		configurationVersion: 1,
		label: 'Group',
		icon: 'i-lucide-group',
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
} satisfies Record<GraphicItemKind, GraphicItemDefinition>;

/** Definition palette order is the shared vocabulary's own order. */
export const GRAPHIC_ITEM_KINDS = Object.keys(DEFINITIONS) as readonly GraphicItemKind[];

/** The kinds a Graphic Group may contain: every base kind except another group. */
export const GRAPHIC_GROUP_CHILD_KINDS = GRAPHIC_ITEM_KINDS.filter(kind => kind !== 'group');

export function getGraphicItemDefinition(kind: GraphicItemKind): GraphicItemDefinition {
	return DEFINITIONS[kind];
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

export function graphicItemSummary(item: GraphicItemConfig): string {
	return getGraphicItemDefinition(item.type).summary(item);
}

export function graphicItemIcon(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).icon;
}

export function graphicItemKindLabel(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).label;
}

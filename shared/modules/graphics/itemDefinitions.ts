import type {
	GraphicFill,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicSurfaceStyle,
	GraphicTypography,
} from '../../types/graphics';
import type { GraphicsContextKind, GraphicsHostContract } from './hostContract';
import { shapeGeometrySummary, squareShapeGeometry } from './shapeGeometry';

/**
 * Graphic Item Definitions: the application-owned contract for each Graphic
 * Item kind — stable identifier, editor metadata, defaults, and summary. A
 * configuration version joins it when something reads one, which is the
 * Template Package validation work rather than this ticket.
 *
 * Adding a kind means one entry here plus a branch in the compositor renderer;
 * nothing else enumerates kinds. Templates never provide executable Definitions.
 */

export interface GraphicItemDefaultsOptions {
	id: string;
	label: string;
	canvasWidth: number;
	canvasHeight: number;
}

export interface GraphicItemDefinition {
	kind: GraphicItemKind;
	label: string;
	icon: string;
	/** A context the host must declare before the definition palette offers this kind. */
	requiredContext?: GraphicsContextKind;
	createDefault: (options: GraphicItemDefaultsOptions) => GraphicItemConfig;
	summary: (item: GraphicItemConfig) => string;
}

export const DEFAULT_GRAPHIC_TYPOGRAPHY: GraphicTypography = {
	fontId: 'inter',
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
	return { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 1 };
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

/** A Graphic Fill in one phrase, for the authoring tree's item summaries. */
export function graphicFillSummary(fill: GraphicFill): string {
	return fill.type === 'solid' ? fill.color : `gradient • ${fill.stops.length} stops`;
}

function surfaceSummary(style: GraphicSurfaceStyle | undefined): string {
	return style ? graphicFillSummary(style.fill) : 'inherited style';
}

const DEFINITIONS = {
	text: {
		kind: 'text',
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
	shape: {
		kind: 'shape',
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
	group: {
		kind: 'group',
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
	return definition.requiredContext === undefined
		|| contract.contextKinds.includes(definition.requiredContext);
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

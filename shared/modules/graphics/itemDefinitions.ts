import type {
	GraphicItemConfig,
	GraphicItemKind,
	GraphicSurfaceStyle,
	GraphicTypography,
} from '../../types/graphics';
import type { GraphicsContextKind, GraphicsHostContract } from './hostContract';

/**
 * Graphic Item Definitions: the application-owned contract for each Graphic
 * Item kind — stable identifier, configuration version, editor metadata,
 * defaults, and summary. Adding a kind means one entry here plus a branch in
 * the compositor renderer; nothing else enumerates kinds. Templates never
 * provide executable Definitions.
 */

export interface GraphicItemDefaultsOptions {
	id: string;
	label: string;
	canvasWidth: number;
	canvasHeight: number;
}

export interface GraphicItemDefinition {
	kind: GraphicItemKind;
	/** Bumped when this kind's stored configuration shape changes. */
	configVersion: number;
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

export const DEFAULT_GRAPHIC_SURFACE_STYLE: GraphicSurfaceStyle = {
	fill: '#0077a3',
	fillOpacity: 1,
};

/** A newly placed item occupies a predictable share of the host canvas. */
function defaultRect(options: GraphicItemDefaultsOptions) {
	return {
		x: Math.round(options.canvasWidth * 0.1),
		y: Math.round(options.canvasHeight * 0.1),
		width: Math.round(options.canvasWidth * 0.4),
		height: Math.round(options.canvasHeight * 0.1),
	};
}

const DEFINITIONS = {
	text: {
		kind: 'text',
		configVersion: 1,
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
		configVersion: 1,
		label: 'Shape',
		icon: 'i-lucide-square',
		createDefault: options => ({
			type: 'shape',
			id: options.id,
			label: options.label,
			visible: true,
			anchor: 'top-left',
			...defaultRect(options),
			geometry: { cornerRadius: 0 },
			surfaceStyle: { ...DEFAULT_GRAPHIC_SURFACE_STYLE },
		}),
		summary: item => item.type === 'shape'
			? `${item.surfaceStyle.fill}${item.geometry.cornerRadius > 0 ? ` • radius ${item.geometry.cornerRadius}` : ''}`
			: 'Shape',
	},
} satisfies Record<GraphicItemKind, GraphicItemDefinition>;

/** Definition palette order is the shared vocabulary's own order. */
export const GRAPHIC_ITEM_KINDS = Object.keys(DEFINITIONS) as readonly GraphicItemKind[];

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

export function graphicItemSummary(item: GraphicItemConfig): string {
	return getGraphicItemDefinition(item.type).summary(item);
}

export function graphicItemIcon(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).icon;
}

export function graphicItemKindLabel(kind: GraphicItemKind): string {
	return getGraphicItemDefinition(kind).label;
}

import type { PlayerSide } from './types/enums';
import type {
	ClockGraphicItemConfig,
	GameWinsGraphicItemConfig,
	GraphicFill,
	GraphicFillStop,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicSurfaceStyle,
	GraphicTypography,
	MediaGraphicItemConfig,
	PlayerLifeGraphicItemConfig,
	ShapeGraphicItemConfig,
	TextGraphicItemConfig,
} from './types/graphics';
import { DEFAULT_GRAPHIC_TYPOGRAPHY } from './modules/graphics/itemDefinitions';
import { roundedShapeGeometry, squareShapeGeometry } from './modules/graphics/shapeGeometry';

/**
 * Constructors for the built-in Feature Match Layouts.
 *
 * A Feature Match Overlay Preset is now an authored composition in the Shared
 * Graphics Foundation vocabulary rather than a legacy widget list, and that
 * vocabulary is deliberately explicit: a Text Graphic Item carries a whole
 * `GraphicTypography`, a painted surface carries a whole `GraphicSurfaceStyle`,
 * and a Shape Graphic Item carries a whole `ShapeGeometry`. Written out three
 * times over, the presets would be unreadable as designs.
 *
 * These are constructors, not a second vocabulary: every one returns an ordinary
 * `GraphicItemConfig` with every field the schema requires, and nothing reads a
 * preset back through them.
 */

export interface FeatureMatchLayoutItemPlacement {
	id: string;
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
	visible?: boolean;
}

function placed(item: FeatureMatchLayoutItemPlacement) {
	return {
		id: item.id,
		label: item.label,
		visible: item.visible ?? true,
		anchor: 'top-left' as const,
		x: item.x,
		y: item.y,
		width: item.width,
		height: item.height,
	};
}

export function solidFill(color: string): GraphicFill {
	return { type: 'solid', color };
}

/**
 * A linear-gradient Graphic Fill.
 *
 * Two to four stops, which is the settled bound of the shared vocabulary. A
 * legacy CSS gradient string could carry any number; a preset that used more is
 * recreated at the bound rather than the vocabulary being widened for it.
 */
export function gradientFill(angle: number, stops: GraphicFillStop[]): GraphicFill {
	return { type: 'linear-gradient', angle, stops };
}

export function fillStop(color: string, position: number, opacity = 1): GraphicFillStop {
	return { color, position, opacity };
}

export function surfaceStyle(
	fill: GraphicFill,
	extras: Partial<Omit<GraphicSurfaceStyle, 'fill'>> = {},
): GraphicSurfaceStyle {
	return { fill, fillOpacity: extras.fillOpacity ?? 1, ...(extras.outline ? { outline: extras.outline } : {}), ...(extras.glow ? { glow: extras.glow } : {}) };
}

export function typography(overrides: Partial<GraphicTypography> = {}): GraphicTypography {
	return { ...DEFAULT_GRAPHIC_TYPOGRAPHY, ...overrides };
}

export function textItem(
	item: FeatureMatchLayoutItemPlacement & {
		text: string;
		typography: GraphicTypography;
		overflowPolicy?: TextGraphicItemConfig['overflowPolicy'];
		minFontSize?: number;
		surfaceStyle?: GraphicSurfaceStyle;
	},
): TextGraphicItemConfig {
	return {
		type: 'text',
		...placed(item),
		text: item.text,
		typography: item.typography,
		overflowPolicy: item.overflowPolicy ?? 'ellipsis',
		minFontSize: item.minFontSize ?? 16,
		...(item.surfaceStyle ? { surfaceStyle: item.surfaceStyle } : {}),
	};
}

export function shapeItem(
	item: FeatureMatchLayoutItemPlacement & {
		surfaceStyle: GraphicSurfaceStyle;
		geometry?: ShapeGraphicItemConfig['geometry'];
	},
): ShapeGraphicItemConfig {
	return {
		type: 'shape',
		...placed(item),
		geometry: item.geometry ?? squareShapeGeometry(),
		surfaceStyle: item.surfaceStyle,
	};
}

export function mediaItem(
	item: FeatureMatchLayoutItemPlacement & {
		mediaKind?: MediaGraphicItemConfig['mediaKind'];
		fit?: MediaGraphicItemConfig['fit'];
		opacity?: number;
	},
): MediaGraphicItemConfig {
	return {
		type: 'media',
		...placed(item),
		mediaKind: item.mediaKind ?? 'image',
		fit: item.fit ?? 'contain',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: item.opacity ?? 1,
		playbackRate: 1,
		loop: true,
	};
}

export function clockItem(
	item: FeatureMatchLayoutItemPlacement & {
		typography: GraphicTypography;
		surfaceStyle?: GraphicSurfaceStyle;
	},
): ClockGraphicItemConfig {
	return {
		type: 'clock',
		...placed(item),
		typography: item.typography,
		overflowPolicy: 'clip',
		minFontSize: 16,
		...(item.surfaceStyle ? { surfaceStyle: item.surfaceStyle } : {}),
	};
}

export function playerLifeItem(
	item: FeatureMatchLayoutItemPlacement & {
		playerSide: PlayerSide;
		typography: GraphicTypography;
		surfaceStyle?: GraphicSurfaceStyle;
		accentColor?: string;
	},
): PlayerLifeGraphicItemConfig {
	return {
		type: 'player-life',
		...placed(item),
		playerSide: item.playerSide,
		typography: item.typography,
		overflowPolicy: 'clip',
		minFontSize: 16,
		lifeAnimation: 'glow',
		lifeAnimationDurationMs: 420,
		lifeAnimationAccentColor: item.accentColor ?? '#ffffff',
		...(item.surfaceStyle ? { surfaceStyle: item.surfaceStyle } : {}),
	};
}

export function gameWinsItem(
	item: FeatureMatchLayoutItemPlacement & {
		playerSide: PlayerSide;
		boxWidth: number;
		boxHeight: number;
		boxGap: number;
		outlineWidth: number;
		outlineColor: string;
		wonColor: string;
		boxRadius?: number;
	},
): GameWinsGraphicItemConfig {
	const outline = { width: item.outlineWidth, color: item.outlineColor };
	return {
		type: 'game-wins',
		...placed(item),
		playerSide: item.playerSide,
		displayMode: 'boxes',
		boxOrientation: 'horizontal',
		boxWidth: item.boxWidth,
		boxHeight: item.boxHeight,
		boxGap: item.boxGap,
		boxGeometry: item.boxRadius ? roundedShapeGeometry(item.boxRadius) : squareShapeGeometry(),
		boxSurfaceStyle: { fill: solidFill('#000000'), fillOpacity: 0, outline },
		wonBoxSurfaceStyle: { fill: solidFill(item.wonColor), fillOpacity: 1, outline },
		typography: typography({ textAlign: 'center' }),
	};
}

export function groupItem(
	item: FeatureMatchLayoutItemPlacement & {
		children: GraphicGroupChildConfig[];
		surfaceStyle?: GraphicSurfaceStyle;
		clip?: boolean;
	},
): GraphicGroupItemConfig {
	return {
		type: 'group',
		...placed(item),
		arrangement: 'canvas',
		padding: 0,
		gap: 0,
		align: 'stretch',
		justify: 'start',
		clip: item.clip ?? true,
		geometry: squareShapeGeometry(),
		...(item.surfaceStyle ? { surfaceStyle: item.surfaceStyle } : {}),
		children: item.children,
	};
}

export type FeatureMatchLayoutEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * One edge of a rectangle as a Shape Graphic Item created from the rule preset.
 *
 * This is the replacement for the legacy per-side border flags, and the reason
 * they were dropped rather than carried: a Graphic Surface Style has one uniform
 * outline, and an edge that exists on its own can be styled, ordered, and
 * animated independently of the surface it sits against.
 */
export function edgeRuleItem(
	item: {
		id: string;
		label: string;
		edge: FeatureMatchLayoutEdge;
		bounds: { x: number; y: number; width: number; height: number };
		thickness: number;
		surfaceStyle: GraphicSurfaceStyle;
	},
): ShapeGraphicItemConfig {
	const { bounds, thickness, edge } = item;
	const rect = edge === 'top'
		? { x: bounds.x, y: bounds.y, width: bounds.width, height: thickness }
		: edge === 'bottom'
			? { x: bounds.x, y: bounds.y + bounds.height - thickness, width: bounds.width, height: thickness }
			: edge === 'left'
				? { x: bounds.x, y: bounds.y, width: thickness, height: bounds.height }
				: { x: bounds.x + bounds.width - thickness, y: bounds.y, width: thickness, height: bounds.height };

	return shapeItem({ id: item.id, label: item.label, ...rect, surfaceStyle: item.surfaceStyle });
}

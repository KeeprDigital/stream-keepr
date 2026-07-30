import type { CSSProperties } from 'vue';
import type {
	BroadcastGraphicConfig,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicRect,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { GraphicsSelectionTarget } from './selection';
import { resolveGraphicFontFamily } from '~~/shared/modules/graphics';
import { screenOutputCanvasBackground } from '~~/shared/utils/screenOutput';
import { graphicsSelectionKey } from './selection';

/**
 * Shared compositor render-model seam.
 *
 * One composition of Broadcast Graphics in, one Screen Output render model out.
 * Pure: no Vue, no DOM, no host data access — the Screen Output components and
 * the editor preview render the same descriptors from the same inputs, so the
 * Overlay, Fill, and Key Outputs always resolve one composed frame.
 *
 * Advisory preview guides are part of this model only because the editor asks
 * for them explicitly. A live Screen Output never asks, so guides can never
 * reach an output, and they never enter an item's own geometry or clipping.
 *
 * ## The Key Output is a true alpha matte, by construction
 *
 * Every element paints pure white at its own alpha over a black backdrop. The
 * browser's own source-over compositing then accumulates the matte for free:
 * over a black backdrop, two elements leave a luminance of
 * `a2 + a1 * (1 - a2)`, which is exactly the alpha union
 * `1 - (1 - a1) * (1 - a2)`. Two overlapping half-opaque items composite to
 * 0.75 grey, and their true combined alpha is 0.75. That identity holds to any
 * depth of overlap, so no separate compositing pass is needed or wanted.
 *
 * The identity is not free of preconditions, and these are a contract every
 * later addition to the vocabulary has to honour:
 *
 * - The Key backdrop must stay black (`screenOutputCanvasBackground`).
 * - Every painted element must be pure white at its own alpha. A gradient is
 *   fine — white with varying alpha still accumulates correctly — and group or
 *   element opacity is fine, because it multiplies through. A glow, shadow, or
 *   outline that keeps its authored colour silently breaks the matte, so each
 *   must resolve to white in the Key Output too.
 * - Nothing may use `mix-blend-mode` or a filter that is not plain source-over.
 * - A Media Graphic Item must not paint its own colours into the Key Output; it
 *   contributes its alpha as white.
 */

/** Advisory action-safe guides sit at a five-percent inset, title-safe at ten percent. */
export const GRAPHICS_ACTION_SAFE_INSET = 0.05;
export const GRAPHICS_TITLE_SAFE_INSET = 0.1;

export interface GraphicsCompositionRenderModelInput {
	output: ScreenOutput;
	canvasWidth: number;
	canvasHeight: number;
	/** The Screen's authored back-to-front stack of Broadcast Graphics. */
	graphics: readonly BroadcastGraphicConfig[];
	/**
	 * Which Broadcast Graphics compose into this frame. Omitted composes the
	 * whole stack; the composed order is always the authored stack order.
	 */
	visibleGraphicIds?: readonly string[];
	/** Editor-only selection and item guides. */
	itemGuides?: boolean;
	/** Editor-only advisory action-safe and title-safe guides. */
	safeAreaGuides?: boolean;
	selectedTarget?: GraphicsSelectionTarget;
}

/** The measurement bounds a `shrink` Text Overflow Policy fits text between. */
export interface GraphicTextShrinkBounds {
	minFontSize: number;
	maxFontSize: number;
}

export interface GraphicItemRenderDescriptor {
	id: string;
	label: string;
	kind: GraphicItemKind;
	/** The item's authored bounds, clipped so nothing renders outside them. */
	style: CSSProperties;
	/** Typography and Text Overflow Policy clamping. Present for Text Graphic Items. */
	textStyle?: CSSProperties;
	/** Present for Text Graphic Items. */
	text?: string;
	shrink?: GraphicTextShrinkBounds;
}

export interface BroadcastGraphicRenderDescriptor {
	id: string;
	name: string;
	items: GraphicItemRenderDescriptor[];
}

export type GraphicsSafeAreaGuideId = 'action-safe' | 'title-safe';

export interface GraphicsSafeAreaGuide {
	id: GraphicsSafeAreaGuideId;
	label: string;
	style: CSSProperties;
}

export interface GraphicsItemGuide {
	graphicId: string;
	itemId: string;
	label: string;
	selected: boolean;
	style: CSSProperties;
}

export interface GraphicsCompositionRenderModel {
	output: ScreenOutput;
	canvasStyle: CSSProperties;
	graphics: BroadcastGraphicRenderDescriptor[];
	safeAreaGuides: GraphicsSafeAreaGuide[];
	itemGuides: GraphicsItemGuide[];
}

function rectStyle(rect: GraphicRect): CSSProperties {
	return {
		left: `${rect.x}px`,
		top: `${rect.y}px`,
		width: `${rect.width}px`,
		height: `${rect.height}px`,
	};
}

function clampOpacity(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

/**
 * A Key Output renders composed opacity as a grayscale alpha matte, so every
 * fill becomes pure white at its own alpha rather than its authored colour.
 * Compositing those over the black Key backdrop yields the matte itself — see
 * the module docblock for the identity and its preconditions.
 */
function fillColour(output: ScreenOutput, colour: string, opacity: number): string {
	const alpha = clampOpacity(opacity);

	if (output === 'key')
		return `#ffffff${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
	if (alpha <= 0)
		return 'transparent';

	const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(colour.trim());
	if (alpha >= 1 || !match)
		return colour;

	const [, r, g, b] = match;
	return `rgba(${Number.parseInt(r!, 16)}, ${Number.parseInt(g!, 16)}, ${Number.parseInt(b!, 16)}, ${alpha})`;
}

/**
 * How many whole lines of text fit inside authored bounds. An `ellipsis` or
 * `shrink` Text Overflow Policy clamps to this many lines, so the last visible
 * line ends in an ellipsis instead of overflowing.
 */
export function graphicTextClampLines(height: number, fontSize: number, lineHeight: number): number {
	const lineBox = fontSize * lineHeight;
	if (!Number.isFinite(lineBox) || lineBox <= 0)
		return 1;
	return Math.max(1, Math.floor(height / lineBox));
}

/**
 * Typography plus the Text Overflow Policy's clipping. No policy renders
 * visible overflow beyond the item's authored bounds: `clip` cuts the
 * overflowing text off, while `ellipsis` and `shrink` clamp to whole lines and
 * end the last one with an ellipsis.
 */
export function graphicTextStyle(
	output: ScreenOutput,
	item: TextGraphicItemConfig,
	fontSize = item.typography.fontSize,
): CSSProperties {
	const typography = item.typography;
	const base: CSSProperties = {
		margin: 0,
		width: '100%',
		color: output === 'key' ? '#ffffff' : typography.color,
		fontFamily: resolveGraphicFontFamily(typography.fontId),
		fontSize: `${fontSize}px`,
		fontWeight: typography.fontWeight,
		fontStyle: typography.fontStyle,
		textTransform: typography.textTransform,
		letterSpacing: `${typography.letterSpacing}px`,
		lineHeight: typography.lineHeight,
		textAlign: typography.textAlign,
		whiteSpace: 'pre-wrap',
		overflowWrap: 'break-word',
		overflow: 'hidden',
	};

	if (item.overflowPolicy === 'clip')
		return { ...base, textOverflow: 'clip' };

	return {
		...base,
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: graphicTextClampLines(item.height, fontSize, typography.lineHeight),
		textOverflow: 'ellipsis',
	};
}

function textItemStyle(item: TextGraphicItemConfig): CSSProperties {
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'center',
		overflow: 'hidden',
	};
}

function shapeItemStyle(output: ScreenOutput, item: Extract<GraphicItemConfig, { type: 'shape' }>): CSSProperties {
	return {
		...rectStyle(item),
		position: 'absolute',
		boxSizing: 'border-box',
		background: fillColour(output, item.surfaceStyle.fill, item.surfaceStyle.fillOpacity),
		borderRadius: `${Math.max(0, item.geometry.cornerRadius)}px`,
	};
}

function itemDescriptor(output: ScreenOutput, item: GraphicItemConfig): GraphicItemRenderDescriptor {
	if (item.type === 'text') {
		return {
			id: item.id,
			label: item.label,
			kind: 'text',
			style: textItemStyle(item),
			textStyle: graphicTextStyle(output, item),
			text: item.text,
			shrink: item.overflowPolicy === 'shrink'
				? { minFontSize: item.minFontSize, maxFontSize: item.typography.fontSize }
				: undefined,
		};
	}

	return {
		id: item.id,
		label: item.label,
		kind: 'shape',
		style: shapeItemStyle(output, item),
	};
}

function safeAreaGuide(
	id: GraphicsSafeAreaGuideId,
	label: string,
	inset: number,
	canvasWidth: number,
	canvasHeight: number,
): GraphicsSafeAreaGuide {
	const insetX = Math.round(canvasWidth * inset);
	const insetY = Math.round(canvasHeight * inset);

	return {
		id,
		label,
		style: rectStyle({
			x: insetX,
			y: insetY,
			width: Math.max(0, canvasWidth - (insetX * 2)),
			height: Math.max(0, canvasHeight - (insetY * 2)),
		}),
	};
}

export function resolveGraphicsCompositionRenderModel(
	input: GraphicsCompositionRenderModelInput,
): GraphicsCompositionRenderModel {
	const visible = input.visibleGraphicIds;
	const composed = visible
		? input.graphics.filter(graphic => visible.includes(graphic.id))
		: [...input.graphics];
	const selectedKey = input.selectedTarget ? graphicsSelectionKey(input.selectedTarget) : null;

	return {
		output: input.output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: screenOutputCanvasBackground(input.output),
		},
		graphics: composed.map(graphic => ({
			id: graphic.id,
			name: graphic.name,
			items: graphic.items
				.filter(item => item.visible)
				.map(item => itemDescriptor(input.output, item)),
		})),
		safeAreaGuides: input.safeAreaGuides
			? [
					safeAreaGuide('action-safe', 'Action safe', GRAPHICS_ACTION_SAFE_INSET, input.canvasWidth, input.canvasHeight),
					safeAreaGuide('title-safe', 'Title safe', GRAPHICS_TITLE_SAFE_INSET, input.canvasWidth, input.canvasHeight),
				]
			: [],
		itemGuides: input.itemGuides
			? composed.flatMap(graphic => graphic.items.map(item => ({
					graphicId: graphic.id,
					itemId: item.id,
					label: item.label,
					selected: selectedKey === graphicsSelectionKey({ type: 'item', graphicId: graphic.id, itemId: item.id }),
					style: rectStyle(item),
				})))
			: [],
	};
}

import type { CSSProperties } from 'vue';
import type { PlayerSide } from '~~/shared/types/enums';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	FeatureMatchGameWinsWidgetConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchOverlayRect,
	FeatureMatchOverlayTokenStyleMap,
	FeatureMatchSourceItemConfig,
	FeatureMatchWidgetConfig,
	FeatureMatchWidgetGroupChildConfig,
	FeatureMatchWidgetGroupItemConfig,
	FeatureMatchWidgetItemConfig,
} from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlayTemplateMetadataInput } from '~/utils/featureMatchOverlayTemplateValues';
import { resolveFeatureMatchOverlayFontFamily } from '~~/shared/featureMatchOverlayFonts';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { graphicAssetRevisionContentPath } from '~~/shared/utils/graphicsAssetReferences';
import { featureMatchOverlayBorderRadiusCss, featureMatchOverlaySourceCutoutRect, roundedRectPath } from '~/utils/featureMatchOverlayGeometry';
import { buildFeatureMatchOverlayTemplateMetadataValues } from '~/utils/featureMatchOverlayTemplateValues';
import { renderFeatureMatchOverlayTemplateLines } from '~/utils/featureMatchOverlayTokens';

type FeatureMatchOverlayBorderSide = 'Top' | 'Right' | 'Bottom' | 'Left';

const FEATURE_MATCH_OVERLAY_BORDER_SIDES: FeatureMatchOverlayBorderSide[] = ['Top', 'Right', 'Bottom', 'Left'];

interface FeatureMatchOverlayPlayerData {
	name?: string | null;
	pronouns?: string | null;
	wins?: number | null;
	losses?: number | null;
	draws?: number | null;
	lgs?: string | null;
	gameData?: unknown;
}

interface FeatureMatchOverlayFeatureMatchData extends NonNullable<FeatureMatchOverlayTemplateMetadataInput['featureMatch']> {
	player1Data?: FeatureMatchOverlayPlayerData | null;
	player2Data?: FeatureMatchOverlayPlayerData | null;
	bestOf?: number | null;
	activeSession?: (NonNullable<FeatureMatchOverlayTemplateMetadataInput['featureMatch']>['activeSession'] & { sourceSnapshot?: { bestOf?: number | null } | null }) | null;
}

interface FeatureMatchOverlayMatchStateData {
	player1?: { lifeTotal?: number | null; gameWins?: number | null } | null;
	player2?: { lifeTotal?: number | null; gameWins?: number | null } | null;
}

export interface FeatureMatchOverlayRenderModelInput {
	config: FeatureMatchOverlayModeConfig;
	output: FeatureMatchOverlayOutput;
	canvasWidth: number;
	canvasHeight: number;
	displayTime: string;
	event?: FeatureMatchOverlayTemplateMetadataInput['event'];
	featureMatch?: FeatureMatchOverlayFeatureMatchData | null;
	sourceMatch?: FeatureMatchOverlayTemplateMetadataInput['sourceMatch'];
	round?: FeatureMatchOverlayTemplateMetadataInput['round'];
	phase?: FeatureMatchOverlayTemplateMetadataInput['phase'];
	matchState?: FeatureMatchOverlayMatchStateData | null;
	graphicAssetContentPath?: (reference: GraphicAssetReference) => string;
}

export interface FeatureMatchOverlayFrameRenderModel {
	maskId: string;
	imageStyle: CSSProperties;
	imagePreserveAspectRatio: string;
	fill: string;
	opacity: number;
}

export interface FeatureMatchOverlaySourceItemRenderModel {
	item: FeatureMatchSourceItemConfig;
	style: CSSProperties;
	cutoutPath: string | null;
}

/**
 * Fully-resolved render content for one Feature Match Overlay Widget. The
 * renderer component dispatches on `type` and needs no access to the render
 * model, match data, or style helpers — everything it draws is here.
 */
export type FeatureMatchOverlayWidgetRender
	= | { type: 'text'; lines: ReturnType<typeof renderFeatureMatchOverlayTemplateLines>; deckColors: string }
		| { type: 'image'; src: string; alt: string; imageStyle: CSSProperties }
		| { type: 'clock'; displayTime: string }
		| {
			type: 'player-life';
			lifeTotal: number | null | undefined;
			animation: Extract<FeatureMatchWidgetConfig, { type: 'player-life' }>['lifeAnimation'];
			durationMs: Extract<FeatureMatchWidgetConfig, { type: 'player-life' }>['lifeAnimationDurationMs'];
			accentColor: Extract<FeatureMatchWidgetConfig, { type: 'player-life' }>['lifeAnimationAccentColor'];
		}
		| {
			type: 'game-wins';
			boxes: boolean[];
			wins: number;
			displayMode: NonNullable<FeatureMatchGameWinsWidgetConfig['displayMode']>;
			containerStyle: CSSProperties;
			boxStyles: { won: Record<string, string | number | undefined>; lost: Record<string, string | number | undefined> };
		};

export interface FeatureMatchOverlayWidgetRenderDescriptor {
	id: string;
	label: string;
	widget: FeatureMatchWidgetConfig;
	style: CSSProperties;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
	render: FeatureMatchOverlayWidgetRender;
}

export interface FeatureMatchOverlayWidgetItemRenderModel extends FeatureMatchOverlayWidgetRenderDescriptor {
	item: FeatureMatchWidgetItemConfig;
}

export interface FeatureMatchOverlayWidgetGroupChildRenderModel extends FeatureMatchOverlayWidgetRenderDescriptor {
	child: FeatureMatchWidgetGroupChildConfig;
}

/**
 * The Widget Group's rendering split into its stacked layers: a purely
 * positional shell, the background backdrop beneath the children, the
 * clipping children layer, and the border/glow frame on top.
 */
export interface FeatureMatchOverlayWidgetGroupLayers {
	shell: CSSProperties;
	backdrop: CSSProperties;
	children: CSSProperties;
	frame: CSSProperties;
}

export interface FeatureMatchOverlayWidgetGroupRenderModel {
	item: FeatureMatchWidgetGroupItemConfig;
	layers: FeatureMatchOverlayWidgetGroupLayers;
	children: FeatureMatchOverlayWidgetGroupChildRenderModel[];
}

export interface FeatureMatchOverlayWidgetHelpers {
	displayTime: string;
	playerState: (side: PlayerSide) => FeatureMatchOverlayMatchStateData['player1'];
	deckColors: (side: PlayerSide) => string;
	renderTemplateLinesForSide: (template: string, side: PlayerSide, tokenStyles?: FeatureMatchOverlayTokenStyleMap, spacerWidth?: number) => ReturnType<typeof renderFeatureMatchOverlayTemplateLines>;
	gameWinCount: (widget: FeatureMatchGameWinsWidgetConfig) => number;
	gameWinBoxes: (widget: FeatureMatchGameWinsWidgetConfig) => boolean[];
	gameWinBoxStyle: (widget: FeatureMatchGameWinsWidgetConfig, style: FeatureMatchOverlayBoxStyle | undefined, won: boolean) => Record<string, string | number | undefined>;
	gameWinsContainerStyle: (widget: FeatureMatchGameWinsWidgetConfig, style: FeatureMatchOverlayBoxStyle | undefined) => CSSProperties;
}

export interface FeatureMatchOverlayRenderModel {
	output: FeatureMatchOverlayOutput;
	canvasStyle: CSSProperties;
	sourceItems: FeatureMatchOverlaySourceItemRenderModel[];
	widgetItems: FeatureMatchOverlayWidgetItemRenderModel[];
	widgetGroups: FeatureMatchOverlayWidgetGroupRenderModel[];
	sourceCutouts: Array<{ id: string; path: string }>;
	frame: FeatureMatchOverlayFrameRenderModel;
	widgets: FeatureMatchOverlayWidgetHelpers;
	rectStyle: (rect: FeatureMatchOverlayRect) => CSSProperties;
	itemStyle: (item: FeatureMatchLayoutItemConfig) => CSSProperties;
	widgetStyle: (rect: FeatureMatchOverlayRect, style?: FeatureMatchOverlayBoxStyle) => CSSProperties;
	imageStyle: (rect: FeatureMatchOverlayRect, widget: Extract<FeatureMatchWidgetConfig, { type: 'image' }>) => CSSProperties;
	borderSideEnabled: (style: { borderTopVisible?: boolean; borderRightVisible?: boolean; borderBottomVisible?: boolean; borderLeftVisible?: boolean }, side: FeatureMatchOverlayBorderSide) => boolean;
}

function rectStyle(rect: FeatureMatchOverlayRect): CSSProperties {
	return { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

function borderSideEnabled(style: { borderTopVisible?: boolean; borderRightVisible?: boolean; borderBottomVisible?: boolean; borderLeftVisible?: boolean }, side: FeatureMatchOverlayBorderSide) {
	return style[`border${side}Visible` as keyof typeof style] ?? true;
}

function colorWithOpacity(output: FeatureMatchOverlayOutput, color: string | undefined, opacity: number | undefined) {
	const fallback = color || '#000000';
	const alpha = Math.max(0, Math.min(1, opacity ?? 1));
	if (output === 'key') {
		const value = Math.round(alpha * 255).toString(16).padStart(2, '0');
		return `#ffffff${value}`;
	}
	if (alpha <= 0)
		return 'transparent';
	if (alpha >= 1)
		return fallback;

	const hex = fallback.trim();
	const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
	if (!match)
		return fallback;

	const [, r, g, b] = match;
	return `rgba(${Number.parseInt(r!, 16)}, ${Number.parseInt(g!, 16)}, ${Number.parseInt(b!, 16)}, ${alpha})`;
}

function cssBackgroundStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchOverlayBoxStyle | undefined) {
	const gradient = style?.backgroundGradient?.trim();
	const opacity = style?.backgroundOpacity ?? (gradient ? 1 : 0);
	const color = style?.backgroundColor?.trim();
	const hasBaseColor = Boolean(color && !/^transparent$/i.test(color));

	if (output === 'key')
		return opacity > 0 && (gradient || hasBaseColor) ? colorWithOpacity(output, '#ffffff', opacity) : 'transparent';
	if (opacity <= 0)
		return 'transparent';
	if (gradient) {
		if (!hasBaseColor)
			return gradient;
		return `${gradient}, ${colorWithOpacity(output, color, opacity)}`;
	}
	if (!hasBaseColor)
		return 'transparent';

	return colorWithOpacity(output, color, opacity);
}

function cssGlowShadow(output: FeatureMatchOverlayOutput, style: FeatureMatchOverlayBoxStyle | undefined) {
	const size = Math.max(0, style?.glowSize ?? 0);
	if (output === 'key' || size <= 0 || !style?.borderVisible)
		return undefined;

	const visibleSides = FEATURE_MATCH_OVERLAY_BORDER_SIDES.filter(side => borderSideEnabled(style, side));
	if (visibleSides.length === 0)
		return undefined;

	const color = colorWithOpacity(output, style?.glowColor ?? style?.borderColor ?? style?.textColor ?? '#ffffff', style?.glowOpacity ?? 0.75);
	const insetSize = Math.max(1, Math.round(size / 2));
	if (visibleSides.length === FEATURE_MATCH_OVERLAY_BORDER_SIDES.length)
		return `0 0 ${size}px ${color}, inset 0 0 ${insetSize}px ${color}`;

	const sideShadows: Record<FeatureMatchOverlayBorderSide, string> = {
		Top: `0 -${size}px ${size}px -${size}px ${color}`,
		Right: `${size}px 0 ${size}px -${size}px ${color}`,
		Bottom: `0 ${size}px ${size}px -${size}px ${color}`,
		Left: `-${size}px 0 ${size}px -${size}px ${color}`,
	};

	return visibleSides.map(side => sideShadows[side]).join(', ');
}

function cssBorderStyle(output: FeatureMatchOverlayOutput, style: FeatureMatchOverlayBoxStyle | undefined) {
	if (!style) {
		return {
			border: 'none',
			borderTop: 'none',
			borderRight: 'none',
			borderBottom: 'none',
			borderLeft: 'none',
		};
	}

	const border = style.borderVisible ? `${style.borderWidth ?? 1}px solid ${output === 'key' ? '#fff' : (style.borderColor ?? '#fff')}` : 'none';
	return {
		border: 'none',
		borderTop: borderSideEnabled(style, 'Top') ? border : 'none',
		borderRight: borderSideEnabled(style, 'Right') ? border : 'none',
		borderBottom: borderSideEnabled(style, 'Bottom') ? border : 'none',
		borderLeft: borderSideEnabled(style, 'Left') ? border : 'none',
	};
}

function frameImagePreserveAspectRatio(fit: FeatureMatchOverlayModeConfig['layout']['frame']['backgroundImageFit']) {
	switch (fit) {
		case 'contain':
			return 'xMidYMid meet';
		case 'fill':
			return 'none';
		case 'cover':
		default:
			return 'xMidYMid slice';
	}
}

function svgFillColor(color: string | undefined) {
	return color?.trim() || 'transparent';
}

function baseBoxStyle(output: FeatureMatchOverlayOutput, rect: FeatureMatchOverlayRect, style: FeatureMatchOverlayBoxStyle | undefined): CSSProperties {
	return {
		...rectStyle(rect),
		position: 'absolute',
		boxSizing: 'border-box',
		padding: `${style?.padding ?? 0}px`,
		background: cssBackgroundStyle(output, style),
		...cssBorderStyle(output, style),
		borderRadius: featureMatchOverlayBorderRadiusCss(style ?? {}),
		boxShadow: cssGlowShadow(output, style),
		color: output === 'key' ? '#fff' : (style?.textColor ?? '#fff'),
		fontSize: `${style?.fontSize ?? 24}px`,
		fontFamily: resolveFeatureMatchOverlayFontFamily(style?.fontFamily),
		fontWeight: style?.fontWeight ?? 600,
		fontStyle: style?.fontStyle ?? 'normal',
		textTransform: style?.textTransform ?? 'none',
		letterSpacing: style?.letterSpacing != null ? `${style.letterSpacing}px` : undefined,
		lineHeight: style?.lineHeight ?? undefined,
		textAlign: style?.textAlign ?? 'left',
		overflow: style?.overflow === 'visible' ? 'visible' : 'hidden',
	};
}

function clampSize(value: number, min = 0, max?: number) {
	return Math.max(min, max == null ? value : Math.min(value, max));
}

function stackChildBaseSize(child: FeatureMatchWidgetGroupChildConfig) {
	if (child.layout.mode !== 'stack')
		return 0;
	const sizing = child.layout.sizing;
	if (sizing.mode === 'fixed')
		return sizing.size ?? sizing.min ?? 120;
	if (sizing.mode === 'content')
		return sizing.size ?? sizing.min ?? 120;
	return sizing.min ?? 0;
}

function stackChildRects(children: FeatureMatchWidgetGroupChildConfig[], group: FeatureMatchWidgetGroupItemConfig) {
	const padding = group.arrangement.padding ?? 0;
	const stack = group.arrangement.mode === 'row' || group.arrangement.mode === 'column'
		? group.arrangement
		: { mode: 'row' as const, gap: 0, align: 'stretch' as const, justify: 'start' as const, padding };
	const isColumn = stack.mode === 'column';
	const mainSize = isColumn ? group.height : group.width;
	const crossSize = isColumn ? group.width : group.height;
	const stackChildren = children.filter(child => child.layout.mode === 'stack');
	const gapCount = Math.max(0, stackChildren.length - 1);
	const contentMainSize = Math.max(0, mainSize - padding * 2);
	const contentCrossSize = Math.max(0, crossSize - padding * 2);
	const totalGap = stack.gap * gapCount;
	const nonFillSize = stackChildren.reduce((total, child) => {
		if (child.layout.mode !== 'stack' || child.layout.sizing.mode === 'fill')
			return total;
		return total + clampSize(stackChildBaseSize(child), child.layout.sizing.min, child.layout.sizing.max);
	}, 0);
	const fillChildren = stackChildren.filter(child => child.layout.mode === 'stack' && child.layout.sizing.mode === 'fill');
	const fillWeight = fillChildren.reduce((total, child) => total + (child.layout.mode === 'stack' ? child.layout.sizing.weight ?? 1 : 1), 0) || 1;
	const fillSpace = Math.max(0, contentMainSize - nonFillSize - totalGap);
	const sizes = new Map<string, number>();

	for (const child of stackChildren) {
		if (child.layout.mode !== 'stack')
			continue;
		const sizing = child.layout.sizing;
		const size = sizing.mode === 'fill'
			? fillSpace * ((sizing.weight ?? 1) / fillWeight)
			: stackChildBaseSize(child);
		sizes.set(child.id, clampSize(size, sizing.min, sizing.max));
	}

	const usedSize = Array.from(sizes.values()).reduce((total, size) => total + size, 0);
	const remaining = Math.max(0, contentMainSize - usedSize - totalGap);
	const startOffset = stack.justify === 'center'
		? remaining / 2
		: stack.justify === 'end'
			? remaining
			: 0;
	const actualGap = stack.justify === 'space-between' && gapCount > 0
		? stack.gap + remaining / gapCount
		: stack.gap;

	const rects = new Map<string, FeatureMatchOverlayRect>();
	let cursor = padding + startOffset;

	for (const child of stackChildren) {
		if (child.layout.mode !== 'stack')
			continue;

		const main = sizes.get(child.id) ?? 0;
		const align = child.layout.alignSelf ?? stack.align;
		const cross = align === 'stretch' ? contentCrossSize : contentCrossSize;
		const crossOffset = align === 'center'
			? (contentCrossSize - cross) / 2
			: align === 'end'
				? contentCrossSize - cross
				: 0;
		const x = isColumn ? padding + crossOffset + (child.layout.offsetX ?? 0) : cursor + (child.layout.offsetX ?? 0);
		const y = isColumn ? cursor + (child.layout.offsetY ?? 0) : padding + crossOffset + (child.layout.offsetY ?? 0);

		rects.set(child.id, {
			x,
			y,
			width: isColumn ? cross : main,
			height: isColumn ? main : cross,
		});

		cursor += main + actualGap;
	}

	return rects;
}

function childRect(child: FeatureMatchWidgetGroupChildConfig, index: number, group: FeatureMatchWidgetGroupItemConfig, visibleChildren = group.children): FeatureMatchOverlayRect {
	if (child.layout.mode === 'canvas') {
		return {
			x: child.layout.x,
			y: child.layout.y,
			width: child.layout.width,
			height: child.layout.height,
		};
	}

	return stackChildRects(visibleChildren, group).get(child.id) ?? {
		x: group.arrangement.padding ?? 0,
		y: group.arrangement.padding ?? 0,
		width: child.layout.sizing.size ?? child.layout.sizing.min ?? 120,
		height: child.layout.sizing.size ?? child.layout.sizing.min ?? 120,
	};
}

function groupChildDefaultSurfaceStyle(group: FeatureMatchWidgetGroupItemConfig) {
	return group.defaultChildSurfaceStyle ?? {};
}

export function resolveFeatureMatchOverlayRenderModel(input: FeatureMatchOverlayRenderModelInput & { maskId?: string }): FeatureMatchOverlayRenderModel {
	const { config, output, displayTime } = input;
	const resolveGraphicAssetContentPath = input.graphicAssetContentPath
		?? graphicAssetRevisionContentPath;
	const visibleItems = [...config.layout.items]
		.filter(item => item.visible)
		.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
	const sourceItems = visibleItems.filter((item): item is FeatureMatchSourceItemConfig => item.type === 'source');
	const widgetItems = visibleItems.filter((item): item is FeatureMatchWidgetItemConfig => item.type === 'widget');
	const widgetGroups = visibleItems.filter((item): item is FeatureMatchWidgetGroupItemConfig => item.type === 'widget-group');

	function itemStyle(item: FeatureMatchLayoutItemConfig): CSSProperties {
		return {
			...baseBoxStyle(output, item, item.surfaceStyle),
			zIndex: item.zIndex,
			pointerEvents: 'none',
		};
	}

	function widgetStyle(rect: FeatureMatchOverlayRect, style?: FeatureMatchOverlayBoxStyle): CSSProperties {
		return {
			...baseBoxStyle(output, rect, style),
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'center',
			alignItems: (style?.textAlign ?? 'left') === 'center'
				? 'center'
				: (style?.textAlign ?? 'left') === 'right' ? 'flex-end' : 'flex-start',
			whiteSpace: 'pre-line',
		};
	}

	function playerData(side: PlayerSide) {
		return side === 'player1' ? input.featureMatch?.player1Data : input.featureMatch?.player2Data;
	}

	function playerState(side: PlayerSide) {
		return side === 'player1' ? input.matchState?.player1 : input.matchState?.player2;
	}

	function recordFor(side: PlayerSide) {
		const data = playerData(side);
		if (data?.wins == null && data?.losses == null && data?.draws == null)
			return '';

		const event = input.event as { displayRecordSeparator?: string | null; displayHideZeroDraws?: boolean | null } | null | undefined;
		const wins = data.wins ?? 0;
		const losses = data.losses ?? 0;
		const draws = data.draws ?? 0;
		const separator = event?.displayRecordSeparator ?? '-';
		const hideZeroDraws = event?.displayHideZeroDraws ?? true;

		return hideZeroDraws && draws === 0
			? `${wins}${separator}${losses}`
			: `${wins}${separator}${losses}${separator}${draws}`;
	}

	function deckFor(side: PlayerSide) {
		const mtg = getMtgGameData(playerData(side)?.gameData as Parameters<typeof getMtgGameData>[0]);
		return mtg.deckName ?? '';
	}

	function deckColors(side: PlayerSide) {
		const mtg = getMtgGameData(playerData(side)?.gameData as Parameters<typeof getMtgGameData>[0]);
		return mtg.deckColors ?? '';
	}

	const templateMetadataValues = buildFeatureMatchOverlayTemplateMetadataValues({
		event: input.event,
		featureMatch: input.featureMatch,
		sourceMatch: input.sourceMatch,
		round: input.round,
		phase: input.phase,
	});

	function templateValuesForSide(side: PlayerSide, deckColorsValue: string) {
		const data = playerData(side);
		return {
			name: data?.name ?? '',
			pronouns: data?.pronouns ?? '',
			record: recordFor(side),
			deck: deckFor(side),
			deckColors: deckColorsValue,
			lgs: data?.lgs ?? '',
			...templateMetadataValues,
		};
	}

	function renderTemplateLinesForSide(template: string, side: PlayerSide, tokenStyles?: FeatureMatchOverlayTokenStyleMap, spacerWidth?: number) {
		return renderFeatureMatchOverlayTemplateLines(template, templateValuesForSide(side, deckColors(side)), tokenStyles, { spacerWidth });
	}

	function gameWinCount(widget: FeatureMatchGameWinsWidgetConfig) {
		const wins = playerState(widget.playerSide)?.gameWins ?? 0;
		return Number.isFinite(wins) ? Math.max(0, Math.floor(wins)) : 0;
	}

	function gameWinBoxes(widget: FeatureMatchGameWinsWidgetConfig) {
		const wins = gameWinCount(widget);
		const bestOf = input.featureMatch?.activeSession?.sourceSnapshot?.bestOf ?? input.featureMatch?.bestOf ?? 3;
		return Array.from({ length: Math.ceil(bestOf / 2) }, (_, index) => index < wins);
	}

	function gameWinBoxStyle(widget: FeatureMatchGameWinsWidgetConfig, style: FeatureMatchOverlayBoxStyle | undefined, won: boolean): Record<string, string | number | undefined> {
		const borderWidth = widget.boxBorderWidth ?? style?.borderWidth ?? 2;
		return {
			width: `${widget.boxWidth ?? 22}px`,
			height: `${widget.boxHeight ?? 22}px`,
			background: won ? (output === 'key' ? '#fff' : (style?.backgroundColor ?? '#22c55e')) : 'transparent',
			border: `${borderWidth}px solid ${output === 'key' ? '#fff' : (style?.borderColor ?? style?.textColor ?? '#fff')}`,
			borderRadius: featureMatchOverlayBorderRadiusCss(style ?? {}),
		};
	}

	function imageStyleFor(rect: FeatureMatchOverlayRect, widget: Extract<FeatureMatchWidgetConfig, { type: 'image' }>): CSSProperties {
		return {
			...rectStyle(rect),
			position: 'absolute',
			objectFit: widget.fit,
			opacity: widget.opacity,
			borderRadius: `${widget.borderRadius}px`,
		};
	}

	function gameWinsContainerStyle(widget: FeatureMatchGameWinsWidgetConfig, style: FeatureMatchOverlayBoxStyle | undefined): CSSProperties {
		return {
			'--game-win-gap': `${widget.boxGap ?? style?.padding ?? 6}px`,
			'--game-win-direction': (widget.boxOrientation ?? 'horizontal') === 'vertical' ? 'column' : 'row',
		};
	}

	function widgetRender(
		widget: FeatureMatchWidgetConfig,
		label: string,
		rect: FeatureMatchOverlayRect,
		surfaceStyle: FeatureMatchOverlayBoxStyle | undefined,
	): FeatureMatchOverlayWidgetRender {
		switch (widget.type) {
			case 'text':
				return {
					type: 'text',
					lines: renderTemplateLinesForSide(widget.template, widget.playerSide ?? 'player1', widget.tokenStyles, widget.spacerWidth),
					deckColors: deckColors(widget.playerSide ?? 'player1'),
				};
			case 'image':
				return {
					type: 'image',
					src: widget.asset ? resolveGraphicAssetContentPath(widget.asset) : '',
					alt: label,
					imageStyle: imageStyleFor({ x: 0, y: 0, width: rect.width, height: rect.height }, widget),
				};
			case 'clock':
				return { type: 'clock', displayTime };
			case 'player-life':
				return {
					type: 'player-life',
					lifeTotal: playerState(widget.playerSide)?.lifeTotal,
					animation: widget.lifeAnimation,
					durationMs: widget.lifeAnimationDurationMs,
					accentColor: widget.lifeAnimationAccentColor,
				};
			case 'game-wins':
				return {
					type: 'game-wins',
					boxes: gameWinBoxes(widget),
					wins: gameWinCount(widget),
					displayMode: widget.displayMode ?? 'boxes',
					containerStyle: gameWinsContainerStyle(widget, surfaceStyle),
					boxStyles: {
						won: gameWinBoxStyle(widget, surfaceStyle, true),
						lost: gameWinBoxStyle(widget, surfaceStyle, false),
					},
				};
		}
	}

	function groupLayers(group: FeatureMatchWidgetGroupItemConfig): FeatureMatchOverlayWidgetGroupLayers {
		const surfaceStyle = group.surfaceStyle;
		const borderRadius = featureMatchOverlayBorderRadiusCss(surfaceStyle ?? {});
		const gradient = output !== 'key' ? surfaceStyle?.backgroundGradient?.trim() : undefined;
		const color = surfaceStyle?.backgroundColor?.trim();
		const hasBaseColor = Boolean(color && !/^transparent$/i.test(color));

		return {
			shell: {
				...rectStyle(group),
				position: 'absolute',
				boxSizing: 'border-box',
				zIndex: group.zIndex,
				pointerEvents: 'none',
				overflow: 'visible',
			},
			backdrop: {
				position: 'absolute',
				inset: 0,
				boxSizing: 'border-box',
				pointerEvents: 'none',
				background: gradient
					? (hasBaseColor ? `${gradient}, ${color}` : gradient)
					: cssBackgroundStyle(output, surfaceStyle),
				opacity: gradient ? surfaceStyle?.backgroundOpacity ?? 1 : undefined,
				borderRadius,
				zIndex: 0,
			},
			children: {
				position: 'absolute',
				inset: 0,
				boxSizing: 'border-box',
				overflow: group.overflow === 'visible' ? 'visible' : 'hidden',
				borderRadius,
				pointerEvents: 'none',
				zIndex: 1,
			},
			frame: {
				position: 'absolute',
				inset: 0,
				boxSizing: 'border-box',
				pointerEvents: 'none',
				background: 'transparent',
				...cssBorderStyle(output, surfaceStyle),
				borderRadius,
				boxShadow: cssGlowShadow(output, surfaceStyle),
				zIndex: 2,
			},
		};
	}

	const renderedSourceItems = sourceItems.map(item => ({
		item,
		style: itemStyle(item),
		cutoutPath: item.frameCutout ? roundedRectPath(featureMatchOverlaySourceCutoutRect(item)) || null : null,
	}));

	return {
		output,
		canvasStyle: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			background: output === 'overlay' ? 'transparent' : '#000',
		},
		sourceItems: renderedSourceItems,
		widgetItems: widgetItems.map(item => ({
			id: item.id,
			label: item.label,
			item,
			widget: item.widget,
			surfaceStyle: item.surfaceStyle,
			style: widgetStyle(item, item.surfaceStyle),
			render: widgetRender(item.widget, item.label, item, item.surfaceStyle),
		})),
		widgetGroups: widgetGroups.map(group => ({
			item: group,
			layers: groupLayers(group),
			children: group.children
				.filter(child => child.visible)
				.map((child, index, visibleChildren) => {
					const rect = childRect(child, index, group, visibleChildren);
					const surfaceStyle = { ...groupChildDefaultSurfaceStyle(group), ...(child.surfaceStyle ?? {}) };
					const style = widgetStyle(rect, surfaceStyle);
					return {
						id: child.id,
						label: child.label,
						child,
						widget: child.widget,
						surfaceStyle,
						style: {
							...style,
							zIndex: child.layout.mode === 'canvas' ? child.layout.zIndex : undefined,
						},
						render: widgetRender(child.widget, child.label, rect, surfaceStyle),
					};
				}),
		})),
		sourceCutouts: renderedSourceItems
			.filter(source => source.cutoutPath)
			.map(source => ({ id: source.item.id, path: source.cutoutPath! })),
		frame: {
			maskId: input.maskId ?? 'feature-match-overlay-frame-mask',
			imageStyle: { opacity: config.layout.frame.opacity },
			imagePreserveAspectRatio: frameImagePreserveAspectRatio(config.layout.frame.backgroundImageFit),
			fill: output === 'key' ? '#fff' : svgFillColor(config.layout.frame.backgroundColor),
			opacity: config.layout.frame.opacity,
		},
		widgets: {
			displayTime,
			playerState,
			deckColors,
			renderTemplateLinesForSide,
			gameWinCount,
			gameWinBoxes,
			gameWinBoxStyle,
			gameWinsContainerStyle,
		},
		rectStyle,
		itemStyle,
		widgetStyle,
		imageStyle: imageStyleFor,
		borderSideEnabled,
	};
}

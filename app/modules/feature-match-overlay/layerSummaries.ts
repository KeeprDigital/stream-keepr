import type {
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
	FeatureMatchWidgetConfig,
	FeatureMatchWidgetGroupChildConfig,
	FeatureMatchWidgetGroupItemConfig,
} from '~~/shared/types/screenConfig';
import { featureMatchOverlayWidgetDefinition } from '~/modules/feature-match-overlay/widgetDefinitions';

/**
 * Presentation summaries for Feature Match Layout Items in the editor: icons,
 * type labels, and one-line descriptions shared by the layer tree and the
 * per-kind inspectors. Widget-type specifics come from the Widget
 * Definitions; these helpers add the item/group/child level.
 */

export function widgetIcon(type: FeatureMatchWidgetConfig['type']) {
	return featureMatchOverlayWidgetDefinition(type).icon;
}

export function widgetTypeLabel(type: FeatureMatchWidgetConfig['type']) {
	return featureMatchOverlayWidgetDefinition(type).label;
}

export function widgetSummary(widget: FeatureMatchWidgetConfig) {
	return featureMatchOverlayWidgetDefinition(widget.type).summary(widget);
}

export function layerIcon(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return 'i-lucide-video';
	if (item.type === 'widget-group')
		return 'i-lucide-group';
	return widgetIcon(item.widget.type);
}

export function layerTypeLabel(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return 'Source';
	if (item.type === 'widget-group')
		return 'Group';
	return widgetTypeLabel(item.widget.type);
}

export function rectSummary(rect: { x: number; y: number; width: number; height: number }) {
	return `${rect.width}x${rect.height} at ${rect.x}, ${rect.y}`;
}

export function itemSummary(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return `${rectSummary(item)} • ${item.sourceRole || 'source'}`;
	if (item.type === 'widget-group')
		return `${rectSummary(item)} • ${item.children.length} widgets`;
	return `${rectSummary(item)} • ${widgetSummary(item.widget)}`;
}

export function childSummary(child: FeatureMatchWidgetGroupChildConfig) {
	const layout = child.layout.mode === 'canvas'
		? rectSummary(child.layout)
		: `${child.layout.sizing.mode}${child.layout.sizing.size ? ` ${child.layout.sizing.size}` : ''}`;
	return `${layout} • ${widgetSummary(child.widget)}`;
}

export function styleOverrideCount(style?: FeatureMatchOverlayBoxStyle) {
	return Object.values(style ?? {}).filter(value => value !== undefined).length;
}

export function hasStyleOverrides(style?: FeatureMatchOverlayBoxStyle) {
	return styleOverrideCount(style) > 0;
}

export function appearanceSummary(style?: FeatureMatchOverlayBoxStyle) {
	const parts = [];
	if (style?.fontSize)
		parts.push(`${style.fontSize}px text`);
	if (style?.backgroundOpacity)
		parts.push('background');
	if (style?.backgroundGradient)
		parts.push('gradient');
	if (style?.borderVisible)
		parts.push(`border ${style.borderWidth ?? 1}px`);
	if (style?.glowSize)
		parts.push(`glow ${style.glowSize}px`);
	if (style?.borderRadius)
		parts.push(`radius ${style.borderRadius}`);
	return parts.length ? parts.join(' • ') : 'Defaults';
}

export function groupWidgetDefaultsSummary(group: FeatureMatchWidgetGroupItemConfig) {
	return `${appearanceSummary(group.defaultChildSurfaceStyle)} • ${group.children.length} widgets inherit`;
}

export function childAppearanceBadge(child: FeatureMatchWidgetGroupChildConfig) {
	return hasStyleOverrides(child.surfaceStyle) ? 'Overrides defaults' : 'Inherits defaults';
}

export function childAppearanceSummary(child: FeatureMatchWidgetGroupChildConfig) {
	if (!hasStyleOverrides(child.surfaceStyle))
		return 'Using widget defaults';
	return `${styleOverrideCount(child.surfaceStyle)} overrides over widget defaults`;
}

export function groupLayoutSummary(group: FeatureMatchWidgetGroupItemConfig) {
	const arrangement = group.arrangement.mode === 'canvas'
		? 'Canvas'
		: `${group.arrangement.mode}, gap ${group.arrangement.gap}`;
	return `${arrangement} • ${group.overflow ?? 'clip'}`;
}

export const FEATURE_MATCH_OVERLAY_WIDGET_KIND_OPTIONS = [
	{ label: 'Text', value: 'text' },
	{ label: 'Image', value: 'image' },
	{ label: 'Clock', value: 'clock' },
	{ label: 'Player Life', value: 'player-life' },
	{ label: 'Game Wins', value: 'game-wins' },
] satisfies Array<{ label: string; value: FeatureMatchWidgetConfig['type'] }>;

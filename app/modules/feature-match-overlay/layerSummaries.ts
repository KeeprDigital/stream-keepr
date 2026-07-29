import type {
	FeatureMatchGraphicGroupChildConfig,
	FeatureMatchGraphicGroupItemConfig,
	FeatureMatchGraphicItemDefinitionConfig,
	FeatureMatchLayoutItemConfig,
	FeatureMatchOverlayBoxStyle,
} from '~~/shared/types/screenConfig';
import {
	featureMatchGraphicGroupChildGraphicItemConfig,
	featureMatchLayoutItemGraphicItemConfig,
} from '~~/shared/featureMatchGraphicItemDefinitions';
import { featureMatchOverlayGraphicItemDefinition } from '~/modules/feature-match-overlay/graphicItemDefinitions';

/**
 * Presentation summaries for Feature Match Layout Items in the editor: icons,
 * type labels, and one-line descriptions shared by the layer tree and the
 * per-kind inspectors. Graphic Item specifics come from the Graphic Item
 * Definitions; these helpers add the item/group/child level.
 */

export function graphicItemIcon(type: FeatureMatchGraphicItemDefinitionConfig['type']) {
	return featureMatchOverlayGraphicItemDefinition(type).icon;
}

export function graphicItemTypeLabel(type: FeatureMatchGraphicItemDefinitionConfig['type']) {
	return featureMatchOverlayGraphicItemDefinition(type).label;
}

export function graphicItemSummary(graphicItem: FeatureMatchGraphicItemDefinitionConfig) {
	return featureMatchOverlayGraphicItemDefinition(graphicItem.type).summary(graphicItem);
}

export function layerIcon(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return 'i-lucide-video';
	const config = featureMatchLayoutItemGraphicItemConfig(item);
	return featureMatchOverlayGraphicItemDefinition(config.type).icon;
}

export function layerTypeLabel(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return 'Source';
	const config = featureMatchLayoutItemGraphicItemConfig(item);
	return featureMatchOverlayGraphicItemDefinition(config.type).label;
}

export function rectSummary(rect: { x: number; y: number; width: number; height: number }) {
	return `${rect.width}x${rect.height} at ${rect.x}, ${rect.y}`;
}

export function itemSummary(item: FeatureMatchLayoutItemConfig) {
	if (item.type === 'source')
		return `${rectSummary(item)} • ${item.sourceRole || 'source'}`;
	const config = featureMatchLayoutItemGraphicItemConfig(item);
	return `${rectSummary(item)} • ${featureMatchOverlayGraphicItemDefinition(config.type).summary(config as never)}`;
}

export function childSummary(child: FeatureMatchGraphicGroupChildConfig) {
	const layout = child.layout.mode === 'canvas'
		? rectSummary(child.layout)
		: `${child.layout.sizing.mode}${child.layout.sizing.size ? ` ${child.layout.sizing.size}` : ''}`;
	const config = featureMatchGraphicGroupChildGraphicItemConfig(child);
	return `${layout} • ${featureMatchOverlayGraphicItemDefinition(config.type).summary(config as never)}`;
}

export function childIcon(child: FeatureMatchGraphicGroupChildConfig) {
	const config = featureMatchGraphicGroupChildGraphicItemConfig(child);
	return featureMatchOverlayGraphicItemDefinition(config.type).icon;
}

export function childTypeLabel(child: FeatureMatchGraphicGroupChildConfig) {
	const config = featureMatchGraphicGroupChildGraphicItemConfig(child);
	return featureMatchOverlayGraphicItemDefinition(config.type).label;
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

export function groupGraphicItemDefaultsSummary(group: FeatureMatchGraphicGroupItemConfig) {
	const graphicItemCount = group.children.filter(child => child.type !== 'media').length;
	return `${appearanceSummary(group.defaultChildSurfaceStyle)} • ${graphicItemCount} Graphic Items inherit`;
}

export function childAppearanceBadge(child: FeatureMatchGraphicGroupChildConfig) {
	if (child.type === 'media')
		return 'Media treatment';
	return hasStyleOverrides(child.surfaceStyle) ? 'Overrides defaults' : 'Inherits defaults';
}

export function childAppearanceSummary(child: FeatureMatchGraphicGroupChildConfig) {
	if (child.type === 'media')
		return 'Media treatment does not inherit Graphic Item appearance';
	if (!hasStyleOverrides(child.surfaceStyle))
		return 'Using Graphic Item defaults';
	return `${styleOverrideCount(child.surfaceStyle)} overrides over Graphic Item defaults`;
}

export function groupLayoutSummary(group: FeatureMatchGraphicGroupItemConfig) {
	const arrangement = group.arrangement.mode === 'canvas'
		? 'Canvas'
		: `${group.arrangement.mode}, gap ${group.arrangement.gap}`;
	return `${arrangement} • ${group.overflow ?? 'clip'}`;
}

export const FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_KIND_OPTIONS: Array<{
	label: string;
	value: FeatureMatchGraphicItemDefinitionConfig['type'];
}> = [
	{ label: 'Text', value: 'text' },
	{ label: 'Clock', value: 'clock' },
	{ label: 'Player Life', value: 'player-life' },
	{ label: 'Game Wins', value: 'game-wins' },
];

export const FEATURE_MATCH_OVERLAY_GROUP_CHILD_KIND_OPTIONS = [
	...FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_KIND_OPTIONS,
	{ label: 'Media', value: 'media' as const },
];

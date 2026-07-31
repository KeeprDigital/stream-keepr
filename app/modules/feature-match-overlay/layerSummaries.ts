import type { FeatureMatchSourceItemConfig, FeatureMatchSourceSurfaceStyle } from '~~/shared/types/screenConfig';
import { featureMatchSourceItemSummary } from '~~/shared/featureMatchSourceItems';

/**
 * Presentation summaries for the host-owned half of a Feature Match Layout: the
 * Frame and its Source Items. The shared item tree summarises itself through the
 * Graphic Item Definitions.
 */

export function rectSummary(rect: { x: number; y: number; width: number; height: number }) {
	return `${rect.width}x${rect.height} at ${rect.x}, ${rect.y}`;
}

export function sourceSummary(item: FeatureMatchSourceItemConfig) {
	return `${rectSummary(item)} • ${featureMatchSourceItemSummary(item)}`;
}

export function appearanceSummary(style?: FeatureMatchSourceSurfaceStyle) {
	const parts = [];
	if (style?.backgroundOpacity)
		parts.push('background');
	if (style?.borderVisible)
		parts.push(`border ${style.borderWidth ?? 1}px`);
	if (style?.glowSize)
		parts.push(`glow ${style.glowSize}px`);
	if (style?.borderRadius)
		parts.push(`radius ${style.borderRadius}`);
	return parts.length ? parts.join(' • ') : 'Defaults';
}

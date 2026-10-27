import type { FeatureMatchSourceFramingStyle, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
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

/** A Source Item's own framing: its shape, since its surface is the Theme's (#831). */
export function appearanceSummary(style?: FeatureMatchSourceFramingStyle) {
	const parts = [];
	if (style?.glowPosition && style.glowPosition !== 'both')
		parts.push(`glow ${style.glowPosition}`);
	if (style?.borderRadius)
		parts.push(`radius ${style.borderRadius}`);
	return parts.length
		? parts.join(' • ')
		: 'Defaults';
}

import type { FeatureMatchSourceItemConfig } from './types/screenConfig';

/**
 * The Source Item Definition.
 *
 * The one Feature Match Overlay-specific Graphic Item Definition. Everything a
 * Feature Match Layout places other than a Source Item is a shared Graphic Item
 * Definition, so this is all that remains of the host's own registry — there is
 * no legacy widget registry beside it, and nothing dispatches on a layout item's
 * kind any more.
 *
 * It stays host-owned because no Broadcast Graphics Screen has an external video
 * source to place and a Frame cutout is a Frame concern, which is the Host
 * Contract's rule that capability outside the contract stays with the host.
 */

export const FEATURE_MATCH_SOURCE_ITEM_DEFINITION_ID = 'source';
export const FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION = 1;

export const FEATURE_MATCH_SOURCE_ITEM_LABEL = 'Source';
export const FEATURE_MATCH_SOURCE_ITEM_ICON = 'i-lucide-video';

export function createFeatureMatchSourceItem(id: string): FeatureMatchSourceItemConfig {
	return {
		id,
		label: 'New Source',
		visible: true,
		anchor: 'top-left',
		configurationVersion: FEATURE_MATCH_SOURCE_ITEM_CONFIGURATION_VERSION,
		sourceRole: 'main',
		frameCutout: true,
		x: 80,
		y: 80,
		width: 420,
		height: 240,
		surfaceStyle: {
			backgroundColor: '#000000',
			backgroundOpacity: 0,
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 4,
			borderRadius: 8,
		},
	};
}

export function featureMatchSourceItemSummary(item: FeatureMatchSourceItemConfig): string {
	return `${item.sourceRole || 'source'} source`;
}

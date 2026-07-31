import type { BroadcastGraphicConfig } from './types/graphics';
import type { FeatureMatchLayoutConfig } from './types/screenConfig';

/**
 * A Feature Match Layout's shared item tree, in the shape the compositor authors.
 *
 * The shared render model composes a stack of Broadcast Graphics, and a Feature
 * Match Overlay renders exactly one Feature Match Layout for exactly one Feature
 * Match Slot. One is a stack, so the tree is passed as a stack of one rather than
 * the render model growing a second entry point — which is what the Host Contract's
 * `single` composition means, and why nothing offers to add, reorder, or remove a
 * member.
 *
 * The composition being a `BroadcastGraphicConfig` is a statement about shape
 * rather than about kind. A Feature Match Layout is not a Broadcast Graphic: it
 * declares no Graphic Inputs, belongs to no Graphic Channel, and is never taken on
 * or off air. It carries the same authored fields — an id, a name, a Graphic Layer
 * Order, and optional whole-composition animation — because those are what the
 * Shared Graphics Foundation is.
 */

/**
 * The composition's stable id.
 *
 * Fixed rather than generated: it scopes every SVG element id the render model
 * mints, and a Feature Match Overlay has exactly one composition for its whole
 * life, so an id that changed between reads would renumber every gradient and
 * outline clip path for no reason.
 */
export const FEATURE_MATCH_LAYOUT_COMPOSITION_ID = 'feature-match-layout';

export const FEATURE_MATCH_LAYOUT_COMPOSITION_NAME = 'Feature Match Layout';

export function createFeatureMatchLayoutComposition(): BroadcastGraphicConfig {
	return {
		id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
		name: FEATURE_MATCH_LAYOUT_COMPOSITION_NAME,
		items: [],
	};
}

/** The shared item tree as the stack of one the compositor takes. */
export function featureMatchLayoutStack(
	layout: Pick<FeatureMatchLayoutConfig, 'composition'>,
): BroadcastGraphicConfig[] {
	return [layout.composition];
}

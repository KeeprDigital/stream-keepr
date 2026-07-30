import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
} from '../../types/screenConfig';

/**
 * Host Contract seam.
 *
 * The declaration a graphics Screen Mode supplies when it embeds the shared
 * compositor. The definition palette, canvas rules, and write semantics follow
 * from it; capability outside the contract stays host-owned. Broadcast
 * Graphics declares its contract here; Feature Match Overlay adopts the shared
 * compositor — and gains its own contract entry — when it moves onto this seam.
 */

export type GraphicsHostId = 'broadcast-graphics' | 'feature-match-overlay';

/** A data context a host can supply to a Graphic Item Definition. */
export type GraphicsContextKind = 'event' | 'feature-match';

/**
 * How accepted authoring writes reach the host's rendered surface.
 * `screen-stack` writes to the Screen's authored back-to-front stack of
 * Broadcast Graphics; `instant-apply` writes straight to the host's one
 * composition.
 */
export type GraphicsHostWriteSemantics = 'screen-stack' | 'instant-apply';

export interface GraphicsHostCanvasRules {
	defaultWidth: number;
	defaultHeight: number;
	/** Whether the operator may change the canvas dimensions. */
	configurable: boolean;
}

export interface GraphicsHostContract {
	hostId: GraphicsHostId;
	contextKinds: readonly GraphicsContextKind[];
	canvas: GraphicsHostCanvasRules;
	writeSemantics: GraphicsHostWriteSemantics;
	/**
	 * Top-level host-owned extras the shared compositor never interprets, such
	 * as the Feature Match Overlay Frame and its Source Items.
	 */
	hostExtras: readonly string[];
}

export const BROADCAST_GRAPHICS_HOST_CONTRACT: GraphicsHostContract = {
	hostId: 'broadcast-graphics',
	contextKinds: ['event'],
	canvas: {
		defaultWidth: DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
		defaultHeight: DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
		configurable: true,
	},
	writeSemantics: 'screen-stack',
	hostExtras: [],
};

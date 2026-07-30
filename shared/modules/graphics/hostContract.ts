/**
 * Host Contract seam.
 *
 * The declaration a graphics Screen Mode supplies when it embeds the shared
 * compositor. It carries only what the compositor reads today: which host it is,
 * and which data contexts it can supply to a Graphic Item Definition. The
 * definition palette follows from `contextKinds`; capability outside the
 * contract stays host-owned.
 *
 * Canvas defaults are deliberately absent — they already live on the Screen Mode
 * Definition as its graphics host, and one number wants one home. Fields for
 * host-owned extras, write semantics, and the binding catalogue are likewise
 * absent: Feature Match Overlay adopts this seam later, and it should add each
 * field when it has a real consumer rather than inherit a shape guessed for it.
 */

export type GraphicsHostId = 'broadcast-graphics' | 'feature-match-overlay';

/** A data context a host can supply to a Graphic Item Definition. */
export type GraphicsContextKind = 'event' | 'feature-match';

export interface GraphicsHostContract {
	hostId: GraphicsHostId;
	contextKinds: readonly GraphicsContextKind[];
}

export const BROADCAST_GRAPHICS_HOST_CONTRACT: GraphicsHostContract = {
	hostId: 'broadcast-graphics',
	contextKinds: ['event'],
};

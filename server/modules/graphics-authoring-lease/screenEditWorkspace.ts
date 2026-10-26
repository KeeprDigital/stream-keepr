import type { GraphicsAuthoringLeaseFence, GraphicsAuthoringLeaseRef } from './index';
import { screenEditWorkspaceArtifact } from '~~/shared/modules/graphics-authoring-lease';
import { graphicsAuthoringLeaseModule } from './index';

/**
 * The one graphics authoring artifact wired to a lease today: a Screen's complete
 * graphics Edit workspace.
 *
 * This is the whole binding between the artifact-agnostic lease module and a
 * concrete artifact kind — a reference builder and the write admissions that use
 * it. A template library adds its own file of the same shape rather than changing
 * anything the lease module does.
 *
 * Which Screen writes edit the workspace is decided by the Screen write module,
 * the one path every such write takes (#607); a route only says who is asking.
 */

export function screenEditWorkspaceLeaseRef(eventId: number, screenId: number): GraphicsAuthoringLeaseRef {
	return {
		artifact: screenEditWorkspaceArtifact(screenId),
		eventId,
	};
}

/**
 * Admit an authoring write to a Screen's graphics Edit workspace, answering the
 * fence its commit carries so a takeover in between still refuses it.
 *
 * Live Control never calls this: it operates a Broadcast Graphics Live Session
 * through its own command surface, and a lease on the Edit workspace is not part
 * of that surface's admission at all.
 */
export async function admitScreenGraphicsEditWrite(
	eventId: number,
	screenId: number,
	sessionId: string | undefined,
): Promise<GraphicsAuthoringLeaseFence> {
	const fence = {
		...screenEditWorkspaceLeaseRef(eventId, screenId),
		sessionId,
	};
	await graphicsAuthoringLeaseModule().requireWritable(fence, sessionId);
	return fence;
}

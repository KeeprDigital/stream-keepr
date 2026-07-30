import type { H3Event } from 'h3';
import type { GraphicsAuthoringLeaseRef } from './index';
import { optionalGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { screenEditWorkspaceArtifact } from '~~/shared/modules/graphics-authoring-lease';
import { graphicsAuthoringLeaseModule } from './index';

/**
 * The one graphics authoring artifact wired to a lease today: a Screen's complete
 * graphics Edit workspace.
 *
 * This is the whole binding between the artifact-agnostic lease module and a
 * concrete artifact kind — a reference builder and a write admission. A template
 * library adds its own file of the same two functions rather than changing
 * anything the lease module does.
 */

export function screenEditWorkspaceLeaseRef(eventId: number, screenId: number): GraphicsAuthoringLeaseRef {
	return { artifact: screenEditWorkspaceArtifact(screenId), eventId };
}

/**
 * Admit an authoring write to a Screen's graphics Edit workspace.
 *
 * Live Control never calls this: it operates a Broadcast Graphics Live Session
 * through its own command surface, and a lease on the Edit workspace is not part
 * of that surface's admission at all.
 */
export async function requireScreenGraphicsEditWritable(
	event: H3Event,
	eventId: number,
	screenId: number,
): Promise<void> {
	await graphicsAuthoringLeaseModule().requireWritable(
		screenEditWorkspaceLeaseRef(eventId, screenId),
		await optionalGraphicsAuthorSession(event),
	);
}

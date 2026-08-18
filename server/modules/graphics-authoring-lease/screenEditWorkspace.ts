import type { H3Event } from 'h3';
import type { GraphicsAuthoringLeaseRef } from './index';
import { screenService } from '~~/server/services/screen';
import { optionalBrowserSessionId } from '~~/server/utils/auth';
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
		await optionalBrowserSessionId(event),
	);
}

/**
 * Admit a change to a Broadcast Graphics Screen's pixel canvas.
 *
 * The canvas belongs to the leased artifact: every Broadcast Graphic is authored
 * in it, so resizing it reflows a holder's in-progress composition — no item
 * geometry is rewritten, but the frame those items were composed into moves
 * underneath the author, which is the harm the lease exists to prevent.
 *
 * The admission is deliberately as narrow as that argument. Only the canvas
 * dimensions, and only on a Screen currently in Broadcast Graphics mode, are
 * checked; every other generic Screen field and every other Screen Mode goes
 * through untouched. Guarding the whole Screen configuration route would restrict
 * live operation on Screens that have no graphics Edit workspace at all.
 */
export async function requireBroadcastGraphicsCanvasWritable(
	event: H3Event,
	eventId: number,
	screenId: number,
): Promise<void> {
	const screen = await screenService().findById(screenId, eventId);
	if (screen?.currentMode !== 'broadcast-graphics')
		return;
	await requireScreenGraphicsEditWritable(event, eventId, screenId);
}

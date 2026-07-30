import type { H3Event } from 'h3';
import type { GraphicsAuthoringLeaseRef } from './index';
import { optionalGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicsTemplateArtifact } from '~~/shared/modules/graphics-authoring-lease';
import { graphicsAuthoringLeaseModule } from './index';

/**
 * The second graphics authoring artifact a lease covers: one reusable graphics
 * Template.
 *
 * This is the whole binding, and it is the same two things the Screen Edit
 * workspace needed — a reference builder and a write admission. The lease module
 * itself learns nothing: it stores leases by `(kind, id)`, and its `event_id` was
 * already nullable because a library artifact is installation-scoped while a
 * Screen's workspace belongs to one Event. A template lease therefore carries no
 * Event at all, which is also what makes it exclusive across every Event two
 * authors might be working in.
 */

export function graphicsTemplateLeaseRef(templateId: string): GraphicsAuthoringLeaseRef {
	return { artifact: graphicsTemplateArtifact(templateId) };
}

/**
 * Admit an authoring write to one Broadcast Graphic Template.
 *
 * Placing a template is not a write to it and never calls this: a placement reads
 * the template and writes the Screen, so it is admitted by the Screen's own Edit
 * workspace lease. Two authors may place the same template at the same moment
 * without either of them holding it.
 */
export async function requireGraphicsTemplateWritable(
	event: H3Event,
	templateId: string,
): Promise<void> {
	await graphicsAuthoringLeaseModule().requireWritable(
		graphicsTemplateLeaseRef(templateId),
		await optionalGraphicsAuthorSession(event),
	);
}

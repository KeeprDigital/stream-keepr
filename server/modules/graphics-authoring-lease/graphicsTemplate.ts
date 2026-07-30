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
 *
 * ## This admission is deliberately inert today
 *
 * No client takes a template lease yet, and an unleased artifact is writable by
 * anyone — so this currently admits every caller. That is not an oversight, and it is
 * not the control protecting template revisions: the library offers rename, describe,
 * delete, and place, which are *single-shot* writes, and the right control for those
 * is the compare-and-swap on `revision` that the PATCH route enforces. A lease is
 * session-scoped, heartbeaten, and takeover-able because it protects a composition
 * edited *over time*; acquiring and releasing one around a single PATCH would be a
 * mutex the database already provides, and it would refuse an author renaming an entry
 * that someone else merely has open.
 *
 * What wires it is a **template editing session**: a workspace that opens one
 * template's composition in the compositor and writes it repeatedly — the template-side
 * equivalent of the Screen Edit workspace. When that exists it should acquire this
 * lease on open, heartbeat it, and release it on close, using the same client
 * composable the Screen workspace uses (it takes an endpoint, not a Screen). Until
 * then the guard is proven rather than exercised: the integration suite asserts a
 * lease on a nonexistent template is 404, and that a second session's DELETE is
 * refused while another holds the lease.
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

import type { H3Event } from 'h3';
import type { GraphicsAuthoringLeaseRef } from './index';
import { optionalBrowserSessionId } from '~~/server/utils/auth';
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
 * ## Why this exists now, and what is still missing
 *
 * It is required: #77's first acceptance criterion is one exclusive session-scoped
 * lease "per Screen graphics Edit workspace **and per reusable graphics Template**",
 * and the glossary names the same two artifacts. #77 shipped the Screen half only,
 * so this is the unmet half of a closed ticket rather than generality invented here.
 *
 * The guard is live and discriminating, not a placeholder: while one session holds
 * the lease, another session's write is refused and the holder's identical write
 * succeeds. The integration suite drives exactly that through the real routes — grant,
 * observe with `writable: false`, the observer's PATCH refused 409, the holder's PATCH
 * accepted — plus a 404 for a lease on a template that does not exist.
 *
 * What is missing is only client wiring: `useBroadcastGraphicTemplateRepository`
 * exposes no acquire or release, so nothing in the app takes a template lease yet, and
 * an artifact nobody holds is writable by anyone. That is deliberate. The library today
 * offers rename, describe, delete, and place, which are *single-shot* writes; a lease is
 * session-scoped, heartbeaten, and takeover-able because it protects a composition
 * edited *over time*, and acquiring one around a single PATCH would refuse an author
 * renaming an entry that someone else merely has open.
 *
 * What wires it is a **template editing session**: a workspace that opens one
 * template's composition in the compositor and writes it repeatedly — the template-side
 * equivalent of the Screen Edit workspace. When that exists it should acquire this
 * lease on open, heartbeat it, and release it on close, using the same client
 * composable the Screen workspace uses (it takes an endpoint, not a Screen).
 */
export async function requireGraphicsTemplateWritable(
	event: H3Event,
	templateId: string,
): Promise<void> {
	await graphicsAuthoringLeaseModule().requireWritable(
		graphicsTemplateLeaseRef(templateId),
		await optionalBrowserSessionId(event),
	);
}

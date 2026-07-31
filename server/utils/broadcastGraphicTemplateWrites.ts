import type { H3Event } from 'h3';
import { findBroadcastGraphicTemplateLibraryEntry } from '~~/server/modules/broadcast-graphic-template-library';

/**
 * Turn "the authored store does not have it" into the right refusal.
 *
 * The Broadcast Graphic Template library reads from two stores and writes to one.
 * When a write finds nothing, the identity may still name a design the author can
 * see — one a Template Package installed, which lives in the Graphics Asset
 * Library's own record and which this library never writes.
 *
 * Answering `404` there would be false about something on screen, and would leave an
 * author retrying a change that can never apply. So the miss is resolved against the
 * library as a whole, and an installed entry is refused with the route back: place
 * it, and save the placed copy. That produces a design this installation genuinely
 * owns, by the same route every authored entry took.
 *
 * Returns normally when the identity names nothing at all, leaving the caller to
 * report its own `404`.
 */
export async function refuseInstalledBroadcastGraphicTemplateWrite(
	event: H3Event,
	templateId: string,
	attempted: 'revised' | 'deleted',
): Promise<void> {
	const entry = await findBroadcastGraphicTemplateLibraryEntry(event, templateId);
	if (!entry || entry.authored)
		return;
	throw createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `Broadcast Graphic Template "${entry.name}" was installed from a Template Package and cannot be ${attempted} here. Place it on a Screen and save the placed copy to get a design this installation owns.`,
	});
}

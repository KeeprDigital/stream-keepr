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
 *
 * ## Why this and its Feature Match Layout twin stay two functions
 *
 * Examined and settled rather than left to drift (#156). The pair is near-identical in
 * shape, but the whole body that differs is the wording an author reads — "save the
 * placed copy" against "save the placed layout" — and an integration test asserts it.
 * A parameterised version would take the finder, the artifact noun and that clause,
 * making it about as long as one original while hiding the message behind a parameter.
 *
 * The same holds one layer down. `broadcastGraphicTemplate` and
 * `featureMatchLayoutTemplate` are structurally alike, but what repeats is raw D1 SQL
 * with the table name interpolated; sharing it means a table-name-parameterised SQL
 * builder — injection-shaped, and hardest to read exactly where correctness matters —
 * plus a Style-Set-link denormalisation only the Broadcast Graphic Template side has
 * columns for, and two conflict errors callers catch by class.
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

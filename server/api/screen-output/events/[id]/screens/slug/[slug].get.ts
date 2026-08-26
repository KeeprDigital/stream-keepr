import { z } from 'zod';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { screenSlugSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { getEventId } from '~~/server/utils/eventId';
import { canReadScreenOutput } from '~~/server/utils/screenOutputAuthorization';

/**
 * `GET /api/screen-output/events/:id/screens/slug/:slug` — the Screen a Screen
 * Output is (#397, ADR-0010's screen-output decisions).
 *
 * **It used to live at `/api/events/:id/screens/slug/:slug` and be fully public.**
 * ADR-0010 moved it off that surface, and this path is what "folds into the
 * capability surface" means literally: `/api/screen-output/**` is the one prefix
 * the deny-by-default boundary exempts because everything under it carries its own
 * credential, so membership is structural here rather than a pattern somebody
 * maintains in the exemption list. #396 left it private in the interim — the
 * fail-closed direction, which cost the output page this lookup until now.
 *
 * Leaving `/api/events/**` also drops `event-exists.ts`, and that is a gain rather
 * than a cost: its 404 says 'Event not found', which would have told an
 * uncredentialed caller that an Event exists whenever the refusal changed wording.
 * Everything here refuses with **one** sentence, so a missing Event, an unknown
 * slug, a capability for another Screen and no credential at all are the same
 * answer. `getEventId` still resolves the `id` param, because it falls back to the
 * route when that middleware has not run.
 *
 * **Two credentials, and the second is not in the ticket.** ADR-0010 asks for the
 * capability bearer the output page holds in its URL hash, and that is the arm that
 * matters — a Screen Output has no session and must not need one. But this route is
 * also the bootstrap for the operator's own embeds, and two of the three hold no
 * capability by design: `PreviewOutputAside` and `Graphics/Compositor/Preview` open
 * `embed=preview`, which "resolves media as the author rather than through a Screen
 * Output Asset Capability" (`shared/utils/screenOutput.ts`), so they pass none.
 * Requiring the capability alone would have left the editor's previews rendering
 * nothing, which is not what the ADR was trading away. A session is therefore
 * accepted too — the same dual-credential shape the ADR spells out for the realtime
 * token one file over, for the same reason.
 */

const screenSlugRouteSchema = z.object({
	slug: screenSlugSchema,
});

/** The one refusal this route has, for every way of not being allowed to ask. */
function screenNotFound(): never {
	throw createError({
		statusCode: 404,
		statusMessage: 'Not Found',
		message: 'Screen not found',
	});
}

export default defineEventHandler(async (event) => {
	const eventId = await getEventId(event);
	const { slug } = await getValidatedRouterParams(event, screenSlugRouteSchema.parse);

	// The Screen is resolved before either credential is examined, because the
	// capability is checked *against this Screen's* digest — there is nothing to
	// compare a bearer to until the slug has named a row. Reading a row is not
	// disclosing one: every path out of here that is not fully credentialed raises
	// the same 404, with the same sentence.
	//
	// **That settles the response and not the clock**, which is worth admitting
	// rather than leaving a reader to infer from a sentence about bodies. A slug that
	// exists costs this lookup plus an HMAC digest, two SHA-256s and a session read;
	// one that does not returns after the lookup alone. Elapsed time therefore
	// separates "this slug exists" from "it does not". Accepted, on three grounds: no
	// secret is on that channel — a slug is a name an operator hands out, not a
	// credential; the capability comparison itself is constant-time
	// (`secretTokensMatch`), so nothing leaks about how nearly a bearer was right;
	// and the difference sits under D1's own latency spread. Closing it would mean
	// doing equal work for an absent row, which is a real cost for a guess this
	// route's 404 already refuses to confirm.
	const screen = await screenService().findBySlug(eventId, slug);
	if (!screen)
		screenNotFound();

	if (await canReadScreenOutput(event, screen))
		return mapScreenToResponse(screen);

	screenNotFound();
});

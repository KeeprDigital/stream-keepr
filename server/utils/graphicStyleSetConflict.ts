import { GraphicStyleSetRevisionConflict } from '~~/server/services/graphicStyleSet';

/**
 * Turn a lost compare-and-swap on a Graphic Style Set into the answer its author can
 * act on.
 *
 * Every write to a Style Set states the draft revision it was built against, and
 * every route that makes one has the same thing to say when it is stale: look again,
 * here is where the draft actually is. Stating it once keeps the three routes from
 * drifting into three different messages for one condition — and an author who reads
 * "edited by another session" on a rename and something else on a publish has to work
 * out whether they are the same problem.
 *
 * Anything that is not a revision conflict is rethrown untouched.
 */
export function rethrowAsGraphicStyleSetConflict(error: unknown, what: string): never {
	if (error instanceof GraphicStyleSetRevisionConflict) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: `${what} (the draft is now at revision ${error.currentDraftRevision})`,
		});
	}
	throw error;
}

import {
	GraphicStyleSetRevisionConflict,
	GraphicStyleSetTemplateReferenceConflict,
} from '~~/server/services/graphicStyleSet';

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
 * A template reference refusal (ADR-0034) is a different conflict, and no reload
 * fixes it: a template the operation rewrites holds a reference that stopped being
 * selectable after the route checked it.
 *
 * Anything else is rethrown untouched.
 */
export function rethrowAsGraphicStyleSetConflict(error: unknown, what: string): never {
	if (error instanceof GraphicStyleSetRevisionConflict) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: `${what} (the draft is now at revision ${error.currentDraftRevision})`,
		});
	}
	if (error instanceof GraphicStyleSetTemplateReferenceConflict) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'A template this operation rewrites references a Graphic Asset Revision that stopped being selectable while it ran. Replace or restore that asset in the template, then try again.',
		});
	}
	throw error;
}

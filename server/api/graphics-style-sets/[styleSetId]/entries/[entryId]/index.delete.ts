import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { planGraphicStyleEntryDeletion } from '~~/server/modules/graphic-style-set';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import {
	deleteGraphicStyleSetEntrySchema,
	graphicStyleSetEntryParamsSchema,
} from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { rethrowAsGraphicStyleSetConflict } from '~~/server/utils/graphicStyleSetConflict';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Delete one Graphic Style Set entry, and deal with every reference to it in the
 * same operation.
 *
 * `replace` repoints every reference — inside the Style Set and across every affected
 * template — at another entry of the same kind. `detach` drops each template's
 * reference while leaving the value it produced exactly where it is, which changes
 * nothing any output renders.
 *
 * The entry disappears only if every template revision it required succeeded. That is
 * one database batch with each rewrite conditional on the revision it was read at, so
 * a template another author revised in the meantime refuses the deletion outright
 * rather than being quietly skipped and left referencing an entry that no longer
 * exists.
 *
 * The entry is removed from the published entries as well as the draft, and the
 * published revision advances with it. Leaving it published would mean every linked
 * template still resolved against something the author had deleted — the deletion
 * would not have happened as far as any template was concerned.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { styleSetId, entryId } = await getValidatedRouterParams(
		event,
		graphicStyleSetEntryParamsSchema.parse,
	);
	// A mode, a replacement id, and a precondition. Nothing this route accepts is a
	// document, so it is bounded far below the general mutation ceiling.
	const body = deleteGraphicStyleSetEntrySchema.parse(
		await readJsonPayloadLimited(event, 4 * 1024, 'Graphic Style Set entry deletion request'),
	);

	const service = graphicStyleSetService();
	const styleSet = await service.findById(styleSetId);
	if (!styleSet) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Style Set not found',
		});
	}

	const linked = await service.linkedTemplates(styleSetId);
	const plan = planGraphicStyleEntryDeletion(styleSet, linked, entryId, body);

	if ('code' in plan) {
		if (plan.code === 'entry-not-found') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Style Set entry not found',
			});
		}
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: refusalMessage(plan),
			data: { code: plan.code, ...('entryIds' in plan ? { entryIds: plan.entryIds } : {}) },
		});
	}

	try {
		const updated = await service.deleteEntry(styleSetId, {
			draftRevision: body.draftRevision,
			draft: plan.draft,
			published: plan.published,
			rewrites: plan.rewrites,
		});
		if (!updated) {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Style Set not found',
			});
		}

		// The templates this deletion actually rewrote, each already at its new revision.
		// Reported rather than counted, because the point of naming them is that an
		// author can go and look at one.
		return {
			styleSet: mapGraphicStyleSetToResponse(updated),
			rewrittenTemplates: plan.rewrites.map((rewrite) => {
				const template = linked.find(candidate => candidate.id === rewrite.id);
				return { id: rewrite.id, name: template?.name ?? rewrite.id, revision: rewrite.revision + 1 };
			}),
		};
	}
	catch (error) {
		rethrowAsGraphicStyleSetConflict(
			error,
			'The Graphic Style Set or one of the templates referencing this entry changed while it was being deleted',
		);
	}
});

function refusalMessage(refusal: { code: string; entryIds?: string[] }): string {
	switch (refusal.code) {
		case 'replacement-not-found':
			return 'The replacement Graphic Style Set entry does not exist';
		case 'replacement-kind-mismatch':
			return 'A Graphic Style Set entry can only be replaced by an entry of the same kind';
		case 'replacement-is-subject':
			return 'A Graphic Style Set entry cannot replace itself';
		case 'replacement-unpublished':
			return 'The replacement Graphic Style Set entry has not been published, so the templates repointed at it could not resolve it — publish the Style Set first';
		case 'detach-would-break-entries':
			return `This entry is referenced by other Graphic Style Set entries (${refusal.entryIds?.join(', ')}), which have nowhere to store a value of their own — replace it instead of detaching it`;
		default:
			return 'This Graphic Style Set entry cannot be deleted';
	}
}

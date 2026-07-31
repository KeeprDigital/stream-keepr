import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { unresolvableGraphicStyleRefs } from '~~/server/modules/graphic-style-set';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { graphicStyleSetEntryIdsInDocument } from '~~/shared/modules/graphic-style-sets';

/**
 * Prove one Broadcast Graphic Template document's Graphic Style Set link before it
 * is stored.
 *
 * A template is the *linked* artifact — the thing that receives updates, that a
 * package carries, and that a deletion has to find and rewrite — so a reference in
 * one that names nothing would make every later operation report on a template it
 * cannot act on. Storing it would put a healthy-looking entry in the library that no
 * publish, review, or deletion could ever deal with, which is exactly the failure the
 * Graphic Asset Reference check next to this one exists to prevent.
 *
 * Deliberately not applied to a Screen's authored stack. A placed Broadcast Graphic
 * never receives an update, so its references are provenance for whoever later saves
 * it as a template — and this is where that provenance is proved. Checking it on
 * every Screen write would put a Style Set read on the live authoring path for no
 * behaviour, and would refuse an operator's Screen edit because a Style Set they were
 * not touching had moved.
 */
export async function assertBroadcastGraphicTemplateStyleSetResolves(
	document: BroadcastGraphicConfig,
): Promise<void> {
	const referenced = graphicStyleSetEntryIdsInDocument(document);
	const link = document.styleSet;

	if (!link) {
		// References with no link name entries in no Style Set at all. Refusing is what
		// keeps "at most one Style Set per template" from degrading into "some of these
		// references belong to a set nobody recorded".
		if (referenced.size > 0) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: 'This composition references Graphic Style Set entries but is not linked to a Graphic Style Set',
			});
		}
		return;
	}

	const styleSet = await graphicStyleSetService().findById(link.styleSetId);
	if (!styleSet) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Graphic Style Set this composition links to does not exist',
		});
	}
	if (!styleSet.published) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: `Graphic Style Set “${styleSet.name}” has never been published, so nothing can link to it yet`,
		});
	}

	const unresolvable = unresolvableGraphicStyleRefs(document, styleSet.published);
	if (unresolvable.length > 0) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: `This composition references Graphic Style Set entries that do not resolve in “${styleSet.name}”: ${unresolvable.join(', ')}`,
		});
	}
}

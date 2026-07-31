import type { DbGraphicStyleSet } from '~~/server/db/schema';
import type {
	GraphicStyleSetResponse,
	GraphicStyleSetSummary,
} from '~~/shared/types/graphicStyleSet';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { sameGraphicStyleValue } from '~~/shared/modules/graphic-style-sets';

/**
 * The library entry a browser reads, and the full Style Set an author edits.
 *
 * `hasUnpublishedChanges` is derived rather than stored, because a stored flag is one
 * more thing that can be wrong: an author who edits an entry and puts it back has no
 * unpublished changes, and only comparing says so. The comparison is structural for
 * the same reason the update comparison is — the draft is held in memory and the
 * published entries came back out of storage, so their keys are not in the same
 * order.
 */
export function mapGraphicStyleSetToSummary(styleSet: DbGraphicStyleSet): GraphicStyleSetSummary {
	return mapTimestamps({
		id: styleSet.id,
		name: styleSet.name,
		description: styleSet.description,
		revision: styleSet.revision,
		draftRevision: styleSet.draftRevision,
		entryCount: styleSet.draft.length,
		hasUnpublishedChanges: !sameGraphicStyleValue(styleSet.draft, styleSet.published),
		createdAt: styleSet.createdAt,
		updatedAt: styleSet.updatedAt,
	});
}

export function mapGraphicStyleSetToResponse(styleSet: DbGraphicStyleSet): GraphicStyleSetResponse {
	return {
		...mapGraphicStyleSetToSummary(styleSet),
		draft: styleSet.draft,
		published: styleSet.published,
	};
}

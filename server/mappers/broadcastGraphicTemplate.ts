import type { DbBroadcastGraphicTemplate } from '~~/server/db/schema';
import type {
	BroadcastGraphicTemplateResponse,
	BroadcastGraphicTemplateSummary,
} from '~~/shared/types/broadcastGraphicTemplate';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { flattenGraphicItems } from '~~/shared/modules/graphics';

/**
 * The library entry a browser reads, and the full entry an author places or edits.
 *
 * The summary counts rather than carries: a library listing is a browse over every
 * template the installation holds, and shipping every composition in it would make
 * the list cost grow with the size of the designs rather than with their number.
 */
export function mapBroadcastGraphicTemplateToSummary(
	template: DbBroadcastGraphicTemplate,
): BroadcastGraphicTemplateSummary {
	return mapTimestamps({
		id: template.id,
		name: template.name,
		description: template.description,
		revision: template.revision,
		// Graphic Group children are Graphic Items in their own right and count as such,
		// exactly as they do against the Screen's own Graphic Item caps.
		itemCount: flattenGraphicItems(template.document).length,
		inputCount: template.document.inputs?.length ?? 0,
		createdAt: template.createdAt,
		updatedAt: template.updatedAt,
	});
}

export function mapBroadcastGraphicTemplateToResponse(
	template: DbBroadcastGraphicTemplate,
): BroadcastGraphicTemplateResponse {
	return {
		...mapBroadcastGraphicTemplateToSummary(template),
		document: template.document,
	};
}

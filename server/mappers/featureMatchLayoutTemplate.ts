import type { DbFeatureMatchLayoutTemplate } from '~~/server/db/schema';
import type {
	FeatureMatchLayoutTemplateResponse,
	FeatureMatchLayoutTemplateSummary,
} from '~~/shared/types/featureMatchLayoutTemplate';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { flattenGraphicItems } from '~~/shared/modules/graphics';

/**
 * The library entry a browser reads, and the full entry an author places or edits.
 *
 * The summary counts rather than carries, for the reason the Broadcast Graphic
 * Template listing does: a browse over every layout the installation holds must
 * cost the number of designs rather than their size.
 */
export function mapFeatureMatchLayoutTemplateToSummary(
	template: DbFeatureMatchLayoutTemplate,
): FeatureMatchLayoutTemplateSummary {
	return mapTimestamps({
		id: template.id,
		name: template.name,
		description: template.description,
		revision: template.revision,
		// Everything this store holds was authored here. An entry a Template Package
		// installed lives in the Graphics Asset Library's own record and reaches a
		// caller through the Feature Match Layout Template library module instead.
		authored: true,
		// Graphic Group children are Graphic Items in their own right and count as such,
		// exactly as they do against the Screen's own Graphic Item caps. Source Items are
		// counted apart because they are host-owned and budgeted apart.
		itemCount: flattenGraphicItems(template.document.composition).length,
		sourceCount: template.document.sources.length,
		createdAt: template.createdAt,
		updatedAt: template.updatedAt,
	});
}

export function mapFeatureMatchLayoutTemplateToResponse(
	template: DbFeatureMatchLayoutTemplate,
): FeatureMatchLayoutTemplateResponse {
	return {
		...mapFeatureMatchLayoutTemplateToSummary(template),
		document: template.document,
	};
}

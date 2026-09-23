import {
	featureMatchLayoutTemplateLibrarySummary,
	findFeatureMatchLayoutTemplateLibraryEntry,
} from '~~/server/modules/feature-match-layout-template-library';
import { featureMatchLayoutTemplateParamsSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { requireUserId } from '~~/server/utils/auth';

/**
 * One library entry with the Feature Match Layout it stores.
 *
 * Resolved from the library as a whole, so an entry a Template Package installed
 * reads exactly like one authored here. Only `authored` tells them apart, and only
 * because what a caller may *do* with them differs.
 *
 * The session is session-scoping, not access control (ADR-0010). The document
 * embeds Graphic Asset identities, the same reach-around #206 named on the
 * Broadcast Graphic Template entry.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, featureMatchLayoutTemplateParamsSchema.parse);

	const entry = await findFeatureMatchLayoutTemplateLibraryEntry(event, templateId);
	if (!entry) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Feature Match Layout Template not found',
		});
	}

	return {
		...featureMatchLayoutTemplateLibrarySummary(entry),
		document: entry.document,
	};
});

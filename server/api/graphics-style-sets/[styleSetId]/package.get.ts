import { exportGraphicStyleSetPackage } from '~~/server/modules/graphic-style-set-package';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicStyleSetParamsSchema } from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { respondWithGraphicStyleSetPackage } from '~~/server/utils/graphicStyleSetPackageApi';

/**
 * Export one Graphic Style Set as a `.skstyle` package.
 *
 * A show's style travels independently of any single template, which is why this hangs
 * off the Style Set rather than off a template that happens to link to one: the Style
 * Set library is installation-scoped, and a style is worth moving whether or not
 * anything is currently using it.
 *
 * What travels is the *published* revision, frozen whole. A draft is referentially
 * broken for most of its life, so a package carrying one would transfer something this
 * installation could not publish itself — and the receiving installation would find out
 * only when a template tried to resolve against it.
 *
 * The package carries the Style Set's stable identity, its published revision, and a
 * digest of the entries at that revision. Unlike a Template Package, that trio is not
 * only for recognition: a receiver preserves the identity and revision on first import,
 * which is what lets a later package of the same Style Set update the result rather
 * than land beside it as an unrelated second copy. It is still not a link — nothing
 * follows it back, and this installation learns nothing about any import.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);

	const styleSet = await graphicStyleSetService().findById(styleSetId);
	if (!styleSet) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Style Set not found',
		});
	}

	const outcome = await exportGraphicStyleSetPackage({
		styleSet,
		now: () => new Date(),
	});
	return respondWithGraphicStyleSetPackage(event, outcome);
});

import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { createGraphicStyleSetSchema } from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Create one Graphic Style Set.
 *
 * It starts unpublished — revision zero, with a draft and no published entries — so
 * no template can link to it until an author has published something whole. An
 * initial draft may be supplied, which is what a `.skstyle` import will hand it.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const body = createGraphicStyleSetSchema.parse(await readBody(event));

	const styleSet = await graphicStyleSetService().create({
		id: randomUuid(),
		name: body.name,
		description: body.description ?? null,
		draft: body.draft ?? [],
	});

	setResponseStatus(event, 201);
	return mapGraphicStyleSetToResponse(styleSet);
});

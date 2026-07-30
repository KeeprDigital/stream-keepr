import { z } from 'zod';
import { screenOutputAssetDeliveryForEvent } from '~~/server/modules/screen-output-assets/runtime';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { screenOutputAssetCapabilityCookieName } from '~~/shared/utils/graphicsAssetReferences';

const paramsSchema = z.object({
	screenId: z.coerce.number().int().positive(),
	assetId: z.string().min(1).max(100),
	revisionId: z.string().min(1).max(100),
});

function cookieCapability(value: string | undefined): string | undefined {
	return /^[\w-]{20,200}$/.test(value ?? '') ? value : undefined;
}

export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, paramsSchema.parse);
	const authorization = getRequestHeader(event, 'authorization');
	const capability = authorization === undefined
		? cookieCapability(getCookie(event, screenOutputAssetCapabilityCookieName(params.screenId)))
		: bearerScreenOutputCapability(authorization);
	if (!capability) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Asset Revision is not available to this Screen Output',
		});
	}
	const requestHeaders = new Headers();
	for (const [name, value] of Object.entries(getRequestHeaders(event))) {
		if (value)
			requestHeaders.set(name, value);
	}
	const delivery = await screenOutputAssetDeliveryForEvent(event);
	const result = await delivery.deliver({
		screenId: params.screenId,
		capability,
		assetId: params.assetId,
		revisionId: params.revisionId,
		headers: requestHeaders,
	});
	if (result.outcome === 'missing') {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Asset Revision is not available to this Screen Output',
		});
	}
	if (result.outcome === 'unavailable') {
		setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset delivery is temporarily unavailable',
		});
	}
	return result.response;
});

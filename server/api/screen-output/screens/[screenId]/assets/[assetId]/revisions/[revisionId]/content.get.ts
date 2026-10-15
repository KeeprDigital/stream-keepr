import { z } from 'zod';
import { screenOutputAssetDeliveryForEvent } from '~~/server/modules/screen-output-assets/runtime';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
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
		// The cause is what carries this sentence past the 5xx sanitizer. This is the
		// one refusal an on-air output meets while its item is already missing, and
		// 'Internal Server Error' does not distinguish a store that will be back from
		// a Screen that has to be reconfigured (#321).
		const cause = new TemporarilyUnavailableError('Screen Output asset delivery is temporarily unavailable');
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
		});
	}
	return result.response;
});

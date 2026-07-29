import { db } from 'hub:db';
import { z } from 'zod';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import {
	screenOutputAssetCapabilityCookieName,
	screenOutputAssetCapabilityCookiePath,
} from '~~/shared/utils/graphicsAssetReferences';

const paramsSchema = z.object({
	screenId: z.coerce.number().int().positive(),
});

export default defineEventHandler(async (event) => {
	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));
	if (!capability) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen Output asset capability is unavailable',
		});
	}
	const { screenId } = await getValidatedRouterParams(event, paramsSchema.parse);
	let authorization: { outcome: 'authorized' } | { outcome: 'missing' };
	try {
		authorization = await createD1ScreenOutputAssetAuthorizer(db.$client).authorizeCapability({
			screenId,
			capabilityDigest: await screenOutputAssetCapabilityDigest(capability),
		});
	}
	catch {
		setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Screen Output asset capability session is temporarily unavailable',
		});
	}
	if (authorization.outcome === 'missing') {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen Output asset capability is unavailable',
		});
	}
	setCookie(event, screenOutputAssetCapabilityCookieName(screenId), capability, {
		httpOnly: true,
		path: screenOutputAssetCapabilityCookiePath(screenId),
		sameSite: 'strict',
		secure: getRequestURL(event).protocol === 'https:',
	});
	setResponseHeader(event, 'cache-control', 'private, no-store');
	setResponseStatus(event, 204);
	return null;
});

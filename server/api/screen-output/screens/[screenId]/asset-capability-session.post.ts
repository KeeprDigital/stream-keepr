import { db } from 'hub:db';
import { z } from 'zod';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';
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
	let authorization:
		| { outcome: 'authorized' }
		| { outcome: 'missing' }
		| { outcome: 'incompatible'; code: 'vp9-alpha-chromium-required' };
	try {
		authorization = await createD1ScreenOutputAssetAuthorizer(db.$client).authorizeCapability({
			screenId,
			capabilityDigest: await screenOutputAssetCapabilityDigest(capability),
			actualVideoTarget: graphicsVideoTargetForUserAgent(
				getRequestHeader(event, 'user-agent') ?? '',
			),
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
	if (authorization.outcome === 'incompatible') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'This Screen Output contains VP9 alpha video that requires Chromium transparency playback.',
			data: { code: authorization.code },
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

import { z } from 'zod';
import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
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
	// The same proxy its siblings in `screen-output-assets/runtime.ts` resolve
	// through, so an unreachable catalogue presents as unreachable rather than as
	// reachable-but-empty on every screen-output path (#190).
	const authorizer = createD1ScreenOutputAssetAuthorizer(graphicsCatalogueClient());
	const capabilityDigest = await screenOutputAssetCapabilityDigest(capability);
	let authorization: { outcome: 'authorized' } | { outcome: 'missing' };
	let unplayableRevisions: Array<{ assetId: string; revisionId: string; code: string }>;
	try {
		authorization = await authorizer.authorizeCapability({ screenId, capabilityDigest });
		unplayableRevisions = authorization.outcome === 'authorized'
			? await authorizer.unplayableRevisions({
					screenId,
					capabilityDigest,
					actualVideoTarget: graphicsVideoTargetForUserAgent(
						getRequestHeader(event, 'user-agent') ?? '',
					),
				})
			: [];
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
	// A session is opened for every engine, whatever the Screen publishes. Playback
	// compatibility is answered per resolution request, so a clip this browser
	// cannot play costs the output that clip and nothing else (#98).
	setCookie(event, screenOutputAssetCapabilityCookieName(screenId), capability, {
		httpOnly: true,
		path: screenOutputAssetCapabilityCookiePath(screenId),
		sameSite: 'strict',
		secure: getRequestURL(event).protocol === 'https:',
	});
	setResponseHeader(event, 'cache-control', 'private, no-store');
	// And it says which of them that will be. The decision is still the per-request
	// one against the requested revision's own facts; this is the same answer given
	// early, so an output stops having to predict it from the compatibility copied
	// into a Media Graphic Item's configuration — a copy those facts can outlive,
	// and one whose disagreement produced exactly the blank rectangle #98 removed
	// (#184). It varies by engine, and the response is already uncacheable.
	return { unplayableRevisions };
});

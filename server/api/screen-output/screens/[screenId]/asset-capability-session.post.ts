import { z } from 'zod';
import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
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
	// The same proxy its siblings in `screen-output-assets/runtime.ts` resolve
	// through, so an unreachable catalogue presents as unreachable rather than as
	// reachable-but-empty on every screen-output path (#190).
	const authorizer = createD1ScreenOutputAssetAuthorizer(graphicsCatalogueClient());
	const capabilityDigest = await screenOutputAssetCapabilityDigest(capability);
	let authorization: { outcome: 'authorized' } | { outcome: 'missing' };
	try {
		authorization = await authorizer.authorizeCapability({ screenId, capabilityDigest });
	}
	catch (failure) {
		setResponseHeader(event, 'retry-after', 5);
		// The cause is what carries this sentence past the 5xx sanitizer, and the
		// authorizer's own failure rides along inside it: an output that cannot open a
		// session resolves no content URL for anything the Screen publishes, so
		// 'Internal Server Error' was the whole of what an operator got for a blank
		// Screen (#321). The authorizer's own exception is kept as `cause`, where a
		// debugger can reach it; the log line names this class, not the store's
		// refusal, because `errorLogFields` reads a single level of cause.
		const cause = new TemporarilyUnavailableError(
			'Screen Output asset capability session is temporarily unavailable',
			{ cause: failure },
		);
		throw createError({
			statusCode: cause.statusCode,
			statusMessage: 'Service Unavailable',
			message: cause.message,
			cause,
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

	// An empty object rather than no body: an output still running a client from
	// before ADR-0020 reads a missing forecast as "nothing refused", which is now
	// the whole truth.
	return {};
});

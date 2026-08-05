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
	try {
		authorization = await authorizer.authorizeCapability({ screenId, capabilityDigest });
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

	/**
	 * And it says which of them that will be.
	 *
	 * The decision is still the per-request one against the requested revision's own
	 * facts; this is the same answer given early, so an output stops having to
	 * predict it from the compatibility copied into a Media Graphic Item's
	 * configuration — a copy those facts can outlive, and one whose disagreement
	 * produced exactly the blank rectangle #98 removed (#184). It varies by engine,
	 * and the response is already uncacheable.
	 *
	 * Computed after the session is granted, and never able to withdraw it. This is
	 * a second query for advisory data, and an output refused a session resolves no
	 * content URL for *anything* — so failing the session on it would reopen the
	 * whole-output loss #98 closed, by a new route: one unreadable advisory list
	 * costing the operator every image, video, and font the Screen publishes. An
	 * output that is offered no forecast falls back to exactly the behaviour it had
	 * before this existed, which is a per-item blank rectangle at worst rather than
	 * a Screen with no media at all.
	 *
	 * The forecast is a snapshot at session open. It is not re-read when a revision's
	 * technical facts change, and nothing in the client's resolution key notices that
	 * they have — a revision id does not change when its facts do. So facts corrected
	 * after this instant leave the output painting a notice for a clip the server
	 * would now serve. That is the opposite staleness to the one #184 fixed, and the
	 * safer of the two: a legible reason rather than a blank rectangle, cleared by
	 * the next session the output opens.
	 */
	const unplayableRevisions = await authorizer.unplayableRevisions({
		screenId,
		capabilityDigest,
		actualVideoTarget: graphicsVideoTargetForUserAgent(
			getRequestHeader(event, 'user-agent') ?? '',
		),
	}).catch(() => []);
	return { unplayableRevisions };
});

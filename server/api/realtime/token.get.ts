import { z } from 'zod';
import { graphicsCatalogueClient } from '~~/server/modules/graphics-asset-library/runtime';
import { createD1ScreenOutputAssetAuthorizer } from '~~/server/modules/screen-output-assets/authorizer';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { eventService } from '~~/server/services/event';
import { getAblyClient } from '~~/server/utils/ably';
import { optionalUserSession } from '~~/server/utils/auth';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { eventRealtimeChannel, screenChannelWildcard, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';

/**
 * `GET /api/realtime/token` — an Ably token request, granted to whoever asked
 * (#397, ADR-0010's dual grant).
 *
 * **No anonymous issuance.** This route stays on the boundary's allowlist because a
 * Screen Output has no session to present, not because it is public: until #397 it
 * handed any caller a grant over every channel of any Event they named, which is the
 * hole the allowlist entry was keeping open. Two credentials are recognised now and
 * a request carrying neither is refused.
 *
 * The two grants differ in reach as well as identity:
 *
 * - **A signed-in user** gets the grant this route always issued — the Event channel
 *   plus every Screen channel under it — because an operator's surfaces move between
 *   Screens and subscribe to whichever they are showing.
 * - **A capability bearer** gets one Screen's channel and its Event's, and nothing
 *   else. A Screen Output only ever needs its own, and the capability names which
 *   Screen without being asked (`screenForCapability`), so the narrowing costs the
 *   caller nothing it could legitimately want.
 *
 * `clientId` is pinned in both, where it used to be `'*'` — a wildcard that let the
 * holder claim any identity on the channel it was granted. **This requires the
 * client not to declare its own**: Ably refuses a connection whose `clientId`
 * conflicts with its token's, so `app/plugins/realtime.client.ts` no longer passes
 * one and takes what the token carries. Nothing reads `member.clientId` — presence
 * consumers read `member.data` — so pinning it changes no reader, and two outputs of
 * one Screen remain two presence members because presence is per connection.
 *
 * The Event is **derived** from a capability rather than trusted from the query, so a
 * bearer for one Event's Screen cannot ask for a grant over another's.
 */

const tokenQuerySchema = z.object({
	eventId: z.coerce.number().int().positive(),
});

/**
 * The Ably identity a Screen Output connects as.
 *
 * Legible on purpose: it appears in Ably's own dashboards and in presence, and
 * "which Screen is this" is the only question anybody asks of it there.
 */
export function screenOutputRealtimeClientId(screenId: number): string {
	return `screen-output:${screenId}`;
}

export default defineEventHandler(async (event) => {
	const { eventId } = await getValidatedQuery(event, tokenQuerySchema.parse);

	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));
	if (capability) {
		const authorizer = createD1ScreenOutputAssetAuthorizer(graphicsCatalogueClient());
		const screen = await authorizer.screenForCapability({
			capabilityDigest: await screenOutputAssetCapabilityDigest(capability),
		});
		// The Event must be the capability's own. A bearer that names somebody else's
		// falls through to the session arm and is refused with everything else, rather
		// than being told which half of its request was wrong.
		if (screen && screen.eventId === eventId) {
			return await getAblyClient().auth.createTokenRequest({
				clientId: screenOutputRealtimeClientId(screen.screenId),
				capability: {
					[eventRealtimeChannel(eventId)]: ['subscribe', 'history'],
					[screenRealtimeChannel(eventId, screen.screenId)]: ['subscribe', 'history', 'presence'],
				},
			});
		}
	}

	const session = await optionalUserSession(event);
	if (!session) {
		throw createError({
			statusCode: 401,
			statusMessage: 'Unauthorized',
			message: 'A session or a Screen Output Asset Capability is required',
		});
	}

	// Only the session arm checks this. A capability bearer's Event came from the
	// capability, so it exists by construction — and asking again would be a second
	// query to confirm what a foreign key already says.
	if (!await eventService().exists(eventId))
		throw createError({ statusCode: 404, message: 'Event not found' });

	// Event updates stay read-only for clients. Screen channels only need
	// subscribe/presence; admin commands publish through the server API.
	return await getAblyClient().auth.createTokenRequest({
		clientId: session.user.id,
		capability: {
			[eventRealtimeChannel(eventId)]: ['subscribe', 'history'],
			[screenChannelWildcard(eventId)]: ['subscribe', 'history', 'presence'],
		},
	});
});

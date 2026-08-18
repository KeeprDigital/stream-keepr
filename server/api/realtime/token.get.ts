import { z } from 'zod';
import { eventService } from '~~/server/services/event';
import { getAblyClient } from '~~/server/utils/ably';
import { eventRealtimeChannel, screenChannelWildcard } from '~~/shared/utils/realtimeChannels';

// This route sits outside `/api/events/[id]/**`, so the numeric event-exists
// middleware doesn't run for it — validate the eventId query param inline.
const tokenQuerySchema = z.object({
	eventId: z.coerce.number().int().positive(),
});

export default defineEventHandler(async (event) => {
	const { eventId } = await getValidatedQuery(event, tokenQuerySchema.parse);

	const exists = await eventService().exists(eventId);
	if (!exists) {
		throw createError({ statusCode: 404, message: 'Event not found' });
	}

	const rest = getAblyClient();

	// Event updates stay read-only for clients. Screen channels only need
	// subscribe/presence; admin commands publish through the server API.
	// TODO(#397): narrow this grant. The condition this said "once auth is
	// implemented" was met by #396, which left the route on the boundary's
	// allowlist because a Screen Output has no session to present — so an
	// unauthenticated caller still gets the full grant below. #397 is the ticket
	// that owns the fix: ADR-0010's dual grant, where a signed-in user gets this
	// shape with `clientId` set to their userId and a capability bearer gets one
	// narrowed to that screen's channels.
	const tokenRequest = await rest.auth.createTokenRequest({
		clientId: '*',
		capability: {
			[eventRealtimeChannel(eventId)]: ['subscribe', 'history'],
			[screenChannelWildcard(eventId)]: ['subscribe', 'history', 'presence'],
		},
	});

	return tokenRequest;
});

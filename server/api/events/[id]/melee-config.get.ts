import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	// The middleware's existence check is a separate, earlier query — see the
	// note in `index.get.ts`. Trusting it here answered 500 for an Event
	// deleted between the two (#309).
	const eventData = await eventService().findById(id);
	if (!eventData) {
		throw createError({ statusCode: 404, statusMessage: 'Event not found' });
	}

	// Never return meleeClientSecret in API responses.
	// meleeConfigured signals to the frontend whether credentials are stored.
	// The condition this said "once auth is implemented" was met by #396: the
	// boundary refuses this path without a Better Auth session, so the client id
	// no longer reaches an anonymous caller. Gating it behind *the owning user*
	// specifically needs a permissions model, which ADR-0010 rules out of scope
	// and names as successor work — not a task available today.
	return {
		meleeEnabled: eventData.meleeEnabled,
		meleeEventId: eventData.meleeEventId,
		meleeClientId: eventData.meleeClientId,
		meleeConfigured: !!(eventData.meleeClientId && eventData.meleeClientSecret),
	};
});

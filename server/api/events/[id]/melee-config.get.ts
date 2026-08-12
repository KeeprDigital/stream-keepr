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
	// TODO(auth): gate meleeClientId behind the owning user once auth is implemented.
	return {
		meleeEnabled: eventData.meleeEnabled,
		meleeEventId: eventData.meleeEventId,
		meleeClientId: eventData.meleeClientId,
		meleeConfigured: !!(eventData.meleeClientId && eventData.meleeClientSecret),
	};
});

import { eventParamsSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const eventData = (await eventService().findById(id))!;

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

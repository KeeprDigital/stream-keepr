import { mapEventToResponse } from '~~/server/mappers/event';
import { createEventSchema } from '~~/server/schemas/api/event';
import { eventService } from '~~/server/services/event';
import { featureMatchService } from '~~/server/services/featureMatch';

export default defineEventHandler(async (event) => {
	const body = await readValidatedBody(event, createEventSchema.parse);
	const newEvent = await eventService().create(body);

	try {
		await featureMatchService().syncFeatureMatches(newEvent.id, newEvent.numFeatureMatches);
	}
	catch (error) {
		// Event creation is an aggregate operation: callers must never observe an
		// Event whose configured Feature Match Slots failed to initialise. D1
		// cannot compose these service-level reads into one batch, so compensate
		// the first write before surfacing the original failure.
		await eventService().remove(newEvent.id);
		throw error;
	}

	setResponseStatus(event, 201);
	return mapEventToResponse(newEvent);
});

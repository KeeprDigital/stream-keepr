import { z } from 'zod';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenConfigPatchSchema, screenParamsSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { optionalBrowserSessionId } from '~~/server/utils/auth';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

const versionedPatchSchema = z.object({
	stateVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const rawBody = await readJsonPayloadLimited(event, 64 * 1024, 'Screen configuration');
	const { stateVersion, ...rawConfig } = versionedPatchSchema.parse(rawBody);
	const body = screenConfigPatchSchema.partial().parse(rawConfig);

	return await screenWriteModule().updateScreenConfig({
		eventId,
		screenId,
		config: body,
		stateVersion,
		originConnectionId: getOriginConnectionId(event),
		// A Broadcast Graphics Screen's canvas belongs to its leased graphics Edit
		// workspace; every other field here stays open to live operation.
		authoringSessionId: await optionalBrowserSessionId(event),
	});
});

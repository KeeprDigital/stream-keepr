import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenParamsSchema, screenThemeOverridesPatchSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Set or clear (`null`) Screen Theme Overrides, announced as `screen:updated`. */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const { tokens, stateVersion } = await readValidatedBody(event, screenThemeOverridesPatchSchema.parse);
	return await screenWriteModule().updateThemeOverrides({
		eventId,
		screenId,
		tokens,
		stateVersion,
		originConnectionId: getOriginConnectionId(event),
	});
});

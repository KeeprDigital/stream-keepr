import { z } from 'zod';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireScreenGraphicsEditWritable } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { modeConfigParamsSchema, modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

const versionedPatchSchema = z.object({
	stateVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId, mode } = await getValidatedRouterParams(event, modeConfigParamsSchema.parse);

	// The Broadcast Graphics stack is the Screen's graphics Edit workspace, so an
	// authoring write to it belongs to whichever session holds that workspace's
	// Graphics Authoring Lease. Live Control reaches the Screen through its own
	// live command surface and is never admitted here.
	if (mode === 'broadcast-graphics')
		await requireScreenGraphicsEditWritable(event, eventId, screenId);

	// Validate body against the mode-specific PATCH schema.
	// Optional fields accept null as a sentinel meaning "delete this key".
	const schema = modeConfigPatchSchemaMap[mode];
	const rawBody = await readJsonPayloadLimited(event, 512 * 1024, 'Screen mode configuration');
	const { stateVersion, ...rawConfig } = versionedPatchSchema.parse(rawBody);
	const body = schema.parse(rawConfig);

	return await screenWriteModule({
		graphicsAssets: graphicsAssetLibraryForEvent(event),
	}).updateModeConfig({
		eventId,
		screenId,
		mode,
		config: body,
		stateVersion,
		originConnectionId: getOriginConnectionId(event),
	});
});

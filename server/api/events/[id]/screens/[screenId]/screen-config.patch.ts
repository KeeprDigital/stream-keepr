import { z } from 'zod';
import { requireBroadcastGraphicsCanvasWritable } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenConfigPatchSchema, screenParamsSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

const versionedPatchSchema = z.object({
	stateVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const rawBody = await readJsonPayloadLimited(event, 64 * 1024, 'Screen configuration');
	const { stateVersion, ...rawConfig } = versionedPatchSchema.parse(rawBody);
	const body = screenConfigPatchSchema.partial().parse(rawConfig);

	// A Broadcast Graphics Screen's canvas is part of its graphics Edit workspace,
	// so resizing it belongs to whichever session holds that workspace's Graphics
	// Authoring Lease. Nothing else on this route is lease-checked: it serves every
	// Screen Mode and every generic Screen field, and live operation must stay open.
	if (body.width !== undefined || body.height !== undefined)
		await requireBroadcastGraphicsCanvasWritable(event, eventId, screenId);

	return await screenWriteModule().updateScreenConfig({
		eventId,
		screenId,
		config: body,
		stateVersion,
		originConnectionId: getOriginConnectionId(event),
	});
});

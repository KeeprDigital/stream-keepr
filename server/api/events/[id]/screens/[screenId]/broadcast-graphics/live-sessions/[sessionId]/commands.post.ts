import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	broadcastGraphicsCommandSchema,
	broadcastGraphicsLiveSessionParamsSchema,
} from '~~/server/schemas/api/broadcastGraphicsLiveSession';
import { getOriginConnectionId } from '~~/server/utils/ably';

/**
 * One playout action, named by the Live Session epoch it belongs to.
 *
 * Naming the epoch in the path is what makes a stale retry from an ended show
 * recognisable: it addresses a session that no longer accepts commands rather
 * than whichever epoch the Screen happens to own now.
 */
export default defineEventHandler(async (event) => {
	const { id, screenId, sessionId } = await getValidatedRouterParams(
		event,
		broadcastGraphicsLiveSessionParamsSchema.parse,
	);
	const command = await readValidatedBody(event, broadcastGraphicsCommandSchema.parse);

	return await broadcastGraphicsLiveSessionModule().applyCommand({
		eventId: id,
		screenId,
		sessionId,
		command,
		originConnectionId: getOriginConnectionId(event),
		// The library is injected because Take is admitted against it: a Broadcast
		// Graphic whose pinned revision no longer resolves cannot go on air. A thunk
		// because most commands never ask it anything.
		graphicsAssets: () => graphicsAssetLibraryForEvent(event),
	});
});

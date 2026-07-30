import { broadcastGraphicsSessionModule } from '~~/server/modules/broadcast-graphics-session';
import {
	broadcastGraphicsCommandSchema,
	broadcastGraphicsSessionParamsSchema,
} from '~~/server/schemas/api/broadcastGraphicsSession';
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
		broadcastGraphicsSessionParamsSchema.parse,
	);
	const command = await readValidatedBody(event, broadcastGraphicsCommandSchema.parse);

	return await broadcastGraphicsSessionModule().applyCommand({
		eventId: id,
		screenId,
		sessionId,
		command,
		originConnectionId: getOriginConnectionId(event),
	});
});

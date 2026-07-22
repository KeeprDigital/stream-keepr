import type { H3Event } from 'h3';
import { screenCommandSchema, screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { publishScreenCommand } from '~~/server/utils/ably';

async function assertTrustedScreenCommandBoundary(_event: H3Event, _eventId: number, _screenId: number) {
	// This route is intentionally limited to the current trusted admin surface.
	// Replace this with event-scoped admin authorization when auth is introduced.
}

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const { command } = await readValidatedBody(event, screenCommandSchema.parse);

	const screen = await screenService().findById(screenId, eventId);
	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	await assertTrustedScreenCommandBoundary(event, eventId, screenId);
	await publishScreenCommand(eventId, screenId, command);

	return { ok: true };
});

import type { H3Event } from 'h3';
import { screenCommandSchema, screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { publishScreenCommand } from '~~/server/utils/ably';

async function assertTrustedScreenCommandBoundary(_event: H3Event, _eventId: number, _screenId: number) {
	// This route is intentionally limited to the current trusted admin surface.
	//
	// It said "when auth is introduced" until #396, and auth is introduced: the
	// deny-by-default boundary (`server/middleware/api-session.ts`) now refuses
	// this path without a Better Auth session. What it does not do is scope the
	// permission — any signed-in user may command any Screen — and narrowing that
	// is a roles-and-permissions effort ADR-0010 rules out of its own scope and
	// names as the successor work. So this stays empty on purpose, and is not a
	// task anybody can pick up today.
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

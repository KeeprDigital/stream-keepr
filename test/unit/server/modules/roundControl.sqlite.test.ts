import type { RoundControlMode } from '~~/shared/types/enums';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/*
 * Enabling manual override stores the Round's control mode and announces the
 * stored Round once, from the request's connection; a Round already under
 * manual override is answered as it stands, with nothing announced.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn(async (..._message: unknown[]) => {});
const request = stubH3Event({ connectionId: 'origin-1' });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	publishScreenCommand: async () => {},
	getOriginConnectionId: (event: { connectionId?: string }) => event.connectionId,
}));

const { roundControlModule } = await import('~~/server/modules/round-control');

beforeEach(() => publishMessage.mockClear());
afterAll(async () => await harness.close());

async function stageRound(controlMode: RoundControlMode) {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Round Control Open', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
			controlMode,
		})
		.returning();
	return { eventId, roundId: round!.id };
}

describe('enabling manual override on a Round', () => {
	it.each([
		{ from: 'default', announces: 1 },
		{ from: 'manual_override', announces: 0 },
	] as const)('from $from leaves it under manual override and announces it $announces time(s)', async ({ from, announces }) => {
		const { eventId, roundId } = await stageRound(from);

		const round = await roundControlModule().enableManualOverride(request, eventId, roundId);

		expect(round).toMatchObject({ id: roundId, controlMode: 'manual_override' });
		const [stored] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
		expect(stored?.controlMode).toBe('manual_override');
		expect(publishMessage.mock.calls).toEqual([
			[
				eventId,
				'round:updated',
				{ round },
				'origin-1',
			],
		].slice(0, announces));
	});

	it('refuses a Round another Event holds, announcing nothing', async () => {
		const { roundId } = await stageRound('default');
		const other = await stageRound('default');

		await expect(roundControlModule().enableManualOverride(request, other.eventId, roundId))
			.rejects
			.toMatchObject({ statusCode: 404 });

		const [stored] = await db.select().from(schema.rounds).where(eq(schema.rounds.id, roundId));
		expect(stored?.controlMode).toBe('default');
		expect(publishMessage).not.toHaveBeenCalled();
	});
});

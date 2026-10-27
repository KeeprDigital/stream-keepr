import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Who may take an Event's Melee Sync lease, over real SQL. Polling never
// blocks an operator: an operator command takes a Live Results tick's lease
// at once, but never another operator command's, and a tick never takes one.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
}));

const { acquireMeleeSyncLease, renewMeleeSyncLease } = await import('~~/server/utils/meleeSyncState');

afterAll(async () => await harness.close());

const now = new Date('2026-10-27T12:00:00.000Z');
const heldUntil = new Date('2026-10-27T12:02:00.000Z');

async function eventHeldBy(command: string) {
	const [event] = await db.insert(schema.events).values({
		name: 'Lease',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeSyncLeaseToken: 'holder-token',
		meleeSyncLeaseCommand: command,
		meleeSyncLeaseExpiresAt: heldUntil,
	}).returning();
	return event!.id;
}

async function leaseOf(eventId: number) {
	const event = (await db.query.events.findFirst({
		where: eq(schema.events.id, eventId),
	}))!;
	return { token: event.meleeSyncLeaseToken, command: event.meleeSyncLeaseCommand };
}

describe('acquiring the Melee Sync lease', () => {
	it.each([
		{
			case: 'an operator command takes it from a tick',
			holder: 'live-results',
			command: 'update',
			outcome: 'acquired',
		},
		{
			case: 'configuration takes it from a tick',
			holder: 'live-results',
			command: 'configuration',
			outcome: 'acquired',
		},
		{
			case: 'an operator command never takes it from another',
			holder: 'round',
			command: 'update',
			outcome: 409,
		},
		{
			case: 'a tick never takes it from an operator command',
			holder: 'update',
			command: 'live-results',
			outcome: 409,
		},
		{
			case: 'a tick never takes it from another tick',
			holder: 'live-results',
			command: 'live-results',
			outcome: 409,
		},
	] as const)('$case', async ({ holder, command, outcome }) => {
		const eventId = await eventHeldBy(holder);

		const result = await acquireMeleeSyncLease(eventId, command, { now, token: 'new-token' })
			.catch((error: { statusCode: number; data: unknown }) => error);

		if (outcome === 'acquired') {
			expect(result).toMatchObject({ token: 'new-token', command });
			expect(await leaseOf(eventId)).toEqual({ token: 'new-token', command });
			// The tick's checkpoint renews by token, so it now finds its lease gone.
			expect(await renewMeleeSyncLease(eventId, 'holder-token', { now })).toBe(false);
		}
		else {
			expect(result).toMatchObject({
				statusCode: 409,
				data: {
					code: 'MELEE_SYNC_IN_PROGRESS',
					command: holder,
					retryAt: heldUntil.toISOString(),
				},
			});
			expect(await leaseOf(eventId)).toEqual({ token: 'holder-token', command: holder });
		}
	});
});

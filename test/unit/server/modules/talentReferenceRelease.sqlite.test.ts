import type { Mock } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Deleting a Talent releases every Talent Screen reference to it in the same
 * write: a one-Talent Screen unsets it, a lineup drops it and keeps its order.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const publication = new Proxy({} as Record<string, Mock>, {
	get: (spies, name: string) => spies[name] ??= vi.fn(async (input?: { entity?: unknown }) => input?.entity),
});
vi.doMock('~~/server/modules/event-data-publication', async importOriginal => ({
	...await importOriginal<object>(),
	eventDataPublicationModule: () => publication,
}));

const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { talentWriteModule } = await import('~~/server/modules/talent-write');

beforeEach(() => vi.clearAllMocks());
afterAll(async () => await harness.close());

let seeded = 0;
async function seed(talentConfig: (ids: { doomed: number; first: number; last: number }) => Record<string, unknown>) {
	const label = `talent-${++seeded}`;
	const [event] = await db.insert(schema.events).values({ name: label, game: 'mtg', featureMatchOrientation: 'horizontal' }).returning();
	const eventId = event!.id;
	const [first, doomed, last] = await db.insert(schema.eventTalents)
		.values([
			{ eventId, name: 'First' },
			{ eventId, name: 'Doomed' },
			{ eventId, name: 'Last' },
		])
		.returning({ id: schema.eventTalents.id });
	const ids = { first: first!.id, doomed: doomed!.id, last: last!.id };
	const screen = await screenService().create(eventId, {
		name: label,
		slug: label,
		currentMode: 'talent',
		modeConfigs: { talent: talentConfig(ids) },
	} as never, { assetCapabilitySeed: `seed-${label}`, assetCapabilityVersion: 1, assetCapabilityDigest: `digest-${label}` });
	return { eventId, ids, screen };
}

describe('deleting a Talent releases the Talent Screens naming it', () => {
	it.each([
		{
			name: 'unsets a one-Talent Screen\'s Talent',
			config: ({ doomed }: { doomed: number }) => ({ selection: 'one', talentId: doomed }),
			released: () => ({ selection: 'one' }),
		},
		{
			name: 'drops it from a lineup, keeping the others in order',
			config: ({ doomed, first, last }: { doomed: number; first: number; last: number }) => ({ selection: 'lineup', talentIds: [last, doomed, first] }),
			released: ({ first, last }: { first: number; last: number }) => ({ selection: 'lineup', talentIds: [last, first] }),
		},
		{
			name: 'releases a kept choice the Screen is not showing',
			config: ({ doomed, first }: { doomed: number; first: number }) => ({ selection: 'lineup', talentId: doomed, talentIds: [first] }),
			released: ({ first }: { first: number }) => ({ selection: 'lineup', talentIds: [first] }),
		},
	])('$name, announcing the Screen first', async ({ config, released }) => {
		const { eventId, ids, screen } = await seed(config);

		await talentWriteModule().deleteTalent({ eventId, talentId: ids.doomed, originConnectionId: 'origin' });

		const stored = await screenService().findById(screen.id, eventId);
		expect(stored?.stateVersion).toBe(screen.stateVersion + 1);
		expect(stored?.modeConfigs?.talent).toEqual(released(ids));
		expect(publication.screenUpdated!.mock.calls).toEqual([
			[{ eventId, entity: expect.objectContaining({ id: screen.id }) }],
		]);
		expect(publication.screenUpdated!.mock.invocationCallOrder[0]).toBeLessThan(publication.talentDeleted!.mock.invocationCallOrder[0]!);

		// The released Screen can be written whole again.
		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: { stateVersion: stored!.stateVersion, modeConfigs: stored!.modeConfigs } as never,
		})).resolves.toMatchObject({ stateVersion: stored!.stateVersion + 1 });
	});

	it('leaves a Screen naming other Talents alone', async () => {
		const { eventId, ids, screen } = await seed(({ first, last }) => ({ selection: 'lineup', talentId: last, talentIds: [first, last] }));

		await talentWriteModule().deleteTalent({ eventId, talentId: ids.doomed });

		expect(await screenService().findById(screen.id, eventId)).toMatchObject({ stateVersion: screen.stateVersion, modeConfigs: screen.modeConfigs });
		expect(publication.screenUpdated).not.toHaveBeenCalled();
	});
});

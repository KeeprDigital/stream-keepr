import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Screen write over real SQL: the row it stores, what it answers, and what it
// announces. Only Ably, the Screen Card's key-value store and the capability
// signer are faked. An Event Reference from another Event is
// `screenModeEventReferences.sqlite.test.ts`'s; Graphic Asset References, the
// Live Session and the library port are `screenWrite.test.ts`'s.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const ably = createAblyRestFake();
vi.doMock('ably', () => ably.module);
vi.stubGlobal('useRuntimeConfig', () => ({ ablyApiKey: 'test-key' }));

/** Each Screen Card the write cleaned out of the key-value store, with whether its Screen row was already gone. */
const cleanedCards: { screenId: number; afterRowDeleted: boolean }[] = [];
vi.doMock('~~/server/services/card', () => ({
	cardService: () => ({
		cleanupDeletedScreenCard: async (_eventId: number, screenId: number) => {
			const row = await db.query.screens.findFirst({
				where: eq(schema.screens.id, screenId),
			});
			cleanedCards.push({ screenId, afterRowDeleted: row === undefined });
		},
	}),
}));

const { screenWriteModule } = await import('~~/server/modules/screen-write');

/** The capability a create persists; preparing one is what would need the signing key. */
const prepared = {
	capability: 'opaque-capability',
	persisted: {
		assetCapabilitySeed: 'prepared-seed',
		assetCapabilityVersion: 1,
		assetCapabilityDigest: 'prepared-digest',
	},
};
let capabilitiesPrepared = 0;
function provideCapabilities() {
	return {
		prepare: async () => {
			capabilitiesPrepared += 1;
			return prepared;
		},
	};
}
function provideUnusedGraphicsAssets(): never {
	throw new Error('A mode that pins no Graphic Asset References must not build the library');
}

const [event] = await db.insert(schema.events)
	.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
	.returning({ id: schema.events.id });
const eventId = event!.id;

let slugs = 0;
async function stageScreen(values: Partial<typeof schema.screens.$inferInsert> = {}) {
	slugs += 1;
	const [screen] = await db.insert(schema.screens)
		.values({
			eventId,
			name: `Screen ${slugs}`,
			slug: `screen-${slugs}`,
			currentMode: 'standings',
			assetCapabilitySeed: `seed-${slugs}`,
			assetCapabilityDigest: `digest-${slugs}`,
			...values,
		})
		.returning();
	return screen!;
}

async function stored(screenId: number) {
	return await db.query.screens.findFirst({
		where: eq(schema.screens.id, screenId),
	});
}

/** What the Event's channel was sent, as `[type, payload]`. */
function announced() {
	return ably.on(eventRealtimeChannel(eventId)).map(({ type, payload }) => [type, payload]);
}

beforeEach(() => {
	ably.reset();
	cleanedCards.length = 0;
	capabilitiesPrepared = 0;
});
afterAll(async () => await harness.close());

describe('creating a Screen', () => {
	it('stores it with the prepared capability, answers it and announces it under the writer\'s origin', async () => {
		const answered = await screenWriteModule().createScreen({
			eventId,
			input: { name: 'Main', slug: 'main', currentMode: 'standings' } as never,
			originConnectionId: 'origin-1',
			screenOutputAssetCapabilities: provideCapabilities as never,
		});

		expect(answered).toMatchObject({ name: 'Main', slug: 'main', currentMode: 'standings' });
		expect(await stored(answered.id)).toMatchObject({ eventId, slug: 'main', ...prepared.persisted });
		expect(announced()).toEqual([
			[
				'screen:created',
				{ screenId: answered.id, originConnectionId: 'origin-1' },
			],
		]);
	});

	it('refuses a slug the Event already uses, before preparing a capability', async () => {
		const taken = await stageScreen();

		await expect(screenWriteModule().createScreen({
			eventId,
			input: { name: 'Second', slug: taken.slug, currentMode: 'standings' } as never,
			screenOutputAssetCapabilities: provideCapabilities as never,
		})).rejects.toMatchObject({ statusCode: 400, message: 'A screen with this slug already exists' });

		expect(await db.select().from(schema.screens).where(eq(schema.screens.slug, taken.slug))).toHaveLength(1);
		// A slug refusal must not surface as a missing signing key instead.
		expect(capabilitiesPrepared).toBe(0);
		expect(announced()).toEqual([]);
	});
});

describe('updating a Screen', () => {
	it('stores the change on the version it read, and announces the Screen under the writer\'s origin', async () => {
		const screen = await stageScreen();

		const answered = await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: { name: 'Renamed', stateVersion: screen.stateVersion } as never,
			originConnectionId: 'origin-1',
		});

		expect(answered).toMatchObject({ id: screen.id, name: 'Renamed', stateVersion: screen.stateVersion + 1 });
		expect(await stored(screen.id)).toMatchObject({ name: 'Renamed', stateVersion: screen.stateVersion + 1 });
		expect(announced()).toEqual([
			[
				'screen:updated',
				{ screenId: screen.id, originConnectionId: 'origin-1' },
			],
		]);
	});

	it('refuses a slug another Screen of the Event uses, storing and announcing nothing', async () => {
		const [taken, screen] = [await stageScreen(), await stageScreen()];

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: { slug: taken.slug, stateVersion: screen.stateVersion } as never,
		})).rejects.toMatchObject({ statusCode: 400, message: 'A screen with this slug already exists' });

		expect(await stored(screen.id)).toMatchObject({ slug: screen.slug, stateVersion: screen.stateVersion });
		expect(announced()).toEqual([]);
	});

	it('merges a mode\'s configuration into what is stored, and announces the Screen', async () => {
		const screen = await stageScreen({
			modeConfigs: {
				standings: { viewMode: 'range' },
			} as never,
		});

		const answered = await screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'standings',
			config: { showHeader: false },
			stateVersion: screen.stateVersion,
			originConnectionId: 'origin-1',
			graphicsAssets: provideUnusedGraphicsAssets as never,
		});

		expect(answered.stateVersion).toBe(screen.stateVersion + 1);
		expect((await stored(screen.id))?.modeConfigs).toEqual({
			standings: { viewMode: 'range', showHeader: false },
		});
		expect(announced()).toEqual([
			[
				'screen:updated',
				{ screenId: screen.id, originConnectionId: 'origin-1' },
			],
		]);
	});

	it.each([
		[
			'an update',
			() => screenWriteModule().updateScreen({
				authoringSessionId: undefined,
				eventId,
				screenId: 999_999,
				input: { name: 'Nobody', stateVersion: 0 } as never,
			}),
		],
		[
			'a mode configuration write',
			() => screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId,
				screenId: 999_999,
				mode: 'standings',
				config: { showHeader: false },
				graphicsAssets: provideUnusedGraphicsAssets as never,
			}),
		],
		[
			'a delete',
			() => screenWriteModule().deleteScreen({ eventId, screenId: 999_999 }),
		],
	])('answers 404 to %s of a Screen that does not exist, announcing nothing', async (_write, write) => {
		await expect(write()).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

		expect(cleanedCards).toEqual([]);
		expect(announced()).toEqual([]);
	});
});

describe('deleting a Screen', () => {
	it('removes the row, cleans out its Card only once the row is gone, then announces the delete', async () => {
		const screen = await stageScreen();

		const answered = await screenWriteModule().deleteScreen({ eventId, screenId: screen.id, originConnectionId: 'origin-1' });

		expect(answered).toEqual({ success: true });
		expect(await stored(screen.id)).toBeUndefined();
		expect(cleanedCards).toEqual([
			{ screenId: screen.id, afterRowDeleted: true },
		]);
		expect(announced()).toEqual([
			[
				'screen:deleted',
				{ screenId: screen.id, originConnectionId: 'origin-1' },
			],
		]);
	});
});

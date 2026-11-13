import type { GraphicAssetReference, GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import * as authSchema from '~~/server/db/schema/auth';
import {
	graphicAssetContents,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { updateScreenSchema } from '~~/server/schemas/api/screen';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createAblyRestFake } from '~~/test/helpers/ablyRestFake';
import { seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Screen write over real SQL: the row and Graphic Asset Reference index it
// stores, what it answers and announces, and what it leaves of a playout epoch.
// Faked: Ably, the Screen Card's key-value store, the capability signer, and the
// Graphics Asset Library port, whose one question is its contract. An Event
// Reference from another Event is `screenModeEventReferences.sqlite.test.ts`'s.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
// A Graphics Authoring Lease names its holder through the auth tables, as the real `~~/server/db` does.
vi.doMock('~~/server/db', () => ({
	db,
	schema: {
		...schema,
		...authSchema,
	},
}));

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
const { broadcastGraphicsLiveSessionModule } = await import('~~/server/modules/broadcast-graphics-live-session');
const { BROADCAST_GRAPHICS_LIVE_SESSION_AGGREGATE_KIND } = await import('~~/server/services/broadcastGraphicsState');

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
	throw new Error('A write that changes no Graphic Asset Reference must not build the library');
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
			// Unique across Events, and `seedBroadcastGraphicsScreen` takes `digest-<n>`.
			assetCapabilitySeed: `staged-seed-${slugs}`,
			assetCapabilityDigest: `staged-digest-${slugs}`,
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

const PLATE = testGraphicAssetReference('asset-plate', 'plate-revision-1');
const PLATE_REPICKED = testGraphicAssetReference('asset-plate', 'plate-revision-2');
const FONT = testGraphicAssetReference('asset-font', 'font-revision-1');
const SELECTABLE_IMAGE: GraphicAssetReferenceStatus = { outcome: 'available', lifecycleState: 'active', kind: 'image' };
const SELECTABLE_FONT: GraphicAssetReferenceStatus = { outcome: 'available', lifecycleState: 'active', kind: 'font' };

/** A Feature Match Layout pinning `plate` behind its frame and, when given, `font` on its first Text Graphic Item. */
function layoutPinning(plate: GraphicAssetReference, font?: GraphicAssetReference): FeatureMatchOverlayModeConfig['layout'] {
	const { layout } = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	layout.frame.backgroundImage = { kind: 'asset', ...plate };
	if (font) {
		const [topBar] = layout.composition.items;
		const nameRecord = topBar?.type === 'group'
			? topBar.children[0]
			: undefined;
		if (nameRecord?.type !== 'text')
			throw new Error('Fixture expects the default layout to lead with a group led by a Text Graphic Item');
		nameRecord.typography.font = { kind: 'asset', reference: font };
	}
	return layout;
}

/** The Graphics Asset Library port, answering `answers` and keeping each question it was asked. */
function libraryAnswering(answers: GraphicAssetReferenceStatus[]) {
	const asked: GraphicAssetReference[][] = [];
	return {
		asked,
		provide: () => ({
			inspectGraphicAssetRevisions: async (question: { references: GraphicAssetReference[] }) => {
				asked.push(question.references);
				return answers;
			},
		}),
	};
}

function writeLayout(screenId: number, layout: FeatureMatchOverlayModeConfig['layout'], graphicsAssets: () => unknown) {
	return screenWriteModule().updateModeConfig({
		authoringSessionId: undefined,
		eventId,
		screenId,
		mode: 'feature-match-overlay',
		config: { layout },
		graphicsAssets: graphicsAssets as never,
	});
}

/** A Feature Match Overlay Screen whose layout pins, and has indexed, the plate. */
async function stageScreenPinningPlate() {
	const screen = await stageScreen({ currentMode: 'feature-match-overlay' });
	await writeLayout(screen.id, layoutPinning(PLATE), libraryAnswering([SELECTABLE_IMAGE]).provide);
	ably.reset();
	return (await stored(screen.id))!;
}

/** The revisions the Screen's Graphic Asset Reference index publishes for it. */
async function indexedRevisions(screenId: number) {
	const rows = await harness.database.prepare(`
		SELECT revision_id AS revisionId FROM graphic_asset_references
		WHERE owner_kind = 'screen' AND owner_id = ?
		ORDER BY revision_id
	`).bind(String(screenId)).all<{ revisionId: string }>();
	return rows.results.map(row => row.revisionId);
}

/** A Broadcast Graphics Screen with one Broadcast Graphic taken on air: a playout epoch holding a Command Receipt. */
async function stageScreenOnAir() {
	const seeded = await seedBroadcastGraphicsScreen(db, {
		stack: {
			graphics: [
				{ id: 'slate', name: 'Slate', items: [] },
			],
		},
	});
	const sessions = broadcastGraphicsLiveSessionModule();
	const session = await sessions.loadSession(seeded.eventId, seeded.screenId);
	await sessions.applyCommand({
		eventId: seeded.eventId,
		screenId: seeded.screenId,
		sessionId: session.id,
		command: {
			commandId: 'command-1',
			type: 'Take',
			payload: { graphicId: 'slate', cut: true },
		} as never,
		graphicsAssets: () => ({}) as never,
	});
	ably.reset();
	return { ...seeded, sessionId: session.id };
}

async function activeEpoch(screenId: number) {
	return await db.query.broadcastGraphicsLiveSessions.findFirst({
		where: and(
			eq(schema.broadcastGraphicsLiveSessions.screenId, screenId),
			eq(schema.broadcastGraphicsLiveSessions.status, 'active'),
		),
	});
}

/** Each kind of message sent, to the Event's channel or a Screen's own. */
function announcedTypes() {
	return [
		...new Set(ably.published.map(message => message.type)),
	];
}

async function commandReceipts(sessionId: number) {
	return await db.select().from(schema.liveStateCommandReceipts).where(and(
		eq(schema.liveStateCommandReceipts.aggregateKind, BROADCAST_GRAPHICS_LIVE_SESSION_AGGREGATE_KIND),
		eq(schema.liveStateCommandReceipts.aggregateId, sessionId),
	));
}

beforeAll(async () => {
	await db.insert(graphicAssetContents).values([
		{
			digest: 'd'.repeat(64),
			byteLength: 70,
			canonicalMime: 'image/png',
		},
		{
			digest: 'f'.repeat(64),
			byteLength: 4096,
			canonicalMime: 'font/woff2',
		},
	] as never);
	await db.insert(graphicAssets).values([
		{ id: PLATE.assetId, name: 'Plate', kind: 'image' },
		{ id: FONT.assetId, name: 'Font', kind: 'font' },
	] as never);
	const revision = { revisionNumber: 1, technicalFacts: {} };
	await db.insert(graphicAssetRevisions).values([
		{
			...revision,
			id: PLATE.revisionId,
			assetId: PLATE.assetId,
			contentDigest: 'd'.repeat(64),
			compatibilityProfile: 'still-image-v1',
		},
		{
			...revision,
			id: PLATE_REPICKED.revisionId,
			assetId: PLATE.assetId,
			revisionNumber: 2,
			contentDigest: 'd'.repeat(64),
			compatibilityProfile: 'still-image-v1',
		},
		{
			...revision,
			id: FONT.revisionId,
			assetId: FONT.assetId,
			contentDigest: 'f'.repeat(64),
			compatibilityProfile: 'static-font-v1',
		},
	] as never);
});

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

// A Commander Event has no Rounds or standings, so it is not offered Standings (ADR-0087).
describe('a write putting a Screen into a Screen Mode its Event is not offered', () => {
	async function stageCommanderEvent() {
		const [commander] = await db.insert(schema.events)
			.values({
				name: 'Commander',
				game: 'mtg',
				variant: 'commander',
				featureMatchOrientation: 'horizontal',
			})
			.returning({ id: schema.events.id });
		return commander!.id;
	}
	const refusal = {
		statusCode: 422,
		data: { code: 'SCREEN_MODE_NOT_OFFERED' },
	};

	it('refuses a create, storing nothing', async () => {
		const commanderId = await stageCommanderEvent();

		await expect(screenWriteModule().createScreen({
			eventId: commanderId,
			input: { name: 'Standings', slug: 'standings', currentMode: 'standings' } as never,
			screenOutputAssetCapabilities: provideCapabilities as never,
		})).rejects.toMatchObject(refusal);

		expect(await db.select().from(schema.screens).where(eq(schema.screens.eventId, commanderId))).toEqual([]);
		expect(capabilitiesPrepared).toBe(0);
	});

	it('refuses an update that changes the mode, leaving the Screen as it was', async () => {
		const commanderId = await stageCommanderEvent();
		const screen = await stageScreen({ eventId: commanderId, currentMode: 'background' });

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId: commanderId,
			screenId: screen.id,
			input: { currentMode: 'standings', stateVersion: screen.stateVersion } as never,
		})).rejects.toMatchObject(refusal);

		expect(await stored(screen.id)).toMatchObject({ currentMode: 'background', stateVersion: screen.stateVersion });
	});

	// A Screen stored in such a mode before the rule keeps saving: only a change of mode is judged.
	it('stores an update that leaves a Screen in the unoffered mode it already shows', async () => {
		const commanderId = await stageCommanderEvent();
		const screen = await stageScreen({ eventId: commanderId, currentMode: 'standings' });

		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId: commanderId,
			screenId: screen.id,
			input: { name: 'Renamed', currentMode: 'standings', stateVersion: screen.stateVersion } as never,
		});

		expect(await stored(screen.id)).toMatchObject({ name: 'Renamed', currentMode: 'standings' });
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

	// The Edit Screen dialog sends every stored mode configuration back with a rename, and storage
	// holds PATCH fragments: most lack a field the mode's complete configuration requires.
	it('renames a Screen whose stored mode configurations are PATCH fragments, storing them as they were', async () => {
		const fragments = {
			'background': {},
			'card': {},
			'deck': { showDeckName: false },
			'standings': { viewMode: 'all' },
			'top-cut': { showHeader: false },
			'feature-match': { showClock: false },
			'feature-match-overlay': {},
			'broadcast-graphics': {
				channels: [
					{ id: 'lower-thirds', name: 'Lower Thirds' },
				],
			},
			'metagame': { topN: 16 },
			'top-cards': { limit: 12 },
			'player-history': { rowsPerPage: 5 },
		};
		const screen = await stageScreen({ modeConfigs: fragments as never });

		const answered = await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: updateScreenSchema.parse({
				name: 'Renamed',
				slug: screen.slug,
				currentMode: screen.currentMode,
				modeConfigs: fragments,
				stateVersion: screen.stateVersion,
			}),
		});

		expect(answered.modeConfigs).toEqual(fragments);
		expect(await stored(screen.id)).toMatchObject({ name: 'Renamed', stateVersion: screen.stateVersion + 1 });
		expect((await stored(screen.id))?.modeConfigs).toEqual(fragments);
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

	it('answers 404 to an update whose Screen is deleted between its read and its write, announcing nothing', async () => {
		const screen = await stageScreen();
		const commit = db.batch.bind(db);
		vi.spyOn(db, 'batch').mockImplementationOnce((async (statements: Parameters<typeof db.batch>[0]) => {
			await db.delete(schema.screens).where(eq(schema.screens.id, screen.id));
			return await commit(statements);
		}) as never);

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: { name: 'Renamed', stateVersion: screen.stateVersion } as never,
		})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

		expect(announced()).toEqual([]);
	});
});

// Only the mode configuration write stores a configuration and its index together,
// so a generic write may carry references back but never add, move or drop one.
describe('a generic Screen write carrying Graphic Asset References', () => {
	it('refuses a create that carries one, storing nothing', async () => {
		await expect(screenWriteModule().createScreen({
			eventId,
			input: {
				name: 'Overlay',
				slug: 'overlay',
				currentMode: 'feature-match-overlay',
				modeConfigs: {
					'feature-match-overlay': {
						...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
						layout: layoutPinning(PLATE),
					},
				},
			} as never,
			screenOutputAssetCapabilities: provideCapabilities as never,
		})).rejects.toMatchObject({
			statusCode: 400,
			message: expect.stringContaining('Screen Mode configuration endpoint'),
		});

		expect(await db.select().from(schema.screens).where(eq(schema.screens.slug, 'overlay'))).toEqual([]);
		expect(announced()).toEqual([]);
	});

	it('refuses an update that drops the ones the Screen has indexed, leaving both as they were', async () => {
		const screen = await stageScreenPinningPlate();

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: { stateVersion: screen.stateVersion, modeConfigs: null } as never,
		})).rejects.toMatchObject({
			statusCode: 400,
			message: expect.stringContaining('Screen Mode configuration endpoint'),
		});

		expect(await stored(screen.id)).toEqual(screen);
		expect(await indexedRevisions(screen.id)).toEqual([PLATE.revisionId]);
		expect(announced()).toEqual([]);
	});

	it('stores an update that carries them back unchanged', async () => {
		const screen = await stageScreenPinningPlate();

		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: {
				stateVersion: screen.stateVersion,
				name: 'Renamed overlay',
				modeConfigs: screen.modeConfigs,
			} as never,
		});

		expect(await stored(screen.id)).toMatchObject({ name: 'Renamed overlay', modeConfigs: screen.modeConfigs });
		expect(await indexedRevisions(screen.id)).toEqual([PLATE.revisionId]);
	});
});

describe('a mode configuration write that selects Graphic Asset Revisions', () => {
	// One question whatever the save's size: each was a remote round-trip (#374).
	it('asks the library once, for every reference in discovery order, then stores and indexes them', async () => {
		const screen = await stageScreen({ currentMode: 'feature-match-overlay' });
		const library = libraryAnswering([SELECTABLE_IMAGE, SELECTABLE_FONT]);
		const layout = layoutPinning(PLATE, FONT);

		await writeLayout(screen.id, layout, library.provide);

		expect(library.asked).toEqual([
			[PLATE, FONT],
		]);
		expect((await stored(screen.id))?.modeConfigs?.['feature-match-overlay']?.layout).toEqual(layout);
		expect(await indexedRevisions(screen.id)).toEqual([FONT.revisionId, PLATE.revisionId]);
	});

	it.each<[string, GraphicAssetReferenceStatus[], string]>([
		[
			'the second is missing',
			[
				SELECTABLE_IMAGE,
				{ outcome: 'missing' },
			],
			'typography.font',
		],
		[
			'neither can be selected, naming the first',
			[
				{ outcome: 'unavailable', retryable: true },
				{ outcome: 'missing' },
			],
			'layout.frame.backgroundImage',
		],
		[
			'the library answers for fewer than it was asked',
			[SELECTABLE_IMAGE],
			'typography.font',
		],
	])('refuses the write when %s, storing and indexing nothing', async (_case, answers, refusedSlot) => {
		const screen = await stageScreen({ currentMode: 'feature-match-overlay' });

		await expect(writeLayout(screen.id, layoutPinning(PLATE, FONT), libraryAnswering(answers).provide)).rejects.toMatchObject({
			statusCode: 409,
			message: expect.stringContaining(refusedSlot),
		});

		expect(await stored(screen.id)).toEqual(screen);
		expect(await indexedRevisions(screen.id)).toEqual([]);
		expect(announced()).toEqual([]);
	});

	// A pinned revision outlives its asset's retirement, so only a reference the write moves is asked about.
	it('builds no library for a write that leaves its references as they were, and asks only about one it moves', async () => {
		const screen = await stageScreenPinningPlate();

		await writeLayout(screen.id, layoutPinning(PLATE), provideUnusedGraphicsAssets);

		expect((await stored(screen.id))?.stateVersion).toBe(screen.stateVersion + 1);

		const library = libraryAnswering([SELECTABLE_IMAGE]);
		await writeLayout(screen.id, layoutPinning(PLATE_REPICKED), library.provide);

		expect(library.asked).toEqual([
			[PLATE_REPICKED],
		]);
		expect(await indexedRevisions(screen.id)).toEqual([PLATE_REPICKED.revisionId]);
	});
});

// Leaving the mode ends the epoch in the same commit: `screenEpochEndAtomicity.sqlite.test.ts`.
describe('a write to a Screen whose Broadcast Graphics are on air', () => {
	it.each([
		[
			'a rename',
			{ name: 'Renamed' },
		],
		[
			'a write that restates the mode',
			{ currentMode: 'broadcast-graphics' },
		],
	])('leaves the show running through %s', async (_write, change) => {
		const show = await stageScreenOnAir();

		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId: show.eventId,
			screenId: show.screenId,
			input: { stateVersion: 0, ...change } as never,
		});

		expect(await activeEpoch(show.screenId)).toMatchObject({
			id: show.sessionId,
			currentState: {
				playout: {
					slate: { onAir: true },
				},
			},
		});
		expect(await commandReceipts(show.sessionId)).toHaveLength(1);
		expect(announcedTypes()).toEqual(['screen:updated']);
	});

	// The cascade removes the sessions that identify their receipts, so the epoch ends first.
	it('discards the epoch\'s Command Receipts when the Screen is deleted', async () => {
		const show = await stageScreenOnAir();
		expect(await commandReceipts(show.sessionId)).toHaveLength(1);

		await screenWriteModule().deleteScreen({ eventId: show.eventId, screenId: show.screenId });

		expect(await stored(show.screenId)).toBeUndefined();
		expect(await commandReceipts(show.sessionId)).toEqual([]);
		// Unannounced: its clients are about to be told the Screen itself is gone.
		expect(announcedTypes()).toEqual(['screen:deleted']);
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

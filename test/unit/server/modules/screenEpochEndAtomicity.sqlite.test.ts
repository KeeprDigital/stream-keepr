import type { BroadcastGraphicsCommand } from '~~/shared/types/broadcastGraphicsLiveSession';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	MediaGraphicInputValue,
} from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	graphicAssetContents,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { createCommandIdSequence, seedBroadcastGraphicsScreen } from '~~/test/helpers/broadcastGraphicsScreen';
import { testGraphicAssetId, testGraphicAssetRevisionId } from '~~/test/helpers/graphicsAssetIdentities';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A playout epoch ends in the same commit as the write that ends it — a Screen
// leaving Broadcast Graphics mode, or a live-state reset — or not at all (#305).
// So failures are injected into that one commit, and nothing may move.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

/** Every realtime message the writes under test published, in order. */
const published: Array<{ channel: number; name: string; payload: unknown }> = [];

vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async (channel: number, name: string, payload: unknown) => {
		published.push({ channel, name, payload });
	},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));

const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { broadcastGraphicsLiveSessionModule } = await import('~~/server/modules/broadcast-graphics-live-session');

const ASSET_ID = 'asset-clip';
const REVISION_ID = 'revision-one';
const CONTENT_DIGEST = 'd'.repeat(64);
const CLIP = 'clip';

function mediaInput(key: string): GraphicInputDeclaration {
	return {
		key,
		label: key,
		type: 'media',
		required: false,
		updatePolicy: 'live',
		default: null,
		mediaKind: 'image',
	};
}

const SLATE: BroadcastGraphicConfig = {
	id: 'slate',
	name: 'Slate',
	items: [],
	inputs: [
		mediaInput(CLIP),
	],
};

const STACK: BroadcastGraphicsModeConfig = {
	graphics: [SLATE],
};

/** Answers for the one revision seeded below; `Set Input` asks it at selection. */
const graphicsAssetLibrary = {
	async inspectGraphicAssetRevision(input: { revisionId: string }): Promise<GraphicAssetReferenceStatus> {
		return input.revisionId === REVISION_ID
			? { outcome: 'available', lifecycleState: 'active', kind: 'image' }
			: { outcome: 'missing' };
	},
};

const nextCommandId = createCommandIdSequence();

function command(type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>): BroadcastGraphicsCommand {
	return {
		commandId: nextCommandId(),
		type,
		payload,
	} as unknown as BroadcastGraphicsCommand;
}

let eventId: number;
let screenId: number;

/** One Event, one Broadcast Graphics Screen, and a show already on air. */
async function showOnAir() {
	const seeded = await seedBroadcastGraphicsScreen(db, { stack: STACK, eventName: 'Epoch end' });
	eventId = seeded.eventId;
	screenId = seeded.screenId;

	const module = broadcastGraphicsLiveSessionModule();
	const session = await module.loadSession(eventId, screenId);
	const apply = async (issued: BroadcastGraphicsCommand) => {
		await module.applyCommand({
			eventId,
			screenId,
			sessionId: session.id,
			command: issued,
			graphicsAssets: () => graphicsAssetLibrary,
		});
	};

	await apply(command('Take', { graphicId: SLATE.id, cut: true }));
	await apply(command('Set Input', {
		graphicId: SLATE.id,
		inputKey: CLIP,
		value: {
			assetId: testGraphicAssetId(ASSET_ID),
			revisionId: testGraphicAssetRevisionId(REVISION_ID),
		} satisfies MediaGraphicInputValue,
	}));

	published.length = 0;
	return { module, sessionId: session.id };
}

async function screenRow() {
	return await db.query.screens.findFirst({
		where: eq(schema.screens.id, screenId),
	});
}

async function activeSession() {
	return await db.query.broadcastGraphicsLiveSessions.findFirst({
		where: and(
			eq(schema.broadcastGraphicsLiveSessions.screenId, screenId),
			eq(schema.broadcastGraphicsLiveSessions.status, 'active'),
		),
	});
}

/** Whether this Screen still publishes anything its Live Session accepted. */
async function publishesLiveSessionMedia(): Promise<boolean> {
	const row = await harness.database.prepare(`
		SELECT count(*) AS total FROM graphic_asset_references
		WHERE owner_kind = 'screen' AND owner_id = ? AND owner_slot LIKE 'liveSession.%'
	`).bind(String(screenId)).first<{ total: number }>();
	return (row?.total ?? 0) > 0;
}

function epochEndedAnnouncements() {
	return published.filter(message => message.name === 'broadcastGraphicsLiveSession:epochEnded');
}

/** Whichever graphics the Screen's current epoch has on air. */
async function onAirGraphics(): Promise<string[]> {
	const session = await activeSession();
	const playout = session?.currentState?.playout ?? {};
	return Object.entries(playout)
		.filter(([, state]) => state.onAir)
		.map(([graphicId]) => graphicId);
}

beforeAll(async () => {
	await db.insert(graphicAssetContents).values({
		digest: CONTENT_DIGEST,
		byteLength: 70,
		canonicalMime: 'image/png',
	} as never);
	await db.insert(graphicAssets).values({ id: ASSET_ID, name: 'Clip', kind: 'image' } as never);
	await db.insert(graphicAssetRevisions).values({
		id: REVISION_ID,
		assetId: ASSET_ID,
		revisionNumber: 1,
		contentDigest: CONTENT_DIGEST,
		compatibilityProfile: 'still-image-v1',
		technicalFacts: {},
	} as never);
});

beforeEach(() => {
	vi.restoreAllMocks();
	published.length = 0;
});

afterAll(async () => await harness.close());

describe('a Screen leaving Broadcast Graphics mode', () => {
	it('ends the epoch, clears what it published, and announces it', async () => {
		// Control: the mode change does end the epoch.
		await showOnAir();

		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: 0, currentMode: 'background' } as never,
		});

		expect((await screenRow())?.currentMode).toBe('background');
		expect(await activeSession()).toBeUndefined();
		expect(await publishesLiveSessionMedia()).toBe(false);
		expect(epochEndedAnnouncements()).toHaveLength(1);
	});

	it('leaves the mode unchanged when the write that ends the epoch fails', async () => {
		const { sessionId } = await showOnAir();
		// Fail the one commit carrying both halves.
		vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('epoch end failed'));

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: 0, currentMode: 'background' } as never,
		})).rejects.toThrow();

		const screen = await screenRow();
		expect(screen?.currentMode).toBe('broadcast-graphics');
		expect(screen?.stateVersion).toBe(0);
		// The show is untouched in both directions: still running, still publishing.
		expect((await activeSession())?.id).toBe(sessionId);
		expect(await onAirGraphics()).toEqual([SLATE.id]);
		expect(await publishesLiveSessionMedia()).toBe(true);
		expect(epochEndedAnnouncements()).toHaveLength(0);

		// The retry converges: the state version it was written against still stands.
		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: 0, currentMode: 'background' } as never,
		});
		expect((await screenRow())?.currentMode).toBe('background');
		expect(await activeSession()).toBeUndefined();
	});

	it('cannot bring the previous epoch back on air when the Screen returns to the mode', async () => {
		const { module } = await showOnAir();
		vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('epoch end failed'));

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: 0, currentMode: 'background' } as never,
		})).rejects.toThrow();

		// Leave the mode, come back, and find nothing on air.
		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: (await screenRow())!.stateVersion, currentMode: 'background' } as never,
		});
		await screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: (await screenRow())!.stateVersion, currentMode: 'broadcast-graphics' } as never,
		});
		await module.loadSession(eventId, screenId);

		expect(await onAirGraphics()).toEqual([]);
		expect(await publishesLiveSessionMedia()).toBe(false);
	});

	it('leaves a running epoch alone when the mode change is refused for its state version', async () => {
		// An end riding with a refused mode change must not blank the show.
		const { sessionId } = await showOnAir();

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId,
			input: { stateVersion: 99, currentMode: 'background' } as never,
		})).rejects.toThrow();

		expect((await screenRow())?.currentMode).toBe('broadcast-graphics');
		expect((await activeSession())?.id).toBe(sessionId);
		expect(await onAirGraphics()).toEqual([SLATE.id]);
		expect(await publishesLiveSessionMedia()).toBe(true);
		expect(epochEndedAnnouncements()).toHaveLength(0);
	});
});

describe('an operator resetting live state', () => {
	/** Fails a standalone clear of published references, the reset's old defect. */
	function refuseStandaloneReferenceClears() {
		const execute = harness.client.execute.bind(harness.client);
		vi.spyOn(harness.client, 'execute').mockImplementation((async (statement: unknown) => {
			const sql = typeof statement === 'string'
				? statement
				: (statement as { sql: string }).sql;
			if (/delete\s+from\s+graphic_asset_references/i.test(sql))
				throw new Error('Live Session references were cleared outside the commit that ended the epoch');
			return await execute(statement as never);
		}) as never);
	}

	it('ends the epoch, clears what it published, and announces it', async () => {
		const { module, sessionId } = await showOnAir();

		const opened = await module.resetLiveState({ eventId, screenId });

		expect(opened.id).not.toBe(sessionId);
		expect(await onAirGraphics()).toEqual([]);
		expect(await publishesLiveSessionMedia()).toBe(false);
		expect(epochEndedAnnouncements()).toEqual([
			expect.objectContaining({
				payload: expect.objectContaining({ screenId, sessionId }),
			}),
		]);
	});

	it('clears what the ended epoch published in the commit that ends it', async () => {
		const { module } = await showOnAir();
		refuseStandaloneReferenceClears();

		await module.resetLiveState({ eventId, screenId });

		expect(await publishesLiveSessionMedia()).toBe(false);
		expect(epochEndedAnnouncements()).toHaveLength(1);
	});

	it('announces nothing when the commit that would end the epoch fails', async () => {
		const { module, sessionId } = await showOnAir();
		vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('epoch end failed'));

		await expect(module.resetLiveState({ eventId, screenId })).rejects.toThrow();

		// No announcement for a commit that did not happen.
		expect(epochEndedAnnouncements()).toHaveLength(0);
		expect((await activeSession())?.id).toBe(sessionId);
		expect(await onAirGraphics()).toEqual([SLATE.id]);
		expect(await publishesLiveSessionMedia()).toBe(true);
	});
});

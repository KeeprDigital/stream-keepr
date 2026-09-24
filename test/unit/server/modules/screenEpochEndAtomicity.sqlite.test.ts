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

/**
 * A playout epoch ends with the write that causes it to end, or not at all.
 *
 * Two things end one: a Screen leaving Broadcast Graphics mode, and an operator
 * resetting live state. Both used to end it in a second write issued after the
 * first had already committed, and #305 records what that costs.
 *
 * **The mode change.** The end came after the mode change committed, deliberately —
 * so that a failed update could not blank a running show. But a failure the other
 * way round left the Screen out of the mode with its epoch still active, and
 * `ensureActiveSession` returns an active session exactly as it stands: the next
 * activation got the previous show's graphics back on air, contradicting the
 * documented contract that a fresh epoch has nothing on air. The operator's retry
 * did not repair it either — the mode change had moved the state version, so the
 * retry answered 409.
 *
 * **The reset.** The write clearing what the ended epoch published ran unguarded
 * after the batch that ended it, and the announcement ran after that. A failure in
 * the clear left an ended epoch's media still resolvable through the Screen's
 * outputs *and* skipped the epoch-ended announcement, so every peer went on
 * rendering a show that had finished.
 *
 * Both are now one commit, which is why the failure injections below are what they
 * are: there is no longer an instant between the two writes for a failure to land
 * in, so a failure has to be injected into the commit itself, and what is asserted
 * is that nothing moved rather than that the second half caught up.
 *
 * Run against libSQL because what is under test is what a batch does when one of
 * its statements fails and what a guarded statement does when its condition is
 * false. `broadcastGraphicsLiveReferencesD1.test.ts` establishes both halves of
 * that premise on a real D1 binding; this file builds shows on top of it.
 */

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
	inputs: [mediaInput(CLIP)],
};

const STACK: BroadcastGraphicsModeConfig = { graphics: [SLATE] };

/**
 * Answers for exactly the one revision seeded below. A declared dependency of
 * `applyCommand` rather than a seam: `Set Input` records the pinned revision's own
 * facts at the moment of selection, and this is the authority it asks.
 */
const graphicsAssetLibrary = {
	async inspectGraphicAssetRevision(input: { revisionId: string }): Promise<GraphicAssetReferenceStatus> {
		return input.revisionId === REVISION_ID
			? { outcome: 'available', lifecycleState: 'active', kind: 'image' }
			: { outcome: 'missing' };
	},
};

const nextCommandId = createCommandIdSequence();

function command(type: BroadcastGraphicsCommand['type'], payload: Record<string, unknown>): BroadcastGraphicsCommand {
	return { commandId: nextCommandId(), type, payload } as unknown as BroadcastGraphicsCommand;
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
	return await db.query.screens.findFirst({ where: eq(schema.screens.id, screenId) });
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
		// The control. Without it every failure injection below would be satisfied by
		// a mode change that does nothing whatever happens.
		await showOnAir();

		await screenWriteModule().updateScreen({
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
		// The failure the ticket is about, injected where it can now land: the one
		// commit that carries both halves. Before they were folded together this
		// rejected only the second, leaving the Screen out of the mode with its epoch
		// still running — and the retry below answering 409 on a version that had
		// already moved.
		vi.spyOn(db, 'batch').mockRejectedValueOnce(new Error('epoch end failed'));

		await expect(screenWriteModule().updateScreen({
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

		// And the operator's retry converges rather than conflicting, because the
		// state version the failed attempt was written against still stands.
		await screenWriteModule().updateScreen({
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
			eventId,
			screenId,
			input: { stateVersion: 0, currentMode: 'background' } as never,
		})).rejects.toThrow();

		// Whatever the failure left behind, the Screen's next activation of Broadcast
		// Graphics gets a fresh epoch. This is the acceptance criterion stated as the
		// show: leave the mode, come back, and find nothing on air.
		await screenWriteModule().updateScreen({
			eventId,
			screenId,
			input: { stateVersion: (await screenRow())!.stateVersion, currentMode: 'background' } as never,
		});
		await screenWriteModule().updateScreen({
			eventId,
			screenId,
			input: { stateVersion: (await screenRow())!.stateVersion, currentMode: 'broadcast-graphics' } as never,
		});
		await module.loadSession(eventId, screenId);

		expect(await onAirGraphics()).toEqual([]);
		expect(await publishesLiveSessionMedia()).toBe(false);
	});

	it('leaves a running epoch alone when the mode change is refused for its state version', async () => {
		// The guarantee the fold must not cost, and the one the old ordering bought:
		// a batch applies every statement it holds, so an end riding with a refused
		// mode change would blank a show nobody asked to stop.
		const { sessionId } = await showOnAir();

		await expect(screenWriteModule().updateScreen({
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
	/**
	 * Fails any clear of the Live Session's published references that the reset
	 * executes on its own, outside a batch.
	 *
	 * The reset's defect was exactly such a statement: issued after the batch that
	 * ended the epoch, unguarded, and followed by the announcement — so its failure
	 * left an ended epoch's media resolvable and told nobody the epoch had ended.
	 *
	 * Scoped to the reset deliberately, because a standalone clear is not wrong
	 * everywhere: `republishLiveSessionReferences` issues one as a repair for a Screen
	 * with no epoch at all, where there is no commit to join and the write is
	 * re-driven anyway. A reset performs no reconciliation, so the only standalone
	 * clear it can make is the one this is about. Written as an injection rather than
	 * as an assertion about the code so it keeps biting if the clear is ever lifted
	 * back out of the commit.
	 */
	function refuseStandaloneReferenceClears() {
		const execute = harness.client.execute.bind(harness.client);
		vi.spyOn(harness.client, 'execute').mockImplementation((async (statement: unknown) => {
			const sql = typeof statement === 'string' ? statement : (statement as { sql: string }).sql;
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
			expect.objectContaining({ payload: expect.objectContaining({ screenId, sessionId }) }),
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

		// An announcement is a claim that an epoch ended, so it may not outlive a
		// commit that did not happen.
		expect(epochEndedAnnouncements()).toHaveLength(0);
		expect((await activeSession())?.id).toBe(sessionId);
		expect(await onAirGraphics()).toEqual([SLATE.id]);
		expect(await publishesLiveSessionMedia()).toBe(true);
	});
});

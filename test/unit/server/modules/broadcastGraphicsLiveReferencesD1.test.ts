import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	graphicAssetContents,
	graphicAssetReferences,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/**
 * The platform premise the libSQL guard tests rest on, on a real D1 binding (#75): a guarded
 * statement matching zero rows commits as a no-op, while a real statement error rolls the batch back.
 */

// Built before the module under test is imported, because `~~/server/db` is
// mocked with a client over this harness's D1 before that module loads.
const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

vi.doMock('~~/server/db', () => ({
	db: { $client: harness.database },
}));

const { updateBroadcastGraphicsLiveSessionGraphicAssetReferences } = await import(
	'~~/server/modules/screen-graphic-asset-references',
);

const ASSET_ID = 'asset-clip';
const FIRST_REVISION = 'revision-one';
const SECOND_REVISION = 'revision-two';
const CONTENT_DIGEST = 'd'.repeat(64);
const OWNER_SLOT = 'liveSession.slate.inputs.clip';

/** The reference set one accepted media Graphic Input value produces. */
function references(revisionId: string) {
	return [
		{
			reference: testGraphicAssetReference(ASSET_ID, revisionId),
			ownerSlot: OWNER_SLOT,
			kind: 'image' as const,
		},
	];
}

let eventId: number;
let screenId: number;
let sessionId: number;

beforeAll(async () => {
	const [event] = await db.insert(schema.events).values({
		name: 'D1 guard',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
	} as never).returning();
	eventId = event!.id;

	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name: 'Program',
		slug: 'program',
		currentMode: 'broadcast-graphics',
		assetCapabilitySeed: 'seed',
		assetCapabilityDigest: 'digest',
	} as never).returning();
	screenId = screen!.id;

	const [session] = await db.insert(schema.broadcastGraphicsLiveSessions).values({
		eventId,
		screenId,
		status: 'active',
		currentState: { playout: {}, inputs: {} },
		sequence: 5,
	} as never).returning();
	sessionId = session!.id;

	await db.insert(graphicAssetContents).values({
		digest: CONTENT_DIGEST,
		byteLength: 70,
		canonicalMime: 'image/png',
	} as never);
	await db.insert(graphicAssets).values({
		id: ASSET_ID,
		name: 'Clip',
		kind: 'image',
	} as never);
	for (const [index, id] of [FIRST_REVISION, SECOND_REVISION].entries()) {
		await db.insert(graphicAssetRevisions).values({
			id,
			assetId: ASSET_ID,
			revisionNumber: index + 1,
			contentDigest: CONTENT_DIGEST,
			compatibilityProfile: 'still-image-v1',
			technicalFacts: {},
		} as never);
	}
});

/** What the Live Session currently publishes at its own owner slot. */
async function publishedRevision(): Promise<string | undefined> {
	const row = await harness.database.prepare(`
		SELECT revision_id AS revisionId FROM graphic_asset_references
		WHERE owner_kind = 'screen' AND owner_id = ? AND owner_slot = ?
	`).bind(String(screenId), OWNER_SLOT).first<{ revisionId: string }>();
	return row?.revisionId;
}

describe('the Live Session reference guard against a real D1 binding', () => {
	it('indexes what the Live Session accepted while it still stands at that sequence', async () => {
		// The control. Without it the next test would be satisfied by a harness that
		// writes nothing whatever it is asked.
		const outcome = await updateBroadcastGraphicsLiveSessionGraphicAssetReferences({
			screenId,
			eventId,
			sessionId,
			sequence: 5,
			references: references(FIRST_REVISION),
		});

		expect(outcome).toEqual({ expected: 1, indexed: 1 });
		expect(await publishedRevision()).toBe(FIRST_REVISION);
	});

	it('applies nothing, and reports rather than throws, when the sequence has moved', async () => {
		// Every `EXISTS` matches nothing: D1 commits the batch with no changes, not an error.
		const outcome = await updateBroadcastGraphicsLiveSessionGraphicAssetReferences({
			screenId,
			eventId,
			sessionId,
			// Derived from sequence 4; the Live Session has since reached 5.
			sequence: 4,
			references: references(SECOND_REVISION),
		});

		expect(outcome).toEqual({ expected: 1, indexed: 0 });
		// The delete in the same batch was guarded too, so the newer set survives whole.
		expect(await publishedRevision()).toBe(FIRST_REVISION);
	});

	it('rolls the batch back when a statement genuinely fails, which is the distinction', async () => {
		// A real error on the owner-slot unique index does roll back, so the test above is a distinction.
		const client = harness.database;
		const insert = (id: string, ownerSlot: string) => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			) VALUES (?, ?, ?, 'screen', ?, ?, ?, ?, ?)
		`).bind(id, ASSET_ID, SECOND_REVISION, String(screenId), ownerSlot, eventId, 0, 0);

		await expect(client.batch([
			insert('would-have-committed', 'liveSession.slate.inputs.other'),
			// Same owner slot as the row the first test indexed.
			insert('violates-the-owner-slot-index', OWNER_SLOT),
		])).rejects.toThrow();

		const survivors = await db.select().from(graphicAssetReferences);
		expect(survivors.map(row => row.id)).not.toContain('would-have-committed');
		expect(await publishedRevision()).toBe(FIRST_REVISION);
	});
});

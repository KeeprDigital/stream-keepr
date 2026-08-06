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
 * The one thing the Live Session reference guard needs from D1 that a libSQL
 * double could get wrong while looking right.
 *
 * `broadcastGraphicsLiveReferences.sqlite.test.ts` proves the guard's behaviour —
 * a superseded reconciliation applies nothing — against libSQL, because the
 * interleaving it needs is cheap there and a Workers runtime per test is not. That
 * rests on a premise about the platform: **a conditional statement inside a `batch`
 * that matches zero rows is not an error, and does not roll its batch back.** The
 * whole contract of the guard is "match zero rows and apply nothing", so if D1
 * treated that as a failure the module would take the `catch` on every superseded
 * reconciliation — logging `..._index_failed` where it currently returns
 * `indexed: 0` and logs `..._index_incomplete`, and turning the retry's exhaustion
 * report into a failure report.
 *
 * That premise is not obviously safe. #75 found the *converse* being assumed and
 * being wrong — `server/services/graphicStyleSet.ts` checked `allApplied` after a
 * batch had already committed, on the belief that a conditional `UPDATE` matching
 * nothing would roll the batch back — and the reviewer's statement of the real rule
 * is the one being relied on here: *"A D1 `batch` rolls back on statement error, not
 * on a conditional `UPDATE` matching zero rows."* That review named this module's
 * stamp-and-`EXISTS` cross-guard as the pattern to copy, so the pattern is now load
 * bearing in two places and its premise is worth pinning rather than citing.
 *
 * So this file establishes both halves on a real D1 binding, through the real
 * function: a guarded write whose sequence has moved applies nothing and does not
 * throw, and a genuine statement error in the same table does roll its batch back.
 * Both matter — the first is the guard's contract, and the second is what makes the
 * first a distinction rather than a description of a database that never fails.
 */

// Built before the module under test is imported, because that module binds
// `hub:db` at import time and the binding has to be this harness's D1.
const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

vi.doMock('hub:db', () => ({ db: { $client: harness.database } }));

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
	return [{
		reference: testGraphicAssetReference(ASSET_ID, revisionId),
		ownerSlot: OWNER_SLOT,
		kind: 'image' as const,
	}];
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
		// The premise the libSQL guard tests rest on, on the real platform: every
		// statement's `EXISTS` matches zero rows, and D1 answers with a committed batch
		// reporting no changes rather than an error. A database that failed the batch
		// here would send the module down its `catch` on the ordinary superseded
		// reconciliation, which is the one outcome its logging exists to tell apart.
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
		// The other half of #75's rule, and what makes the test above say something. A
		// zero-match condition commits; a real error does not. Asserted on the same
		// table and the same unique index the Live Session's owner slots are kept apart
		// by, because that index is what an unguarded insert would collide with.
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

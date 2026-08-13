import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import {
	graphicAssetContents,
	graphicAssetReferences,
	graphicAssetRevisions,
	graphicAssets,
} from '~~/server/db/schema/graphicsAsset';
import { D1_MAXIMUM_BOUND_PARAMETERS } from '~~/server/modules/graphics-asset-library/catalogue-sql';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/**
 * The authored Screen Mode configuration write, against a database that enforces
 * the parameter limit its precondition has to live inside.
 *
 * The write is one compare-and-swap `UPDATE` carrying a precondition for every
 * Graphic Asset Reference the configuration publishes, so its parameter count is
 * decided by the show rather than by the query. Bound one placeholder per fact it
 * cost six parameters plus eight per reference, which clears a hundred at twelve
 * references — and a dozen media and font references is an ordinary Broadcast
 * Graphics stack, not a pathological one. #303 records the save failing there with
 * an opaque 500, permanently, until an author removed references.
 *
 * So this runs against a real D1 binding rather than the libSQL harness the
 * module's other tests use: libSQL accepts several hundred bound parameters
 * without complaint, and a fix proved there would prove nothing at all. The
 * companion `broadcastGraphicsLiveReferencesD1.test.ts` is the same argument for
 * the Live Session's half of the index.
 *
 * What is asserted is the write's contract at those sizes, not its encoding: a
 * configuration commits with its whole reference set indexed, and a reference that
 * no longer resolves still rejects the save outright rather than letting a Screen
 * publish a revision its outputs could not fetch.
 */

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

vi.doMock('hub:db', () => ({ db }));

const { updateScreenModeConfigWithGraphicAssetReferences } = await import(
	'~~/server/modules/screen-graphic-asset-references',
);
const { StateConflictError } = await import('~~/server/utils/errors');

/**
 * The reference count at which the one-placeholder-per-fact encoding stopped
 * fitting: six base parameters plus eight per reference, against D1's hundred.
 */
const FIRST_UNBINDABLE_REFERENCE_COUNT = 12;

/** Comfortably past it, so a fix that merely widened the ceiling is not enough. */
const LARGE_REFERENCE_COUNT = 60;

const CONTENT_DIGEST = 'c'.repeat(64);

function assetId(index: number) {
	return `asset-${`${index}`.padStart(4, '0')}`;
}

function revisionId(index: number, generation = 1) {
	return `revision-${`${index}`.padStart(4, '0')}-${generation}`;
}

/**
 * A Broadcast Graphics stack of `count` Media Graphic Items, each pinning one
 * Graphic Asset Revision. The shape the discovery walk reads, and nothing else:
 * this file is about the write, and the configuration only has to be something
 * `screenModeGraphicAssetReferences` finds references in.
 */
function stackPinning(revisions: readonly string[]) {
	return {
		graphics: [{
			id: 'graphic-one',
			items: revisions.map((revision, index) => ({
				id: `item-${`${index}`.padStart(4, '0')}`,
				type: 'media',
				mediaKind: 'image',
				asset: { assetId: assetId(index), revisionId: revision },
			})),
		}],
	};
}

function revisionsFor(count: number, generation = 1) {
	return Array.from({ length: count }, (_, index) => revisionId(index, generation));
}

let eventId: number;
let screenId: number;

/** Every reference row the authored write has published for this Screen. */
async function indexedReferences() {
	const rows = await harness.database.prepare(`
		SELECT owner_slot AS ownerSlot, revision_id AS revisionId
		FROM graphic_asset_references
		WHERE owner_kind = 'screen' AND owner_id = ?
		ORDER BY owner_slot
	`).bind(String(screenId)).all<{ ownerSlot: string; revisionId: string }>();
	return rows.results;
}

async function storedScreen() {
	return await harness.database.prepare(`
		SELECT mode_configs AS modeConfigs, state_version AS stateVersion
		FROM screens WHERE id = ?
	`).bind(screenId).first<{ modeConfigs: string; stateVersion: number }>();
}

beforeEach(async () => {
	// A fresh Event and Screen per test, so a rejected write's assertions are about
	// this test's own rows. The Event cascade takes the Screen with it.
	await db.delete(graphicAssetReferences);
	await db.delete(schema.events);
	await db.delete(graphicAssetRevisions);
	await db.delete(graphicAssets);
	await db.delete(graphicAssetContents);

	const [event] = await db.insert(schema.events).values({
		name: 'Reference limits',
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

	await db.insert(graphicAssetContents).values({
		digest: CONTENT_DIGEST,
		byteLength: 70,
		canonicalMime: 'image/png',
	} as never);

	// Two revisions per asset, so a test can move a reference from one to another
	// exactly as an author re-picking content does.
	for (let index = 0; index < LARGE_REFERENCE_COUNT; index++) {
		await db.insert(graphicAssets).values({
			id: assetId(index),
			name: `Asset ${index}`,
			kind: 'image',
		} as never);
		for (const generation of [1, 2]) {
			await db.insert(graphicAssetRevisions).values({
				id: revisionId(index, generation),
				assetId: assetId(index),
				revisionNumber: generation,
				contentDigest: CONTENT_DIGEST,
				compatibilityProfile: 'still-image-v1',
				technicalFacts: {},
			} as never);
		}
	}
});

describe('an authored Screen Mode configuration carrying many Graphic Asset References', () => {
	it('proves the limit the precondition has to fit inside is enforced here', async () => {
		// The control. Without it every assertion below would be satisfied by a
		// database that binds whatever it is handed, which is exactly the libSQL
		// harness this file exists to avoid.
		const over = Array.from({ length: D1_MAXIMUM_BOUND_PARAMETERS + 1 }, (_, index) => `${index}`);
		await expect(harness.database.prepare(`
			SELECT id FROM graphic_asset_references
			WHERE id IN (${over.map(() => '?').join(', ')})
		`).bind(...over).all()).rejects.toThrow(/too many SQL variables/i);
	});

	it('commits a save at the count the old encoding could not bind', async () => {
		const updated = await updateScreenModeConfigWithGraphicAssetReferences({
			id: screenId,
			eventId,
			mode: 'broadcast-graphics',
			partialConfig: stackPinning(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT)),
		});

		expect(updated?.stateVersion).toBe(1);
		const indexed = await indexedReferences();
		expect(indexed).toHaveLength(FIRST_UNBINDABLE_REFERENCE_COUNT);
		expect(indexed.map(row => row.revisionId).toSorted())
			.toEqual(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT).toSorted());
	});

	it('commits a save far past it, so the count no longer decides anything', async () => {
		const updated = await updateScreenModeConfigWithGraphicAssetReferences({
			id: screenId,
			eventId,
			mode: 'broadcast-graphics',
			partialConfig: stackPinning(revisionsFor(LARGE_REFERENCE_COUNT)),
		});

		expect(updated?.stateVersion).toBe(1);
		expect(await indexedReferences()).toHaveLength(LARGE_REFERENCE_COUNT);
	});

	describe('with the compare-and-swap guarantees the count must not cost', () => {
		beforeEach(async () => {
			await updateScreenModeConfigWithGraphicAssetReferences({
				id: screenId,
				eventId,
				mode: 'broadcast-graphics',
				partialConfig: stackPinning(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT)),
			});
		});

		it('rejects the save when one referenced Graphic Asset is retired under it', async () => {
			// The concurrent change: an author re-picks one item's content, and the
			// asset it names is retired between their read and their write. A newly
			// chosen revision on a retired asset must not resolve — and one failed
			// precondition out of twelve has to reject the whole save, not index the
			// other eleven.
			await harness.database.prepare(`
				UPDATE graphic_assets SET lifecycle_state = 'retired' WHERE id = ?
			`).bind(assetId(3)).run();

			const next = revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT);
			next[3] = revisionId(3, 2);

			await expect(updateScreenModeConfigWithGraphicAssetReferences({
				id: screenId,
				eventId,
				mode: 'broadcast-graphics',
				partialConfig: stackPinning(next),
			})).rejects.toThrow(StateConflictError);

			// Nothing moved: not the configuration, not the version, not the index.
			const screen = await storedScreen();
			expect(screen?.stateVersion).toBe(1);
			expect(screen?.modeConfigs).toContain(revisionId(3, 1));
			const indexed = await indexedReferences();
			expect(indexed.map(row => row.revisionId)).not.toContain(revisionId(3, 2));
		});

		it('rejects the save when the Screen has moved on since it was read', async () => {
			await expect(updateScreenModeConfigWithGraphicAssetReferences({
				id: screenId,
				eventId,
				mode: 'broadcast-graphics',
				partialConfig: stackPinning(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT, 2)),
				stateVersion: 0,
			})).rejects.toThrow(StateConflictError);

			expect((await storedScreen())?.stateVersion).toBe(1);
		});

		it('refuses through a classified conflict rather than an unhandled failure', async () => {
			// #303's symptom was a bare 500 the operator could do nothing with. Every
			// refusal on this path carries the status its transport answers with.
			const refusal = await updateScreenModeConfigWithGraphicAssetReferences({
				id: screenId,
				eventId,
				mode: 'broadcast-graphics',
				partialConfig: stackPinning(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT, 2)),
				stateVersion: 0,
			}).catch((error: unknown) => error);

			expect(refusal).toBeInstanceOf(StateConflictError);
			expect((refusal as { statusCode: number }).statusCode).toBe(409);
		});

		it('keeps a pinned revision resolvable once its own asset is retired', async () => {
			// The retirement rule the precondition carries, re-asserted at a size the
			// old encoding never reached: an unchanged reference keeps resolving, so an
			// author editing an unrelated property of a stack holding retired content
			// is not locked out of their own Screen.
			await harness.database.prepare(`
				UPDATE graphic_assets SET lifecycle_state = 'retired' WHERE id = ?
			`).bind(assetId(3)).run();

			const updated = await updateScreenModeConfigWithGraphicAssetReferences({
				id: screenId,
				eventId,
				mode: 'broadcast-graphics',
				partialConfig: stackPinning(revisionsFor(FIRST_UNBINDABLE_REFERENCE_COUNT)),
			});

			expect(updated?.stateVersion).toBe(2);
			expect(await indexedReferences()).toHaveLength(FIRST_UNBINDABLE_REFERENCE_COUNT);
		});
	});
});

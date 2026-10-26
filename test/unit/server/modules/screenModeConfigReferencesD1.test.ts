import type { BatchItem } from 'drizzle-orm/batch';
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
import {
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
} from '~~/server/schemas/api/screen';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/*
 * The authored Screen Mode configuration write carries one precondition per
 * Graphic Asset Reference, so it runs on real D1, whose 100-parameter limit libSQL
 * does not enforce (#303). Asserted at the old failing count, well past it, and at
 * the Screen's whole Graphic Item cap in one batch (#315).
 */

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

vi.doMock('~~/server/db', () => ({ db }));

const { updateScreenModeConfigWithGraphicAssetReferences } = await import(
	'~~/server/modules/screen-graphic-asset-references',
);
const { StateConflictError } = await import('~~/server/utils/errors');

/** Six base parameters plus eight per reference first passed D1's hundred here. */
const FIRST_UNBINDABLE_REFERENCE_COUNT = 12;

/** Comfortably past it, so a fix that merely widened the ceiling is not enough. */
const LARGE_REFERENCE_COUNT = 60;

/** Every reference the Graphic Item cap admits: media pins content, text pins fonts. */
const MAXIMUM_REFERENCE_COUNT = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN * 2;

/** Cost follows the number of references, not of distinct assets, so few fonts suffice. */
const FONT_ASSET_COUNT = 4;

const CONTENT_DIGEST = 'c'.repeat(64);
const FONT_CONTENT_DIGEST = 'f'.repeat(64);

function assetId(index: number) {
	return `asset-${`${index}`.padStart(4, '0')}`;
}

function revisionId(index: number, generation = 1) {
	return `revision-${`${index}`.padStart(4, '0')}-${generation}`;
}

/** A stack of Media Graphic Items, each pinning one revision: only what discovery reads. */
function stackPinning(revisions: readonly string[]) {
	return {
		graphics: [
			{
				id: 'graphic-one',
				items: revisions.map((revision, index) => ({
					id: `item-${`${index}`.padStart(4, '0')}`,
					type: 'media',
					mediaKind: 'image',
					asset: {
						assetId: assetId(index),
						revisionId: revision,
					},
				})),
			},
		],
	};
}

function revisionsFor(count: number, generation = 1) {
	return Array.from({ length: count }, (_, index) => revisionId(index, generation));
}

function fontAssetId(index: number) {
	return `font-${`${index}`.padStart(2, '0')}`;
}

function fontRevisionId(index: number) {
	return `font-revision-${`${index}`.padStart(2, '0')}`;
}

/** One font Graphic Asset Revision, as an author's typography names one. */
function fontSelection(index: number) {
	return {
		kind: 'asset',
		reference: {
			assetId: fontAssetId(index % FONT_ASSET_COUNT),
			revisionId: fontRevisionId(index % FONT_ASSET_COUNT),
		},
	};
}

/**
 * A Screen at its documented Graphic Item cap, media and text alternating across
 * three Broadcast Graphics; `repickedMediaIndex` moves one item to a second generation.
 */
function maximalStack(repickedMediaIndex?: number) {
	const graphicCount = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN
		/ MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC;
	let mediaIndex = 0;
	return {
		graphics: Array.from({ length: graphicCount }, (_, graphic) => ({
			id: `graphic-${graphic}`,
			items: Array.from({ length: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC }, (_, position) => {
				const id = `item-${graphic}-${`${position}`.padStart(4, '0')}`;
				if (position % 2 === 1) {
					// Base typography plus two Graphic Placeholder Styles.
					return {
						id,
						type: 'text',
						text: 'Round {home} of {away}',
						typography: {
							font: fontSelection(position),
						},
						placeholderStyles: {
							home: {
								font: fontSelection(position + 1),
							},
							away: {
								font: fontSelection(position + 2),
							},
						},
					};
				}
				const index = mediaIndex++;
				const asset = index % LARGE_REFERENCE_COUNT;
				return {
					id,
					type: 'media',
					mediaKind: 'image',
					asset: {
						assetId: assetId(asset),
						revisionId: revisionId(asset, index === repickedMediaIndex
							? 2
							: 1),
					},
				};
			}),
		})),
	};
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
	await db.insert(graphicAssetContents).values({
		digest: FONT_CONTENT_DIGEST,
		byteLength: 4096,
		canonicalMime: 'font/woff2',
	} as never);

	// One batch: each awaited insert is a Miniflare round trip.
	const seeds: BatchItem<'sqlite'>[] = [];

	for (let index = 0; index < FONT_ASSET_COUNT; index++) {
		seeds.push(db.insert(graphicAssets).values({
			id: fontAssetId(index),
			name: `Font ${index}`,
			kind: 'font',
		} as never));
		seeds.push(db.insert(graphicAssetRevisions).values({
			id: fontRevisionId(index),
			assetId: fontAssetId(index),
			revisionNumber: 1,
			contentDigest: FONT_CONTENT_DIGEST,
			compatibilityProfile: 'static-font-v1',
			technicalFacts: {},
		} as never));
	}

	// Two revisions per asset, so a test can re-pick content.
	for (let index = 0; index < LARGE_REFERENCE_COUNT; index++) {
		seeds.push(db.insert(graphicAssets).values({
			id: assetId(index),
			name: `Asset ${index}`,
			kind: 'image',
		} as never));
		for (const generation of [1, 2]) {
			seeds.push(db.insert(graphicAssetRevisions).values({
				id: revisionId(index, generation),
				assetId: assetId(index),
				revisionNumber: generation,
				contentDigest: CONTENT_DIGEST,
				compatibilityProfile: 'still-image-v1',
				technicalFacts: {},
			} as never));
		}
	}
	await db.batch(seeds as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
});

describe('an authored Screen Mode configuration carrying many Graphic Asset References', () => {
	it('proves the limit the precondition has to fit inside is enforced here', async () => {
		// Control: this harness does refuse an over-limit statement.
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
			// A re-pick onto a retired asset: one failed precondition rejects the whole save.
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
			// #303 surfaced as a bare 500.
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
			// An unchanged reference keeps resolving after its asset is retired.
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

// At the cap the write is 602 statements in one batch (#315). The refusal is asked
// at both ends of the reference set, since a per-chunk precondition fails one chunk
// at a time.
describe('a Broadcast Graphics Screen authored to its documented Graphic Item cap', () => {
	// A maximal write is six hundred statements against workerd; the default timeout is too short.
	const MAXIMAL_WRITE_TIMEOUT_MS = 60_000;

	it('commits every reference the cap admits in one write', async () => {
		const updated = await updateScreenModeConfigWithGraphicAssetReferences({
			id: screenId,
			eventId,
			mode: 'broadcast-graphics',
			partialConfig: maximalStack(),
		});

		expect(updated?.stateVersion).toBe(1);
		expect(await indexedReferences()).toHaveLength(MAXIMUM_REFERENCE_COUNT);
	}, MAXIMAL_WRITE_TIMEOUT_MS);

	it.each([
		['the first', 0],
		['the last', MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN / 2 - 1],
	] as const)('still refuses the whole save when %s reference stops resolving', async (_where, repicked) => {
		await updateScreenModeConfigWithGraphicAssetReferences({
			id: screenId,
			eventId,
			mode: 'broadcast-graphics',
			partialConfig: maximalStack(),
		});

		const repickedAsset = assetId(repicked % LARGE_REFERENCE_COUNT);
		const repickedRevision = revisionId(repicked % LARGE_REFERENCE_COUNT, 2);
		await harness.database.prepare(`
			UPDATE graphic_assets SET lifecycle_state = 'retired' WHERE id = ?
		`).bind(repickedAsset).run();

		await expect(updateScreenModeConfigWithGraphicAssetReferences({
			id: screenId,
			eventId,
			mode: 'broadcast-graphics',
			partialConfig: maximalStack(repicked),
		})).rejects.toThrow(StateConflictError);

		// Nothing moved: not the configuration, the version, or the index.
		const screen = await storedScreen();
		expect(screen?.stateVersion).toBe(1);
		expect(screen?.modeConfigs).not.toContain(repickedRevision);
		const indexed = await indexedReferences();
		expect(indexed).toHaveLength(MAXIMUM_REFERENCE_COUNT);
		expect(indexed.map(row => row.revisionId)).not.toContain(repickedRevision);
	}, MAXIMAL_WRITE_TIMEOUT_MS);
});

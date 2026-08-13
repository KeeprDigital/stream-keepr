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
 *
 * The same two assertions are made twice: at the reference counts the old encoding
 * failed on, and at the top of the regime removing it opened — every Graphic Item a
 * Broadcast Graphics Screen admits, which is six hundred references and six hundred
 * and two statements in one `db.batch`. The second is #315, filed because nothing
 * established whether D1 has a batch-level limit that bites somewhere above the
 * sixty references reached here. It commits.
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

/**
 * Every reference the item cap admits, which is the top of the regime #303 made
 * reachable.
 *
 * Removing the parameter ceiling moved the binding constraint off the statement and
 * onto the batch: the write still issues one prepared `INSERT` per reference, so at
 * the cap it is six hundred statements and their whole payload in a single
 * `db.batch`. Per-statement parameter counts are constant there and the tests above
 * reach sixty references, so what is unexercised is the batch itself — and D1's
 * batch-level limits, whatever they are, are not the ones this module's other tests
 * would ever meet. #315.
 *
 * Two per Graphic Item is what the stack below averages and what the cap's own
 * arithmetic admits: a Media Graphic Item pins its content, and a Text Graphic Item
 * pins a font for its base typography and one for each Graphic Placeholder Style.
 */
const MAXIMUM_REFERENCE_COUNT = MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN * 2;

/**
 * How many distinct font Graphic Assets the maximal stack draws on.
 *
 * Small on purpose, and not a weakening of the boundary: what the write costs is
 * decided by how many references a configuration publishes, not by how many assets
 * they name, and a show that painted three hundred Graphic Items in six hundred
 * different fonts is not the case worth constructing.
 */
const FONT_ASSET_COUNT = 4;

const CONTENT_DIGEST = 'c'.repeat(64);
const FONT_CONTENT_DIGEST = 'f'.repeat(64);

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
 * A Broadcast Graphics Screen authored to its documented cap: every Graphic Item it
 * admits, each pinning what its kind can pin.
 *
 * Media and text alternate so both reference kinds ride in the same batch — the
 * resolution rule the precondition carries is asked per reference and reads the
 * asset's kind, so a boundary run made entirely of one kind would leave the other's
 * six hundredth copy unproven. Assets are drawn from a small pool because a show
 * reuses its content and its fonts; what is at the cap here is the number of
 * references, which is what the write's statement count and payload are made of.
 *
 * Split across three Broadcast Graphics because one may hold at most
 * `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC` items, so the Screen-wide cap is only
 * reachable across several — which also means the six hundred references arrive
 * under three different owner-slot roots, as they would on a real Screen.
 *
 * `repickedMediaIndex` re-picks one Media Graphic Item's content onto the second
 * generation of the same asset, which is what an author changing one item does.
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
					// Three font references: the item's base typography and two Graphic
					// Placeholder Styles, each of which may override the font for one
					// `{inputKey}` run.
					return {
						id,
						type: 'text',
						text: 'Round {home} of {away}',
						typography: { font: fontSelection(position) },
						placeholderStyles: {
							home: { font: fontSelection(position + 1) },
							away: { font: fontSelection(position + 2) },
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
						revisionId: revisionId(asset, index === repickedMediaIndex ? 2 : 1),
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
	await db.insert(graphicAssetContents).values({
		digest: FONT_CONTENT_DIGEST,
		byteLength: 4096,
		canonicalMime: 'font/woff2',
	} as never);

	// The fonts the maximal stack's typography names. One revision each: a font is
	// pinned exactly as media is, and nothing here re-picks one.
	for (let index = 0; index < FONT_ASSET_COUNT; index++) {
		await db.insert(graphicAssets).values({
			id: fontAssetId(index),
			name: `Font ${index}`,
			kind: 'font',
		} as never);
		await db.insert(graphicAssetRevisions).values({
			id: fontRevisionId(index),
			assetId: fontAssetId(index),
			revisionNumber: 1,
			contentDigest: FONT_CONTENT_DIGEST,
			compatibilityProfile: 'static-font-v1',
			technicalFacts: {},
		} as never);
	}

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

/**
 * The top of the reachable regime, which is a claim about the batch rather than
 * about any statement in it.
 *
 * Nothing above this point exercises a batch of more than sixty-two statements, and
 * the write's shape is one `UPDATE`, one `DELETE`, and one `INSERT` per reference —
 * so a Screen authored to its documented cap sends six hundred and two statements
 * and every reference's payload in one `db.batch`. Whether D1 admits that was the
 * open question #315 was filed on, and it is not one the module can be reasoned
 * into answering: the limit, if there is one, belongs to the platform.
 *
 * What is asserted is the write's contract, unchanged from the sizes above — the
 * configuration commits with its whole reference set indexed, and one reference that
 * stops resolving still refuses the whole save. The refusal is here rather than
 * assumed because it is what any batching a failure would have forced must keep: a
 * write split into chunks that committed the resolvable ones would satisfy the first
 * assertion completely and have given away the compare-and-swap the module exists
 * for. It is asked at both ends of the set for the same reason — a per-chunk
 * precondition is wrong one chunk at a time.
 */
describe('a Broadcast Graphics Screen authored to its documented Graphic Item cap', () => {
	/**
	 * Every test here is given longer than the suite's default because a maximal
	 * write is genuinely six hundred statements against a Workers runtime, and each
	 * refusal below issues two of them. Several seconds is what that costs; the
	 * default five would make these report as timeouts rather than as verdicts.
	 */
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

	/**
	 * Both ends of the reference set, because a precondition that covered only part
	 * of it would be indistinguishable from one that covered all of it if the test
	 * only ever broke a reference the covered part contains.
	 *
	 * That is not hypothetical: the chunked write this ticket proposed would carry a
	 * precondition per chunk, and getting one of them wrong is precisely how the
	 * compare-and-swap would be lost. Asked at the first Media Graphic Item and at
	 * the last, a precondition built from any prefix or any suffix of the set fails
	 * one of these two.
	 */
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

		// One Media Graphic Item re-picked onto a second revision of an asset that has
		// been retired under the author. Newly chosen content on a retired asset does
		// not resolve, and one unresolvable reference in six hundred has to refuse the
		// save outright rather than index the other five hundred and ninety-nine.
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

		// Nothing moved: not the configuration, not the version, not the index — and
		// the five hundred and ninety-nine references that did still resolve are not
		// indexed at a version the Screen never reached.
		const screen = await storedScreen();
		expect(screen?.stateVersion).toBe(1);
		expect(screen?.modeConfigs).not.toContain(repickedRevision);
		const indexed = await indexedReferences();
		expect(indexed).toHaveLength(MAXIMUM_REFERENCE_COUNT);
		expect(indexed.map(row => row.revisionId)).not.toContain(repickedRevision);
	}, MAXIMAL_WRITE_TIMEOUT_MS);
});

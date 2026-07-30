import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { D1_MAXIMUM_BOUND_PARAMETERS } from '~~/server/modules/graphics-asset-library/catalogue-sql';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/**
 * These run against a real D1 binding rather than the libSQL harness, because
 * the limit under test is one libSQL does not enforce: D1 rejects a query with
 * more than a hundred bound parameters outright, and every list here is sized
 * past that on purpose.
 *
 * A list bound more than once divides the ceiling, so the sizes below are
 * chosen to break every multiplier the catalogue uses — comfortably past a
 * hundred, and past a third of a hundred for the query that references its
 * list three times.
 */
const OVER_THE_LIMIT = D1_MAXIMUM_BOUND_PARAMETERS * 3;

function digests(count: number) {
	return Array.from(
		{ length: count },
		(_, index) => `${index}`.padStart(64, '0'),
	);
}

let harness: MiniflareD1Harness;

beforeAll(async () => {
	harness = await createMiniflareD1Harness();
}, 120_000);

afterAll(async () => {
	await harness?.dispose();
});

describe('the D1 catalogue under lists longer than D1 will bind', () => {
	it('proves the limit these queries are written against is real', async () => {
		const within = digests(D1_MAXIMUM_BOUND_PARAMETERS);
		await expect(harness.database.prepare(`
			SELECT digest FROM graphic_asset_contents
			WHERE digest IN (${within.map(() => '?').join(', ')})
		`).bind(...within).all()).resolves.toBeDefined();

		// One more than D1 will bind fails the whole statement, which is exactly
		// what a placeholder-per-item predicate would do on a real sweep.
		const over = digests(D1_MAXIMUM_BOUND_PARAMETERS + 1);
		await expect(harness.database.prepare(`
			SELECT digest FROM graphic_asset_contents
			WHERE digest IN (${over.map(() => '?').join(', ')})
		`).bind(...over).all()).rejects.toThrow(/too many SQL variables/i);
	});

	it('accounts for a full scan page of digests', async () => {
		// The unexpected-object scan asks this for every object on a page, and
		// references its list three times, so it is the query with the lowest
		// ceiling in the module.
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const accounted = await catalogue.filterAccountedDigests({
			digests: digests(OVER_THE_LIMIT),
		});
		expect(accounted.size).toBe(0);
	});

	it('reads usage, expectations, and quarantine for a full queue', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		const queue = digests(OVER_THE_LIMIT);

		// Each of these backs one operational view, and each would have failed at
		// a different length: the usage read binds its list twice.
		expect((await catalogue.listContentUsageForDigests({ digests: queue })).size).toBe(0);
		expect((await catalogue.findExpectedContents({ digests: queue })).size).toBe(0);
		expect((await catalogue.findQuarantinedDigests({ digests: queue })).size).toBe(0);
	});

	it('cancels revision pruning and reads evidence for long lists', async () => {
		const catalogue = createD1GraphicsAssetCatalogue(harness.database);
		// Both are retention-path queries whose lists are sized by a sweep batch
		// rather than by anything the caller chooses.
		await expect(catalogue.cancelRevisionPruning({ limit: OVER_THE_LIMIT }))
			.resolves
			.toEqual([]);
		await expect(catalogue.listGraphicsAssetEvidence({
			limit: 10,
			categories: Array.from(
				{ length: OVER_THE_LIMIT },
				() => 'content-deleted' as const,
			),
		})).resolves.toEqual([]);
	});

	/**
	 * A Template Package carries up to a hundred packaged revisions, and its
	 * publication writes contents, assets, revisions, origins, derivatives,
	 * associations, and references for every one of them in a single batch. That
	 * is the largest list the module ever binds, and the settled limit sits
	 * exactly at the parameter ceiling, so it is worth proving against real D1
	 * rather than inferring.
	 */
	describe('a Template Package installation at the settled revision limit', () => {
		const PACKAGED_REVISION_LIMIT = 100;

		function identity(prefix: string, index: number) {
			return `${prefix}-${`${index}`.padStart(4, '0')}`;
		}

		async function seedOperation(operationId: string, updatedAt: number) {
			await harness.database.prepare(`
				INSERT INTO graphics_ingestion_operations (
					id, idempotency_key, source, stage, initiated_by, proposed_name,
					duplicate_content_policy, declared_byte_length, transferred_byte_length,
					created_at, updated_at
				) VALUES (?, ?, 'template-package', 'publishing', 'installer', 'Package',
					'create-separate', 1, 1, ?, ?)
			`).bind(operationId, operationId, updatedAt, updatedAt).run();
			return {
				id: operationId as never,
				idempotencyKey: operationId,
				source: 'template-package' as const,
				initiatedBy: 'installer',
				name: 'Package',
				duplicateContentPolicy: 'create-separate' as const,
				declaredByteLength: 1,
				transferredByteLength: 1,
				stage: 'publishing' as const,
				createdAt: new Date(updatedAt).toISOString(),
				updatedAt: new Date(updatedAt).toISOString(),
			};
		}

		function createdAsset(index: number) {
			const sourceDigest = `a${index}`.padStart(64, '0');
			const thumbnailDigest = `b${index}`.padStart(64, '0');
			return {
				packagedId: identity('packaged', index),
				basis: 'new-content' as const,
				assetId: identity('asset', index) as never,
				revisionId: identity('revision', index) as never,
				derivativeId: identity('derivative', index) as never,
				name: `Asset ${index}`,
				kind: 'image' as const,
				sourceDigest,
				sourceByteLength: 70,
				canonicalMime: 'image/png' as const,
				compatibilityProfile: 'still-image-v1',
				facts: { kind: 'image', sha256: sourceDigest, byteLength: 70 } as never,
				derivativeKind: 'thumbnail' as const,
				thumbnailDigest,
				thumbnailByteLength: 90,
				origin: {
					sourceAssetId: identity('source-asset', index) as never,
					sourceRevisionId: identity('source-revision', index) as never,
					sourceRevisionNumber: 1,
					digest: sourceDigest,
				},
			};
		}

		it('publishes a hundred created identities and their references at once', async () => {
			const catalogue = createD1GraphicsAssetCatalogue(harness.database);
			const operation = await seedOperation('operation-created', 1_000);
			const created = Array.from({ length: PACKAGED_REVISION_LIMIT }, (_, index) =>
				createdAsset(index));

			const completed = await catalogue.installTemplatePackage({
				operation,
				template: {
					id: 'template-created' as never,
					kind: 'broadcast-graphic',
					name: 'Big package',
					document: { installed: true },
					sourceTemplateIdentity: 'source-template',
				},
				created,
				reused: [],
				references: created.map((asset, index) => ({
					id: identity('reference', index),
					ownerSlot: `items[${index}].media`,
					assetId: asset.assetId,
					revisionId: asset.revisionId,
				})),
				publishedAt: new Date(2_000).toISOString(),
			});

			expect(completed.stage).toBe('completed');
			const template = await catalogue.findInstalledGraphicsTemplate('template-created' as never);
			expect(template?.references).toHaveLength(PACKAGED_REVISION_LIMIT);
		});

		it('publishes a hundred exact-origin reuses at once', async () => {
			const catalogue = createD1GraphicsAssetCatalogue(harness.database);
			// The reused identities are the ones the previous installation created,
			// so the guard's own lists are as long as a package can make them.
			const operation = await seedOperation('operation-reused', 3_000);
			const reused = Array.from({ length: PACKAGED_REVISION_LIMIT }, (_, index) => ({
				packagedId: identity('packaged', index),
				assetId: identity('asset', index) as never,
				revisionId: identity('revision', index) as never,
				name: `Asset ${index}`,
				kind: 'image' as const,
				compatibilityProfile: 'still-image-v1',
			}));

			const completed = await catalogue.installTemplatePackage({
				operation,
				template: {
					id: 'template-reused' as never,
					kind: 'broadcast-graphic',
					name: 'Big package again',
					document: { installed: true },
					sourceTemplateIdentity: 'source-template',
				},
				created: [],
				reused,
				references: reused.map((asset, index) => ({
					id: identity('reused-reference', index),
					ownerSlot: `items[${index}].media`,
					assetId: asset.assetId,
					revisionId: asset.revisionId,
				})),
				publishedAt: new Date(4_000).toISOString(),
			});

			expect(completed.stage).toBe('completed');
			const template = await catalogue.findInstalledGraphicsTemplate('template-reused' as never);
			expect(template?.references).toHaveLength(PACKAGED_REVISION_LIMIT);
		});
	});
});

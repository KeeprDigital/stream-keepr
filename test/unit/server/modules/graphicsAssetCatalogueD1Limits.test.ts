import type { GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import type { GraphicAssetImageFacts } from '~~/shared/types/graphicsAsset';
import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	graphicAssetId,
	graphicAssetRevisionId,
	graphicsDerivativeId,
	graphicsIngestionOperationId,
	installedGraphicsTemplateId,
} from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { D1_MAXIMUM_BOUND_PARAMETERS } from '~~/server/modules/graphics-asset-library/catalogue-sql';
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
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
		// Every filter the ledger offers, bound at once on top of that same long
		// category list. The list stays one bound value, so what fixes the
		// statement's parameter count is how many filters exist rather than how
		// long any one of them is.
		await expect(catalogue.listGraphicsAssetEvidence({
			limit: 10,
			categories: Array.from(
				{ length: OVER_THE_LIMIT },
				() => 'content-deleted' as const,
			),
			subject: { kind: 'graphic-asset', id: 'asset' },
			actor: 'graphics-retention-policy',
			correlationId: 'correlation',
			recordedFrom: '2026-01-01T00:00:00.000Z',
			recordedUntil: '2027-01-01T00:00:00.000Z',
			cursor: { recordedAt: '2026-06-01T00:00:00.000Z', id: 'entry' },
			direction: 'newer',
		})).resolves.toEqual([]);
		// Sealing binds its terminal-category list the same way, and it is the
		// one ledger statement whose list is fixed by the vocabulary rather than
		// by a batch size, so it grows every time a category is added.
		await expect(catalogue.sealGraphicsAssetEvidence({
			terminalCategories: Array.from(
				{ length: OVER_THE_LIMIT },
				() => 'graphic-asset-purged' as const,
			),
			retentionMilliseconds: 365 * 24 * 60 * 60 * 1000,
			limit: 200,
		})).resolves.toBe(0);
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
		const PACKAGED_REVISION_LIMIT = TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount;

		function identity(prefix: string, index: number) {
			return `${prefix}-${`${index}`.padStart(4, '0')}`;
		}

		/** Drives an operation to the stage a publication commits against. */
		async function claimedOperation(catalogue: GraphicsAssetCatalogue, key: string) {
			const created = await catalogue.initiateGraphicsIngestion({
				id: graphicsIngestionOperationId(key),
				idempotencyKey: key,
				source: 'template-package',
				initiatedBy: 'installer',
				name: 'Large package',
				sourceFileName: 'large.skgraphic',
				duplicateContentPolicy: 'create-separate',
				declaredByteLength: 1_024,
				transferredByteLength: 1_024,
				stage: 'created',
				createdAt: new Date(1_000).toISOString(),
				updatedAt: new Date(1_000).toISOString(),
			});
			return await catalogue.updateIngestionOperation(
				{ ...created, stage: 'publishing', updatedAt: new Date(2_000).toISOString() },
				created.updatedAt,
			);
		}

		function createdAsset(index: number) {
			const sourceDigest = `a${index}`.padStart(64, '0');
			const thumbnailDigest = `b${index}`.padStart(64, '0');
			return {
				packagedId: identity('packaged', index),
				basis: 'new-content' as const,
				assetId: graphicAssetId(identity('asset', index)),
				revisionId: graphicAssetRevisionId(identity('revision', index)),
				derivativeId: graphicsDerivativeId(identity('derivative', index)),
				name: `Asset ${index}`,
				kind: 'image' as const,
				sourceDigest,
				sourceByteLength: 70,
				canonicalMime: 'image/png' as const,
				compatibilityProfile: 'still-image-v1',
				facts: {
					kind: 'image',
					format: 'png',
					canonicalMime: 'image/png',
					byteLength: 70,
					sha256: sourceDigest,
					width: 1,
					height: 1,
					pixelCount: 1,
					frameCount: 1,
					bitDepth: 8,
					colorSpace: 'srgb',
					colorModel: 'rgba',
					hasAlpha: true,
					orientation: 'normal',
				} satisfies GraphicAssetImageFacts,
				derivativeKind: 'thumbnail' as const,
				thumbnailDigest,
				thumbnailByteLength: 90,
				origin: {
					sourceAssetId: graphicAssetId(identity('source-asset', index)),
					sourceRevisionId: graphicAssetRevisionId(identity('source-revision', index)),
					sourceRevisionNumber: 1,
					digest: sourceDigest,
				},
			};
		}

		/**
		 * Given a budget of its own because the default five seconds is one it was
		 * never going to fit inside. #123 records five operators seeing this test
		 * time out — never on an unloaded machine, and above roughly load 8 in
		 * something like 8 of 60 runs — while the work itself is genuine: a hundred
		 * identities, their revisions, derivatives and references, against real D1.
		 * There is no waste to remove, so what it wanted was a budget something had
		 * chosen it against.
		 *
		 * Measured rather than inherited: 1985 / 2158 / 2174 ms in three runs on a
		 * quiet machine at load ~3, and 2391–2606 ms across sixteen runs with eight
		 * copies of this file running at once. #123's operators report five to ten
		 * seconds where it failed, on machines running six to eight worktrees' full
		 * suites at load 16–36 — a condition the runs above do not reach, so that
		 * range is theirs and not a number from here.
		 *
		 * A minute is therefore some twenty-three times the worst cost measured here
		 * and six times the worst anyone has reported, and the margin is the point: a
		 * failure here should mean the batch broke, not that a sibling worktree was
		 * busy. The budget is load-bearing rather than decorative — under
		 * `--testTimeout=1` this is the one test in the file that survives, and all
		 * five unbudgeted siblings die at 1 ms.
		 */
		it('publishes a hundred created identities and their references at once', async () => {
			const catalogue = createD1GraphicsAssetCatalogue(harness.database);
			const operation = await claimedOperation(catalogue, 'install-created');
			const created = Array.from(
				{ length: PACKAGED_REVISION_LIMIT },
				(_, index) => createdAsset(index),
			);
			const templateId = installedGraphicsTemplateId('template-created');

			const completed = await catalogue.installTemplatePackage({
				operation,
				template: {
					id: templateId,
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
				publishedAt: new Date(3_000).toISOString(),
			});

			// The batch reports what it wrote, so a statement silently writing
			// fewer rows than the package has revisions would have thrown by now.
			expect(completed.stage).toBe('completed');
			expect(completed.templatePackageInstallation?.assets)
				.toHaveLength(PACKAGED_REVISION_LIMIT);
			const template = await catalogue.findInstalledGraphicsTemplate(templateId);
			expect(template?.references).toHaveLength(PACKAGED_REVISION_LIMIT);
			// Every identity is discoverable, which is only true if every asset,
			// revision, and derivative row landed.
			const assets = await catalogue.listGraphicAssets('', ['active']);
			expect(assets).toHaveLength(PACKAGED_REVISION_LIMIT);
			expect(assets.every(asset => asset.operation.id === operation.id)).toBe(true);
			expect(assets.every(asset => asset.revisionId.startsWith('revision-'))).toBe(true);
			// And every one of them is pinned, so none could enter Trash.
			const usage = await catalogue.listGraphicAssetUsage(assets[0]!.id);
			expect(usage).toHaveLength(1);
			expect(usage[0]?.owner).toMatchObject({
				kind: 'installed-graphics-template',
				name: 'Big package',
			});
		}, 60_000);

		it('publishes a hundred exact-origin reuses at once', async () => {
			const catalogue = createD1GraphicsAssetCatalogue(harness.database);
			// The reused identities are the ones the previous installation created,
			// so the guard's own lists are as long as a package can make them.
			const operation = await claimedOperation(catalogue, 'install-reused');
			const reused = Array.from({ length: PACKAGED_REVISION_LIMIT }, (_, index) => ({
				packagedId: identity('packaged', index),
				assetId: graphicAssetId(identity('asset', index)),
				revisionId: graphicAssetRevisionId(identity('revision', index)),
				name: `Asset ${index}`,
				kind: 'image' as const,
				compatibilityProfile: 'still-image-v1',
			}));
			const templateId = installedGraphicsTemplateId('template-reused');

			const completed = await catalogue.installTemplatePackage({
				operation,
				template: {
					id: templateId,
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
			const template = await catalogue.findInstalledGraphicsTemplate(templateId);
			expect(template?.references).toHaveLength(PACKAGED_REVISION_LIMIT);
			// Reuse created nothing, and left the assets describing their own
			// origin operation rather than this package.
			const assets = await catalogue.listGraphicAssets('', ['active']);
			expect(assets).toHaveLength(PACKAGED_REVISION_LIMIT);
			expect(assets.every(asset => asset.operation.id === 'install-created')).toBe(true);
		});
	});
});

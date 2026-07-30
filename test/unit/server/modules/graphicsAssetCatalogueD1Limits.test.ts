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
});

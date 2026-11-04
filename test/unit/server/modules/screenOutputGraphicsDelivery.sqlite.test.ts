import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createScreenOutputGraphicsDelivery } from '~~/server/modules/screen-output-assets/graphics-delivery';
import { deferred } from '~~/test/helpers/deferred';
import { evidenceOf } from '~~/test/helpers/graphicsEvidence';
import { digestOf, pixelPng } from '~~/test/helpers/graphicsFixtures';
import {
	canonicalIdentity,
	createTestGraphicsLibrary,
	ingestImage,
	publishedRevision,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

type D1Catalogue = ReturnType<typeof createD1GraphicsAssetCatalogue>;

/** One published PNG, and the delivery a Screen Output builds over the same catalogue and canonical store. */
async function publishedForScreenOutput(options: {
	/** Holds the reconciliation half of every report pending until it settles. */
	holdReports?: Promise<void>;
	defer?: (promise: Promise<unknown>) => void;
} = {}) {
	const catalogue = createD1GraphicsAssetCatalogue(harness.database);
	const context = createTestGraphicsLibrary({ catalogue });
	const reference = publishedRevision(await ingestImage(context, { idempotencyKey: 'on-air' }));
	const { holdReports } = options;
	const reportingCatalogue: D1Catalogue = holdReports
		? {
				...catalogue,
				findRevisionContentDigest: async (input) => {
					await holdReports;
					return await catalogue.findRevisionContentDigest(input);
				},
			}
		: catalogue;
	const delivery = createScreenOutputGraphicsDelivery({
		catalogue: reportingCatalogue,
		canonical: context.canonical,
		defer: options.defer,
	});
	return { context, reference, delivery };
}

type Published = Awaited<ReturnType<typeof publishedForScreenOutput>>;

/** The two reads a Screen Output makes for one asset request, and the store operation each asks. */
const READS: [string, (published: Published) => Promise<unknown>, 'metadata' | 'read'][] = [
	[
		'inspecting its content',
		async ({ delivery, reference }) => await delivery.inspectGraphicAssetRevisionContent(reference),
		'metadata',
	],
	[
		'resolving its bytes',
		async ({ delivery, reference }) => await delivery.resolveGraphicAssetRevision(reference),
		'read',
	],
];

async function openUnavailableContent(published: Published) {
	return (await published.context.library.getReconciliationOverview()).openCounts['unavailable-content'];
}

describe('a Screen Output\'s Graphics Asset delivery', () => {
	it.each(READS)('opens one Graphics Discrepancy, before any scheduled pass, on %s whose canonical object is missing', async (_name, read) => {
		const published = await publishedForScreenOutput();
		await published.context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));

		expect(await read(published)).toEqual({ outcome: 'unavailable', retryable: true });
		await read(published);

		expect(await openUnavailableContent(published)).toBe(1);
		expect(await evidenceOf(published.context.library, {
			categories: ['content-unavailable-detected'],
		})).toHaveLength(1);
	});

	it.each(READS)('reports nothing on %s while the byte store merely cannot answer', async (_name, read, operation) => {
		const published = await publishedForScreenOutput();
		published.context.canonical.injectTransientFailure(operation, 1);

		expect(await read(published)).toEqual({ outcome: 'unavailable', retryable: true });

		expect(await openUnavailableContent(published)).toBe(0);
		expect(await read(published)).toMatchObject({ outcome: 'available' });
	});

	it.each(READS)('answers %s before its report settles, handing the report to the Worker to finish', async (_name, read) => {
		const reports = deferred();
		const deferredWork: Promise<unknown>[] = [];
		const published = await publishedForScreenOutput({
			holdReports: reports.promise,
			defer: promise => deferredWork.push(promise),
		});
		await published.context.canonical.delete(canonicalIdentity(digestOf(pixelPng)));

		const answer = await Promise.race([
			read(published),
			new Promise(resolve => setTimeout(resolve, 1000, 'still reporting')),
		]);
		expect(answer).toEqual({ outcome: 'unavailable', retryable: true });
		expect(await openUnavailableContent(published)).toBe(0);

		reports.resolve();
		await Promise.all(deferredWork);
		expect(await openUnavailableContent(published)).toBe(1);
	});
});

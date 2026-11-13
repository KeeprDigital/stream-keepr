import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type { SqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import {
	createTestGraphicsIngestion,
	publishedRevision,
	storedGraphicAssets,
	storedRevisionContent,
} from '~~/test/helpers/graphicsLibrary';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

let harness: SqliteD1Harness;

beforeEach(async () => {
	harness = await createSqliteD1Harness();
});

afterEach(async () => {
	await harness.close();
});

function digest(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function createIngestion() {
	return createTestGraphicsIngestion({
		catalogue: createD1GraphicsAssetCatalogue(harness.database),
		identityPrefix: 'font-identity',
		start: '2026-07-28T07:00:00.000Z',
	});
}

function successfulBrowserEvidence(operation: GraphicsIngestionOperation) {
	if (operation.report?.outcome !== 'accepted' || operation.report.facts.kind !== 'font')
		throw new Error('Expected a validated font challenge');
	const exact = '1'.repeat(64);
	const sans = '2'.repeat(64);
	const mono = '3'.repeat(64);
	return {
		outcome: 'font-loaded' as const,
		sourceDigest: operation.report.facts.sha256,
		challengeDigest: operation.report.facts.browserChallenge.digest,
		glyphProofs: operation.report.facts.browserChallenge.codePoints.map(codePoint => ({
			codePoint,
			exactWithSansDigest: exact,
			exactWithMonoDigest: exact,
			sansFallbackDigest: sans,
			monoFallbackDigest: mono,
		})),
	};
}

describe('static font ingestion at the Graphic Asset ingestion seam', () => {
	it('publishes one browser-proven static face and stores its exact source revision', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mana.woff'));
		const context = createIngestion();
		const assets = context.ingestion;
		const operation = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'mana-static-face',
			initiatedBy: 'graphics-author-1',
			name: 'Mana',
			sourceFileName: 'mana.woff',
			declaredMime: 'font/woff',
			declaredByteLength: source.byteLength,
		});
		const awaitingEvidence = await assets.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: 'font/woff',
			bytes: createBoundedByteStream(source, {
				byteLength: source.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		expect(awaitingEvidence).toMatchObject({
			stage: 'awaiting-confirmation',
			report: {
				outcome: 'accepted',
				facts: {
					kind: 'font',
					browserChallenge: {
						digest: expect.stringMatching(/^[a-f0-9]{64}$/),
						codePoints: expect.arrayContaining([48]),
					},
				},
			},
		});
		expect(await storedGraphicAssets(context)).toEqual([]);
		const completed = await assets.confirmFontBrowserEvidence({
			operationId: awaitingEvidence.id,
			initiatedBy: awaitingEvidence.initiatedBy,
			evidence: successfulBrowserEvidence(awaitingEvidence),
		});

		expect(completed).toMatchObject({
			stage: 'completed',
			report: {
				outcome: 'accepted',
				compatibilityProfile: 'static-font-v1',
				facts: {
					kind: 'font',
					family: 'Mana',
					browserLoadable: true,
					representativeGlyphsRendered: true,
				},
			},
		});
		await expect(storedGraphicAssets(context)).resolves.toMatchObject([
			{
				kind: 'font',
				revisionId: completed.result!.revisionId,
			},
		]);
		await expect(storedRevisionContent(context, publishedRevision(completed))).resolves.toEqual({
			contentType: 'font/woff',
			byteLength: source.byteLength,
			bytes: source,
		});
	});

	it('fails closed when FontFace loading or representative rendering was not proven', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		const context = createIngestion();
		const assets = context.ingestion;
		const operation = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'fontface-rejected',
			initiatedBy: 'graphics-author-1',
			name: 'Rejected face',
			sourceFileName: 'mana.ttf',
			declaredMime: 'font/ttf',
			declaredByteLength: source.byteLength,
		});
		const awaitingEvidence = await assets.uploadGraphicAsset({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			declaredMime: 'font/ttf',
			bytes: createBoundedByteStream(source, {
				byteLength: source.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		if (awaitingEvidence.report?.outcome !== 'accepted' || awaitingEvidence.report.facts.kind !== 'font')
			throw new Error('Expected a validated font challenge');
		const failed = await assets.confirmFontBrowserEvidence({
			operationId: awaitingEvidence.id,
			initiatedBy: awaitingEvidence.initiatedBy,
			evidence: {
				outcome: 'font-rejected',
				sourceDigest: digest(source),
				challengeDigest: awaitingEvidence.report.facts.browserChallenge.digest,
				stage: 'render',
			},
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'static-font-v1',
				issues: [
					{ code: 'browser-font-render-failed' },
				],
			},
		});
		await expect(storedGraphicAssets(context)).resolves.toEqual([]);
	});

	it('rejects fallback-dependent glyph proof even when the source digest and challenge match', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		const context = createIngestion();
		const assets = context.ingestion;
		const initiated = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'fallback-dependent',
			initiatedBy: 'graphics-author-1',
			name: 'Fallback dependent',
			sourceFileName: 'mana.ttf',
			declaredMime: 'font/ttf',
			declaredByteLength: source.byteLength,
		});
		const awaitingEvidence = await assets.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			bytes: createBoundedByteStream(source, {
				byteLength: source.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		const evidence = successfulBrowserEvidence(awaitingEvidence);
		evidence.glyphProofs[0]!.exactWithMonoDigest = evidence.glyphProofs[0]!.monoFallbackDigest;
		const failed = await assets.confirmFontBrowserEvidence({
			operationId: awaitingEvidence.id,
			initiatedBy: awaitingEvidence.initiatedBy,
			evidence,
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				issues: [
					{ code: 'browser-font-render-failed' },
				],
			},
		});
	});

	it('retains font classification for malformed signature-only sources', async () => {
		const source = Uint8Array.of(0, 1, 0, 0, 0, 1);
		const context = createIngestion();
		const assets = context.ingestion;
		const initiated = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'signature-only-font',
			initiatedBy: 'graphics-author-1',
			name: 'Malformed signature font',
			declaredByteLength: source.byteLength,
		});
		const failed = await assets.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			bytes: createBoundedByteStream(source, {
				byteLength: source.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		expect(failed).toMatchObject({
			stage: 'failed',
			report: {
				outcome: 'rejected',
				compatibilityProfile: 'static-font-v1',
				issues: [
					{ code: 'font-table-invalid' },
				],
			},
		});
	});

	it('replaces font Graphic Asset Content with an immutable exact Graphic Asset Revision', async () => {
		const originalSource = new Uint8Array(await readFile('public/fonts/mana.woff'));
		const replacementSource = new Uint8Array(await readFile('public/fonts/mana.ttf'));
		const context = createIngestion();
		const assets = context.ingestion;
		const initiated = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'replaceable-font-original',
			initiatedBy: 'graphics-author-1',
			name: 'Replaceable Mana',
			sourceFileName: 'mana.woff',
			declaredMime: 'font/woff',
			declaredByteLength: originalSource.byteLength,
		});
		const originalChallenge = await assets.uploadGraphicAsset({
			operationId: initiated.id,
			initiatedBy: initiated.initiatedBy,
			declaredMime: 'font/woff',
			bytes: createBoundedByteStream(originalSource, {
				byteLength: originalSource.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		const original = await assets.confirmFontBrowserEvidence({
			operationId: originalChallenge.id,
			initiatedBy: originalChallenge.initiatedBy,
			evidence: successfulBrowserEvidence(originalChallenge),
		});

		const replacement = await assets.initiateGraphicAssetReplacement({
			assetId: original.result!.assetId,
			idempotencyKey: 'replaceable-font-ttf',
			initiatedBy: 'graphics-author-1',
			sourceFileName: 'mana.ttf',
			declaredMime: 'font/ttf',
			declaredByteLength: replacementSource.byteLength,
		});
		const replacementChallenge = await assets.uploadGraphicAsset({
			operationId: replacement.id,
			initiatedBy: replacement.initiatedBy,
			declaredMime: 'font/ttf',
			bytes: createBoundedByteStream(replacementSource, {
				byteLength: replacementSource.byteLength,
				maximumByteLength: 10 * 1024 * 1024,
			}),
		});
		const completed = await assets.confirmFontBrowserEvidence({
			operationId: replacementChallenge.id,
			initiatedBy: replacementChallenge.initiatedBy,
			evidence: successfulBrowserEvidence(replacementChallenge),
		});

		expect(completed.result).toMatchObject({
			outcome: 'revision-created',
			assetId: original.result?.assetId,
		});
		await expect(storedGraphicAssets(context)).resolves.toMatchObject([
			{
				id: original.result?.assetId,
				kind: 'font',
				revisionId: completed.result?.revisionId,
				revisionNumber: 2,
			},
		]);
		await expect(storedRevisionContent(context, publishedRevision(original)))
			.resolves
			.toMatchObject({ contentType: 'font/woff' });
	});
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	consumeBoundedByteStream,
	createBoundedByteStream,
} from '~~/server/modules/graphics-asset-library/object-store';

function digest(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function library() {
	let identity = 0;
	return createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging: createInMemoryStagingGraphicsObjectStore(),
		canonical: createInMemoryCanonicalGraphicsObjectStore(),
		generateIdentity: () => `font-identity-${++identity}`,
		now: () => new Date('2026-07-28T07:00:00.000Z'),
	});
}

function successfulBrowserEvidence(operation: Awaited<ReturnType<ReturnType<typeof library>['uploadGraphicAsset']>>) {
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

describe('static font ingestion through the Graphics Asset Library public module', () => {
	it('publishes one browser-proven static face and resolves its exact source revision', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		const assets = library();
		const operation = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'mplantin-static-face',
			initiatedBy: 'graphics-author-1',
			name: 'MPlantin',
			sourceFileName: 'mplantin.woff',
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
		expect(await assets.listGraphicAssets({})).toEqual([]);
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
					family: 'MPlantin',
					browserLoadable: true,
					representativeGlyphsRendered: true,
				},
			},
		});
		await expect(assets.listGraphicAssets({})).resolves.toMatchObject([{
			kind: 'font',
			revisionId: completed.result!.revisionId,
		}]);
		const resolved = await assets.resolveGraphicAssetRevision({
			assetId: completed.result!.assetId,
			revisionId: completed.result!.revisionId,
		});
		expect(resolved).toMatchObject({
			outcome: 'available',
			contentType: 'font/woff',
		});
		if (resolved.outcome !== 'available')
			throw new Error('Expected exact font revision content');
		await expect(consumeBoundedByteStream({
			body: resolved.body,
			byteLength: resolved.byteLength,
			maximumByteLength: source.byteLength,
		})).resolves.toEqual(source);
	});

	it('fails closed when FontFace loading or representative rendering was not proven', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));
		const assets = library();
		const operation = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'fontface-rejected',
			initiatedBy: 'graphics-author-1',
			name: 'Rejected face',
			sourceFileName: 'mplantin.ttf',
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
				issues: [{ code: 'browser-font-render-failed' }],
			},
		});
		await expect(assets.listGraphicAssets({})).resolves.toEqual([]);
	});

	it('rejects fallback-dependent glyph proof even when the source digest and challenge match', async () => {
		const source = new Uint8Array(await readFile('public/fonts/mplantin.ttf'));
		const assets = library();
		const initiated = await assets.initiateGraphicsIngestion({
			idempotencyKey: 'fallback-dependent',
			initiatedBy: 'graphics-author-1',
			name: 'Fallback dependent',
			sourceFileName: 'mplantin.ttf',
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
				issues: [{ code: 'browser-font-render-failed' }],
			},
		});
	});

	it('retains font classification for malformed signature-only sources', async () => {
		const source = Uint8Array.of(0, 1, 0, 0, 0, 1);
		const assets = library();
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
				issues: [{ code: 'font-table-invalid' }],
			},
		});
	});
});

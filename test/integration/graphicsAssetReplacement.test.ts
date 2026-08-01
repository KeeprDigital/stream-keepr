import type {
	GraphicAsset,
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);
const pngPixel = Uint8Array.of(
	...basePixelPng.slice(0, -12),
	...emptyTextChunk,
	...basePixelPng.slice(-12),
);
const replacementPng = Uint8Array.of(
	...basePixelPng.slice(0, -12),
	...emptyTextChunk,
	...emptyTextChunk,
	...basePixelPng.slice(-12),
);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

describe('the Graphic Asset replacement and explicit adoption', () => {
	let eventId: number;
	let screenId: number;
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await createGraphicsAuthorSessionCookie() };
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Replacement Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Replacement overlay',
				slug: `replacement-overlay-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		screenId = screen.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('keeps each Graphic Asset Reference pinned until its owning Screen explicitly adopts a newer Graphic Asset Revision', async () => {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey: 'replacement-integration-original',
					name: 'Replaceable integration logo',
					defaultEventId: eventId,
					duplicateContentPolicy: 'create-separate',
					browserDecodeEvidence: decodeEvidence(pngPixel),
					declaredByteLength: pngPixel.byteLength,
				},
			},
		);
		const original = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: pngPixel },
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
		const originalReference = {
			assetId: original.result!.assetId,
			revisionId: original.result!.revisionId,
		};
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = originalReference;
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);

		const replacementOperation = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${originalReference.assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey: 'replacement-integration-jpeg',
					sourceFileName: 'new-logo.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(replacementPng),
					declaredByteLength: replacementPng.byteLength,
				},
			},
		);
		const replaced = await fetch(
			`/api/graphics-assets/ingestion-operations/${replacementOperation.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: replacementPng,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
		expect(replaced.result).toMatchObject({
			outcome: 'revision-created',
			assetId: originalReference.assetId,
		});

		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
		)).resolves.toEqual([
			expect.objectContaining({
				reference: originalReference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Replacement overlay',
					slot: 'layout.frame.backgroundImage',
					eventId,
				},
			}),
		]);
		const oldContent = await fetch(
			`/api/graphics-assets/${originalReference.assetId}/revisions/${originalReference.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(oldContent.status).toBe(200);
		expect(new Uint8Array(await oldContent.arrayBuffer())).toEqual(pngPixel);

		const [latest] = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'Replaceable integration logo' },
		});
		expect(latest).toMatchObject({
			id: originalReference.assetId,
			revisionId: replaced.result?.revisionId,
			revisionNumber: 2,
		});

		const renamed = await $fetch<GraphicAsset>(
			`/api/graphics-assets/${originalReference.assetId}`,
			{
				method: 'PATCH',
				body: { name: 'Renamed integration logo', eventIds: [] },
			},
		);
		expect(renamed).toMatchObject({
			revisionId: replaced.result?.revisionId,
			revisionNumber: 2,
			name: 'Renamed integration logo',
			eventIds: [],
		});
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
		)).resolves.toEqual([
			expect.objectContaining({ reference: originalReference }),
		]);

		config.layout.frame.backgroundImage = {
			assetId: originalReference.assetId,
			revisionId: replaced.result!.revisionId,
		};
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
		)).resolves.toEqual([
			expect.objectContaining({
				reference: config.layout.frame.backgroundImage,
				owner: expect.objectContaining({ eventId, id: String(screenId) }),
			}),
		]);

		const concurrentOperations = await Promise.all(
			['replacement-integration-concurrent-a', 'replacement-integration-concurrent-b'].map(
				async idempotencyKey => await $fetch<GraphicsIngestionOperation>(
					`/api/graphics-assets/${originalReference.assetId}/replacement-operations`,
					{
						method: 'POST',
						headers: authorHeaders,
						body: {
							idempotencyKey,
							sourceFileName: `${idempotencyKey}.png`,
							declaredMime: 'image/png',
							browserDecodeEvidence: decodeEvidence(pngPixel),
							declaredByteLength: pngPixel.byteLength,
						},
					},
				),
			),
		);
		const concurrentReplacements = await Promise.all(concurrentOperations.map(
			async operation => await fetch(
				`/api/graphics-assets/ingestion-operations/${operation.id}/content`,
				{
					method: 'PUT',
					headers: { ...authorHeaders, 'content-type': 'image/png' },
					body: pngPixel,
				},
			).then(response => response.json() as Promise<GraphicsIngestionOperation>),
		));
		expect(concurrentReplacements.map(operation => operation.result?.outcome).sort()).toEqual([
			'replacement-noop',
			'revision-created',
		]);
		expect(new Set(
			concurrentReplacements.map(operation => operation.result?.revisionId),
		).size).toBe(1);
		const [concurrentLatest] = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			query: { search: 'Renamed integration logo' },
		});
		expect(concurrentLatest).toMatchObject({
			id: originalReference.assetId,
			revisionId: concurrentReplacements[0]!.result?.revisionId,
			revisionNumber: 3,
		});
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${originalReference.assetId}/usage`,
		)).resolves.toEqual([
			expect.objectContaining({
				reference: config.layout.frame.backgroundImage,
			}),
		]);
	});
});

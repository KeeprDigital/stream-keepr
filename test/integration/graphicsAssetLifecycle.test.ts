import type {
	GraphicAsset,
	GraphicAssetLifecycleAction,
	GraphicAssetLifecycleActionOutcome,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { $fetch, fetch } from './client';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * This suite's own content, padded with chunk counts no other suite uses.
 *
 * The bare single-pixel PNG was `graphicsAssetIngestion.test.ts`'s to publish —
 * it asserts its ingestion *published* rather than reused — and this suite's
 * `create-separate` policy does not keep its bytes to itself: it creates a
 * second Graphic Asset over the same canonical content, which the other suite's
 * default reuse policy then finds. One chunk was `graphicsAssetReferences`'
 * digest for the same reason.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		basePixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		basePixelPng.slice(-12),
	]));
}

const lifecyclePixelPng = pngWithTextChunks(90);
const lifecycleReplacementPng = pngWithTextChunks(91);

function decodeEvidence(bytes = lifecyclePixelPng) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

describe('the recoverable Graphic Asset lifecycle', () => {
	let eventId: number;
	let screenId: number;
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await createGraphicsAuthorSessionCookie() };
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Lifecycle Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Lifecycle overlay',
				slug: `lifecycle-overlay-${eventId}`,
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

	async function ingest(name: string, idempotencyKey: string) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey,
					name,
					defaultEventId: eventId,
					browserDecodeEvidence: decodeEvidence(),
					declaredByteLength: lifecyclePixelPng.byteLength,
				}),
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: lifecyclePixelPng },
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
	}

	async function lifecycleAction(assetId: string, action: GraphicAssetLifecycleAction) {
		return await $fetch<GraphicAssetLifecycleActionOutcome>(
			`/api/graphics-assets/${assetId}/lifecycle-actions`,
			{ method: 'POST', headers: authorHeaders, body: { action } },
		);
	}

	async function replace(assetId: string, idempotencyKey: string) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: {
					idempotencyKey,
					sourceFileName: 'replacement.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(lifecycleReplacementPng),
					declaredByteLength: lifecycleReplacementPng.byteLength,
				},
			},
		);
		return await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { ...authorHeaders, 'content-type': 'image/png' },
				body: lifecycleReplacementPng,
			},
		).then(response => response.json() as Promise<GraphicsIngestionOperation>);
	}

	it('retires and restores without changing identity, revision history, metadata, associations, or exact-reference delivery', async () => {
		const operation = await ingest('Retirable lifecycle logo', 'lifecycle-retire');
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference;
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		const replacement = await replace(reference.assetId, 'lifecycle-retire-replacement');
		await $fetch(`/api/graphics-assets/${reference.assetId}`, {
			method: 'PATCH',
			headers: authorHeaders,
			body: {
				name: 'Renamed retirable lifecycle logo',
				eventIds: [eventId],
			},
		});

		const retired = await lifecycleAction(reference.assetId, 'retire');
		expect(retired).toMatchObject({
			outcome: 'retired',
			asset: {
				id: reference.assetId,
				name: 'Renamed retirable lifecycle logo',
				revisionId: replacement.result!.revisionId,
				revisionNumber: 2,
				eventIds: [eventId],
				lifecycle: { state: 'retired' },
				revisions: [
					{
						id: reference.revisionId,
						revisionNumber: 1,
					},
					{
						id: replacement.result!.revisionId,
						revisionNumber: 2,
					},
				],
			},
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Renamed retirable lifecycle logo' },
		})).resolves.toEqual([]);
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Renamed retirable lifecycle logo', lifecycleStates: 'retired' },
		})).resolves.toEqual([
			expect.objectContaining({
				id: reference.assetId,
				revisionId: replacement.result!.revisionId,
				revisionNumber: 2,
				lifecycle: { state: 'retired' },
			}),
		]);

		const delivered = await fetch(
			`/api/graphics-assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(delivered.status).toBe(200);
		expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(lifecyclePixelPng);
		const latestDelivered = await fetch(
			`/api/graphics-assets/${reference.assetId}/revisions/${replacement.result!.revisionId}/content`,
			{ headers: authorHeaders },
		);
		expect(latestDelivered.status).toBe(200);
		expect(new Uint8Array(await latestDelivered.arrayBuffer()))
			.toEqual(lifecycleReplacementPng);

		const secondScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Retired selection rejection',
				slug: `retired-selection-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		await expect($fetch(
			`/api/events/${eventId}/screens/${secondScreen.id}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		)).rejects.toMatchObject({ statusCode: 409 });

		const restored = await lifecycleAction(reference.assetId, 'restore');
		expect(restored).toMatchObject({
			outcome: 'restored',
			asset: {
				id: reference.assetId,
				name: 'Renamed retirable lifecycle logo',
				revisionId: replacement.result!.revisionId,
				revisionNumber: 2,
				eventIds: [eventId],
				lifecycle: { state: 'active' },
				revisions: [
					{
						id: reference.revisionId,
						revisionNumber: 1,
					},
					{
						id: replacement.result!.revisionId,
						revisionNumber: 2,
					},
				],
			},
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Renamed retirable lifecycle logo' },
		})).resolves.toEqual([
			expect.objectContaining({
				id: reference.assetId,
				revisionId: replacement.result!.revisionId,
				revisionNumber: 2,
				lifecycle: { state: 'active' },
			}),
		]);
	});

	it('moves only explicitly requested unreferenced assets to Trash and restores their prior state', async () => {
		const operation = await ingest('Recoverable lifecycle logo', 'lifecycle-trash');
		const assetId = operation.result!.assetId;
		const revisionId = operation.result!.revisionId;

		await lifecycleAction(assetId, 'retire');
		const trashed = await lifecycleAction(assetId, 'trash');
		expect(trashed).toMatchObject({
			outcome: 'trashed',
			asset: {
				id: assetId,
				name: 'Recoverable lifecycle logo',
				revisionId,
				revisionNumber: 1,
				eventIds: [eventId],
				lifecycle: {
					state: 'trashed',
					priorState: 'retired',
				},
			},
		});
		if (trashed.outcome !== 'trashed')
			throw new Error('Expected explicit Trash request to succeed');
		expect(
			new Date(trashed.asset.lifecycle.state === 'trashed'
				? trashed.asset.lifecycle.recoverableUntil
				: '').getTime()
			- new Date(trashed.asset.lifecycle.state === 'trashed'
				? trashed.asset.lifecycle.trashedAt
				: '').getTime(),
		).toBe(30 * 24 * 60 * 60 * 1000);

		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Recoverable lifecycle logo' },
		})).resolves.toEqual([]);
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Recoverable lifecycle logo', lifecycleStates: 'trashed' },
		})).resolves.toEqual([
			expect.objectContaining({
				id: assetId,
				name: 'Recoverable lifecycle logo',
				revisionId,
				revisionNumber: 1,
				eventIds: [eventId],
				lifecycle: expect.objectContaining({
					state: 'trashed',
					priorState: 'retired',
				}),
			}),
		]);

		const restored = await lifecycleAction(assetId, 'restore');
		expect(restored).toMatchObject({
			outcome: 'restored',
			asset: {
				id: assetId,
				name: 'Recoverable lifecycle logo',
				revisionId,
				revisionNumber: 1,
				eventIds: [eventId],
				lifecycle: { state: 'retired' },
			},
		});
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Recoverable lifecycle logo' },
		})).resolves.toEqual([]);

		const active = await lifecycleAction(assetId, 'restore');
		expect(active).toMatchObject({
			outcome: 'restored',
			asset: {
				id: assetId,
				revisionId,
				lifecycle: { state: 'active' },
			},
		});
	});

	it('returns the complete current usage summary instead of moving a referenced asset to Trash', async () => {
		const operation = await ingest('Referenced lifecycle logo', 'lifecycle-in-use');
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const secondScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Second lifecycle usage',
				slug: `second-lifecycle-usage-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		const thirdScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Third lifecycle usage',
				slug: `third-lifecycle-usage-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference;
		// The response is not read, and inferring its route-typed shape inside a
		// `map` exhausts the type comparison depth limit.
		await Promise.all([secondScreen.id, thirdScreen.id].map(async id => await $fetch<unknown>(
			`/api/events/${eventId}/screens/${id}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		)));

		// Both references, in whichever order they landed: the two Screens were
		// written concurrently just above, so pinning the order of the summary
		// would be asserting which of two racing writes committed first rather
		// than that the summary is complete.
		const blocked = await lifecycleAction(reference.assetId, 'trash');
		// A narrowing check rather than an `expect`, because only the `in-use`
		// arm of the outcome carries the usage the assertions below read.
		if (blocked.outcome !== 'in-use')
			throw new Error(`expected an in-use refusal, got ${blocked.outcome}`);
		expect(blocked.usage).toHaveLength(2);
		expect(blocked.usage).toEqual(expect.arrayContaining(
			[secondScreen.id, thirdScreen.id].map(id => expect.objectContaining({
				reference,
				owner: expect.objectContaining({
					kind: 'screen',
					id: String(id),
					eventId,
				}),
			})),
		));
		await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: { search: 'Referenced lifecycle logo' },
		})).resolves.toEqual([
			expect.objectContaining({
				id: reference.assetId,
				lifecycle: { state: 'active' },
			}),
		]);
	});

	it('commits either a new exact reference or Trash, never both', async () => {
		const operation = await ingest('Racing lifecycle logo', 'lifecycle-race');
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const racingScreen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Lifecycle race',
				slug: `lifecycle-race-${eventId}`,
				currentMode: 'feature-match-overlay',
			},
		});
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference;

		const [referenceResult, trashResult] = await Promise.allSettled([
			$fetch(
				`/api/events/${eventId}/screens/${racingScreen.id}/config/feature-match-overlay`,
				{ method: 'PATCH', body: { layout: config.layout } },
			),
			lifecycleAction(reference.assetId, 'trash'),
		]);
		const [asset] = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: authorHeaders,
			query: {
				search: 'Racing lifecycle logo',
				lifecycleStates: 'active,trashed',
			},
		});
		const usage = await $fetch(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: authorHeaders },
		);

		if (asset!.lifecycle.state === 'trashed') {
			expect(referenceResult.status).toBe('rejected');
			expect(trashResult).toMatchObject({
				status: 'fulfilled',
				value: { outcome: 'trashed' },
			});
			expect(usage).toEqual([]);
		}
		else {
			expect(referenceResult.status).toBe('fulfilled');
			expect(trashResult).toMatchObject({
				status: 'fulfilled',
				value: {
					outcome: 'in-use',
					usage: [expect.objectContaining({ reference })],
				},
			});
			expect(usage).toEqual([expect.objectContaining({ reference })]);
		}
	});

	/**
	 * A lifecycle filter naming a shelf the library does not have is a request
	 * nobody can answer, and until #309 the listing route cast the caller's
	 * string straight through — the library classified the refusal correctly and
	 * the unwrapped handler reported it as a bare 500, which tells a client to
	 * retry a request that can never succeed.
	 */
	it('refuses a lifecycle filter naming a shelf that does not exist', async () => {
		const response = await fetch(
			'/api/graphics-assets?lifecycleStates=bogus',
			{ headers: authorHeaders },
		);

		expect(response.status).toBe(400);
	});

	it('refuses an empty lifecycle filter rather than reading it as no filter', async () => {
		const response = await fetch(
			'/api/graphics-assets?lifecycleStates=',
			{ headers: authorHeaders },
		);

		expect(response.status).toBe(400);
	});
});

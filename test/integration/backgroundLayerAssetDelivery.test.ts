import type { ScreenResponse } from '~~/shared/api';
import type {
	GraphicAssetLifecycleActionOutcome,
	GraphicAssetReference,
	GraphicAssetRetentionView,
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODES_WITH_A_BACKGROUND_LAYER_STACK } from '../helpers/backgroundLayerModes';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { expectOperationResult } from './responseStatus';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/** This suite's own content: chunk counts no other suite pads with. */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		basePixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		basePixelPng.slice(-12),
	]));
}

const pixelPng = pngWithTextChunks(130);
const replacementPng = pngWithTextChunks(131);

function decodeEvidence(bytes: Uint8Array) {
	return {
		outcome: 'decoded' as const,
		sourceDigest: createHash('sha256').update(bytes).digest('hex'),
		width: 1,
		height: 1,
	};
}

/**
 * A plain overlay mode's own Background Layer stack, end to end (#580).
 *
 * The stack saved and rendered in Preview long before this held, because Preview
 * resolves media as the author. What a Screen Output resolves is decided by the
 * Screen's Graphic Asset Reference index, and what may be trashed or purged is
 * decided by the same index, so an asset layer the index never saw was blank on
 * air and unprotected at once. Each mode gets its own Graphic Asset, so one mode's
 * reference cannot stand in for another's protection.
 */
describe('a plain overlay mode’s asset Background Layer', () => {
	let eventId: number;
	let authorCookie: string;

	beforeAll(async () => {
		authorCookie = await operatorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Background Layer Asset Delivery Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	async function ingest(mode: string): Promise<GraphicAssetReference> {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie: authorCookie },
				body: graphicsIngestionRequest({
					idempotencyKey: `background-layer-plate-${mode}`,
					name: `Background Layer plate (${mode})`,
					defaultEventId: eventId,
					browserDecodeEvidence: decodeEvidence(pixelPng),
					declaredByteLength: pixelPng.byteLength,
				}),
			},
		);
		const upload = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { cookie: authorCookie },
				body: pixelPng,
			},
		);
		const operation = await expectOperationResult(upload);
		return { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
	}

	async function replace(mode: string, assetId: string) {
		const initiated = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/${assetId}/replacement-operations`,
			{
				method: 'POST',
				headers: { cookie: authorCookie },
				body: {
					idempotencyKey: `background-layer-plate-replacement-${mode}`,
					sourceFileName: 'replacement.png',
					declaredMime: 'image/png',
					browserDecodeEvidence: decodeEvidence(replacementPng),
					declaredByteLength: replacementPng.byteLength,
				},
			},
		);
		const upload = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{
				method: 'PUT',
				headers: { 'cookie': authorCookie, 'content-type': 'image/png' },
				body: replacementPng,
			},
		);
		await expectOperationResult(upload);
	}

	describe.each(MODES_WITH_A_BACKGROUND_LAYER_STACK)('on a %s Screen', (mode) => {
		let screenId: number;
		let capability: string;
		let reference: GraphicAssetReference;

		beforeAll(async () => {
			reference = await ingest(mode);
			const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
				method: 'POST',
				body: {
					name: `Background Layer ${mode}`,
					slug: `background-layer-${mode.toLowerCase()}`,
					currentMode: mode,
				},
			});
			screenId = screen.id;
			capability = (await $fetch<{ assetCapability: string }>(
				`/api/events/${eventId}/screens/${screenId}/asset-capability`,
				{
					headers: { cookie: authorCookie },
				},
			)).assetCapability;

			await $fetch(`/api/events/${eventId}/screens/${screenId}/config/${mode}`, {
				method: 'PATCH',
				body: {
					backgroundLayers: [
						{
							id: 'plate',
							type: 'image',
							enabled: true,
							opacity: 1,
							source: { kind: 'asset', ...reference },
							fit: 'cover',
						},
						{
							id: 'remote',
							type: 'image',
							enabled: true,
							opacity: 1,
							source: { kind: 'url', url: 'https://example.com/plate.png' },
							fit: 'cover',
						},
					],
				},
			});
		});

		it('resolves the pinned revision on the Screen Output through its capability alone', async () => {
			const delivered = await fetch(
				`/api/screen-output/screens/${screenId}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
				{
					headers: { authorization: `Bearer ${capability}` },
				},
			);

			expect(delivered.status).toBe(200);
			expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(pixelPng);
		});

		it('counts the revision as in use, under the layer that pins it, and refuses to trash it', async () => {
			const usage = await $fetch<GraphicAssetUsage[]>(
				`/api/graphics-assets/${reference.assetId}/usage`,
				{
					headers: { cookie: authorCookie },
				},
			);
			expect(usage).toEqual([
				expect.objectContaining({
					reference,
					owner: expect.objectContaining({
						kind: 'screen',
						id: String(screenId),
						slot: `${mode}.backgroundLayers.plate.source`,
						eventId,
					}),
				}),
			]);

			const trashed = await $fetch<GraphicAssetLifecycleActionOutcome>(
				`/api/graphics-assets/${reference.assetId}/lifecycle-actions`,
				{
					method: 'POST',
					headers: { cookie: authorCookie },
					body: { action: 'trash' },
				},
			);
			expect(trashed).toMatchObject({ outcome: 'in-use' });
		});

		it('keeps the pinned revision once superseded, with no pruning deadline, still on air', async () => {
			// Trash is the only way to Purge, and it is refused above; Revision Pruning
			// is the other reclamation, and it reaches only an unreferenced superseded
			// revision. Superseding the pinned one is what puts it in that path.
			await replace(mode, reference.assetId);

			const view = await $fetch<GraphicAssetRetentionView>(
				`/api/graphics-assets/${reference.assetId}/retention`,
				{
					headers: { cookie: authorCookie },
				},
			);
			expect(view.revisions).toContainEqual(expect.objectContaining({
				revisionId: reference.revisionId,
				retention: { policy: 'referenced', referenceCount: 1 },
			}));

			const delivered = await fetch(
				`/api/screen-output/screens/${screenId}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
				{
					headers: { authorization: `Bearer ${capability}` },
				},
			);
			expect(delivered.status).toBe(200);
		});
	});
});

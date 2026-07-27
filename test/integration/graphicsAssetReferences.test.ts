import type {
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { executeIntegrationD1 } from './integrationD1';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const referencePixelPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85),
	basePixelPng.slice(-12),
]));

describe('feature Match Overlay exact Graphic Asset References', () => {
	let eventId: number;
	let screenId: number;
	let operation: GraphicsIngestionOperation;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphic Asset Reference Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Pinned Overlay',
				slug: 'pinned-overlay',
				currentMode: 'feature-match-overlay',
			},
		});
		screenId = screen.id;
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			body: {
				idempotencyKey: 'reference-event-logo',
				name: 'Reference Event logo',
				defaultEventId: eventId,
				declaredByteLength: referencePixelPng.byteLength,
			},
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', body: referencePixelPng },
		);
		operation = await response.json() as GraphicsIngestionOperation;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('atomically saves Screen configuration and every persisted exact-revision usage', async () => {
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference;
		config.layout.items.push({
			id: 'sponsor-logo',
			type: 'widget',
			label: 'Sponsor logo',
			visible: true,
			x: 20,
			y: 20,
			width: 200,
			height: 100,
			widget: {
				type: 'image',
				asset: reference,
				fit: 'contain',
				opacity: 1,
				borderRadius: 0,
			},
		});

		const updated = await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		expect(updated.modeConfigs['feature-match-overlay'].layout.frame.backgroundImage).toEqual(reference);

		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
		);
		expect(usage).toEqual([
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					slot: 'layout.frame.backgroundImage',
					eventId,
				},
			}),
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					slot: 'layout.items.sponsor-logo.widget.asset',
					eventId,
				},
			}),
		]);
	});

	it('rejects a newly introduced missing reference without changing configuration or usage', async () => {
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const config = structuredClone(current.modeConfigs['feature-match-overlay']);
		config.layout.frame.backgroundImage = {
			assetId: 'missing-asset',
			revisionId: 'missing-revision',
		};
		config.layout.items = config.layout.items.filter((item: { id: string }) => item.id !== 'sponsor-logo');

		await expect($fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		)).rejects.toMatchObject({ statusCode: 409 });
		const unchanged = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(unchanged.modeConfigs['feature-match-overlay'].layout.frame.backgroundImage).toEqual({
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		});
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
		)).resolves.toHaveLength(2);
	});

	it('keeps unchanged retired revisions indexed and exactly resolvable', async () => {
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET lifecycle_state = 'retired'
			WHERE id = '${operation.result!.assetId}'
		`);
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const config = structuredClone(current.modeConfigs['feature-match-overlay']);
		config.layout.frame.backgroundImageFit = 'contain';

		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);

		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
		)).resolves.toHaveLength(2);
		const resolution = await fetch(
			`/api/graphics-assets/${operation.result!.assetId}/revisions/${operation.result!.revisionId}/content`,
		);
		expect(resolution.status).toBe(200);
	});

	it('removes every authoritative usage row when the owning Screen is deleted', async () => {
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, { method: 'DELETE' });
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
		)).resolves.toEqual([]);
	});
});

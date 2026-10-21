import type {
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getGraphicItemDefinition } from '../../shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { testGraphicAssetId, testGraphicAssetRevisionId } from '../helpers/graphicsAssetIdentities';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { executeIntegrationD1 } from './integrationD1';
import { expectPublishedOperation } from './responseStatus';

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
	let graphicsAuthorCookie: string;

	beforeAll(async () => {
		graphicsAuthorCookie = await operatorSessionCookie();
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
			headers: { cookie: graphicsAuthorCookie },
			body: graphicsIngestionRequest({
				idempotencyKey: 'reference-event-logo',
				name: 'Reference Event logo',
				defaultEventId: eventId,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: createHash('sha256').update(referencePixelPng).digest('hex'),
					width: 1,
					height: 1,
				},
				declaredByteLength: referencePixelPng.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: { cookie: graphicsAuthorCookie }, body: referencePixelPng },
		);
		operation = await expectPublishedOperation(response);
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
		config.layout.frame.backgroundImage = { kind: 'asset', ...reference };
		config.layout.composition.items.push({
			...getGraphicItemDefinition('media').createDefault({
				id: 'sponsor-logo',
				label: 'Sponsor logo',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			asset: reference,
		} as never);
		const group = config.layout.composition.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('Expected a Graphic Group fixture');
		group.children.push({
			...getGraphicItemDefinition('media').createDefault({
				id: 'group-sponsor-logo',
				label: 'Grouped sponsor logo',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			asset: reference,
		} as never);

		const updated = await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		expect(updated!.modeConfigs!['feature-match-overlay']!.layout!.frame.backgroundImage).toEqual({ kind: 'asset', ...reference });

		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		// Usage is reported in owner-slot order, so the composed tree precedes the
		// Frame it is drawn over.
		expect(usage).toEqual([
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Pinned Overlay',
					slot: 'layout.composition.items.sponsor-logo.asset',
					eventId,
				},
			}),
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Pinned Overlay',
					slot: `layout.composition.items.${group.id}.children.group-sponsor-logo.asset`,
					eventId,
				},
			}),
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Pinned Overlay',
					slot: 'layout.frame.backgroundImage',
					eventId,
				},
			}),
		]);
	});

	it('rejects a newly introduced missing reference without changing configuration or usage', async () => {
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const config = structuredClone(current!.modeConfigs!['feature-match-overlay']);
		config!.layout!.frame.backgroundImage = {
			kind: 'asset',
			assetId: testGraphicAssetId('missing-asset'),
			revisionId: testGraphicAssetRevisionId('missing-revision'),
		};
		config!.layout!.composition.items = config!.layout!.composition.items.filter((item: { id: string }) => item.id !== 'sponsor-logo');

		await expect($fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config!.layout } },
		)).rejects.toMatchObject({ statusCode: 409 });
		const unchanged = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(unchanged!.modeConfigs!['feature-match-overlay']!.layout!.frame.backgroundImage).toEqual({
			kind: 'asset',
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		});
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		)).resolves.toHaveLength(3);
	});

	it('keeps unchanged retired revisions indexed and exactly resolvable', async () => {
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET lifecycle_state = 'retired'
			WHERE id = '${operation.result!.assetId}'
		`);
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const config = structuredClone(current!.modeConfigs!['feature-match-overlay']);
		config!.layout!.frame.backgroundImageFit = 'contain';

		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config!.layout } },
		);

		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		)).resolves.toHaveLength(3);
		const resolution = await fetch(
			`/api/graphics-assets/${operation.result!.assetId}/revisions/${operation.result!.revisionId}/content`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(resolution.status).toBe(200);
	});

	it('saves a Slot alone onto a Screen whose layout was never saved (#625)', async () => {
		const fresh = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Fresh Overlay', slug: 'fresh-overlay', currentMode: 'feature-match-overlay' },
		});
		const slot = await $fetch(`/api/events/${eventId}/feature-match-slots`, {
			method: 'POST',
			body: { bestOf: 3 },
		});

		const updated = await $fetch(
			`/api/events/${eventId}/screens/${fresh.id}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { featureMatchId: slot.id } },
		);

		expect(updated.modeConfigs!['feature-match-overlay']!.featureMatchId).toBe(slot.id);
		const reread = await $fetch(`/api/events/${eventId}/screens/${fresh.id}`);
		expect(reread.modeConfigs!['feature-match-overlay']!.featureMatchId).toBe(slot.id);
	});

	it('removes every authoritative usage row when the owning Screen is deleted', async () => {
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, { method: 'DELETE' });
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		)).resolves.toEqual([]);
	});
});

/**
 * The Background Screen is the third Graphic Asset Referencing Screen Mode: an
 * asset-sourced image or video layer pins an exact revision, so its
 * configuration writes go through the same atomic config-plus-index operation
 * the graphics hosts use, under its own `layers.` owner-slot namespace. Its own
 * event and asset, because the suite above sequences a retirement this one must
 * not inherit.
 */
describe('background Screen exact Graphic Asset References', () => {
	let eventId: number;
	let screenId: number;
	let operation: GraphicsIngestionOperation;
	let graphicsAuthorCookie: string;

	beforeAll(async () => {
		graphicsAuthorCookie = await operatorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Background Layer Reference Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Stage Background',
				slug: 'stage-background',
				currentMode: 'background',
			},
		});
		screenId = screen.id;
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { cookie: graphicsAuthorCookie },
			body: graphicsIngestionRequest({
				idempotencyKey: 'reference-background-plate',
				name: 'Reference background plate',
				defaultEventId: eventId,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: createHash('sha256').update(referencePixelPng).digest('hex'),
					width: 1,
					height: 1,
				},
				declaredByteLength: referencePixelPng.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: { cookie: graphicsAuthorCookie }, body: referencePixelPng },
		);
		operation = await expectPublishedOperation(response);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('atomically saves the layer stack and indexes the asset-sourced layer under its own namespace', async () => {
		const reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};
		const layers = [
			{ id: 'wash', type: 'color', enabled: true, opacity: 0.4, color: '#0b1020' },
			{ id: 'plate', type: 'image', enabled: true, opacity: 1, source: { kind: 'asset', ...reference }, fit: 'cover' },
		];

		const updated = await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/background`,
			{ method: 'PATCH', body: { layers } },
		);
		expect(updated!.modeConfigs!.background!.layers).toHaveLength(2);

		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(usage).toEqual([
			expect.objectContaining({
				reference,
				owner: {
					kind: 'screen',
					id: String(screenId),
					name: 'Stage Background',
					slot: 'layers.plate.source',
					eventId,
				},
			}),
		]);
	});

	it('rejects a newly introduced missing reference without changing configuration or usage', async () => {
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const layers = structuredClone(current!.modeConfigs!.background!.layers) as Array<Record<string, unknown>>;
		layers.push({
			id: 'ghost',
			type: 'image',
			enabled: true,
			opacity: 1,
			source: {
				kind: 'asset',
				assetId: testGraphicAssetId('missing-asset'),
				revisionId: testGraphicAssetRevisionId('missing-revision'),
			},
			fit: 'cover',
		});

		await expect($fetch(
			`/api/events/${eventId}/screens/${screenId}/config/background`,
			{ method: 'PATCH', body: { layers } },
		)).rejects.toMatchObject({ statusCode: 409 });
		const unchanged = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(unchanged!.modeConfigs!.background!.layers).toHaveLength(2);
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		)).resolves.toHaveLength(1);
	});

	it('refuses a second animation layer at the write path', async () => {
		const current = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		const layers = structuredClone(current!.modeConfigs!.background!.layers) as Array<Record<string, unknown>>;
		layers.push(
			{ id: 'anim-1', type: 'animation', enabled: true, opacity: 1, animation: { effect: 'fog' } },
			{ id: 'anim-2', type: 'animation', enabled: false, opacity: 1, animation: { effect: 'caustics' } },
		);

		await expect($fetch(
			`/api/events/${eventId}/screens/${screenId}/config/background`,
			{ method: 'PATCH', body: { layers } },
		)).rejects.toMatchObject({ statusCode: 400 });
	});

	it('removes the layer\'s usage row when the owning Screen is deleted', async () => {
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, { method: 'DELETE' });
		await expect($fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${operation.result!.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		)).resolves.toEqual([]);
	});
});

/**
 * This suite's own content: the reference pixel padded with a chunk count no
 * other suite uses, so its usage list is this suite's alone.
 */
const plainModeLayerPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	...Array.from({ length: 211 }).fill(Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85)) as Uint8Array[],
	basePixelPng.slice(-12),
]));

describe('a plain overlay mode’s own Background Layer references (#580)', () => {
	let eventId: number;
	let screenId: number;
	let reference: { assetId: string; revisionId: string };
	let graphicsAuthorCookie: string;

	function plate() {
		return { id: 'plate', type: 'image', enabled: true, opacity: 1, source: { kind: 'asset', ...reference }, fit: 'cover' };
	}

	async function usageSlots() {
		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		return usage.map(item => item.owner.slot).sort();
	}

	beforeAll(async () => {
		graphicsAuthorCookie = await operatorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Plain Mode Layer Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Deck Stage', slug: 'deck-stage', currentMode: 'deck' },
		});
		screenId = screen.id;
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { cookie: graphicsAuthorCookie },
			body: graphicsIngestionRequest({
				idempotencyKey: 'reference-plain-mode-plate',
				name: 'Plain mode plate',
				defaultEventId: eventId,
				browserDecodeEvidence: {
					outcome: 'decoded',
					sourceDigest: createHash('sha256').update(plainModeLayerPng).digest('hex'),
					width: 1,
					height: 1,
				},
				declaredByteLength: plainModeLayerPng.byteLength,
			}),
		});
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: { cookie: graphicsAuthorCookie }, body: plainModeLayerPng },
		);
		const operation = await expectPublishedOperation(response);
		reference = { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('indexes a Deck Screen’s asset-sourced layer under the Deck’s own namespace', async () => {
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/deck`,
			{ method: 'PATCH', body: { backgroundLayers: [plate()] } },
		);

		expect(await usageSlots()).toEqual(['deck.backgroundLayers.plate.source']);
	});

	it('keeps the Deck’s row when the same Screen’s Card stack is written', async () => {
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/card`,
			{ method: 'PATCH', body: { backgroundLayers: [plate()] } },
		);

		expect(await usageSlots()).toEqual([
			'card.backgroundLayers.plate.source',
			'deck.backgroundLayers.plate.source',
		]);
	});

	it('delivers the layer’s revision to the Screen’s Output while the Deck is showing', async () => {
		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);

		const response = await fetch(
			`/api/screen-output/screens/${screenId}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
			{ headers: { authorization: `Bearer ${assetCapability}` } },
		);

		expect(response.status).toBe(200);
	});

	it('stops indexing a layer once the stack drops it', async () => {
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/deck`,
			{ method: 'PATCH', body: { backgroundLayers: [] } },
		);

		expect(await usageSlots()).toEqual(['card.backgroundLayers.plate.source']);
	});
});

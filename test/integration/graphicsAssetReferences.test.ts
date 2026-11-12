import type { ScreenResponse } from '~~/shared/api';
import type {
	GraphicAssetUsage,
	GraphicsIngestionOperation,
	GraphicAssetReference as Reference,
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
import { expectOperationResult } from './responseStatus';

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
	let reference: Reference;
	let graphicsAuthorCookie: string;

	/** One Graphic Asset of a test's own: the same bytes under a fresh identity. */
	async function ingest(idempotencyKey: string, name: string): Promise<Reference> {
		const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { cookie: graphicsAuthorCookie },
			body: graphicsIngestionRequest({
				idempotencyKey,
				name,
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
			{
				method: 'PUT',
				headers: { cookie: graphicsAuthorCookie },
				body: referencePixelPng,
			},
		);
		const operation = await expectOperationResult(response);
		return { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
	}

	function usageOf(pinned: Reference) {
		return $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${pinned.assetId}/usage`,
			{
				headers: { cookie: graphicsAuthorCookie },
			},
		);
	}

	/** A layout pinning one asset three times: in the Frame, in the composition, and in a Graphic Group. */
	function pinnedLayout(pinned: Reference) {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = { kind: 'asset', ...pinned };
		config.layout.composition.items.push({
			...getGraphicItemDefinition('media').createDefault({
				id: 'sponsor-logo',
				label: 'Sponsor logo',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			asset: pinned,
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
			asset: pinned,
		} as never);
		return { layout: config.layout, groupId: group.id };
	}

	async function savePinnedLayout() {
		const { layout, groupId } = pinnedLayout(reference);
		const updated = await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout },
			},
		);
		return { updated, groupId };
	}

	/** A Screen and a Graphic Asset of a test's own, pinned the same way. */
	async function pinnedOverlay(key: string) {
		const pinned = await ingest(`reference-${key}-logo`, `Reference ${key} logo`);
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: `Pinned ${key}`, slug: `pinned-${key}`, currentMode: 'feature-match-overlay' },
		});
		const { layout } = pinnedLayout(pinned);
		await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${screen.id}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout },
			},
		);
		return { screenId: screen.id, pinned, layout };
	}

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
		reference = await ingest('reference-event-logo', 'Reference Event logo');
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('atomically saves Screen configuration and every persisted exact-revision usage', async () => {
		const { updated, groupId } = await savePinnedLayout();

		expect(updated.modeConfigs!['feature-match-overlay']!.layout!.frame.backgroundImage).toEqual({ kind: 'asset', ...reference });

		// Usage is reported in owner-slot order, so the composed tree precedes the
		// Frame it is drawn over.
		await expect(usageOf(reference)).resolves.toEqual([
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
					slot: `layout.composition.items.${groupId}.children.group-sponsor-logo.asset`,
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
		await savePinnedLayout();
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
			{
				method: 'PATCH',
				body: { layout: config!.layout },
			},
		)).rejects.toMatchObject({ statusCode: 409 });
		const unchanged = await $fetch(`/api/events/${eventId}/screens/${screenId}`);
		expect(unchanged!.modeConfigs!['feature-match-overlay']!.layout!.frame.backgroundImage).toEqual({
			kind: 'asset',
			...reference,
		});
		await expect(usageOf(reference)).resolves.toHaveLength(3);
	});

	it('keeps unchanged retired revisions indexed and exactly resolvable', async () => {
		// A Screen and an asset of its own: the retirement must not reach another test's pin.
		const { screenId: retiredScreenId, pinned, layout } = await pinnedOverlay('retired');
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET lifecycle_state = 'retired'
			WHERE id = '${pinned.assetId}'
		`);
		layout.frame.backgroundImageFit = 'contain';

		await $fetch(
			`/api/events/${eventId}/screens/${retiredScreenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout },
			},
		);

		await expect(usageOf(pinned)).resolves.toHaveLength(3);
		const resolution = await fetch(
			`/api/graphics-assets/${pinned.assetId}/revisions/${pinned.revisionId}/content`,
			{
				headers: { cookie: graphicsAuthorCookie },
			},
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
			{
				method: 'PATCH',
				body: { featureMatchId: slot.id },
			},
		);

		expect(updated.modeConfigs!['feature-match-overlay']!.featureMatchId).toBe(slot.id);
		const reread = await $fetch(`/api/events/${eventId}/screens/${fresh.id}`);
		expect(reread.modeConfigs!['feature-match-overlay']!.featureMatchId).toBe(slot.id);
	});

	it('removes every authoritative usage row when the owning Screen is deleted', async () => {
		const { screenId: deletedScreenId, pinned } = await pinnedOverlay('deleted');
		await expect(usageOf(pinned)).resolves.toHaveLength(3);

		await $fetch(`/api/events/${eventId}/screens/${deletedScreenId}`, { method: 'DELETE' });

		await expect(usageOf(pinned)).resolves.toEqual([]);
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
			{
				method: 'PUT',
				headers: { cookie: graphicsAuthorCookie },
				body: referencePixelPng,
			},
		);
		operation = await expectOperationResult(response);
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
			{
				id: 'wash',
				type: 'color',
				enabled: true,
				opacity: 0.4,
				color: '#0b1020',
			},
			{
				id: 'plate',
				type: 'image',
				enabled: true,
				opacity: 1,
				source: { kind: 'asset', ...reference },
				fit: 'cover',
			},
		];

		const updated = await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/background`,
			{
				method: 'PATCH',
				body: { layers },
			},
		);
		expect(updated!.modeConfigs!.background!.layers).toHaveLength(2);

		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{
				headers: { cookie: graphicsAuthorCookie },
			},
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
		return {
			id: 'plate',
			type: 'image',
			enabled: true,
			opacity: 1,
			source: { kind: 'asset', ...reference },
			fit: 'cover',
		};
	}

	async function usageSlots() {
		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{
				headers: { cookie: graphicsAuthorCookie },
			},
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
			{
				method: 'PUT',
				headers: { cookie: graphicsAuthorCookie },
				body: plainModeLayerPng,
			},
		);
		const operation = await expectOperationResult(response);
		reference = { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('keeps each mode’s row apart: a Card write leaves the Deck’s, and dropping the Deck’s layer leaves the Card’s', async () => {
		for (const mode of ['deck', 'card']) {
			await $fetch(
				`/api/events/${eventId}/screens/${screenId}/config/${mode}`,
				{
					method: 'PATCH',
					body: {
						backgroundLayers: [
							plate(),
						],
					},
				},
			);
		}

		expect(await usageSlots()).toEqual([
			'card.backgroundLayers.plate.source',
			'deck.backgroundLayers.plate.source',
		]);

		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/deck`,
			{
				method: 'PATCH',
				body: { backgroundLayers: [] },
			},
		);

		expect(await usageSlots()).toEqual(['card.backgroundLayers.plate.source']);
	});
});

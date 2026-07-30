import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { executeIntegrationD1 } from './integrationD1';

/**
 * Media Graphic Items on a Broadcast Graphics Screen, through the real API.
 *
 * The behaviour under test is the whole path an author actually takes: pin an
 * exact Graphic Asset Revision on a Graphic Item, have the Screen index it, and
 * have that Screen's outputs resolve it — and nothing else — through the Screen
 * Output Asset Capability.
 */

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * Integration suites share one database, and identical bytes deduplicate across
 * Graphic Assets by design. Padding each fixture with a chunk count no other
 * suite uses keeps this suite's content digests to itself — without it, whether
 * a suite that ingests the bare pixel publishes or reuses depends on which file
 * ran first.
 */
function pngWithTextChunks(count: number) {
	return Uint8Array.from(Buffer.concat([
		transparentPixelPng.slice(0, -12),
		...Array.from({ length: count }).fill(emptyTextChunk) as Uint8Array[],
		transparentPixelPng.slice(-12),
	]));
}

const pixelPng = pngWithTextChunks(50);

/** A second payload, so the two pinned fixtures differ in content as well as identity. */
const taggedPng = pngWithTextChunks(51);

/** Distinguishes this run's fixtures from any a previous run left in the library. */
const runId = randomUUID();

const SQUARE_CORNER = { treatment: 'square', size: 0 } as const;

// Written out rather than built from the shared factory: the integration project
// resolves no `~~` alias, so only type imports cross this boundary.
const SQUARE_GEOMETRY = {
	topLeft: SQUARE_CORNER,
	topRight: SQUARE_CORNER,
	bottomRight: SQUARE_CORNER,
	bottomLeft: SQUARE_CORNER,
	leftSlant: 0,
	rightSlant: 0,
};

interface Reference {
	assetId: string;
	revisionId: string;
}

/**
 * A Media Graphic Item in the current Graphic Item schema.
 *
 * Kept complete and current on purpose: a stale item shape is rejected at Screen
 * creation with a 400, which reads as an unrelated failure.
 */
function mediaItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'media' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 480,
		height: 270,
		mediaKind: 'image' as const,
		fit: 'cover' as const,
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
		...overrides,
	};
}

/**
 * One Graphic Asset of this test's own, whatever else the library holds.
 *
 * `create-separate` and a per-run idempotency key together: the single-pixel PNG
 * below is ingested by other suites too, and an ordinary ingestion that matches
 * existing Graphic Asset Content reuses that asset by design. Sharing an asset
 * would mean sharing its lifecycle, so a suite that retires it would make this one
 * fail for a reason that has nothing to do with Media Graphic Items.
 */
async function ingestImage(
	eventId: number,
	name: string,
	bytes: Uint8Array,
): Promise<Reference> {
	const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		body: {
			idempotencyKey: `${name}-${runId}`,
			name,
			defaultEventId: eventId,
			duplicateContentPolicy: 'create-separate',
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: createHash('sha256').update(bytes).digest('hex'),
				width: 1,
				height: 1,
			},
			declaredByteLength: bytes.byteLength,
		},
	});
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', body: bytes },
	);
	const operation = await response.json() as GraphicsIngestionOperation;
	return { assetId: operation.result!.assetId, revisionId: operation.result!.revisionId };
}

describe('broadcast Graphics Media Graphic Items', () => {
	let eventId: number;
	let screenId: number;
	let graphicsAuthorCookie: string;
	let logo: Reference;
	let badge: Reference;

	function configPath() {
		return `/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`;
	}

	async function authoredStack(): Promise<BroadcastGraphicConfig[]> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return (screen.modeConfigs?.['broadcast-graphics']?.graphics ?? []) as BroadcastGraphicConfig[];
	}

	async function usageOf(reference: Reference): Promise<GraphicAssetUsage[]> {
		return await $fetch<GraphicAssetUsage[]>(`/api/graphics-assets/${reference.assetId}/usage`);
	}

	beforeAll(async () => {
		graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Broadcast Graphics Media Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Media Graphics',
				slug: 'media-graphics',
				currentMode: 'broadcast-graphics',
			},
		});
		screenId = screen.id;
		logo = await ingestImage(eventId, 'broadcast-graphics-media-logo', pixelPng);
		badge = await ingestImage(eventId, 'broadcast-graphics-media-badge', taggedPng);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('saves the authored stack and every exact-revision usage in one write', async () => {
		const graphics = [{
			id: 'lower-third',
			name: 'Lower Third',
			items: [
				mediaItem('logo', { asset: logo }),
				{
					type: 'group' as const,
					id: 'cluster',
					label: 'Cluster',
					visible: true,
					anchor: 'top-left' as const,
					x: 0,
					y: 0,
					width: 900,
					height: 200,
					arrangement: 'row' as const,
					padding: 0,
					gap: 8,
					align: 'stretch' as const,
					justify: 'start' as const,
					clip: false,
					geometry: SQUARE_GEOMETRY,
					children: [mediaItem('badge', { asset: badge })],
				},
			],
		}];

		const updated = await $fetch<ScreenResponse>(configPath(), {
			method: 'PATCH',
			body: { graphics },
			headers: { cookie: graphicsAuthorCookie },
		});

		const savedItem = updated.modeConfigs!['broadcast-graphics']!.graphics[0]!.items[0]!;
		expect(savedItem.type === 'media' && savedItem.asset).toEqual(logo);
		// The owner slot names the Graphic Item that pinned the reference, so a broken
		// one is diagnosable against the item an author repairs.
		await expect(usageOf(logo)).resolves.toEqual([
			expect.objectContaining({
				reference: logo,
				owner: expect.objectContaining({
					kind: 'screen',
					id: String(screenId),
					slot: 'graphics.lower-third.items.logo.asset',
					eventId,
				}),
			}),
		]);
		await expect(usageOf(badge)).resolves.toEqual([
			expect.objectContaining({
				owner: expect.objectContaining({
					slot: 'graphics.lower-third.items.cluster.children.badge.asset',
				}),
			}),
		]);
	});

	it('resolves an indexed revision through the Screen Output Asset Capability, and nothing else', async () => {
		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		// A separate Graphic Asset identity over identical content: in the library but
		// not published by this Screen, which is exactly the case the capability must
		// refuse.
		const unreferenced = await ingestImage(eventId, 'broadcast-graphics-media-unreferenced', pixelPng);

		function outputContent(reference: Reference) {
			return fetch(
				`/api/screen-output/screens/${screenId}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
				{ headers: { authorization: `Bearer ${assetCapability}` } },
			);
		}

		await expect(outputContent(logo).then(response => response.status)).resolves.toBe(200);
		// The capability is not a library-browsing hole: an asset this Screen does not
		// publish is invisible to its outputs even with a valid capability.
		await expect(outputContent(unreferenced).then(response => response.status)).resolves.toBe(404);
	});

	it('rejects a newly pinned reference that does not exist, leaving the stack and its index untouched', async () => {
		const before = await authoredStack();

		await expect($fetch(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'lower-third',
					name: 'Lower Third',
					items: [mediaItem('logo', { asset: { assetId: 'missing-asset', revisionId: 'missing-revision' } })],
				}],
			},
			headers: { cookie: graphicsAuthorCookie },
		})).rejects.toMatchObject({ statusCode: 409 });

		await expect(authoredStack()).resolves.toEqual(before);
		await expect(usageOf(logo)).resolves.toHaveLength(1);
	});

	it('keeps each mode’s references indexed when the other mode is written', async () => {
		// A Screen holds a configuration for every mode at once, so its reference index
		// holds every mode's references at once. Writing one mode must not clear the
		// other's rows: the failure is silent, because the revisions still exist and
		// only the output's authorizer would notice they are no longer published.
		const overlayScreen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Both Modes',
				slug: 'both-modes',
				currentMode: 'feature-match-overlay',
			},
		});

		// The shipped default, so the layout satisfies its own schema: this test is
		// about which references survive a write, not about authoring a valid layout.
		const layout = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
		layout.frame.backgroundImage = logo as never;
		const overlayConfig = await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${overlayScreen.id}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				body: { layout },
				headers: { cookie: graphicsAuthorCookie },
			},
		);
		expect(overlayConfig.modeConfigs!['feature-match-overlay']!.layout.frame.backgroundImage).toEqual(logo);

		function slotsFor(screen: ScreenResponse, usage: GraphicAssetUsage[]) {
			return usage.filter(item => item.owner.id === String(screen.id)).map(item => item.owner.slot).sort();
		}

		await expect(usageOf(logo).then(usage => slotsFor(overlayScreen, usage)))
			.resolves
			.toEqual(['layout.frame.backgroundImage']);

		// Now write the other mode's configuration on the same Screen.
		await $fetch(`/api/events/${eventId}/screens/${overlayScreen.id}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: {
				graphics: [{ id: 'bug', name: 'Bug', items: [mediaItem('badge', { asset: badge })] }],
			},
			headers: { cookie: graphicsAuthorCookie },
		});

		// Both survive, each under its own mode's owner-slot namespace.
		await expect(usageOf(logo).then(usage => slotsFor(overlayScreen, usage)))
			.resolves
			.toEqual(['layout.frame.backgroundImage']);
		await expect(usageOf(badge).then(usage => slotsFor(overlayScreen, usage)))
			.resolves
			.toEqual(['graphics.bug.items.badge.asset']);

		// And a Screen resolves only its current mode's references: it is in Feature
		// Match Overlay mode, so the Broadcast Graphics reference is not on this output.
		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${overlayScreen.id}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		function outputContent(reference: Reference) {
			return fetch(
				`/api/screen-output/screens/${overlayScreen.id}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
				{ headers: { authorization: `Bearer ${assetCapability}` } },
			);
		}
		await expect(outputContent(logo).then(response => response.status)).resolves.toBe(200);
		await expect(outputContent(badge).then(response => response.status)).resolves.toBe(404);

		await $fetch(`/api/events/${eventId}/screens/${overlayScreen.id}`, { method: 'DELETE' });
	});

	it('rejects a reference introduced through a generic Screen write, which indexes nothing', async () => {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);

		await expect($fetch(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: {
				stateVersion: screen.stateVersion,
				modeConfigs: {
					'broadcast-graphics': {
						graphics: [{
							id: 'lower-third',
							name: 'Lower Third',
							items: [mediaItem('logo', { asset: badge })],
						}],
					},
				},
			},
		})).rejects.toMatchObject({ statusCode: 400 });
	});

	it('rejects a Screen created with a reference nothing has indexed yet', async () => {
		await expect($fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Prepinned',
				slug: 'prepinned',
				currentMode: 'broadcast-graphics',
				modeConfigs: {
					'broadcast-graphics': {
						graphics: [{ id: 'g', name: 'G', items: [mediaItem('logo', { asset: logo })] }],
					},
				},
			},
		})).rejects.toMatchObject({ statusCode: 400 });
	});

	it('removes a reference from the index when its Graphic Item stops pinning one', async () => {
		await $fetch(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'lower-third',
					name: 'Lower Third',
					items: [mediaItem('logo', { asset: undefined })],
				}],
			},
			headers: { cookie: graphicsAuthorCookie },
		});

		// Nothing pins either revision now, so a Screen Output can no longer resolve
		// them: what the Screen publishes and what its capability covers are one thing.
		await expect(usageOf(logo)).resolves.toEqual([]);
		await expect(usageOf(badge)).resolves.toEqual([]);
	});

	it('refuses to take a Broadcast Graphic whose Graphic Asset content cannot resolve', async () => {
		// The command seam, not the button: a second operator on stale data, a replayed
		// command, or a direct API call all arrive here. A reference that cannot resolve
		// invalidates the graphic that owns it, so Take is refused — while Out stays
		// available, because it needs none of the asset's bytes.
		const takeable = await ingestImage(eventId, 'broadcast-graphics-media-takeable', taggedPng);
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Playout Gate', slug: 'playout-gate', currentMode: 'broadcast-graphics' },
		});

		await $fetch(`/api/events/${eventId}/screens/${screen.id}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: {
				graphics: [
					{ id: 'sound', name: 'Sound', items: [mediaItem('logo', { asset: takeable })] },
					{ id: 'clean', name: 'Clean', items: [] },
				],
			},
			headers: { cookie: graphicsAuthorCookie },
		});

		const session = await $fetch<{ id: number }>(
			`/api/events/${eventId}/screens/${screen.id}/broadcast-graphics/live-session`,
		);
		function command(type: 'Take' | 'Out', graphicId: string, commandId: string) {
			return $fetch(
				`/api/events/${eventId}/screens/${screen.id}/broadcast-graphics/live-sessions/${session.id}/commands`,
				{ method: 'POST', body: { commandId, type, payload: { graphicId } } },
			);
		}

		// While the revision resolves, Take is admitted.
		await expect(command('Take', 'sound', `gate-ok-${runId}`)).resolves.toBeTruthy();

		// Now make the pinned revision's content unresolvable, which is the reachable
		// failure: a foreign key keeps a referenced revision row alive, so what an
		// operator actually meets is the bytes going out of reach rather than the row
		// disappearing. A content row whose bytes were never stored, pinned by the
		// revision, is exactly that state.
		// Graphic Asset Content is identified by the SHA-256 of its exact stored bytes,
		// so the digest to restore is one the test already knows.
		const originalDigest = createHash('sha256').update(taggedPng).digest('hex');
		const strandedDigest = `stranded-${runId}`;
		await executeIntegrationD1(`
			INSERT INTO graphic_asset_contents (digest, byte_length, canonical_mime, availability, created_at)
			VALUES ('${strandedDigest}', 1, 'image/png', 'available', 0)
		`);
		await executeIntegrationD1(`
			UPDATE graphic_asset_revisions
			SET content_digest = '${strandedDigest}'
			WHERE id = '${takeable.revisionId}'
		`);

		await expect(command('Take', 'sound', `gate-blocked-${runId}`))
			.rejects
			.toMatchObject({ statusCode: 409 });
		// Out is never withheld: the graphic an operator most needs to remove is the one
		// already on air whose media has just gone missing.
		await expect(command('Out', 'sound', `gate-out-${runId}`)).resolves.toBeTruthy();
		// And a graphic that pins nothing is unaffected by its neighbour's failure.
		await expect(command('Take', 'clean', `gate-clean-${runId}`)).resolves.toBeTruthy();

		// Put the revision back on its real content, so this fixture leaves the library
		// in a state the ordinary code paths can still reason about.
		await executeIntegrationD1(`
			UPDATE graphic_asset_revisions
			SET content_digest = '${originalDigest}'
			WHERE id = '${takeable.revisionId}'
		`);
		await expect(command('Take', 'sound', `gate-restored-${runId}`)).resolves.toBeTruthy();
	});

	it('persists silent-video playback controls and Shape Geometry clipping unchanged', async () => {
		const updated = await $fetch<ScreenResponse>(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'sting',
					name: 'Sting',
					items: [mediaItem('clip', {
						fit: 'contain',
						opacity: 0.75,
						focalPosition: { horizontal: 0.1, vertical: 0.9 },
						playbackRate: 0.5,
						loop: false,
						clipGeometry: { ...SQUARE_GEOMETRY, rightSlant: 40 },
					})],
				}],
			},
			headers: { cookie: graphicsAuthorCookie },
		});

		const item = updated.modeConfigs!['broadcast-graphics']!.graphics[0]!.items[0]!;
		expect(item).toMatchObject({
			type: 'media',
			fit: 'contain',
			opacity: 0.75,
			focalPosition: { horizontal: 0.1, vertical: 0.9 },
			playbackRate: 0.5,
			loop: false,
			clipGeometry: { rightSlant: 40, topLeft: { treatment: 'square', size: 0 } },
		});
	});

	it('rejects a playback rate outside the authored bounds', async () => {
		await expect($fetch(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{ id: 'sting', name: 'Sting', items: [mediaItem('clip', { playbackRate: 12 })] }],
			},
			headers: { cookie: graphicsAuthorCookie },
		})).rejects.toMatchObject({ statusCode: 400 });
	});
});

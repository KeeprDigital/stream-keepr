import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	GraphicAssetUsage,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
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
 *
 * This suite owns 50, 51 and 100-107. The counts every suite has claimed are
 * listed in `helpers.ts`; claim a free range there before adding a fixture.
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
	cookie: string,
): Promise<Reference> {
	const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		headers: { cookie },
		body: graphicsIngestionRequest({
			idempotencyKey: `${name}-${runId}`,
			name,
			defaultEventId: eventId,
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: createHash('sha256').update(bytes).digest('hex'),
				width: 1,
				height: 1,
			},
			declaredByteLength: bytes.byteLength,
		}),
	});
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', headers: { cookie }, body: bytes },
	);
	const operation = await response.json() as GraphicsIngestionOperation;
	return { assetId: operation.result!.assetId, revisionId: operation.result!.revisionId };
}

/**
 * A Text Graphic Item whose typography names one Graphic Font Selection.
 *
 * Complete and current for the same reason `mediaItem` is: a stale item shape is
 * refused at 400, which would read as an unrelated failure.
 */
function textItem(id: string, font: unknown, overrides: Record<string, unknown> = {}) {
	return {
		type: 'text' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 600,
		height: 120,
		text: 'Player One',
		typography: {
			font,
			fontSize: 64,
			fontWeight: 700,
			fontStyle: 'normal' as const,
			textTransform: 'none' as const,
			letterSpacing: 0,
			lineHeight: 1.15,
			textAlign: 'left' as const,
			color: '#ffffff',
		},
		overflowPolicy: 'ellipsis' as const,
		minFontSize: 24,
		...overrides,
	};
}

/**
 * One font Graphic Asset of this test's own.
 *
 * A font clears validation only on browser-load evidence, so ingesting one is a
 * two-step exchange rather than the single content PUT an image takes. The glyph
 * digests are the shape the endpoint asks for: each representative code point
 * renders the same in the exact font paired with either fallback, and differently
 * from each fallback alone.
 *
 * ## Why not `mplantin.woff`
 *
 * Because `graphicsAssetIngestion.test.ts` already ingests those exact bytes, with
 * the default `reuse` duplicate policy, and then finds its asset again by name.
 * `create-separate` here does not make this suite's asset private — it makes it a
 * _second_ asset holding content the other suite's ingestion may then reuse
 * instead of creating its own, whichever of the two reaches the library first.
 * Integration suites share one database, so identical bytes are shared state
 * however each side asks for them; distinct bytes are what actually keep this
 * suite's Graphic Asset lifecycle to itself.
 */
async function ingestFont(eventId: number, name: string, cookie: string): Promise<Reference> {
	const bytes = new Uint8Array(await readFile('public/fonts/mana.woff'));
	const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		headers: { cookie },
		body: graphicsIngestionRequest({
			idempotencyKey: `${name}-${runId}`,
			name,
			defaultEventId: eventId,
			sourceFileName: 'mana.woff',
			declaredMime: 'font/woff',
			declaredByteLength: bytes.byteLength,
		}),
	});
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', headers: { cookie, 'content-type': 'font/woff' }, body: bytes },
	);
	const awaitingEvidence = await response.json() as GraphicsIngestionOperation;
	if (awaitingEvidence.report?.outcome !== 'accepted' || awaitingEvidence.report.facts.kind !== 'font')
		throw new Error('Expected a server-selected font challenge');
	const exact = '1'.repeat(64);
	const completed = await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/font-browser-evidence`,
		{
			method: 'POST',
			headers: { cookie },
			body: {
				outcome: 'font-loaded',
				sourceDigest: createHash('sha256').update(bytes).digest('hex'),
				challengeDigest: awaitingEvidence.report.facts.browserChallenge.digest,
				glyphProofs: awaitingEvidence.report.facts.browserChallenge.codePoints.map(codePoint => ({
					codePoint,
					exactWithSansDigest: exact,
					exactWithMonoDigest: exact,
					sansFallbackDigest: '2'.repeat(64),
					monoFallbackDigest: '3'.repeat(64),
				})),
			},
		},
	);
	return { assetId: completed.result!.assetId, revisionId: completed.result!.revisionId };
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
		return await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
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
		logo = await ingestImage(eventId, 'broadcast-graphics-media-logo', pixelPng, graphicsAuthorCookie);
		badge = await ingestImage(eventId, 'broadcast-graphics-media-badge', taggedPng, graphicsAuthorCookie);
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
		const unreferenced = await ingestImage(eventId, 'broadcast-graphics-media-unreferenced', pixelPng, graphicsAuthorCookie);

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
		const takeable = await ingestImage(eventId, 'broadcast-graphics-media-takeable', taggedPng, graphicsAuthorCookie);
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

		// Read as the operator's client reads it, over real HTTP. A refused Take is not
		// a failure of the action but the authority answering, and both halves of the
		// answer live in the response body: the code under the body's own `data`, and
		// the sentence naming the owner slot as its `message`. Neither is on the error
		// itself — `Error.message` here is `[POST] "…": 409 Conflict`, which is what a
		// Live workspace used to show instead (#230). `broadcastGraphicsCommandRefusal`
		// is written against exactly this shape, so this is where that shape is pinned.
		await expect(command('Take', 'sound', `gate-blocked-${runId}`))
			.rejects
			.toMatchObject({
				statusCode: 409,
				data: {
					message: 'Graphic Asset Content at graphics.sound.items.logo.asset is temporarily '
						+ 'unavailable, so this Broadcast Graphic cannot be taken on air',
					data: { code: 'unavailable-asset-content' },
				},
			});
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

	/**
	 * A font is content like any other (#141).
	 *
	 * The point of this suite is the whole path an author takes, and the whole point
	 * of making a library font an ordinary Graphic Asset Reference is that the path
	 * is the *same* one — indexed by the same walk, named by an owner slot the same
	 * way, and reachable through the same Screen Output Asset Capability and no other
	 * route. So it is proved here beside the Media Graphic Item it now shares a
	 * mechanism with, rather than in a font-shaped suite of its own.
	 */
	it('indexes a typography font revision and resolves it through the capability', async () => {
		const font = await ingestFont(eventId, `broadcast-graphics-typography-font-${runId}`, graphicsAuthorCookie);

		const updated = await $fetch<ScreenResponse>(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'name-plate',
					name: 'Name Plate',
					items: [textItem('player-name', { kind: 'asset', reference: font })],
				}],
			},
			headers: { cookie: graphicsAuthorCookie },
		});

		const saved = updated.modeConfigs!['broadcast-graphics']!.graphics[0]!.items[0]!;
		expect(saved.type === 'text' && saved.typography.font).toEqual({ kind: 'asset', reference: font });
		await expect(usageOf(font)).resolves.toEqual([
			expect.objectContaining({
				reference: font,
				owner: expect.objectContaining({
					kind: 'screen',
					id: String(screenId),
					slot: 'graphics.name-plate.items.player-name.typography.font',
					eventId,
				}),
			}),
		]);

		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		const content = await fetch(
			`/api/screen-output/screens/${screenId}/assets/${font.assetId}/revisions/${font.revisionId}/content`,
			{ headers: { authorization: `Bearer ${assetCapability}` } },
		);

		expect(content.status).toBe(200);
		expect(content.headers.get('content-type')).toBe('font/woff');
	});

	it('rejects typography naming a revision that is not a font', async () => {
		// The write checks a newly chosen revision's kind against the kind the slot
		// discovered, so an image cannot be pinned where a font belongs — the same
		// check that stops a silent video landing in an image slot.
		await expect($fetch(configPath(), {
			method: 'PATCH',
			body: {
				graphics: [{
					id: 'name-plate',
					name: 'Name Plate',
					items: [textItem('player-name', { kind: 'asset', reference: logo })],
				}],
			},
			headers: { cookie: graphicsAuthorCookie },
		})).rejects.toMatchObject({ statusCode: 409 });
	});
});

/**
 * A media Graphic Input's value, through the same path (#96).
 *
 * The failure this suite proves closed reaches air: a media value an operator picks
 * at runtime lives in the Broadcast Graphics Live Session rather than in authored
 * configuration, so a Screen Output Asset Capability derived from `modeConfigs`
 * alone cannot fetch it — the graphic goes on air and its media does not. The
 * negative half is the part that matters, and it is asserted here twice: a staged
 * value nothing has accepted must not resolve, and a revision a later acceptance
 * replaced must stop resolving.
 */
describe('media Graphic Input values on air', () => {
	let eventId: number;
	let graphicsAuthorCookie: string;
	let first: Reference;
	let second: Reference;

	/** A media Graphic Input, staged and optional unless stated otherwise. */
	function mediaInput(key: string, overrides: Record<string, unknown> = {}) {
		return {
			type: 'media' as const,
			key,
			label: key,
			required: false,
			updatePolicy: 'staged' as const,
			mediaKind: 'image' as const,
			default: null,
			...overrides,
		};
	}

	async function createScreen(slug: string): Promise<number> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: slug, slug, currentMode: 'broadcast-graphics' },
		});
		return screen.id;
	}

	async function declare(screenId: number, inputs: unknown[], graphicId = 'promo') {
		return await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`,
			{
				method: 'PATCH',
				body: { graphics: [{ id: graphicId, name: 'Promo', items: [], inputs }] },
				headers: { cookie: graphicsAuthorCookie },
			},
		);
	}

	async function capabilityFor(screenId: number): Promise<string> {
		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		return assetCapability;
	}

	const SAFARI_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15';
	const CHROMIUM_USER_AGENT = 'Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36';

	/**
	 * A request as one Screen Output browser, whose engine decides what it may play.
	 *
	 * The user agent is stated wherever a restricted revision is involved rather than
	 * defaulted, because playback compatibility is now answered per resolution
	 * request: a caller that names no engine cannot be proven to be Chromium and is
	 * refused a chromium-transparency revision, which is the behaviour under test.
	 */
	function outputStatus(screenId: number, capability: string, reference: Reference, userAgent?: string) {
		return fetch(
			`/api/screen-output/screens/${screenId}/assets/${reference.assetId}/revisions/${reference.revisionId}/content`,
			{
				headers: {
					authorization: `Bearer ${capability}`,
					...(userAgent ? { 'user-agent': userAgent } : {}),
				},
			},
		).then(response => response.status);
	}

	async function liveSession(screenId: number) {
		return await $fetch<{ id: number; currentState: { inputs: Record<string, { accepted: Record<string, unknown>; acceptedRevision: number }> } }>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session`,
		);
	}

	function command(screenId: number, sessionId: number, body: Record<string, unknown>) {
		return $fetch<{ currentState: { inputs: Record<string, { accepted: Record<string, unknown>; acceptedRevision: number }> } }>(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-sessions/${sessionId}/commands`,
			{ method: 'POST', body },
		);
	}

	async function usageOf(reference: Reference): Promise<GraphicAssetUsage[]> {
		return await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
	}

	beforeAll(async () => {
		graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Media Graphic Input Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		first = await ingestImage(eventId, `media-input-first-${runId}`, pngWithTextChunks(100), graphicsAuthorCookie);
		second = await ingestImage(eventId, `media-input-second-${runId}`, pngWithTextChunks(101), graphicsAuthorCookie);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('resolves a runtime-chosen revision only while the Live Session accepts it', async () => {
		const screenId = await createScreen('media-input-runtime');
		await declare(screenId, [mediaInput('backdrop')]);
		const capability = await capabilityFor(screenId);
		const session = await liveSession(screenId);

		// Staged, not accepted. Live Control shows it; program does not, so the output
		// has no right to its bytes — this is the hole the capability exists to close.
		await command(screenId, session.id, {
			commandId: `media-input-stage-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: first },
		});
		await expect(outputStatus(screenId, capability, first)).resolves.toBe(404);

		// A Take accepts the staged set, which is when it goes on air — and when the
		// output may fetch it.
		await command(screenId, session.id, {
			commandId: `media-input-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});
		await expect(outputStatus(screenId, capability, first)).resolves.toBe(200);
		await expect(usageOf(first)).resolves.toEqual([
			expect.objectContaining({
				reference: first,
				owner: expect.objectContaining({
					kind: 'screen',
					id: String(screenId),
					slot: 'liveSession.promo.inputs.backdrop',
					eventId,
				}),
			}),
		]);

		// A second choice, staged: the accepted one is still what program shows, so it
		// is still the only one the output may fetch.
		const staged = await command(screenId, session.id, {
			commandId: `media-input-restage-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: second },
		});
		await expect(outputStatus(screenId, capability, second)).resolves.toBe(404);
		await expect(outputStatus(screenId, capability, first)).resolves.toBe(200);

		// Accepting it swaps both at once. The revision that left the accepted set stops
		// being resolvable in the same moment it stops being on air.
		await command(screenId, session.id, {
			commandId: `media-input-update-${runId}`,
			type: 'Update Graphic',
			payload: {
				graphicId: 'promo',
				basedOnAcceptedRevision: staged.currentState.inputs.promo!.acceptedRevision,
			},
		});
		await expect(outputStatus(screenId, capability, second)).resolves.toBe(200);
		await expect(outputStatus(screenId, capability, first)).resolves.toBe(404);
		await expect(usageOf(first)).resolves.toEqual([]);

		// An epoch that has ended accepted nothing, so it publishes nothing.
		await $fetch(`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session/reset`, {
			method: 'POST',
		});
		await expect(outputStatus(screenId, capability, second)).resolves.toBe(404);
		await expect(usageOf(second)).resolves.toEqual([]);
	});

	it('stops resolving once the authored write removes the Graphic Input declaration', async () => {
		// A Screen publishes what it declares, and an authored write is one of the two
		// authorities that decides what that is. Left to the Live Session alone this
		// self-heals only on the next acceptance that moves the media set — which can be
		// the rest of the show, with the output still fetching a value nothing declares
		// and the asset still pinned against retirement.
		const screenId = await createScreen('media-input-undeclared');
		const backdrop = await ingestImage(eventId, `media-input-undeclared-${runId}`, pngWithTextChunks(104), graphicsAuthorCookie);
		await declare(screenId, [mediaInput('backdrop')]);
		const capability = await capabilityFor(screenId);
		const session = await liveSession(screenId);

		await command(screenId, session.id, {
			commandId: `media-input-undeclared-set-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: backdrop },
		});
		await command(screenId, session.id, {
			commandId: `media-input-undeclared-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});
		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(200);

		// The declaration goes; nothing else about the Live Session changes.
		await declare(screenId, []);

		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(404);
		await expect(usageOf(backdrop)).resolves.toEqual([]);
	});

	it('stops resolving once the authored write removes the whole Broadcast Graphic', async () => {
		const screenId = await createScreen('media-input-unplaced');
		const backdrop = await ingestImage(eventId, `media-input-unplaced-${runId}`, pngWithTextChunks(105), graphicsAuthorCookie);
		await declare(screenId, [mediaInput('backdrop')]);
		const capability = await capabilityFor(screenId);
		const session = await liveSession(screenId);

		await command(screenId, session.id, {
			commandId: `media-input-unplaced-set-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: backdrop },
		});
		await command(screenId, session.id, {
			commandId: `media-input-unplaced-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});
		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(200);

		// The Screen no longer places the graphic at all.
		await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`,
			{
				method: 'PATCH',
				body: { graphics: [] },
				headers: { cookie: graphicsAuthorCookie },
			},
		);

		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(404);
		await expect(usageOf(backdrop)).resolves.toEqual([]);
	});

	it('stops resolving once a generic Screen write undeclares the Graphic Input', async () => {
		// The generic write refuses to *change* an authored Graphic Asset Reference, so
		// the mode-configuration endpoint is the only way to move one. Undeclaring a
		// media Graphic Input whose default is null changes no authored reference at
		// all, though — it slips through that guard while still changing what the Live
		// Session publishes, so this route needs the same reconciliation.
		const screenId = await createScreen('media-input-generic-write');
		const backdrop = await ingestImage(eventId, `media-input-generic-${runId}`, pngWithTextChunks(107), graphicsAuthorCookie);
		await declare(screenId, [mediaInput('backdrop')]);
		const capability = await capabilityFor(screenId);
		const session = await liveSession(screenId);

		await command(screenId, session.id, {
			commandId: `media-input-generic-set-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: backdrop },
		});
		await command(screenId, session.id, {
			commandId: `media-input-generic-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});
		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(200);

		// The Screen stays in Broadcast Graphics mode, so its epoch is untouched and
		// nothing ends it. Only the declaration goes.
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: {
				stateVersion: screen.stateVersion,
				modeConfigs: {
					'broadcast-graphics': {
						graphics: [{ id: 'promo', name: 'Promo', items: [], inputs: [] }],
					},
				},
			},
		});

		await expect(outputStatus(screenId, capability, backdrop)).resolves.toBe(404);
		await expect(usageOf(backdrop)).resolves.toEqual([]);
	});

	it('stops publishing when the Screen leaves Broadcast Graphics mode', async () => {
		// Ending the epoch is the other place the "stops being published when it leaves
		// air" rule is enforced, and the mode scope in the authorizer hides an uncleared
		// namespace rather than fixing it: the usage row is what says whether the epoch's
		// references actually went.
		const screenId = await createScreen('media-input-mode-change');
		const backdrop = await ingestImage(eventId, `media-input-mode-change-${runId}`, pngWithTextChunks(106), graphicsAuthorCookie);
		await declare(screenId, [mediaInput('backdrop')]);
		const session = await liveSession(screenId);

		await command(screenId, session.id, {
			commandId: `media-input-mode-set-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: backdrop },
		});
		await command(screenId, session.id, {
			commandId: `media-input-mode-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});
		await expect(usageOf(backdrop)).resolves.toHaveLength(1);

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: { currentMode: 'idle', stateVersion: screen.stateVersion },
		});

		await expect(usageOf(backdrop)).resolves.toEqual([]);
	});

	it('refuses a runtime selection naming a revision that does not resolve', async () => {
		// Creating a Graphic Asset Reference requires its exact revision to resolve, and
		// a media Graphic Input value is one. Refused at selection rather than stored and
		// shown as unavailable: there is no fact to record about a revision that is not
		// there, and an unrecorded fact is what loses the write's precondition later.
		const screenId = await createScreen('media-input-missing');
		await declare(screenId, [mediaInput('backdrop')]);
		const session = await liveSession(screenId);

		await expect(command(screenId, session.id, {
			commandId: `media-input-missing-${runId}`,
			type: 'Set Input',
			payload: {
				graphicId: 'promo',
				inputKey: 'backdrop',
				value: { assetId: 'no-such-asset', revisionId: 'no-such-revision' },
			},
		})).rejects.toMatchObject({ statusCode: 409 });

		const after = await liveSession(screenId);
		expect(after.currentState.inputs.promo).toBeUndefined();
	});

	it('records the pinned revision’s target compatibility on a value chosen at runtime', async () => {
		// The fact travels with the value because nothing downstream can go and ask the
		// library for it — and because the reference index compares a silent-video
		// reference against the pinned revision's own, so a value carrying none loses
		// the write's precondition silently instead of failing it.
		const screenId = await createScreen('media-input-vp9');
		const restricted = await ingestImage(eventId, `media-input-vp9-${runId}`, pngWithTextChunks(102), graphicsAuthorCookie);
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET kind = 'silent-video'
			WHERE id = '${restricted.assetId}';
			UPDATE graphic_asset_revisions
			SET technical_facts = json_set(
				technical_facts,
				'$.kind', 'silent-video',
				'$.targetCompatibility', 'chromium-transparency'
			)
			WHERE id = '${restricted.revisionId}';
		`);

		await declare(screenId, [
			mediaInput('sting', { mediaKind: 'silent-video' }),
			mediaInput('backdrop'),
		]);
		const capability = await capabilityFor(screenId);
		const session = await liveSession(screenId);

		// The client sends an exact revision and no facts at all; the authoritative side
		// is what records them, so a client cannot assert a compatibility it does not have.
		await command(screenId, session.id, {
			commandId: `media-input-vp9-set-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'sting', value: restricted },
		});
		await command(screenId, session.id, {
			commandId: `media-input-vp9-set-backdrop-${runId}`,
			type: 'Set Input',
			payload: { graphicId: 'promo', inputKey: 'backdrop', value: first },
		});
		const taken = await command(screenId, session.id, {
			commandId: `media-input-vp9-take-${runId}`,
			type: 'Take',
			payload: { graphicId: 'promo' },
		});

		expect(taken.currentState.inputs.promo!.accepted.sting).toEqual({
			...restricted,
			videoCompatibility: 'chromium-transparency',
		});
		await expect(outputStatus(screenId, capability, restricted, CHROMIUM_USER_AGENT)).resolves.toBe(200);

		/**
		 * What an incompatible revision costs the output (#98).
		 *
		 * It used to cost everything: the capability session itself was refused, so a
		 * Safari output resolved no content URL for any reference on the Screen and
		 * went to black rather than losing the one clip it could not play. The session
		 * now opens for every engine, and only the exact restricted revision is
		 * refused — with the code the output prints in the clip's place.
		 */
		function bootstrap(userAgent: string) {
			return fetch(`/api/screen-output/screens/${screenId}/asset-capability-session`, {
				method: 'POST',
				headers: { 'authorization': `Bearer ${capability}`, 'user-agent': userAgent },
			});
		}
		await expect(bootstrap(SAFARI_USER_AGENT).then(response => response.status)).resolves.toBe(200);
		await expect(bootstrap(CHROMIUM_USER_AGENT).then(response => response.status)).resolves.toBe(200);

		// A media Graphic Input value the Live Session accepted is published like any
		// other reference, so the session forecasts its refusal like any other (#184).
		await expect((await bootstrap(SAFARI_USER_AGENT)).json()).resolves.toMatchObject({
			unplayableRevisions: [{
				assetId: restricted.assetId,
				revisionId: restricted.revisionId,
				code: 'vp9-alpha-chromium-required',
			}],
		});
		await expect((await bootstrap(CHROMIUM_USER_AGENT)).json()).resolves.toMatchObject({
			unplayableRevisions: [],
		});

		// The image the same graphic pins keeps playing out on the engine that lost
		// everything before.
		await expect(outputStatus(screenId, capability, first, SAFARI_USER_AGENT)).resolves.toBe(200);
		const refused = await fetch(
			`/api/screen-output/screens/${screenId}/assets/${restricted.assetId}/revisions/${restricted.revisionId}/content`,
			{ headers: { 'authorization': `Bearer ${capability}`, 'user-agent': SAFARI_USER_AGENT } },
		);
		expect(refused.status).toBe(409);
		await expect(refused.json()).resolves.toMatchObject({
			data: { code: 'vp9-alpha-chromium-required' },
		});
	});

	it('publishes an authored media Graphic Input default, and refuses one with no compatibility facts', async () => {
		const screenId = await createScreen('media-input-default');
		const restricted = await ingestImage(eventId, `media-input-default-vp9-${runId}`, pngWithTextChunks(103), graphicsAuthorCookie);
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET kind = 'silent-video'
			WHERE id = '${restricted.assetId}';
			UPDATE graphic_asset_revisions
			SET technical_facts = json_set(
				technical_facts,
				'$.kind', 'silent-video',
				'$.targetCompatibility', 'chromium-transparency'
			)
			WHERE id = '${restricted.revisionId}';
		`);

		// Without the recorded fact the reference-index predicate has nothing to compare,
		// so the write is refused rather than committing a configuration whose media the
		// Screen's outputs would never be able to fetch.
		await expect(declare(screenId, [mediaInput('sting', {
			mediaKind: 'silent-video',
			default: restricted,
		})])).rejects.toMatchObject({ statusCode: 409 });

		await declare(screenId, [mediaInput('sting', {
			mediaKind: 'silent-video',
			default: { ...restricted, videoCompatibility: 'chromium-transparency' },
		})]);

		const capability = await capabilityFor(screenId);
		await expect(outputStatus(screenId, capability, restricted, CHROMIUM_USER_AGENT)).resolves.toBe(200);
		await expect(usageOf(restricted)).resolves.toEqual([
			expect.objectContaining({
				reference: restricted,
				owner: expect.objectContaining({
					kind: 'screen',
					id: String(screenId),
					slot: 'graphics.promo.inputs.sting.default',
					eventId,
				}),
			}),
		]);
	});
});

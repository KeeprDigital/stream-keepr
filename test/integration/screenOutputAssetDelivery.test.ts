import type { ScreenResponse } from '~~/shared/api';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getGraphicItemDefinition } from '../../shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { screenOutputAssetCapabilityCookieName } from '../../shared/utils/graphicsAssetReferences';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { executeIntegrationD1 } from './integrationD1';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * This suite's own content, padded with a chunk count no other suite uses.
 *
 * Every other graphics suite already owns a distinct digest; this one ingested
 * the bare single-pixel PNG, which `graphicsAssetIngestion.test.ts` also ingests
 * under the default reuse policy while asserting it *published*. Whichever ran
 * first published and the other reused, so that assertion was decided by file
 * order rather than by the library.
 */
const pixelPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	...Array.from({ length: 80 }).fill(emptyTextChunk) as Uint8Array[],
	basePixelPng.slice(-12),
]));

describe('unattended Screen Output Graphic Asset Revision delivery', () => {
	let eventId: number;
	let screenId: number;
	let assetId: string;
	let revisionId: string;
	let capability: string;
	let graphicsAuthorCookie: string;

	function contentPath() {
		return `/api/screen-output/screens/${screenId}/assets/${assetId}/revisions/${revisionId}/content`;
	}

	function authorizedHeaders(extra?: HeadersInit) {
		return new Headers({
			authorization: `Bearer ${capability}`,
			...Object.fromEntries(new Headers(extra)),
		});
	}

	beforeAll(async () => {
		graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Screen Output Asset Delivery Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch<ScreenResponse>(
			`/api/events/${eventId}/screens`,
			{
				method: 'POST',
				body: {
					name: 'Unattended Overlay',
					slug: 'unattended-overlay',
					currentMode: 'feature-match-overlay',
				},
			},
		);
		screenId = screen.id;
		const capabilityResponse = await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		capability = capabilityResponse.assetCapability;

		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie: graphicsAuthorCookie },
				body: {
					idempotencyKey: 'screen-output-capability-pixel',
					name: 'Screen Output capability pixel',
					defaultEventId: eventId,
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: createHash('sha256').update(pixelPng).digest('hex'),
						width: 1,
						height: 1,
					},
					declaredByteLength: pixelPng.byteLength,
				},
			},
		);
		const upload = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: { cookie: graphicsAuthorCookie }, body: pixelPng },
		);
		const operation = await upload.json() as GraphicsIngestionOperation;
		assetId = operation.result!.assetId;
		revisionId = operation.result!.revisionId;

		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const group = config.layout.composition.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('Expected a Graphic Group fixture');
		group.children.push({
			...getGraphicItemDefinition('media').createDefault({
				id: 'range-delivered-group-media',
				label: 'Range-delivered group media',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			asset: { assetId, revisionId },
		} as never);
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('returns no library bytes without the Screen capability', async () => {
		const response = await fetch(contentPath());

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).not.toContain('public');
	});

	it('streams full, conditional, and byte-range responses through the same capability', async () => {
		const full = await fetch(contentPath(), { headers: authorizedHeaders() });
		expect(full.status).toBe(200);
		expect(full.headers.get('content-type')).toBe('image/png');
		expect(full.headers.get('content-length')).toBe(String(pixelPng.byteLength));
		expect(full.headers.get('cache-control')).toBe('private, no-store');
		expect(full.headers.get('vary')).toContain('authorization');
		const etag = full.headers.get('etag');
		expect(etag).toMatch(/^"sk-[\w-]{43}"$/);
		expect(new Uint8Array(await full.arrayBuffer())).toEqual(pixelPng);

		const conditional = await fetch(contentPath(), {
			headers: authorizedHeaders({ 'if-none-match': etag! }),
		});
		expect(conditional.status).toBe(304);
		expect(await conditional.text()).toBe('');

		const range = await fetch(contentPath(), {
			headers: authorizedHeaders({ range: 'bytes=8-15' }),
		});
		expect(range.status).toBe(206);
		expect(range.headers.get('content-range')).toBe(`bytes 8-15/${pixelPng.byteLength}`);
		expect(new Uint8Array(await range.arrayBuffer())).toEqual(pixelPng.slice(8, 16));
	});

	it('range-delivers the exact revision when native media sends its path-scoped capability cookie', async () => {
		const session = await fetch(
			`/api/screen-output/screens/${screenId}/asset-capability-session`,
			{ method: 'POST', headers: authorizedHeaders() },
		);
		expect(session.status).toBe(204);
		expect(session.headers.get('cache-control')).toBe('private, no-store');
		expect(await session.text()).toBe('');
		const setCookie = session.headers.get('set-cookie');
		expect(setCookie).toContain(
			`${screenOutputAssetCapabilityCookieName(screenId)}=${capability}`,
		);
		expect(setCookie).toContain(`Path=/api/screen-output/screens/${screenId}/`);
		expect(setCookie).toContain('HttpOnly');
		expect(setCookie).toContain('SameSite=Strict');
		const range = await fetch(contentPath(), {
			headers: {
				cookie: setCookie!.split(';', 1)[0]!,
				range: 'bytes=8-15',
			},
		});

		expect(range.status).toBe(206);
		expect(range.headers.get('content-range')).toBe(`bytes 8-15/${pixelPng.byteLength}`);
		expect(range.headers.get('vary')).toBe('authorization, cookie');
		expect(new Uint8Array(await range.arrayBuffer())).toEqual(pixelPng.slice(8, 16));
	});

	it('denies a removed revision immediately even when its immutable bytes were cached', async () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);

		const response = await fetch(contentPath(), { headers: authorizedHeaders() });
		expect(response.status).toBe(404);
	});

	it('rotation revokes the previous capability and authorizes the replacement', async () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = { assetId, revisionId };
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		const previous = capability;
		const rotation = await fetch(
			`/api/events/${eventId}/screens/${screenId}/asset-capability`,
			{
				method: 'POST',
				headers: { cookie: graphicsAuthorCookie },
			},
		);
		expect(rotation.status).toBe(200);
		capability = ((await rotation.json()) as { assetCapability: string }).assetCapability;
		expect(capability).not.toBe(previous);

		const staleSession = await fetch(
			`/api/screen-output/screens/${screenId}/asset-capability-session`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${previous}` },
			},
		);
		expect(staleSession.status).toBe(404);
		expect(staleSession.headers.get('set-cookie')).toBeNull();

		const revoked = await fetch(contentPath(), {
			headers: { authorization: `Bearer ${previous}` },
		});
		expect(revoked.status).toBe(404);
		const authorized = await fetch(contentPath(), { headers: authorizedHeaders() });
		expect(authorized.status).toBe(200);
	});

	it('uses live Screen PATCH and per-revision User-Agent checks as authoritative restricted-video playout gates', async () => {
		const baseline = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: baseline.layout } },
		);
		await executeIntegrationD1(`
			UPDATE graphic_assets
			SET kind = 'silent-video'
			WHERE id = '${assetId}';
			UPDATE graphic_asset_revisions
			SET technical_facts = json_set(
				technical_facts,
				'$.kind', 'silent-video',
				'$.targetCompatibility', 'chromium-transparency'
			)
			WHERE id = '${revisionId}';
		`);

		const restricted = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		restricted.layout.composition.items.push({
			...getGraphicItemDefinition('media').createDefault({
				id: 'restricted-video',
				label: 'Restricted VP9 alpha',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			mediaKind: 'silent-video',
			asset: { assetId, revisionId },
		} as never);

		// A silent-video reference will not index at all unless it carries the
		// pinned revision's own target compatibility, so publishing without it is
		// refused rather than silently losing the reference.
		const publication = await fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ layout: restricted.layout }),
			},
		);
		expect(publication.status).toBe(409);

		const persisted = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		expect(persisted.modeConfigs['feature-match-overlay'].layout.composition.items).not.toContainEqual(
			expect.objectContaining({ id: 'restricted-video' }),
		);

		(restricted.layout.composition.items.at(-1) as { videoCompatibility?: string }).videoCompatibility = 'chromium-transparency';
		const chromiumPublication = await fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ layout: restricted.layout }),
			},
		);
		expect(chromiumPublication.status).toBe(200);

		const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15';
		const IOS_CHROMIUM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/138.0 Mobile/15E148 Safari/604.1';
		const CHROMIUM = 'Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36';

		function bootstrap(userAgent: string) {
			return fetch(
				`/api/screen-output/screens/${screenId}/asset-capability-session`,
				{
					method: 'POST',
					headers: { ...Object.fromEntries(authorizedHeaders()), 'user-agent': userAgent },
				},
			);
		}

		// Every engine opens a session, whatever the Screen publishes. Refusing it was
		// what left a non-Chromium output with no resolvable content URL for anything
		// at all, so a clip nobody could play took the whole output's media with it —
		// and left the per-item diagnostic unreachable, because its `src` was empty
		// too (#98).
		for (const userAgent of [SAFARI, IOS_CHROMIUM, CHROMIUM]) {
			const session = await bootstrap(userAgent);
			expect(session.status).toBe(204);
			expect(session.headers.get('set-cookie')).toContain(
				screenOutputAssetCapabilityCookieName(screenId),
			);
		}

		// The refusal now names one revision, to the engine that cannot decode it.
		for (const userAgent of [SAFARI, IOS_CHROMIUM]) {
			const refused = await fetch(contentPath(), {
				headers: authorizedHeaders({ 'user-agent': userAgent }),
			});
			expect(refused.status).toBe(409);
			await expect(refused.json()).resolves.toMatchObject({
				data: { code: 'vp9-alpha-chromium-required' },
			});
		}

		const played = await fetch(contentPath(), {
			headers: authorizedHeaders({ 'user-agent': CHROMIUM }),
		});
		expect(played.status).toBe(200);
	});

	it('deleting the Screen revokes its current capability', async () => {
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, { method: 'DELETE' });

		const response = await fetch(contentPath(), { headers: authorizedHeaders() });
		expect(response.status).toBe(404);
	});
});

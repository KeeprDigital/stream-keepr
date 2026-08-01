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

const pixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

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

	it('uses live Screen PATCH and User-Agent bootstrap as authoritative restricted-video playout gates', async () => {
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

		const safariBootstrap = await fetch(
			`/api/screen-output/screens/${screenId}/asset-capability-session`,
			{
				method: 'POST',
				headers: {
					...Object.fromEntries(authorizedHeaders()),
					'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15',
				},
			},
		);
		expect(safariBootstrap.status).toBe(409);
		expect(safariBootstrap.headers.get('set-cookie')).toBeNull();
		await expect(safariBootstrap.json()).resolves.toMatchObject({
			data: { code: 'vp9-alpha-chromium-required' },
		});

		const iosChromiumBootstrap = await fetch(
			`/api/screen-output/screens/${screenId}/asset-capability-session`,
			{
				method: 'POST',
				headers: {
					...Object.fromEntries(authorizedHeaders()),
					'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/138.0 Mobile/15E148 Safari/604.1',
				},
			},
		);
		expect(iosChromiumBootstrap.status).toBe(409);
		expect(iosChromiumBootstrap.headers.get('set-cookie')).toBeNull();

		const chromiumBootstrap = await fetch(
			`/api/screen-output/screens/${screenId}/asset-capability-session`,
			{
				method: 'POST',
				headers: {
					...Object.fromEntries(authorizedHeaders()),
					'user-agent': 'Mozilla/5.0 Chrome/138.0.0.0 Safari/537.36',
				},
			},
		);
		expect(chromiumBootstrap.status).toBe(204);
		expect(chromiumBootstrap.headers.get('set-cookie')).toContain(
			screenOutputAssetCapabilityCookieName(screenId),
		);
	});

	it('deleting the Screen revokes its current capability', async () => {
		await $fetch(`/api/events/${eventId}/screens/${screenId}`, { method: 'DELETE' });

		const response = await fetch(contentPath(), { headers: authorizedHeaders() });
		expect(response.status).toBe(404);
	});
});

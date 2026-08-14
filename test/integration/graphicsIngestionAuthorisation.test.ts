import type { GraphicAsset, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';

/**
 * Who a Graphics Ingestion Operation belongs to, proved through the real routes.
 *
 * Two rules are worth a suite of their own because they are the whole contract
 * and nothing else pins them:
 *
 * - every author-facing graphics ingestion and lifecycle route refuses a caller
 *   carrying no graphics author session, before it reaches the library;
 * - the graphics author session alone decides identity, so one session cannot
 *   reach another's operation however it labels itself.
 *
 * The second rule is asserted while the caller supplies the identity header the
 * library used to trust. A suite that only proved scoping between two headers
 * would prove the mechanism and not the guarantee, which is exactly the gap this
 * replaces.
 */

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

/**
 * This suite's own still-image content, padded with a chunk count no other suite
 * uses.
 *
 * Integration suites share one database and identical bytes deduplicate into one
 * Graphic Asset by design, so the bare single-pixel PNG would publish under
 * whichever suite reached the library first — and this suite's lifecycle subject
 * would carry somebody else's name and somebody else's lifecycle. `70` because
 * every count up to 64 is already spoken for; a count another suite retires,
 * Trashes, or purges takes this suite's canonical bytes with it.
 */
const transparentPixelPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	...Array.from({ length: 70 }).fill(emptyTextChunk) as Uint8Array[],
	basePixelPng.slice(-12),
]));

/**
 * An author identity the server does not honour. The library used to read this
 * header, so every request an intruder makes here still sends it, set to the
 * identity that initiated the operation under attack. It must buy nothing.
 */
const UNHONOURED_AUTHOR_ID_HEADER = { 'x-graphics-author-id': 'authorisation-victim-author' };

const digest = createHash('sha256').update(transparentPixelPng).digest('hex');

interface AuthorisedRoute {
	label: string;
	method: string;
	path: (operationId: string) => string;
	json?: unknown;
	bytes?: Uint8Array<ArrayBuffer>;
	contentType?: string;
}

/**
 * Every route that acts on one existing Graphics Ingestion Operation.
 *
 * Bodies are deliberately well-formed. A route that validates its body before it
 * reaches the library would otherwise answer a foreign caller with a validation
 * failure, and the suite would be reading 400 where it means to read "no such
 * operation for you".
 */
const operationRoutes: AuthorisedRoute[] = [
	{
		label: 'reading operation state',
		method: 'GET',
		path: id => `/api/graphics-assets/ingestion-operations/${id}`,
	},
	{
		label: 'cancelling an operation',
		method: 'DELETE',
		path: id => `/api/graphics-assets/ingestion-operations/${id}`,
	},
	{
		label: 'streaming source bytes',
		method: 'PUT',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/content`,
		bytes: transparentPixelPng,
		contentType: 'image/png',
	},
	{
		label: 'submitting browser decode evidence',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/browser-evidence`,
		json: { outcome: 'decoded', sourceDigest: digest, width: 1, height: 1 },
	},
	{
		label: 'submitting font browser evidence',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/font-browser-evidence`,
		json: {
			outcome: 'font-rejected',
			sourceDigest: digest,
			challengeDigest: digest,
			stage: 'load',
		},
	},
	{
		label: 'starting a resumable transfer',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/multipart`,
	},
	{
		label: 'uploading a resumable part',
		method: 'PUT',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/multipart/parts/1`,
		bytes: transparentPixelPng,
		contentType: 'application/octet-stream',
	},
	{
		label: 'completing a resumable transfer',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/multipart/complete`,
	},
	{
		// A loopback URL, so a run in which scoping has failed still reaches no
		// network: the fetcher rejects the destination before opening anything.
		label: 'copying an approved remote source',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/remote-copy`,
		json: { sourceUrl: 'https://127.0.0.1/scoreboard.png' },
	},
	{
		label: 'retrying an operation',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/retry`,
	},
	{
		label: 'reading provisional staged bytes',
		method: 'GET',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/staged-source`,
	},
	{
		label: 'confirming a Template Package Preflight Report',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/template-package-confirmation`,
		json: { fingerprint: '0'.repeat(64) },
	},
	{
		label: 'installing a confirmed Template Package',
		method: 'POST',
		path: id => `/api/graphics-assets/ingestion-operations/${id}/template-package-installation`,
	},
];

function requestInit(route: AuthorisedRoute, headers: Record<string, string>) {
	const init: RequestInit & { headers: Record<string, string> } = {
		method: route.method,
		headers: { ...headers },
	};
	if (route.json !== undefined) {
		init.headers['content-type'] = 'application/json';
		init.body = JSON.stringify(route.json);
	}
	if (route.bytes) {
		init.headers['content-type'] = route.contentType ?? 'application/octet-stream';
		init.body = route.bytes;
	}
	return init;
}

describe('graphics author authorisation across the ingestion and lifecycle routes', () => {
	let authorCookie: string;
	let intruderCookie: string;
	let fontBytes: Uint8Array<ArrayBuffer>;
	let sessionlessProbeOperationId: string;
	let assetId: string;
	let eventId: number;

	/** The Events the lifecycle subject is currently associated with. */
	async function assetEventIds() {
		const assets = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
			headers: { cookie: authorCookie },
			query: { search: 'Authorisation lifecycle subject' },
		});
		return assets.find(asset => asset.id === assetId)?.eventIds;
	}
	/**
	 * One operation per scoping case.
	 *
	 * A shared subject would let the first case in the sweep decide the answer
	 * every later case reads — cancel it and the rest stop existing for anybody,
	 * which is a 404 that proves nothing about who asked.
	 */
	const scopingProbes = new Map<string, string>();

	async function initiateStillImageAs(
		cookie: string,
		idempotencyKey: string,
		name: string,
		defaultEventId?: number,
	) {
		return await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie, ...UNHONOURED_AUTHOR_ID_HEADER },
				body: graphicsIngestionRequest({
					idempotencyKey,
					name,
					declaredByteLength: transparentPixelPng.byteLength,
					...defaultEventId === undefined ? {} : { defaultEventId },
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: digest,
						width: 1,
						height: 1,
					},
				}),
			},
		);
	}

	async function initiateFontAs(cookie: string, idempotencyKey: string, name: string) {
		return await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie, ...UNHONOURED_AUTHOR_ID_HEADER },
				body: graphicsIngestionRequest({
					idempotencyKey,
					name,
					sourceFileName: 'mplantin.woff',
					declaredMime: 'font/woff',
					declaredByteLength: fontBytes.byteLength,
				}),
			},
		);
	}

	async function uploadAs(
		cookie: string,
		operationId: string,
		bytes: Uint8Array<ArrayBuffer>,
		contentType: string,
	) {
		return await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operationId}/content`,
			{
				method: 'PUT',
				headers: { cookie, ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': contentType },
				body: bytes,
			},
		);
	}

	beforeAll(async () => {
		fontBytes = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		authorCookie = await createGraphicsAuthorSessionCookie();
		intruderCookie = await createGraphicsAuthorSessionCookie();
		expect(intruderCookie).not.toBe(authorCookie);

		sessionlessProbeOperationId = (await initiateStillImageAs(
			authorCookie,
			'authorisation-sessionless-probe',
			'Authorisation sessionless probe',
		)).id;

		/**
		 * Every scoping probe is parked at `awaiting-confirmation`: a font whose
		 * bytes are staged and which is waiting on the browser's answer to a
		 * server-selected challenge. That is the one stage at which all thirteen
		 * routes have real work to refuse — in particular the staged-source route,
		 * which answers `missing` at any other stage and would otherwise report a
		 * 404 that says nothing at all about who asked.
		 */
		for (const [index, route] of operationRoutes.entries()) {
			const initiated = await initiateFontAs(
				authorCookie,
				`authorisation-scoping-probe-${index}`,
				`Authorisation scoping probe ${index}`,
			);
			const staged = await uploadAs(authorCookie, initiated.id, fontBytes, 'font/woff');
			expect(staged.stage).toBe('awaiting-confirmation');
			scopingProbes.set(route.label, initiated.id);
		}

		// One published asset, so the lifecycle and metadata routes have a real
		// subject to refuse to act on rather than a missing one. It carries an Event
		// association because the metadata route's sharpest edge is detaching one.
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphics Authorisation Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const publishable = await initiateStillImageAs(
			authorCookie,
			'authorisation-lifecycle-subject',
			'Authorisation lifecycle subject',
			eventId,
		);
		const published = await uploadAs(
			authorCookie,
			publishable.id,
			transparentPixelPng,
			'image/png',
		);
		expect(published.stage).toBe('completed');
		assetId = published.result!.assetId;
		await expect(assetEventIds()).resolves.toEqual([eventId]);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	describe('a caller carrying no graphics author session', () => {
		it.each(operationRoutes)('is refused $label', async (route) => {
			const response = await fetch(
				route.path(sessionlessProbeOperationId),
				requestInit(route, { ...UNHONOURED_AUTHOR_ID_HEADER }),
			);
			expect(response.status).toBe(401);
		});

		it('is refused the initiation of a new operation', async () => {
			const response = await fetch('/api/graphics-assets/ingestion-operations', {
				method: 'POST',
				headers: { ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': 'application/json' },
				body: JSON.stringify(graphicsIngestionRequest({
					idempotencyKey: 'authorisation-sessionless-initiation',
					name: 'Sessionless initiation',
					declaredByteLength: transparentPixelPng.byteLength,
				})),
			});
			expect(response.status).toBe(401);
		});

		it('is refused the replacement of an existing Graphic Asset', async () => {
			const response = await fetch(`/api/graphics-assets/${assetId}/replacement-operations`, {
				method: 'POST',
				headers: { ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': 'application/json' },
				body: JSON.stringify({
					idempotencyKey: 'authorisation-sessionless-replacement',
					declaredByteLength: transparentPixelPng.byteLength,
				}),
			});
			expect(response.status).toBe(401);
		});

		it('is refused a Graphic Asset metadata rewrite', async () => {
			const response = await fetch(`/api/graphics-assets/${assetId}`, {
				method: 'PATCH',
				headers: { ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': 'application/json' },
				body: JSON.stringify({
					name: 'Renamed by nobody',
					eventIds: [eventId],
				}),
			});
			expect(response.status).toBe(401);
		});

		/**
		 * The sharpest form of the same route: the update replaces the Event
		 * association set outright rather than merging into it, and the schema puts
		 * no floor under the array. An empty one is therefore a valid request that
		 * detaches the asset from every Event it belongs to — and unlike the
		 * lifecycle actions, this route records nothing in the Evidence Ledger, so
		 * there would be no attribution for it either.
		 */
		it('is refused the detachment of every Event association', async () => {
			const response = await fetch(`/api/graphics-assets/${assetId}`, {
				method: 'PATCH',
				headers: { ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': 'application/json' },
				body: JSON.stringify({
					name: 'Authorisation lifecycle subject',
					eventIds: [],
				}),
			});
			expect(response.status).toBe(401);
			await expect(assetEventIds()).resolves.toEqual([eventId]);
		});

		// The defect #116 names: retiring and Trashing were reachable by anyone who
		// could reach the API at all.
		it.each(['retire', 'trash', 'restore'] as const)(
			'is refused the %s lifecycle action',
			async (action) => {
				const response = await fetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
					method: 'POST',
					headers: { ...UNHONOURED_AUTHOR_ID_HEADER, 'content-type': 'application/json' },
					body: JSON.stringify({ action }),
				});
				expect(response.status).toBe(401);
			},
		);

		it('leaves the Graphic Asset in active discovery', async () => {
			await expect($fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: { cookie: authorCookie },
				query: { search: 'Authorisation lifecycle subject' },
			})).resolves.toMatchObject([{ id: assetId, lifecycle: { state: 'active' } }]);
		});
	});

	describe('a second graphics author session claiming the initiating identity', () => {
		it.each(operationRoutes)('cannot reach the operation for $label', async (route) => {
			const response = await fetch(
				route.path(scopingProbes.get(route.label)!),
				requestInit(route, { cookie: intruderCookie, ...UNHONOURED_AUTHOR_ID_HEADER }),
			);
			expect(response.status).toBe(404);
		});

		it('cannot reconnect to an operation by reusing its idempotency key', async () => {
			const reconnectAttempt = await initiateFontAs(
				intruderCookie,
				'authorisation-scoping-probe-0',
				'Authorisation scoping probe 0',
			);
			expect(reconnectAttempt.id).not.toBe(scopingProbes.get(operationRoutes[0]!.label));
		});

		it('leaves every probed operation exactly as its own author left it', async () => {
			for (const route of operationRoutes) {
				const operationId = scopingProbes.get(route.label)!;
				await expect($fetch<GraphicsIngestionOperation>(
					`/api/graphics-assets/ingestion-operations/${operationId}`,
					{ headers: { cookie: authorCookie, ...UNHONOURED_AUTHOR_ID_HEADER } },
				)).resolves.toMatchObject({ id: operationId, stage: 'awaiting-confirmation' });
			}
		});

		it('leaves the initiating session still reading its own provisional staged bytes', async () => {
			const operationId = scopingProbes.get('reading provisional staged bytes')!;
			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${operationId}/staged-source`,
				{ headers: { cookie: authorCookie, ...UNHONOURED_AUTHOR_ID_HEADER } },
			);
			expect(response.status).toBe(200);
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(fontBytes);
		});
	});

	/**
	 * What per-session ownership costs, at the moment it costs the most.
	 *
	 * This is #176's scenario played out through the real routes: a resumable
	 * transfer half sent, and the session it was sent under gone.
	 *
	 * **What these cases cover, and what they do not.** They pin the *decision* —
	 * that ownership is per-session and what that costs — not the sliding lifetime
	 * this branch added; they pass identically against a session module with the
	 * sliding removed, because nothing here advances a clock. Sliding is proved in
	 * `test/unit/server/modules/graphicsAuthorSession.test.ts`, where the clock is
	 * controlled directly; what that leaves uncovered is wiring rather than logic,
	 * since `h3` and `hub:kv` are both substituted there. A Worker's clock cannot be
	 * advanced from here, and the only wire-observable trace of a slide — a
	 * refreshed `Set-Cookie` — appears only once a session is over a minute stale,
	 * which a session minted seconds ago in `beforeAll` never is.
	 *
	 * Three separate facts follow, and only the first two are losses:
	 *
	 * - the transfer stops with `401`, not with a partial success;
	 * - reloading does not recover it, because a new session is a new author and
	 *   the operation belongs to the old one, so it is a `404` to the person who
	 *   started it. ADR-0003 records why that is kept;
	 * - the durable checkpoint itself is untouched. Nothing about the transfer was
	 *   lost except who was allowed to continue it, which is what makes an idle
	 *   session lifetime a sufficient answer rather than a partial one.
	 */
	describe('a graphics author session that lapses mid-transfer', () => {
		/**
		 * A cookie of the shape the browser keeps and the library has forgotten.
		 *
		 * A token that was never minted, not one that has expired — the two are not
		 * the same event, and the honest claim is narrower than "this is what expiry
		 * looks like". What makes it a faithful proxy is that both reach the library
		 * the same way: `readSession` looks the token up, gets nothing back, and
		 * refuses. An expired session arrives there because KV dropped its entry;
		 * this one because there was never an entry to drop. From the route's side
		 * they are indistinguishable, which is what these cases are about.
		 */
		const lapsedCookie
			= 'stream_keepr_graphics_author_session=a7f1c0d2-lapsed-session-token-no-longer-stored';

		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);
		let interruptedId: string;

		beforeAll(async () => {
			const initiated = await $fetch<GraphicsIngestionOperation>(
				'/api/graphics-assets/ingestion-operations',
				{
					method: 'POST',
					headers: { cookie: authorCookie },
					body: graphicsIngestionRequest({
						idempotencyKey: 'authorisation-lapsed-session-transfer',
						name: 'Authorisation lapsed session transfer',
						declaredMime: 'image/png',
						declaredByteLength: bytes.byteLength,
					}),
				},
			);
			interruptedId = initiated.id;
			const started = await $fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart`,
				{ method: 'POST', headers: { cookie: authorCookie } },
			);
			expect(started.transfer?.partCount).toBe(2);
			const firstPart = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart/parts/1`,
				{
					method: 'PUT',
					headers: { 'cookie': authorCookie, 'content-type': 'application/octet-stream' },
					body: bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES),
				},
			);
			expect(firstPart.status).toBe(200);
		});

		it('refuses the next part rather than accepting it from nobody', async () => {
			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart/parts/2`,
				{
					method: 'PUT',
					headers: { 'cookie': lapsedCookie, 'content-type': 'application/octet-stream' },
					body: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
				},
			);
			expect(response.status).toBe(401);
		});

		it('is not recovered by the reload that mints a new session', async () => {
			const reloadedCookie = await createGraphicsAuthorSessionCookie();
			expect(reloadedCookie).not.toBe(authorCookie);

			const response = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}`,
				{ headers: { cookie: reloadedCookie } },
			);
			expect(response.status).toBe(404);
		});

		it('loses nothing but the identity allowed to continue it', async () => {
			await expect($fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${interruptedId}`,
				{ headers: { cookie: authorCookie } },
			)).resolves.toMatchObject({
				stage: 'transferring',
				transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				transfer: {
					completedParts: [{
						partNumber: 1,
						partIdentity: `${interruptedId}:1`,
						byteLength: GRAPHICS_MULTIPART_PART_BYTES,
					}],
				},
			});
		});

		/**
		 * The session that started it can still finish it, from the verified part
		 * rather than from the beginning. The bytes are zero-filled, so the library
		 * rejects them on their merits — which is the point: the transfer completed
		 * and the operation reached a terminal stage of its own, releasing its
		 * staged reservation instead of leaving 16 MiB parked in the Graphics
		 * Staging Allowance for this suite's neighbours.
		 */
		it('is resumed to a terminal outcome by the session that started it', async () => {
			const finalPart = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart/parts/2`,
				{
					method: 'PUT',
					headers: { 'cookie': authorCookie, 'content-type': 'application/octet-stream' },
					body: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
				},
			);
			expect(finalPart.status).toBe(200);

			const completion = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart/complete`,
				{ method: 'POST', headers: { cookie: authorCookie } },
			);
			expect(completion.status).toBe(200);
			expect(await completion.json()).toMatchObject({
				stage: 'failed',
				transferredByteLength: bytes.byteLength,
				report: { outcome: 'rejected' },
			});
		});
	});
});

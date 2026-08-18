import type { GraphicAsset, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { anotherBrowser, anotherUser } from './identities';

/**
 * Who a Graphics Ingestion Operation belongs to, proved through the real routes.
 *
 * Since #398 the answer is a **person** (ADR-0010's credential model), and that is
 * what this suite is now about. The rule it used to open with — that every
 * author-facing route refuses a caller carrying no session — is the API boundary's
 * since the cutover and is proved once, against a genuinely anonymous client, in
 * `apiBoundary.test.ts`. What is left is the guarantee no middleware can state:
 *
 * - one person cannot reach another's operation, however they label themselves;
 * - the same person can, from any browser — an operation outlives the session it
 *   was started in, which is the whole of what the cutover bought.
 *
 * Scoping is asserted while the caller supplies the identity header the library
 * used to trust. A suite that only proved scoping between two headers would prove
 * the mechanism and not the guarantee, which is exactly the gap this replaces.
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
		authorCookie = await operatorSessionCookie();
		// A different person, not a second browser: what the scoping cases below
		// probe is ownership, and one person in two browsers is one owner (#398).
		intruderCookie = await anotherUser('ingestion-outsider');
		expect(intruderCookie).not.toBe(authorCookie);

		/**
		 * Every scoping probe is parked at `awaiting-confirmation`: a font whose
		 * bytes are staged and which is waiting on the browser's answer to a
		 * server-selected challenge. That is the one stage at which all thirteen
		 * routes have real work to refuse — in particular the staged-source route,
		 * which answers `missing` at any other stage and would otherwise report a
		 * 404 that says nothing at all about who asked.
		 *
		 * Parked is also load-bearing for suite isolation: these bytes are
		 * byte-identical to the `mplantin.woff` that graphicsAssetIngestion
		 * publishes as a real font revision. Staged-but-unconfirmed content touches
		 * nothing digest-keyed (see the padding-count registry docblock in
		 * helpers.ts, proved on #371), so the two suites cannot collide — but
		 * confirming any probe would publish these bytes and recreate exactly the
		 * #368 cross-suite dedup collision. The last test in this file trips if
		 * that ever happens.
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

	/*
	 * A `describe` of thirteen route-by-route refusals for a caller with no session
	 * stood here until #398. Every one of them now meets ADR-0010's boundary before
	 * its handler runs, so they asserted a middleware from thirteen angles; the
	 * boundary is proved once in `apiBoundary.test.ts`, and exhaustively against
	 * every route file on disk in `test/unit/server/utils/apiBoundary.test.ts`.
	 */

	describe('a second person claiming the initiating identity', () => {
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
	});

	/**
	 * The other half of that key, and the half the cutover widened (#398).
	 *
	 * `(initiatedBy, idempotencyKey)` is unique, and `initiatedBy` is now a person
	 * — so the same key sent from a second browser reconnects to the first
	 * operation instead of starting a second one. ADR-0010 calls this intentional
	 * dedupe rather than a side effect, which is worth a case of its own precisely
	 * because it reads like one: under the Graphics Author Session the identical
	 * request from a second browser produced a second operation, and the sentence
	 * describing that ("the same person in a second browser is still a second
	 * author") was retired with it.
	 */
	describe('the same person in a second browser', () => {
		it('reconnects to their own operation rather than starting another', async () => {
			const secondBrowser = await anotherBrowser();

			const reconnected = await initiateFontAs(
				secondBrowser,
				'authorisation-scoping-probe-0',
				'Authorisation scoping probe 0',
			);

			expect(reconnected.id).toBe(scopingProbes.get(operationRoutes[0]!.label));
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

		it('leaves the initiator still reading their own provisional staged bytes', async () => {
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
	 * A session ending mid-transfer, which is where ownership used to cost the most
	 * and now costs almost nothing (#176's scenario, #398's answer).
	 *
	 * The same story as before the cutover for its first two beats — the transfer
	 * stops with `401`, and the durable checkpoint is untouched — and the opposite
	 * for its third. Ownership is the person's now, so signing in again reaches the
	 * operation instead of finding somebody else's: the case below that used to
	 * assert `404` for a reload asserts that the transfer resumes.
	 *
	 * That is the difference ADR-0010 bought, stated where it can be seen: an upload
	 * interrupted overnight is finished in the morning, from any machine, rather
	 * than being reclaimed by the retention sweep with its bytes still good.
	 */
	describe('a session that ends mid-transfer', () => {
		/**
		 * A cookie of the shape a browser keeps and the server has forgotten.
		 *
		 * A token that was never issued, not one that has expired — the two are not
		 * the same event, and the honest claim is narrower than "this is what expiry
		 * looks like". What makes it a faithful proxy is that both reach the boundary
		 * the same way: Better Auth looks the token up, gets nothing back, and the
		 * request is refused before a handler sees it. It has to be a *session*
		 * cookie by name, because the suite's client signs any request that presents
		 * none — a request with no identity has to be sent deliberately since the
		 * cutover.
		 */
		const endedCookie
			= 'better-auth.session_token=a7f1c0d2-ended-session-token-no-longer-stored';

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
					headers: { 'cookie': endedCookie, 'content-type': 'application/octet-stream' },
					body: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
				},
			);
			expect(response.status).toBe(401);
		});

		/**
		 * The cutover's headline, and the one case in this file that asserts the
		 * opposite* of what it asserted before #398.
		 *
		 * Signing in again is a new Better Auth session — a new browser, as far as
		 * the installation is concerned — and it reaches the operation, because
		 * `initiatedBy` is the person rather than the session. Under the Graphics
		 * Author Session this was a `404` to the very person who started the upload.
		 */
		it('is reached again after signing in from another browser', async () => {
			const secondBrowser = await anotherBrowser();
			expect(secondBrowser).not.toBe(authorCookie);

			await expect($fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${interruptedId}`,
				{ headers: { cookie: secondBrowser } },
			)).resolves.toMatchObject({
				id: interruptedId,
				stage: 'transferring',
				transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			});
		});

		it('loses nothing at all, checkpoint included', async () => {
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

	/**
	 * The tripwire the probe setup docblock promises: after every case above has
	 * run (vitest executes a file's tests in declaration order, so this one runs
	 * last), each scoping probe is still parked at `awaiting-confirmation`, so no
	 * copy of this suite's staged `mplantin.woff` ever became canonical content.
	 * That is what keeps this suite off graphicsAssetIngestion's published font
	 * revision (#371); a future case that confirms a probe fails here.
	 */
	it('leaves every scoping probe parked at awaiting-confirmation', async () => {
		expect(scopingProbes.size).toBe(operationRoutes.length);
		for (const [label, operationId] of scopingProbes) {
			const operation = await $fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${operationId}`,
				{ headers: { cookie: authorCookie } },
			);
			expect(operation.stage, `scoping probe for ${label}`).toBe('awaiting-confirmation');
		}
	});
});

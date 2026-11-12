import type { GraphicAsset, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHICS_MULTIPART_PART_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { $fetch, anonymousFetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { anotherBrowser, anotherUser } from './identities';
import { expectResponseStatus } from './responseStatus';

// A Graphics Ingestion Operation belongs to a person: nobody else reaches it, whatever
// identity they claim, and its owner reaches it from any browser. That a caller with no
// Session is refused at all is `apiBoundary.test.ts`'s.

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const emptyTextChunk = Uint8Array.of(0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0x96, 0x42, 0xC5, 0x85);

// This suite's own still image. Identical bytes deduplicate into one Graphic Asset across
// suites, so it is padded with a chunk count (70) no other suite uses.
const transparentPixelPng = Uint8Array.from(Buffer.concat([
	basePixelPng.slice(0, -12),
	...Array.from({ length: 70 }).fill(emptyTextChunk) as Uint8Array[],
	basePixelPng.slice(-12),
]));

// The author identity header the library once trusted, sent on every request here and
// set to the owner's. It must buy nothing.
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

// Every route that acts on one existing Graphics Ingestion Operation. Bodies are
// well-formed, so a refusal is about who asked and never a validation failure.
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
		json: {
			outcome: 'decoded',
			sourceDigest: digest,
			width: 1,
			height: 1,
		},
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
		// A loopback URL, so a run in which scoping has failed still reaches no network.
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
		json: {
			fingerprint: '0'.repeat(64),
		},
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
	let fontBytes: Uint8Array<ArrayBuffer>;

	/** The probes the running test parked. */
	const parked: string[] = [];

	async function initiateFontAs(cookie: string, idempotencyKey: string) {
		return await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: { cookie, ...UNHONOURED_AUTHOR_ID_HEADER },
				body: graphicsIngestionRequest({
					idempotencyKey,
					name: idempotencyKey,
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

	async function operationAs(cookie: string, operationId: string) {
		return await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operationId}`,
			{
				headers: { cookie, ...UNHONOURED_AUTHOR_ID_HEADER },
			},
		);
	}

	// The author's own operation, parked at `awaiting-confirmation`: a staged font awaiting
	// the browser's answer, the one stage at which every route has real work to refuse.
	async function parkedProbe(idempotencyKey: string) {
		const initiated = await initiateFontAs(authorCookie, idempotencyKey);
		const staged = await uploadAs(authorCookie, initiated.id, fontBytes, 'font/woff');
		expect(staged.stage).toBe('awaiting-confirmation');
		parked.push(initiated.id);
		return initiated.id;
	}

	beforeAll(async () => {
		fontBytes = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
		authorCookie = await operatorSessionCookie();
	});

	// A probe's bytes are the font graphicsAssetIngestion publishes. Staged, they collide
	// with nothing; confirmed, they would become that suite's canonical content.
	afterEach(async () => {
		for (const operationId of parked.splice(0))
			expect((await operationAs(authorCookie, operationId)).stage).toBe('awaiting-confirmation');
	});

	// A 401 with a side effect passes any status assertion, so each refusal is followed by
	// a read of what it must not have changed.
	describe('a refused write', () => {
		let assetId: string;
		let eventId: number;

		async function lifecycleSubject() {
			const assets = await $fetch<GraphicAsset[]>('/api/graphics-assets', {
				headers: { cookie: authorCookie },
				query: { search: 'Authorisation lifecycle subject' },
			});
			return assets.find(asset => asset.id === assetId);
		}

		beforeAll(async () => {
			const event = await $fetch<{ id: number }>('/api/events', {
				method: 'POST',
				body: {
					name: 'Graphics Authorisation Event',
					game: 'mtg',
					featureMatchOrientation: 'horizontal',
				},
			});
			eventId = event.id;
			const publishable = await $fetch<GraphicsIngestionOperation>(
				'/api/graphics-assets/ingestion-operations',
				{
					method: 'POST',
					headers: { cookie: authorCookie },
					body: graphicsIngestionRequest({
						idempotencyKey: 'authorisation-lifecycle-subject',
						name: 'Authorisation lifecycle subject',
						declaredByteLength: transparentPixelPng.byteLength,
						defaultEventId: eventId,
						browserDecodeEvidence: {
							outcome: 'decoded',
							sourceDigest: digest,
							width: 1,
							height: 1,
						},
					}),
				},
			);
			const published = await uploadAs(authorCookie, publishable.id, transparentPixelPng, 'image/png');
			expect(published.stage).toBe('completed');
			assetId = published.result!.assetId;
		});

		afterAll(async () => {
			try {
				await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
			}
			catch {}
		});

		// The metadata write replaces the Event association set, so `[]` would detach them all.
		it('detaches no Event association, having been refused before it acted', async () => {
			const response = await anonymousFetch(`/api/graphics-assets/${assetId}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'Renamed by nobody', eventIds: [] }),
			});

			expect(response.status).toBe(401);
			expect(await lifecycleSubject()).toMatchObject({
				eventIds: [eventId],
			});
		});

		it('leaves the Graphic Asset in active discovery', async () => {
			const response = await anonymousFetch(`/api/graphics-assets/${assetId}/lifecycle-actions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'trash' }),
			});

			expect(response.status).toBe(401);
			expect(await lifecycleSubject()).toMatchObject({
				lifecycle: { state: 'active' },
			});
		});
	});

	describe('a second person claiming the initiating identity', () => {
		let intruderCookie: string;

		beforeAll(async () => {
			// A different person, not a second browser: one person in two browsers is one owner.
			intruderCookie = await anotherUser('ingestion-outsider');
			expect(intruderCookie).not.toBe(authorCookie);
		});

		it.each(operationRoutes)('cannot reach the operation for $label, which its author finds as they left it', async (route) => {
			const operationId = await parkedProbe(`authorisation-scoping-probe-${operationRoutes.indexOf(route)}`);

			const response = await fetch(
				route.path(operationId),
				requestInit(route, { cookie: intruderCookie, ...UNHONOURED_AUTHOR_ID_HEADER }),
			);

			expect(response.status).toBe(404);
			expect(await operationAs(authorCookie, operationId)).toMatchObject({
				id: operationId,
				stage: 'awaiting-confirmation',
			});
			const staged = await fetch(
				`/api/graphics-assets/ingestion-operations/${operationId}/staged-source`,
				{
					headers: { cookie: authorCookie, ...UNHONOURED_AUTHOR_ID_HEADER },
				},
			);
			expect(staged.status).toBe(200);
			expect(new Uint8Array(await staged.arrayBuffer())).toEqual(fontBytes);
		});

		it('cannot reconnect to an operation by reusing its idempotency key', async () => {
			const operationId = await parkedProbe('authorisation-reused-key-probe');

			const reconnectAttempt = await initiateFontAs(intruderCookie, 'authorisation-reused-key-probe');

			expect(reconnectAttempt.id).not.toBe(operationId);
		});
	});

	// `(initiatedBy, idempotencyKey)` is unique and `initiatedBy` is the person, so the same
	// key from a second browser reconnects: deliberate dedupe, not a second operation.
	describe('the same person in a second browser', () => {
		it('reconnects to their own operation rather than starting another', async () => {
			const operationId = await parkedProbe('authorisation-second-browser-probe');

			const reconnected = await initiateFontAs(await anotherBrowser(), 'authorisation-second-browser-probe');

			expect(reconnected.id).toBe(operationId);
		});
	});

	// Ownership is the person's, so a transfer whose session ended is refused from nobody,
	// keeps its checkpoint, and is reached and finished by its owner from any session.
	describe('a session that ends mid-transfer', () => {
		// A session cookie by name, carrying a token the server never issued: Better Auth finds
		// nothing for it, as for an expired one. The suite's client signs a request with none.
		const endedCookie
			= 'better-auth.session_token=a7f1c0d2-ended-session-token-no-longer-stored';

		const bytes = new Uint8Array(GRAPHICS_MULTIPART_PART_BYTES + 1);

		/** The transfers the running test started. */
		const transfers: string[] = [];

		async function sendPart(operationId: string, partNumber: 1 | 2, cookie: string) {
			return await fetch(
				`/api/graphics-assets/ingestion-operations/${operationId}/multipart/parts/${partNumber}`,
				{
					method: 'PUT',
					headers: { cookie, 'content-type': 'application/octet-stream' },
					body: partNumber === 1
						? bytes.subarray(0, GRAPHICS_MULTIPART_PART_BYTES)
						: bytes.subarray(GRAPHICS_MULTIPART_PART_BYTES),
				},
			);
		}

		/** A two-part transfer the author began: its first part verified, its second not sent. */
		async function interruptedTransfer(idempotencyKey: string) {
			const initiated = await $fetch<GraphicsIngestionOperation>(
				'/api/graphics-assets/ingestion-operations',
				{
					method: 'POST',
					headers: { cookie: authorCookie },
					body: graphicsIngestionRequest({
						idempotencyKey,
						name: idempotencyKey,
						declaredMime: 'image/png',
						declaredByteLength: bytes.byteLength,
					}),
				},
			);
			transfers.push(initiated.id);
			const started = await $fetch<GraphicsIngestionOperation>(
				`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart`,
				{
					method: 'POST',
					headers: { cookie: authorCookie },
				},
			);
			expect(started.transfer?.partCount).toBe(2);
			await expectResponseStatus(await sendPart(initiated.id, 1, authorCookie), 200);
			return initiated.id;
		}

		// Cancelling releases the staged reservation, so no test leaves 16 MiB parked in the
		// Graphics Staging Allowance for this suite's neighbours.
		afterEach(async () => {
			for (const operationId of transfers.splice(0)) {
				await $fetch(`/api/graphics-assets/ingestion-operations/${operationId}`, {
					method: 'DELETE',
					headers: { cookie: authorCookie },
				});
			}
		});

		it('refuses the next part rather than accepting it from nobody, losing nothing, checkpoint included', async () => {
			const interruptedId = await interruptedTransfer('authorisation-lapsed-session-refused');

			const refused = await sendPart(interruptedId, 2, endedCookie);

			expect(refused.status).toBe(401);
			expect(await operationAs(authorCookie, interruptedId)).toMatchObject({
				stage: 'transferring',
				transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
				transfer: {
					completedParts: [
						{
							partNumber: 1,
							partIdentity: `${interruptedId}:1`,
							byteLength: GRAPHICS_MULTIPART_PART_BYTES,
						},
					],
				},
			});
		});

		// Signing in again is a new Session, and it reaches the operation because
		// `initiatedBy` is the person.
		it('is reached again after signing in from another browser', async () => {
			const interruptedId = await interruptedTransfer('authorisation-lapsed-session-reached');
			const secondBrowser = await anotherBrowser();
			expect(secondBrowser).not.toBe(authorCookie);

			expect(await operationAs(secondBrowser, interruptedId)).toMatchObject({
				id: interruptedId,
				stage: 'transferring',
				transferredByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			});
		});

		// Finished from the verified part, not from the beginning. The bytes are zero-filled,
		// so the library rejects them on their merits: a terminal stage of the operation's own.
		it('is resumed to a terminal outcome by the session that started it', async () => {
			const interruptedId = await interruptedTransfer('authorisation-lapsed-session-resumed');
			expect((await sendPart(interruptedId, 2, endedCookie)).status).toBe(401);

			await expectResponseStatus(await sendPart(interruptedId, 2, authorCookie), 200);
			const completion = await fetch(
				`/api/graphics-assets/ingestion-operations/${interruptedId}/multipart/complete`,
				{
					method: 'POST',
					headers: { cookie: authorCookie },
				},
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

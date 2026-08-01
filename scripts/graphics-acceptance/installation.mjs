/**
 * One installation under acceptance, reached the way a real client reaches it.
 *
 * The harnesses talk to a running Stream Keepr over HTTP and nothing else — no
 * imports from the server, no database handle, no object-store client — so the
 * same script proves the same contract against `pnpm preview` and against the
 * deployed installation. Provisioning goes through the same public routes an
 * author would use, which is what makes a green run evidence about the
 * product rather than about the harness.
 */

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { crc32 } from 'node:zlib';
import { featureMatchLayoutReferencing } from './domain-defaults.mjs';

const DEFAULT_LOCAL_ORIGIN = 'http://127.0.0.1:8787';

/**
 * The deployed origin is deliberately not defaulted: an acceptance run that
 * silently pointed at the wrong installation would be worse than one that
 * refused to start.
 */
export function acceptanceOrigin({ deployed }) {
	if (!deployed)
		return (process.env.STREAM_KEEPR_LOCAL_ACCEPTANCE_URL ?? DEFAULT_LOCAL_ORIGIN).replace(/\/$/, '');
	const baseUrl = process.env.STREAM_KEEPR_BROWSER_ACCEPTANCE_URL
		?? process.env.STREAM_KEEPR_DEPLOY_HEALTH_URL;
	if (!baseUrl)
		throw new Error('Set STREAM_KEEPR_BROWSER_ACCEPTANCE_URL to the deployed staging base URL.');
	return baseUrl.replace(/\/$/, '');
}

export function digestOf(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

const BASE_PIXEL_PNG = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

/**
 * A still image whose bytes belong to this run alone. Content-addressed
 * storage would otherwise hand two runs the same revision, and a range read
 * over 95 bytes proves less than one over a few hundred.
 */
export function distinctPixelPng(marker) {
	const payload = Buffer.concat([
		Buffer.from('tEXt'),
		Buffer.from(`sk-acceptance\0${marker}`),
	]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(payload.byteLength - 4, 0);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(payload), 0);
	return Uint8Array.from(Buffer.concat([
		Buffer.from(BASE_PIXEL_PNG.slice(0, -12)),
		length,
		payload,
		checksum,
		Buffer.from(BASE_PIXEL_PNG.slice(-12)),
	]));
}

async function observe(response) {
	const bytes = new Uint8Array(await response.arrayBuffer());
	return {
		status: response.status,
		headers: response.headers,
		bytes,
		text: () => new TextDecoder().decode(bytes),
	};
}

/**
 * @param {string} origin
 */
export async function openInstallation(origin) {
	const bootstrap = await fetch(`${origin}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
	const authorCookie = bootstrap.headers.getSetCookie()
		.map(value => value.split(';', 1)[0])
		.find(value => value.includes('='));
	if (!authorCookie)
		throw new Error('The installation did not issue a graphics author session.');

	/**
	 * @param {string} path
	 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown, author?: boolean }} init
	 */
	async function request(path, init = {}) {
		const headers = new Headers(init.headers ?? {});
		if (init.author)
			headers.set('cookie', [headers.get('cookie'), authorCookie].filter(Boolean).join('; '));
		let body = init.body;
		if (body !== undefined && !(body instanceof Uint8Array)) {
			headers.set('content-type', 'application/json');
			body = JSON.stringify(body);
		}
		return await observe(await fetch(`${origin}${path}`, {
			method: init.method ?? 'GET',
			headers,
			body,
			redirect: 'manual',
		}));
	}

	async function json(path, init = {}) {
		const observation = await request(path, init);
		if (observation.status >= 400) {
			throw new Error(
				`${init.method ?? 'GET'} ${path.replace(/\/\d+/g, '/:id')} answered ${observation.status}`,
			);
		}
		return observation.bytes.byteLength === 0 ? undefined : JSON.parse(observation.text());
	}

	return { origin, authorCookie, request, json };
}

/**
 * Provision one Screen Output that references one pinned Graphic Asset
 * Revision, which is the smallest arrangement in which capability-bound
 * delivery is a real thing rather than a simulated one.
 */
export async function provisionScreenOutputScenario(session, { label }) {
	const marker = randomUUID();
	const content = distinctPixelPng(marker);
	const event = await session.json('/api/events', {
		method: 'POST',
		author: true,
		body: {
			name: `${label} ${marker.slice(0, 8)}`,
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
		},
	});
	const screen = await session.json(`/api/events/${event.id}/screens`, {
		method: 'POST',
		author: true,
		body: {
			name: 'Acceptance Overlay',
			slug: `acceptance-overlay-${marker.slice(0, 8)}`,
			currentMode: 'feature-match-overlay',
		},
	});

	const initiated = await session.json('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		author: true,
		body: {
			idempotencyKey: `staging-acceptance-${marker}`,
			name: 'Staging acceptance pixel',
			defaultEventId: event.id,
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: digestOf(content),
				width: 1,
				height: 1,
			},
			declaredByteLength: content.byteLength,
		},
	});
	const operation = await session.json(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', author: true, body: content },
	);
	const { assetId, revisionId } = operation.result;

	// A capability only authorizes what the Screen Output actually references,
	// so the reference has to exist before the capability is worth anything.
	await session.json(
		`/api/events/${event.id}/screens/${screen.id}/config/feature-match-overlay`,
		{
			method: 'PATCH',
			author: true,
			body: { layout: featureMatchLayoutReferencing({ assetId, revisionId }) },
		},
	);

	async function mintCapability(method) {
		const minted = await session.json(
			`/api/events/${event.id}/screens/${screen.id}/asset-capability`,
			{ method, author: true },
		);
		return minted.assetCapability;
	}

	return {
		eventId: event.id,
		screenId: screen.id,
		assetId,
		revisionId,
		content,
		contentType: 'image/png',
		capability: await mintCapability('GET'),
		rotateCapability: () => mintCapability('POST'),
		capabilityContentPath: () =>
			`/api/screen-output/screens/${screen.id}/assets/${assetId}/revisions/${revisionId}/content`,
		editorContentPath: () => `/api/graphics-assets/${assetId}/revisions/${revisionId}/content`,
		async dispose() {
			try {
				await session.request(`/api/events/${event.id}`, { method: 'DELETE', author: true });
			}
			catch {
				// A left-behind acceptance Event is noise, never a failure of the gate.
			}
		},
	};
}

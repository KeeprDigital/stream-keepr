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
import { AcceptanceFailure, deliveryRouteLabel } from './evidence.mjs';
import {
	featureMatchLayoutReferencing,
	featureMatchLayoutWithRestrictedVideo,
} from './repository-bridge.mjs';
import { acceptanceRoutes, screenOutputRepresentation } from './routes.mjs';

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
	if (!baseUrl) {
		throw new AcceptanceFailure('harness-precondition-unmet', {
			reason: 'STREAM_KEEPR_BROWSER_ACCEPTANCE_URL is unset',
		});
	}
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
	if (!authorCookie) {
		throw new AcceptanceFailure('harness-precondition-unmet', {
			reason: 'no graphics author session issued',
		});
	}

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
			// The path carries the asset, revision, and operation identities the
			// evidence gate exists to withhold, so only its route label travels.
			throw new AcceptanceFailure('harness-precondition-unmet', {
				route: deliveryRouteLabel(path),
				method: init.method ?? 'GET',
				actual: observation.status,
			});
		}
		return observation.bytes.byteLength === 0 ? undefined : JSON.parse(observation.text());
	}

	return { origin, authorCookie, request, json };
}

/**
 * The browser's half of a staged run: where to go, and whose session to go as.
 *
 * Anything the harness stages belongs to the session that staged it and is a
 * `404` to any other (ADR-0003), so a page opened for that work has to carry
 * this session — and "the harness forgot to pass the cookie" is a defect no
 * assertion in the page can see, because the page simply becomes a different,
 * perfectly valid author (#276). Pairing the two here means the call site says
 * `open this page as this session` in one expression, rather than assembling an
 * identity from two arguments that can be separated by an edit.
 */
export function authoredPageRequest(session, url) {
	return { url, authorCookie: session.authorCookie };
}

/**
 * Provision one Screen Output that references one pinned Graphic Asset
 * Revision, which is the smallest arrangement in which capability-bound
 * delivery is a real thing rather than a simulated one.
 */
export async function provisionScreenOutputScenario(session, { label }) {
	const marker = randomUUID();
	const content = distinctPixelPng(marker);
	const event = await session.json(acceptanceRoutes.events(), {
		method: 'POST',
		author: true,
		body: {
			name: `${label} ${marker.slice(0, 8)}`,
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
		},
	});
	const slug = `acceptance-overlay-${marker.slice(0, 8)}`;
	const screen = await session.json(acceptanceRoutes.screens(event.id), {
		method: 'POST',
		author: true,
		body: { name: 'Acceptance Overlay', slug, currentMode: 'feature-match-overlay' },
	});

	const initiated = await session.json(acceptanceRoutes.ingestionOperations(), {
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
		acceptanceRoutes.ingestionContent(initiated.id),
		{ method: 'PUT', author: true, body: content },
	);
	const { assetId, revisionId } = operation.result;

	// A capability only authorizes what the Screen Output actually references,
	// so the reference has to exist before the capability is worth anything.
	await session.json(
		acceptanceRoutes.screenModeConfig(event.id, screen.id, 'feature-match-overlay'),
		{
			method: 'PATCH',
			author: true,
			body: { layout: featureMatchLayoutReferencing({ assetId, revisionId }) },
		},
	);

	async function mintCapability(method) {
		const minted = await session.json(
			acceptanceRoutes.screenAssetCapability(event.id, screen.id),
			{ method, author: true },
		);
		return minted.assetCapability;
	}

	return {
		...screenOutputRepresentation({
			eventId: event.id,
			screenId: screen.id,
			screenSlug: slug,
			assetId,
			revisionId,
			content,
			contentType: 'image/png',
		}),
		capability: await mintCapability('GET'),
		rotateCapability: () => mintCapability('POST'),
		async dispose() {
			try {
				await session.request(acceptanceRoutes.event(event.id), { method: 'DELETE', author: true });
			}
			catch {
				// A left-behind acceptance Event is noise, never a failure of the gate.
			}
		},
	};
}

/**
 * Stage one font Graphic Asset and stop where the product stops: awaiting the
 * browser's answer to a server-selected glyph challenge.
 *
 * The bundled application fonts are explicitly outside the library, so a gate
 * that only loaded those would never send a font through Worker delivery at
 * all. Publishing one here is what lets the browser gate read a real staged
 * source, answer the real challenge, and then load the published revision back
 * through the delivery route.
 */
export async function stageFontIngestion(session, { bytes, declaredMime, sourceFileName }) {
	const marker = randomUUID();
	const initiated = await session.json(acceptanceRoutes.ingestionOperations(), {
		method: 'POST',
		author: true,
		body: {
			idempotencyKey: `staging-acceptance-font-${marker}`,
			name: `Staging acceptance face ${marker.slice(0, 8)}`,
			sourceFileName,
			declaredMime,
			declaredByteLength: bytes.byteLength,
		},
	});
	const staged = await session.json(acceptanceRoutes.ingestionContent(initiated.id), {
		method: 'PUT',
		author: true,
		headers: { 'content-type': declaredMime },
		body: bytes,
	});
	if (staged.stage !== 'awaiting-confirmation' || staged.report?.facts?.kind !== 'font') {
		throw new AcceptanceFailure('harness-precondition-unmet', {
			route: deliveryRouteLabel(acceptanceRoutes.ingestionContent(initiated.id)),
			reason: 'no font challenge was issued',
		});
	}
	return {
		operationId: initiated.id,
		challenge: staged.report.facts.browserChallenge,
		/** Whatever the operation ended up publishing, if it published at all. */
		async publishedAssetId() {
			try {
				const settled = await session.json(
					acceptanceRoutes.ingestionOperation(initiated.id),
					{ author: true },
				);
				return settled?.result?.assetId;
			}
			catch {
				return undefined;
			}
		},
		async dispose(assetId) {
			if (!assetId)
				return;
			try {
				await session.request(acceptanceRoutes.assetLifecycleActions(assetId), {
					method: 'POST',
					author: true,
					body: { action: 'trash' },
				});
			}
			catch {
				// A left-behind acceptance face is noise, never a failure of the gate.
			}
		},
	};
}

/**
 * Publish one Screen Output that pins a VP9-alpha silent video.
 *
 * This is the arrangement in which the product's own restriction becomes
 * observable: the capability-session bootstrap refuses a Safari user agent
 * only when the Screen Output actually holds restricted video. Ingesting the
 * video needs the silent-video validator, so this is a deployed-only
 * provisioning path — the local Worker has no service binding to reach it.
 */
export async function provisionRestrictedVideoScenario(session, { label, webm }) {
	const marker = randomUUID();
	const event = await session.json(acceptanceRoutes.events(), {
		method: 'POST',
		author: true,
		body: {
			name: `${label} ${marker.slice(0, 8)}`,
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
		},
	});
	const slug = `acceptance-restricted-${marker.slice(0, 8)}`;
	const screen = await session.json(acceptanceRoutes.screens(event.id), {
		method: 'POST',
		author: true,
		body: { name: 'Acceptance Restricted Overlay', slug, currentMode: 'feature-match-overlay' },
	});

	async function dispose() {
		try {
			await session.request(acceptanceRoutes.event(event.id), { method: 'DELETE', author: true });
		}
		catch {
			// A left-behind acceptance Event is noise, never a failure of the gate.
		}
	}

	try {
		const initiated = await session.json(acceptanceRoutes.ingestionOperations(), {
			method: 'POST',
			author: true,
			body: {
				idempotencyKey: `staging-acceptance-vp9-alpha-${marker}`,
				name: 'Staging acceptance VP9 alpha',
				sourceFileName: 'acceptance-vp9-alpha.webm',
				declaredMime: 'video/webm',
				defaultEventId: event.id,
				declaredByteLength: webm.byteLength,
			},
		});
		const operation = await session.json(acceptanceRoutes.ingestionContent(initiated.id), {
			method: 'PUT',
			author: true,
			headers: { 'content-type': 'video/webm' },
			body: webm,
		});
		// Validation runs in a Container, so the transfer response may land
		// before the report does.
		let settled = operation;
		const deadline = Date.now() + 120_000;
		while (settled.stage !== 'completed' && Date.now() < deadline) {
			if (settled.stage === 'failed' || settled.stage === 'cancelled')
				break;
			await new Promise(resolve => setTimeout(resolve, 1000));
			settled = await session.json(acceptanceRoutes.ingestionOperation(initiated.id), {
				author: true,
			});
		}
		if (settled.stage !== 'completed' || !settled.result) {
			throw new AcceptanceFailure('harness-precondition-unmet', {
				route: deliveryRouteLabel(acceptanceRoutes.ingestionContent(initiated.id)),
				reason: `the video settled at ${settled.stage}`,
			});
		}
		if (settled.report?.facts?.targetCompatibility !== 'chromium-transparency') {
			throw new AcceptanceFailure('harness-precondition-unmet', {
				reason: 'the ingested video is not restricted to chromium transparency',
			});
		}

		const { assetId, revisionId } = settled.result;
		await session.json(
			acceptanceRoutes.screenModeConfig(event.id, screen.id, 'feature-match-overlay'),
			{
				method: 'PATCH',
				author: true,
				body: { layout: featureMatchLayoutWithRestrictedVideo({ assetId, revisionId }) },
			},
		);

		return { eventId: event.id, screenId: screen.id, screenSlug: slug, assetId, revisionId, dispose };
	}
	catch (error) {
		await dispose();
		throw error;
	}
}

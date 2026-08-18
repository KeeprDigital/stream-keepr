#!/usr/bin/env node
/**
 * The #374 authored-save latency series, against a deployed installation.
 *
 * Times `PATCH /api/events/:eventId/screens/:screenId/config/broadcast-graphics`
 * at a series of Graphic Asset Reference counts, replacing the Screen's whole
 * configuration on every write exactly as the 2026-08-15 diagnosis run did, and
 * prints the table #374 asks to have re-run after the json_each insert landed.
 *
 * The probe provisions its own Event and Screen, references existing active
 * Graphic Assets rather than ingesting content, and cleans up after itself:
 * the Event is deleted, and a font restored from Trash for the run is
 * re-Trashed. Run it only against an installation whose owner asked for the
 * numbers — every timed write is a real authored save.
 *
 *   node scripts/measure-authored-save-latency.mjs \
 *     [--url https://stream.keepr.digital] [--series 1,12,60,150,300,600,600,300,60,1]
 */

import process from 'node:process';
import { readLocalConfigurationFiles, suppliedNames } from './graphics-acceptance/local-configuration.mjs';
import { isLoopbackOrigin, openOperatorSession } from './graphics-acceptance/operator.mjs';

/**
 * A Broadcast Graphics configuration publishing exactly `count` Graphic Asset
 * References, in the diagnosis run's composition: Media Graphic Items pin one
 * image revision each, Text Graphic Items pin a font three times over — base
 * typography and two Graphic Placeholder Styles — so media and font
 * preconditions both ride in every sizeable batch.
 *
 * Exported so `test/unit/scripts/authoredSaveLatencyConfig.test.ts` can hold it
 * against the real schema and the real reference discovery.
 */
export function authoredConfigForReferenceCount(count, assets) {
	const items = [];
	let remaining = count;
	let index = 0;
	const fontSelection = assets.font
		? { kind: 'asset', reference: { assetId: assets.font.assetId, revisionId: assets.font.revisionId } }
		: { kind: 'application', fontId: 'inter' };

	const mediaItem = () => ({
		id: `media-${index}`,
		label: `Probe media ${index}`,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		type: 'media',
		mediaKind: 'image',
		fit: 'contain',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: false,
		asset: { assetId: assets.image.assetId, revisionId: assets.image.revisionId },
	});
	const textItem = () => ({
		id: `text-${index}`,
		label: `Probe text ${index}`,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 120,
		width: 400,
		height: 60,
		type: 'text',
		text: 'Round {home} of {away}',
		typography: {
			font: fontSelection,
			fontSize: 32,
			fontWeight: 700,
			fontStyle: 'normal',
			textTransform: 'none',
			letterSpacing: 0,
			lineHeight: 1.15,
			textAlign: 'left',
			color: '#ffffff',
		},
		overflowPolicy: 'ellipsis',
		minFontSize: 16,
		placeholderStyles: {
			home: { font: fontSelection },
			away: { font: fontSelection },
		},
	});

	// Media items publish one reference, text items three (when a font asset is
	// available). Pair them while both fit, then settle the remainder with media.
	while (remaining > 0) {
		if (assets.font && remaining >= 4) {
			items.push(mediaItem());
			index++;
			items.push(textItem());
			index++;
			remaining -= 4;
			continue;
		}
		if (assets.font && remaining === 3) {
			items.push(textItem());
			index++;
			remaining -= 3;
			continue;
		}
		items.push(mediaItem());
		index++;
		remaining -= 1;
	}

	// At most 100 Graphic Items per Broadcast Graphic; the probe splits its
	// stack across as many Broadcast Graphics as the item count needs.
	const graphics = [];
	for (let start = 0; start < items.length; start += 100) {
		graphics.push({
			id: `probe-graphic-${graphics.length}`,
			name: `Probe graphic ${graphics.length}`,
			items: items.slice(start, start + 100),
		});
	}
	if (graphics.length === 0)
		graphics.push({ id: 'probe-graphic-0', name: 'Probe graphic 0', items: [] });
	return { graphics };
}

function parseArguments(argv) {
	const options = {
		url: 'https://stream.keepr.digital',
		series: [1, 12, 60, 150, 300, 600, 600, 300, 60, 1],
	};
	for (let index = 2; index < argv.length; index++) {
		if (argv[index] === '--url')
			options.url = argv[++index];
		else if (argv[index] === '--series')
			options.series = argv[++index].split(',').map(value => Number.parseInt(value.trim(), 10));
		else
			throw new Error(`Unknown argument: ${argv[index]}`);
	}
	return options;
}

async function main() {
	const options = parseArguments(process.argv);
	const base = options.url.replace(/\/$/, '');
	const jar = new Map();

	function storeCookies(response) {
		for (const header of response.headers.getSetCookie?.() ?? []) {
			const [pair] = header.split(';');
			const separator = pair.indexOf('=');
			jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
		}
	}
	const cookieHeader = () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

	async function request(path, init = {}) {
		const response = await fetch(`${base}${path}`, {
			...init,
			headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
		});
		storeCookies(response);
		return response;
	}
	async function json(path, init = {}) {
		const response = await request(path, init);
		if (!response.ok)
			throw new Error(`${init.method ?? 'GET'} ${path} answered ${response.status}: ${(await response.text()).slice(0, 500)}`);
		return await response.json();
	}
	const jsonBody = body => ({
		headers: { 'content-type': 'application/json', 'cookie': cookieHeader() },
		body: JSON.stringify(body),
	});

	// A Graphics Author Session is minted on any HTML page navigation — and the
	// minting middleware (server/middleware/graphics-author-session.ts) acts only
	// when the request Accepts text/html, which fetch's default `*/*` does not.
	storeCookies(await fetch(`${base}/graphics-assets`, {
		redirect: 'manual',
		headers: { accept: 'text/html' },
	}));
	if (jar.size === 0)
		throw new Error('No graphics author session cookie was issued by the page navigation.');

	// And an operator session, because #396 put a deny-by-default boundary in front
	// of `/api/**`: the author cookie above says who owns the work, not that the
	// request is allowed in. The jar carries both from here on, so every `request`
	// below is unchanged. Local secrets go only to a local origin — see
	// `isLoopbackOrigin`.
	const local = isLoopbackOrigin(base);
	for (const pair of await openOperatorSession(base, {
		deployed: !local,
		supplied: local ? suppliedNames(readLocalConfigurationFiles()) : {},
	})) {
		const separator = pair.indexOf('=');
		jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
	}

	const active = await json('/api/graphics-assets?lifecycleStates=active');
	const images = active.filter(asset => asset.kind === 'image');
	if (images.length === 0)
		throw new Error('No active image Graphic Asset to reference; the probe ingests nothing by design.');
	let font = active.find(asset => asset.kind === 'font');
	let restoredFontId = null;
	if (!font) {
		const trashed = await json('/api/graphics-assets?lifecycleStates=trashed');
		const candidate = trashed.find(asset => asset.kind === 'font');
		if (candidate) {
			const outcome = await json(`/api/graphics-assets/${candidate.id}/lifecycle-actions`, {
				method: 'POST',
				...jsonBody({ action: 'restore' }),
			});
			font = outcome.asset ?? candidate;
			restoredFontId = candidate.id;
			console.log(`Restored Trashed font ${candidate.id} for the run; it will be re-Trashed.`);
		}
		else {
			console.log('WARNING: no font Graphic Asset available; running an all-media composition, which is not the diagnosis run’s exact mix.');
		}
	}

	const event = await json('/api/events', {
		method: 'POST',
		...jsonBody({ name: '#374 latency probe', game: 'mtg', featureMatchOrientation: 'horizontal' }),
	});
	console.log(`Probe Event ${event.id}`);
	const rows = [];
	try {
		const screen = await json(`/api/events/${event.id}/screens`, {
			method: 'POST',
			...jsonBody({ name: 'Latency probe', slug: 'latency-probe-374', currentMode: 'idle' }),
		});
		const configPath = `/api/events/${event.id}/screens/${screen.id}/config/broadcast-graphics`;
		const leasePath = `/api/events/${event.id}/screens/${screen.id}/graphics-authoring-lease`;

		// The image must be selectable for NEW references (active lifecycle alone
		// is not proof — #302's probe found active-listed assets that were not).
		// The check is one single-reference write per candidate, kept out of the
		// timed series.
		let image = null;
		for (const candidate of images) {
			await json(leasePath, { method: 'POST', ...jsonBody({ heartbeatIntervalMs: 300_000 }) });
			const attempt = await request(configPath, {
				method: 'PATCH',
				...jsonBody(authoredConfigForReferenceCount(1, { image: { assetId: candidate.id, revisionId: candidate.revisionId } })),
			});
			await attempt.text();
			if (attempt.ok) {
				image = { assetId: candidate.id, revisionId: candidate.revisionId };
				break;
			}
		}
		if (!image)
			throw new Error('No active image Graphic Asset committed a single-reference authored save.');
		const assets = {
			image,
			...(font ? { font: { assetId: font.id, revisionId: font.revisionId } } : {}),
		};

		for (const count of options.series) {
			await json(leasePath, { method: 'POST', ...jsonBody({ heartbeatIntervalMs: 300_000 }) });
			const body = JSON.stringify(authoredConfigForReferenceCount(count, assets));
			const startedAt = performance.now();
			const response = await request(configPath, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', 'cookie': cookieHeader() },
				body,
			});
			const elapsedMs = Math.round(performance.now() - startedAt);
			await response.text();
			const row = {
				refs: count,
				status: response.status,
				ms: elapsedMs,
				payloadKiB: Math.round(new TextEncoder().encode(body).byteLength / 102.4) / 10,
			};
			rows.push(row);
			console.log(`refs=${row.refs} status=${row.status} ms=${row.ms} payloadKiB=${row.payloadKiB}`);
			if (!response.ok)
				break;
		}
	}
	finally {
		try {
			await json(`/api/events/${event.id}`, { method: 'DELETE' });
			console.log(`Probe Event ${event.id} deleted.`);
		}
		catch (caught) {
			console.error(`CLEANUP FAILED: Event ${event.id} was not deleted: ${caught}`);
		}
		if (restoredFontId) {
			try {
				await json(`/api/graphics-assets/${restoredFontId}/lifecycle-actions`, {
					method: 'POST',
					...jsonBody({ action: 'trash' }),
				});
				console.log(`Font ${restoredFontId} re-Trashed.`);
			}
			catch (caught) {
				console.error(`CLEANUP FAILED: font ${restoredFontId} was not re-Trashed: ${caught}`);
			}
		}
	}

	console.log('\n| refs | status | ms | payload KiB |');
	console.log('|------|--------|------|------|');
	for (const row of rows)
		console.log(`| ${row.refs} | ${row.status} | ${row.ms.toLocaleString('en-US')} | ${row.payloadKiB} |`);
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
	main().catch((caught) => {
		console.error(caught);
		process.exitCode = 1;
	});
}

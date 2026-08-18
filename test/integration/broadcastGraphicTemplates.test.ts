import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicTemplateResponse,
	BroadcastGraphicTemplateSummary,
} from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetUsage, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { anotherBrowser } from './identities';
import { executeIntegrationD1 } from './integrationD1';

/**
 * The Broadcast Graphic Template library through the real API.
 *
 * The behaviour under test is the whole round trip an author takes: compose a
 * Broadcast Graphic on a Screen, save it as a template, and place that template on
 * another Screen — in another Event — as a copy that is genuinely nothing to do
 * with the template any more.
 */

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

/**
 * This suite's own content, one valid ancillary text chunk away from the shared
 * single-pixel PNG.
 *
 * `create-separate` keeps this suite from inheriting another's Graphic Asset, but it
 * does not stop the reverse: content this suite publishes is content that a suite
 * ingesting the identical bytes under the default reuse policy will then *reuse*
 * rather than publish, which is a real cross-suite failure in the other direction.
 * Owning a distinct digest is what makes the isolation mutual.
 */
function pngWithTextChunk(source: Uint8Array, keyword: string): Uint8Array<ArrayBuffer> {
	const payload = Buffer.concat([Buffer.from('tEXt'), Buffer.from(`${keyword}\0`)]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(payload.byteLength - 4, 0);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(payload), 0);
	return Uint8Array.from(Buffer.concat([
		Buffer.from(source.slice(0, -12)),
		length,
		payload,
		checksum,
		Buffer.from(source.slice(-12)),
	]));
}

const pixelPng = pngWithTextChunk(basePixelPng, 'sk-broadcast-graphic-template-library');

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

const SOLID_SURFACE = {
	fill: { type: 'solid' as const, color: '#101014' },
	fillOpacity: 1,
};

/**
 * Graphic Items in the current schema. A stale item shape is rejected at Screen
 * creation with a 400, which reads as an unrelated failure.
 */
function shapeItem(id: string, overrides: Record<string, unknown> = {}) {
	return {
		type: 'shape' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 640,
		height: 120,
		geometry: SQUARE_GEOMETRY,
		surfaceStyle: SOLID_SURFACE,
		...overrides,
	};
}

function textItem(id: string, text: string) {
	return {
		type: 'text' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 24,
		y: 24,
		width: 560,
		height: 64,
		text,
		typography: {
			font: { kind: 'application', fontId: 'inter' },
			fontSize: 48,
			fontWeight: 700,
			fontStyle: 'normal' as const,
			textTransform: 'none' as const,
			letterSpacing: 0,
			lineHeight: 1.1,
			textAlign: 'left' as const,
			color: '#ffffff',
		},
		overflowPolicy: 'shrink' as const,
		minFontSize: 24,
	};
}

function mediaItem(id: string, asset?: { assetId: string; revisionId: string }) {
	return {
		type: 'media' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 0,
		width: 200,
		height: 200,
		mediaKind: 'image' as const,
		fit: 'cover' as const,
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
		...(asset ? { asset } : {}),
	};
}

function groupItem(id: string, children: unknown[], animation?: unknown) {
	return {
		type: 'group' as const,
		id,
		label: id,
		visible: true,
		anchor: 'top-left' as const,
		x: 0,
		y: 800,
		width: 900,
		height: 200,
		arrangement: 'row' as const,
		padding: 12,
		gap: 12,
		align: 'center' as const,
		justify: 'start' as const,
		clip: true,
		geometry: SQUARE_GEOMETRY,
		children,
		...(animation ? { animation } : {}),
	};
}

async function request(
	path: string,
	options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; data: any }> {
	const headers: Record<string, string> = {};
	if (options.cookie)
		headers.cookie = options.cookie;
	if (options.body !== undefined)
		headers['content-type'] = 'application/json';

	const response = await fetch(path, {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	return { status: response.status, data: text ? JSON.parse(text) : null };
}

/**
 * One Graphic Asset of this suite's own. `create-separate` with a per-run
 * idempotency key: the single-pixel PNG is ingested by other suites too, and an
 * ordinary ingestion that matches existing content reuses that asset by design —
 * which would mean sharing its lifecycle with a suite that retires it.
 */
async function ingestImage(
	eventId: number,
	name: string,
	cookie: string,
): Promise<{ assetId: string; revisionId: string }> {
	const initiated = await $fetch<GraphicsIngestionOperation>('/api/graphics-assets/ingestion-operations', {
		method: 'POST',
		headers: { cookie },
		body: graphicsIngestionRequest({
			idempotencyKey: `${name}-${runId}`,
			name,
			defaultEventId: eventId,
			browserDecodeEvidence: {
				outcome: 'decoded',
				sourceDigest: createHash('sha256').update(pixelPng).digest('hex'),
				width: 1,
				height: 1,
			},
			declaredByteLength: pixelPng.byteLength,
		}),
	});
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', headers: { cookie }, body: pixelPng },
	);
	const operation = await response.json() as GraphicsIngestionOperation;
	return { assetId: operation.result!.assetId, revisionId: operation.result!.revisionId };
}

const TEMPLATES_PATH = '/api/graphics-templates/broadcast-graphics';

describe('broadcast Graphic Template library', () => {
	let sourceEventId: number;
	let sourceScreenId: number;
	let otherEventId: number;
	let otherScreenId: number;
	let authorCookie: string;
	/**
	 * A second browser of the same operator (#398, ADR-0010).
	 *
	 * Every use below is about two concurrent *editors* — a lease held against one
	 * of them, a placement refused to the other, a revision written from under
	 * them — and a lease holder is a Better Auth session, not a person. Two
	 * different people would prove something weaker: it would pass against a lease
	 * held per user, which is the shape that lets one operator overwrite their own
	 * work from two windows.
	 */
	let secondBrowserCookie: string;
	let asset: { assetId: string; revisionId: string };
	let templateId: string;

	async function createEventWithGraphicsScreen(name: string, slug: string) {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name, game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		const screen = await $fetch<ScreenResponse>(`/api/events/${event.id}/screens`, {
			method: 'POST',
			body: { name, slug, currentMode: 'broadcast-graphics' },
		});
		return { eventId: event.id as number, screenId: screen.id };
	}

	async function authoredStack(eventId: number, screenId: number): Promise<BroadcastGraphicConfig[]> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return (screen.modeConfigs?.['broadcast-graphics']?.graphics ?? []) as BroadcastGraphicConfig[];
	}

	async function patchStack(eventId: number, screenId: number, graphics: unknown[]) {
		return await request(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
		});
	}

	function placementPath(eventId: number, screenId: number) {
		return `/api/events/${eventId}/screens/${screenId}/broadcast-graphics/placements`;
	}

	/** The Screen version a placement must state, read the way the editor reads it. */
	async function screenStateVersion(eventId: number, screenId: number): Promise<number> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return screen.stateVersion;
	}

	/** Place a template, stating the Screen version the caller has just read. */
	async function place(
		eventId: number,
		screenId: number,
		body: { templateId: string },
		cookie?: string,
	) {
		return await request(placementPath(eventId, screenId), {
			method: 'POST',
			cookie,
			body: { ...body, stateVersion: await screenStateVersion(eventId, screenId) },
		});
	}

	/** The revision a template write must state, read the way the library reads it. */
	async function templateRevision(id: string): Promise<number> {
		const current = await request(`${TEMPLATES_PATH}/${id}`, { cookie: authorCookie });
		return (current.data as BroadcastGraphicTemplateResponse).revision;
	}

	beforeAll(async () => {
		authorCookie = await operatorSessionCookie();
		secondBrowserCookie = await anotherBrowser();
		expect(authorCookie).not.toBe(secondBrowserCookie);

		const source = await createEventWithGraphicsScreen('Template Source Event', 'template-source-screen');
		sourceEventId = source.eventId;
		sourceScreenId = source.screenId;
		const other = await createEventWithGraphicsScreen('Template Target Event', 'template-target-screen');
		otherEventId = other.eventId;
		otherScreenId = other.screenId;

		asset = await ingestImage(sourceEventId, 'template-library-bug', authorCookie);

		// One authored Broadcast Graphic with everything a template has to carry: a
		// Graphic Group with children, a pinned Media Graphic Item, typed Graphic
		// Inputs, and the Graphic Source Selections and Bindings its author declared.
		const authored = await patchStack(sourceEventId, sourceScreenId, [{
			id: 'authored-lower-third',
			name: 'Lower third',
			items: [
				shapeItem('backing'),
				textItem('headline', 'Now playing: {player}'),
				groupItem(
					'badges',
					[mediaItem('bug', asset), shapeItem('rule', { width: 4, height: 80 })],
					{
						enter: { duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } },
						stagger: { enter: { order: 'reverse-list', step: 50, itemIds: ['bug', 'rule'] } },
					},
				),
			],
			// Graphic Animation on both containers, each staggering its own direct items.
			// A stale stagger id is ignored at projection rather than rejected, so a
			// placement that failed to rewrite these would silently lose the choreography.
			animation: {
				enter: { duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
				stagger: { enter: { order: 'list', step: 80, itemIds: ['headline', 'backing'] } },
			},
			inputs: [{
				type: 'text',
				key: 'player',
				label: 'Player',
				required: true,
				updatePolicy: 'staged',
				default: 'Reid Duke',
				maxLength: 40,
			}],
			sources: [{ key: 'player', label: 'Player', kind: 'player' }],
			bindings: [{ inputKey: 'player', sourceKey: 'player', fieldId: 'player.name' }],
		}]);
		expect(authored.status).toBe(200);
	});

	afterAll(async () => {
		try {
			if (templateId)
				await request(`${TEMPLATES_PATH}/${templateId}`, { method: 'DELETE', cookie: authorCookie });
		}
		catch {}
		for (const eventId of [sourceEventId, otherEventId]) {
			try {
				await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
			}
			catch {}
		}
	});

	it('saves a placed Broadcast Graphic as a template with a stable identity and revision 1', async () => {
		const saved = await request(TEMPLATES_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId: sourceEventId, screenId: sourceScreenId, graphicId: 'authored-lower-third' },
				description: 'Main show lower third',
			},
		});

		expect(saved.status).toBe(201);
		const template = saved.data as BroadcastGraphicTemplateResponse;
		expect(template.id).toEqual(expect.any(String));
		expect(template.name).toBe('Lower third');
		expect(template.description).toBe('Main show lower third');
		expect(template.revision).toBe(1);
		expect(template.document.items.map(item => item.id)).toEqual(['backing', 'headline', 'badges']);
		templateId = template.id;
	});

	/*
	 * The refusal for a caller with no session at all is the API boundary's since
	 * #398, composed around every `/api/**` route before any handler runs, and it
	 * is proved against a genuinely anonymous client in `apiBoundary.test.ts`.
	 * This suite's client is signed in, so asserting it here would mean sending a
	 * request a different way to test a middleware this file is not about.
	 */

	it('reports a Broadcast Graphic the Screen does not carry as not found', async () => {
		const missing = await request(TEMPLATES_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: { source: { eventId: sourceEventId, screenId: sourceScreenId, graphicId: 'never-authored' } },
		});

		expect(missing.status).toBe(404);
	});

	it('browses the library from any Event in the installation', async () => {
		const listed = await request(TEMPLATES_PATH, { cookie: authorCookie });

		expect(listed.status).toBe(200);
		const summaries = listed.data.templates as BroadcastGraphicTemplateSummary[];
		const saved = summaries.find(summary => summary.id === templateId);
		expect(saved).toMatchObject({ name: 'Lower third', revision: 1, itemCount: 5, inputCount: 1 });
		// A library listing is a browse, not a download: the composition itself is not
		// in it.
		expect(saved).not.toHaveProperty('document');
	});

	it('places a template on a Screen in a different Event as a new Broadcast Graphic', async () => {
		const placed = await place(otherEventId, otherScreenId, { templateId }, authorCookie);

		expect(placed.status).toBe(201);
		const graphic = placed.data.graphic as BroadcastGraphicConfig;
		expect(graphic.name).toBe('Lower third');
		expect(graphic.id).not.toBe('authored-lower-third');

		const stack = await authoredStack(otherEventId, otherScreenId);
		expect(stack.map(entry => entry.id)).toEqual([graphic.id]);
	});

	it('regenerates every Graphic Item id so two copies coexist in one Screen document', async () => {
		const second = await place(otherEventId, otherScreenId, { templateId }, authorCookie);

		expect(second.status).toBe(201);
		const stack = await authoredStack(otherEventId, otherScreenId);
		expect(stack).toHaveLength(2);

		const itemIds = stack.flatMap(graphic => graphic.items.flatMap(item => [
			item.id,
			...(item.type === 'group' ? item.children.map(child => child.id) : []),
		]));
		expect(new Set(itemIds).size).toBe(itemIds.length);
		expect(itemIds).not.toContain('backing');
		expect(itemIds).not.toContain('bug');
		// A second copy in the same Screen is named distinctly rather than duplicated.
		expect(stack.map(graphic => graphic.name)).toEqual(['Lower third', 'Lower third (2)']);
	});

	it('rewrites every staggered Graphic Item id onto the placed copy', async () => {
		const [placed] = await authoredStack(otherEventId, otherScreenId);

		const graphicStagger = placed!.animation!.stagger!.enter!;
		const [backing, headline] = placed!.items.map(item => item.id);
		// `itemIds` is the *selection* of staggered items; the sequence comes from the
		// container's list order restricted to it, then reversed for `reverse-list`. So
		// this asserts each authored entry's mapping, entry by entry — the array's own
		// order carries no behaviour and is preserved only because rewriting it in place
		// is the simplest correct thing to do.
		expect(graphicStagger.itemIds).toEqual([headline, backing]);
		expect(graphicStagger.step).toBe(80);

		const group = placed!.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('expected the placed copy to carry the Graphic Group');
		expect(group.animation!.stagger!.enter!.itemIds)
			.toEqual(group.children.map(child => child.id));

		// No authored id survives anywhere, which is what a stale stagger would be:
		// silently ignored, every staggered item animating together at offset zero.
		const staggered = [
			...graphicStagger.itemIds,
			...group.animation!.stagger!.enter!.itemIds,
		];
		for (const authored of ['backing', 'headline', 'badges', 'bug', 'rule'])
			expect(staggered).not.toContain(authored);
	});

	it('carries each Graphic Input default as the placed copy\'s own initial manual value', async () => {
		const [placed] = await authoredStack(otherEventId, otherScreenId);

		expect(placed!.inputs).toEqual([{
			type: 'text',
			key: 'player',
			label: 'Player',
			required: true,
			updatePolicy: 'staged',
			default: 'Reid Duke',
			maxLength: 40,
		}]);
		expect(placed!.sources).toEqual([{ key: 'player', label: 'Player', kind: 'player' }]);
		expect(placed!.bindings).toEqual([
			{ inputKey: 'player', sourceKey: 'player', fieldId: 'player.name' },
		]);
	});

	it('places an authored Graphic Asset Reference its Screen Output can resolve', async () => {
		const stack = await authoredStack(otherEventId, otherScreenId);
		const placedMedia = stack[0]!.items
			.flatMap(item => item.type === 'group' ? item.children : [])
			.find(child => child.type === 'media') as MediaGraphicItemConfig;

		expect(placedMedia.asset).toEqual(asset);

		// Authored, therefore indexed, therefore inside the Screen's own Screen Output
		// Asset Capability. The capability is derived from what the Screen's
		// configuration publishes, so a placement that produced anything other than an
		// authored reference would leave the graphic's media unresolvable on air.
		const { assetCapability } = await $fetch<{ assetCapability: string }>(
			`/api/events/${otherEventId}/screens/${otherScreenId}/asset-capability`,
			{ headers: { cookie: authorCookie } },
		);
		const delivered = await fetch(
			`/api/screen-output/screens/${otherScreenId}/assets/${placedMedia.asset!.assetId}/revisions/${placedMedia.asset!.revisionId}/content`,
			{ headers: { authorization: `Bearer ${assetCapability}` } },
		);
		expect(delivered.status).toBe(200);

		// Still not a library-browsing hole: an asset this Screen publishes nothing of
		// stays invisible to its outputs.
		const unreferenced = await ingestImage(otherEventId, 'template-library-unplaced', authorCookie);
		const refused = await fetch(
			`/api/screen-output/screens/${otherScreenId}/assets/${unreferenced.assetId}/revisions/${unreferenced.revisionId}/content`,
			{ headers: { authorization: `Bearer ${assetCapability}` } },
		);
		expect(refused.status).toBe(404);
	});

	/**
	 * Inspecting usage is how an author learns what retiring or trashing an asset
	 * would break, and a template is one of the things it would break. The library
	 * already names every other owner kind that has a name; an owner reported with no
	 * name at all is an entry the author cannot go and look at, which is the one thing
	 * the usage listing exists to prevent.
	 */
	it('names the Broadcast Graphic Template that pins an asset in its usage', async () => {
		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${asset.assetId}/usage`,
			{ headers: { cookie: authorCookie } },
		);

		expect(usage).toContainEqual(expect.objectContaining({
			reference: asset,
			owner: expect.objectContaining({
				kind: 'broadcast-graphic-template',
				id: templateId,
				name: 'Lower third',
			}),
		}));
	});

	it('leaves a placed copy and its template with no live coupling in either direction', async () => {
		const before = await authoredStack(otherEventId, otherScreenId);
		const placed = structuredClone(before[0]!);

		// Editing the placed copy changes nothing about the template. The Graphic Source
		// Selections and Graphic Input Bindings are edited here rather than only asserted
		// structurally, because "independently editable" is the acceptance criterion and
		// a copy that merely holds its own objects in memory has not shown it: this goes
		// through the Screen's mode-config write path, so what is re-read below is what
		// the database stored.
		placed.name = 'Renamed on the Screen';
		placed.items = placed.items.slice(0, 1);
		// Deleting an item takes it out of the container's staggered subsets, which is
		// what `deleteGraphicItem` does and what the write path now requires: a stagger
		// names no more items than its container holds. Truncating the list without it
		// builds a document no authoring operation produces.
		placed.animation = {
			...placed.animation,
			stagger: undefined,
		} as typeof placed.animation;
		placed.inputs = [{ ...(placed.inputs![0] as any), default: 'Local value' }];
		placed.sources = [{ key: 'player', label: 'Featured player', kind: 'player' }];
		placed.bindings = [{ inputKey: 'player', sourceKey: 'player', fieldId: 'player.pronouns' }];
		expect((await patchStack(otherEventId, otherScreenId, [placed, before[1]!])).status).toBe(200);

		const template = await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie });
		expect(template.status).toBe(200);
		const document = (template.data as BroadcastGraphicTemplateResponse).document;
		expect(document.name).toBe('Lower third');
		expect(document.items).toHaveLength(3);
		expect(document.inputs![0]!.default).toBe('Reid Duke');
		// The template kept the source and binding it was authored with.
		expect(document.sources).toEqual([{ key: 'player', label: 'Player', kind: 'player' }]);
		expect(document.bindings)
			.toEqual([{ inputKey: 'player', sourceKey: 'player', fieldId: 'player.name' }]);

		// And the copy's own edits survived the round trip rather than being silently
		// dropped by a write path that does not carry them.
		const edited = (await authoredStack(otherEventId, otherScreenId))[0]!;
		expect(edited.sources).toEqual([{ key: 'player', label: 'Featured player', kind: 'player' }]);
		expect(edited.bindings)
			.toEqual([{ inputKey: 'player', sourceKey: 'player', fieldId: 'player.pronouns' }]);

		// Revising the template changes nothing about the copies already placed.
		const revised = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: {
				name: 'Lower third v2',
				// Truncating the item list drops the staggered subset with it, the way
				// `deleteGraphicItem` does: a stagger names no more items than its
				// container holds.
				document: { ...document, items: document.items.slice(0, 1), animation: { ...document.animation, stagger: undefined } },
				revision: await templateRevision(templateId),
			},
		});
		expect(revised.status).toBe(200);
		expect((revised.data as BroadcastGraphicTemplateResponse).revision).toBe(2);

		const after = await authoredStack(otherEventId, otherScreenId);
		expect(after[0]!.name).toBe('Renamed on the Screen');
		expect(after[1]!.name).toBe('Lower third (2)');
		expect(after[1]!.items).toHaveLength(3);
	});

	it('leases one template at a time and refuses a second session\'s edit', async () => {
		const leasePath = `${TEMPLATES_PATH}/${templateId}/graphics-authoring-lease`;

		const held = await request(leasePath, { method: 'POST', body: {}, cookie: authorCookie });
		expect(held.status).toBe(200);
		expect(held.data.outcome).toBe('grant');
		expect(held.data.lease.artifact).toEqual({ kind: 'graphics-template', id: templateId });

		const observing = await request(leasePath, { method: 'POST', body: {}, cookie: secondBrowserCookie });
		expect(observing.data.outcome).toBe('observe');
		expect(observing.data.lease.writable).toBe(false);

		const revision = await templateRevision(templateId);
		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: secondBrowserCookie,
			body: { description: 'Taken from under the holder', revision },
		});
		expect(refused.status).toBe(409);

		const accepted = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { description: 'Revised by the holder', revision },
		});
		expect(accepted.status).toBe(200);
		expect((accepted.data as BroadcastGraphicTemplateResponse).revision).toBe(3);

		expect((await request(leasePath, { method: 'DELETE', cookie: authorCookie })).status).toBe(200);
	});

	it('refuses a template document that is not a valid Broadcast Graphic', async () => {
		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: {
				document: { id: 'x', name: 'x', items: [{ type: 'text', id: 'a' }] },
				revision: await templateRevision(templateId),
			},
		});

		expect(refused.status).toBe(400);
	});

	it('refuses two Graphic Items with the same id in a template document', async () => {
		const current = await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie });
		const document = (current.data as BroadcastGraphicTemplateResponse).document;

		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: {
				document: { ...document, items: [document.items[0]!, document.items[0]!] },
				revision: await templateRevision(templateId),
			},
		});

		expect(refused.status).toBe(400);
	});

	it('reports placing a template that does not exist as not found', async () => {
		const missing = await place(otherEventId, otherScreenId, { templateId: randomUUID() }, authorCookie);

		expect(missing.status).toBe(404);
	});

	it('refuses to place a template on a Screen that is not in Broadcast Graphics mode', async () => {
		const idle = await $fetch<ScreenResponse>(`/api/events/${otherEventId}/screens`, {
			method: 'POST',
			body: { name: 'Idle', slug: 'template-idle-screen', currentMode: 'idle' },
		});

		const refused = await place(otherEventId, idle.id, { templateId }, authorCookie);

		expect(refused.status).toBe(409);
	});

	it('refuses a placement from a session that does not hold the Screen\'s Edit workspace lease', async () => {
		const screenLease = `/api/events/${otherEventId}/screens/${otherScreenId}/graphics-authoring-lease`;
		expect((await request(screenLease, { method: 'POST', body: {}, cookie: authorCookie })).data.outcome)
			.toBe('grant');

		const refused = await place(otherEventId, otherScreenId, { templateId }, secondBrowserCookie);
		expect(refused.status).toBe(409);

		expect((await request(screenLease, { method: 'DELETE', cookie: authorCookie })).status).toBe(200);
	});

	it('refuses a revision built on a stale one, naming the revision that exists', async () => {
		const stale = await templateRevision(templateId);

		const accepted = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { description: 'First writer wins', revision: stale },
		});
		expect(accepted.status).toBe(200);

		// The other window had the library open and never saw the revision above.
		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: secondBrowserCookie,
			body: { description: 'Second writer overwrites', revision: stale },
		});

		expect(refused.status).toBe(409);
		expect(refused.data.message).toContain(`revision ${stale + 1}`);
		const after = await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie });
		expect((after.data as BroadcastGraphicTemplateResponse).description).toBe('First writer wins');
	});

	it('refuses a revision that states no revision at all', async () => {
		// An omissible precondition is an inert one: if saying nothing meant "do not
		// check", every caller that forgot would get an unguarded last-write-wins.
		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { description: 'Stated no revision' },
		});

		expect(refused.status).toBe(400);
	});

	it('refuses a placement that states no Screen version at all', async () => {
		const refused = await request(placementPath(otherEventId, otherScreenId), {
			method: 'POST',
			cookie: authorCookie,
			body: { templateId },
		});

		expect(refused.status).toBe(400);
	});

	it('refuses a placement built on a stale Screen version', async () => {
		const stale = await screenStateVersion(otherEventId, otherScreenId);
		// Another author reorders the stack in the meantime.
		const stack = await authoredStack(otherEventId, otherScreenId);
		expect((await patchStack(otherEventId, otherScreenId, [...stack].reverse())).status).toBe(200);

		const refused = await request(placementPath(otherEventId, otherScreenId), {
			method: 'POST',
			cookie: authorCookie,
			body: { templateId, stateVersion: stale },
		});

		// Without the guard this would have written the whole stack back from a copy
		// taken before the reorder, silently undoing it.
		expect(refused.status).toBe(409);
		expect((await authoredStack(otherEventId, otherScreenId)).map(entry => entry.name))
			.toEqual([...stack].reverse().map(entry => entry.name));
	});

	it('reports a lease on a template that does not exist as not found', async () => {
		const missing = await request(`${TEMPLATES_PATH}/${randomUUID()}/graphics-authoring-lease`, {
			method: 'POST',
			body: {},
			cookie: authorCookie,
		});

		// A lease on nothing could never be discovered or released by anybody.
		expect(missing.status).toBe(404);
	});

	it('refuses an observer\'s deletion of a leased template', async () => {
		const leasePath = `${TEMPLATES_PATH}/${templateId}/graphics-authoring-lease`;
		expect((await request(leasePath, { method: 'POST', body: {}, cookie: authorCookie })).data.outcome)
			.toBe('grant');

		const refused = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'DELETE',
			cookie: secondBrowserCookie,
		});
		expect(refused.status).toBe(409);
		expect((await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie })).status).toBe(200);

		expect((await request(leasePath, { method: 'DELETE', cookie: authorCookie })).status).toBe(200);
	});

	it('refuses to save a template whose Graphic Asset Revision does not exist', async () => {
		// A Screen cannot normally hold one — its write path checks a newly chosen
		// reference — so this is written straight into the stack the way an unlucky
		// migration or a future import could.
		const invented = { assetId: randomUUID(), revisionId: randomUUID() };
		const screen = await $fetch<ScreenResponse>(`/api/events/${sourceEventId}/screens`, {
			method: 'POST',
			body: { name: 'Phantom', slug: 'template-phantom-screen', currentMode: 'broadcast-graphics' },
		});
		const phantomConfig = JSON.stringify({
			'broadcast-graphics': {
				graphics: [{
					id: 'phantom-graphic',
					name: 'Phantom',
					items: [mediaItem('ghost', invented)],
				}],
			},
		}).replace(/'/g, '\'\'');
		await executeIntegrationD1(
			`UPDATE screens SET mode_configs = '${phantomConfig}' WHERE id = ${screen.id}`,
		);

		const refused = await request(TEMPLATES_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: { source: { eventId: sourceEventId, screenId: screen.id, graphicId: 'phantom-graphic' } },
		});

		// Storing it would put a healthy-looking entry in the library whose reference
		// index records nothing, so nothing is diagnosable until a placement fails.
		expect(refused.status).toBe(409);
		expect(refused.data.message).toContain('do not exist');

		const listed = await request(TEMPLATES_PATH, { cookie: authorCookie });
		expect((listed.data.templates as BroadcastGraphicTemplateSummary[]).map(entry => entry.name))
			.not
			.toContain('Phantom');
	});

	it('refuses to place a template whose Graphic Asset has been retired, naming the template Graphic Item', async () => {
		const retiredAsset = await ingestImage(sourceEventId, 'template-library-retired', authorCookie);
		const sourceScreen = await $fetch<ScreenResponse>(`/api/events/${sourceEventId}/screens`, {
			method: 'POST',
			body: { name: 'Retiring', slug: 'template-retiring-screen', currentMode: 'broadcast-graphics' },
		});
		expect((await patchStack(sourceEventId, sourceScreen.id, [{
			id: 'retiring-graphic',
			name: 'Retiring bug',
			items: [mediaItem('brand-bug', retiredAsset)],
		}])).status).toBe(200);

		const saved = await request(TEMPLATES_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId: sourceEventId, screenId: sourceScreen.id, graphicId: 'retiring-graphic' },
			},
		});
		expect(saved.status).toBe(201);
		const retiringTemplateId = (saved.data as BroadcastGraphicTemplateResponse).id;

		await $fetch(`/api/graphics-assets/${retiredAsset.assetId}/lifecycle-actions`, {
			method: 'POST',
			headers: { cookie: authorCookie },
			body: { action: 'retire' },
		});

		const refused = await place(otherEventId, otherScreenId, { templateId: retiringTemplateId }, authorCookie);

		// The Screen's write path refuses a reference that is not selectable now. What
		// matters here is that the operator can act on the refusal: it names the design
		// and the Graphic Item *in the template*, not the ids placement generated for a
		// Broadcast Graphic that was never written.
		expect(refused.status).toBe(409);
		expect(refused.data.message).toContain('Retiring bug');
		expect(refused.data.message).toContain('brand-bug');
		expect(refused.data.message).toContain('retiring-graphic');

		await request(`${TEMPLATES_PATH}/${retiringTemplateId}`, { method: 'DELETE', cookie: authorCookie });
	});

	it('removes a template from the library without touching the copies placed from it', async () => {
		const removed = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'DELETE',
			cookie: authorCookie,
		});
		expect(removed.status).toBe(204);

		expect((await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie })).status).toBe(404);
		expect((await authoredStack(otherEventId, otherScreenId))).toHaveLength(2);

		const listed = await request(TEMPLATES_PATH, { cookie: authorCookie });
		expect((listed.data.templates as BroadcastGraphicTemplateSummary[]).map(entry => entry.id))
			.not
			.toContain(templateId);
	});
});

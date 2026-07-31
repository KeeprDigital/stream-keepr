import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicTemplateListResponse,
	BroadcastGraphicTemplateResponse,
} from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRAPHIC_ITEM_KINDS } from '../../shared/modules/graphics/itemDefinitions';
import { maximalBroadcastGraphicDocument } from '../helpers/broadcastGraphicDocument';
import { collectStream } from '../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../helpers/templatePackageArchive';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

/**
 * A Broadcast Graphic Template travelling as a `.skgraphic` Template Package,
 * through the real API from end to end.
 *
 * The behaviour under test is the one the operator actually cares about: a design
 * saved in the library here is exported, received back as a package, and appears in
 * the library as an entry that can be browsed, placed, and edited exactly like one
 * authored here — carrying where it came from and nothing that links it back there.
 *
 * Export and import run against the same installation on purpose. A separate
 * receiver would prove the asset-mapping rules over again, which the Graphics Asset
 * Library's own suites already pin; running here instead makes every packaged asset
 * an exact Graphic Asset Origin match, which is what lets the imported document be
 * compared to the exported one *whole*, with nothing legitimately different in it.
 */

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

/** Appends a valid ancillary text chunk so this suite owns a distinct digest. */
function pngWithTextChunk(source: Uint8Array, keyword: string): Uint8Array {
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

const pixelPng = pngWithTextChunk(basePixelPng, 'sk-broadcast-graphic-template-packages');
const runId = randomUUID();
const TEMPLATES_PATH = '/api/graphics-templates/broadcast-graphics';

let packageSequence = 0;

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

async function receivePackage(archive: Uint8Array) {
	const initiated = await $fetch<GraphicsIngestionOperation>(
		'/api/graphics-assets/ingestion-operations',
		{
			method: 'POST',
			body: {
				idempotencyKey: `skgraphic-package-${runId}-${++packageSequence}`,
				source: 'template-package',
				sourceFileName: 'lower-third.skgraphic',
				declaredByteLength: archive.byteLength,
			},
		},
	);
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{ method: 'PUT', body: archive },
	);
	expect(response.status).toBe(200);
	return await response.json() as GraphicsIngestionOperation;
}

async function installPackage(operationId: string) {
	return await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${operationId}/template-package-installation`,
		{ method: 'POST' },
	);
}

describe('broadcast Graphic Template Packages', () => {
	let eventId: number;
	let screenId: number;
	let authorCookie: string;
	let asset: { assetId: string; revisionId: string };
	let sourceTemplate: BroadcastGraphicTemplateResponse;
	let exportedPackage: Uint8Array;
	const installedTemplateIds: string[] = [];

	beforeAll(async () => {
		authorCookie = await createGraphicsAuthorSessionCookie();
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Template Package Round Trip',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Package Round Trip',
				slug: 'package-round-trip',
				currentMode: 'broadcast-graphics',
			},
		});
		screenId = screen.id;

		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				body: {
					idempotencyKey: `skgraphic-package-source-${runId}`,
					name: 'Package round trip backdrop',
					defaultEventId: eventId,
					duplicateContentPolicy: 'create-separate',
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
		const uploaded = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', body: pixelPng },
		);
		const operation = await uploaded.json() as GraphicsIngestionOperation;
		asset = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};

		// Everything the vocabulary allows, so the round trip has something to lose.
		const authored = await request(
			`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`,
			{
				method: 'PATCH',
				body: { graphics: [maximalBroadcastGraphicDocument({ id: 'packaged-lower-third', asset })] },
			},
		);
		expect(authored.status).toBe(200);

		const saved = await request(TEMPLATES_PATH, {
			method: 'POST',
			cookie: authorCookie,
			body: {
				source: { eventId, screenId, graphicId: 'packaged-lower-third' },
				name: `Packaged lower third ${runId}`,
				description: 'Travels between installations',
			},
		});
		expect(saved.status).toBe(201);
		sourceTemplate = saved.data as BroadcastGraphicTemplateResponse;

		const exported = await fetch(`${TEMPLATES_PATH}/${sourceTemplate.id}/template-package`, {
			headers: { cookie: authorCookie },
		});
		expect(exported.status).toBe(200);
		exportedPackage = await collectStream(exported.body!);
	});

	afterAll(async () => {
		for (const id of [sourceTemplate?.id, ...installedTemplateIds]) {
			if (!id)
				continue;
			try {
				await request(`${TEMPLATES_PATH}/${id}`, { method: 'DELETE', cookie: authorCookie });
			}
			catch {}
		}
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('exports the library entry as a self-contained package naming its identity and revision', async () => {
		const parts = readTemplatePackageParts(exportedPackage);

		expect(parts.manifest.packageKind).toBe('skgraphic');
		expect(parts.manifest.template.identity).toBe(sourceTemplate.id);
		expect(parts.manifest.template.revision).toBe(sourceTemplate.revision);
		// Only what this one design transitively requires — one Media Graphic Item's
		// exact revision, and nothing else the library holds.
		expect(parts.manifest.packagedAssets).toHaveLength(1);
		expect(parts.manifest.packagedAssets[0]!.origin).toMatchObject({
			sourceAssetId: asset.assetId,
			sourceRevisionId: asset.revisionId,
		});
		expect(parts.contents).toHaveLength(1);
		// Application-owned capabilities are declared, never duplicated into bytes:
		// every Graphic Item Definition the design uses, plus the application font it
		// names. Compared against the shared vocabulary so this also pins that the
		// design still exercises every kind.
		expect(parts.manifest.applicationCapabilities.map(entry => entry.identity).sort())
			.toEqual([...GRAPHIC_ITEM_KINDS, 'inter'].sort());
	});

	/**
	 * The guard against a copy that enumerates what to keep.
	 *
	 * Export writes a document into a package and import reads one back, and either
	 * crossing can drop a field added to the vocabulary after it was written. Across
	 * an installation boundary the loss is invisible — a dropped field looks exactly
	 * like one the sender never had — and the bytes that travelled are already wrong
	 * by the time anyone notices, so re-exporting repairs nothing. Comparing a
	 * maximally populated document whole is what turns that into a failing test.
	 *
	 * It catches a field the *transfer* drops, not a field the vocabulary grew: the
	 * fixture is hand-enumerated, so a new field nobody added there is carried by a
	 * document that never had it. `maximalBroadcastGraphicDocument` says why it
	 * cannot be derived from the schema instead.
	 */
	it('imports the design as a library entry carrying every field it left with', async () => {
		const received = await receivePackage(exportedPackage);
		expect(received.stage).toBe('awaiting-installation');

		const completed = await installPackage(received.id);

		expect(completed.stage).toBe('completed');
		const installation = completed.templatePackageInstallation!;
		installedTemplateIds.push(installation.templateId);
		expect(installation.templateKind).toBe('broadcast-graphic');

		const imported = await request(`${TEMPLATES_PATH}/${installation.templateId}`, {
			cookie: authorCookie,
		});
		expect(imported.status).toBe(200);
		const copy = imported.data as BroadcastGraphicTemplateResponse;

		// Every packaged asset was an exact Graphic Asset Origin match, so the
		// rewritten references land on the very revisions the design left with and
		// nothing in the document is legitimately different.
		expect(copy.document).toEqual(sourceTemplate.document);
	});

	it('imports an unlinked copy that keeps its source only as provenance', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const copy = (await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateResponse;

		expect(copy.id).not.toBe(sourceTemplate.id);
		// Its own managed revision starts fresh; the source's identity and revision
		// are recorded beside it and are never what this entry counts from.
		expect(copy.revision).toBe(1);
		expect(copy.provenance).toEqual({
			sourceTemplateIdentity: sourceTemplate.id,
			sourceTemplateRevision: sourceTemplate.revision,
		});

		// The source is untouched by the import, and nothing about the copy reaches it.
		const source = (await request(`${TEMPLATES_PATH}/${sourceTemplate.id}`, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateResponse;
		expect(source.revision).toBe(sourceTemplate.revision);
		expect(source.name).toBe(sourceTemplate.name);
		expect(source.provenance).toBeUndefined();
		expect(source.authored).toBe(true);
	});

	it('lists an imported design alongside the ones authored here', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const listed = (await request(TEMPLATES_PATH, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateListResponse;

		// One library, one listing. Where a design came from is a property of the
		// entry, not a reason for an author to look somewhere else for it.
		const entry = listed.templates.find(template => template.id === templateId);
		expect(entry).toMatchObject({ authored: false, name: sourceTemplate.name });
		expect(entry!.itemCount).toBe(
			listed.templates.find(template => template.id === sourceTemplate.id)!.itemCount,
		);
	});

	/**
	 * An imported design is the Graphics Asset Library's own record of what a
	 * Template Package published — the very record whose Graphic Asset References
	 * pin the revisions it needs. This library reads it and never writes it, so a
	 * revision or a deletion here is refused rather than half-applied.
	 *
	 * The refusal is a `409` naming the way forward, not a `404`: the design is
	 * visible in the library, and reporting it missing would be false about
	 * something the author is looking straight at.
	 */
	it('refuses to revise or delete an imported design, and says what to do instead', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const revised = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'PATCH',
			cookie: authorCookie,
			body: { name: `Renamed import ${runId}`, revision: 1 },
		});
		expect(revised.status).toBe(409);
		expect(revised.data.message).toContain('Place it on a Screen and save the placed copy');

		const deleted = await request(`${TEMPLATES_PATH}/${templateId}`, {
			method: 'DELETE',
			cookie: authorCookie,
		});
		expect(deleted.status).toBe(409);

		// And it is still there, unchanged, rather than partly acted upon.
		const still = (await request(`${TEMPLATES_PATH}/${templateId}`, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateResponse;
		expect(still.name).toBe(sourceTemplate.name);
		expect(still.revision).toBe(1);
	});

	it('exports an imported design again, so it is not stranded where it landed', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const exported = await fetch(`${TEMPLATES_PATH}/${templateId}/template-package`, {
			headers: { cookie: authorCookie },
		});
		expect(exported.status).toBe(200);
		const parts = readTemplatePackageParts(await collectStream(exported.body!));

		// The re-export names *this* installation's Template, not the one it came
		// from: a package carries the identity of the design it contains, and an
		// import produced a design this installation owns the identity of.
		expect(parts.manifest.template.identity).toBe(templateId);
		expect(parts.manifest.template.revision).toBe(1);
	});

	it('places an imported design on a Screen like any other library entry', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		const placed = await request(
			`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/placements`,
			{
				method: 'POST',
				cookie: authorCookie,
				body: { templateId, stateVersion: screen.stateVersion },
			},
		);

		expect(placed.status).toBe(201);
		const graphic = placed.data.graphic as BroadcastGraphicConfig;
		// A placement is a copy in its own right: fresh identities, and no trace of
		// the template or the installation it came from.
		expect(graphic.id).not.toBe(templateId);
		expect(graphic.items).toHaveLength(sourceTemplate.document.items.length);
	});

	/**
	 * The installation endpoint invites retries, so adoption has to be idempotent
	 * over the installation that already committed. A second library entry would be
	 * a second design an author has to tell apart from the first, and a second set of
	 * Graphic Asset References claiming the same revisions.
	 */
	it('answers a repeated installation with the entry that already exists', async () => {
		const received = await receivePackage(exportedPackage);
		const completed = await installPackage(received.id);
		const templateId = completed.templatePackageInstallation!.templateId;
		installedTemplateIds.push(templateId);

		const before = (await request(TEMPLATES_PATH, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateListResponse;

		const repeated = await installPackage(received.id);

		expect(repeated.templatePackageInstallation).toEqual(completed.templatePackageInstallation);
		const after = (await request(TEMPLATES_PATH, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateListResponse;
		expect(after.templates).toHaveLength(before.templates.length);
	});

	/**
	 * Spec user story 44, proved through the wiring the application actually runs.
	 * The refusal lands at Template Package Preflight, so no library entry, asset,
	 * origin, or reference is ever created for the package that carried it.
	 */
	it('refuses a Graphic Item Definition configuration version it does not implement, installing nothing', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.identity === 'media'
				? { ...declaration, configurationVersion: 99 }
				: declaration,
		);
		const before = (await request(TEMPLATES_PATH, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateListResponse;

		const received = await receivePackage(writeTemplatePackage(parts));

		expect(received.stage).toBe('failed');
		expect(received.templatePackagePreflight!.outcome).toBe('rejected');
		expect(received.templatePackagePreflight!.issues.some(issue =>
			issue.code === 'unsupported-application-capability',
		)).toBe(true);

		const after = (await request(TEMPLATES_PATH, { cookie: authorCookie }))
			.data as BroadcastGraphicTemplateListResponse;
		expect(after.templates).toHaveLength(before.templates.length);
	});
});

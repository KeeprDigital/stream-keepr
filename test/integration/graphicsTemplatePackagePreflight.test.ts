import type { GraphicsIngestionOperation } from '../../shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { TEMPLATE_PACKAGE_LIMITS, templatePackageContentEntry } from '../../shared/types/templatePackage';
import { MAX_STILL_IMAGE_INGESTION_BYTES } from '../../shared/utils/graphicsAssetCompatibility';
import { testGraphicAssetRevisionId } from '../helpers/graphicsAssetIdentities';
import { collectStream } from '../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../helpers/templatePackageArchive';
import {
	createGraphicsAuthorSessionCookie,
	suiteGraphicsAuthorSessionCookie,
} from './graphicsAuthorSession';
import { graphicsIngestionRequest } from './graphicsIngestionRequest';
import { libraryAssets } from './graphicsLibraryListing';

const basePixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

/** Appends a valid ancillary text chunk so this suite owns a distinct digest. */
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

const packagePixelPng = pngWithTextChunk(basePixelPng, 'sk-template-package-preflight');

/**
 * A valid PNG of an exact length, padded inside one ancillary text chunk.
 *
 * It exists so a package can be built that is larger than a single Graphic Asset
 * transfer may carry while the one asset inside it stays within the still-image
 * limit — which is the shape of every real package carrying media.
 */
function pngPaddedTo(byteLength: number, keyword: string): Uint8Array<ArrayBuffer> {
	const heading = Buffer.from(`tEXt${keyword}\0`);
	const payload = Buffer.concat([
		heading,
		Buffer.alloc(byteLength - basePixelPng.byteLength - heading.byteLength - 8, 0x61),
	]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(payload.byteLength - 4, 0);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(payload), 0);
	return Uint8Array.from(Buffer.concat([
		Buffer.from(basePixelPng.slice(0, -12)),
		length,
		payload,
		checksum,
		Buffer.from(basePixelPng.slice(-12)),
	]));
}

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

let preflightSequence = 0;

/** Runs one package through the raw transfer route and returns the operation. */
async function receivePackage(archive: Uint8Array<ArrayBuffer>, options: { fileName?: string } = {}) {
	const initiated = await $fetch<GraphicsIngestionOperation>(
		'/api/graphics-assets/ingestion-operations',
		{
			method: 'POST',
			headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
			body: {
				idempotencyKey: `template-package-preflight-${++preflightSequence}`,
				source: 'template-package',
				sourceFileName: options.fileName ?? 'exportable-overlay.sklayout',
				declaredByteLength: archive.byteLength,
			},
		},
	);
	const response = await fetch(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
		{
			method: 'PUT',
			headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
			body: archive,
		},
	);
	expect(response.status).toBe(200);
	return await response.json() as GraphicsIngestionOperation;
}

/**
 * Runs one package through the resumable transfer, which is the only way an
 * archive longer than a single request may arrive.
 */
async function receivePackageInParts(archive: Uint8Array, options: { fileName?: string } = {}) {
	const initiated = await $fetch<GraphicsIngestionOperation>(
		'/api/graphics-assets/ingestion-operations',
		{
			method: 'POST',
			headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
			body: {
				idempotencyKey: `template-package-preflight-${++preflightSequence}`,
				source: 'template-package',
				sourceFileName: options.fileName ?? 'exportable-overlay.sklayout',
				declaredByteLength: archive.byteLength,
			},
		},
	);
	const authorHeaders = { cookie: await suiteGraphicsAuthorSessionCookie() };
	const started = await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart`,
		{ method: 'POST', headers: authorHeaders },
	);
	const transfer = started.transfer!;
	for (let partNumber = 1; partNumber <= transfer.partCount; partNumber += 1) {
		const offset = (partNumber - 1) * transfer.partByteLength;
		const response = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/parts/${partNumber}`,
			{
				method: 'PUT',
				headers: authorHeaders,
				body: archive.slice(offset, Math.min(archive.byteLength, offset + transfer.partByteLength)),
			},
		);
		expect(response.status).toBe(200);
	}
	return await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${initiated.id}/multipart/complete`,
		{ method: 'POST', headers: authorHeaders },
	);
}

describe('template Package preflight through the API boundary', () => {
	let eventId: number;
	let screenId: number;
	let reference: { assetId: string; revisionId: string };
	let exportedPackage: Uint8Array<ArrayBuffer>;
	/** Every ingestion route resolves the author from the session, so one suite-wide author owns every operation here. */
	let authorHeaders: Record<string, string>;

	beforeAll(async () => {
		authorHeaders = { cookie: await suiteGraphicsAuthorSessionCookie() };
		const graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		const created = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Template Package Preflight Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = created.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Preflight Overlay',
				slug: 'preflight-overlay',
				currentMode: 'feature-match-overlay',
			},
		});
		screenId = screen.id;

		const initiated = await $fetch<GraphicsIngestionOperation>(
			'/api/graphics-assets/ingestion-operations',
			{
				method: 'POST',
				headers: authorHeaders,
				body: graphicsIngestionRequest({
					idempotencyKey: 'template-package-preflight-source',
					name: 'Preflight sponsor logo',
					defaultEventId: eventId,
					browserDecodeEvidence: {
						outcome: 'decoded',
						sourceDigest: digestOf(packagePixelPng),
						width: 1,
						height: 1,
					},
					declaredByteLength: packagePixelPng.byteLength,
				}),
			},
		);
		const uploaded = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', headers: authorHeaders, body: packagePixelPng },
		);
		const operation = await uploaded.json() as GraphicsIngestionOperation;
		reference = {
			assetId: operation.result!.assetId,
			revisionId: operation.result!.revisionId,
		};

		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.frame.backgroundImage = reference as never;
		await $fetch(
			`/api/events/${eventId}/screens/${screenId}/config/feature-match-overlay`,
			{ method: 'PATCH', body: { layout: config.layout } },
		);
		const exported = await fetch(
			`/api/events/${eventId}/screens/${screenId}/template-packages/feature-match-layout`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(exported.status).toBe(200);
		exportedPackage = await collectStream(exported.body!);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('maps a package back to its exact origins and publishes nothing', async () => {
		const before = await libraryAssets();

		const operation = await receivePackage(exportedPackage);

		expect(operation.source).toBe('template-package');
		expect(operation.stage).toBe('awaiting-installation');
		const report = operation.templatePackagePreflight!;
		expect(report.outcome).toBe('ready');
		expect(report.issues).toEqual([]);
		expect(report.packageKind).toBe('sklayout');
		expect(report.mappings).toEqual([expect.objectContaining({
			proposal: 'reuse-graphic-asset-revision',
			basis: 'exact-origin',
			reference,
			canonicalGrowthBytes: 0,
		})]);
		expect(report.quota.canonicalGrowthBytes).toBe(0);
		expect(report.observed.archiveByteLength).toBe(exportedPackage.byteLength);

		// Preflight proposes; it never installs. The library is untouched.
		const after = await libraryAssets();
		expect(after.map(asset => asset.id).sort()).toEqual(before.map(asset => asset.id).sort());

		// The immutable report survives a reconnect on the durable operation.
		const reread = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ headers: authorHeaders },
		);
		expect(reread.templatePackagePreflight?.fingerprint).toBe(report.fingerprint);
		expect(reread.stage).toBe('awaiting-installation');
	});

	/**
	 * Export will emit an archive up to the envelope's own limit, so import has to
	 * be able to receive one. Nothing about a package is bounded by what a single
	 * Graphic Asset transfer may carry: a package holding one still image already
	 * outgrows the still-image ceiling, and a package holding media outgrows it
	 * many times over.
	 *
	 * It drives the resumable route itself, so what it pins is the server side:
	 * that transfer, staging and preflight carry every byte of such an archive.
	 * That the importer reaches for that route rather than a single request is a
	 * separate statement, made in
	 * `test/nuxt/composables/repositories/templatePackageImport.test.ts`.
	 */
	it('receives a package larger than a single Graphic Asset transfer may carry', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		// One still image at its own limit, which is all it takes to put the archive
		// holding it past that limit.
		const filling = pngPaddedTo(MAX_STILL_IMAGE_INGESTION_BYTES, 'sk-template-package-filling');
		const unseen = {
			assetId: 'an-asset-never-seen-here',
			revisionId: 'a-revision-never-seen-here',
		};
		const entry = templatePackageContentEntry(digestOf(filling));
		parts.contents = [{ name: entry, bytes: filling }];
		parts.manifest.packagedAssets = [{
			...packaged,
			content: { entry },
			origin: {
				sourceAssetId: unseen.assetId as never,
				sourceRevisionId: unseen.revisionId as never,
				sourceRevisionNumber: 1,
				digest: digestOf(filling),
			},
			integrity: {
				...packaged.integrity,
				digest: digestOf(filling),
				byteLength: filling.byteLength,
			},
			facts: {
				...packaged.facts,
				byteLength: filling.byteLength,
				sha256: digestOf(filling),
			},
		}];
		parts.manifest.contents = [{
			...parts.manifest.contents[0]!,
			digest: digestOf(filling),
			byteLength: filling.byteLength,
			entry,
		}];
		parts.template = {
			...(parts.template as Record<string, unknown>),
			frame: {
				...((parts.template as { frame: Record<string, unknown> }).frame),
				backgroundImage: unseen,
			},
		};

		const archive = writeTemplatePackage(parts);
		expect(archive.byteLength).toBeGreaterThan(MAX_STILL_IMAGE_INGESTION_BYTES);
		expect(archive.byteLength)
			.toBeLessThanOrEqual(TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength);

		const operation = await receivePackageInParts(archive, { fileName: 'filled-overlay.sklayout' });

		// Every byte arrived and preflight read the whole archive, rather than the
		// transfer being refused for exceeding a Graphic Asset's ceiling.
		expect(operation.stage).toBe('awaiting-installation');
		const report = operation.templatePackagePreflight!;
		expect(report.outcome).toBe('ready');
		expect(report.observed.archiveByteLength).toBe(archive.byteLength);
	});

	it('pauses on warnings and installs nothing until the exact report is confirmed', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		// A revision of a known source this installation does not hold: a separate
		// Graphic Asset, and something the author is asked about.
		parts.manifest.packagedAssets = [{
			...packaged,
			origin: { ...packaged.origin, sourceRevisionId: testGraphicAssetRevisionId('a-revision-never-seen-here') },
		}];
		parts.template = {
			...(parts.template as Record<string, unknown>),
			frame: {
				...((parts.template as { frame: Record<string, unknown> }).frame),
				backgroundImage: {
					assetId: packaged.origin.sourceAssetId,
					revisionId: 'a-revision-never-seen-here',
				},
			},
		};

		const operation = await receivePackage(writeTemplatePackage(parts));

		expect(operation.stage).toBe('awaiting-confirmation');
		const report = operation.templatePackagePreflight!;
		expect(report.outcome).toBe('requires-confirmation');
		expect(report.issues.map(issue => issue.code))
			.toContain('graphic-asset-created-from-related-origin');
		expect(report.issues.every(issue => issue.severity === 'warning')).toBe(true);

		// A confirmation for some other report cannot move this one.
		const wrongFingerprint = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/template-package-confirmation`,
			{
				method: 'POST',
				headers: { ...authorHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({ fingerprint: 'a'.repeat(64) }),
			},
		);
		expect(wrongFingerprint.status).toBe(400);
		await expect($fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ headers: authorHeaders },
		)).resolves.toMatchObject({ stage: 'awaiting-confirmation' });

		const confirmed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}/template-package-confirmation`,
			{ method: 'POST', headers: authorHeaders, body: { fingerprint: report.fingerprint } },
		);
		expect(confirmed.stage).toBe('awaiting-installation');

		// Confirmation readies the operation; it still installs nothing.
		const assets = await libraryAssets();
		expect(assets.some(asset => asset.name === packaged.name && asset.id !== reference.assetId))
			.toBe(false);
	});

	it('permanently rejects an unsafe archive with one complete report', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const operation = await receivePackage(writeTemplatePackage(parts, {
			extraEntries: [
				{ name: '../escaped.json', bytes: new TextEncoder().encode('{}') },
				{
					name: 'link.bin',
					bytes: new TextEncoder().encode('/etc/passwd'),
					externalAttributes: 0xA1FF0000,
				},
			],
		}));

		expect(operation.stage).toBe('failed');
		expect(operation.failure).toMatchObject({ retryable: false });
		const report = operation.templatePackagePreflight!;
		expect(report.outcome).toBe('rejected');
		// Both problems are reported together, each with stable code and guidance.
		expect(report.issues.map(issue => issue.code)).toEqual(
			expect.arrayContaining(['package-entry-path-traversal', 'package-entry-link']),
		);
		expect(report.issues.every(issue => issue.remediation.length > 0)).toBe(true);
		expect(report.limits).toEqual(TEMPLATE_PACKAGE_LIMITS);

		// A permanent input failure is not retryable into existence.
		const retried = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/retry`,
			{ method: 'POST', headers: authorHeaders },
		);
		expect(retried.status).toBe(409);
	});

	it('cancels a paused package idempotently', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		parts.manifest.packagedAssets = [{
			...packaged,
			origin: { ...packaged.origin, sourceRevisionId: testGraphicAssetRevisionId('another-unseen-revision') },
		}];
		parts.template = {
			...(parts.template as Record<string, unknown>),
			frame: {
				...((parts.template as { frame: Record<string, unknown> }).frame),
				backgroundImage: {
					assetId: packaged.origin.sourceAssetId,
					revisionId: 'another-unseen-revision',
				},
			},
		};
		const operation = await receivePackage(writeTemplatePackage(parts));
		expect(operation.stage).toBe('awaiting-confirmation');

		const cancelled = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);
		const again = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);

		expect(cancelled.stage).toBe('cancelled');
		expect(again.stage).toBe('cancelled');
		const confirmAfterCancel = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/template-package-confirmation`,
			{
				method: 'POST',
				headers: { ...authorHeaders, 'content-type': 'application/json' },
				body: JSON.stringify({
					fingerprint: operation.templatePackagePreflight!.fingerprint,
				}),
			},
		);
		expect(confirmAfterCancel.status).toBe(409);
	});

	it('refuses to initiate a package beyond the received archive limit', async () => {
		const response = await fetch('/api/graphics-assets/ingestion-operations', {
			method: 'POST',
			headers: { ...authorHeaders, 'content-type': 'application/json' },
			body: JSON.stringify({
				idempotencyKey: 'template-package-preflight-oversized',
				source: 'template-package',
				declaredByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength + 1,
			}),
		});

		expect(response.status).toBe(400);
		// Which envelope refused them, in words: a reader told only that some byte
		// length was too large goes looking at the Graphic Asset transfer limits,
		// which describe a different envelope entirely.
		const failure = await response.json() as { message?: string };
		expect(failure.message).toContain(
			`Template Package must not exceed ${TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength} bytes`,
		);
	});
});

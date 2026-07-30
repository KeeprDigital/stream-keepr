import type { GraphicAsset, GraphicsIngestionOperation } from '../../shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
import { TEMPLATE_PACKAGE_LIMITS } from '../../shared/types/templatePackage';
import { collectStream } from '../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../helpers/templatePackageArchive';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

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

const packagePixelPng = pngWithTextChunk(basePixelPng, 'sk-template-package-preflight');

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

let preflightSequence = 0;

/** Runs one package through the raw transfer route and returns the operation. */
async function receivePackage(archive: Uint8Array, options: { fileName?: string } = {}) {
	const initiated = await $fetch<GraphicsIngestionOperation>(
		'/api/graphics-assets/ingestion-operations',
		{
			method: 'POST',
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
		{ method: 'PUT', body: archive },
	);
	expect(response.status).toBe(200);
	return await response.json() as GraphicsIngestionOperation;
}

describe('template Package preflight through the API boundary', () => {
	let eventId: number;
	let screenId: number;
	let reference: { assetId: string; revisionId: string };
	let exportedPackage: Uint8Array;

	beforeAll(async () => {
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
				body: {
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
				},
			},
		);
		const uploaded = await fetch(
			`/api/graphics-assets/ingestion-operations/${initiated.id}/content`,
			{ method: 'PUT', body: packagePixelPng },
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
		const before = await $fetch<GraphicAsset[]>('/api/graphics-assets');

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
		const after = await $fetch<GraphicAsset[]>('/api/graphics-assets');
		expect(after.map(asset => asset.id).sort()).toEqual(before.map(asset => asset.id).sort());

		// The immutable report survives a reconnect on the durable operation.
		const reread = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
		);
		expect(reread.templatePackagePreflight?.fingerprint).toBe(report.fingerprint);
		expect(reread.stage).toBe('awaiting-installation');
	});

	it('pauses on warnings and installs nothing until the exact report is confirmed', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		// A revision of a known source this installation does not hold: a separate
		// Graphic Asset, and something the author is asked about.
		parts.manifest.packagedAssets = [{
			...packaged,
			origin: { ...packaged.origin, sourceRevisionId: 'a-revision-never-seen-here' },
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
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ fingerprint: 'a'.repeat(64) }),
			},
		);
		expect(wrongFingerprint.status).toBe(400);
		await expect($fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
		)).resolves.toMatchObject({ stage: 'awaiting-confirmation' });

		const confirmed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}/template-package-confirmation`,
			{ method: 'POST', body: { fingerprint: report.fingerprint } },
		);
		expect(confirmed.stage).toBe('awaiting-installation');

		// Confirmation readies the operation; it still installs nothing.
		const assets = await $fetch<GraphicAsset[]>('/api/graphics-assets');
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
			{ method: 'POST' },
		);
		expect(retried.status).toBe(409);
	});

	it('cancels a paused package idempotently', async () => {
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		parts.manifest.packagedAssets = [{
			...packaged,
			origin: { ...packaged.origin, sourceRevisionId: 'another-unseen-revision' },
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
			{ method: 'DELETE' },
		);
		const again = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${operation.id}`,
			{ method: 'DELETE' },
		);

		expect(cancelled.stage).toBe('cancelled');
		expect(again.stage).toBe('cancelled');
		const confirmAfterCancel = await fetch(
			`/api/graphics-assets/ingestion-operations/${operation.id}/template-package-confirmation`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
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
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				idempotencyKey: 'template-package-preflight-oversized',
				source: 'template-package',
				declaredByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength + 1,
			}),
		});

		expect(response.status).toBe(400);
	});
});

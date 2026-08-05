import type {
	GraphicAsset,
	GraphicAssetUsage,
	GraphicsIngestionOperation,
	InstalledGraphicsTemplate,
} from '../../shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../../shared/types/screenConfig';
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

const packagePixelPng = pngWithTextChunk(basePixelPng, 'sk-template-package-installation');

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

let installationSequence = 0;

async function receivePackage(archive: Uint8Array) {
	const initiated = await $fetch<GraphicsIngestionOperation>(
		'/api/graphics-assets/ingestion-operations',
		{
			method: 'POST',
			headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
			body: {
				idempotencyKey: `template-package-installation-${++installationSequence}`,
				source: 'template-package',
				sourceFileName: 'installable-overlay.sklayout',
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

async function installPackage(operationId: string) {
	return await $fetch<GraphicsIngestionOperation>(
		`/api/graphics-assets/ingestion-operations/${operationId}/template-package-installation`,
		{ method: 'POST', headers: { cookie: await suiteGraphicsAuthorSessionCookie() } },
	);
}

/** The library listing, read under this suite's graphics author session (#172). */
async function libraryAssets(): Promise<GraphicAsset[]> {
	return await $fetch<GraphicAsset[]>('/api/graphics-assets', {
		headers: { cookie: await suiteGraphicsAuthorSessionCookie() },
	});
}

describe('template Package installation through the API boundary', () => {
	let eventId: number;
	let screenId: number;
	let graphicsAuthorCookie: string;
	/** Every ingestion route resolves the author from the session, so one suite-wide author owns every operation here. */
	let authorHeaders: Record<string, string>;
	let reference: { assetId: string; revisionId: string };
	let exportedPackage: Uint8Array;

	beforeAll(async () => {
		graphicsAuthorCookie = await createGraphicsAuthorSessionCookie();
		authorHeaders = { cookie: await suiteGraphicsAuthorSessionCookie() };
		const created = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Template Package Installation Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = created.id;
		const screen = await $fetch(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Installation Overlay',
				slug: 'installation-overlay',
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
					idempotencyKey: 'template-package-installation-source',
					name: 'Installation sponsor logo',
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

	it('publishes the Template and every mapping it needs in one visible step', async () => {
		const before = await libraryAssets();
		// A packaged identity this installation has never seen, so it must create
		// one, alongside the exact origin it exported itself.
		const parts = readTemplatePackageParts(exportedPackage);
		const packaged = parts.manifest.packagedAssets[0]!;
		parts.manifest.packagedAssets = [{
			...packaged,
			packagedId: 'packaged-asset-0002',
			name: 'Imported sponsor logo',
			origin: {
				...packaged.origin,
				sourceAssetId: 'a-source-asset-never-seen-here',
				sourceRevisionId: 'a-source-revision-never-seen-here',
			},
		}];
		parts.template = {
			...(parts.template as Record<string, unknown>),
			frame: {
				...((parts.template as { frame: Record<string, unknown> }).frame),
				backgroundImage: {
					assetId: 'a-source-asset-never-seen-here',
					revisionId: 'a-source-revision-never-seen-here',
				},
			},
		};

		const received = await receivePackage(writeTemplatePackage(parts));
		// Its bytes are already here under other provenance, which is a warning
		// the author accepts rather than a reason to merge the identities.
		expect(received.stage).toBe('awaiting-confirmation');
		const confirmed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${received.id}/template-package-confirmation`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: { fingerprint: received.templatePackagePreflight!.fingerprint },
			},
		);
		expect(confirmed.stage).toBe('awaiting-installation');
		// Nothing exists yet, which is the state installation has to move away
		// from atomically.
		const during = await libraryAssets();
		expect(during).toHaveLength(before.length);

		const completed = await installPackage(received.id);

		expect(completed.stage).toBe('completed');
		const installation = completed.templatePackageInstallation!;
		expect(installation.templateKind).toBe('feature-match-layout');
		expect(installation.assets).toEqual([expect.objectContaining({
			outcome: 'created',
			basis: 'shared-content-digest',
			name: 'Imported sponsor logo',
			compatibilityProfile: 'still-image-v1',
		})]);
		const installed = installation.assets[0]!;

		// The Template, its rewritten reference, and the new Graphic Asset all
		// became visible together.
		const template = await $fetch<InstalledGraphicsTemplate>(
			`/api/graphics-assets/installed-templates/${installation.templateId}`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(template.references).toEqual([expect.objectContaining({
			reference: { assetId: installed.assetId, revisionId: installed.revisionId },
		})]);
		expect(JSON.stringify(template.document)).toContain(installed.revisionId);
		expect(JSON.stringify(template.document))
			.not
			.toContain('a-source-revision-never-seen-here');

		const after = await libraryAssets();
		expect(after).toHaveLength(before.length + 1);
		expect(after.some(asset => asset.id === installed.assetId)).toBe(true);

		// The installed revision resolves, and its reference is real usage.
		const content = await fetch(
			`/api/graphics-assets/${installed.assetId}/revisions/${installed.revisionId}/content`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(content.status).toBe(200);
		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${installed.assetId}/usage`,
			{ headers: { cookie: await suiteGraphicsAuthorSessionCookie() } },
		);
		expect(usage).toEqual([expect.objectContaining({
			owner: expect.objectContaining({ kind: 'installed-graphics-template' }),
		})]);

		// Installing again answers with the result that already committed rather
		// than publishing a second copy.
		const repeated = await installPackage(received.id);
		expect(repeated.templatePackageInstallation).toEqual(installation);
		expect(await libraryAssets()).toHaveLength(after.length);
	});

	it('reuses an exact origin without touching the asset it reuses', async () => {
		const existing = await libraryAssets();
		const before = existing.find(asset => asset.id === reference.assetId)!;

		const received = await receivePackage(exportedPackage);
		expect(received.stage).toBe('awaiting-installation');
		const completed = await installPackage(received.id);

		expect(completed.stage).toBe('completed');
		const installation = completed.templatePackageInstallation!;
		expect(installation.assets).toEqual([expect.objectContaining({
			outcome: 'reused',
			basis: 'exact-origin',
			assetId: reference.assetId,
			revisionId: reference.revisionId,
		})]);

		// The reused asset kept its own name, revisions, and facts.
		const after = await libraryAssets();
		const reused = after.find(asset => asset.id === reference.assetId)!;
		expect(reused.name).toBe(before.name);
		expect(reused.revisions).toEqual(before.revisions);
		expect(after).toHaveLength(existing.length);
		// And it kept describing itself by the upload that produced it. An
		// installation that only referenced this asset published nothing, so it
		// must not become the operation the library reports as its provenance:
		// that is how an uploaded asset ends up presenting the archive's filename
		// with no validation report behind it.
		expect(reused.operation.id).toBe(before.operation.id);
		expect(reused.operation.source).toBe('local-upload');
		expect(reused.operation.sourceFileName).toBe(before.operation.sourceFileName);
		expect(reused.operation.report?.outcome).toBe('accepted');
		expect(reused.operation.report?.compatibilityProfile).toBe('still-image-v1');

		// Usage names the Template that pins it, which is what an author needs
		// before retiring or trashing anything.
		const usage = await $fetch<GraphicAssetUsage[]>(
			`/api/graphics-assets/${reference.assetId}/usage`,
			{ headers: { cookie: await suiteGraphicsAuthorSessionCookie() } },
		);
		expect(usage).toContainEqual(expect.objectContaining({
			owner: expect.objectContaining({
				kind: 'installed-graphics-template',
				name: 'Installation Overlay',
			}),
		}));

		const template = await $fetch<InstalledGraphicsTemplate>(
			`/api/graphics-assets/installed-templates/${installation.templateId}`,
			{ headers: { cookie: graphicsAuthorCookie } },
		);
		expect(template.references).toEqual([expect.objectContaining({ reference })]);
	});

	it('leaves nothing discoverable when a package is cancelled before installation', async () => {
		const before = await libraryAssets();
		const received = await receivePackage(exportedPackage);
		expect(received.stage).toBe('awaiting-installation');

		const cancelled = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${received.id}`,
			{ method: 'DELETE', headers: authorHeaders },
		);
		expect(cancelled.stage).toBe('cancelled');

		// Installing a cancelled operation reports the cancellation rather than
		// reviving it.
		const attempted = await installPackage(received.id);
		expect(attempted.stage).toBe('cancelled');
		expect(attempted.templatePackageInstallation).toBeUndefined();
		expect(await libraryAssets()).toHaveLength(before.length);
	});

	it('refuses to install a proposal whose warnings nobody accepted', async () => {
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

		const received = await receivePackage(writeTemplatePackage(parts));
		expect(received.stage).toBe('awaiting-confirmation');
		const before = await libraryAssets();

		const refused = await fetch(
			`/api/graphics-assets/ingestion-operations/${received.id}/template-package-installation`,
			{ method: 'POST', headers: authorHeaders },
		);
		expect(refused.status).toBe(409);
		expect(await libraryAssets()).toHaveLength(before.length);

		// Accepting the exact report is what makes it installable.
		const confirmed = await $fetch<GraphicsIngestionOperation>(
			`/api/graphics-assets/ingestion-operations/${received.id}/template-package-confirmation`,
			{
				method: 'POST',
				headers: authorHeaders,
				body: { fingerprint: received.templatePackagePreflight!.fingerprint },
			},
		);
		expect(confirmed.stage).toBe('awaiting-installation');
		const completed = await installPackage(received.id);
		expect(completed.stage).toBe('completed');
		expect(completed.templatePackageInstallation!.assets[0]).toMatchObject({
			outcome: 'created',
			basis: 'related-origin-revision',
		});
		expect(await libraryAssets())
			.toHaveLength(before.length + 1);
	});
});

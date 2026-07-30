import type { GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import type {
	GraphicAsset,
	GraphicAssetReference,
	GraphicsIngestionOperation,
} from '~~/shared/types/graphicsAsset';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import {
	createBoundedByteStream,
	graphicsObjectIdentity,
} from '~~/server/modules/graphics-asset-library/object-store';
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../../../helpers/templatePackageArchive';

/**
 * Template Package installation, through the Graphics Asset Library's public
 * module interface.
 *
 * Every test here is a transfer: one library exports, another receives. That is
 * the only way the provenance rules mean anything — an exact Graphic Asset
 * Origin, a related source revision, and a digest-only match are all statements
 * about what a *different* installation once held, and a single-library fixture
 * cannot tell them apart.
 */

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));
/** A second, unmistakably different still image: 16 by 16 rather than 1 by 1. */
const sixteenPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=',
	'base64',
));

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Overrides one catalogue method for one call, so a failure the catalogue can
 * genuinely produce — a lost reservation, a transaction that does not commit —
 * can be observed at the public seam without contriving the race that causes it.
 */
type CatalogueFault = Partial<GraphicsAssetCatalogue>;

function createLibrary(
	label: string,
	options: { canonicalLimitBytes?: number; fault?: () => CatalogueFault } = {},
) {
	let nextIdentity = 0;
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const staging = createInMemoryStagingGraphicsObjectStore();
	const catalogue = createInMemoryGraphicsAssetCatalogue(options);
	const library = createGraphicsAssetLibrary({
		catalogue: new Proxy(catalogue, {
			get(target, property, receiver) {
				const override = options.fault?.()[property as keyof GraphicsAssetCatalogue];
				return override ?? Reflect.get(target, property, receiver);
			},
		}),
		staging,
		canonical,
		now: () => new Date('2026-07-31T09:00:00.000Z'),
		generateIdentity: () => `${label}-identity-${++nextIdentity}`,
	});
	return { library, catalogue, canonical, staging };
}

type Library = ReturnType<typeof createLibrary>['library'];

let ingestionSequence = 0;

async function ingestImage(
	library: Library,
	name: string,
	bytes: Uint8Array = transparentPixelPng,
	mime: 'image/png' | 'image/webp' = 'image/png',
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++ingestionSequence}`,
		initiatedBy: 'package-author',
		name,
		sourceFileName: mime === 'image/png' ? `${name}.png` : `${name}.webp`,
		declaredMime: mime,
		duplicateContentPolicy: 'create-separate',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: digestOf(bytes),
			width: 1,
			height: 1,
		},
		declaredByteLength: bytes.byteLength,
	});
	const completed = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: mime,
		bytes: createBoundedByteStream(bytes, {
			byteLength: bytes.byteLength,
			maximumByteLength: bytes.byteLength,
		}),
	});
	return {
		assetId: completed.result!.assetId,
		revisionId: completed.result!.revisionId,
	};
}

async function ingestStaticFont(library: Library, name: string): Promise<GraphicAssetReference> {
	const source = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++ingestionSequence}`,
		initiatedBy: 'package-author',
		name,
		sourceFileName: 'mplantin.woff',
		declaredMime: 'font/woff',
		declaredByteLength: source.byteLength,
	});
	const awaitingEvidence = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'font/woff',
		bytes: createBoundedByteStream(source, {
			byteLength: source.byteLength,
			maximumByteLength: 10 * 1024 * 1024,
		}),
	});
	if (awaitingEvidence.report?.outcome !== 'accepted' || awaitingEvidence.report.facts.kind !== 'font')
		throw new Error('Expected a validated font challenge');
	const { facts } = awaitingEvidence.report;
	const completed = await library.confirmFontBrowserEvidence({
		operationId: awaitingEvidence.id,
		initiatedBy: awaitingEvidence.initiatedBy,
		evidence: {
			outcome: 'font-loaded',
			sourceDigest: facts.sha256,
			challengeDigest: facts.browserChallenge.digest,
			glyphProofs: facts.browserChallenge.codePoints.map(codePoint => ({
				codePoint,
				exactWithSansDigest: '1'.repeat(64),
				exactWithMonoDigest: '1'.repeat(64),
				sansFallbackDigest: '2'.repeat(64),
				monoFallbackDigest: '3'.repeat(64),
			})),
		},
	});
	return {
		assetId: completed.result!.assetId,
		revisionId: completed.result!.revisionId,
	};
}

/** Replaces one Graphic Asset's content, producing a second source revision. */
async function replaceImage(
	library: Library,
	reference: GraphicAssetReference,
	bytes: Uint8Array,
	dimensions = { width: 16, height: 16 },
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicAssetReplacement({
		assetId: reference.assetId,
		idempotencyKey: `replace-${++ingestionSequence}`,
		initiatedBy: 'package-author',
		sourceFileName: 'replacement.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: digestOf(bytes),
			...dimensions,
		},
		declaredByteLength: bytes.byteLength,
	});
	const completed = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(bytes, {
			byteLength: bytes.byteLength,
			maximumByteLength: bytes.byteLength,
		}),
	});
	if (!completed.result)
		throw new Error(`replacement did not publish: ${JSON.stringify(completed)}`);
	return {
		assetId: completed.result.assetId,
		revisionId: completed.result.revisionId,
	};
}

async function exportPackage(
	library: Library,
	input: {
		document?: unknown;
		assets: { slot: string; reference: GraphicAssetReference }[];
		templateName?: string;
		templateIdentity?: string;
	},
): Promise<Uint8Array> {
	const result = await library.exportTemplatePackage({
		packageKind: 'skgraphic',
		template: {
			identity: input.templateIdentity ?? 'template-1',
			name: input.templateName ?? 'Lower third',
			document: input.document ?? Object.fromEntries(
				input.assets.map(asset => [asset.slot, asset.reference]),
			),
		},
		assets: input.assets,
	});
	if (result.outcome !== 'exported')
		throw new Error(`Expected an exported package, got ${JSON.stringify(result.report.issues)}`);
	return await collectStream(result.package.open());
}

let preflightSequence = 0;

async function preflight(
	library: Library,
	archive: Uint8Array,
	options: { defaultEventId?: number } = {},
) {
	const operation = await library.initiateTemplatePackagePreflight({
		idempotencyKey: `preflight-${++preflightSequence}`,
		initiatedBy: 'package-author',
		sourceFileName: 'lower-third.skgraphic',
		declaredByteLength: archive.byteLength,
		defaultEventId: options.defaultEventId,
	});
	return await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		bytes: createBoundedByteStream(archive, {
			byteLength: archive.byteLength,
			maximumByteLength: archive.byteLength,
		}),
	});
}

/**
 * Preflights, accepts whatever the report asks the author to accept, and
 * installs. Confirmation is a step an author takes, so a fixture that skipped it
 * would prove installation works only for packages nobody had to agree to.
 */
async function install(
	library: Library,
	archive: Uint8Array,
	options: { defaultEventId?: number } = {},
): Promise<GraphicsIngestionOperation> {
	let operation = await preflight(library, archive, options);
	if (operation.stage === 'awaiting-confirmation') {
		operation = await library.confirmTemplatePackagePreflight({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
			fingerprint: operation.templatePackagePreflight!.fingerprint,
		});
	}
	return await library.installTemplatePackage({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
	});
}

function installationOf(operation: GraphicsIngestionOperation) {
	if (!operation.templatePackageInstallation)
		throw new Error('Expected the operation to carry a Template Package installation result');
	return operation.templatePackageInstallation;
}

async function activeAssets(library: Library): Promise<GraphicAsset[]> {
	return await library.listGraphicAssets({});
}

describe('the Template Package installation contract', () => {
	it('installs a Template and its assets into a library that holds neither', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const { library: receiver, canonical } = createLibrary('receiver');
		const completed = await install(receiver, archive);

		expect(completed.stage).toBe('completed');
		const installation = installationOf(completed);
		expect(installation.templateKind).toBe('broadcast-graphic');
		expect(installation.templateName).toBe('Lower third');
		expect(installation.assets).toHaveLength(1);
		expect(installation.assets[0]).toMatchObject({
			outcome: 'created',
			basis: 'new-content',
			name: 'Backdrop',
			kind: 'image',
			compatibilityProfile: 'still-image-v1',
		});

		// The Template is discoverable, and its reference already names a local
		// identity and revision rather than the sender's.
		const template = await receiver.inspectInstalledGraphicsTemplate({
			templateId: installation.templateId,
		});
		expect(template.name).toBe('Lower third');
		expect(template.sourceTemplateIdentity).toBe('template-1');
		expect(template.references).toEqual([{
			ownerSlot: 'backdrop',
			reference: {
				assetId: installation.assets[0]!.assetId,
				revisionId: installation.assets[0]!.revisionId,
			},
		}]);
		expect(template.document).toEqual({
			backdrop: {
				assetId: installation.assets[0]!.assetId,
				revisionId: installation.assets[0]!.revisionId,
			},
		});
		expect(installation.assets[0]!.assetId).not.toBe(backdrop.assetId);
		expect(installation.assets[0]!.revisionId).not.toBe(backdrop.revisionId);

		// The asset is an ordinary library entry, and its canonical bytes are the
		// exact packaged ones.
		const assets = await activeAssets(receiver);
		expect(assets.map(asset => asset.name)).toEqual(['Backdrop']);
		expect(assets[0]!.facts.sha256).toBe(digestOf(transparentPixelPng));
		const stored = await canonical.readMetadata(
			graphicsObjectIdentity(`sha256/${digestOf(transparentPixelPng)}`),
		);
		expect(stored.outcome).toBe('available');

		// The installed revision resolves, which is what makes the reference valid.
		const resolved = await receiver.resolveGraphicAssetRevision({
			assetId: installation.assets[0]!.assetId,
			revisionId: installation.assets[0]!.revisionId,
		});
		expect(resolved.outcome).toBe('available');
		// Its preview was regenerated locally rather than shipped in the package.
		const thumbnail = await receiver.resolveGraphicAssetThumbnail({
			assetId: installation.assets[0]!.assetId,
		});
		expect(thumbnail.outcome).toBe('available');
	});

	it('reuses the exact local revision an origin identity, revision, and digest name', async () => {
		const { library } = createLibrary('sender');
		const backdrop = await ingestImage(library, 'Backdrop');
		const archive = await exportPackage(library, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		// The library curates its own name for the asset after the export.
		await library.updateGraphicAsset({
			assetId: backdrop.assetId,
			name: 'Backdrop (approved)',
			eventIds: [],
		});

		const completed = await install(library, archive);
		const installation = installationOf(completed);

		expect(installation.assets).toEqual([expect.objectContaining({
			outcome: 'reused',
			basis: 'exact-origin',
			assetId: backdrop.assetId,
			revisionId: backdrop.revisionId,
			// Reuse reports the library's own record, not the packaged snapshot.
			name: 'Backdrop (approved)',
		})]);
		// No second identity was created, and the curated name survived.
		const assets = await activeAssets(library);
		expect(assets).toHaveLength(1);
		expect(assets[0]!.name).toBe('Backdrop (approved)');
		expect(assets[0]!.revisions).toHaveLength(1);

		const template = await library.inspectInstalledGraphicsTemplate({
			templateId: installation.templateId,
		});
		expect(template.references).toEqual([{ ownerSlot: 'backdrop', reference: backdrop }]);
	});

	it('recognises an exact origin it recorded on a previous installation', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const { library: receiver } = createLibrary('receiver');
		const first = installationOf(await install(receiver, archive));
		expect(first.assets[0]!.outcome).toBe('created');

		// The second installation of the same package finds the Graphic Asset
		// Origin the first one recorded, which is the only trace of the sender the
		// receiver keeps.
		const second = installationOf(await install(receiver, archive));
		expect(second.assets).toEqual([expect.objectContaining({
			outcome: 'reused',
			basis: 'exact-origin',
			assetId: first.assets[0]!.assetId,
			revisionId: first.assets[0]!.revisionId,
		})]);
		expect(await activeAssets(receiver)).toHaveLength(1);
		// Each installation is its own independent Template copy.
		expect(second.templateId).not.toBe(first.templateId);
	});

	it('creates a separate Graphic Asset for a related source revision', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const firstArchive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});
		const replaced = await replaceImage(sender, backdrop, sixteenPixelPng);
		const secondArchive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: replaced }],
		});

		const { library: receiver } = createLibrary('receiver');
		const first = installationOf(await install(receiver, firstArchive));
		const second = installationOf(await install(receiver, secondArchive));

		// The same source identity at another source revision never mutates the
		// local asset the earlier import created.
		expect(second.assets[0]).toMatchObject({
			outcome: 'created',
			basis: 'related-origin-revision',
		});
		expect(second.assets[0]!.assetId).not.toBe(first.assets[0]!.assetId);
		const assets = await activeAssets(receiver);
		expect(assets).toHaveLength(2);
		expect(assets.every(asset => asset.revisions.length === 1)).toBe(true);
	});

	it('creates a separate Graphic Asset for a digest-only match and reuses its bytes', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const { library: receiver, canonical } = createLibrary('receiver');
		// The receiver already holds these exact bytes under its own provenance.
		const local = await ingestImage(receiver, 'Local backdrop');
		const before = await receiver.getCapacity();

		const installation = installationOf(await install(receiver, archive));

		expect(installation.assets[0]).toMatchObject({
			outcome: 'created',
			basis: 'shared-content-digest',
		});
		expect(installation.assets[0]!.assetId).not.toBe(local.assetId);
		expect(await activeAssets(receiver)).toHaveLength(2);
		// Identical bytes are stored once, so the shared source adds nothing.
		const stored = await canonical.readMetadata(
			graphicsObjectIdentity(`sha256/${digestOf(transparentPixelPng)}`),
		);
		expect(stored.outcome).toBe('available');
		const after = await receiver.getCapacity();
		expect(after.canonical.breakdown.retainedSourceBytes)
			.toBe(before.canonical.breakdown.retainedSourceBytes);
	});

	it('keeps distinct packaged identities distinct even when their bytes match', async () => {
		const { library: sender } = createLibrary('sender');
		const first = await ingestImage(sender, 'Backdrop A');
		const second = await ingestImage(sender, 'Backdrop B');
		expect(first.assetId).not.toBe(second.assetId);
		const archive = await exportPackage(sender, {
			assets: [
				{ slot: 'first', reference: first },
				{ slot: 'second', reference: second },
			],
		});

		const { library: receiver } = createLibrary('receiver');
		const installation = installationOf(await install(receiver, archive));

		expect(installation.assets).toHaveLength(2);
		const [installedFirst, installedSecond] = installation.assets;
		expect(installedFirst!.assetId).not.toBe(installedSecond!.assetId);
		expect(installedFirst!.revisionId).not.toBe(installedSecond!.revisionId);
		const assets = await activeAssets(receiver);
		expect(assets.map(asset => asset.name).sort()).toEqual(['Backdrop A', 'Backdrop B']);
		// One content entry, two Graphic Assets, both backed by the same bytes.
		expect(new Set(assets.map(asset => asset.facts.sha256)).size).toBe(1);

		const template = await receiver.inspectInstalledGraphicsTemplate({
			templateId: installation.templateId,
		});
		expect(template.references).toHaveLength(2);
		expect(new Set(template.references.map(reference => reference.reference.assetId)).size).toBe(2);
	});

	it('rewrites every reference the Template document carries, however deeply nested', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const badge = await ingestImage(sender, 'Badge', webpPixel, 'image/webp');
		const archive = await exportPackage(sender, {
			assets: [
				{ slot: 'items[0].media', reference: backdrop },
				{ slot: 'items[1].layers[0].media', reference: badge },
			],
			document: {
				name: 'Lower third',
				items: [
					{ media: backdrop },
					{ layers: [{ media: badge }] },
				],
			},
		});

		const { library: receiver } = createLibrary('receiver');
		const installation = installationOf(await install(receiver, archive));
		const template = await receiver.inspectInstalledGraphicsTemplate({
			templateId: installation.templateId,
		});

		const byName = new Map(installation.assets.map(asset => [asset.name, asset]));
		expect(template.document).toEqual({
			name: 'Lower third',
			items: [
				{
					media: {
						assetId: byName.get('Backdrop')!.assetId,
						revisionId: byName.get('Backdrop')!.revisionId,
					},
				},
				{
					layers: [{
						media: {
							assetId: byName.get('Badge')!.assetId,
							revisionId: byName.get('Badge')!.revisionId,
						},
					}],
				},
			],
		});
		// Owner slots name the document path, which is the same path the export
		// side reported, so a reference is traceable back to its field.
		expect(template.references.map(reference => reference.ownerSlot).sort())
			.toEqual(['items[0].media', 'items[1].layers[0].media']);
		// Nothing the sender named survives in the installed document.
		expect(JSON.stringify(template.document)).not.toContain(backdrop.assetId);
		expect(JSON.stringify(template.document)).not.toContain(badge.revisionId);
	});

	it('installs a packaged font under the profile it actually satisfied here', async () => {
		const { library: sender } = createLibrary('sender');
		const face = await ingestStaticFont(sender, 'Face');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'face', reference: face }],
		});

		const { library: receiver } = createLibrary('receiver');
		const installation = installationOf(await install(receiver, archive));

		// No browser loaded this face here, so the installed revision records the
		// unattested profile rather than claiming one it never earned.
		expect(installation.assets[0]).toMatchObject({
			outcome: 'created',
			kind: 'font',
			compatibilityProfile: 'static-font-v1-unattested',
		});
	});

	it('keeps a reused revision\'s own attested profile rather than the packaged one', async () => {
		const { library } = createLibrary('sender');
		const face = await ingestStaticFont(library, 'Face');
		const archive = await exportPackage(library, {
			assets: [{ slot: 'face', reference: face }],
		});

		const installation = installationOf(await install(library, archive));

		// The report described packaged bytes as unattested, but this mapping
		// reuses a local revision a browser did attest, and the result says so.
		expect(installation.assets[0]).toMatchObject({
			outcome: 'reused',
			compatibilityProfile: 'static-font-v1',
		});
	});

	it('associates everything an Event-scoped installation touched with that Event', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const { library: receiver } = createLibrary('receiver');
		const installation = installationOf(await install(receiver, archive, { defaultEventId: 7 }));

		const assets = await activeAssets(receiver);
		expect(assets[0]!.eventIds).toEqual([7]);
		const template = await receiver.inspectInstalledGraphicsTemplate({
			templateId: installation.templateId,
		});
		expect(template.eventId).toBe(7);
	});

	it('records the installed references as authoritative usage', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const archive = await exportPackage(sender, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const { library: receiver } = createLibrary('receiver');
		const installation = installationOf(await install(receiver, archive));
		const installed = installation.assets[0]!;

		const usage = await receiver.listGraphicAssetUsage({ assetId: installed.assetId });
		expect(usage).toEqual([expect.objectContaining({
			reference: { assetId: installed.assetId, revisionId: installed.revisionId },
			owner: expect.objectContaining({
				kind: 'installed-graphics-template',
				id: installation.templateId,
				slot: 'backdrop',
			}),
		})]);
		// A referenced asset cannot enter Trash, which is the invariant the
		// reference exists to protect.
		const trashed = await receiver.trashGraphicAsset({ assetId: installed.assetId });
		expect(trashed.outcome).toBe('in-use');
	});

	describe('atomicity', () => {
		it('resumes an interrupted installation without publishing twice', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver, canonical } = createLibrary('receiver');
			const resting = await preflight(receiver, archive);
			// The canonical store fails while the installation is writing bytes,
			// which is a transient condition rather than anything wrong with the
			// package.
			canonical.injectTransientFailure('create');

			const failed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(failed.stage).toBe('failed');
			expect(failed.failure).toMatchObject({
				code: 'canonical-store-unavailable',
				retryable: true,
			});
			expect(await activeAssets(receiver)).toEqual([]);

			// Retrying resumes from the durable staged bytes and publishes once.
			const completed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(await activeAssets(receiver)).toHaveLength(1);
			const template = await receiver.inspectInstalledGraphicsTemplate({
				templateId: installationOf(completed).templateId,
			});
			expect(template.references).toHaveLength(1);
		});

		it('publishes nothing when a revision it would reuse stops accepting references', async () => {
			const { library } = createLibrary('sender');
			const backdrop = await ingestImage(library, 'Backdrop');
			const archive = await exportPackage(library, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const resting = await preflight(library, archive);
			expect(resting.stage).toBe('awaiting-installation');
			// The asset is unreferenced while the proposal rests, so Trash is a
			// legitimate thing for its owner to do — and the proposal that would
			// have pinned it must lose rather than resurrect it.
			const trashed = await library.trashGraphicAsset({ assetId: backdrop.assetId });
			expect(trashed.outcome).toBe('trashed');

			const refused = await library.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(refused.stage).toBe('failed');
			expect(refused.failure).toMatchObject({
				code: 'template-package-mapping-unavailable',
				retryable: true,
			});
			expect(refused.templatePackageInstallation).toBeUndefined();
			expect(await activeAssets(library)).toEqual([]);
			// The report names the asset and what to do about it, rather than
			// leaving the author to infer either from a failed transaction.
			expect(refused.templatePackagePreflight!.issues).toContainEqual(
				expect.objectContaining({
					code: 'graphic-asset-origin-not-referenceable',
					severity: 'error',
					retryable: true,
				}),
			);

			// Restoring what the proposal needs makes the same installation work.
			await library.restoreGraphicAsset({ assetId: backdrop.assetId });
			const completed = await library.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(installationOf(completed).assets[0]).toMatchObject({
				outcome: 'reused',
				assetId: backdrop.assetId,
			});
		});

		it('exposes nothing when a package is cancelled before publication', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const resting = await preflight(receiver, archive);
			expect(resting.stage).toBe('awaiting-installation');

			const cancelled = await receiver.cancelGraphicsIngestion({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(cancelled.stage).toBe('cancelled');
			expect(await activeAssets(receiver)).toEqual([]);

			// Installing a cancelled operation is answered with the cancellation
			// rather than reviving it, and cancelling again is the same act twice.
			const installed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(installed.stage).toBe('cancelled');
			expect(installed.templatePackageInstallation).toBeUndefined();
			expect(await activeAssets(receiver)).toEqual([]);
		});

		it('answers a repeated installation with the one that already committed', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			let operation = await preflight(receiver, archive);
			const first = await receiver.installTemplatePackage({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});
			// A client that lost the response asks again. Nothing is published a
			// second time, and the terminal result is the same one.
			const second = await receiver.installTemplatePackage({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});

			expect(second.stage).toBe('completed');
			expect(second.templatePackageInstallation)
				.toEqual(first.templatePackageInstallation);
			expect(await activeAssets(receiver)).toHaveLength(1);
			operation = await receiver.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});
			expect(operation.templatePackageInstallation)
				.toEqual(first.templatePackageInstallation);
		});

		it('lets only one of two concurrent installations publish', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const resting = await preflight(receiver, archive);
			const outcomes = await Promise.allSettled([
				receiver.installTemplatePackage({
					operationId: resting.id,
					initiatedBy: resting.initiatedBy,
				}),
				receiver.installTemplatePackage({
					operationId: resting.id,
					initiatedBy: resting.initiatedBy,
				}),
			]);

			const published = outcomes.filter(outcome =>
				outcome.status === 'fulfilled' && outcome.value.stage === 'completed',
			);
			expect(published).toHaveLength(1);
			// Whatever the loser was told, the library holds exactly one result.
			expect(await activeAssets(receiver)).toHaveLength(1);
			const template = await receiver.listGraphicAssets({});
			expect(template).toHaveLength(1);
		});

		it('refuses a proposal the author confirmed but that no longer describes the package', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const resting = await preflight(receiver, archive);
			expect(resting.stage).toBe('awaiting-installation');
			const confirmedFingerprint = resting.templatePackagePreflight!.fingerprint;

			// The library moves underneath the resting confirmation: the same bytes
			// now match content it already holds, so the proposal changes and
			// carries a warning the author never saw.
			await ingestImage(receiver, 'Local backdrop');

			const returned = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});

			expect(returned.stage).toBe('awaiting-confirmation');
			expect(returned.templatePackagePreflight!.fingerprint).not.toBe(confirmedFingerprint);
			expect(returned.templatePackagePreflight!.outcome).toBe('requires-confirmation');
			// Nothing was installed, and the new proposal is the one on offer.
			expect(await activeAssets(receiver)).toHaveLength(1);
			expect(returned.templatePackageInstallation).toBeUndefined();

			// Accepting the new proposal installs it.
			const confirmed = await receiver.confirmTemplatePackagePreflight({
				operationId: returned.id,
				initiatedBy: returned.initiatedBy,
				fingerprint: returned.templatePackagePreflight!.fingerprint,
			});
			const completed = await receiver.installTemplatePackage({
				operationId: confirmed.id,
				initiatedBy: confirmed.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(installationOf(completed).assets[0]!.basis).toBe('shared-content-digest');
		});

		it('refuses to install a package whose preflight nobody confirmed', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			// A local asset with the same bytes makes the proposal carry a warning.
			await ingestImage(receiver, 'Local backdrop');
			const paused = await preflight(receiver, archive);
			expect(paused.stage).toBe('awaiting-confirmation');

			await expect(receiver.installTemplatePackage({
				operationId: paused.id,
				initiatedBy: paused.initiatedBy,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
			expect(await activeAssets(receiver)).toHaveLength(1);
		});

		it('publishes nothing when capacity runs out between confirmation and publication', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			// The report was computed against a library with room. The reservation
			// installation takes for itself is the last check before bytes become
			// permanent, and it is the one that has to hold.
			let exhausted = false;
			const { library: receiver } = createLibrary('receiver', {
				fault: () => exhausted
					? {
							reserveTemplatePackagePublication: async () => ({
								outcome: 'blocked',
								capacity: {
									resource: 'canonical',
									limitBytes: 1_000,
									usedBytes: 1_000,
									reservedBytes: 0,
									requestedBytes: 70,
									availableBytes: 0,
								},
							}),
						}
					: {},
			});
			const resting = await preflight(receiver, archive);
			expect(resting.stage).toBe('awaiting-installation');
			exhausted = true;

			const failed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});

			expect(failed.stage).toBe('failed');
			expect(failed.failure).toMatchObject({
				code: 'canonical-capacity-exhausted',
				retryable: true,
			});
			expect(failed.canonicalCapacityOutcome)
				.toMatchObject({ outcome: 'canonical-capacity-blocked' });
			expect(await activeAssets(receiver)).toEqual([]);
			expect(failed.templatePackageInstallation).toBeUndefined();

			// With room again, the same staged package installs.
			exhausted = false;
			const completed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(await activeAssets(receiver)).toHaveLength(1);
		});

		it('publishes nothing when the publication transaction itself fails', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			let catalogueFails = false;
			const { library: receiver } = createLibrary('receiver', {
				fault: () => catalogueFails
					? {
							installTemplatePackage: async () => {
								throw new Error('D1 is unavailable');
							},
						}
					: {},
			});
			const resting = await preflight(receiver, archive);
			catalogueFails = true;

			const failed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});

			// The bytes were written and verified before this point, but nothing
			// they belong to exists, so the library is exactly as it was.
			expect(failed.stage).toBe('failed');
			expect(failed.failure?.retryable).toBe(true);
			expect(failed.templatePackageInstallation).toBeUndefined();
			expect(await activeAssets(receiver)).toEqual([]);
			await expect(receiver.inspectInstalledGraphicsTemplate({
				templateId: 'receiver-identity-1' as never,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-found' });

			// A retry over the same durable staged bytes publishes once.
			catalogueFails = false;
			const completed = await receiver.installTemplatePackage({
				operationId: resting.id,
				initiatedBy: resting.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(await activeAssets(receiver)).toHaveLength(1);
		});

		it('publishes nothing when installing would exceed canonical capacity', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			// Room to stage and preflight the package, but not to keep its bytes.
			const { library: receiver } = createLibrary('receiver', { canonicalLimitBytes: 1 });
			const resting = await preflight(receiver, archive);
			expect(resting.stage).toBe('failed');
			expect(resting.failure).toMatchObject({
				code: 'canonical-capacity-exhausted',
				retryable: true,
			});
			expect(await activeAssets(receiver)).toEqual([]);
		});
	});

	describe('immutable provenance', () => {
		it('rejects the complete package when an origin claims different content', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const badge = await ingestImage(sender, 'Badge', webpPixel, 'image/webp');
			const archive = await exportPackage(sender, {
				assets: [
					{ slot: 'backdrop', reference: backdrop },
					{ slot: 'badge', reference: badge },
				],
			});

			const { library: receiver } = createLibrary('receiver');
			await install(receiver, archive);
			expect(await activeAssets(receiver)).toHaveLength(2);

			// A second package claims one of the origins the receiver has already
			// recorded, but carries other bytes under it.
			const parts = readTemplatePackageParts(archive);
			const conflicting = parts.manifest.packagedAssets.find(
				asset => asset.name === 'Backdrop',
			)!;
			const otherDigest = parts.manifest.packagedAssets.find(
				asset => asset.name === 'Badge',
			)!.integrity.digest;
			conflicting.origin = { ...conflicting.origin, digest: otherDigest };
			conflicting.integrity = {
				...conflicting.integrity,
				digest: otherDigest,
				byteLength: webpPixel.byteLength,
				canonicalMime: 'image/webp',
			};
			conflicting.content = { entry: `content/sha256-${otherDigest}.bin` };
			parts.manifest.contents = parts.manifest.contents.filter(
				content => content.digest === otherDigest,
			);
			parts.contents = parts.contents.filter(
				content => content.name === `content/sha256-${otherDigest}.bin`,
			);
			parts.manifest.totals = {
				...parts.manifest.totals,
				uniqueContentCount: 1,
				entryCount: 3,
			};

			const operation = await preflight(receiver, writeTemplatePackage(parts));

			expect(operation.stage).toBe('failed');
			expect(operation.failure).toMatchObject({ retryable: false });
			expect(operation.templatePackagePreflight!.issues.map(issue => issue.code))
				.toContain('immutable-origin-digest-conflict');
			// The conflict rejects the complete package: the identity that was
			// perfectly installable alongside it gains nothing.
			expect(await activeAssets(receiver)).toHaveLength(2);
			await expect(receiver.installTemplatePackage({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
		});

		it('refuses to reuse an exact origin whose asset can no longer take references', async () => {
			const { library } = createLibrary('sender');
			const backdrop = await ingestImage(library, 'Backdrop');
			const archive = await exportPackage(library, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			// Retirement hides an asset from discovery and stops it taking new
			// references, so a proposal to reuse it could never be installed.
			await library.retireGraphicAsset({ assetId: backdrop.assetId });

			const operation = await preflight(library, archive);

			expect(operation.stage).toBe('failed');
			expect(operation.templatePackagePreflight!.outcome).toBe('rejected');
			expect(operation.templatePackagePreflight!.issues).toContainEqual(
				expect.objectContaining({
					code: 'graphic-asset-origin-not-referenceable',
					subject: 'packaged-asset-0001',
					severity: 'error',
					// Restoring the asset is the fix, so the operation stays
					// resumable rather than terminating on a condition an author
					// can undo.
					retryable: true,
				}),
			);
			expect(operation.failure).toMatchObject({ retryable: true });

			// Restoring it makes the same staged package installable.
			await library.restoreGraphicAsset({ assetId: backdrop.assetId });
			const completed = await library.installTemplatePackage({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});
			expect(completed.stage).toBe('completed');
			expect(installationOf(completed).assets[0]).toMatchObject({
				outcome: 'reused',
				assetId: backdrop.assetId,
			});
		});

		it('rejects a package whose packaged identities claim one source revision', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const badge = await ingestImage(sender, 'Badge', webpPixel, 'image/webp');
			const parts = readTemplatePackageParts(await exportPackage(sender, {
				assets: [
					{ slot: 'backdrop', reference: backdrop },
					{ slot: 'badge', reference: badge },
				],
			}));
			// Two packaged identities, one provenance. Neither can be mapped: a
			// Template field naming that origin has two candidate local revisions,
			// and only one origin row can record it.
			const [first, second] = parts.manifest.packagedAssets;
			parts.manifest.packagedAssets = [
				first!,
				{ ...second!, origin: { ...second!.origin, ...first!.origin, digest: second!.origin.digest } },
			];

			const { library: receiver } = createLibrary('receiver');
			const operation = await preflight(receiver, writeTemplatePackage(parts));

			expect(operation.stage).toBe('failed');
			expect(operation.templatePackagePreflight!.issues.map(issue => issue.code))
				.toContain('duplicate-packaged-origin');
			expect(await activeAssets(receiver)).toEqual([]);
		});

		it('never lets a later local revision inherit the origin of a revision it installed', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const installed = installationOf(await install(receiver, archive)).assets[0]!;
			// The receiver replaces the imported asset's content locally.
			const replaced = await replaceImage(
				receiver,
				{ assetId: installed.assetId, revisionId: installed.revisionId },
				sixteenPixelPng,
			);
			expect(replaced.revisionId).not.toBe(installed.revisionId);

			// Re-installing still recognises the imported revision, not the local
			// one that came after it.
			const second = installationOf(await install(receiver, archive));
			expect(second.assets[0]).toMatchObject({
				outcome: 'reused',
				basis: 'exact-origin',
				revisionId: installed.revisionId,
			});
		});
	});
});

import type { SilentVideoPlaybackValidator } from '~~/server/modules/graphics-asset-library/silent-video-playback-validator';
import type { GraphicAssetReference, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { TemplatePackageManifest } from '~~/shared/types/templatePackage';
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
import {
	DEFAULT_GRAPHIC_SURFACE_STYLE,
	DEFAULT_GRAPHIC_TYPOGRAPHY,
} from '~~/shared/modules/graphics/itemDefinitions';
import { TEMPLATE_PACKAGE_KINDS } from '~~/shared/types/templatePackage';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';
import { collectStream, readStoredZipArchive } from '../../../helpers/storedZipArchive';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

const sixteenPixelPosterPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=',
	'base64',
));
const vp9Webm = Uint8Array.from(Buffer.from(
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhkRqj8GKbqBJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiGRGqPwYpuoEZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXG54EAo6yBAACAgkmDQgAA8AD2ADgkHBhCAAAwcAAASqf/+5CBv///CAg////7iYcAAKOTgQH0AIYAQJKcAElAAAMgAABCQBxTu2uRu4+zgQC3iveBAfGCAavwgQM=',
	'base64',
));

/**
 * Playback validation is a controlled adapter here, exactly as the shared
 * ingestion suites drive it. Export never touches it; it exists only so a real
 * silent-video revision can be published and then required by a Template.
 */
function acceptEverySilentVideo(): SilentVideoPlaybackValidator {
	return {
		validate: async input => ({
			outcome: 'accepted' as const,
			operationId: input.operationId,
			idempotencyKey: input.idempotencyKey,
			sourceDigest: input.sourceDigest,
			factsDigest: input.factsDigest,
			width: input.inspectedFacts.width,
			height: input.inspectedFacts.height,
			durationSeconds: input.inspectedFacts.durationSeconds,
			posterTimeSeconds: input.inspectedFacts.posterTimeSeconds,
			mutedInlinePlayback: true as const,
			seeked: true as const,
			transparencyRendered: false,
			posterDigest: digestOf(sixteenPixelPosterPng),
			poster: createBoundedByteStream(sixteenPixelPosterPng, {
				byteLength: sixteenPixelPosterPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}),
	};
}

function createExportLibrary() {
	let nextIdentity = 0;
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging: createInMemoryStagingGraphicsObjectStore(),
		canonical,
		silentVideoPlaybackValidator: acceptEverySilentVideo(),
		now: () => new Date('2026-07-30T09:00:00.000Z'),
		generateIdentity: () => `package-identity-${++nextIdentity}`,
	});
	return { library, canonical };
}

type ExportLibrary = ReturnType<typeof createExportLibrary>['library'];

async function ingestImage(
	library: ExportLibrary,
	name: string,
	bytes: Uint8Array,
	mime: 'image/png' | 'image/webp' = 'image/png',
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}`,
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

async function ingestSilentVideo(
	library: ExportLibrary,
	name: string,
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}`,
		initiatedBy: 'package-author',
		name,
		sourceFileName: `${name}.webm`,
		declaredMime: 'video/webm',
		declaredByteLength: vp9Webm.byteLength,
	});
	const completed = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'video/webm',
		bytes: createBoundedByteStream(vp9Webm, {
			byteLength: vp9Webm.byteLength,
			maximumByteLength: 250 * 1024 * 1024,
		}),
	});
	return {
		assetId: completed.result!.assetId,
		revisionId: completed.result!.revisionId,
	};
}

async function ingestStaticFont(
	library: ExportLibrary,
	name: string,
): Promise<GraphicAssetReference> {
	const source = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}`,
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

describe('the Template Package export contract', () => {
	it.each(TEMPLATE_PACKAGE_KINDS)(
		'embeds the exact required Graphic Asset Revision in a %s package',
		async (packageKind) => {
			const { library } = createExportLibrary();
			const backdrop = await ingestImage(library, 'Backdrop', transparentPixelPng);

			const result = await library.exportTemplatePackage({
				packageKind,
				template: {
					identity: 'template-1',
					name: 'Lower third',
					document: { backdrop },
				},
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			expect(result.outcome).toBe('exported');
			if (result.outcome !== 'exported')
				return;

			const archive = readStoredZipArchive(await collectStream(result.package.open()));
			const manifest = archive.json<TemplatePackageManifest>('manifest.json');

			expect(manifest.packageKind).toBe(packageKind);
			expect(manifest.packagedAssets).toHaveLength(1);
			const packaged = manifest.packagedAssets[0]!;
			expect(packaged.origin).toMatchObject({
				sourceAssetId: backdrop.assetId,
				sourceRevisionId: backdrop.revisionId,
				digest: digestOf(transparentPixelPng),
			});
			expect(packaged.integrity).toMatchObject({
				algorithm: 'sha256',
				digest: digestOf(transparentPixelPng),
				byteLength: transparentPixelPng.byteLength,
				canonicalMime: 'image/png',
			});
			expect(packaged.requiredBy).toEqual(['backdrop']);
			expect(archive.entry(packaged.content.entry).bytes).toEqual(transparentPixelPng);
			expect(result.package.archiveByteLength).toBe(archive.byteLength);
		},
	);

	it('keeps distinct packaged identities apart while storing identical bytes once', async () => {
		const { library } = createExportLibrary();
		const first = await ingestImage(library, 'Watermark A', webpPixel, 'image/webp');
		const second = await ingestImage(library, 'Watermark B', webpPixel, 'image/webp');
		expect(first.assetId).not.toBe(second.assetId);

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: {
				identity: 'template-2',
				name: 'Twin watermarks',
				document: { left: first, right: second },
			},
			assets: [
				{ slot: 'left', reference: first },
				{ slot: 'right', reference: second },
			],
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const archive = readStoredZipArchive(await collectStream(result.package.open()));
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');

		expect(manifest.packagedAssets).toHaveLength(2);
		const [left, right] = manifest.packagedAssets;
		expect(left!.packagedId).not.toBe(right!.packagedId);
		expect(left!.origin.sourceAssetId).not.toBe(right!.origin.sourceAssetId);
		expect(left!.content.entry).toBe(right!.content.entry);
		expect(manifest.contents).toHaveLength(1);
		expect(archive.entryNames.filter(name => name.startsWith('content/'))).toHaveLength(1);
	});

	it('collapses repeated slots requiring one revision into a single packaged asset', async () => {
		const { library } = createExportLibrary();
		const logo = await ingestImage(library, 'Logo', transparentPixelPng);

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: {
				identity: 'template-3',
				name: 'Repeated logo',
				document: { header: logo, footer: logo },
			},
			assets: [
				{ slot: 'footer', reference: logo },
				{ slot: 'header', reference: logo },
			],
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const manifest = result.package.manifest;
		expect(manifest.packagedAssets).toHaveLength(1);
		expect(manifest.packagedAssets[0]!.requiredBy).toEqual(['footer', 'header']);
	});

	it('rejects a missing reference and unavailable content together in one report', async () => {
		const { library, canonical } = createExportLibrary();
		const present = await ingestImage(library, 'Present', transparentPixelPng);
		const vanished = await ingestImage(library, 'Vanished', webpPixel, 'image/webp');
		canonical.markUnavailable(graphicsObjectIdentity(`sha256/${digestOf(webpPixel)}`));

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: {
				identity: 'template-4',
				name: 'Broken template',
				document: {},
			},
			assets: [
				{ slot: 'present', reference: present },
				{ slot: 'vanished', reference: vanished },
				{
					slot: 'ghost',
					reference: {
						assetId: present.assetId,
						revisionId: 'revision-that-never-existed' as GraphicAssetRevisionId,
					},
				},
			],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				code: 'missing-graphic-asset-reference',
				slot: 'ghost',
				retryable: false,
			}),
			expect.objectContaining({
				code: 'unavailable-graphic-asset-content',
				slot: 'vanished',
				retryable: true,
			}),
		]));
		expect(result.report.issues).toHaveLength(2);
	});

	it('declares application-owned capabilities without duplicating them into the archive', async () => {
		const { library } = createExportLibrary();
		const logo = await ingestImage(library, 'Logo', transparentPixelPng);

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: {
				identity: 'template-5',
				name: 'Application typography',
				document: {
					items: [
						{ type: 'text', typography: { font: { kind: 'application', fontId: 'inter' } } },
						{ type: 'text', typography: { font: { kind: 'application', fontId: 'inter' } } },
					],
					logo,
				},
			},
			assets: [{ slot: 'logo', reference: logo }],
			capabilities: [
				{ slot: 'items[0].typography.font', capability: 'application-font', identity: 'inter' },
				{ slot: 'items[1].typography.font', capability: 'application-font', identity: 'inter' },
				{
					slot: 'items[0].type',
					capability: 'graphic-item-definition',
					identity: 'text',
					configurationVersion: 1,
				},
			],
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const archive = readStoredZipArchive(await collectStream(result.package.open()));
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');

		expect(manifest.applicationCapabilities).toEqual([
			{
				capability: 'application-font',
				identity: 'inter',
				configurationVersion: 1,
				requiredBy: ['items[0].typography.font', 'items[1].typography.font'],
			},
			{
				capability: 'graphic-item-definition',
				identity: 'text',
				configurationVersion: 1,
				requiredBy: ['items[0].type'],
			},
		]);
		// Only the one library asset travels as bytes; the bundled font does not.
		expect(archive.entryNames.filter(name => name.startsWith('content/'))).toHaveLength(1);
		expect(manifest.packagedAssets.map(asset => asset.kind)).toEqual(['image']);
	});

	it('blocks an application capability this installation does not provide', async () => {
		const { library } = createExportLibrary();

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: { identity: 'template-6', name: 'Unknown capability', document: {} },
			assets: [],
			capabilities: [
				{ slot: 'items[0].typography.font', capability: 'application-font', identity: 'not-a-bundled-font' },
				{
					slot: 'items[1].type',
					capability: 'graphic-item-definition',
					identity: 'text',
					configurationVersion: 99,
				},
			],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues.map(issue => [issue.code, issue.slot])).toEqual([
			['unsupported-application-capability', 'items[0].typography.font'],
			['unsupported-application-capability', 'items[1].type'],
		]);
	});

	it.each([
		[
			'a remote resource',
			{ frame: { mediaBackground: { enabled: true, url: 'https://cdn.example.com/loop.mp4' } } },
			'remote-resource-dependency',
			'frame.mediaBackground.url',
		],
		[
			'a protocol-relative resource',
			{ frame: { backgroundUrl: '//cdn.example.com/loop.mp4' } },
			'remote-resource-dependency',
			'frame.backgroundUrl',
		],
		[
			'an inline payload',
			{ frame: { backgroundImage: 'data:image/png;base64,iVBORw0KGgo=' } },
			'undeclared-graphic-asset-dependency',
			'frame.backgroundImage',
		],
		[
			'executable content',
			{ items: [{ label: '<script>fetch("/steal")</script>' }] },
			'executable-template-content',
			'items[0].label',
		],
	] as const)('rejects a Template document carrying %s', async (_description, document, code, slot) => {
		const { library } = createExportLibrary();

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: { identity: 'template-7', name: 'Not data only', document },
			assets: [],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues).toEqual([
			expect.objectContaining({ code, slot, retryable: false }),
		]);
	});

	it('blocks a Graphic Asset Reference the Template document carries but the export never declared', async () => {
		const { library } = createExportLibrary();
		const declared = await ingestImage(library, 'Declared', transparentPixelPng);
		const smuggled = await ingestImage(library, 'Smuggled', webpPixel, 'image/webp');

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: {
				identity: 'template-8',
				name: 'Undeclared dependency',
				document: {
					frame: { backgroundImage: declared },
					items: [{ media: { source: smuggled } }],
				},
			},
			assets: [{ slot: 'frame.backgroundImage', reference: declared }],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues).toEqual([
			expect.objectContaining({
				code: 'undeclared-graphic-asset-dependency',
				slot: 'items[0].media.source',
			}),
		]);
	});

	it('embeds every required image, silent video, and font revision', async () => {
		const { library } = createExportLibrary();
		const image = await ingestImage(library, 'Backdrop', transparentPixelPng);
		const video = await ingestSilentVideo(library, 'Sting');
		const font = await ingestStaticFont(library, 'MPlantin');

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: {
				identity: 'template-10',
				name: 'Every media kind',
				document: { image, video, font },
			},
			assets: [
				{ slot: 'image', reference: image, expectedKind: 'image' },
				{ slot: 'video', reference: video, expectedKind: 'silent-video' },
				{ slot: 'font', reference: font, expectedKind: 'font' },
			],
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const archive = readStoredZipArchive(await collectStream(result.package.open()));
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');

		expect([...manifest.packagedAssets].map(asset => asset.kind).sort())
			.toEqual(['font', 'image', 'silent-video']);
		for (const packaged of manifest.packagedAssets) {
			const entry = archive.entry(packaged.content.entry);
			expect(entry.bytes.byteLength).toBe(packaged.integrity.byteLength);
			expect(digestOf(entry.bytes)).toBe(packaged.integrity.digest);
			expect(packaged.facts.sha256).toBe(packaged.integrity.digest);
		}
		// Derivatives are dependent resources; a package carries only sources.
		expect(archive.entryNames.filter(name => name.startsWith('content/'))).toHaveLength(3);
	});

	it('blocks a slot whose revision is a different media kind', async () => {
		const { library } = createExportLibrary();
		const image = await ingestImage(library, 'Backdrop', transparentPixelPng);

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: { identity: 'template-11', name: 'Wrong kind', document: { video: image } },
			assets: [{ slot: 'video', reference: image, expectedKind: 'silent-video' }],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues).toEqual([
			expect.objectContaining({ code: 'unexpected-graphic-asset-kind', slot: 'video' }),
		]);
	});

	it('blocks a package needing more than 100 packaged Graphic Asset Revisions', async () => {
		const { library } = createExportLibrary();
		const assets: { slot: string; reference: GraphicAssetReference }[] = [];
		for (let index = 0; index < 101; index += 1) {
			const reference = await ingestImage(library, `Logo ${index}`, transparentPixelPng);
			assets.push({ slot: `items[${index}].asset`, reference });
		}
		// Identical bytes, deliberately distinct domain identities.
		expect(new Set(assets.map(asset => asset.reference.assetId)).size).toBe(101);

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: { identity: 'template-12', name: 'Too many revisions', document: {} },
			assets,
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues).toEqual([
			expect.objectContaining({ code: 'packaged-revision-limit-exceeded' }),
		]);
		expect(result.report.observed.packagedRevisionCount).toBe(101);
		expect(result.report.limits.maximumPackagedRevisionCount).toBe(100);
	});

	it('declares the Definitions of Graphic Items nested inside a Graphic Group', async () => {
		const { library } = createExportLibrary();
		const graphic = {
			id: 'stacked-lower-third',
			name: 'Stacked lower third',
			items: [{
				id: 'stack',
				type: 'group' as const,
				label: 'Stack',
				visible: true,
				anchor: 'top-left' as const,
				x: 0,
				y: 0,
				width: 800,
				height: 200,
				arrangement: 'column' as const,
				padding: 0,
				gap: 8,
				align: 'start' as const,
				justify: 'start' as const,
				clip: false,
				geometry: { cornerRadius: 0 },
				children: [
					{
						id: 'nested-headline',
						type: 'text' as const,
						label: 'Headline',
						visible: true,
						anchor: 'top-left' as const,
						x: 0,
						y: 0,
						width: 800,
						height: 100,
						text: 'Semifinal',
						overflowPolicy: 'ellipsis' as const,
						minFontSize: 24,
						typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
					},
					{
						id: 'nested-rule',
						type: 'shape' as const,
						label: 'Rule',
						visible: true,
						anchor: 'top-left' as const,
						x: 0,
						y: 108,
						width: 800,
						height: 4,
						geometry: { cornerRadius: 0 },
						surfaceStyle: { ...DEFAULT_GRAPHIC_SURFACE_STYLE },
					},
				],
			}],
		};

		const requirements = broadcastGraphicTemplatePackageRequirements(
			graphic as unknown as Parameters<typeof broadcastGraphicTemplatePackageRequirements>[0],
		);
		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: { identity: graphic.id, name: graphic.name, document: graphic },
			assets: requirements.assets,
			capabilities: requirements.capabilities,
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const declared = result.package.manifest.applicationCapabilities
			.filter(capability => capability.capability === 'graphic-item-definition')
			.map(capability => capability.identity)
			.sort();
		// The group itself plus both of its children, not the group alone.
		expect(declared).toEqual(['group', 'shape', 'text']);
	});

	it('embeds the assets Media Graphic Items pin, including inside a Graphic Group', async () => {
		// Media Graphic Items are the Shared Graphics Foundation's asset-bearing
		// vocabulary. A Broadcast Graphic Template that places one must package the
		// exact revision it pins, or the package installs a Template with a
		// dangling field — and a group's children pin them just as its top level does.
		const { library } = createExportLibrary();
		const backdrop = await ingestImage(library, 'Backdrop', transparentPixelPng);
		const insert = await ingestImage(library, 'Insert', webpPixel, 'image/webp');

		const graphic = {
			id: 'media-lower-third',
			name: 'Media lower third',
			items: [
				{
					id: 'backdrop',
					type: 'media' as const,
					label: 'Backdrop',
					visible: true,
					anchor: 'top-left' as const,
					x: 0,
					y: 0,
					width: 1920,
					height: 1080,
					asset: backdrop,
					mediaKind: 'image' as const,
					fit: 'cover' as const,
					focalPosition: { x: 0.5, y: 0.5 },
					opacity: 1,
				},
				{
					id: 'stack',
					type: 'group' as const,
					label: 'Stack',
					visible: true,
					anchor: 'top-left' as const,
					x: 0,
					y: 0,
					width: 800,
					height: 200,
					arrangement: 'column' as const,
					padding: 0,
					gap: 8,
					align: 'start' as const,
					justify: 'start' as const,
					clip: false,
					geometry: { cornerRadius: 0 },
					children: [{
						id: 'nested-insert',
						type: 'media' as const,
						label: 'Insert',
						visible: true,
						anchor: 'top-left' as const,
						x: 0,
						y: 0,
						width: 400,
						height: 200,
						asset: insert,
						mediaKind: 'image' as const,
						fit: 'contain' as const,
						focalPosition: { x: 0.5, y: 0.5 },
						opacity: 1,
					}],
				},
			],
		};

		const requirements = broadcastGraphicTemplatePackageRequirements(
			graphic as unknown as Parameters<typeof broadcastGraphicTemplatePackageRequirements>[0],
		);
		expect(requirements.assets.map(asset => asset.reference)).toEqual([backdrop, insert]);

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: { identity: graphic.id, name: graphic.name, document: graphic },
			assets: requirements.assets,
			capabilities: requirements.capabilities,
		});

		expect(result.outcome).toBe('exported');
		if (result.outcome !== 'exported')
			return;
		const archive = readStoredZipArchive(await collectStream(result.package.open()));
		const manifest = archive.json<TemplatePackageManifest>('manifest.json');
		expect(manifest.packagedAssets).toHaveLength(2);
		expect(manifest.packagedAssets.map(packaged => packaged.origin.sourceRevisionId).sort())
			.toEqual([backdrop.revisionId, insert.revisionId].sort());
		// The slots name the exact items an author would go and repair.
		expect(manifest.packagedAssets.flatMap(packaged => packaged.requiredBy).sort())
			.toEqual(['items.backdrop.asset', 'items.stack.children.nested-insert.asset']);
	});

	it('keeps authored display copy that mentions a URL exportable', async () => {
		const { library } = createExportLibrary();

		const result = await library.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: {
				identity: 'template-13',
				name: 'Authored copy',
				document: {
					items: [{
						id: 'headline',
						type: 'text',
						label: 'Call to action',
						text: 'Visit https://team.example.com for the full bracket',
					}],
				},
			},
			assets: [],
		});

		// Display text is data the renderer draws, not a resource it fetches.
		expect(result.outcome).toBe('exported');
	});

	it('still blocks a remote resource in a position a renderer would fetch', async () => {
		const { library } = createExportLibrary();
		const cases = [
			['frame.mediaBackground.url', { frame: { mediaBackground: { url: 'https://cdn.example.com/loop.mp4' } } }],
			['items[0].posterUrl', { items: [{ posterUrl: 'https://cdn.example.com/poster.png' }] }],
			['frame.gradient', { frame: { gradient: 'linear-gradient(#000, url(https://cdn.example.com/x.png))' } }],
			['items[0].sources[0]', { items: [{ sources: ['https://cdn.example.com/a.mp4'] }] }],
			['frame.backgroundUrl', { frame: { backgroundUrl: '//cdn.example.com/loop.mp4' } }],
			// A resource field is one whatever convention named it.
			['items[0].image_url', { items: [{ image_url: 'https://cdn.example.com/a.png' }] }],
			['items[0].IMAGE_URL', { items: [{ IMAGE_URL: 'https://cdn.example.com/b.png' }] }],
			['items[0].image-url', { items: [{ 'image-url': 'https://cdn.example.com/c.png' }] }],
			['items[0].srcset', { items: [{ srcset: 'https://cdn.example.com/d.png 2x' }] }],
		] as const;

		for (const [slot, document] of cases) {
			const result = await library.exportTemplatePackage({
				packageKind: 'sklayout',
				template: { identity: 'template-14', name: 'Remote dependency', document },
				assets: [],
			});
			expect(result.outcome, slot).toBe('rejected');
			if (result.outcome !== 'rejected')
				continue;
			expect(result.report.issues).toEqual([
				expect.objectContaining({ code: 'remote-resource-dependency', slot }),
			]);
		}
	});

	it('blocks an inline payload wherever it was authored', async () => {
		const { library } = createExportLibrary();
		const cases = [
			['frame.backgroundImage', { frame: { backgroundImage: 'data:image/png;base64,iVBORw0KGgo=' } }],
			// Not a resource-shaped field: an inline payload is refused anyway,
			// because a package carries no undeclared files.
			['items[0].label', { items: [{ label: 'data:image/png;base64,iVBORw0KGgo=' }] }],
			['items[0].caption', { items: [{ caption: 'blob:https://example.com/9f3c' }] }],
		] as const;

		for (const [slot, document] of cases) {
			const result = await library.exportTemplatePackage({
				packageKind: 'sklayout',
				template: { identity: 'template-16', name: 'Inline payload', document },
				assets: [],
			});
			expect(result.outcome, slot).toBe('rejected');
			if (result.outcome !== 'rejected')
				continue;
			expect(result.report.issues).toEqual([
				expect.objectContaining({ code: 'undeclared-graphic-asset-dependency', slot }),
			]);
		}
	});

	it('reports a missing reference and an envelope limit in the same report', async () => {
		const { library } = createExportLibrary();
		const assets: { slot: string; reference: GraphicAssetReference }[] = [];
		for (let index = 0; index < 101; index += 1) {
			const reference = await ingestImage(library, `Bulk ${index}`, transparentPixelPng);
			assets.push({ slot: `items[${index}].asset`, reference });
		}
		assets.push({
			slot: 'items[999].asset',
			reference: {
				assetId: assets[0]!.reference.assetId,
				revisionId: 'revision-that-never-existed' as GraphicAssetRevisionId,
			},
		});

		const result = await library.exportTemplatePackage({
			packageKind: 'sklayout',
			template: { identity: 'template-15', name: 'Two problem classes', document: {} },
			assets,
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		const codes = result.report.issues.map(issue => issue.code);
		expect(codes).toContain('missing-graphic-asset-reference');
		expect(codes).toContain('packaged-revision-limit-exceeded');
	});

	it('exposes no storage-provider detail to either package consumer', async () => {
		const { library } = createExportLibrary();
		const logo = await ingestImage(library, 'Logo', transparentPixelPng);

		for (const packageKind of TEMPLATE_PACKAGE_KINDS) {
			const result = await library.exportTemplatePackage({
				packageKind,
				template: { identity: `template-9-${packageKind}`, name: 'Provider independence', document: { logo } },
				assets: [{ slot: 'logo', reference: logo }],
			});
			expect(result.outcome).toBe('exported');
			if (result.outcome !== 'exported')
				continue;
			const archive = readStoredZipArchive(await collectStream(result.package.open()));
			const serialised = JSON.stringify(result.package.manifest) + archive.entryNames.join(' ');
			const digest = digestOf(transparentPixelPng);
			// The canonical object identity for these exact bytes. The digest is a
			// published integrity fact, but the key that addresses the object store
			// is not, so assert on the whole identity rather than on the digest.
			const canonicalObjectKey = `sha256/${digest}`;
			expect(serialised).toContain(digest);
			expect(serialised).not.toContain(canonicalObjectKey);
			expect(archive.entryNames).toContain(`content/sha256-${digest}.bin`);
			expect(serialised).not.toMatch(/GRAPHICS_ASSET_(?:CANONICAL|STAGING)/);
			expect(serialised).not.toMatch(/ingestion\//);
			expect(serialised).not.toMatch(/\br2\b/i);
		}
	});
});

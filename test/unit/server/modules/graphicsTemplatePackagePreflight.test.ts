import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackagePreflightIssueCode,
	TemplatePackagePreflightReport,
} from '~~/shared/types/templatePackage';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { TEMPLATE_PACKAGE_LIMITS } from '~~/shared/types/templatePackage';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
	writeTestArchive,
} from '../../../helpers/templatePackageArchive';

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));
const webpPixel = Uint8Array.from(Buffer.from(
	'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAEAdQlFKUp4CBiOh/AAA=',
	'base64',
));
const sixteenPixelPosterPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAHUlEQVR4nGP8x8Dwn4ECwEKJ5lEDRg0YNWAwGQAAkU4CO63xbeIAAAAASUVORK5CYII=',
	'base64',
));
const vp9Webm = Uint8Array.from(Buffer.from(
	'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggH27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAyV0GNTGF2ZjYyLjEyLjEwMkSJiECPQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYhkRqj8GKbqBJyBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhB3NZQDgkLCBELqBEJqBAlWwhFW5gQESVMNnQIBzc6BjwIBnyJpFo4dFTkNPREVSRIeNTGF2ZjYyLjEyLjEwMnNz2mPAi2PFiGRGqPwYpuoEZ8ilRaOHRU5DT0RFUkSHmExhdmM2Mi4yOC4xMDIgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDEuMDAwMDAwMDAwAB9DtnXG54EAo6yBAACAgkmDQgAA8AD2ADgkHBhCAAAwcAAASqf/+5CBv///CAg////7iYcAAKOTgQH0AIYAQJKcAElAAAMgAABCQBxTu2uRu4+zgQC3iveBAfGCAavwgQM=',
	'base64',
));

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Playback validation is a controlled adapter, exactly as the shared ingestion
 * suites drive it. Preflight uses it to prove a packaged silent video the same
 * way an uploaded one is proven.
 */
function acceptEverySilentVideo() {
	return {
		validate: async (input: {
			operationId: string;
			idempotencyKey: string;
			sourceDigest: string;
			factsDigest: string;
			inspectedFacts: {
				width: number;
				height: number;
				durationSeconds: number;
				posterTimeSeconds: number;
			};
		}) => ({
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

function createLibrary(label: string) {
	let nextIdentity = 0;
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const staging = createInMemoryStagingGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging,
		canonical,
		silentVideoPlaybackValidator: acceptEverySilentVideo(),
		now: () => new Date('2026-07-30T09:00:00.000Z'),
		generateIdentity: () => `${label}-identity-${++nextIdentity}`,
	});
	return { library, canonical, staging };
}

type Library = ReturnType<typeof createLibrary>['library'];

async function ingestImage(
	library: Library,
	name: string,
	bytes: Uint8Array = transparentPixelPng,
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

async function ingestSilentVideo(library: Library, name: string): Promise<GraphicAssetReference> {
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

async function ingestStaticFont(library: Library, name: string): Promise<GraphicAssetReference> {
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

/** Exports one package from `library` and returns its exact archive bytes. */
async function exportPackage(
	library: Library,
	input: {
		document?: unknown;
		assets: { slot: string; reference: GraphicAssetReference }[];
		templateName?: string;
	},
): Promise<Uint8Array> {
	const result = await library.exportTemplatePackage({
		packageKind: 'skgraphic',
		template: {
			identity: 'template-1',
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
	options: { sourceFileName?: string | null } = {},
) {
	const operation = await library.initiateTemplatePackagePreflight({
		idempotencyKey: `preflight-${++preflightSequence}`,
		initiatedBy: 'package-author',
		sourceFileName: options.sourceFileName === null
			? undefined
			: options.sourceFileName ?? 'lower-third.skgraphic',
		declaredByteLength: archive.byteLength,
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

function reportOf(operation: { templatePackagePreflight?: TemplatePackagePreflightReport }) {
	if (!operation.templatePackagePreflight)
		throw new Error('Expected the operation to carry a Template Package preflight report');
	return operation.templatePackagePreflight;
}

function codes(report: TemplatePackagePreflightReport): TemplatePackagePreflightIssueCode[] {
	return report.issues.map(issue => issue.code);
}

beforeEach(() => {
	preflightSequence = 0;
});

describe('the Template Package preflight contract', () => {
	it('maps a package exported from this installation back to its exact origins', async () => {
		const { library } = createLibrary('sender');
		const backdrop = await ingestImage(library, 'Backdrop');
		const archive = await exportPackage(library, {
			assets: [{ slot: 'backdrop', reference: backdrop }],
		});

		const operation = await preflight(library, archive);
		const report = reportOf(operation);

		expect(report.outcome).toBe('ready');
		expect(report.issues).toEqual([]);
		expect(operation.stage).toBe('awaiting-installation');
		expect(report.mappings).toHaveLength(1);
		expect(report.mappings[0]).toMatchObject({
			proposal: 'reuse-graphic-asset-revision',
			basis: 'exact-origin',
			reference: backdrop,
			canonicalGrowthBytes: 0,
			contentAlreadyStored: true,
		});
		// Reusing an exact origin adds nothing at all to canonical storage.
		expect(report.quota.canonicalGrowthBytes).toBe(0);
	});

	it('revalidates every embedded source under this installation\'s current profiles', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const motion = await ingestSilentVideo(sender, 'Motion');
		const face = await ingestStaticFont(sender, 'Face');
		const archive = await exportPackage(sender, {
			assets: [
				{ slot: 'backdrop', reference: backdrop },
				{ slot: 'motion', reference: motion },
				{ slot: 'face', reference: face },
			],
		});

		const { library: receiver } = createLibrary('receiver');
		const report = reportOf(await preflight(receiver, archive));

		// Each embedded source was judged under the receiver's own profile for its
		// kind, not under whatever profile the sender recorded.
		expect(report.compatibilityProfiles).toEqual([
			'silent-video-v1',
			'static-font-v1',
			'still-image-v1',
		]);
		expect(report.mappings).toHaveLength(3);
		// Nothing in the receiving library matches, so every packaged identity
		// becomes a separate local Graphic Asset carrying new content.
		expect(report.mappings.every(mapping =>
			mapping.proposal === 'create-graphic-asset' && mapping.basis === 'new-content',
		)).toBe(true);
	});

	it('rejects packaged content that fails the receiver\'s compatibility profile', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const parts = readTemplatePackageParts(
			await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
		);
		// The bytes are replaced and the manifest is told the truth about their
		// digest, so the only thing left to reject them is local validation.
		const notAnImage = new TextEncoder().encode('this is not an image at all, truly');
		const replacedDigest = digestOf(notAnImage);
		const original = parts.contents[0]!;
		parts.contents = [{ name: `content/sha256-${replacedDigest}.bin`, bytes: notAnImage }];
		parts.manifest.contents = [{
			...parts.manifest.contents[0]!,
			digest: replacedDigest,
			byteLength: notAnImage.byteLength,
			entry: `content/sha256-${replacedDigest}.bin`,
		}];
		parts.manifest.packagedAssets = [{
			...parts.manifest.packagedAssets[0]!,
			origin: { ...parts.manifest.packagedAssets[0]!.origin, digest: replacedDigest },
			integrity: {
				...parts.manifest.packagedAssets[0]!.integrity,
				digest: replacedDigest,
				byteLength: notAnImage.byteLength,
			},
			content: { entry: `content/sha256-${replacedDigest}.bin` },
		}];
		expect(original.bytes).not.toEqual(notAnImage);

		const { library: receiver } = createLibrary('receiver');
		const operation = await preflight(receiver, writeTemplatePackage(parts));
		const report = reportOf(operation);

		expect(report.outcome).toBe('rejected');
		expect(codes(report)).toContain('incompatible-graphic-asset-content');
		expect(operation.stage).toBe('failed');
		expect(operation.failure).toMatchObject({ retryable: false });
	});

	it('rejects packaged content whose bytes do not match its recorded digest', async () => {
		const { library: sender } = createLibrary('sender');
		const backdrop = await ingestImage(sender, 'Backdrop');
		const parts = readTemplatePackageParts(
			await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
		);
		// The entry keeps its declared name and size but carries other bytes.
		parts.contents[0] = {
			name: parts.contents[0]!.name,
			bytes: webpPixel.slice(0, parts.contents[0]!.bytes.byteLength),
		};

		const { library: receiver } = createLibrary('receiver');
		const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(codes(report)).toContain('package-content-digest-mismatch');
	});

	describe('archive safety', () => {
		async function validParts() {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			return readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
		}

		async function rejectionCodes(archive: Uint8Array) {
			const { library: receiver } = createLibrary('receiver');
			const operation = await preflight(receiver, archive);
			const report = reportOf(operation);
			expect(report.outcome).toBe('rejected');
			expect(operation.stage).toBe('failed');
			return codes(report);
		}

		it('rejects an entry that traverses outside the archive', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{ name: '../escaped.json', bytes: new Uint8Array([1]) }],
			}))).toContain('package-entry-path-traversal');
		});

		it.each([
			['an absolute path', '/etc/passwd'],
			['a Windows path', 'C:\\windows\\system32'],
			['a directory entry', 'nested/'],
		])('rejects %s', async (_label, name) => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{ name, bytes: new Uint8Array([1]) }],
			}))).toContain('unsafe-package-entry-path');
		});

		it('rejects a link entry', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{
					name: 'link.bin',
					bytes: new TextEncoder().encode('/etc/passwd'),
					// A Unix symlink mode in the high half of the external attributes.
					externalAttributes: 0xA1FF0000,
				}],
			}))).toContain('package-entry-link');
		});

		it('rejects entry paths that collide only by case', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{ name: 'Manifest.JSON', bytes: new Uint8Array([1]) }],
			}))).toContain('duplicate-package-entry-path');
		});

		it('rejects an encrypted entry', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{
					name: 'secret.bin',
					bytes: new Uint8Array([1]),
					generalPurposeFlags: 0x0809,
				}],
			}))).toContain('encrypted-package-entry');
		});

		it('rejects a compressed entry', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{
					name: 'squeezed.bin',
					bytes: new Uint8Array([1]),
					compressionMethod: 8,
				}],
			}))).toContain('compressed-package-entry');
		});

		it('rejects an entry that disagrees with itself about its size', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{
					name: 'lying.bin',
					bytes: new Uint8Array([1, 2, 3, 4]),
					declaredUncompressedSize: 64,
				}],
			}))).toContain('inconsistent-package-entry-size');
		});

		it('rejects an entry the manifest never declares', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				extraEntries: [{ name: 'extra.bin', bytes: new Uint8Array([1]) }],
			}))).toContain('undeclared-package-entry');
		});

		it('rejects content the manifest declares but the archive omits', async () => {
			const parts = await validParts();
			const contents = parts.contents;
			parts.contents = [];
			expect(contents).toHaveLength(1);
			expect(await rejectionCodes(writeTemplatePackage(parts)))
				.toContain('missing-package-entry');
		});

		it('rejects a nested archive travelling as packaged content', async () => {
			const parts = await validParts();
			const nested = writeTestArchive([{ name: 'inner.bin', bytes: new Uint8Array([1, 2]) }]);
			const nestedDigest = digestOf(nested);
			parts.contents = [{ name: `content/sha256-${nestedDigest}.bin`, bytes: nested }];
			parts.manifest.contents = [{
				...parts.manifest.contents[0]!,
				digest: nestedDigest,
				byteLength: nested.byteLength,
				entry: `content/sha256-${nestedDigest}.bin`,
			}];
			parts.manifest.packagedAssets = [{
				...parts.manifest.packagedAssets[0]!,
				origin: { ...parts.manifest.packagedAssets[0]!.origin, digest: nestedDigest },
				integrity: {
					...parts.manifest.packagedAssets[0]!.integrity,
					digest: nestedDigest,
					byteLength: nested.byteLength,
				},
				content: { entry: `content/sha256-${nestedDigest}.bin` },
			}];

			expect(await rejectionCodes(writeTemplatePackage(parts)))
				.toContain('nested-package-archive');
		});

		it('rejects bytes appended after the archive ends', async () => {
			const parts = await validParts();
			expect(await rejectionCodes(writeTemplatePackage(parts, {
				trailingBytes: new TextEncoder().encode('smuggled'),
			}))).toContain('malformed-package-archive');
		});

		it('rejects an archive that is not readable at all', async () => {
			expect(await rejectionCodes(new TextEncoder().encode('definitely not a zip archive')))
				.toContain('malformed-package-archive');
		});
	});

	describe('envelope limits', () => {
		it('refuses to initiate a package beyond the received archive limit', async () => {
			const { library } = createLibrary('receiver');
			await expect(library.initiateTemplatePackagePreflight({
				idempotencyKey: 'oversized',
				initiatedBy: 'package-author',
				declaredByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength + 1,
			})).rejects.toMatchObject({ code: 'invalid-ingestion-input' });
		});

		it('accepts a declared length at exactly the received archive limit', async () => {
			const { library } = createLibrary('receiver');
			const operation = await library.initiateTemplatePackagePreflight({
				idempotencyKey: 'at-the-limit',
				initiatedBy: 'package-author',
				declaredByteLength: TEMPLATE_PACKAGE_LIMITS.maximumArchiveByteLength,
			});
			expect(operation.stage).toBe('created');
			expect(operation.source).toBe('template-package');
		});

		it('rejects an archive declaring more entries than a package may carry', async () => {
			const entries = Array.from(
				{ length: TEMPLATE_PACKAGE_LIMITS.maximumEntryCount + 1 },
				(_unused, index) => ({
					name: `content/entry-${index}.bin`,
					bytes: new Uint8Array([index % 256]),
				}),
			);
			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTestArchive(entries)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('package-entry-limit-exceeded');
			expect(report.limits).toEqual(TEMPLATE_PACKAGE_LIMITS);
		});

		it('rejects a manifest declaring more packaged revisions than the limit allows', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			const template = parts.manifest.packagedAssets[0]!;
			parts.manifest.packagedAssets = Array.from(
				{ length: TEMPLATE_PACKAGE_LIMITS.maximumPackagedRevisionCount + 1 },
				(_unused, index) => ({
					...template,
					packagedId: `packaged-asset-${index}`,
					origin: { ...template.origin, sourceRevisionId: `revision-${index}` },
				}),
			);

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('packaged-revision-limit-exceeded');
		});
	});

	describe('artifact and Template declarations', () => {
		it('rejects a package whose declared Template kind contradicts its artifact', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			(parts.manifest as { templateKind: string }).templateKind = 'feature-match-layout-template';

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('unsupported-package-artifact');
		});

		it('rejects a received file name that contradicts the declared artifact', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(
				await preflight(receiver, archive, { sourceFileName: 'layout.sklayout' }),
			);

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('unsupported-package-artifact');
		});

		it('rejects a package embedding an asset its Template never requires', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			// The document names nothing, so the declared asset is dead weight.
			const archive = await exportPackage(sender, {
				document: { title: 'Lower third' },
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, archive));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('unused-packaged-graphic-asset');
		});

		it('rejects a Template requiring content the package never embedded', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			parts.template = {
				...(parts.template as Record<string, unknown>),
				logo: { assetId: 'never-packaged', revisionId: 'never-packaged-revision' },
			};

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('undeclared-graphic-asset-dependency');
		});

		it('rejects a Template document carrying executable content', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			parts.template = {
				...(parts.template as Record<string, unknown>),
				caption: '<script>steal()</script>',
			};

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('executable-template-content');
		});

		it('rejects a Template document depending on a remote resource', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			parts.template = {
				...(parts.template as Record<string, unknown>),
				overlayImage: 'https://cdn.example.com/overlay.png',
			};

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('remote-resource-dependency');
		});
	});

	describe('schema versions', () => {
		function retry(library: Library, operationId: string) {
			return library.retryGraphicsIngestion({
				operationId: operationId as never,
				initiatedBy: 'package-author',
			});
		}

		it('permanently rejects a schema version newer than this installation reads', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			(parts.manifest as { schemaVersion: number }).schemaVersion = 99;

			const { library: receiver } = createLibrary('receiver');
			const operation = await preflight(receiver, writeTemplatePackage(parts));
			const report = reportOf(operation);

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('unsupported-package-schema-version');
			expect(operation.failure).toMatchObject({ retryable: false });
			// A permanently rejected package cannot be retried into existence.
			await expect(retry(receiver, operation.id)).rejects.toMatchObject({
				code: 'ingestion-operation-not-uploadable',
			});
		});

		it('reports the schema it read and that no migration was needed', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, archive));

			expect(report.schema).toEqual({ received: 1, supported: 1, migrated: false });
		});
	});

	describe('origin-aware mapping proposals', () => {
		it('creates a separate Graphic Asset that reuses bytes already stored here', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});

			// The receiver already holds these exact bytes under its own provenance.
			const { library: receiver } = createLibrary('receiver');
			await ingestImage(receiver, 'Locally uploaded backdrop');
			const operation = await preflight(receiver, archive);
			const report = reportOf(operation);

			expect(report.outcome).toBe('requires-confirmation');
			expect(operation.stage).toBe('awaiting-confirmation');
			expect(report.mappings[0]).toMatchObject({
				proposal: 'create-graphic-asset',
				basis: 'shared-content-digest',
				contentAlreadyStored: true,
				canonicalGrowthBytes: 0,
				localName: 'Locally uploaded backdrop',
			});
			expect(codes(report)).toContain('graphic-asset-created-from-shared-content');
		});

		it('creates a separate Graphic Asset for a related revision of a known source', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			// Same source asset, a revision this installation does not hold.
			const packaged = parts.manifest.packagedAssets[0]!;
			parts.manifest.packagedAssets = [{
				...packaged,
				origin: { ...packaged.origin, sourceRevisionId: 'a-revision-never-seen-here' },
			}];
			parts.template = { backdrop: {
				assetId: packaged.origin.sourceAssetId,
				revisionId: 'a-revision-never-seen-here',
			} };

			const operation = await preflight(sender, writeTemplatePackage(parts));
			const report = reportOf(operation);

			expect(report.mappings[0]).toMatchObject({
				proposal: 'create-graphic-asset',
				basis: 'related-origin-revision',
			});
			expect(codes(report)).toContain('graphic-asset-created-from-related-origin');
			expect(operation.stage).toBe('awaiting-confirmation');
		});

		it('rejects the complete package when an exact origin claims different content', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const other = await ingestImage(sender, 'Other', webpPixel, 'image/webp');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'other', reference: other }] }),
			);
			// The package claims the backdrop's exact provenance while carrying the
			// other asset's content, which is provenance this library already owns.
			const packaged = parts.manifest.packagedAssets[0]!;
			parts.manifest.packagedAssets = [{
				...packaged,
				origin: {
					...packaged.origin,
					sourceAssetId: backdrop.assetId,
					sourceRevisionId: backdrop.revisionId,
					digest: packaged.integrity.digest,
				},
			}];
			parts.template = { other: backdrop };

			const operation = await preflight(sender, writeTemplatePackage(parts));
			const report = reportOf(operation);

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('immutable-origin-digest-conflict');
			expect(operation.failure).toMatchObject({ retryable: false });
		});

		it('stores shared bytes once while keeping distinct packaged identities apart', async () => {
			const { library: sender } = createLibrary('sender');
			const first = await ingestImage(sender, 'First');
			const second = await ingestImage(sender, 'Second');
			const archive = await exportPackage(sender, {
				assets: [
					{ slot: 'first', reference: first },
					{ slot: 'second', reference: second },
				],
			});

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, archive));

			expect(report.mappings).toHaveLength(2);
			expect(report.observed.uniqueContentCount).toBe(1);
			expect(report.mappings.every(mapping =>
				mapping.proposal === 'create-graphic-asset',
			)).toBe(true);
			// Two Graphic Assets, one set of bytes: only one mapping is charged for
			// them, so the quota reflects what would actually be stored.
			const growth = report.mappings.map(mapping => mapping.canonicalGrowthBytes);
			expect(growth.filter(bytes => bytes > 0)).toHaveLength(1);
			expect(Math.max(...growth)).toBe(transparentPixelPng.byteLength);
		});
	});

	describe('the report-bound confirmation gate', () => {
		async function pausedPackage() {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver, staging } = createLibrary('receiver');
			await ingestImage(receiver, 'Locally uploaded backdrop');
			const operation = await preflight(receiver, archive);
			expect(operation.stage).toBe('awaiting-confirmation');
			return { receiver, staging, operation, archive };
		}

		it('pauses once and advances on a confirmation bound to the report', async () => {
			const { receiver, operation } = await pausedPackage();
			const report = reportOf(operation);

			const confirmed = await receiver.confirmTemplatePackagePreflight({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				fingerprint: report.fingerprint,
			});

			expect(confirmed.stage).toBe('awaiting-installation');
			expect(reportOf(confirmed).fingerprint).toBe(report.fingerprint);
		});

		it('refuses a confirmation that does not match the current report', async () => {
			const { receiver, operation } = await pausedPackage();

			await expect(receiver.confirmTemplatePackagePreflight({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				fingerprint: 'a'.repeat(64),
			})).rejects.toMatchObject({ code: 'invalid-ingestion-input' });

			const unchanged = await receiver.getIngestionOperation({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});
			expect(unchanged.stage).toBe('awaiting-confirmation');
		});

		it('gives different bytes a different fingerprint', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const other = await ingestImage(sender, 'Other', webpPixel, 'image/webp');
			const { library: receiver } = createLibrary('receiver');

			const first = reportOf(await preflight(receiver, await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			})));
			const second = reportOf(await preflight(receiver, await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: other }],
			})));

			expect(first.fingerprint).not.toBe(second.fingerprint);
		});

		it('reaches the same fingerprint when a retry reaches the same conclusion', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver } = createLibrary('receiver');
			await ingestImage(receiver, 'Locally uploaded backdrop');

			const operation = await preflight(receiver, archive);
			const before = reportOf(operation).fingerprint;
			const confirmed = await receiver.confirmTemplatePackagePreflight({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				fingerprint: before,
			});
			expect(confirmed.stage).toBe('awaiting-installation');

			// Re-running preflight over the same staged bytes must not ask again.
			const separate = reportOf(await preflight(receiver, archive));
			expect(separate.fingerprint).toBe(before);
		});

		it('does not pause a proposal that carries nothing to confirm', async () => {
			const { library } = createLibrary('sender');
			const backdrop = await ingestImage(library, 'Backdrop');
			const operation = await preflight(library, await exportPackage(library, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			}));

			expect(reportOf(operation).outcome).toBe('ready');
			expect(operation.stage).toBe('awaiting-installation');
			await expect(library.confirmTemplatePackagePreflight({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				fingerprint: reportOf(operation).fingerprint,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
		});
	});

	describe('durable cancellation and retry', () => {
		it('cancels a paused package idempotently and releases its staged bytes', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver, staging } = createLibrary('receiver');
			await ingestImage(receiver, 'Locally uploaded backdrop');
			const operation = await preflight(receiver, archive);
			expect(operation.stage).toBe('awaiting-confirmation');

			const cancelled = await receiver.cancelGraphicsIngestion({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});
			const again = await receiver.cancelGraphicsIngestion({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
			});

			expect(cancelled.stage).toBe('cancelled');
			expect(again.stage).toBe('cancelled');
			const staged = await staging.readMetadata(
				graphicsObjectIdentity(`ingestion/${operation.id}/source`),
			);
			expect(staged.outcome).toBe('missing');
			// Cancellation cannot leave a confirmable proposal behind.
			await expect(receiver.confirmTemplatePackagePreflight({
				operationId: operation.id,
				initiatedBy: operation.initiatedBy,
				fingerprint: reportOf(cancelled).fingerprint,
			})).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
		});

		it('resumes from durably staged bytes after a transient staging failure', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver, staging } = createLibrary('receiver');

			staging.injectTransientFailure('read', 1);
			const failed = await preflight(receiver, archive);
			expect(failed.stage).toBe('failed');
			expect(failed.failure).toMatchObject({ retryable: true });

			const retried = await receiver.retryGraphicsIngestion({
				operationId: failed.id,
				initiatedBy: failed.initiatedBy,
			});

			expect(retried.stage).toBe('awaiting-installation');
			expect(reportOf(retried).outcome).toBe('ready');
		});

		it('publishes nothing discoverable while a package is only preflighted', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver } = createLibrary('receiver');

			const operation = await preflight(receiver, archive);

			expect(operation.stage).toBe('awaiting-installation');
			expect(reportOf(operation).mappings).toHaveLength(1);
			// The proposal exists, the Graphic Asset it proposes does not.
			expect(await receiver.listGraphicAssets({})).toEqual([]);
			expect(await receiver.listGraphicAssets({
				lifecycleStates: ['active', 'retired', 'trashed'],
			})).toEqual([]);
		});
	});

	describe('the complete report', () => {
		it('reports mappings, quota, limits, and observed totals together', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const face = await ingestStaticFont(sender, 'Face');
			const archive = await exportPackage(sender, {
				assets: [
					{ slot: 'backdrop', reference: backdrop },
					{ slot: 'face', reference: face },
				],
			});
			const { library: receiver } = createLibrary('receiver');

			const report = reportOf(await preflight(receiver, archive));

			expect(report).toMatchObject({
				packageKind: 'skgraphic',
				templateIdentity: 'template-1',
				templateName: 'Lower third',
				outcome: 'ready',
				limits: TEMPLATE_PACKAGE_LIMITS,
			});
			expect(report.observed).toMatchObject({
				entryCount: 4,
				packagedAssetCount: 2,
				packagedRevisionCount: 2,
				uniqueContentCount: 2,
				archiveByteLength: archive.byteLength,
			});
			expect(report.quota.canonicalGrowthBytes).toBeGreaterThan(0);
			expect(report.quota.canonicalLimitBytes).toBeGreaterThan(0);
			expect(report.mappings.map(mapping => mapping.kind).sort())
				.toEqual(['font', 'image']);
			expect(report.checkedAt).toBe('2026-07-30T09:00:00.000Z');
		});

		it('reports every blocking problem together rather than only the first', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const parts = readTemplatePackageParts(
				await exportPackage(sender, { assets: [{ slot: 'backdrop', reference: backdrop }] }),
			);
			parts.template = {
				...(parts.template as Record<string, unknown>),
				caption: '<script>steal()</script>',
				overlayImage: 'https://cdn.example.com/overlay.png',
			};

			const { library: receiver } = createLibrary('receiver');
			const report = reportOf(await preflight(receiver, writeTemplatePackage(parts)));

			expect(codes(report)).toEqual(
				expect.arrayContaining(['executable-template-content', 'remote-resource-dependency']),
			);
			// Every issue names what to do about it, not just what went wrong.
			expect(report.issues.every(issue => issue.remediation.length > 0)).toBe(true);
			expect(report.issues.every(issue => issue.severity === 'error')).toBe(true);
		});

		it('blocks a package that would grow canonical storage past its quota', async () => {
			const { library: sender } = createLibrary('sender');
			const backdrop = await ingestImage(sender, 'Backdrop');
			const archive = await exportPackage(sender, {
				assets: [{ slot: 'backdrop', reference: backdrop }],
			});
			const { library: receiver } = createLibrary('receiver');
			await receiver.updateCapacityLimits({
				canonicalLimitBytes: 1,
				stagingLimitBytes: 10 * 1024 * 1024,
			});

			const operation = await preflight(receiver, archive);
			const report = reportOf(operation);

			expect(report.outcome).toBe('rejected');
			expect(codes(report)).toContain('canonical-capacity-blocked');
			// Capacity is the one blocking condition an installation can itself fix.
			expect(operation.failure).toMatchObject({ retryable: true });
			expect(report.issues.find(issue => issue.code === 'canonical-capacity-blocked'))
				.toMatchObject({ retryable: true });
		});
	});
});

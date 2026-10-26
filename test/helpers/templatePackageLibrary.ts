/**
 * Template Package suites: a sender or receiver Graphics Asset Library, the
 * revisions a package carries, and the export → preflight → install steps.
 */
import type { SilentVideoPlaybackValidator } from '~~/server/modules/graphics-asset-library/silent-video-playback-validator';
import type { GraphicAssetReference, GraphicsIngestionOperation } from '~~/shared/types/graphicsAsset';
import type { TemplatePackagePreflightIssueCode, TemplatePackagePreflightReport } from '~~/shared/types/templatePackage';
import { readFile } from 'node:fs/promises';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { MAX_SILENT_VIDEO_POSTER_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';
import { digestOf, pixelPng, sixteenPixelPng, vp9Webm } from '~~/test/helpers/graphicsFixtures';
import { boundedBytes } from '~~/test/helpers/graphicsLibrary';
import { collectStream } from '~~/test/helpers/storedZipArchive';
import { acceptEveryTemplateDocument } from '~~/test/helpers/templatePackagePayload';

/** A playback validator that accepts every silent video with a 16×16 poster. */
export function acceptEverySilentVideo(): SilentVideoPlaybackValidator {
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
			posterDigest: digestOf(sixteenPixelPng),
			poster: createBoundedByteStream(sixteenPixelPng, {
				byteLength: sixteenPixelPng.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_POSTER_BYTES,
			}),
		}),
	};
}

type LibraryDependencies = Parameters<typeof createGraphicsAssetLibrary>[0];

/** An in-memory library minting `<label>-identity-N`, at a fixed instant. */
export function createPackageLibrary(label: string, dependencies: Partial<LibraryDependencies> = {}) {
	let nextIdentity = 0;
	const canonical = createInMemoryCanonicalGraphicsObjectStore();
	const staging = createInMemoryStagingGraphicsObjectStore();
	const library = createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging,
		canonical,
		silentVideoPlaybackValidator: acceptEverySilentVideo(),
		templatePayloads: acceptEveryTemplateDocument(),
		now: () => new Date('2026-07-30T09:00:00.000Z'),
		generateIdentity: () => `${label}-identity-${++nextIdentity}`,
		...dependencies,
	});
	return { library, canonical, staging };
}

export type PackageLibrary = ReturnType<typeof createGraphicsAssetLibrary>;

let sequence = 0;
const author = 'package-author';

function published(operation: GraphicsIngestionOperation): GraphicAssetReference {
	if (!operation.result)
		throw new Error(`Ingestion did not publish: ${JSON.stringify(operation.failure ?? operation.stage)}`);
	return { assetId: operation.result.assetId, revisionId: operation.result.revisionId };
}

export async function ingestPackageImage(
	library: PackageLibrary,
	name: string,
	bytes: Uint8Array = pixelPng,
	mime: 'image/png' | 'image/webp' = 'image/png',
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++sequence}`,
		initiatedBy: author,
		name,
		sourceFileName: mime === 'image/png'
			? `${name}.png`
			: `${name}.webp`,
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
	return published(await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: mime,
		bytes: boundedBytes(bytes),
	}));
}

/** A second source revision of `reference`, decoded at `dimensions`. */
export async function replacePackageImage(
	library: PackageLibrary,
	reference: GraphicAssetReference,
	bytes: Uint8Array,
	dimensions = { width: 16, height: 16 },
): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicAssetReplacement({
		assetId: reference.assetId,
		idempotencyKey: `replace-${++sequence}`,
		initiatedBy: author,
		sourceFileName: 'replacement.png',
		declaredMime: 'image/png',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: digestOf(bytes),
			...dimensions,
		},
		declaredByteLength: bytes.byteLength,
	});
	return published(await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: boundedBytes(bytes),
	}));
}

export async function ingestPackageSilentVideo(library: PackageLibrary, name: string): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++sequence}`,
		initiatedBy: author,
		name,
		sourceFileName: `${name}.webm`,
		declaredMime: 'video/webm',
		declaredByteLength: vp9Webm.byteLength,
	});
	return published(await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'video/webm',
		bytes: boundedBytes(vp9Webm),
	}));
}

/** The bundled MPlantin WOFF, through validation and a passing browser proof. */
export async function ingestPackageStaticFont(library: PackageLibrary, name: string): Promise<GraphicAssetReference> {
	const source = new Uint8Array(await readFile('public/fonts/mplantin.woff'));
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++sequence}`,
		initiatedBy: author,
		name,
		sourceFileName: 'mplantin.woff',
		declaredMime: 'font/woff',
		declaredByteLength: source.byteLength,
	});
	const awaitingEvidence = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'font/woff',
		bytes: boundedBytes(source),
	});
	if (awaitingEvidence.report?.outcome !== 'accepted' || awaitingEvidence.report.facts.kind !== 'font')
		throw new Error('Expected a validated font challenge');
	const { facts } = awaitingEvidence.report;
	return published(await library.confirmFontBrowserEvidence({
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
	}));
}

/** Exports one `.skgraphic` whose document maps each slot to its reference; returns the archive bytes. */
export async function exportPackage(
	library: PackageLibrary,
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
			document: input.document ?? Object.fromEntries(input.assets.map(asset => [asset.slot, asset.reference])),
		},
		assets: input.assets,
	});
	if (result.outcome !== 'exported')
		throw new Error(`Expected an exported package, got ${JSON.stringify(result.report.issues)}`);
	return await collectStream(result.package.open());
}

/** Uploads `archive` as a Template Package preflight. `sourceFileName: null` sends none. */
export async function preflightPackage(
	library: PackageLibrary,
	archive: Uint8Array,
	options: { sourceFileName?: string | null; defaultEventId?: number } = {},
) {
	const operation = await library.initiateTemplatePackagePreflight({
		idempotencyKey: `preflight-${++sequence}`,
		initiatedBy: author,
		sourceFileName: options.sourceFileName === null
			? undefined
			: options.sourceFileName ?? 'lower-third.skgraphic',
		declaredByteLength: archive.byteLength,
		defaultEventId: options.defaultEventId,
	});
	return await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		bytes: boundedBytes(archive),
	});
}

/** Preflights, confirms whatever the report asks the author to accept, and installs. */
export async function installPackage(
	library: PackageLibrary,
	archive: Uint8Array,
	options: { defaultEventId?: number } = {},
): Promise<GraphicsIngestionOperation> {
	let operation = await preflightPackage(library, archive, options);
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

export function preflightReportOf(operation: { templatePackagePreflight?: TemplatePackagePreflightReport }) {
	if (!operation.templatePackagePreflight)
		throw new Error('Expected the operation to carry a Template Package preflight report');
	return operation.templatePackagePreflight;
}

export function issueCodes(report: TemplatePackagePreflightReport): TemplatePackagePreflightIssueCode[] {
	return report.issues.map(issue => issue.code);
}

export function installationOf(operation: GraphicsIngestionOperation) {
	if (!operation.templatePackageInstallation)
		throw new Error('Expected the operation to carry a Template Package installation result');
	return operation.templatePackageInstallation;
}

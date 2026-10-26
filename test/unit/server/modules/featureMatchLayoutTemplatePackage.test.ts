import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { TemplatePackagePreflightReport } from '~~/shared/types/templatePackage';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { featureMatchLayoutVocabularyIdentity } from '~~/shared/featureMatchLayoutVocabulary';
import { GRAPHIC_FONT_IDS } from '~~/shared/modules/graphics/typography';
import {
	broadcastGraphicTemplatePackageRequirements,
	featureMatchLayoutTemplatePackageRequirements,
} from '~~/shared/utils/templatePackageRequirements';
import { maximalBroadcastGraphicDocument } from '../../../helpers/broadcastGraphicDocument';
import { maximalFeatureMatchLayoutDocument } from '../../../helpers/featureMatchLayoutDocument';
import { digestOf, pixelPng } from '../../../helpers/graphicsFixtures';
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../../../helpers/templatePackageArchive';

// A `.sklayout` Template Package at the library seam, mirroring the `.skgraphic`
// suite. Every refusal is a Preflight error, so it lands before anything is written.

let sequence = 0;

function createLibrary(label: string) {
	let nextIdentity = 0;
	return createGraphicsAssetLibrary({
		catalogue: createInMemoryGraphicsAssetCatalogue(),
		staging: createInMemoryStagingGraphicsObjectStore(),
		canonical: createInMemoryCanonicalGraphicsObjectStore(),
		now: () => new Date('2026-07-31T09:00:00.000Z'),
		generateIdentity: () => `${label}-identity-${++nextIdentity}`,
		templatePayloads: templatePackagePayloads,
	});
}

type Library = ReturnType<typeof createLibrary>;

async function ingestImage(library: Library, name: string): Promise<GraphicAssetReference> {
	const operation = await library.initiateGraphicsIngestion({
		idempotencyKey: `ingest-${name}-${++sequence}`,
		initiatedBy: 'package-author',
		name,
		sourceFileName: `${name}.png`,
		declaredMime: 'image/png',
		duplicateContentPolicy: 'create-separate',
		browserDecodeEvidence: {
			outcome: 'decoded',
			sourceDigest: digestOf(pixelPng),
			width: 1,
			height: 1,
		},
		declaredByteLength: pixelPng.byteLength,
	});
	const completed = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(pixelPng, {
			byteLength: pixelPng.byteLength,
			maximumByteLength: pixelPng.byteLength,
		}),
	});
	return {
		assetId: completed.result!.assetId,
		revisionId: completed.result!.revisionId,
	};
}

async function exportLayout(
	library: Library,
	document: FeatureMatchLayoutConfig,
	revision = 4,
): Promise<Uint8Array> {
	const requirements = featureMatchLayoutTemplatePackageRequirements(document);
	const result = await library.exportTemplatePackage({
		packageKind: 'sklayout',
		template: {
			identity: 'neon-feature-match',
			name: 'Neon Feature Match',
			revision,
			document,
		},
		assets: requirements.assets,
		capabilities: requirements.capabilities,
	});
	if (result.outcome !== 'exported')
		throw new Error(`Expected an exported package, got ${JSON.stringify(result.report.issues)}`);
	return await collectStream(result.package.open());
}

async function preflight(library: Library, archive: Uint8Array) {
	const operation = await library.initiateTemplatePackagePreflight({
		idempotencyKey: `preflight-${++sequence}`,
		initiatedBy: 'package-author',
		sourceFileName: 'neon-feature-match.sklayout',
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

/** A sender's layout and the package it produced, ready to be rewritten. */
async function exportedPackage() {
	const sender = createLibrary(`sender-${++sequence}`);
	const frameAsset = await ingestImage(sender, 'Frame backdrop');
	const itemAsset = await ingestImage(sender, 'Sponsor logo');
	const document = maximalFeatureMatchLayoutDocument({ frameAsset, itemAsset });
	return {
		sender,
		frameAsset,
		itemAsset,
		document,
		archive: await exportLayout(sender, document),
	};
}

describe('a `.sklayout` Template Package crossing an installation boundary', () => {
	it('accepts a package whose Template really is a Feature Match Layout', async () => {
		const { archive } = await exportedPackage();

		const report = reportOf(await preflight(createLibrary('receiver'), archive));

		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
		expect(report.outcome).not.toBe('rejected');
		expect(report.templateRevision).toBe(4);
	});

	// A maximal document round-trips whole, so a field the transfer drops fails here.
	it('carries the whole layout across unchanged', async () => {
		const { document, archive } = await exportedPackage();
		const travelled = readTemplatePackageParts(archive).template as FeatureMatchLayoutConfig;

		expect(travelled).toEqual(document);
	});

	// A Feature Match Slot assignment is Screen state, never part of a layout.
	it('refuses a Template document carrying a Feature Match Slot assignment', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = { ...(parts.template as Record<string, unknown>), featureMatchId: 12 };

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	it('refuses a Template document that is not a Feature Match Layout, before anything is installed', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = { ...(parts.template as Record<string, unknown>), sources: 'not a list of sources' };

		const receiver = createLibrary('receiver');
		const before = await receiver.listGraphicAssets({});
		const operation = await preflight(receiver, writeTemplatePackage(parts));
		const report = reportOf(operation);

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
		// Terminal, because nothing about the package changes on a retry.
		expect(report.issues.every(issue => !issue.retryable)).toBe(true);
		expect(operation.stage).toBe('failed');
		const after = await receiver.listGraphicAssets({});
		expect(after.map((asset: GraphicAsset) => asset.id)).toEqual(before.map((asset: GraphicAsset) => asset.id));
	});

	// A Broadcast Graphic is a valid document a `.sklayout` receiver must still refuse.
	it('refuses a Broadcast Graphic document travelling as a Feature Match Layout', async () => {
		const { archive, itemAsset } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = maximalBroadcastGraphicDocument({ asset: itemAsset });

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	// Host vocabulary terms are declared, and a receiver checks them before installing.
	it('declares every host vocabulary term the layout uses', async () => {
		const { archive } = await exportedPackage();
		const declared = readTemplatePackageParts(archive).manifest.applicationCapabilities.filter(declaration => declaration.capability === 'host-vocabulary').map(declaration => declaration.identity);

		expect(declared).toEqual(expect.arrayContaining([
			featureMatchLayoutVocabularyIdentity('source-role', 'main'),
			featureMatchLayoutVocabularyIdentity('source-role', 'player1'),
			featureMatchLayoutVocabularyIdentity('source-role', 'player2'),
			featureMatchLayoutVocabularyIdentity('frame-animation-effect', 'caustics'),
			featureMatchLayoutVocabularyIdentity('token', 'player1Name'),
			featureMatchLayoutVocabularyIdentity('token', 'player1Record'),
			featureMatchLayoutVocabularyIdentity('token', 'player1Deck'),
		]));
	});

	// An unknown `{placeholder}` renders as an absence, so it travels undeclared.
	it('carries a placeholder that names no token without claiming a capability for it', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		const declared = parts.manifest.applicationCapabilities.map(declaration => declaration.identity);

		// It travelled…
		expect(JSON.stringify(parts.template)).toContain('{player1name}');
		// …and nothing was declared for it.
		expect(declared).not.toContain(featureMatchLayoutVocabularyIdentity('token', 'player1name'));
		// …and a receiver installs the layout rather than refusing it.
		const report = reportOf(await preflight(createLibrary('receiver'), archive));
		expect(report.outcome).not.toBe('rejected');
	});

	// An unknown host term is refused rather than rendered as a hole on air.
	it('refuses a host vocabulary term this installation does not implement', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = [
			...parts.manifest.applicationCapabilities,
			{
				capability: 'host-vocabulary',
				identity: featureMatchLayoutVocabularyIdentity('source-role', 'commentator-desk'),
				configurationVersion: 1,
				requiredBy: ['sources.desk.sourceRole'],
			},
		];

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	it('refuses a host vocabulary at a format version this installation does not implement', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.capability === 'host-vocabulary'
				? { ...declaration, configurationVersion: 2 }
				: declaration,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	// An undeclared term was never version-checked, so it is refused.
	it('refuses a host vocabulary term the Template uses and the package never declares', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.filter(
			declaration => declaration.identity !== featureMatchLayoutVocabularyIdentity('token', 'player1Name'),
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue =>
			issue.code === 'unsupported-application-capability'
			&& issue.message.includes('never declares'),
		)).toBe(true);
	});

	it('declares the host-owned Source Item Definition alongside the shared ones', async () => {
		const { archive } = await exportedPackage();
		const declared = readTemplatePackageParts(archive).manifest.applicationCapabilities.filter(declaration => declaration.capability === 'graphic-item-definition').map(declaration => declaration.identity);

		expect(declared).toEqual(expect.arrayContaining([
			'source',
			'group',
			'text',
			'media',
			'clock',
			'player-life',
			'game-wins',
			'deck-list',
		]));
	});

	// The Deck List Item is declared and version-pinned through the generic walk.
	it('declares the Deck List Definition at its configuration version, discovered from the composition', async () => {
		const { archive } = await exportedPackage();
		const declarations = readTemplatePackageParts(archive).manifest.applicationCapabilities;

		expect(declarations).toContainEqual(expect.objectContaining({
			capability: 'graphic-item-definition',
			identity: 'deck-list',
			configurationVersion: 1,
			requiredBy: ['composition.items.sideboard.type'],
		}));
	});

	// The document's own Source Roles are checked, not only the manifest's declarations.
	it('refuses a Source Item declaring a role outside the vocabulary', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		const layout = parts.template as FeatureMatchLayoutConfig;
		parts.template = {
			...layout,
			sources: layout.sources.map((source, index) =>
				index === 0
					? { ...source, sourceRole: 'commentator-desk' }
					: source,
			),
		};

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	// A `.skgraphic` naming a layout host term is a package no exporter could write.
	it('refuses a host vocabulary term declared by a `.skgraphic` package', async () => {
		const sender = createLibrary(`skgraphic-sender-${++sequence}`);
		const asset = await ingestImage(sender, 'Backdrop');
		const document = maximalBroadcastGraphicDocument({ asset });
		const requirements = broadcastGraphicTemplatePackageRequirements(document);
		const result = await sender.exportTemplatePackage({
			packageKind: 'skgraphic',
			template: { identity: document.id, name: document.name, document },
			assets: requirements.assets,
			capabilities: [
				...requirements.capabilities,
				{
					slot: 'items.headline.text',
					capability: 'host-vocabulary',
					identity: featureMatchLayoutVocabularyIdentity('token', 'player1Name'),
					configurationVersion: 1,
				},
			],
		});

		expect(result.outcome).toBe('rejected');
		if (result.outcome !== 'rejected')
			return;
		expect(result.report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	// Both kinds share one application font registry (#138).
	it('validates both package kinds against the one shared application font registry', async () => {
		const sender = createLibrary(`font-sender-${++sequence}`);
		const asset = await ingestImage(sender, 'Backdrop');
		const graphic = maximalBroadcastGraphicDocument({ asset });
		const layout = maximalFeatureMatchLayoutDocument({ frameAsset: asset, itemAsset: asset });
		const unknownFont = {
			slot: 'typography.font',
			capability: 'application-font' as const,
			identity: 'a-font-no-installation-ships',
		};

		// A font the registry does have is accepted for both kinds…
		const knownFont = { ...unknownFont, identity: GRAPHIC_FONT_IDS[0] };
		for (const [packageKind, document, requirements] of [
			[
				'skgraphic',
				graphic,
				broadcastGraphicTemplatePackageRequirements(graphic),
			],
			[
				'sklayout',
				layout,
				featureMatchLayoutTemplatePackageRequirements(layout),
			],
		] as const) {
			const accepted = await sender.exportTemplatePackage({
				packageKind,
				template: { identity: 'font-check', name: 'Font check', document },
				assets: requirements.assets,
				capabilities: [...requirements.capabilities, knownFont],
			});
			expect(accepted.outcome).toBe('exported');

			// …and one it does not is refused for both.
			const refused = await sender.exportTemplatePackage({
				packageKind,
				template: { identity: 'font-check', name: 'Font check', document },
				assets: requirements.assets,
				capabilities: [...requirements.capabilities, unknownFont],
			});
			expect(refused.outcome).toBe('rejected');
			if (refused.outcome !== 'rejected')
				continue;
			expect(refused.report.issues.some(issue =>
				issue.code === 'unsupported-application-capability'
				&& issue.message.includes('a-font-no-installation-ships'),
			)).toBe(true);
		}
	});
});

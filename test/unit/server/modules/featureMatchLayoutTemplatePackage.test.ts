import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { TemplatePackagePreflightReport } from '~~/shared/types/templatePackage';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
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
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../../../helpers/templatePackageArchive';

/**
 * What a `.sklayout` Template Package is held to, at the library seam an
 * installation actually crosses.
 *
 * The mirror of the `.skgraphic` suite, wired the same way: the real Graphics Asset
 * Library with the real Template Package Payload registry, because the rules under
 * test only exist once the envelope and the Feature Match Layout vocabulary are put
 * together. Every refusal here is a Template Package Preflight error, which is what
 * makes it atomic — it lands before an asset, an origin, a reference, or a Template
 * exists.
 */

const transparentPixelPng = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
	'base64',
));

function digestOf(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

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
			sourceDigest: digestOf(transparentPixelPng),
			width: 1,
			height: 1,
		},
		declaredByteLength: transparentPixelPng.byteLength,
	});
	const completed = await library.uploadGraphicAsset({
		operationId: operation.id,
		initiatedBy: operation.initiatedBy,
		declaredMime: 'image/png',
		bytes: createBoundedByteStream(transparentPixelPng, {
			byteLength: transparentPixelPng.byteLength,
			maximumByteLength: transparentPixelPng.byteLength,
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
	return { sender, frameAsset, itemAsset, document, archive: await exportLayout(sender, document) };
}

describe('a `.sklayout` Template Package crossing an installation boundary', () => {
	it('accepts a package whose Template really is a Feature Match Layout', async () => {
		const { archive } = await exportedPackage();

		const report = reportOf(await preflight(createLibrary('receiver'), archive));

		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
		expect(report.outcome).not.toBe('rejected');
		expect(report.templateRevision).toBe(4);
	});

	/**
	 * The Frame, the Source Items, and the composition arrive exactly as they left,
	 * except for the two Graphic Asset References the envelope is defined to rewrite.
	 * A maximal document is what makes this a real guarantee rather than a spot check:
	 * every optional field of the vocabulary is present, so a field the transfer drops
	 * fails here rather than months later on a design nobody can re-import.
	 */
	it('carries the whole layout across, rewriting only its Graphic Asset References', async () => {
		const { document, archive } = await exportedPackage();
		const travelled = readTemplatePackageParts(archive).template as FeatureMatchLayoutConfig;

		expect(travelled).toEqual(document);
	});

	/**
	 * "Event identities stripped", proved on the way in rather than assumed on the
	 * way out. A Feature Match Slot assignment is Screen state that lives beside the
	 * layout, so a document carrying one is not a layout with an extra field — it is a
	 * document written by something that thought a layout was Screen state, and
	 * installing it with the extra silently dropped would hide that.
	 */
	it('refuses a Template document carrying a Feature Match Slot assignment', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = { ...(parts.template as Record<string, unknown>), featureMatchId: 12 };

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	/**
	 * The envelope proves a Template document is data. It cannot prove it is a
	 * Feature Match Layout, and a package that installed one that is not would leave
	 * an author with a design nothing can place.
	 */
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

	/**
	 * The two package kinds are separate artifacts, not two flavours of one. A
	 * Broadcast Graphic is a perfectly valid document that a `.sklayout` receiver must
	 * refuse, because nothing on a Feature Match Overlay could render it — it has no
	 * Frame and no Source Items, and it declares Graphic Inputs a layout has no way to
	 * accept.
	 */
	it('refuses a Broadcast Graphic document travelling as a Feature Match Layout', async () => {
		const { archive, itemAsset } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = maximalBroadcastGraphicDocument({ asset: itemAsset });

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	/**
	 * The host vocabularies are the half of a layout the package cannot carry: a
	 * Source Role, a Frame animation effect, and a Feature Match token are all terms
	 * whose meaning the receiving installation supplies. So they are declared, and the
	 * declarations are what a receiver checks before installing anything.
	 */
	it('declares every host vocabulary term the layout uses', async () => {
		const { archive } = await exportedPackage();
		const declared = readTemplatePackageParts(archive).manifest.applicationCapabilities.filter(declaration => declaration.capability === 'host-vocabulary').map(declaration => declaration.identity);

		expect(declared).toEqual(expect.arrayContaining([
			featureMatchLayoutVocabularyIdentity('source-role', 'main'),
			featureMatchLayoutVocabularyIdentity('source-role', 'player1'),
			featureMatchLayoutVocabularyIdentity('source-role', 'player2'),
			featureMatchLayoutVocabularyIdentity('frame-animation-effect', 'waves'),
			featureMatchLayoutVocabularyIdentity('token', 'player1Name'),
			featureMatchLayoutVocabularyIdentity('token', 'player1Record'),
			// Named by a Graphic Placeholder Style rather than by the template text: a
			// style for a token this installation does not have can never apply.
			featureMatchLayoutVocabularyIdentity('token', 'player1Deck'),
		]));
	});

	/**
	 * A `{placeholder}` that names no catalogue token is not a capability. The shared
	 * Graphic Text Template mechanism renders one as an absence by design, so an
	 * author who mis-typed `{player1name}` is looking at an empty run and a package
	 * that refused to carry it would be refusing over a typo — with a message about a
	 * vocabulary term and no way to satisfy it.
	 */
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

	/**
	 * A term this installation has never heard of is refused rather than installed
	 * and rendered as an absence. A Source Item framing a role nobody routes is a hole
	 * in a live layout, discovered on air.
	 */
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

	/**
	 * The format-version half of the same pin. A sender at a newer Feature Match
	 * Layout format version means something by `main` that this installation cannot
	 * know, and an identity that still resolves is exactly the case only a version can
	 * catch.
	 */
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

	/**
	 * A host vocabulary term the document uses and the manifest never declares is one
	 * whose format version was never checked against anything. Installing it would
	 * assume the sender meant the version we happen to implement, which is the
	 * assumption a version-pinned envelope exists to refuse.
	 */
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

	/**
	 * The Source Item Definition is the one Graphic Item Definition only a Feature
	 * Match Layout may place, so a layout declares it and a receiver of a `.sklayout`
	 * supports it.
	 */
	it('declares the host-owned Source Item Definition alongside the shared ones', async () => {
		const { archive } = await exportedPackage();
		const declared = readTemplatePackageParts(archive).manifest.applicationCapabilities.filter(declaration => declaration.capability === 'graphic-item-definition').map(declaration => declaration.identity);

		expect(declared).toEqual(expect.arrayContaining(['source', 'group', 'text', 'media', 'clock', 'player-life', 'game-wins']));
	});

	/**
	 * Strict validation of the Source Role vocabulary in the document itself, not
	 * only in what the manifest declares. A hand-edited archive that names a role
	 * nobody implements while declaring only roles that are implemented would
	 * otherwise pass the capability check and install a Source Item framing nothing.
	 */
	it('refuses a Source Item declaring a role outside the vocabulary', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		const layout = parts.template as FeatureMatchLayoutConfig;
		parts.template = {
			...layout,
			sources: layout.sources.map((source, index) =>
				index === 0 ? { ...source, sourceRole: 'commentator-desk' } : source,
			),
		};

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'invalid-template-document')).toBe(true);
	});

	/**
	 * The other direction of the same separation, and the reason host vocabularies
	 * route by package kind at all. A Broadcast Graphic declares its own Graphic
	 * Inputs in its document and has no host vocabulary, so a `.skgraphic` naming one
	 * of these terms is a package no exporter here could have written.
	 */
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

	/**
	 * Application fonts are the one capability that deliberately does *not* route by
	 * package kind. There is one application font registry and both hosts share it,
	 * so both kinds are validated against the same list — routing would invent a
	 * divergence that does not exist. This pins that as a decision rather than
	 * leaving it as the shape the code happens to have (issue #138).
	 */
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
			['skgraphic', graphic, broadcastGraphicTemplatePackageRequirements(graphic)],
			['sklayout', layout, featureMatchLayoutTemplatePackageRequirements(layout)],
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

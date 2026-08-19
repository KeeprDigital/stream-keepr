import type { BroadcastGraphicConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
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
import { getGraphicItemDefinition } from '~~/shared/modules/graphics/itemDefinitions';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';
import { maximalBroadcastGraphicDocument } from '../../../helpers/broadcastGraphicDocument';
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../../../helpers/templatePackageArchive';

/**
 * What a `.skgraphic` Template Package is held to, at the library seam an
 * installation actually crosses.
 *
 * The Graphics Asset Library is exercised with the real Template Package Payload
 * registry wired, exactly as the application wires it, because the rules under test
 * are the ones that only exist once the envelope and the Broadcast Graphic
 * vocabulary are put together. Every refusal here is a Template Package Preflight
 * error, which is what makes it atomic: it lands before an asset, an origin, a
 * reference, or a Template exists, so there is no half-installed Template to clean
 * up and nothing for a retry to find.
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

async function exportGraphic(
	library: Library,
	document: BroadcastGraphicConfig,
	revision = 4,
): Promise<Uint8Array> {
	const requirements = broadcastGraphicTemplatePackageRequirements(document);
	const result = await library.exportTemplatePackage({
		packageKind: 'skgraphic',
		template: {
			identity: document.id,
			name: document.name,
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
		sourceFileName: 'lower-third.skgraphic',
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

/**
 * Runs `work` with one Graphic Item Definition standing at a configuration version
 * this installation does not otherwise implement.
 *
 * Every kind is at version 1 today, so an export that states the version as a
 * literal is indistinguishable from one that reads it — until the day somebody
 * bumps a kind, by which point the packages are already in the wild. Moving the
 * shared Definition is the only way to tell the two apart now, and it is the same
 * object the export path reads, so nothing about the seam is simulated.
 */
async function withGraphicItemDefinitionAt<T>(
	kind: GraphicItemKind,
	configurationVersion: number,
	work: () => Promise<T>,
): Promise<T> {
	const definition = getGraphicItemDefinition(kind);
	const implemented = definition.configurationVersion;
	definition.configurationVersion = configurationVersion;
	try {
		return await work();
	}
	finally {
		definition.configurationVersion = implemented;
	}
}

/** A sender's design and the package it produced, ready to be rewritten. */
async function exportedPackage() {
	const sender = createLibrary(`sender-${++sequence}`);
	const asset = await ingestImage(sender, 'Backdrop');
	const document = maximalBroadcastGraphicDocument({ asset });
	return { sender, asset, document, archive: await exportGraphic(sender, document) };
}

async function exportedProjectedPackage() {
	const sender = createLibrary(`projection-sender-${++sequence}`);
	const asset = await ingestImage(sender, 'Projection backdrop');
	const document = maximalBroadcastGraphicDocument({ asset });
	return { document, archive: await exportGraphic(sender, document) };
}

describe('a `.skgraphic` Template Package crossing an installation boundary', () => {
	it('carries the Template revision as provenance so a later package is recognisable', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);

		expect(parts.manifest.template.revision).toBe(4);

		const receiver = createLibrary('receiver');
		expect(reportOf(await preflight(receiver, archive)).templateRevision).toBe(4);
	});

	/**
	 * The artifact check is the one rule the envelope cannot enforce for itself, and
	 * it lives entirely in an injected payload registry. Left out, it does not fail —
	 * it ceases to exist, and every well-formed archive installs as a Template
	 * nothing can place, with no error anywhere to say a check was skipped. So a
	 * library with no registry refuses to receive a package at all, before it has
	 * taken a byte it could not hold to the rule.
	 */
	it('refuses to receive a package at all when no Template Package payload registry is wired', async () => {
		const unwired = createGraphicsAssetLibrary({
			catalogue: createInMemoryGraphicsAssetCatalogue(),
			staging: createInMemoryStagingGraphicsObjectStore(),
			canonical: createInMemoryCanonicalGraphicsObjectStore(),
		});

		await expect(unwired.initiateTemplatePackagePreflight({
			idempotencyKey: `preflight-unwired-${++sequence}`,
			initiatedBy: 'package-author',
			sourceFileName: 'lower-third.skgraphic',
			declaredByteLength: 1024,
		})).rejects.toThrow(/payload registry/);
	});

	it('accepts a package whose Template really is a Broadcast Graphic', async () => {
		const { archive } = await exportedPackage();

		const report = reportOf(await preflight(createLibrary('receiver'), archive));

		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
		expect(report.outcome).not.toBe('rejected');
	});

	it('round-trips Social Profile Projection semantics without Event Talent data or icon assets', async () => {
		const { document, archive } = await exportedProjectedPackage();
		const parts = readTemplatePackageParts(archive);

		expect(parts.template).toEqual(document);
		expect(parts.manifest.packagedAssets).toHaveLength(1);
		expect(JSON.stringify(parts)).not.toContain('socialProfiles');
		expect(parts.manifest.applicationCapabilities).toEqual(expect.arrayContaining([
			expect.objectContaining({
				capability: 'host-vocabulary',
				identity: 'social-profile-projection',
				configurationVersion: 1,
			}),
			expect.objectContaining({
				capability: 'graphic-item-definition',
				identity: 'social-network-icon',
				configurationVersion: 2,
			}),
		]));
		const report = reportOf(await preflight(createLibrary('projection-receiver'), archive));
		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
	});

	/**
	 * The envelope proves a Template document is data. It cannot prove it is a
	 * Broadcast Graphic, and a package that installed one that is not would leave an
	 * author with a design nothing can place — discovered long after the bytes that
	 * travelled were already wrong.
	 */
	it('refuses a Template document that is not a Broadcast Graphic, before anything is installed', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.template = { ...(parts.template as Record<string, unknown>), items: 'not a list of items' };

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
	 * The version-pinned half of the envelope, stated over a Graphic Item Definition
	 * rather than over the package schema. A sender at a newer configuration version
	 * of `media` is not asking for a field this installation can ignore — it is
	 * asking it to render a configuration it has never seen.
	 */
	it('refuses a Graphic Item Definition at a configuration version this installation does not implement', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.identity === 'media'
				? { ...declaration, configurationVersion: 2 }
				: declaration,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	it('refuses a future Social Network Icon configuration version', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.identity === 'social-network-icon'
				? { ...declaration, configurationVersion: 3 }
				: declaration,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	it('refuses a future Social Profile Projection vocabulary version', async () => {
		const { archive } = await exportedProjectedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.identity === 'social-profile-projection'
				? { ...declaration, configurationVersion: 2 }
				: declaration,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	/**
	 * The other half of that refusal, on the sending side. The version a manifest
	 * declares has to be the one the shared Graphic Item Definition states, because
	 * the export path writes the document at whatever version this installation
	 * implements. A literal in the export path would make the pin inert exactly when
	 * it starts to matter: an installation that had advanced `media` would emit a
	 * version-2 configuration under a version-1 declaration, and a version-1 receiver
	 * would accept it and install a Graphic Item it cannot read as authored.
	 */
	it('declares each Graphic Item Definition at the configuration version this installation implements', async () => {
		const { archive } = await withGraphicItemDefinitionAt('media', 2, exportedPackage);
		const declarations = readTemplatePackageParts(archive).manifest.applicationCapabilities;
		const declarationFor = (identity: string) =>
			declarations.find(declaration => declaration.identity === identity)?.configurationVersion;

		expect(declarationFor('media')).toBe(2);
		// Per Definition, not one number for the package: the kinds that did not move
		// still declare the version they are actually at.
		expect(declarationFor('text')).toBe(1);

		// And a receiver back at the version it implements refuses the package, which
		// is the protection the declaration exists to give.
		const report = reportOf(await preflight(createLibrary('receiver'), archive));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	/**
	 * A configuration version is stated only in the manifest — a document carries a
	 * Graphic Item's configuration, never the version it was written under. So an
	 * undeclared Definition is one whose version was never checked against anything,
	 * and installing it would assume the sender meant the version we happen to
	 * implement. That is precisely the assumption a version-pinned envelope refuses.
	 */
	it('refuses a Graphic Item Definition the Template uses and the package never declares', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.filter(
			declaration => declaration.identity !== 'media',
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue =>
			issue.code === 'unsupported-application-capability'
			&& issue.message.includes('never declares'),
		)).toBe(true);
	});

	it('refuses a Social Profile Projection the package never declares', async () => {
		const { archive } = await exportedProjectedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.filter(
			declaration => declaration.identity !== 'social-profile-projection',
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue =>
			issue.code === 'unsupported-application-capability'
			&& issue.message.includes('never declares'),
		)).toBe(true);
	});

	/**
	 * Over-declaration is not a defect. A manifest naming a capability its Template
	 * no longer uses costs one supported-capability check, and refusing it would
	 * reject packages that are entirely installable.
	 */
	it('accepts a package declaring a supported capability its Template no longer uses', async () => {
		const { archive } = await exportedPackage();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = [
			...parts.manifest.applicationCapabilities,
			{
				capability: 'graphic-item-definition',
				identity: 'clock',
				configurationVersion: 1,
				requiredBy: ['items.removed.type'],
			},
		];

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
	});
});

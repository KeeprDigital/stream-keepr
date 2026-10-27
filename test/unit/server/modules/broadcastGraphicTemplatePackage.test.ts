import type { BroadcastGraphicConfig, GraphicItemKind } from '~~/shared/types/graphics';
import type { GraphicAsset } from '~~/shared/types/graphicsAsset';
import type { PackageLibrary } from '~~/test/helpers/templatePackageLibrary';
import { describe, expect, it } from 'vitest';
import {
	createGraphicsAssetLibrary,
	createInMemoryGraphicsAssetCatalogue,
} from '~~/server/modules/graphics-asset-library';
import {
	createInMemoryCanonicalGraphicsObjectStore,
	createInMemoryStagingGraphicsObjectStore,
} from '~~/server/modules/graphics-asset-library/in-memory-object-store';
import { templatePackagePayloads } from '~~/server/modules/template-package-payload';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics/itemDefinitions';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';
import {
	createPackageLibrary,
	ingestPackageImage as ingestImage,
	preflightPackage as preflight,
	preflightReportOf as reportOf,
} from '~~/test/helpers/templatePackageLibrary';
import { maximalBroadcastGraphicDocument } from '../../../helpers/broadcastGraphicDocument';
import { collectStream } from '../../../helpers/storedZipArchive';
import {
	readTemplatePackageParts,
	writeTemplatePackage,
} from '../../../helpers/templatePackageArchive';

/**
 * What a `.skgraphic` Template Package is held to, with the real payload registry
 * wired. Every refusal is a preflight error, so it lands before anything is installed.
 */

let sequence = 0;

function createLibrary(label: string) {
	return createPackageLibrary(label, {
		templatePayloads: templatePackagePayloads,
		silentVideoPlaybackValidator: undefined,
		now: () => new Date('2026-07-31T09:00:00.000Z'),
	}).library;
}

async function exportGraphic(
	library: PackageLibrary,
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

/**
 * Runs `work` with one shared Graphic Item Definition moved to `configurationVersion`:
 * while every kind is at version 1, that is the only way to tell a read version from a literal.
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
	return {
		sender,
		asset,
		document,
		archive: await exportGraphic(sender, document),
	};
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

	// Without a registry the artifact check would silently cease to exist.
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

	it.each([
		{
			capability: 'a Graphic Item Definition',
			identity: 'media',
			version: 2,
			exported: exportedPackage,
		},
		{
			capability: 'a Social Network Icon',
			identity: 'social-network-icon',
			version: 3,
			exported: exportedPackage,
		},
		{
			capability: 'the Social Profile Projection vocabulary',
			identity: 'social-profile-projection',
			version: 2,
			exported: exportedProjectedPackage,
		},
	])('refuses $capability at a configuration version this installation does not implement', async ({ identity, version, exported }) => {
		const { archive } = await exported();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.map(
			declaration => declaration.identity === identity
				? { ...declaration, configurationVersion: version }
				: declaration,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue => issue.code === 'unsupported-application-capability')).toBe(true);
	});

	// The sending side: the manifest declares the version the shared Definition states, not a literal.
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

	// A version stated nowhere was checked against nothing, so an undeclared capability is refused.
	it.each([
		{ capability: 'Graphic Item Definition', identity: 'media', exported: exportedPackage },
		{ capability: 'Social Profile Projection', identity: 'social-profile-projection', exported: exportedProjectedPackage },
	])('refuses a $capability the Template uses and the package never declares', async ({ identity, exported }) => {
		const { archive } = await exported();
		const parts = readTemplatePackageParts(archive);
		parts.manifest.applicationCapabilities = parts.manifest.applicationCapabilities.filter(
			declaration => declaration.identity !== identity,
		);

		const report = reportOf(await preflight(createLibrary('receiver'), writeTemplatePackage(parts)));

		expect(report.outcome).toBe('rejected');
		expect(report.issues.some(issue =>
			issue.code === 'unsupported-application-capability'
			&& issue.message.includes('never declares'),
		)).toBe(true);
	});

	// Over-declaration costs one check; refusing it would reject installable packages.
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

describe('a `.skgraphic` Template Package and the Theme', () => {
	// Bindings travel as token names, so the receiver's own Theme restyles the design.
	it('round-trips every Theme binding, and a receiver accepts them', async () => {
		const { document, archive } = await exportedPackage();
		const travelled = readTemplatePackageParts(archive).template as BroadcastGraphicConfig;

		expect(travelled.items.map(item => item.themeBindings)).toEqual(document.items.map(item => item.themeBindings));
		expect(travelled.items.some(item => item.themeBindings)).toBe(true);
		const report = reportOf(await preflight(createLibrary('theme-receiver'), archive));
		expect(report.issues.filter(issue => issue.severity === 'error')).toEqual([]);
	});
});

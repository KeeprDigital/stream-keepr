import type { GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import { afterAll, describe, expect, it } from 'vitest';
import { createInMemoryGraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library';
import { createD1GraphicsAssetCatalogue } from '~~/server/modules/graphics-asset-library/catalogue';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';
import {
	createPackageLibrary,
	exportPackage,
	ingestPackageImage,
	installationOf,
	installPackage,
	replacePackageImage,
} from '~~/test/helpers/templatePackageLibrary';
import { sixteenPixelPng } from '../../../helpers/graphicsFixtures';

// Removing an Installed Graphics Template releases its Graphic Asset References in
// one write, keeps its row as provenance, and a retry of the installation that
// published it reinstalls it (ADR-0068).

const harness = await createSqliteD1Harness();
afterAll(async () => await harness.close());

let libraries = 0;
const catalogues: [string, () => GraphicsAssetCatalogue][] = [
	[
		'the D1 catalogue',
		() => createD1GraphicsAssetCatalogue(harness.database),
	],
	[
		'the in-memory catalogue',
		() => createInMemoryGraphicsAssetCatalogue(),
	],
];

function libraryOver(catalogue: () => GraphicsAssetCatalogue) {
	return createPackageLibrary(`removal-${++libraries}`, {
		catalogue: catalogue(),
	}).library;
}

/** One library that exports a package pinning a fresh image, and receives it. */
async function installedTemplate(catalogue: () => GraphicsAssetCatalogue) {
	const library = libraryOver(catalogue);
	const sender = createPackageLibrary(`sender-${libraries}`).library;
	const archive = await exportPackage(sender, {
		assets: [
			{ slot: 'backdrop', reference: await ingestPackageImage(sender, 'Backdrop') },
		],
	});
	const operation = await installPackage(library, archive);
	const installation = installationOf(operation);
	const asset: GraphicAssetReference = installation.assets[0]!;
	return {
		library,
		archive,
		operation,
		installation,
		asset,
	};
}

describe.each(catalogues)('removing an Installed Graphics Template, over %s', (_, catalogue) => {
	it('releases its references, so its asset may enter Trash', async () => {
		const { library, installation, asset } = await installedTemplate(catalogue);
		expect((await library.trashGraphicAsset({ assetId: asset.assetId })).outcome).toBe('in-use');

		const removed = await library.removeInstalledGraphicsTemplate({
			templateId: installation.templateId,
			kind: 'broadcast-graphic',
			removedBy: 'remover',
		});

		expect(removed.outcome).toBe('removed');
		expect(await library.findInstalledGraphicsTemplate({ templateId: installation.templateId })).toBeUndefined();
		expect(await library.listInstalledGraphicsTemplates({ kind: 'broadcast-graphic' })).toEqual([]);
		expect(await library.listGraphicAssetUsage({ assetId: asset.assetId })).toEqual([]);
		expect((await library.trashGraphicAsset({ assetId: asset.assetId })).outcome).toBe('trashed');
	});

	it('keeps an asset another installation still references out of Trash', async () => {
		const { library, archive, installation, asset } = await installedTemplate(catalogue);
		const second = installationOf(await installPackage(library, archive));
		expect(second.assets[0]).toMatchObject({ outcome: 'reused', assetId: asset.assetId });

		await library.removeInstalledGraphicsTemplate({
			templateId: installation.templateId,
			kind: 'broadcast-graphic',
			removedBy: 'remover',
		});

		const trash = await library.trashGraphicAsset({ assetId: asset.assetId });
		expect(trash.outcome).toBe('in-use');
		expect(trash.outcome === 'in-use' && trash.usage.map(usage => usage.owner.id))
			.toEqual([second.templateId]);
	});

	it.each([
		['an unknown identity', 'no-such-template', 'broadcast-graphic'],
		['a template of the other kind', undefined, 'feature-match-layout'],
		['a template already removed', 'removed', 'broadcast-graphic'],
	] as const)('answers not-found for %s', async (_, identity, kind) => {
		const { library, installation } = await installedTemplate(catalogue);
		if (identity === 'removed') {
			await library.removeInstalledGraphicsTemplate({
				templateId: installation.templateId,
				kind: 'broadcast-graphic',
				removedBy: 'remover',
			});
		}

		const removed = await library.removeInstalledGraphicsTemplate({
			templateId: identity === 'no-such-template'
				? identity
				: installation.templateId,
			kind,
			removedBy: 'remover',
		});

		expect(removed.outcome).toBe('not-found');
	});

	it('reinstalls the template when its installation is retried', async () => {
		const { library, operation, installation, asset } = await installedTemplate(catalogue);
		const before = await library.inspectInstalledGraphicsTemplate({ templateId: installation.templateId });
		await library.removeInstalledGraphicsTemplate({
			templateId: installation.templateId,
			kind: 'broadcast-graphic',
			removedBy: 'remover',
		});

		const retried = await library.installTemplatePackage({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		expect(retried.stage).toBe('completed');
		expect(installationOf(retried)).toEqual(installation);
		expect(await library.inspectInstalledGraphicsTemplate({ templateId: installation.templateId }))
			.toEqual(before);
		expect((await library.trashGraphicAsset({ assetId: asset.assetId })).outcome).toBe('in-use');
	});

	it('refuses to reinstall while an asset it pins is trashed, and reinstalls once it is restored', async () => {
		const { library, operation, installation, asset } = await installedTemplate(catalogue);
		await library.removeInstalledGraphicsTemplate({
			templateId: installation.templateId,
			kind: 'broadcast-graphic',
			removedBy: 'remover',
		});
		await library.trashGraphicAsset({ assetId: asset.assetId });
		const retry = () => library.installTemplatePackage({
			operationId: operation.id,
			initiatedBy: operation.initiatedBy,
		});

		await expect(retry()).rejects.toMatchObject({ code: 'ingestion-operation-not-uploadable' });
		expect(await library.findInstalledGraphicsTemplate({ templateId: installation.templateId })).toBeUndefined();

		await library.restoreGraphicAsset({ assetId: asset.assetId });
		expect((await retry()).stage).toBe('completed');
		expect(await library.findInstalledGraphicsTemplate({ templateId: installation.templateId })).toBeDefined();
	});
});

describe('a superseded revision only a removed template pinned', () => {
	it('becomes a Revision Pruning candidate', async () => {
		const library = libraryOver(catalogues[0]![1]);
		const first = await ingestPackageImage(library, 'Backdrop');
		const archive = await exportPackage(library, {
			assets: [
				{ slot: 'backdrop', reference: first },
			],
		});
		await replacePackageImage(library, first, sixteenPixelPng);
		const installation = installationOf(await installPackage(library, archive));
		expect(installation.assets[0]).toMatchObject({ outcome: 'reused', revisionId: first.revisionId });
		expect((await library.runGraphicsRetention()).revisions.pruningScheduled).toBe(0);

		await library.removeInstalledGraphicsTemplate({
			templateId: installation.templateId,
			kind: 'broadcast-graphic',
			removedBy: 'remover',
		});

		expect((await library.runGraphicsRetention()).revisions.pruningScheduled).toBe(1);
	});
});

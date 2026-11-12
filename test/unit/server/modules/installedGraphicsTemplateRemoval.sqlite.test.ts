import type { GraphicAssetReference, InstalledGraphicsTemplateKind } from '~~/shared/types/graphicsAsset';
import type { PackageLibrary } from '~~/test/helpers/templatePackageLibrary';
import { afterAll, describe, expect, it } from 'vitest';
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
const catalogue = () => createD1GraphicsAssetCatalogue(harness.database);

function newLibrary() {
	return createPackageLibrary(`removal-${++libraries}`, {
		catalogue: catalogue(),
	}).library;
}

/** One library that exports a package pinning a fresh image, and receives it. */
async function installedTemplate() {
	const library = newLibrary();
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
		remove: () => removeFrom(library, installation.templateId),
	};
}

function removeFrom(library: PackageLibrary, templateId: string, kind: InstalledGraphicsTemplateKind = 'broadcast-graphic') {
	return library.removeInstalledGraphicsTemplate({ templateId, kind, removedBy: 'remover' });
}

describe('removing an Installed Graphics Template', () => {
	it('releases its references, so its asset may enter Trash', async () => {
		const { library, installation, asset, remove } = await installedTemplate();
		expect((await library.trashGraphicAsset({ assetId: asset.assetId })).outcome).toBe('in-use');

		const removed = await remove();

		expect(removed.outcome).toBe('removed');
		expect(await library.findInstalledGraphicsTemplate({ templateId: installation.templateId })).toBeUndefined();
		expect(await library.listInstalledGraphicsTemplates({ kind: 'broadcast-graphic' })).toEqual([]);
		expect(await library.listGraphicAssetUsage({ assetId: asset.assetId })).toEqual([]);
		expect((await library.trashGraphicAsset({ assetId: asset.assetId })).outcome).toBe('trashed');
	});

	it('holds its asset back from Retire until it is removed', async () => {
		const { library, installation, asset, remove } = await installedTemplate();
		const refused = await library.retireGraphicAsset({ assetId: asset.assetId });
		expect(refused.outcome === 'in-use' && refused.usage.map(usage => usage.owner.id))
			.toEqual([installation.templateId]);

		await remove();

		expect((await library.retireGraphicAsset({ assetId: asset.assetId })).outcome).toBe('retired');
	});

	it('keeps an asset another installation still references out of Trash', async () => {
		const { library, archive, asset, remove } = await installedTemplate();
		const second = installationOf(await installPackage(library, archive));
		expect(second.assets[0]).toMatchObject({ outcome: 'reused', assetId: asset.assetId });

		await remove();

		const trash = await library.trashGraphicAsset({ assetId: asset.assetId });
		expect(trash.outcome).toBe('in-use');
		expect(trash.outcome === 'in-use' && trash.usage.map(usage => usage.owner.id))
			.toEqual([second.templateId]);
	});

	it.each([
		{
			case: 'an unknown identity',
			removedFirst: false,
			unknown: true,
			kind: 'broadcast-graphic',
		},
		{
			case: 'a template of the other kind',
			removedFirst: false,
			unknown: false,
			kind: 'feature-match-layout',
		},
		{
			case: 'a template already removed',
			removedFirst: true,
			unknown: false,
			kind: 'broadcast-graphic',
		},
	] as const)('answers not-found for $case', async ({ removedFirst, unknown, kind }) => {
		const { library, installation, remove } = await installedTemplate();
		if (removedFirst)
			await remove();

		const removed = await removeFrom(library, unknown ? 'no-such-template' : installation.templateId, kind);

		expect(removed.outcome).toBe('not-found');
	});

	it('reinstalls the template when its installation is retried', async () => {
		const { library, operation, installation, asset, remove } = await installedTemplate();
		const before = await library.inspectInstalledGraphicsTemplate({ templateId: installation.templateId });
		await remove();

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
		const { library, operation, installation, asset, remove } = await installedTemplate();
		await remove();
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
		const library = newLibrary();
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

		await removeFrom(library, installation.templateId);

		expect((await library.runGraphicsRetention()).revisions.pruningScheduled).toBe(1);
	});
});

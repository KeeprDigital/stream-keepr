import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it, vi } from 'vitest';
import { assertBroadcastGraphicTemplateReferencesSelectable } from '~~/server/utils/broadcastGraphicTemplateReferences';
import { assertFeatureMatchLayoutTemplateReferencesSelectable } from '~~/server/utils/featureMatchLayoutTemplateWrites';

// The util under test shares a file with a helper that reads the template
// library; keep the database out of a unit test of pure batching semantics.
vi.mock('~~/server/modules/feature-match-layout-template-library', () => ({
	findFeatureMatchLayoutTemplateLibraryEntry: vi.fn(),
}));

// Mock Nitro auto-import
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message)
	;(err as any).statusCode = opts.statusCode;
	return err;
});

function reference(assetId: string, revisionId: string): GraphicAssetReference {
	return {
		assetId: assetId as GraphicAssetReference['assetId'],
		revisionId: revisionId as GraphicAssetReference['revisionId'],
	};
}

function media(id: string, asset: GraphicAssetReference): MediaGraphicItemConfig {
	return {
		type: 'media',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 200,
		height: 100,
		asset,
		mediaKind: 'image',
		fit: 'cover',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
	};
}

function broadcastGraphic(items: MediaGraphicItemConfig[]): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower Third', items } as BroadcastGraphicConfig;
}

function featureMatchLayout(options: {
	backgroundImage?: GraphicAssetReference;
	items?: MediaGraphicItemConfig[];
}): FeatureMatchLayoutConfig {
	return {
		frame: { backgroundImage: options.backgroundImage && { kind: 'asset', ...options.backgroundImage } },
		composition: { items: options.items ?? [] },
	} as unknown as FeatureMatchLayoutConfig;
}

const available = { outcome: 'available', lifecycleState: 'active', kind: 'image' };
const missing = { outcome: 'missing' };
const retired = { outcome: 'available', lifecycleState: 'retired', kind: 'image' };
const trashed = { outcome: 'available', lifecycleState: 'trashed', kind: 'image' };
const font = { outcome: 'available', lifecycleState: 'active', kind: 'font' };
const unavailable = { outcome: 'unavailable', retryable: true };

describe('assertBroadcastGraphicTemplateReferencesSelectable', () => {
	// The batching pin, ported from the Screen write path (#374 → #382): one
	// selectability question per template save, never one catalogue round-trip per
	// reference.
	it('asks the library once for every reference, in discovery order', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available, available]);
		const document = broadcastGraphic([
			media('logo', reference('asset-1', 'revision-1')),
			media('badge', reference('asset-2', 'revision-2')),
		]);

		await assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document);

		expect(inspectGraphicAssetRevisions).toHaveBeenCalledTimes(1);
		expect(inspectGraphicAssetRevisions).toHaveBeenCalledWith({
			references: [
				reference('asset-1', 'revision-1'),
				reference('asset-2', 'revision-2'),
			],
		});
	});

	it('refuses missing references with every refused owner slot, in document order', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([missing, available, missing]);
		const document = broadcastGraphic([
			media('logo', reference('asset-1', 'revision-1')),
			media('backdrop', reference('asset-2', 'revision-2')),
			media('badge', reference('asset-3', 'revision-3')),
		]);

		await expect(assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Broadcast Graphic Template cannot reference these Graphic Asset Revisions: '
					+ 'graphics.lower-third.items.logo.asset (does not exist), '
					+ 'graphics.lower-third.items.badge.asset (does not exist)',
			});
	});

	// #614: every template write, new reference or not, needs each reference to be
	// one an author could select now, in a slot its kind fits.
	it('refuses retired, trashed, unavailable, and wrong-kind references, naming why', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([retired, trashed, unavailable, font, available]);
		const document = broadcastGraphic([
			media('retired', reference('asset-1', 'revision-1')),
			media('trashed', reference('asset-2', 'revision-2')),
			media('unavailable', reference('asset-3', 'revision-3')),
			media('font', reference('asset-4', 'revision-4')),
			media('fine', reference('asset-5', 'revision-5')),
		]);

		await expect(assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Broadcast Graphic Template cannot reference these Graphic Asset Revisions: '
					+ 'graphics.lower-third.items.retired.asset (retired), '
					+ 'graphics.lower-third.items.trashed.asset (trashed), '
					+ 'graphics.lower-third.items.unavailable.asset (content unavailable), '
					+ 'graphics.lower-third.items.font.asset (is a font, not an image)',
			});
	});

	it('accepts active, available references of the kind their slot needs', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available]);
		const document = broadcastGraphic([media('logo', reference('asset-1', 'revision-1'))]);

		await expect(assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.resolves
			.toBeUndefined();
	});

	it('asks the library nothing for a document with no references', async () => {
		const inspectGraphicAssetRevisions = vi.fn();

		await assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, broadcastGraphic([]));

		expect(inspectGraphicAssetRevisions).not.toHaveBeenCalled();
	});

	// The batch's refusal hole, pinned the way the Screen write path pins its own
	// (c8a3b121): a reference the answer is silent about fails closed. Fail-open
	// here would store exactly the unresolvable reference the check exists to
	// refuse.
	it('refuses a reference the batch answer is silent about', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available]);
		const document = broadcastGraphic([
			media('logo', reference('asset-1', 'revision-1')),
			media('badge', reference('asset-2', 'revision-2')),
		]);

		await expect(assertBroadcastGraphicTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Broadcast Graphic Template cannot reference these Graphic Asset Revisions: '
					+ 'graphics.lower-third.items.badge.asset (does not exist)',
			});
	});
});

describe('assertFeatureMatchLayoutTemplateReferencesSelectable', () => {
	it('asks the library once for every reference, in discovery order', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available, available]);
		const document = featureMatchLayout({
			backgroundImage: reference('asset-1', 'revision-1'),
			items: [media('logo', reference('asset-2', 'revision-2'))],
		});

		await assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document);

		expect(inspectGraphicAssetRevisions).toHaveBeenCalledTimes(1);
		expect(inspectGraphicAssetRevisions).toHaveBeenCalledWith({
			references: [
				reference('asset-1', 'revision-1'),
				reference('asset-2', 'revision-2'),
			],
		});
	});

	it('refuses missing references with every refused owner slot, in document order', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([missing, missing]);
		const document = featureMatchLayout({
			backgroundImage: reference('asset-1', 'revision-1'),
			items: [media('logo', reference('asset-2', 'revision-2'))],
		});

		await expect(assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Feature Match Layout Template cannot reference these Graphic Asset Revisions: '
					+ 'layout.frame.backgroundImage (does not exist), '
					+ 'layout.composition.items.logo.asset (does not exist)',
			});
	});

	it('refuses a retired Frame image and a wrong-kind item, naming why', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([retired, font]);
		const document = featureMatchLayout({
			backgroundImage: reference('asset-1', 'revision-1'),
			items: [media('logo', reference('asset-2', 'revision-2'))],
		});

		await expect(assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Feature Match Layout Template cannot reference these Graphic Asset Revisions: '
					+ 'layout.frame.backgroundImage (retired), '
					+ 'layout.composition.items.logo.asset (is a font, not an image)',
			});
	});

	it('accepts active, available references of the kind their slot needs', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available]);
		const document = featureMatchLayout({ backgroundImage: reference('asset-1', 'revision-1') });

		await expect(assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.resolves
			.toBeUndefined();
	});

	it('asks the library nothing for a document with no references', async () => {
		const inspectGraphicAssetRevisions = vi.fn();

		await assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, featureMatchLayout({}));

		expect(inspectGraphicAssetRevisions).not.toHaveBeenCalled();
	});

	it('refuses a reference the batch answer is silent about', async () => {
		const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([available]);
		const document = featureMatchLayout({
			backgroundImage: reference('asset-1', 'revision-1'),
			items: [media('logo', reference('asset-2', 'revision-2'))],
		});

		await expect(assertFeatureMatchLayoutTemplateReferencesSelectable({ inspectGraphicAssetRevisions }, document))
			.rejects
			.toMatchObject({
				statusCode: 409,
				message: 'Feature Match Layout Template cannot reference these Graphic Asset Revisions: '
					+ 'layout.composition.items.logo.asset (does not exist)',
			});
	});
});

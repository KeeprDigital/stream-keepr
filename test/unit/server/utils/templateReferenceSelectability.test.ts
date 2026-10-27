import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it, vi } from 'vitest';
import { assertBroadcastGraphicTemplateReferencesSelectable } from '~~/server/utils/broadcastGraphicTemplateReferences';
import { assertFeatureMatchLayoutTemplateReferencesSelectable } from '~~/server/utils/featureMatchLayoutTemplateWrites';

// A template save asks the library once about every reference it holds, refuses
// any an author could not select now, naming each slot and why, and fails
// closed on a reference the answer leaves out. The commit-time half is in
// graphicsTemplateReferences.sqlite.

// Keeps the template library's database read out of these pure checks.
vi.mock('~~/server/modules/feature-match-layout-template-library', () => ({
	findFeatureMatchLayoutTemplateLibraryEntry: vi.fn(),
}));

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message), input));

function reference(index: number): GraphicAssetReference {
	return {
		assetId: `asset-${index}` as GraphicAssetReference['assetId'],
		revisionId: `revision-${index}` as GraphicAssetReference['revisionId'],
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

function broadcastGraphic(items: MediaGraphicItemConfig[], id = 'lower-third'): BroadcastGraphicConfig {
	return { id, name: id, items } as BroadcastGraphicConfig;
}

const available = { outcome: 'available', lifecycleState: 'active', kind: 'image' };
const missing = { outcome: 'missing' };
const retired = { outcome: 'available', lifecycleState: 'retired', kind: 'image' };
const font = { outcome: 'available', lifecycleState: 'active', kind: 'font' };

const KINDS = [
	{
		kind: 'Broadcast Graphic Template',
		assert: assertBroadcastGraphicTemplateReferencesSelectable,
		empty: broadcastGraphic([]),
		/** Two references, and the slot each sits in. */
		twoReferences: broadcastGraphic([
			media('logo', reference(1)),
			media('badge', reference(2)),
		]),
		slots: ['graphics.lower-third.items.logo.asset', 'graphics.lower-third.items.badge.asset'],
	},
	{
		kind: 'Feature Match Layout Template',
		assert: assertFeatureMatchLayoutTemplateReferencesSelectable,
		empty: {
			frame: {},
			composition: { items: [] },
		} as unknown as FeatureMatchLayoutConfig,
		twoReferences: {
			frame: {
				backgroundImage: {
					kind: 'asset',
					...reference(1),
				},
			},
			composition: {
				items: [
					media('logo', reference(2)),
				],
			},
		} as unknown as FeatureMatchLayoutConfig,
		slots: ['layout.frame.backgroundImage', 'layout.composition.items.logo.asset'],
	},
] as const;

describe.each(KINDS)('$kind references', ({ kind, assert, empty, twoReferences, slots }) => {
	const check = (inspectGraphicAssetRevisions: ReturnType<typeof vi.fn>, document: unknown) =>
		(assert as (port: object, document: unknown) => Promise<void>)({ inspectGraphicAssetRevisions }, document);
	const refusal = (...reasons: string[]) => ({
		statusCode: 409,
		message: `${kind} cannot reference these Graphic Asset Revisions: ${reasons.join(', ')}`,
	});

	it('asks the library once for every reference, in document order, and accepts selectable ones', async () => {
		const inspect = vi.fn().mockResolvedValue([available, available]);

		await expect(check(inspect, twoReferences)).resolves.toBeUndefined();

		expect(inspect).toHaveBeenCalledTimes(1);
		expect(inspect).toHaveBeenCalledWith({
			references: [
				reference(1),
				reference(2),
			],
		});
	});

	it('asks the library nothing for a document without references', async () => {
		const inspect = vi.fn();

		await check(inspect, empty);

		expect(inspect).not.toHaveBeenCalled();
	});

	it.each([
		['missing', missing, 'does not exist'],
		['retired', retired, 'retired'],
		[
			'trashed',
			{ outcome: 'available', lifecycleState: 'trashed', kind: 'image' },
			'trashed',
		],
		[
			'unavailable',
			{ outcome: 'unavailable', retryable: true },
			'content unavailable',
		],
		['of the wrong kind', font, 'is a font, not an image'],
	])('refuses a %s reference, naming its slot and why', async (_case, answer, reason) => {
		await expect(check(vi.fn().mockResolvedValue([answer, available]), twoReferences)).rejects.toMatchObject(refusal(`${slots[0]} (${reason})`));
	});

	it('names every refused slot, in document order', async () => {
		await expect(check(vi.fn().mockResolvedValue([retired, font]), twoReferences))
			.rejects
			.toMatchObject(refusal(`${slots[0]} (retired)`, `${slots[1]} (is a font, not an image)`));
	});

	it('refuses a reference the answer is silent about', async () => {
		await expect(check(vi.fn().mockResolvedValue([available]), twoReferences)).rejects.toMatchObject(refusal(`${slots[1]} (does not exist)`));
	});
});

import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import {
	broadcastGraphicsGraphicAssetReferences,
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	isGraphicAssetReferencingScreenMode,
	sameScreenGraphicAssetReferences,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

function reference(assetId: string, revisionId: string): GraphicAssetReference {
	return {
		assetId: assetId as GraphicAssetReference['assetId'],
		revisionId: revisionId as GraphicAssetReference['revisionId'],
	};
}

function media(id: string, overrides: Partial<MediaGraphicItemConfig> = {}): MediaGraphicItemConfig {
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
		asset: reference('asset-1', 'revision-1'),
		mediaKind: 'image',
		fit: 'cover',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
		...overrides,
	};
}

function config(graphics: BroadcastGraphicConfig[]): BroadcastGraphicsModeConfig {
	return { graphics };
}

describe('broadcastGraphicsGraphicAssetReferences', () => {
	it('publishes one reference per Media Graphic Item, named by the item that pins it', () => {
		const references = broadcastGraphicsGraphicAssetReferences(config([
			{
				id: 'lower-third',
				name: 'Lower Third',
				items: [
					media('logo'),
					{
						type: 'group',
						id: 'cluster',
						label: 'cluster',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 400,
						height: 200,
						arrangement: 'row',
						padding: 0,
						gap: 0,
						align: 'stretch',
						justify: 'start',
						clip: false,
						geometry: squareShapeGeometry(),
						children: [media('badge', { asset: reference('asset-2', 'revision-2') })],
					},
				],
			},
		]));

		// The owner slot names the Graphic Item, so a diagnosis points at the item an
		// author repairs rather than at the Screen.
		expect(references).toEqual([
			{
				reference: reference('asset-1', 'revision-1'),
				ownerSlot: 'graphics.lower-third.items.logo.asset',
				kind: 'image',
			},
			{
				reference: reference('asset-2', 'revision-2'),
				ownerSlot: 'graphics.lower-third.items.cluster.children.badge.asset',
				kind: 'image',
			},
		]);
	});

	it('publishes nothing for an item with no asset pinned, or for a non-media item', () => {
		const references = broadcastGraphicsGraphicAssetReferences(config([{
			id: 'bug',
			name: 'Bug',
			items: [
				media('empty', { asset: undefined }),
				{
					type: 'shape',
					id: 'bar',
					label: 'bar',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					geometry: squareShapeGeometry(),
				},
			],
		}]));

		expect(references).toEqual([]);
	});

	it('publishes a hidden Media Graphic Item, which the Screen still carries', () => {
		// Visibility is an authoring toggle, not a change of what the Screen publishes.
		// Dropping a hidden item's reference would remove a revision from the Screen
		// Output Asset Capability that an author expects to come straight back.
		const references = broadcastGraphicsGraphicAssetReferences(config([{
			id: 'bug',
			name: 'Bug',
			items: [media('logo', { visible: false })],
		}]));

		expect(references).toHaveLength(1);
	});

	it('carries a silent video reference with its own target compatibility and a Chromium target', () => {
		// The reference index checks a silent-video reference against the pinned
		// revision's recorded compatibility, so it has to travel with the reference.
		const references = broadcastGraphicsGraphicAssetReferences(config([{
			id: 'sting',
			name: 'Sting',
			items: [media('clip', { mediaKind: 'silent-video', videoCompatibility: 'chromium-transparency' })],
		}]));

		expect(references[0]).toMatchObject({
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		});
	});

	it('names an image reference with no video facts at all', () => {
		const references = broadcastGraphicsGraphicAssetReferences(config([{
			id: 'bug',
			name: 'Bug',
			items: [media('logo', { videoCompatibility: 'all-supported' })],
		}]));

		// A stale compatibility fact on an image must not reach the index, where it
		// would gate a rule that does not apply to the pinned bytes.
		expect(references[0]).not.toHaveProperty('videoCompatibility');
		expect(references[0]).not.toHaveProperty('videoTarget');
	});

	it('keeps owner slots stable when the authored stack is reordered', () => {
		// Reordering changes Graphic Layer Order, not which revisions the Screen
		// publishes. Slots built from list positions would make a reorder read as a
		// set of changed references and force a needless reindex.
		const first = media('logo');
		const second = media('badge', { asset: reference('asset-2', 'revision-2') });
		const forwards = config([{ id: 'g', name: 'g', items: [first, second] }]);
		const backwards = config([{ id: 'g', name: 'g', items: [second, first] }]);

		expect(sameScreenGraphicAssetReferences(
			broadcastGraphicsGraphicAssetReferences(forwards),
			broadcastGraphicsGraphicAssetReferences(backwards),
		)).toBe(true);
	});

	it('dispatches to the right mode, and answers nothing for a mode with no configuration', () => {
		const modeConfigs = { 'broadcast-graphics': config([{ id: 'g', name: 'g', items: [media('logo')] }]) };

		expect(screenModeGraphicAssetReferences('broadcast-graphics', modeConfigs)).toHaveLength(1);
		expect(screenModeGraphicAssetReferences('feature-match-overlay', modeConfigs)).toEqual([]);
		expect(screenModeGraphicAssetReferences('broadcast-graphics', undefined)).toEqual([]);
	});

	it('names every Screen Mode that publishes references, and no other', () => {
		// A mode missing from this list writes its configuration without indexing it,
		// and its Screen Outputs would then be asked for revisions no capability covers.
		expect([...GRAPHIC_ASSET_REFERENCING_SCREEN_MODES])
			.toEqual(['feature-match-overlay', 'broadcast-graphics']);
		expect(isGraphicAssetReferencingScreenMode('broadcast-graphics')).toBe(true);
		expect(isGraphicAssetReferencingScreenMode('feature-match-overlay')).toBe(true);
		expect(isGraphicAssetReferencingScreenMode('idle')).toBe(false);
	});
});

import type { BroadcastGraphicConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';
import {
	broadcastGraphicsGraphicAssetReferences,
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	graphicAssetReferenceSlotPrefix,
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

	it('publishes nothing for an item with no asset pinned or for application-owned social icons', () => {
		const references = broadcastGraphicsGraphicAssetReferences(config([{
			id: 'bug',
			name: 'Bug',
			items: [
				media('empty', { asset: undefined }),
				{
					type: 'social-network-icon',
					id: 'social-icon',
					label: 'Social icon',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					network: 'youtube',
					color: '#ff0000',
					opacity: 0.8,
				},
				{
					type: 'group',
					id: 'cluster',
					label: 'Cluster',
					visible: true,
					anchor: 'top-left',
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					arrangement: 'row',
					padding: 0,
					gap: 0,
					align: 'stretch',
					justify: 'start',
					clip: false,
					geometry: squareShapeGeometry(),
					children: [{
						type: 'social-network-icon',
						id: 'nested-social-icon',
						label: 'Nested social icon',
						visible: true,
						anchor: 'top-left',
						x: 0,
						y: 0,
						width: 10,
						height: 10,
						network: 'bluesky',
						color: '#1185fe',
						opacity: 1,
					}],
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

	it('roots every discovered owner slot in its own mode’s namespace', () => {
		// The reference index has no mode column: the owner-slot prefix is what tells
		// one mode's rows from another's, so a write can scope its delete to its own
		// rows and an output can resolve only its own mode's references. A slot that
		// escaped its prefix would break both silently, which is what this pins.
		const references = broadcastGraphicsGraphicAssetReferences(config([{
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
		}]));

		expect(references).not.toHaveLength(0);
		for (const item of references)
			expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix('broadcast-graphics'))).toBe(true);
	});

	it('gives each referencing Screen Mode a distinct, non-overlapping slot namespace', () => {
		// Two modes sharing a prefix — or one being a prefix of the other — would make
		// the delete scope and the output scope ambiguous.
		const prefixes = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES.map(graphicAssetReferenceSlotPrefix);

		expect(new Set(prefixes).size).toBe(prefixes.length);
		for (const one of prefixes) {
			for (const other of prefixes) {
				if (one !== other)
					expect(one.startsWith(other)).toBe(false);
			}
		}
	});

	it('recognises exactly the modes that publish references, and equips each one', () => {
		// A mode missing from the list writes its configuration without indexing it,
		// and its Screen Outputs would then be asked for revisions no capability
		// covers. A mode on the list that is missing a slot prefix is worse: its
		// writes would be scoped by an undefined prefix. So every listed mode has to
		// be recognised and equipped, and an unlisted one recognised as neither.
		// Named as well as iterated. Iterating proves each listed mode is equipped, but
		// only naming the list makes dropping or renaming a member fail here rather than
		// pass quietly with one mode fewer.
		expect([...GRAPHIC_ASSET_REFERENCING_SCREEN_MODES]).toEqual(['feature-match-overlay', 'broadcast-graphics']);

		for (const mode of GRAPHIC_ASSET_REFERENCING_SCREEN_MODES) {
			expect(isGraphicAssetReferencingScreenMode(mode)).toBe(true);
			expect(graphicAssetReferenceSlotPrefix(mode)).toMatch(/^[a-z]+\.$/);
		}

		// The other half of "exactly", derived from every Screen Mode there is rather
		// than listed by hand. The hand-written list this replaces named five of the
		// eight non-referencing modes, so standings, topCut, and player-history were
		// asserted nowhere — and a mode added to the vocabulary joined neither list.
		const referencing: readonly string[] = GRAPHIC_ASSET_REFERENCING_SCREEN_MODES;
		const nonReferencing = SCREEN_MODE_VALUES.filter(mode => !referencing.includes(mode));

		// Every referencing mode is a real Screen Mode: a typo in the list above removes
		// nothing here, and the two counts stop agreeing.
		expect(nonReferencing).toHaveLength(SCREEN_MODE_VALUES.length - GRAPHIC_ASSET_REFERENCING_SCREEN_MODES.length);

		for (const mode of nonReferencing)
			expect(isGraphicAssetReferencingScreenMode(mode)).toBe(false);
	});
});
